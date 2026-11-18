#!/usr/bin/env node
/**
 * Pruebas de pantallas (v0.1.436): recorren la app en un navegador real y
 * fallan si una pantalla se rompe. Corren en el CI de cada PR
 * (`scripts/e2e/ci.sh`) y en una máquina de desarrollo contra el entorno de
 * `scripts/dev/up.sh`:
 *
 *   DATABASE_URL=postgres://imagina:imagina@localhost:5432/imagina_base \
 *   node scripts/e2e/smoke.mjs --base http://localhost:5174 --api http://localhost:3001
 *
 * Qué se considera roto, en CADA pantalla:
 *   · un error de JavaScript sin atrapar (`pageerror`);
 *   · la pantalla de «Algo salió mal» o «Algo falló al mostrar esta parte»;
 *   · una respuesta 5xx del API;
 *   · un error de pantalla mandado a Diagnóstico (`/client-errors`);
 *   · (al final) una clave de caché con el SLUG de una lista: regla de oro
 *     nº 7 (`lib/queryKeyAudit.ts`).
 *
 * Además: el alta de un registro desde la tabla, un formulario público que
 * crea un registro, el celular sin scroll lateral y, si se pasa
 * `--operator-email/--operator-password`, las pestañas de Plataforma.
 *
 * Cada corrida crea su PROPIA empresa (correo único): no toca datos de nadie.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const req = createRequire(path.join(root, 'package.json'));
const { chromium } = req('playwright-core');

const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5174').replace(/\/$/, '');
const API = arg('api', BASE).replace(/\/$/, '');
const OPERATOR_EMAIL = arg('operator-email', process.env.E2E_OPERATOR_EMAIL ?? '');
const OPERATOR_PASSWORD = arg('operator-password', process.env.E2E_OPERATOR_PASSWORD ?? '');
const SHOTS = arg('shots', '');
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const EMAIL = `pantallas-${RUN}@ejemplo.test`;
const PASSWORD = `Clave-de-prueba-${RUN}-1`;

const failures = [];
let passed = 0;
const check = (name, ok, extra = '') => {
    if (ok) passed += 1;
    else failures.push(`${name}${extra ? ` — ${extra}` : ''}`);
    console.log(`${ok ? '✓' : '✗'} ${name}${extra && !ok ? ` — ${extra}` : ''}`);
};

// ── Preparar: una empresa nueva con datos (por el API, como cualquiera) ──────

class ApiClient {
    constructor(base) {
        this.base = base;
        this.cookie = '';
        this.tenant = '';
    }
    async call(method, p, body) {
        const r = await fetch(`${this.base}/api/v1${p}`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(this.cookie ? { cookie: this.cookie } : {}),
                ...(this.tenant ? { 'x-tenant-id': this.tenant } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = r.headers.get('set-cookie');
        if (set) this.cookie = set.split(';')[0];
        const text = await r.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            /* texto */
        }
        if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text.slice(0, 300)}`);
        return json;
    }
    /** Lo que viene en `data` (la forma de casi todo el API). */
    async data(method, p, body) {
        const json = await this.call(method, p, body);
        return json && typeof json === 'object' && 'data' in json ? json.data : json;
    }
    /** Cuántos registros tiene una lista (el total del listado). */
    async total(listId) {
        const json = await this.call('GET', `/lists/${listId}/records?limit=1&with_total=1`);
        return Number(json?.meta?.total ?? NaN);
    }
}

async function prepare() {
    const api = new ApiClient(API);
    await api.call('POST', '/auth/register', { email: EMAIL, password: PASSWORD, name: 'Prueba de pantallas', workspace_name: `Pantallas ${RUN}` });
    if (process.env.DATABASE_URL) {
        const { Client } = createRequire(path.join(root, 'apps/api/package.json'))('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL });
        await db.connect();
        await db.query('UPDATE users SET email_verified_at = now() WHERE lower(email) = lower($1)', [EMAIL]);
        await db.end();
    }
    await api.call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
    const me = await api.data('GET', '/auth/me');
    api.tenant = String(me.memberships[0].tenant_id);
    // Sin el ofrecimiento de la bienvenida (es un diálogo que tapa la pantalla).
    await api.call('PATCH', '/me/guides', { welcome_offered: true });
    // Plantillas del sistema con sus registros de ejemplo: listas vinculadas,
    // vistas (kanban, calendario, gantt), tableros, subtareas, agenda.
    for (const key of ['facturacion', 'proyectos-tareas', 'agenda-citas', 'soporte-tickets', 'pipeline-ventas']) {
        await api.call('POST', `/list-templates/sys:${key}/apply`, { include_records: true });
    }
    const lists = await api.data('GET', '/lists');
    const out = [];
    for (const l of lists) {
        const [views, records] = await Promise.all([
            api.data('GET', `/lists/${l.id}/views`),
            api.data('GET', `/lists/${l.id}/records?limit=1`),
        ]);
        const first = Array.isArray(records) ? records[0] : null;
        out.push({ id: l.id, slug: l.slug, name: l.name, views: (views ?? []).map((v) => v.id), recordId: first?.id ?? null });
    }
    const dashboards = await api.data('GET', '/dashboards');
    // Un formulario publicado en la primera lista (para la prueba pública).
    const target = out.find((l) => l.slug.includes('cliente')) ?? out[0];
    const form = await api.data('POST', `/lists/${target.id}/forms`, { name: 'Contacto de prueba' });
    const published = await api.data('PATCH', `/lists/${target.id}/forms/${form.id}`, { enabled: true });
    return { api, lists: out, dashboards: (dashboards ?? []).map((d) => d.id), form: { listId: target.id, path: published?.public_path ?? form.public_path } };
}

// ── Recorrer ────────────────────────────────────────────────────────────────

function watch(page, label) {
    const state = { errors: [], http5xx: [], clientErrors: [] };
    page.on('pageerror', (e) => state.errors.push(e.message));
    page.on('response', (r) => {
        const u = r.url();
        if (u.includes('/api/') && r.status() >= 500) state.http5xx.push(`${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
    });
    page.on('request', (r) => {
        if (r.url().includes('/api/v1/client-errors')) state.clientErrors.push(r.postData() ?? '');
    });
    state.label = label;
    return state;
}

async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
}

async function visit(page, state, hashRoute, name = hashRoute) {
    const before = { e: state.errors.length, h: state.http5xx.length, c: state.clientErrors.length };
    try {
        await page.goto(`${BASE}/#${hashRoute}`, { waitUntil: 'domcontentloaded' });
        await settle(page);
    } catch (e) {
        check(`${state.label} ${name}`, false, `no cargó: ${e.message}`);
        return;
    }
    const crash = await page
        .getByText(/Algo salió mal|Algo falló al mostrar esta parte/)
        .count()
        .catch(() => 0);
    const errs = state.errors.slice(before.e);
    const http = state.http5xx.slice(before.h);
    const reported = state.clientErrors.slice(before.c);
    const ok = crash === 0 && errs.length === 0 && http.length === 0 && reported.length === 0;
    check(`${state.label} ${name}`, ok, [crash ? `pantalla de error (${crash})` : '', ...errs.map((e) => `JS: ${e}`), ...http, ...reported.map((r) => `reportado: ${r.slice(0, 200)}`)].filter(Boolean).join(' · '));
    if (!ok && SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => undefined);
}

async function login(page, email, password) {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.hash.startsWith('#/'), null, { timeout: 20_000 });
    await settle(page);
}

const LIST_SECTIONS = ['campos', 'general', 'apariencia', 'permisos', 'compartir', 'formularios', 'agenda', 'tienda', 'correo', 'plantillas', 'aprobaciones', 'documentos', 'sla'];
const SETTINGS_SECTIONS = ['plan', 'suscripcion', 'marca', 'formato', 'miembros', 'equipos', 'roles', 'conectores', 'correo', 'almacenamiento', 'asistente', 'portal', 'widgets', 'privacidad', 'problemas', 'auditoria', 'papelera', 'seguridad', 'avisos', 'calendario', 'firma', 'datos', 'apariencia'];
const PLATFORM_TABS = ['tenants', 'users', 'plans', 'cobros', 'audit', 'transfers', 'marca', 'novedades', 'ayuda', 'integraciones', 'ai', 'correo', 'dominios', 'updates', 'backups', 'diagnostico'];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let exitCode = 0;
try {
    const data = await prepare();
    console.log(`empresa de prueba: ${data.lists.length} listas, ${data.dashboards.length} tableros`);

    // ── Escritorio ──
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await ctx.addInitScript(() => {
        try {
            window.localStorage.setItem('imcrm:e2e', '1');
            window.localStorage.setItem('imcrm:install-offer', JSON.stringify({ dismissedAt: Date.now(), installed: true }));
        } catch {
            /* nada */
        }
    });
    const page = await ctx.newPage();
    const desk = watch(page, '[escritorio]');
    await login(page, EMAIL, PASSWORD);
    check('[escritorio] entrar', true);

    for (const r of ['/lists', '/my-work', '/favorites', '/dashboards', '/agents', '/aprende', '/ideas', '/novedades', '/avisos']) await visit(page, desk, r);
    for (const id of data.dashboards) await visit(page, desk, `/dashboards/${id}`);
    for (const l of data.lists) {
        await visit(page, desk, `/lists/${l.slug}/records`);
        for (const v of l.views) await visit(page, desk, `/lists/${l.slug}/records?view=${v}`, `/lists/${l.slug} vista ${v}`);
        if (l.recordId) {
            await visit(page, desk, `/lists/${l.slug}/records?record=${l.recordId}`, `/lists/${l.slug} ficha (ventana)`);
            await visit(page, desk, `/lists/${l.slug}/records/${l.recordId}`, `/lists/${l.slug} ficha (página)`);
        }
        await visit(page, desk, `/lists/${l.slug}/automations`);
    }
    // La configuración de la lista, sección por sección (en una sola lista: es la misma pantalla).
    const deep = data.lists[0];
    for (const s of LIST_SECTIONS) await visit(page, desk, `/lists/${deep.slug}/edit?s=${s}`);
    for (const s of SETTINGS_SECTIONS) await visit(page, desk, `/settings?s=${s}`);

    // Alta de un registro desde la tabla.
    {
        const l = data.lists.find((x) => x.recordId) ?? deep;
        const before = await data.api.total(l.id);
        await page.goto(`${BASE}/#/lists/${l.slug}/records`);
        await settle(page);
        await page.locator('[data-tour="records-new"]').first().click();
        const dialog = page.getByRole('dialog').last();
        await dialog.waitFor({ timeout: 10_000 });
        const title = dialog.locator('input').first();
        await title.fill(`Registro de prueba ${RUN}`);
        await dialog.getByRole('button', { name: /^(Crear|Guardar|Crear registro)$/ }).last().click();
        await page.waitForTimeout(1500);
        const after = await data.api.total(l.id);
        check('[escritorio] alta de un registro desde la tabla', after - before === 1, `antes ${before}, después ${after}`);
    }

    // Regla de oro nº 7: ninguna clave de caché con el slug de una lista.
    const violations = await page.evaluate(() => (window.__imcrmQueryKeyAudit ? window.__imcrmQueryKeyAudit() : null));
    check('[escritorio] regla de oro nº 7: claves de caché sin slugs', Array.isArray(violations) && violations.length === 0, Array.isArray(violations) ? violations.slice(0, 12).join(' | ') : 'el auditor no está instalado');
    await ctx.close();

    // ── Formulario público: crea un registro ──
    if (data.form.path) {
        const pub = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const p = await pub.newPage();
        const st = watch(p, '[público]');
        const before = await data.api.total(data.form.listId);
        // Por el origen de la app (en desarrollo, vite le pasa /api al API).
        await p.goto(`${BASE}${data.form.path}`);
        await p.waitForLoadState('networkidle').catch(() => undefined);
        // Sólo las preguntas (`.ib-input`): el campo trampa `website` está fuera de
        // la pantalla pero el navegador lo da por visible — llenarlo es lo que
        // hace un robot, y la respuesta se descarta en silencio.
        const inputs = p.locator('form input.ib-input[type=text]:not([inputmode]), form input.ib-input[type=email], form textarea.ib-input');
        const n = await inputs.count();
        for (let i = 0; i < n; i += 1) {
            const el = inputs.nth(i);
            if (!(await el.isVisible())) continue;
            const type = await el.getAttribute('type');
            await el.fill(type === 'email' ? `cliente-${RUN}@ejemplo.test` : `Respuesta ${RUN}`);
        }
        await p.waitForTimeout(3000); // el sello pide 2,5 s entre cargar y enviar
        await p.locator('button[type=submit]').last().click();
        await p.waitForTimeout(2500);
        const delta = (await data.api.total(data.form.listId)) - before;
        const ok = delta === 1 && st.errors.length === 0;
        check('[público] el formulario crea un registro', ok, `diferencia ${delta}${st.errors.length ? ` · JS: ${st.errors.join(' | ')}` : ''}`);
        if (!ok && SHOTS) await p.screenshot({ path: path.join(SHOTS, 'formulario-publico.png') }).catch(() => undefined);
        await pub.close();
    }

    // ── Celular (modo oscuro): sin errores y sin scroll lateral ──
    {
        const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
        await mob.addInitScript(() => {
            try {
                window.localStorage.setItem('imcrm:e2e', '1');
                window.localStorage.setItem('imcrm:install-offer', JSON.stringify({ dismissedAt: Date.now(), installed: true }));
            } catch {
                /* nada */
            }
        });
        const m = await mob.newPage();
        const st = watch(m, '[celular]');
        await login(m, EMAIL, PASSWORD);
        const l = data.lists[0];
        for (const r of ['/lists', `/lists/${l.slug}/records`, `/lists/${l.slug}/edit`, '/my-work', '/menu', '/settings', '/dashboards']) {
            await visit(m, st, r);
            const wide = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            check(`[celular] ${r} sin scroll lateral`, !wide);
        }
        await mob.close();
    }

    // ── Plataforma (con el operador) ──
    if (OPERATOR_EMAIL && OPERATOR_PASSWORD) {
        const op = await browser.newContext({ viewport: { width: 1400, height: 950 } });
        const o = await op.newPage();
        const st = watch(o, '[plataforma]');
        await login(o, OPERATOR_EMAIL, OPERATOR_PASSWORD);
        for (const t of PLATFORM_TABS) await visit(o, st, `/platform?tab=${t}`);
        await op.close();
    }
} catch (e) {
    check('la prueba terminó sin excepciones', false, e.stack ?? e.message);
} finally {
    await browser.close();
}

console.log(`\n${passed} bien · ${failures.length} mal`);
if (failures.length) {
    console.log('\nLo que falló:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    exitCode = 1;
}
process.exit(exitCode);
