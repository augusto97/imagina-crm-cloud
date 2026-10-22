import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { frameAncestors } from '../public-lists/public-page';

/**
 * v0.1.292 (ADR-S50) — La página pública de un tablero.
 *
 * Es un entry propio del build del front (`cloud-public/index.html`: dibuja
 * los widgets con los MISMOS componentes de la app, sin el resto de la app y
 * sin el guard anti-encuadre). La sirve el API en `/api/v1/public/d/:token`
 * —no el proxy— por una razón: la cabecera `frame-ancestors` depende de los
 * dominios que eligió quien publicó, y eso sólo lo sabe el API. Los assets
 * (`/assets/*.js`) los sigue sirviendo el proxy como los de la app.
 *
 * Dónde está el HTML: `WEB_DIST_DIR` si se definió; si no, `<release>/web`
 * (layout de releases: el API corre desde `<release>/apps/api`) o
 * `apps/web/dist-cloud` (el repo). En desarrollo sin `WEB_DIST_DIR` se sirve
 * una página que carga los módulos de vite (el dev server proxya `/api`).
 */

const ENTRY = path.join('cloud-public', 'index.html');

export function publicPageCandidates(webDistDir: string): string[] {
    const out: string[] = [];
    if (webDistDir.trim() !== '') out.push(path.resolve(webDistDir, ENTRY));
    out.push(
        // <release>/apps/api/dist/dashboard-sharing → <release>/web
        path.resolve(__dirname, '../../../../web', ENTRY),
        path.resolve(process.cwd(), '../../web', ENTRY),
        // repo: apps/api/{src,dist}/dashboard-sharing → apps/web/dist-cloud
        path.resolve(__dirname, '../../../web/dist-cloud', ENTRY),
        path.resolve(process.cwd(), '../web/dist-cloud', ENTRY),
    );
    return out;
}

let cached: { file: string; html: string } | null = null;

/** El HTML del build (cacheado: cambia sólo con un release, que reinicia el proceso). */
export function loadBuiltPublicPage(webDistDir: string): string | null {
    if (cached) return cached.html;
    for (const file of publicPageCandidates(webDistDir)) {
        if (!existsSync(file)) continue;
        try {
            const html = readFileSync(file, 'utf8');
            cached = { file, html };
            return html;
        } catch {
            // ilegible: probar el siguiente
        }
    }
    return null;
}

/** Sólo para tests. */
export function resetPublicPageCache(): void {
    cached = null;
}

/** CSP de la página construida: sólo scripts del propio origen; encuadre según los dominios. */
export function publicDashboardCsp(domains: string[], opts: { nonce?: string; dev?: boolean } = {}): string {
    const script = opts.dev ? `'self' 'nonce-${opts.nonce ?? ''}'` : "'self'";
    return [
        "default-src 'self'",
        `script-src ${script}`,
        // Igual que la app: React escribe `style=""` en los widgets (anchos,
        // colores de las opciones) y un estilo no ejecuta nada.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        opts.dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        frameAncestors(domains),
    ].join('; ');
}

/** Desarrollo: la página carga el entry de vite (con el preámbulo de React Refresh). */
export function devPublicPage(nonce: string): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Tablero</title>
<script type="module" nonce="${nonce}">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(t)=>t;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module" src="/@vite/client"></script>
</head><body><div id="root"></div><script type="module" src="/app/public-dashboard/main.tsx"></script></body></html>`;
}

/** Producción sin el build del front (instalación rota): un aviso, no un 500. */
export function missingBuildPage(): string {
    return page('Tablero no disponible', 'Este servidor no tiene la página pública de los tableros. Si eres quien administra la instalación, actualiza a la última versión.');
}

/** Desconocido, despublicado, vencido o sin acceso: sin decir cuál (no se confirma nada). */
export function unavailableDashboardPage(): string {
    return page('Este tablero no está disponible', 'Puede que la dirección esté mal escrita, que ya no se publique o que el enlace haya vencido.');
}

function page(title: string, text: string): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${title}</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}@media (prefers-color-scheme: dark){body{background:#0f1420;color:#e6e9ef}p{color:#9aa3b2}}</style></head>
<body><div><h1>${title}</h1><p>${text}</p></div></body></html>`;
}
