#!/usr/bin/env node
/**
 * Capturas reales para el centro de aprendizaje (v0.1.322, ADR-S75).
 *
 * Recorre cada «demo» de `scenarios/*.mjs` en la app de verdad, sobre una
 * empresa de ejemplo, y guarda cada cuadro como WebP más un `demos.json` con
 * qué se ve, dónde está lo que hay que tocar y qué pasa (clic, escribir,
 * arrastrar). El reproductor de la app anima el cursor encima de esos cuadros.
 *
 *   node scripts/help-captures/run.mjs --base http://localhost:5174 \
 *        --email demo@ejemplo.test --password ... [--only clave] [--out dir]
 *
 * La cuenta tiene que existir y tener una empresa (en el release la crea
 * `ci.sh`). Si la empresa no tiene listas, se siembra con las plantillas del
 * sistema (con registros de ejemplo). El WebP lo codifica el propio Chromium
 * (canvas → webp), así no hace falta ffmpeg ni sharp.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { fillLists } from './fill.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function arg(name, def) {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : def;
}
const BASE = arg('base', 'http://localhost:5174').replace(/\/$/, '');
const EMAIL = arg('email', process.env.CAPTURE_EMAIL);
const PASSWORD = arg('password', process.env.CAPTURE_PASSWORD);
const OUT = path.resolve(arg('out', path.join(root, 'apps/web/public/help-media')));
const ONLY = arg('only', '');
const STRICT = process.argv.includes('--strict');
const VIEWPORT = { width: 1100, height: 700 };
const DPR = 1.5;
const QUALITY = 0.8;

if (!EMAIL || !PASSWORD) {
    console.error('Faltan --email y --password (o CAPTURE_EMAIL / CAPTURE_PASSWORD).');
    process.exit(2);
}

// playwright-core: el del monorepo o el que haya instalado en la máquina.
function loadPlaywright() {
    const tries = [path.join(root, 'package.json'), path.join(process.cwd(), 'package.json')];
    for (const p of tries) {
        try {
            return createRequire(p)('playwright-core');
        } catch {
            /* sigue */
        }
    }
    throw new Error('No encuentro playwright-core (pnpm install en la raíz).');
}
const { chromium } = loadPlaywright();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CSS que estabiliza las capturas: sin transiciones, sin cursor de texto, sin barras. */
const FREEZE_CSS = `*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important;caret-color:transparent!important}
::-webkit-scrollbar{width:0!important;height:0!important}`;

async function main() {
    const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DPR,
        locale: 'es-CO',
        timezoneId: 'America/Bogota',
        colorScheme: 'light',
    });
    await context.addInitScript(() => {
        try {
            localStorage.setItem('imcrm:theme', 'light');
        } catch {
            /* nada */
        }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // ── Entrar ───────────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`);
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.hash.startsWith('#/'), null, { timeout: 30000 });

    const me = await (await page.request.get(`${BASE}/api/v1/auth/me`)).json();
    const tenantId = me.memberships?.[0]?.tenant_id;
    if (!tenantId) throw new Error('La cuenta no tiene empresa.');
    const api = makeApi(page.request, BASE, tenantId);

    await seed(api, me.user.id);
    const lists = await listMap(api);

    // ── Escenarios ───────────────────────────────────────────────────────
    const dir = path.join(here, 'scenarios');
    const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
    const scenarios = [];
    for (const f of files) {
        const mod = await import(pathToFileURL(path.join(dir, f)).href);
        const list = Array.isArray(mod.default) ? mod.default : [mod.default];
        for (const s of list) if (s && (!ONLY || ONLY.split(',').includes(s.key))) scenarios.push(s);
    }

    mkdirSync(OUT, { recursive: true });
    const manifestPath = path.join(OUT, 'demos.json');

    const encoder = await context.newPage();
    await encoder.goto('about:blank');

    const failed = [];
    for (const s of scenarios) {
        const t0 = Date.now();
        const frames = [];
        const work = await context.newPage();
        work.on('pageerror', (e) => errors.push(`${s.key}: ${e.message}`));
        await work.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
        const ctx = { page: work, api, lists, base: BASE, sleep, tenantId };
        try {
            if (s.setup) await s.setup(ctx);
            for (const step of s.steps) await runStep(ctx, step, frames, encoder, s.key);
            if (frames.length === 0) throw new Error('la demo no produjo cuadros');
            const keyDir = path.join(OUT, 'demos', s.key);
            rmSync(keyDir, { recursive: true, force: true });
            mkdirSync(keyDir, { recursive: true });
            // Cada demo deja su propio índice; `demos.json` se arma juntándolos
            // (así varias corridas a la vez no se pisan).
            const demo = {
                title: s.title,
                frames: frames.map((f, i) => {
                    writeFileSync(path.join(keyDir, `${i + 1}.webp`), f.image);
                    const { image: _img, ...meta } = f;
                    return { src: `demos/${s.key}/${i + 1}.webp`, ...meta };
                }),
            };
            writeFileSync(path.join(keyDir, 'demo.json'), JSON.stringify(demo));
            console.log(`✓ ${s.key} · ${frames.length} cuadros · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        } catch (e) {
            failed.push(s.key);
            console.log(`✗ ${s.key} — ${e.message.split('\n')[0]}`);
            await work.screenshot({ path: path.join(OUT, `fallo-${s.key}.png`) }).catch(() => {});
        } finally {
            await work.close();
        }
    }

    const manifest = buildManifest(OUT);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await browser.close();
    console.log(`\n${Object.keys(manifest.demos).length} demos en ${OUT}${failed.length ? ` · fallaron: ${failed.join(', ')}` : ''}`);
    if (errors.length) console.log('errores de la página:', errors.slice(0, 8));
    if (STRICT && failed.length) process.exit(1);
}

/** Junta los `demos/<clave>/demo.json` en un solo índice. */
function buildManifest(out) {
    const demos = {};
    const base = path.join(out, 'demos');
    if (existsSync(base)) {
        for (const key of readdirSync(base).sort()) {
            const f = path.join(base, key, 'demo.json');
            if (existsSync(f)) demos[key] = JSON.parse(readFileSync(f, 'utf8'));
        }
    }
    return { generated_at: new Date().toISOString(), version: readFileSync(path.join(root, 'VERSION'), 'utf8').trim(), viewport: VIEWPORT, demos };
}

// ── API de la app (con la sesión del navegador) ──────────────────────────

function makeApi(request, base, tenantId) {
    const headers = { 'x-tenant-id': String(tenantId), 'content-type': 'application/json' };
    async function call(method, url, body) {
        const res = await request.fetch(`${base}/api/v1${url}`, { method, headers, data: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = text;
        }
        if (!res.ok()) throw new Error(`${method} ${url} → ${res.status()} ${text.slice(0, 200)}`);
        return json;
    }
    return {
        get: (u) => call('GET', u),
        post: (u, b) => call('POST', u, b ?? {}),
        patch: (u, b) => call('PATCH', u, b ?? {}),
        put: (u, b) => call('PUT', u, b ?? {}),
        del: (u) => call('DELETE', u),
    };
}

const SEED_TEMPLATES = ['pipeline-ventas', 'facturacion', 'proyectos-tareas', 'soporte-tickets', 'inventario', 'agenda-citas'];

async function seed(api, userId) {
    // Que nada tape la pantalla: bienvenida, primeros pasos, novedades.
    await api.patch('/me/guides', { welcome_offered: true }).catch(() => {});
    await api.patch('/onboarding', { hidden: true, welcome_dismissed: true }).catch(() => {});
    await api.post('/me/whats-new/seen', { all: true }).catch(() => {});
    await api.patch('/workspaces/current/format', { date_format: 'dmy', number_format: 'dot_comma', time_format: 'h12', timezone: 'America/Bogota' }).catch(() => {});

    const { data: lists } = await api.get('/lists');
    if (lists.length > 0) return;
    for (const key of SEED_TEMPLATES) {
        try {
            await api.post(`/list-templates/sys:${key}/apply`, { include_records: true });
            console.log(`  sembrada «${key}»`);
        } catch (e) {
            console.log(`  no se pudo sembrar «${key}»: ${e.message}`);
        }
    }
    await fillLists(api, userId);
}

/** nombre de lista → slug (para `{list:Clientes}` en las rutas). */
async function listMap(api) {
    const { data } = await api.get('/lists');
    const map = {};
    for (const l of data) map[l.name] = l;
    return map;
}

// ── Pasos ────────────────────────────────────────────────────────────────

function resolvePath(p, lists) {
    return p.replace(/\{list:([^}]+)\}/g, (_, name) => {
        const l = lists[name];
        if (!l) throw new Error(`no existe la lista «${name}» en la empresa de ejemplo`);
        return l.slug;
    });
}

async function settle(page, ms = 700) {
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await sleep(ms);
}

async function rectOf(page, selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error(`sin caja para ${selector}`);
    return { loc, rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } };
}

async function grab(page, encoder) {
    await page.mouse.move(-10, -10).catch(() => {});
    const png = await page.screenshot({ type: 'png' });
    const b64 = await encoder.evaluate(
        async ({ data, q }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${data}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            return c.toDataURL('image/webp', q).split(',')[1];
        },
        { data: png.toString('base64'), q: QUALITY },
    );
    return Buffer.from(b64, 'base64');
}

async function runStep(ctx, step, frames, encoder, key) {
    const { page } = ctx;
    if (step.go) {
        await page.goto(`${ctx.base}/#${resolvePath(step.go, ctx.lists)}`);
        await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
        if (step.wait) await page.locator(step.wait).first().waitFor({ state: 'visible', timeout: 20000 });
        await settle(page, 700);
        // Escape cierra cualquier aviso que se haya colado.
        if (step.escape !== false) await page.keyboard.press('Escape').catch(() => {});
        if (step.caption) frames.push({ image: await grab(page, encoder), caption: step.caption, action: 'view' });
        return;
    }
    if (step.run) {
        await step.run(ctx);
        await settle(page);
        return;
    }
    if (step.wait !== undefined && Object.keys(step).length === 1) {
        if (typeof step.wait === 'number') await sleep(step.wait);
        else await page.locator(step.wait).first().waitFor({ state: 'visible', timeout: 20000 });
        return;
    }
    if (step.press) {
        await page.keyboard.press(step.press);
        await settle(page);
        if (step.caption) frames.push({ image: await grab(page, encoder), caption: step.caption, action: 'view' });
        return;
    }
    if (step.shot) {
        let target;
        if (typeof step.shot === 'string') target = (await rectOf(page, step.shot)).rect;
        frames.push({ image: await grab(page, encoder), caption: step.caption ?? '', action: target ? 'look' : 'view', ...(target ? { target } : {}) });
        return;
    }
    if (step.click || step.hover || step.dblclick) {
        const sel = step.click ?? step.hover ?? step.dblclick;
        const { loc, rect } = await rectOf(page, sel);
        if (step.caption !== null) frames.push({ image: await grab(page, encoder), caption: step.caption ?? '', action: step.hover ? 'hover' : 'click', target: rect });
        if (step.hover) await loc.hover();
        else if (step.dblclick) await loc.dblclick();
        else await loc.click({ button: step.right ? 'right' : 'left' });
        if (step.then) await page.locator(step.then).first().waitFor({ state: 'visible', timeout: 15000 });
        await settle(page);
        return;
    }
    if (step.fill) {
        const { loc, rect } = await rectOf(page, step.fill);
        frames.push({ image: await grab(page, encoder), caption: step.caption ?? '', action: 'type', text: step.text, target: rect });
        await loc.click();
        await loc.fill(step.text);
        await settle(page, 300);
        return;
    }
    if (step.drag) {
        const [fromSel, toSel] = step.drag;
        const a = await rectOf(page, fromSel);
        const b = await rectOf(page, toSel);
        frames.push({ image: await grab(page, encoder), caption: step.caption ?? '', action: 'drag', target: a.rect, to: b.rect });
        await page.mouse.move(a.rect.x + a.rect.w / 2, a.rect.y + a.rect.h / 2);
        await page.mouse.down();
        await page.mouse.move(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2, { steps: 12 });
        await page.mouse.up();
        await settle(page);
        return;
    }
    throw new Error(`${key}: paso desconocido ${JSON.stringify(Object.keys(step))}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
