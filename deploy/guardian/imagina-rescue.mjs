#!/usr/bin/env node
// Página de rescate del servidor (v0.1.432, ADR-S104).
//
// Un servicio aparte, sin dependencias (sólo módulos de node), que NO pasa por
// la app ni por Nginx: si la app no abre, esta página sí. Muestra lo que ve el
// guardián y deja pedirle cuatro cosas (reparar, reiniciar la app, volver a la
// versión anterior, liberar espacio). No ejecuta nada: deja un archivo VACÍO
// con el nombre del pedido en $STATE/rescue/requests y el guardián (root) lo
// hace. El guardián nunca lee el contenido de esos archivos.
//
// Arranca como root sólo para leer el certificado del dominio (que es de root)
// y abrir su puerto; enseguida pasa a su usuario sin permisos (imagina-rescue).
//
//   node imagina-rescue.mjs [serve]   sirve la página (lo hace systemd)
//   node imagina-rescue.mjs hash      lee una clave por stdin e imprime su hash
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONF_FILE = process.env.RESCUE_CONF || '/etc/imagina-base/rescue.conf';
const SESSION_TTL_S = 2 * 3600;
const FAIL_LIMIT = 5; // claves equivocadas por IP antes de bloquear
const GLOBAL_FAIL_LIMIT = 40; // en total, antes de cerrar el ingreso a todos
const BLOCK_MS = 15 * 60_000;
const ACTIONS = ['repair', 'restart', 'rollback', 'cleanup'];

// ── clave ────────────────────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(pass) {
    const salt = randomBytes(16);
    const hash = scryptSync(pass, salt, 32, SCRYPT);
    return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export function verifyPassword(pass, stored) {
    const parts = String(stored || '').split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64url');
    if (expected.length !== 32) return false;
    let got;
    try {
        got = scryptSync(String(pass), Buffer.from(saltB64, 'base64url'), 32, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
    } catch {
        return false;
    }
    return timingSafeEqual(got, expected);
}

// ── configuración ────────────────────────────────────────────────────────
function readKv(file) {
    const out = {};
    if (!existsSync(file)) return out;
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
}

function loadConfig() {
    const cfg = readKv(CONF_FILE);
    const dir = CONF_FILE.slice(0, CONF_FILE.lastIndexOf('/')) || '.';
    const tls = readKv(cfg.TLS_CONF || join(dir, 'rescue-tls.conf'));
    return {
        port: Number(cfg.PORT || 8899),
        bind: cfg.BIND || '::',
        user: cfg.USER || '',
        group: cfg.GROUP || cfg.USER || '',
        passwordHash: cfg.PASSWORD_HASH || '',
        sessionSecret: cfg.SESSION_SECRET || '',
        state: cfg.STATE || '/var/lib/imagina-base/guardian',
        domain: cfg.DOMAIN || '',
        cert: tls.CERT || '',
        key: tls.KEY || '',
        certKind: tls.KIND || 'none',
    };
}

// ── utilidades ───────────────────────────────────────────────────────────
const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function lastLines(file, n) {
    try {
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-n);
    } catch {
        return [];
    }
}

function ago(iso, now = Date.now()) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 'nunca';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'hace un momento';
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

function clientIp(req) {
    const a = req.socket.remoteAddress || '';
    return a.startsWith('::ffff:') ? a.slice(7) : a;
}

// ── sesión ───────────────────────────────────────────────────────────────
function sign(secret, value) {
    return createHmac('sha256', secret).update(value).digest('base64url');
}

function makeSession(secret) {
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
    const nonce = randomBytes(16).toString('base64url');
    const body = `${exp}.${nonce}`;
    return `${body}.${sign(secret, body)}`;
}

function readSession(secret, req) {
    const cookie = String(req.headers.cookie || '');
    const m = /(?:^|;\s*)ib_rescate=([A-Za-z0-9_.-]+)/.exec(cookie);
    if (!m) return null;
    const parts = m[1].split('.');
    if (parts.length !== 3) return null;
    const [exp, nonce, mac] = parts;
    const want = Buffer.from(sign(secret, `${exp}.${nonce}`));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    if (!(Number(exp) > Date.now() / 1000)) return null;
    return { nonce, csrf: sign(secret, `csrf.${nonce}`) };
}

function sameToken(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ── freno a las claves equivocadas ───────────────────────────────────────
export function createLimiter(now = () => Date.now()) {
    const byIp = new Map();
    let global = { fails: 0, since: now(), until: 0 };
    return {
        blocked(ip) {
            const t = now();
            if (global.until > t) return true;
            const e = byIp.get(ip);
            return Boolean(e && e.until > t);
        },
        fail(ip) {
            const t = now();
            if (t - global.since > BLOCK_MS) global = { fails: 0, since: t, until: 0 };
            global.fails += 1;
            if (global.fails >= GLOBAL_FAIL_LIMIT) global.until = t + BLOCK_MS;
            const e = byIp.get(ip) && t - byIp.get(ip).since <= BLOCK_MS ? byIp.get(ip) : { fails: 0, since: t, until: 0 };
            e.fails += 1;
            if (e.fails >= FAIL_LIMIT) e.until = t + BLOCK_MS;
            byIp.set(ip, e);
            if (byIp.size > 5000) byIp.delete(byIp.keys().next().value);
            return e.until > t; // recién bloqueada
        },
        ok(ip) {
            byIp.delete(ip);
        },
    };
}

// ── páginas ──────────────────────────────────────────────────────────────
const CHECKS = [
    ['front', 'Entrada por el dominio'],
    ['api', 'La app'],
    ['database', 'Base de datos'],
    ['redis', 'Redis'],
    ['web_server', 'Servidor web (Nginx o Caddy)'],
    ['disk', 'Disco'],
];
const STATE_TEXT = {
    ok: ['ok', 'Funciona'],
    down: ['bad', 'No responde'],
    cert: ['bad', 'Certificado inválido'],
    updating: ['wait', 'Actualizándose'],
    skipped: ['none', 'Sin revisar'],
    unknown: ['none', 'Sin datos'],
};
const ACTION_TEXT = {
    repair: ['Reparar ahora', 'Revisa todo y arregla lo que encuentre, sin los límites por hora.'],
    restart: ['Reiniciar la app', 'Reinicia el proceso de la app. Tarda unos segundos.'],
    rollback: ['Volver a la versión anterior', 'Para cuando una actualización dejó la app sin funcionar. Sólo cambia el código: tus datos no se tocan.'],
    cleanup: ['Liberar espacio', 'Borra versiones y copias viejas, registros del sistema e imágenes sin uso. Nunca tus datos.'],
};

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#14161a;--muted:#5d6470;--line:#e2e5ea;--ok:#0f7b45;--bad:#b42318;--wait:#9a6700;--accent:#0b5cad;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1b1c1f;--ink:#eceef1;--muted:#a4abb6;--line:#2c2e33;--ok:#4cc38a;--bad:#ff7b72;--wait:#e3b341;--accent:#6cb6ff;--on-accent:#0b1220}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:760px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}
.sub{color:var(--muted);margin:0 0 18px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 14px}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.st{font-weight:600;white-space:nowrap}.ok{color:var(--ok)}.bad{color:var(--bad)}.wait{color:var(--wait)}.none{color:var(--muted)}
.det{color:var(--muted);font-size:13px}.note{border-left:3px solid var(--accent);padding:8px 12px;margin:0 0 14px;background:var(--card)}
.warn{border-left-color:var(--bad)}form.act{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)}
form.act:first-of-type{border-top:0}.act p{margin:2px 0 0;color:var(--muted);font-size:13px}
button{font:inherit;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:8px 14px;cursor:pointer;white-space:nowrap}
button.main{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}label.chk{display:block;font-size:13px;color:var(--muted);margin-top:4px}
input[type=password]{font:inherit;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);margin:6px 0 12px}
ul.ev{list-style:none;margin:0;padding:0}ul.ev li{padding:6px 0;border-top:1px solid var(--line);font-size:14px}ul.ev li:first-child{border-top:0}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:340px;overflow:auto;background:var(--bg);padding:10px;border-radius:8px;margin:8px 0 0}
a{color:var(--accent)}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
@media (max-width:560px){form.act{flex-direction:column;align-items:stretch}button{width:100%}}`;

function page({ title, body, nonce, refresh }) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${
        refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''
    }<title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function loginPage(cfg, message) {
    return `<h1>Rescate del servidor</h1><p class="sub">${esc(cfg.domain)}</p>
${message ? `<div class="note warn">${esc(message)}</div>` : ''}
<div class="card"><form method="post" action="/entrar"><label for="clave">Clave de rescate</label>
<input id="clave" name="clave" type="password" autocomplete="current-password" required autofocus>
<button class="main" type="submit">Entrar</button></form>
<p class="det">La clave la creó la instalación. Si la perdiste, por SSH como root: <code>imagina-rescate clave</code></p></div>`;
}

function pendingRequests(cfg) {
    try {
        return readdirSync(join(cfg.state, 'rescue', 'requests')).length;
    } catch {
        return 0;
    }
}

export function statusBody(cfg, sess, query) {
    const now = Date.now();
    const st = readJson(join(cfg.state, 'status.json'));
    const pending = pendingRequests(cfg);
    const asked = ACTIONS.includes(query.get('pedido')) ? query.get('pedido') : null;
    const parts = [];
    parts.push(
        `<div class="top"><div><h1>Rescate del servidor</h1><p class="sub">${esc(cfg.domain)} · ${
            st ? `revisado ${esc(ago(st.updated_at, now))}` : 'el guardián todavía no revisó'
        }${st?.current_release ? ` · versión ${esc(String(st.current_release).replace(/^\d+_/, ''))}` : ''}</p></div>
<form method="post" action="/salir"><input type="hidden" name="t" value="${esc(sess.csrf)}"><button type="submit">Salir</button></form></div>`,
    );
    if (asked || pending) {
        parts.push(
            `<div class="note">${
                pending
                    ? `Pedido enviado: «${esc(ACTION_TEXT[asked]?.[0] ?? 'Reparar ahora')}». El guardián lo hace en unos segundos; esta página se actualiza sola.`
                    : `Listo: el guardián ya atendió «${esc(ACTION_TEXT[asked][0])}». Abajo está lo que hizo.`
            }</div>`,
        );
    }
    if (st && Date.parse(st.updated_at) < now - 3 * 60_000) {
        parts.push(`<div class="note warn">El guardián no revisa desde ${esc(ago(st.updated_at, now))}. Por SSH como root: <code>systemctl status imagina-guardian.timer</code></div>`);
    }
    const rows = CHECKS.map(([key, label]) => {
        let state = 'unknown';
        let detail = '';
        if (st?.checks) {
            if (key === 'disk') {
                const d = st.checks.disk || {};
                state = d.ok ? 'ok' : 'down';
                if (d.free_bytes) detail = `${Math.round(d.free_bytes / 1024 / 1024).toLocaleString('es-CO')} MB libres`;
            } else {
                state = st.checks[key] || 'unknown';
                if (key === 'front' && st.domain) detail = st.domain;
            }
        }
        const [tone, text] = key === 'disk' && state === 'down' ? ['bad', 'Casi lleno'] : STATE_TEXT[state] || STATE_TEXT.unknown;
        return `<div class="row"><div>${esc(label)}${detail ? `<div class="det">${esc(detail)}</div>` : ''}</div><div class="st ${tone}">${esc(text)}</div></div>`;
    }).join('');
    parts.push(`<div class="card"><h2>Lo que ve el guardián</h2>${rows}</div>`);
    const forms = ACTIONS.map((a) => {
        const [label, help] = ACTION_TEXT[a];
        const confirm = a === 'rollback' ? '<label class="chk"><input type="checkbox" name="confirmo" value="si" required> Entiendo: la app vuelve a la versión anterior.</label>' : '';
        return `<form class="act" method="post" action="/accion"><div><strong>${esc(label)}</strong><p>${esc(help)}</p>${confirm}</div>
<input type="hidden" name="t" value="${esc(sess.csrf)}"><input type="hidden" name="que" value="${a}"><button type="submit"${a === 'repair' ? ' class="main"' : ''}>${esc(label)}</button></form>`;
    }).join('');
    parts.push(`<div class="card"><h2>Qué puedes hacer</h2>${forms}</div>`);
    const events = lastLines(join(cfg.state, 'events.jsonl'), 12)
        .reverse()
        .map((l) => {
            try {
                const e = JSON.parse(l);
                return `<li><span class="${e.ok ? 'ok' : 'bad'}">${e.ok ? '✓' : '✗'}</span> ${esc(e.message)} <span class="det">· ${esc(ago(e.at, now))}</span></li>`;
            } catch {
                return '';
            }
        })
        .join('');
    parts.push(`<div class="card"><h2>Lo último que hizo</h2>${events ? `<ul class="ev">${events}</ul>` : '<p class="det">Nada todavía.</p>'}</div>`);
    const log = lastLines(join(cfg.state, 'rescue', 'app-log.txt'), 60).join('\n');
    parts.push(
        `<div class="card"><details><summary><strong>Lo último que dijo la app</strong></summary>${
            log ? `<pre>${esc(log)}</pre>` : '<p class="det">Sin registros.</p>'
        }</details></div>`,
    );
    if (cfg.domain) parts.push(`<p class="det"><a href="https://${esc(cfg.domain)}/">Abrir la app</a></p>`);
    return { body: parts.join('\n'), refresh: pending || asked ? 5 : 30 };
}

// ── servidor ─────────────────────────────────────────────────────────────
function readBody(req, limit = 4096) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error('too_large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
        req.on('error', reject);
    });
}

function audit(cfg, what, ip) {
    // Lo copia el guardián a los eventos que la app avisa por correo.
    try {
        const fd = openSync(join(cfg.state, 'rescue', 'audit.jsonl'), 'a');
        writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), what, ip })}\n`);
        closeSync(fd);
    } catch {
        /* sin auditoría no se frena el rescate */
    }
}

/**
 * Sólo formularios de esta misma página. Con Fetch Metadata manda
 * `Sec-Fetch-Site`; si no, el `Origin` (un navegador puede mandar «null»). Las
 * acciones además piden la cookie (SameSite=Strict) y el token del formulario.
 */
export function sameSite(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    return !origin || origin === 'null' || origin === `https://${req.headers.host}`;
}

export function createHandler(cfg, limiter = createLimiter()) {
    return async function handler(req, res) {
        const nonce = randomBytes(12).toString('base64');
        const send = (status, html, extra = {}) => {
            res.writeHead(status, {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
                'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
                'x-frame-options': 'DENY',
                'x-content-type-options': 'nosniff',
                'referrer-policy': 'same-origin',
                ...extra,
            });
            res.end(html);
        };
        const redirect = (to, extra = {}) => {
            res.writeHead(303, { location: to, 'cache-control': 'no-store', ...extra });
            res.end();
        };
        const url = new URL(req.url || '/', 'https://rescate.invalid');
        const ip = clientIp(req);
        const sess = readSession(cfg.sessionSecret, req);
        try {
            if (req.method === 'POST' && !sameSite(req)) {
                return send(403, page({ title: 'Rescate', nonce, body: '<p>Pedido rechazado: tiene que venir de esta misma página. <a href="/">Volver</a></p>' }));
            }
            if (req.method === 'GET' && url.pathname === '/') {
                if (!sess) return send(200, page({ title: 'Rescate del servidor', nonce, body: loginPage(cfg, url.searchParams.get('salio') ? 'Saliste.' : '') }));
                const { body, refresh } = statusBody(cfg, sess, url.searchParams);
                return send(200, page({ title: 'Rescate del servidor', nonce, body, refresh }));
            }
            if (req.method === 'POST' && url.pathname === '/entrar') {
                if (limiter.blocked(ip)) {
                    return send(429, page({ title: 'Rescate del servidor', nonce, body: loginPage(cfg, 'Demasiados intentos. Espera 15 minutos.') }));
                }
                const form = await readBody(req);
                if (!cfg.passwordHash || !cfg.sessionSecret || !verifyPassword(form.get('clave') || '', cfg.passwordHash)) {
                    if (limiter.fail(ip)) audit(cfg, 'blocked', ip);
                    await new Promise((r) => setTimeout(r, 400));
                    return send(401, page({ title: 'Rescate del servidor', nonce, body: loginPage(cfg, 'La clave no es correcta.') }));
                }
                limiter.ok(ip);
                audit(cfg, 'login', ip);
                return redirect('/', {
                    'set-cookie': `ib_rescate=${makeSession(cfg.sessionSecret)}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`,
                });
            }
            if (req.method === 'POST' && url.pathname === '/salir') {
                const form = await readBody(req);
                if (!sess || !sameToken(form.get('t'), sess.csrf)) return redirect('/');
                return redirect('/?salio=1', { 'set-cookie': 'ib_rescate=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });
            }
            if (req.method === 'POST' && url.pathname === '/accion') {
                if (!sess) return redirect('/');
                const form = await readBody(req);
                const que = form.get('que') || '';
                if (!sameToken(form.get('t'), sess.csrf) || !ACTIONS.includes(que)) {
                    return send(400, page({ title: 'Rescate', nonce, body: '<p>Pedido no válido. <a href="/">Volver</a></p>' }));
                }
                if (que === 'rollback' && form.get('confirmo') !== 'si') return redirect('/');
                const fd = openSync(join(cfg.state, 'rescue', 'requests', `${que}-${Date.now()}`), 'wx', 0o600);
                closeSync(fd);
                return redirect(`/?pedido=${que}`);
            }
            return send(404, page({ title: 'Rescate', nonce, body: '<p>No existe. <a href="/">Volver</a></p>' }));
        } catch (err) {
            if (!res.headersSent) send(500, page({ title: 'Rescate', nonce, body: `<p>Algo falló: ${esc(err?.message || err)}. <a href="/">Volver</a></p>` }));
        }
    };
}

function dropPrivileges(cfg) {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
    if (!cfg.user || cfg.user === 'root') {
        if (process.env.RESCUE_ALLOW_ROOT === '1') return;
        console.error('La página de rescate no corre como root: falta USER en la configuración.');
        process.exit(1);
    }
    process.setgroups([]);
    process.setgid(cfg.group);
    process.setuid(cfg.user);
    if (process.getuid() === 0) {
        console.error('No se pudo dejar de ser root.');
        process.exit(1);
    }
}

function serve() {
    const cfg = loadConfig();
    if (!cfg.cert || !cfg.key) {
        console.error('Falta el certificado (rescue-tls.conf). Lo escribe el guardián en su próxima revisión.');
        process.exit(1);
    }
    const server = createServer({ cert: readFileSync(cfg.cert), key: readFileSync(cfg.key), minVersion: 'TLSv1.2' }, createHandler(cfg));
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    server.maxConnections = 64;
    const started = () => {
        dropPrivileges(cfg);
        console.log(`Página de rescate en el puerto ${server.address().port} (certificado: ${cfg.certKind}).`);
    };
    server.once('error', (err) => {
        if (err.code === 'EAFNOSUPPORT' && cfg.bind === '::') server.listen(cfg.port, '0.0.0.0', started);
        else {
            console.error(err.message);
            process.exit(1);
        }
    });
    server.listen(cfg.port, cfg.bind, started);
}

function isMain() {
    try {
        return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
    } catch {
        return false;
    }
}

if (isMain()) {
    const cmd = process.argv[2] || 'serve';
    if (cmd === 'hash') {
        const pass = readFileSync(0, 'utf8').trim();
        if (pass.length < 12) {
            console.error('La clave tiene que tener al menos 12 caracteres.');
            process.exit(1);
        }
        process.stdout.write(`${hashPassword(pass)}\n`);
    } else if (cmd === 'serve') {
        serve();
    } else {
        console.error('Uso: imagina-rescue.mjs [serve|hash]');
        process.exit(2);
    }
}

// Para las pruebas.
export const _internal = { loadConfig, readSession, makeSession };
