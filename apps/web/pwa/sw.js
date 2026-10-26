/* eslint-disable */
/**
 * Imagina Base — service worker (H1: app instalable + notificaciones push).
 *
 * Lo emite el build (`vite.cloud.config.ts`, plugin `imagina-service-worker`)
 * en la raíz del sitio (`/sw.js`, alcance `/`) reemplazando __BUILD_ID__: cada
 * despliegue trae un service worker NUEVO, que al activarse borra el caché de
 * la versión anterior.
 *
 * Reglas (no hay modo offline completo — eso es otra idea, H2):
 *  - El HTML (navegaciones) va SIEMPRE primero a la red, revalidando el caché
 *    HTTP: un despliegue nunca deja la app vieja pegada. Sin red, una pantalla
 *    «Sin conexión» con «Reintentar».
 *  - Los assets con hash (`/assets/*`) salen del caché: su nombre cambia con
 *    su contenido, así que nunca quedan viejos.
 *  - La API, el realtime y lo demás NUNCA se tocan (ni se cachean).
 */
const BUILD = '__BUILD_ID__';
const ASSETS_CACHE = 'imcrm-assets-' + BUILD;

self.addEventListener('install', () => {
    // La versión nueva entra apenas se instala: la página ya cargó su HTML
    // fresco (red primero) y los chunks viejos que pida una pestaña abierta
    // caen al aviso de chunk faltante, que recarga una vez.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith('imcrm-') && k !== ASSETS_CACHE).map((k) => caches.delete(k)));
            await self.clients.claim();
        })(),
    );
});

function isBypassed(url) {
    const p = url.pathname;
    return p.startsWith('/api/') || p.startsWith('/socket.io/') || p.startsWith('/.well-known/') || p === '/sw.js';
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    let url;
    try {
        url = new URL(req.url);
    } catch (e) {
        return;
    }
    if (url.origin !== self.location.origin || isBypassed(url)) return;
    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req, url));
        return;
    }
    if (url.pathname.startsWith('/assets/') && !req.headers.has('range')) {
        event.respondWith(cacheFirst(req));
    }
});

async function networkFirst(req, url) {
    let fresh = req;
    try {
        // `no-cache`: revalida contra el servidor (304 si no cambió) aunque el
        // proxy no mande cabeceras de caché para el HTML.
        fresh = new Request(req, { cache: 'no-cache' });
    } catch (e) {
        fresh = req;
    }
    try {
        return await fetch(fresh);
    } catch (e) {
        return offlineResponse(url);
    }
}

async function cacheFirst(req) {
    const cache = await caches.open(ASSETS_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => undefined);
    }
    return res;
}

/** Pantalla «Sin conexión»: sin scripts (no hay CSP que la cubra) y sin marca. */
function offlineResponse(url) {
    const retry = url.pathname + url.search + url.hash;
    const html =
        '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
        '<title>Sin conexión</title><style>' +
        ':root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#14171f;--muted:#5c6370;--accent:#0c7e97;--border:#e3e6eb}' +
        '@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#171717;--fg:#ececec;--muted:#a1a1a1;--accent:#3fb6cf;--border:#2b2b2b}}' +
        'html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--fg);' +
        'font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
        '.card{max-width:360px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px 24px;text-align:center}' +
        'h1{font-size:18px;margin:12px 0 6px}p{margin:0 0 20px;color:var(--muted)}' +
        'a{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px}' +
        'svg{color:var(--muted)}</style></head><body><main class="card" data-imcrm-offline="1">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M19 12.9a10 10 0 0 0-2.3-1.6"/>' +
        '<path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8a15 15 0 0 0-11.3-3.7"/><path d="m2 2 20 20"/></svg>' +
        '<h1>Sin conexión</h1><p>No pudimos llegar al servidor. Revisa tu conexión a internet y vuelve a intentarlo.</p>' +
        '<a href="' +
        escapeAttr(retry) +
        '">Reintentar</a></main></body></html>';
    return new Response(html, {
        status: 503,
        statusText: 'Sin conexión',
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────── Notificaciones push ───────────────────────────

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: event.data ? event.data.text() : '' };
    }
    const title = (data && data.title) || 'Tienes un aviso nuevo';
    const options = {
        body: (data && data.body) || '',
        tag: (data && data.tag) || undefined,
        renotify: Boolean(data && data.tag),
        icon: '/pwa/icon-192.png',
        badge: '/pwa/badge-72.png',
        lang: 'es',
        timestamp: (data && data.ts) || Date.now(),
        data: { url: (data && data.url) || '/', tenant_id: (data && data.tenant_id) || null },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const d = event.notification.data || {};
    event.waitUntil(openOrFocus(d.url, d.tenant_id));
});

/**
 * Abre la URL del aviso ENFOCANDO una pestaña de la app que ya esté abierta
 * (la app navega sola y, si el aviso es de otra empresa, cambia de empresa).
 * Si no hay ninguna, abre una ventana nueva; `?t=` le dice a la app en qué
 * empresa arrancar.
 */
async function openOrFocus(rawUrl, tenantId) {
    let target;
    try {
        target = new URL(rawUrl || '/', self.location.origin);
    } catch (e) {
        target = new URL('/', self.location.origin);
    }
    if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
    const path = target.pathname + target.search + target.hash;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.filter((c) => {
        try {
            return !new URL(c.url).pathname.startsWith('/portal');
        } catch (e) {
            return false;
        }
    });
    const pick = app.find((c) => c.focused) || app.find((c) => c.visibilityState === 'visible') || app[0];
    if (pick) {
        try {
            await pick.focus();
        } catch (e) {
            /* sin permiso para enfocar: igual navega */
        }
        pick.postMessage({ type: 'imcrm:open', url: path, tenant_id: tenantId || null });
        return;
    }
    if (tenantId) target.searchParams.set('t', String(tenantId));
    await self.clients.openWindow(target.pathname + target.search + target.hash);
}
