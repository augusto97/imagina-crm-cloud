import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PublicWidgetMeta } from '@imagina-base/shared';
import { escapeHtml, formFrameAncestors } from '../forms/form-page';

/**
 * v0.1.394 (ADR-S99) — La página del widget de contacto
 * (`/api/v1/public/w/:token`). El sitio de la empresa la carga en UN marco
 * que `embed.js` acomoda en la esquina: el botón, el menú y el panel viven
 * aquí, con NUESTRA CSP, así el widget se ve igual en cualquier sitio (sus
 * estilos no pueden romperlo, y una CSP estricta del sitio no lo bloquea). Un
 * formulario o la agenda se abren en un marco anidado (`frame-src 'self'`).
 *
 * El HTML es igual para todas las visitas: se arma una vez, se comprime una
 * vez y se guarda (ADR-S95); la CSP autoriza el script en línea por su hash.
 * El cliente es `apps/web/app/public-widget/main.ts`, compilado aparte a
 * `widget.js` y servido EN LÍNEA.
 */

/** `<script type="application/json">` seguro: nada puede cerrar la etiqueta. */
function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function widgetPageCsp(scriptToken: string, allowedDomains: string[], opts: { dev?: boolean } = {}): string {
    return [
        "default-src 'none'",
        ['script-src', ...(opts.dev ? ["'self'"] : []), ...(scriptToken ? [scriptToken] : [])].join(' '),
        "style-src 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
        // El formulario y la agenda se abren aquí adentro.
        "frame-src 'self'",
        "form-action 'none'",
        "base-uri 'none'",
        `frame-ancestors ${formFrameAncestors(allowedDomains)}`,
    ].join('; ');
}

/**
 * Los estilos del widget. Fijos (no dependen de la empresa): el color va en
 * variables (`--w-accent`, `--w-ink`) que pone el cliente. `color-scheme:
 * light` a propósito: si el marco declarara otro esquema que el sitio, el
 * navegador le pintaría un fondo opaco y el widget dejaría de verse
 * transparente.
 */
export const WIDGET_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;color-scheme:light;overflow:hidden}
body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2330;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit}
a{color:inherit}
.w-root{position:fixed;bottom:28px;right:28px;display:flex;flex-direction:column;align-items:flex-end;gap:14px}
.w-root.w-left{right:auto;left:28px;align-items:flex-start}
.w-hidden{display:none!important}
.w-launcher{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:58px;min-width:58px;padding:0 17px;border:0;border-radius:999px;background:var(--w-accent);color:var(--w-ink);cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,.26),0 2px 5px rgba(15,23,42,.12);transition:transform .16s ease,box-shadow .16s ease;font-weight:600;font-size:15px}
.w-launcher:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 9px 22px rgba(15,23,42,.30),0 2px 5px rgba(15,23,42,.12)}
.w-launcher:focus-visible,.w-mi-btn:focus-visible,.w-opt:focus-visible,.w-x:focus-visible,.w-bar a:focus-visible,.w-bar button:focus-visible{outline:3px solid color-mix(in srgb,var(--w-accent) 45%,#fff);outline-offset:2px}
.w-launcher svg{width:26px;height:26px;flex:none}
.w-launcher.w-icon-only{padding:0;width:58px}
.w-launcher .w-l-close{display:none}
.w-open .w-launcher .w-l-icon{display:none}
.w-open .w-launcher .w-l-close{display:block}
.w-open .w-launcher .w-l-text{display:none}
.w-open .w-launcher{padding:0;width:58px}
.w-menu{display:flex;flex-direction:column;align-items:flex-end;gap:10px;margin:0;padding:0;list-style:none}
.w-left .w-menu{align-items:flex-start}
.w-mi{display:flex;align-items:center;gap:10px;animation:w-pop .18s ease both}
.w-left .w-mi{flex-direction:row-reverse}
.w-mi-label{background:#fff;color:#1d2330;padding:7px 12px;border-radius:10px;box-shadow:0 4px 14px rgba(15,23,42,.16);font-weight:600;font-size:13.5px;white-space:nowrap}
.w-mi-btn{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:999px;border:0;background:var(--b-color);color:var(--b-ink);box-shadow:0 6px 18px rgba(15,23,42,.24);cursor:pointer;text-decoration:none;flex:none;transition:transform .14s}
.w-mi-btn:hover{transform:scale(1.06)}
.w-mi-btn svg{width:23px;height:23px}
.w-panel{width:372px;height:auto;max-height:var(--w-ph,600px);background:#fff;border-radius:20px;box-shadow:0 10px 26px rgba(15,23,42,.22),0 2px 8px rgba(15,23,42,.10);display:flex;flex-direction:column;overflow:hidden;animation:w-rise .2s ease both}
.w-panel.w-viewing{height:var(--w-ph,600px)}
.w-head{position:relative;background:var(--w-accent);color:var(--w-ink);padding:20px 54px 14px 20px;flex:none}
.w-head::after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,0) 60%);pointer-events:none}
.w-brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.w-logo{height:34px;max-width:140px;border-radius:9px;background:#fff;padding:3px 6px;object-fit:contain}
.w-company{font-weight:600;font-size:13px;opacity:.9}
.w-title{margin:0;font-size:20px;line-height:1.25;font-weight:700;letter-spacing:-.01em}
.w-sub{margin:6px 0 0;font-size:14px;opacity:.88}
.w-status{display:inline-flex;align-items:center;gap:7px;margin-top:10px;font-size:12.5px;font-weight:600;opacity:.92}
.w-dot{width:8px;height:8px;border-radius:999px;background:#98a2b3;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
.w-dot.w-on{background:#22c55e}
.w-closed{position:relative;z-index:2;margin:0 0 9px;padding:11px 13px;background:#fff8e6;border:1px solid #f6e3b4;border-radius:12px;color:#5b4512;font-size:13.5px;line-height:1.4}
.w-closed p{margin:0}
.w-closed .w-closed-when{margin-top:4px;font-weight:650}
[hidden]{display:none!important}
.w-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:999px;background:rgba(255,255,255,.18);color:inherit;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:1}
.w-x:hover{background:rgba(255,255,255,.28)}
.w-x svg{width:18px;height:18px}
.w-body{flex:1;min-height:0;overflow-y:auto;padding:0 14px 14px;background:linear-gradient(var(--w-accent) 0,var(--w-accent) 30px,#f6f7f9 30px) local;-webkit-overflow-scrolling:touch}
.w-opts{display:flex;flex-direction:column;gap:9px;position:relative;z-index:2}
.w-opt{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;background:#fff;border:1px solid #eceef2;border-radius:14px;text-align:left;cursor:pointer;text-decoration:none;color:#1d2330;box-shadow:0 2px 8px rgba(15,23,42,.06);transition:transform .12s,box-shadow .12s,border-color .12s}
.w-opt:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(15,23,42,.10);border-color:#e1e4ea}
.w-opt-ic{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;background:var(--b-color);color:var(--b-ink);flex:none}
.w-opt-ic svg{width:22px;height:22px}
.w-opt-txt{flex:1;min-width:0}
.w-opt-label{display:block;font-weight:650;font-size:15px;line-height:1.25}
.w-opt-desc{display:block;color:#667085;font-size:13px;margin-top:2px}
.w-opt-go{color:#98a2b3;flex:none}
.w-opt-go svg{width:18px;height:18px}
.w-view-head{display:flex;align-items:center;gap:6px;padding:10px 10px 10px 8px;background:var(--w-accent);color:var(--w-ink);flex:none}
.w-view-head .w-x{position:static;background:transparent}
.w-view-head .w-x:hover{background:rgba(255,255,255,.18)}
.w-view-title{flex:1;min-width:0;font-weight:650;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.w-frame-wrap{flex:1;min-height:0;position:relative;background:#fff}
.w-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#fff}
.w-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#98a2b3}
.w-spin{width:26px;height:26px;border-radius:999px;border:3px solid #e4e7ec;border-top-color:var(--w-accent);animation:w-rot .8s linear infinite}
.w-note{margin:12px 2px 0;font-size:12px;color:#667085;text-align:center}
.w-full .w-root{inset:0;bottom:0;right:0;left:0;gap:0}
.w-full .w-panel{width:100%;height:100%;max-height:100%;border-radius:0;box-shadow:none;animation:none}
.w-full .w-launcher{display:none}
.w-bar{position:fixed;left:0;right:0;bottom:0;display:flex;background:#fff;border-top:1px solid #e4e7ec;box-shadow:0 -6px 18px rgba(15,23,42,.08);padding-bottom:env(safe-area-inset-bottom)}
.w-bar a,.w-bar button{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;height:60px;border:0;background:transparent;color:#1d2330;text-decoration:none;font-size:12px;font-weight:600;cursor:pointer;padding:0 4px}
.w-bar a+a,.w-bar a+button,.w-bar button+a,.w-bar button+button{border-left:1px solid #f0f1f4}
.w-bar .w-bar-ic{display:inline-flex;color:var(--b-color)}
.w-bar svg{width:22px;height:22px}
.w-bar span{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.w-preview-note{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#101828;color:#fff;font-size:13px;padding:9px 14px;border-radius:10px;max-width:min(360px,90vw);box-shadow:0 10px 30px rgba(15,23,42,.3);animation:w-pop .18s ease both}
@keyframes w-pop{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes w-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes w-rot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.w-mi,.w-panel,.w-preview-note{animation:none}.w-launcher,.w-opt,.w-mi-btn{transition:none}}
`;

interface WidgetPageOpts {
    /** Con nonce: la vista previa (se arma en cada pedido). Sin nonce: la página cacheable. */
    nonce?: string;
    title: string;
    /** null = vista previa del editor (el diseño llega por postMessage). */
    meta: PublicWidgetMeta | null;
    /** El script compilado (`widget.js`); null = desarrollo (módulo de vite). */
    client: string | null;
}

export function renderWidgetPage(opts: WidgetPageOpts): string {
    const boot = jsonForScript({ preview: opts.meta === null, meta: opts.meta });
    const nonce = opts.nonce ? ` nonce="${opts.nonce}"` : '';
    const client = opts.client
        ? `<script${nonce}>${opts.client.replace(/<\/script/gi, '<\\/script')}</script>`
        : `<script type="module"${nonce} src="/app/public-widget/main.ts"></script>`;
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(opts.title)}</title>
<style>${WIDGET_CSS}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="boot">${boot}</script>
${client}
</body>
</html>`;
}

function clientCandidates(webDistDir: string): string[] {
    const entry = path.join('public-widget', 'widget.js');
    const out: string[] = [];
    if (webDistDir.trim() !== '') out.push(path.resolve(webDistDir, entry));
    out.push(
        path.resolve(__dirname, '../../../../web', entry),
        path.resolve(process.cwd(), '../../web', entry),
        path.resolve(__dirname, '../../../web/dist-cloud', entry),
        path.resolve(process.cwd(), '../web/dist-cloud', entry),
    );
    return out;
}

let clientCache: string | null = null;

/** El script compilado del widget (cambia sólo con un release, que reinicia el proceso). */
export function loadWidgetClient(webDistDir: string): string | null {
    if (clientCache !== null) return clientCache;
    for (const file of clientCandidates(webDistDir)) {
        if (!existsSync(file)) continue;
        try {
            clientCache = readFileSync(file, 'utf8');
            return clientCache;
        } catch {
            // ilegible: el siguiente
        }
    }
    return null;
}

/** Sólo para tests. */
export function resetWidgetClientCache(): void {
    clientCache = null;
}

export function widgetMissingPage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="robots" content="noindex" /><title>No disponible</title><style>html,body{margin:0;background:transparent}</style></head><body></body></html>`;
}
