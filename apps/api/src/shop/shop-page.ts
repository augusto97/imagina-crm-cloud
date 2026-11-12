import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PublicShopMeta, PublicShopProduct } from '@imagina-base/shared';
import { directTagsHash, directTagsScriptText } from '../forms/direct-tags';
import { escapeHtml, formFrameAncestors, inlineScriptText, type PageCspTags } from '../forms/form-page';

/**
 * v0.1.412 (ADR-S103) — La página pública de la tienda
 * (`/api/v1/public/s/:token`). El HTML es IGUAL para todas las visitas
 * (catálogo incluido): se arma una vez, se comprime una vez y se sirve desde
 * memoria (ADR-S95); la CSP autoriza el script en línea por su hash. El
 * sello anti-robots se pide aparte al empezar a comprar. Nunca se indexa
 * (decisión del usuario: la tienda no sale en Google por ahora).
 *
 * El cliente es `apps/web/app/public-shop/main.ts`, compilado aparte a
 * `shop.js` y servido EN LÍNEA. Todo lo de la empresa se arma con
 * `textContent`: ningún texto llega como HTML.
 */

function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export interface ShopCspOpts {
    dev?: boolean;
    /** La vista previa del editor: las fotos por enlace se ven directo. */
    preview?: boolean;
    captchaScript?: string[];
    captchaFrame?: string[];
    captchaConnect?: string[];
    /**
     * v0.1.418 — Las etiquetas del ENLACE DIRECTO (Google y Meta): sus
     * dominios entran a la CSP y lo propio queda limitado a la ruta pública
     * de este origen (como formularios y agenda, ADR-S97).
     */
    tags?: PageCspTags | null;
}

export function shopPageCsp(scriptToken: string, allowedDomains: string[], opts: ShopCspOpts = {}): string {
    const t = opts.tags ?? null;
    const own = t && t.origin && !opts.dev ? `${t.origin}/api/v1/public/` : "'self'";
    const frames = [...(opts.captchaFrame ?? []), ...(t?.csp.frame ?? [])];
    return [
        "default-src 'none'",
        ['script-src', ...(opts.dev ? ["'self'"] : []), ...(scriptToken ? [scriptToken] : []), ...(t ? [`'${directTagsHash()}'`] : []), ...(opts.captchaScript ?? []), ...(t?.csp.script ?? [])].join(' '),
        "style-src 'unsafe-inline'",
        ['img-src', "'self'", 'data:', 'blob:', ...(opts.preview ? ['https:'] : []), ...(t?.csp.img ?? [])].join(' '),
        "font-src 'self'",
        ['connect-src', own, ...(opts.dev ? ['ws:', 'wss:'] : []), ...(opts.captchaConnect ?? []), ...(t?.csp.connect ?? [])].join(' '),
        ...(frames.length > 0 ? [`frame-src ${frames.join(' ')}`] : []),
        t ? ['form-action', own, ...t.csp.formAction].join(' ') : "form-action 'none'",
        ...(t ? ["worker-src 'none'"] : []),
        "base-uri 'none'",
        `frame-ancestors ${opts.preview ? "'self'" : formFrameAncestors(allowedDomains)}`,
    ].join('; ');
}

/** Los estilos de la tienda. El color va en `--s-accent` / `--s-ink` (los pone el cliente). */
export const SHOP_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{--s-accent:#0e7490;--s-ink:#fff;--s-text:#111827;--s-muted:#6b7280;--s-line:#e8eaee;--s-bg:#f6f7f9;--s-card:#fff;--s-radius:14px;--s-cols:3}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--s-bg);color:var(--s-text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
a{color:var(--s-accent)}
img{display:block;max-width:100%}
[hidden]{display:none!important}
.s-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.s-top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--s-line)}
.s-top-in{max-width:1180px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:14px;min-height:64px}
.s-brand{display:flex;align-items:center;gap:10px;min-width:0;flex:1;text-decoration:none;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left}
.s-logo{height:38px;max-width:150px;object-fit:contain}
.s-name{font-weight:700;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-cart-btn{position:relative;display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 16px;border-radius:999px;border:0;background:var(--s-accent);color:var(--s-ink);font-weight:650;cursor:pointer;flex:none;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.s-cart-btn svg{width:20px;height:20px}
.s-badge{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--s-ink);color:var(--s-accent);font-size:12px;font-weight:700}
.s-wrap{max-width:1180px;margin:0 auto;padding:0 20px 56px}
.s-hero{padding:34px 0 18px}
.s-hero h1{margin:0;font-size:clamp(26px,4vw,38px);line-height:1.15;letter-spacing:-.02em}
.s-hero p{margin:10px 0 0;color:var(--s-muted);max-width:720px;white-space:pre-line}
.s-closed{margin:0 0 18px;padding:12px 16px;border-radius:12px;background:#fff8e6;border:1px solid #f6e3b4;color:#5b4512}
.s-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:8px 0 20px}
.s-search{flex:1;min-width:220px;position:relative}
.s-search input{width:100%;height:44px;border-radius:12px;border:1px solid var(--s-line);background:#fff;padding:0 14px 0 40px;outline:none}
.s-search input:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-search svg{position:absolute;left:13px;top:12px;width:20px;height:20px;color:var(--s-muted)}
.s-sort{height:44px;border-radius:12px;border:1px solid var(--s-line);background:#fff;padding:0 12px}
.s-cats{display:flex;gap:8px;overflow-x:auto;padding:2px 0 4px;margin:0 0 16px;scrollbar-width:none}
.s-cats::-webkit-scrollbar{display:none}
.s-chip{flex:none;height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--s-line);background:#fff;cursor:pointer;font-weight:550;font-size:14px;white-space:nowrap}
.s-chip[aria-pressed="true"]{background:var(--s-text);color:#fff;border-color:var(--s-text)}
.s-grid{display:grid;grid-template-columns:repeat(var(--s-cols),minmax(0,1fr));gap:18px}
@media (max-width:900px){.s-grid{grid-template-columns:repeat(min(var(--s-cols),3),minmax(0,1fr))}}
@media (max-width:640px){.s-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.s-wrap,.s-top-in{padding-left:14px;padding-right:14px}}
.s-card{display:flex;flex-direction:column;background:var(--s-card);border-radius:var(--s-radius);border:1px solid var(--s-line);overflow:hidden;transition:box-shadow .15s,transform .15s}
.s-card:hover{box-shadow:0 10px 30px rgba(15,23,42,.10);transform:translateY(-2px)}
.s-card.s-out{opacity:.62}
.s-media{position:relative;display:block;width:100%;padding:0;border:0;background:#f1f3f6;cursor:pointer;aspect-ratio:1/1;overflow:hidden}
.s-portrait .s-media{aspect-ratio:4/5}
.s-landscape .s-media{aspect-ratio:4/3}
.s-media img{width:100%;height:100%;object-fit:cover}
.s-contain .s-media img{object-fit:contain;padding:8px}
.s-noimg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#c3c8d1}
.s-noimg svg{width:44px;height:44px}
.s-tag{position:absolute;left:10px;top:10px;padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700;background:#fff;color:var(--s-text);box-shadow:0 2px 8px rgba(15,23,42,.12)}
.s-tag.s-sale{background:#dc2626;color:#fff}
.s-kind{position:absolute;left:10px;bottom:10px;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:rgba(255,255,255,.95);color:#374151;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.s-kind svg{width:13px;height:13px}
.s-kind-note{display:flex;align-items:flex-start;gap:8px;margin:12px 0 0;font-size:13.5px;color:#4b5563}
.s-kind-note svg{width:17px;height:17px;flex:none;margin-top:1px;color:var(--s-accent)}
.s-kind-box{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--s-line);background:#fff;font-size:14px;color:#374151}
.s-kind-box svg{width:19px;height:19px;flex:none;color:var(--s-accent);margin-top:1px}
a.s-add{display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
.s-add svg{width:17px;height:17px}
.s-my-btn{display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 14px;border-radius:999px;border:1px solid var(--s-line);background:#fff;color:var(--s-text);font-weight:600;cursor:pointer;flex:none}
.s-my-btn svg{width:19px;height:19px}
@media (max-width:640px){.s-my-btn{padding:0 11px}.s-my-btn .s-my-l{display:none}}
.s-dl{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--s-line)}
.s-dl:last-child{border-bottom:0;padding-bottom:0}
.s-dl-ic{flex:none;width:38px;height:38px;border-radius:10px;background:#f5f3ff;color:#6d28d9;display:flex;align-items:center;justify-content:center}
.s-dl-ic svg{width:20px;height:20px}
.s-dl-t{flex:1;min-width:0}
.s-dl-n{font-weight:650;overflow-wrap:anywhere;line-height:1.3}
.s-dl-m{font-size:12.5px;color:var(--s-muted)}
.s-dl-go{flex:none;display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:10px;background:var(--s-accent);color:var(--s-ink);font-weight:650;font-size:14px;text-decoration:none}
.s-dl-go svg{width:16px;height:16px}
.s-dl-off{flex:none;font-size:12.5px;color:var(--s-muted);font-weight:600}
.s-myo{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px}
.s-myo-t{flex:1;min-width:200px}
.s-myo-n{font-weight:700}
.s-myo-m{font-size:13px;color:var(--s-muted);margin-top:2px}
.s-body{display:flex;flex-direction:column;gap:6px;padding:12px 14px 14px;flex:1}
.s-title{margin:0;font-size:15px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;background:none;border:0;padding:0;text-align:left}
.s-sku{font-size:12px;color:var(--s-muted)}
.s-price{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:auto}
.s-now{font-weight:750;font-size:17px}
.s-was{color:var(--s-muted);text-decoration:line-through;font-size:13.5px}
.s-stock{font-size:12.5px;color:#b45309;font-weight:600}
.s-cad{font-size:12.5px;color:var(--s-muted);margin-top:-2px}
.s-d-price+.s-cad{margin-top:4px;font-size:13.5px}
.s-add{margin-top:8px;height:40px;border-radius:10px;border:0;background:var(--s-accent);color:var(--s-ink);font-weight:650;cursor:pointer}
.s-add:disabled{background:#e5e7eb;color:#6b7280;cursor:not-allowed}
.s-step{display:flex;align-items:center;justify-content:space-between;margin-top:8px;height:40px;border-radius:10px;border:1px solid var(--s-line);background:#fff;overflow:hidden}
.s-step button{width:42px;height:100%;border:0;background:transparent;font-size:19px;cursor:pointer}
.s-step button:disabled{opacity:.35;cursor:not-allowed}
.s-step span{font-weight:700;min-width:28px;text-align:center}
.s-empty{padding:60px 0;text-align:center;color:var(--s-muted)}
.s-more{margin:18px 0 0;font-size:13px;color:var(--s-muted);text-align:center}
.s-foot{border-top:1px solid var(--s-line);background:#fff}
.s-foot-in{max-width:1180px;margin:0 auto;padding:28px 20px 40px;display:grid;grid-template-columns:2fr 1fr;gap:20px;font-size:13.5px;color:var(--s-muted)}
@media (max-width:640px){.s-foot-in{grid-template-columns:1fr;padding:24px 14px 96px}}
.s-foot strong{color:var(--s-text)}
.s-foot-in.s-pixels-note{display:block;padding-top:0;margin-top:-24px;font-size:12px}
.s-links{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.s-link{background:none;border:0;padding:0;color:var(--s-accent);cursor:pointer;font-weight:550;text-align:left}
.s-veil{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:40;animation:s-fade .16s ease both}
.s-sheet{position:fixed;z-index:41;background:#fff;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(15,23,42,.28)}
.s-drawer{top:0;right:0;bottom:0;width:min(440px,100%);animation:s-slide .2s ease both}
.s-modal{top:50%;left:50%;transform:translate(-50%,-50%);width:min(940px,calc(100% - 32px));max-height:calc(100% - 48px);border-radius:18px;overflow:hidden;animation:s-pop .18s ease both}
.s-modal.s-narrow{width:min(620px,calc(100% - 32px))}
@media (max-width:640px){.s-modal{top:auto;bottom:0;left:0;transform:none;width:100%;max-height:92%;border-radius:18px 18px 0 0;animation:s-up .2s ease both}.s-drawer{width:100%}}
.s-sh{display:flex;align-items:center;gap:10px;padding:14px 16px 14px 20px;border-bottom:1px solid var(--s-line);flex:none}
.s-sh h2{margin:0;font-size:17px;flex:1;min-width:0}
.s-x{width:38px;height:38px;border-radius:999px;border:0;background:#f3f4f6;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.s-x svg{width:18px;height:18px}
.s-back{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:6px 8px 6px 0;cursor:pointer;color:var(--s-muted);font-weight:600}
.s-back svg{width:18px;height:18px}
.s-sb{flex:1;min-height:0;overflow-y:auto;padding:16px 20px;-webkit-overflow-scrolling:touch}
.s-sf{flex:none;padding:14px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--s-line);background:#fff}
.s-detail{display:grid;grid-template-columns:1.1fr 1fr;gap:26px}
@media (max-width:760px){.s-detail{grid-template-columns:1fr;gap:16px}}
.s-gal-main{aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:#f1f3f6}
.s-gal-main img{width:100%;height:100%;object-fit:contain}
.s-thumbs{display:flex;gap:8px;margin-top:10px;overflow-x:auto}
.s-thumb{flex:none;width:62px;height:62px;border-radius:10px;overflow:hidden;border:2px solid transparent;padding:0;background:#f1f3f6;cursor:pointer}
.s-thumb[aria-pressed="true"]{border-color:var(--s-accent)}
.s-thumb img{width:100%;height:100%;object-fit:cover}
.s-d-title{margin:0 0 6px;font-size:24px;line-height:1.2;letter-spacing:-.01em}
.s-d-price .s-now{font-size:24px}
.s-desc{margin:14px 0 0;white-space:pre-line;color:#374151}
.s-d-desc{margin:26px 0 0;padding:22px 0 0;border-top:1px solid var(--s-line)}
.s-d-desc-t{margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--s-muted)}
.s-rich{color:#374151;font-size:15px;line-height:1.65;overflow-wrap:anywhere}
.s-rich>:first-child{margin-top:0}
.s-rich p{margin:0 0 .8em}
.s-rich h3,.s-rich h4,.s-rich h5{color:var(--s-text);line-height:1.3;margin:1.3em 0 .5em;letter-spacing:-.01em}
.s-rich h3{font-size:21px}.s-rich h4{font-size:18px}.s-rich h5{font-size:16px}
.s-rich ul,.s-rich ol{margin:0 0 .9em;padding-left:1.4em}
.s-rich li{margin:.2em 0}
.s-rich li>p{margin:0}
.s-rich a{color:var(--s-accent);text-decoration:underline;text-underline-offset:2px}
.s-rich blockquote{margin:0 0 1em;padding:.2em 0 .2em 1em;border-left:3px solid var(--s-line);color:var(--s-muted)}
.s-rich code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;background:#f3f4f6;border-radius:5px;padding:.1em .35em}
.s-rich pre{background:#f3f4f6;border-radius:10px;padding:12px 14px;overflow-x:auto;margin:0 0 1em}
.s-rich pre code{background:none;padding:0}
.s-rich hr{border:0;border-top:1px solid var(--s-line);margin:1.4em 0}
.s-rich img{display:block;max-width:100%;height:auto;border-radius:12px;margin:.6em 0 1em}
.s-rich-table{overflow-x:auto;margin:0 0 1em}
.s-rich table{border-collapse:collapse;width:100%;font-size:14px}
.s-rich th,.s-rich td{border:1px solid var(--s-line);padding:7px 10px;text-align:left;vertical-align:top}
.s-rich th{background:#f8fafc;font-weight:650}
.s-rich-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;margin:0 0 1em}
.s-tasks{list-style:none;padding-left:0}
.s-task{display:flex;gap:8px;align-items:flex-start}
.s-check{flex:none;width:17px;height:17px;margin-top:4px;border:1.5px solid var(--s-line);border-radius:4px;font-size:11px;line-height:15px;text-align:center;color:#fff}
.s-done .s-check{background:var(--s-accent);border-color:var(--s-accent)}
.s-rich-wait{display:flex;flex-direction:column;gap:8px}
.s-rich-wait span{display:block;height:12px;border-radius:6px;background:#eef0f3;animation:s-pulse 1.2s ease-in-out infinite}
.s-rich-wait span:nth-child(2){width:86%}.s-rich-wait span:nth-child(3){width:64%}
@keyframes s-pulse{50%{opacity:.5}}
.s-still{animation:none!important}
.s-opts{display:flex;flex-direction:column;gap:12px;margin:14px 0 0}
.s-opt-l{font-size:13px;font-weight:650;margin:0 0 6px;color:var(--s-muted)}
.s-opt-l b{color:var(--s-text)}
.s-optvs{display:flex;flex-wrap:wrap;gap:8px}
.s-optv{min-width:44px;height:38px;padding:0 13px;border-radius:10px;border:1.5px solid var(--s-line);background:#fff;cursor:pointer;font-weight:600;font-size:14px}
.s-optv[aria-pressed="true"]{border-color:var(--s-text);background:var(--s-text);color:#fff}
.s-optv.s-off{color:#9ca3af;text-decoration:line-through}
.s-optv[aria-pressed="true"].s-off{color:#e5e7eb}
.s-optv:disabled{opacity:.35;cursor:not-allowed;text-decoration:line-through}
.s-incart{font-size:12.5px;color:var(--s-muted);font-weight:600}
.s-d-cats{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}
.s-d-cats span{font-size:12.5px;padding:3px 10px;border-radius:999px;background:#f3f4f6;color:#4b5563}
.s-line{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--s-line)}
.s-line-img{width:64px;height:64px;border-radius:10px;overflow:hidden;background:#f1f3f6}
.s-line-img img{width:100%;height:100%;object-fit:cover}
.s-line-t{font-weight:600;font-size:14.5px;line-height:1.3}
.s-line-p{font-size:13px;color:var(--s-muted)}
.s-line-err{font-size:12.5px;color:#b91c1c;font-weight:600;margin-top:2px}
.s-line .s-step{width:112px;height:34px;margin:6px 0 0}
.s-line .s-step button{width:34px;font-size:17px}
.s-line-sub{font-weight:700;text-align:right;white-space:nowrap}
.s-rm{display:block;margin:6px 0 0 auto;border:0;background:none;color:var(--s-muted);font-size:12.5px;cursor:pointer;text-decoration:underline}
.s-sum{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.s-sum div{display:flex;justify-content:space-between;gap:12px;font-size:14px}
.s-sum .s-tot{font-size:17px;font-weight:750;padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px}
.s-sum .s-disc{color:#15803d;font-weight:600}
.s-free-hint{display:flex!important;justify-content:flex-start!important;align-items:center;gap:8px;font-size:13px!important;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 10px;margin:2px 0}
.s-free-hint svg{width:16px;height:16px;flex:none}
.s-coupon{margin:0 0 12px}
.s-coupon svg{width:16px;height:16px;flex:none}
.s-coupon-open{display:inline-flex;align-items:center;gap:6px;font-size:14px}
.s-coupon-l{display:block;font-size:13px;font-weight:600;margin:0 0 4px}
.s-coupon-row{display:flex;gap:8px}
.s-coupon-row input{flex:1;min-width:0;height:42px;border-radius:10px;border:1px solid var(--s-line);background:#fff;padding:0 12px;outline:none;text-transform:uppercase;letter-spacing:.03em;font-weight:600}
.s-coupon-row input:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-coupon-row input[aria-invalid="true"]{border-color:#dc2626}
.s-coupon-row .s-btn{width:auto;height:42px;padding:0 16px;font-size:14px;flex:none}
.s-coupon-on{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;border:1px dashed #86efac;background:#f0fdf4;color:#166534}
.s-coupon-on.s-coupon-off{border-color:#fcd34d;background:#fffbeb;color:#92400e}
.s-coupon-t{flex:1;min-width:0;display:flex;flex-direction:column;font-size:13px;line-height:1.3}
.s-coupon-t strong{letter-spacing:.03em}
.s-coupon .s-line-err{margin-top:6px}
.s-f select{width:100%;height:44px;border-radius:10px;border:1px solid var(--s-line);background:#fff;padding:0 10px;outline:none}
.s-f select:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-f select[aria-invalid="true"]{border-color:#dc2626}
.s-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:50px;border-radius:12px;border:0;background:var(--s-accent);color:var(--s-ink);font-weight:700;font-size:16px;cursor:pointer;text-decoration:none}
.s-btn:disabled{opacity:.55;cursor:not-allowed}
.s-btn.s-ghost{background:#f3f4f6;color:var(--s-text)}
.s-btn.s-wa{background:#16a34a;color:#fff}
.s-btn svg{width:20px;height:20px}
.s-warn{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:13.5px}
.s-note{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #eef0f3;font-size:13.5px;color:#374151;white-space:pre-line}
.s-sec{margin:0 0 20px}
.s-sec h3{margin:0 0 10px;font-size:15px}
.s-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.s-fields .s-wide{grid-column:1/-1}
@media (max-width:480px){.s-fields{grid-template-columns:1fr}}
.s-f label{display:block;font-size:13px;font-weight:600;margin:0 0 4px}
.s-f input,.s-f textarea{width:100%;height:44px;border-radius:10px;border:1px solid var(--s-line);background:#fff;padding:0 12px;outline:none}
.s-f textarea{height:80px;padding:10px 12px;resize:vertical}
.s-f input:focus,.s-f textarea:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-f .s-err{font-size:12.5px;color:#b91c1c;margin-top:4px}
.s-f input[aria-invalid="true"]{border-color:#dc2626}
.s-opts{display:flex;flex-direction:column;gap:8px}
.s-opt{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid var(--s-line);cursor:pointer;background:#fff}
.s-opt:has(input:checked){border-color:var(--s-accent);box-shadow:0 0 0 1px var(--s-accent) inset;background:color-mix(in srgb,var(--s-accent) 5%,#fff)}
.s-opt input{margin:3px 0 0;accent-color:var(--s-accent);width:17px;height:17px;flex:none}
.s-opt-t{flex:1;min-width:0}
.s-opt-n{font-weight:600}
.s-opt-d{font-size:13px;color:var(--s-muted);white-space:pre-line}
.s-opt-p{font-weight:650;white-space:nowrap}
.s-check{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;margin:0 0 10px}
.s-check input{margin:2px 0 0;width:17px;height:17px;accent-color:var(--s-accent);flex:none}
.s-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.s-ok{text-align:center;padding:10px 0 6px}
.s-ok-ic{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:999px;background:#dcfce7;color:#16a34a;margin:0 0 12px}
.s-ok-ic svg{width:34px;height:34px}
.s-ok h2{margin:0 0 6px;font-size:22px}
.s-ok p{margin:0 auto;color:var(--s-muted);max-width:420px;white-space:pre-line}
.s-num{display:inline-block;margin:12px 0 0;padding:6px 14px;border-radius:999px;background:#f3f4f6;font-weight:700;letter-spacing:.02em}
.s-status{display:inline-flex;align-items:center;gap:6px;font-weight:650;font-size:13.5px;padding:4px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8}
.s-policy{white-space:pre-line;color:#374151;font-size:14.5px}
.s-policy h3{margin:16px 0 6px;font-size:15px;color:var(--s-text)}
.s-policy h3:first-child{margin-top:0}
.s-mbar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:15;display:none}
@media (max-width:640px){.s-mbar.s-show{display:block}.s-top .s-cart-btn .s-cart-l{display:none}}
.s-spin{width:18px;height:18px;border-radius:999px;border:2.5px solid currentColor;border-right-color:transparent;animation:s-rot .7s linear infinite}
.s-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;background:#111827;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;box-shadow:0 10px 30px rgba(15,23,42,.3);animation:s-toast .18s ease both;max-width:calc(100% - 32px)}
.s-captcha{margin:0 0 12px}
.s-checkout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,1fr);gap:28px;align-items:start;padding-top:18px}
.s-checkout h1{margin:6px 0 18px;font-size:26px}
.s-panel{background:#fff;border-radius:16px;border:1px solid var(--s-line);padding:18px}
.s-co-aside{position:sticky;top:84px}
.s-co-aside h3{margin:0 0 12px;font-size:16px}
@media (max-width:900px){.s-checkout{grid-template-columns:1fr;gap:8px}.s-co-aside{position:static}}
@keyframes s-fade{from{opacity:0}to{opacity:1}}
@keyframes s-slide{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
@keyframes s-up{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
@keyframes s-pop{from{opacity:0;transform:translate(-50%,-48%) scale(.98)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes s-rot{to{transform:rotate(360deg)}}
@keyframes s-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (max-width:640px){.s-toast{bottom:calc(86px + env(safe-area-inset-bottom))}}
@media (prefers-reduced-motion:reduce){.s-veil,.s-sheet,.s-toast{animation:none}.s-card{transition:none}}
`;

export interface ShopPageOpts {
    nonce?: string;
    title: string;
    token: string;
    /** null = vista previa del editor: el catálogo llega por postMessage. */
    meta: PublicShopMeta | null;
    products: PublicShopProduct[];
    client: string | null;
    captchaScripts: Record<string, string>;
}

export function renderShopPage(opts: ShopPageOpts): string {
    const boot = jsonForScript({ token: opts.token, preview: opts.meta === null, meta: opts.meta, products: opts.products, scripts: opts.captchaScripts });
    const nonce = opts.nonce ? ` nonce="${opts.nonce}"` : '';
    const main = opts.client
        ? `<script${nonce}>${inlineScriptText(opts.client)}</script>`
        : `<script type="module"${nonce} src="/app/public-shop/main.ts"></script>`;
    // v0.1.418 — Las etiquetas del enlace directo van ANTES de la tienda (expone `window.imbPixels`).
    const client = opts.meta?.conversion?.direct ? `<script>${directTagsScriptText()}</script>\n${main}` : main;
    const description = opts.meta?.description ? `<meta name="description" content="${escapeHtml(opts.meta.description.slice(0, 200))}" />\n` : '';
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(opts.title)}</title>
${description}<meta property="og:title" content="${escapeHtml(opts.title)}" />
<style>${SHOP_CSS}</style>
</head>
<body>
<div id="app"></div>
<noscript><div class="s-wrap"><p class="s-empty">Para comprar en esta tienda, activa JavaScript en tu navegador.</p></div></noscript>
<script type="application/json" id="boot">${boot}</script>
${client}
</body>
</html>`;
}

function clientCandidates(webDistDir: string): string[] {
    const entry = path.join('public-shop', 'shop.js');
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

/** El script compilado de la tienda (cambia sólo con un release, que reinicia el proceso). */
export function loadShopClient(webDistDir: string): string | null {
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
export function resetShopClientCache(): void {
    clientCache = null;
}

/** Una tienda que no existe, se apagó o la empresa está pausada: el mismo aviso para todas. */
export function shopNotFoundPage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Tienda no disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f7f9;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#6b7280;margin:0}</style></head>
<body><div><h1>Esta tienda no está disponible</h1><p>Puede que la dirección haya cambiado o que la tienda ya no esté abierta.</p></div></body></html>`;
}

/** v0.1.416 — Un aviso simple (una descarga que ya no sirve), sin scripts. Todo escapado. */
export function shopMessagePage(title: string, text: string, back: string | null = null): string {
    const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const link = back ? `<p style="margin-top:16px"><a href="${esc(back)}" style="color:#0e7490;font-weight:600">Volver a mi pedido</a></p>` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${esc(title)}</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f7f9;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:440px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#6b7280;margin:0}</style></head>
<body><div><h1>${esc(title)}</h1><p>${esc(text)}</p>${link}</div></body></html>`;
}
