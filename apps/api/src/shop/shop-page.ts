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
:root{--s-accent:#0e7490;--s-ink:#fff;--s-accent-text:#0e7490;--s-text:#111827;--s-text2:#374151;--s-muted:#6b7280;--s-line:#e8eaee;--s-soft:#f1f3f6;--s-noimg:#c3c8d1;--s-bg:#f6f7f9;--s-card:#fff;--s-field:#fff;--s-radius:14px;--s-radius-btn:10px;--s-radius-sm:10px;--s-radius-chip:999px;--s-gap:18px;--s-width:1180px;--s-cols:3;--s-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--s-font-h:var(--s-font);--s-fs:15px;--s-hw:700;--s-logo-h:38px;--s-title:clamp(26px,4vw,38px);--s-hero-h:280px;--s-hero-ov:.35;--s-shadow:rgba(15,23,42,.10);--s-head-bg:rgba(255,255,255,.92);--s-head-ink:var(--s-text);--s-head-line:var(--s-line);--s-cbtn-bg:var(--s-accent);--s-cbtn-ink:var(--s-ink);--s-hbtn-bg:var(--s-card);--s-hbtn-ink:var(--s-text);--s-hbtn-line:var(--s-line);--s-hero-bg:var(--s-accent);--s-hero-ink:var(--s-ink);--s-ok-ink:#166534;--s-warn-ink:#92400e;--s-danger-ink:#991b1b;--s-info-ink:#1d4ed8}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--s-bg);color:var(--s-text);font:var(--s-fs)/1.5 var(--s-font);-webkit-font-smoothing:antialiased}
h1,h2,h3,.s-d-title,.s-name,.s-title{font-family:var(--s-font-h)}
h1,h2,.s-d-title{font-weight:var(--s-hw)}
button,input,select,textarea{font:inherit;color:inherit}
a{color:var(--s-accent-text)}
img{display:block;max-width:100%}
[hidden]{display:none!important}
.s-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.s-top{position:sticky;top:0;z-index:20;background:var(--s-head-bg);color:var(--s-head-ink);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--s-head-line)}
.s-top-in{position:relative;max-width:var(--s-width);margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:14px;min-height:max(64px,calc(var(--s-logo-h) + 20px))}
.s-brand{display:flex;align-items:center;gap:10px;min-width:0;flex:1;text-decoration:none;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left}
.s-logo{height:var(--s-logo-h);max-width:calc(var(--s-logo-h) * 4);object-fit:contain}
.s-name{font-weight:700;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-cart-btn{position:relative;display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 16px;border-radius:999px;border:0;background:var(--s-cbtn-bg);color:var(--s-cbtn-ink);font-weight:650;cursor:pointer;flex:none;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.s-cart-btn svg{width:20px;height:20px}
.s-badge{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--s-cbtn-ink);color:var(--s-cbtn-bg);font-size:12px;font-weight:700}
.s-wrap{max-width:var(--s-width);margin:0 auto;padding:0 20px 56px}
.s-hero{padding:34px 0 18px}
.s-hero h1{margin:0;font-size:var(--s-title);line-height:1.15;letter-spacing:-.02em}
.s-hero p{margin:10px 0 0;color:var(--s-muted);max-width:720px;white-space:pre-line}
.s-closed{margin:0 0 18px;padding:12px 16px;border-radius:var(--s-radius-sm);background:color-mix(in srgb,#f59e0b 12%,var(--s-card));border:1px solid color-mix(in srgb,#f59e0b 35%,var(--s-card));color:var(--s-warn-ink)}
.s-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:8px 0 20px}
.s-search{flex:1;min-width:220px;position:relative}
.s-search input{width:100%;height:44px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);background:var(--s-field);padding:0 14px 0 40px;outline:none}
.s-search input:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-search svg{position:absolute;left:13px;top:12px;width:20px;height:20px;color:var(--s-muted)}
.s-sort{height:44px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);background:var(--s-field);padding:0 12px}
.s-cats{display:flex;gap:8px;overflow-x:auto;padding:2px 0 4px;margin:0 0 16px;scrollbar-width:none}
.s-cats::-webkit-scrollbar{display:none}
.s-chip{flex:none;height:36px;padding:0 14px;border-radius:var(--s-radius-chip);border:1px solid var(--s-line);background:var(--s-card);cursor:pointer;font-weight:550;font-size:14px;white-space:nowrap}
.s-chip[aria-pressed="true"]{background:var(--s-text);color:var(--s-card);border-color:var(--s-text)}
.s-grid{display:grid;grid-template-columns:repeat(var(--s-cols),minmax(0,1fr));gap:var(--s-gap)}
@media (max-width:900px){.s-grid{grid-template-columns:repeat(min(var(--s-cols),3),minmax(0,1fr))}}
@media (max-width:640px){.s-add{font-size:14px}.s-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:min(var(--s-gap),12px)}.s-wrap,.s-top-in{padding-left:14px;padding-right:14px}}
.s-card{display:flex;flex-direction:column;background:var(--s-card);border-radius:var(--s-radius);border:1px solid var(--s-line);overflow:hidden;transition:box-shadow .15s,transform .15s}
.s-card:hover{box-shadow:0 10px 30px var(--s-shadow);transform:translateY(-2px)}
.s-card.s-out{opacity:.62}
.s-media{position:relative;display:block;width:100%;padding:0;border:0;background:var(--s-img-bg,var(--s-soft));cursor:pointer;aspect-ratio:1/1;overflow:hidden}
.s-ar-portrait .s-media{aspect-ratio:4/5}
.s-ar-landscape .s-media{aspect-ratio:4/3}
.s-ar-tall .s-media{aspect-ratio:2/3}
.s-ar-photo .s-media{aspect-ratio:3/2}
.s-ar-wide .s-media{aspect-ratio:16/9}
.s-media img{width:100%;height:100%;object-fit:cover}
.s-contain .s-media img{object-fit:contain;padding:8px}
.s-noimg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--s-noimg)}
.s-noimg svg{width:44px;height:44px}
.s-tag{position:absolute;left:10px;top:10px;padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700;background:var(--s-card);color:var(--s-text);box-shadow:0 2px 8px rgba(15,23,42,.12)}
.s-tag.s-sale{background:#dc2626;color:#fff}
.s-kind{position:absolute;left:10px;bottom:10px;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:color-mix(in srgb,var(--s-card) 94%,transparent);color:var(--s-text2);box-shadow:0 2px 8px rgba(15,23,42,.12)}
.s-kind svg{width:13px;height:13px}
.s-kind-note{display:flex;align-items:flex-start;gap:8px;margin:12px 0 0;font-size:13.5px;color:var(--s-text2)}
.s-kind-note svg{width:17px;height:17px;flex:none;margin-top:1px;color:var(--s-accent-text)}
.s-kind-box{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);background:var(--s-card);font-size:14px;color:var(--s-text2)}
.s-kind-box svg{width:19px;height:19px;flex:none;color:var(--s-accent-text);margin-top:1px}
a.s-add{display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
.s-add svg{width:17px;height:17px}
.s-my-btn{display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 14px;border-radius:999px;border:1px solid var(--s-hbtn-line);background:var(--s-hbtn-bg);color:var(--s-hbtn-ink);font-weight:600;cursor:pointer;flex:none}
.s-my-btn svg{width:19px;height:19px}
@media (max-width:640px){.s-my-btn{padding:0 11px}.s-my-btn .s-my-l{display:none}}
.s-dl{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--s-line)}
.s-dl:last-child{border-bottom:0;padding-bottom:0}
.s-dl-ic{flex:none;width:38px;height:38px;border-radius:10px;background:color-mix(in srgb,var(--s-accent) 12%,var(--s-card));color:var(--s-accent-text);display:flex;align-items:center;justify-content:center}
.s-dl-ic svg{width:20px;height:20px}
.s-dl-t{flex:1;min-width:0}
.s-dl-n{font-weight:650;overflow-wrap:anywhere;line-height:1.3}
.s-dl-m{font-size:12.5px;color:var(--s-muted)}
.s-dl-go{flex:none;display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:var(--s-radius-btn);background:var(--s-accent);color:var(--s-ink);font-weight:650;font-size:14px;text-decoration:none}
.s-dl-go svg{width:16px;height:16px}
.s-dl-off{flex:none;font-size:12.5px;color:var(--s-muted);font-weight:600}
.s-myo{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px}
.s-myo-t{flex:1;min-width:200px}
.s-myo-n{font-weight:700}
.s-myo-m{font-size:13px;color:var(--s-muted);margin-top:2px}
.s-body{display:flex;flex-direction:column;gap:6px;padding:12px 14px 14px;flex:1}
.s-title{margin:0;font-size:15px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;background:none;border:0;padding:0;text-align:left}
a.s-title{color:inherit;text-decoration:none}a.s-title:hover{text-decoration:underline}
.s-sku{font-size:12px;color:var(--s-muted)}
.s-card-sum{margin:0;font-size:13px;line-height:1.45;color:var(--s-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.s-al-center .s-card-sum{text-align:center}
.s-price{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:auto}
.s-now{font-weight:750;font-size:17px}
.s-was{color:var(--s-muted);text-decoration:line-through;font-size:13.5px}
.s-stock{font-size:12.5px;color:var(--s-warn-ink);font-weight:600}
.s-cad{font-size:12.5px;color:var(--s-muted);margin-top:-2px}
.s-d-price+.s-cad{margin-top:4px;font-size:13.5px}
.s-act{display:flex;flex-direction:column}
.s-add{margin-top:8px;height:40px;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:var(--s-radius-btn);border:0;background:var(--s-accent);color:var(--s-ink);font-weight:650;cursor:pointer}
.s-add:disabled{background:var(--s-soft);color:var(--s-muted);box-shadow:none;cursor:not-allowed}
.s-step{display:flex;align-items:center;justify-content:space-between;margin-top:8px;height:40px;border-radius:var(--s-radius-btn);border:1px solid var(--s-line);background:var(--s-field);overflow:hidden}
.s-step button{width:42px;height:100%;border:0;background:transparent;font-size:19px;cursor:pointer}
.s-step button:disabled{opacity:.35;cursor:not-allowed}
.s-step span{font-weight:700;min-width:28px;text-align:center}
.s-empty{padding:60px 0;text-align:center;color:var(--s-muted)}
.s-more{margin:18px 0 0;font-size:13px;color:var(--s-muted);text-align:center}
.s-foot{border-top:1px solid var(--s-line);background:var(--s-card)}
.s-foot-in{max-width:var(--s-width);margin:0 auto;padding:28px 20px 40px;display:grid;grid-template-columns:2fr 1fr;gap:20px;font-size:13.5px;color:var(--s-muted)}
@media (max-width:640px){.s-foot-in{grid-template-columns:1fr;padding:24px 14px 96px}}
.s-foot strong{color:var(--s-text)}
.s-foot-in.s-pixels-note{display:block;padding-top:0;margin-top:-24px;font-size:12px}
.s-links{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.s-link{background:none;border:0;padding:0;color:var(--s-accent-text);cursor:pointer;font-weight:550;text-align:left}
.s-veil{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:40;animation:s-fade .16s ease both}
.s-sheet{position:fixed;z-index:41;background:var(--s-card);color:var(--s-text);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(15,23,42,.28)}
.s-drawer{top:0;right:0;bottom:0;width:min(440px,100%);animation:s-slide .2s ease both}
.s-modal{top:50%;left:50%;transform:translate(-50%,-50%);width:min(940px,calc(100% - 32px));max-height:calc(100% - 48px);border-radius:18px;overflow:hidden;animation:s-pop .18s ease both}
.s-modal.s-narrow{width:min(620px,calc(100% - 32px))}
@media (max-width:640px){.s-modal{top:auto;bottom:0;left:0;transform:none;width:100%;max-height:92%;border-radius:18px 18px 0 0;animation:s-up .2s ease both}.s-drawer{width:100%}}
.s-sh{display:flex;align-items:center;gap:10px;padding:14px 16px 14px 20px;border-bottom:1px solid var(--s-line);flex:none}
.s-sh h2{margin:0;font-size:17px;flex:1;min-width:0}
.s-x{width:38px;height:38px;border-radius:999px;border:0;background:var(--s-soft);color:var(--s-text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.s-x svg{width:18px;height:18px}
.s-back{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:6px 8px 6px 0;cursor:pointer;color:var(--s-muted);font-weight:600;font-size:14.5px}
.s-back svg{width:16px;height:16px}
.s-sb{flex:1;min-height:0;overflow-y:auto;padding:16px 20px;-webkit-overflow-scrolling:touch}
.s-sf{flex:none;padding:14px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--s-line);background:var(--s-card)}
/* v0.1.424 — La ficha del producto: cinco diseños (s-pd-*), la forma de la foto (s-pr-*) y cómo entra (s-pf-*). */
.s-x-float{position:absolute;top:12px;right:12px;z-index:3;background:var(--s-card);box-shadow:0 2px 10px rgba(15,23,42,.16)}
.s-pd .s-sb{padding:24px}
.s-pd.s-modal{width:min(1080px,calc(100% - 32px))}
.s-pd-stacked.s-modal{width:min(720px,calc(100% - 32px))}
.s-pd-compact.s-modal{width:min(560px,calc(100% - 32px))}
.s-pd-full.s-modal{top:0;left:0;transform:none;width:100%;height:100%;max-height:none;border-radius:0;animation:s-fade .18s ease both}
.s-pd-full .s-sb{padding:36px max(24px,calc((100% - var(--s-width))/2))}
.s-detail{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:36px;align-items:start}
.s-pd-classic .s-gal,.s-pd-full .s-gal{position:sticky;top:0}
.s-gal{min-width:0}
.s-gal-main{position:relative;border-radius:var(--s-radius);overflow:hidden;background:var(--s-img-bg,var(--s-soft))}
.s-gal-main img{display:block;width:100%;height:100%;object-fit:contain}
.s-pd{--s-galmax:min(72vh,640px)}
.s-pr-auto .s-gal-main{background:transparent;margin:0 auto;max-width:100%}
.s-pr-auto .s-gal-main[style*="--r"]{width:calc(var(--s-galmax) * var(--r))}
.s-pr-auto .s-gal-main img{height:auto;max-height:var(--s-galmax);border-radius:var(--s-radius)}
.s-pr-auto .s-thumbs{justify-content:safe center}
.s-pr-auto .s-gal-main .s-noimg{aspect-ratio:4/3;background:var(--s-img-bg,var(--s-soft));border-radius:var(--s-radius)}
.s-pr-square .s-gal-main{aspect-ratio:1/1}
.s-pr-portrait .s-gal-main{aspect-ratio:4/5}
.s-pr-landscape .s-gal-main{aspect-ratio:4/3}
.s-pr-tall .s-gal-main{aspect-ratio:2/3}
.s-pr-photo .s-gal-main{aspect-ratio:3/2}
.s-pr-wide .s-gal-main{aspect-ratio:16/9}
.s-pf-cover .s-gal-main img{object-fit:cover}
.s-gal-nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:999px;border:0;background:var(--s-card);color:var(--s-text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(15,23,42,.16);opacity:0;transition:opacity .15s}
.s-gal-main:hover .s-gal-nav,.s-gal-nav:focus-visible{opacity:.95}
@media (hover:none){.s-gal-nav{opacity:.95}}
.s-gal-prev{left:10px}.s-gal-next{right:10px}.s-gal-next svg{transform:scaleX(-1)}
.s-gal-nav svg{width:18px;height:18px}
.s-gal-count{position:absolute;right:10px;bottom:10px;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:650;background:rgba(17,24,39,.62);color:#fff}
.s-thumbs{display:flex;gap:8px;margin-top:10px;overflow-x:auto}
.s-thumb{flex:none;width:62px;height:62px;border-radius:10px;overflow:hidden;border:2px solid transparent;padding:0;background:var(--s-img-bg,var(--s-soft));cursor:pointer}
.s-thumb[aria-pressed="true"]{border-color:var(--s-accent)}
.s-thumb img{width:100%;height:100%;object-fit:cover}
.s-d-eyebrow{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--s-accent-text);padding-right:44px}
.s-d-title{margin:0 0 8px;font-size:clamp(22px,2.6vw,30px);line-height:1.18;letter-spacing:-.015em;padding-right:44px}
.s-d-eyebrow+.s-d-title{padding-right:0}
.s-d-price{margin-top:6px}
.s-d-price .s-now{font-size:26px}
.s-d-sum{margin:14px 0 0;font-size:15.5px;line-height:1.55;color:var(--s-text2);white-space:pre-line}
.s-d-stock{margin-top:12px}
.s-d-buy{margin-top:20px;display:flex;flex-direction:column;gap:10px}
.s-buybox{display:flex;flex-direction:column;gap:8px}
.s-btn.s-btn-line{background:transparent;color:var(--s-accent-text);box-shadow:inset 0 0 0 1.5px var(--s-accent)}
.s-btn.s-btn-line:hover{background:color-mix(in srgb,var(--s-accent) 8%,transparent)}
.s-incart-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0;font-size:13.5px;color:var(--s-text2)}
.s-incart-row svg{width:16px;height:16px;flex:none;color:var(--s-ok-ink)}
.s-kind-note .s-free{color:var(--s-ok-ink);font-weight:600}
.s-d-info .s-kind-note{margin-top:18px;padding-top:14px;border-top:1px solid var(--s-line)}
.s-desc{margin:14px 0 0;white-space:pre-line;color:var(--s-text2)}
.s-d-desc{margin:26px 0 0;padding:22px 0 0;border-top:1px solid var(--s-line)}
.s-d-desc .s-desc{margin:0}
.s-pd-wide .s-d-desc{margin-top:32px}
.s-d-desc-t{margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--s-muted)}
.s-pd-stacked .s-d-info{margin-top:22px}
.s-pd-stacked .s-d-title,.s-pd-stacked .s-d-eyebrow{padding-right:0}
.s-pd-compact .s-d-top{display:flex;gap:14px;align-items:center;padding-right:44px}
.s-pd-compact .s-gal{flex:none;width:96px}
.s-pd-compact .s-gal-main{aspect-ratio:1/1;background:var(--s-img-bg,var(--s-soft))}
.s-pd-compact .s-gal-main img{height:100%;max-height:none;object-fit:cover;border-radius:0}
.s-pd-compact .s-d-topinfo{min-width:0}
.s-pd-compact .s-d-title{font-size:20px;padding-right:0;margin-bottom:2px}
.s-pd-compact .s-d-eyebrow{padding-right:0;margin-bottom:4px}
.s-pd-compact .s-d-price .s-now{font-size:20px}
.s-pd-bar{display:none}
.s-pd-bar-in{display:flex;align-items:center;gap:12px}
.s-pd-bar-in .s-btn{flex:1;min-width:0;height:48px}
.s-bar-price{flex:none;flex-direction:column;gap:0;margin:0;line-height:1.2}
.s-bar-price .s-now{font-size:18px}
.s-bar-price .s-was{font-size:12.5px}
@media (max-width:760px){.s-detail{grid-template-columns:1fr;gap:18px}.s-pd-classic .s-gal,.s-pd-full .s-gal{position:static}}
@media (max-width:640px){.s-pd.s-modal{width:100%}.s-pd .s-sb{padding:16px}.s-pd-full.s-modal{top:0;bottom:auto;max-height:none;height:100%;border-radius:0;animation:s-fade .18s ease both}.s-pd-full .s-sb{padding:16px}.s-pd-bar{display:block}.s-pd{--s-galmax:56vh}.s-d-title{font-size:22px}}
.s-rich{color:var(--s-text2);font-size:15px;line-height:1.65;overflow-wrap:anywhere}
.s-rich>:first-child{margin-top:0}
.s-rich p{margin:0 0 .8em}
.s-rich h3,.s-rich h4,.s-rich h5{color:var(--s-text);line-height:1.3;margin:1.3em 0 .5em;letter-spacing:-.01em}
.s-rich h3{font-size:21px}.s-rich h4{font-size:18px}.s-rich h5{font-size:16px}
.s-rich ul,.s-rich ol{margin:0 0 .9em;padding-left:1.4em}
.s-rich li{margin:.2em 0}
.s-rich li>p{margin:0}
.s-rich a{color:var(--s-accent-text);text-decoration:underline;text-underline-offset:2px}
.s-rich blockquote{margin:0 0 1em;padding:.2em 0 .2em 1em;border-left:3px solid var(--s-line);color:var(--s-muted)}
.s-rich code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;background:var(--s-soft);border-radius:5px;padding:.1em .35em}
.s-rich pre{background:var(--s-soft);border-radius:10px;padding:12px 14px;overflow-x:auto;margin:0 0 1em}
.s-rich pre code{background:none;padding:0}
.s-rich hr{border:0;border-top:1px solid var(--s-line);margin:1.4em 0}
.s-rich img{display:block;max-width:100%;height:auto;border-radius:var(--s-radius-sm);margin:.6em 0 1em}
.s-rich-table{overflow-x:auto;margin:0 0 1em}
.s-rich table{border-collapse:collapse;width:100%;font-size:14px}
.s-rich th,.s-rich td{border:1px solid var(--s-line);padding:7px 10px;text-align:left;vertical-align:top}
.s-rich th{background:var(--s-soft);font-weight:650}
.s-rich-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;margin:0 0 1em}
.s-tasks{list-style:none;padding-left:0}
.s-task{display:flex;gap:8px;align-items:flex-start}
.s-task-box{flex:none;width:17px;height:17px;margin-top:4px;border:1.5px solid var(--s-line);border-radius:4px;font-size:11px;line-height:15px;text-align:center;color:#fff}
.s-done .s-task-box{background:var(--s-accent);border-color:var(--s-accent);color:var(--s-ink)}
.s-rich-wait{display:flex;flex-direction:column;gap:8px}
.s-rich-wait span{display:block;height:12px;border-radius:6px;background:var(--s-soft);animation:s-pulse 1.2s ease-in-out infinite}
.s-rich-wait span:nth-child(2){width:86%}.s-rich-wait span:nth-child(3){width:64%}
@keyframes s-pulse{50%{opacity:.5}}
.s-still{animation:none!important}
.s-vopts{display:flex;flex-direction:column;gap:12px;margin:14px 0 0}
.s-opt-l{font-size:13px;font-weight:650;margin:0 0 6px;color:var(--s-muted)}
.s-opt-l b{color:var(--s-text)}
.s-optvs{display:flex;flex-wrap:wrap;gap:8px}
.s-optv{min-width:44px;height:38px;padding:0 13px;border-radius:var(--s-radius-sm);border:1.5px solid var(--s-line);background:var(--s-card);cursor:pointer;font-weight:600;font-size:14px}
.s-optv[aria-pressed="true"]{border-color:var(--s-text);background:var(--s-text);color:var(--s-card)}
.s-optv.s-off{color:var(--s-muted);text-decoration:line-through}
.s-optv[aria-pressed="true"].s-off{color:var(--s-soft)}
.s-optv:disabled{opacity:.35;cursor:not-allowed;text-decoration:line-through}
.s-incart{font-size:12.5px;color:var(--s-muted);font-weight:600}
.s-line{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--s-line)}
.s-line-img{width:64px;height:64px;border-radius:var(--s-radius-sm);overflow:hidden;background:var(--s-soft)}
.s-line-img img{width:100%;height:100%;object-fit:cover}
.s-line-t{font-weight:600;font-size:14.5px;line-height:1.3}
.s-line-p{font-size:13px;color:var(--s-muted)}
.s-line-err{font-size:12.5px;color:var(--s-danger-ink);font-weight:600;margin-top:2px}
.s-line .s-step{width:112px;height:34px;margin:6px 0 0}
.s-line .s-step button{width:34px;font-size:17px}
.s-line-sub{font-weight:700;text-align:right;white-space:nowrap}
.s-rm{display:block;margin:6px 0 0 auto;border:0;background:none;color:var(--s-muted);font-size:12.5px;cursor:pointer;text-decoration:underline}
.s-sum{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.s-sum div{display:flex;justify-content:space-between;gap:12px;font-size:14px}
.s-sum .s-tot{font-size:17px;font-weight:750;padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px}
.s-sum .s-disc{color:var(--s-ok-ink);font-weight:600}
.s-free-hint{display:flex!important;justify-content:flex-start!important;align-items:center;gap:8px;font-size:13px!important;color:var(--s-ok-ink);background:color-mix(in srgb,#22c55e 10%,var(--s-card));border:1px solid color-mix(in srgb,#22c55e 30%,var(--s-card));border-radius:var(--s-radius-sm);padding:8px 10px;margin:2px 0}
.s-free-hint svg{width:16px;height:16px;flex:none}
.s-coupon{margin:0 0 12px}
.s-coupon svg{width:16px;height:16px;flex:none}
.s-coupon-open{display:inline-flex;align-items:center;gap:6px;font-size:14px}
.s-coupon-l{display:block;font-size:13px;font-weight:600;margin:0 0 4px}
.s-coupon-row{display:flex;gap:8px}
.s-coupon-row input{flex:1;min-width:0;height:42px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);background:var(--s-field);padding:0 12px;outline:none;text-transform:uppercase;letter-spacing:.03em;font-weight:600}
.s-coupon-row input:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-coupon-row input[aria-invalid="true"]{border-color:#dc2626}
.s-coupon-row .s-btn{width:auto;height:42px;padding:0 16px;font-size:14px;flex:none}
.s-coupon-on{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--s-radius-sm);border:1px dashed color-mix(in srgb,#22c55e 45%,var(--s-card));background:color-mix(in srgb,#22c55e 10%,var(--s-card));color:var(--s-ok-ink)}
.s-coupon-on.s-coupon-off{border-color:color-mix(in srgb,#f59e0b 45%,var(--s-card));background:color-mix(in srgb,#f59e0b 10%,var(--s-card));color:var(--s-warn-ink)}
.s-coupon-t{flex:1;min-width:0;display:flex;flex-direction:column;font-size:13px;line-height:1.3}
.s-coupon-t strong{letter-spacing:.03em}
.s-coupon .s-line-err{margin-top:6px}
.s-f select{width:100%;height:44px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);background:var(--s-field);padding:0 10px;outline:none}
.s-f select:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-f select[aria-invalid="true"]{border-color:#dc2626}
.s-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:50px;border-radius:var(--s-radius-btn);border:0;background:var(--s-accent);color:var(--s-ink);font-weight:700;font-size:16px;cursor:pointer;text-decoration:none}
.s-btn:disabled{opacity:.55;cursor:not-allowed}
.s-btn.s-ghost{background:var(--s-soft);color:var(--s-text)}
.s-btn.s-wa{background:#16a34a;color:#fff}
.s-btn svg{width:20px;height:20px}
.s-warn{margin:0 0 12px;padding:10px 12px;border-radius:var(--s-radius-sm);background:color-mix(in srgb,#ef4444 9%,var(--s-card));border:1px solid color-mix(in srgb,#ef4444 28%,var(--s-card));color:var(--s-danger-ink);font-size:13.5px}
.s-note{margin:0 0 12px;padding:10px 12px;border-radius:var(--s-radius-sm);background:var(--s-soft);border:1px solid var(--s-line);font-size:13.5px;color:var(--s-text2);white-space:pre-line}
.s-sec{margin:0 0 20px}
.s-sec h3{margin:0 0 10px;font-size:15px}
.s-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.s-fields .s-wide{grid-column:1/-1}
@media (max-width:480px){.s-fields{grid-template-columns:1fr}}
.s-f label{display:block;font-size:13px;font-weight:600;margin:0 0 4px}
.s-f input,.s-f textarea{width:100%;height:44px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);background:var(--s-field);padding:0 12px;outline:none}
.s-f textarea{height:80px;padding:10px 12px;resize:vertical}
.s-f input:focus,.s-f textarea:focus{border-color:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent)}
.s-f .s-err{font-size:12.5px;color:var(--s-danger-ink);margin-top:4px}
.s-f input[aria-invalid="true"]{border-color:#dc2626}
.s-opts{display:flex;flex-direction:column;gap:8px}
.s-opt{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:var(--s-radius-sm);border:1px solid var(--s-line);cursor:pointer;background:var(--s-card)}
.s-opt:has(input:checked){border-color:var(--s-accent);box-shadow:0 0 0 1px var(--s-accent) inset;background:color-mix(in srgb,var(--s-accent) 6%,var(--s-card))}
.s-opt input{margin:3px 0 0;accent-color:var(--s-accent);width:17px;height:17px;flex:none}
.s-opt-t{flex:1;min-width:0}
.s-opt-n{font-weight:600}
.s-opt-d{font-size:13px;color:var(--s-muted);white-space:pre-line}
.s-opt-p{font-weight:650;white-space:nowrap}
.s-check{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;margin:0 0 10px}
.s-check input{margin:2px 0 0;width:17px;height:17px;accent-color:var(--s-accent);flex:none}
.s-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.s-ok{text-align:center;padding:10px 0 6px}
.s-ok-ic{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:999px;background:color-mix(in srgb,#22c55e 16%,var(--s-card));color:var(--s-ok-ink);margin:0 0 12px}
.s-ok-ic svg{width:34px;height:34px}
.s-ok h2{margin:0 0 6px;font-size:22px}
.s-ok p{margin:0 auto;color:var(--s-muted);max-width:420px;white-space:pre-line}
.s-num{display:inline-block;margin:12px 0 0;padding:6px 14px;border-radius:999px;background:var(--s-soft);font-weight:700;letter-spacing:.02em}
.s-status{display:inline-flex;align-items:center;gap:6px;font-weight:650;font-size:13.5px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,#3b82f6 12%,var(--s-card));color:var(--s-info-ink)}
.s-policy{white-space:pre-line;color:var(--s-text2);font-size:14.5px}
.s-policy h3{margin:16px 0 6px;font-size:15px;color:var(--s-text)}
.s-policy h3:first-child{margin-top:0}
.s-mbar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:15;display:none}
@media (max-width:640px){.s-mbar.s-show{display:block}.s-top .s-cart-btn .s-cart-l{display:none}}
.s-spin{width:18px;height:18px;border-radius:999px;border:2.5px solid currentColor;border-right-color:transparent;animation:s-rot .7s linear infinite}
.s-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;background:#111827;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;box-shadow:0 10px 30px rgba(15,23,42,.3);animation:s-toast .18s ease both;max-width:calc(100% - 32px);display:flex;align-items:center;gap:14px}
.s-captcha{margin:0 0 12px}
.s-toast-a{border:0;background:transparent;color:#fff;font-weight:750;font-size:14px;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:3px;white-space:nowrap}
.s-buyrow{display:flex;gap:10px;align-items:stretch}
.s-buyrow .s-pick{margin:0;width:132px;height:50px;flex:none}
.s-buyrow .s-btn{flex:1;min-width:0}
.s-bump{animation:s-bump .5s ease}
@keyframes s-bump{30%{transform:scale(1.3)}65%{transform:scale(.94)}100%{transform:scale(1)}}
.s-added{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--s-radius-sm);background:color-mix(in srgb,#10b981 12%,var(--s-card));color:var(--s-ok-ink);font-weight:650;font-size:14px;margin:0 0 6px;animation:s-in .22s ease both}
@keyframes s-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.s-added svg{width:18px;height:18px;flex:none}
.s-line.s-flash{animation:s-flash 1.8s ease}
@keyframes s-flash{0%,45%{background:color-mix(in srgb,#10b981 12%,var(--s-card));box-shadow:-12px 0 0 color-mix(in srgb,#10b981 12%,var(--s-card)),12px 0 0 color-mix(in srgb,#10b981 12%,var(--s-card))}100%{background:transparent;box-shadow:none}}
.s-keep{display:block;width:100%;text-align:center;margin:10px 0 0;font-size:14px}
.s-cartpage{padding:4px 0 24px}
.s-cp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:6px 0 18px}
.s-cp-head h1{margin:0;font-size:26px;letter-spacing:-.01em}
.s-cp{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start}
.s-cp-lines{border-top:1px solid var(--s-line)}
.s-cp-sum{position:sticky;top:84px;border:1px solid var(--s-line);border-radius:var(--s-radius);padding:18px;background:var(--s-card)}
.s-cp-empty{max-width:360px}
@media (max-width:820px){.s-cp{grid-template-columns:1fr;gap:18px}.s-cp-sum{position:static}}
.s-checkout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,1fr);gap:28px;align-items:start;padding-top:18px}
.s-checkout h1{margin:6px 0 18px;font-size:26px}
.s-panel{background:var(--s-card);border-radius:var(--s-radius);border:1px solid var(--s-line);padding:18px}
.s-co-aside{position:sticky;top:84px}
.s-co-aside h3{margin:0 0 12px;font-size:16px}
@media (max-width:900px){.s-checkout{grid-template-columns:1fr;gap:8px}.s-co-aside{position:static}}
/* v0.1.425 — Estilos del pago: dos columnas, por pasos y una columna */
.s-cx{min-height:100vh;background:var(--s-card);color:var(--s-text)}
.s-cx-head{border-bottom:1px solid var(--s-line);background:var(--s-card)}
.s-cx-head-in{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);height:66px;align-items:center}
.s-cx-head-l{padding:0 44px;min-width:0}
.s-cx-head-l .s-cx-brand{max-width:590px;margin-left:auto;width:100%}
.s-cx-head-r{padding:0 44px;display:flex}
.s-cx-head-r .s-cx-bag{margin-left:calc(min(100%,382px) - 34px)}
.s-cx-single .s-cx-head-in{display:flex;justify-content:space-between;max-width:640px;margin:0 auto;padding:0 20px}
.s-cx-single .s-cx-head-l,.s-cx-single .s-cx-head-r{padding:0}
.s-cx-brand{display:flex;align-items:center;gap:10px;min-width:0;background:none;border:0;padding:0;cursor:pointer;color:var(--s-text);font-family:var(--s-font-h);font-weight:var(--s-hw);font-size:19px}
.s-cx-brand img{height:min(var(--s-logo-h),40px);width:auto;max-width:200px;object-fit:contain}
.s-cx-brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s-cx-bag{display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;border-radius:999px;border:0;background:none;color:var(--s-accent-text);cursor:pointer}
.s-cx-bag:hover{background:var(--s-soft)}
.s-cx-bag svg{width:23px;height:23px}
.s-cx-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);min-height:calc(100vh - 67px)}
.s-cx-hstore .s-cx-grid{min-height:calc(100vh - 70px)}
.s-cx-main{padding:38px 44px 48px}
.s-cx-main-in{max-width:590px;margin-left:auto}
.s-cx-side{--s-line:var(--s-cx-line);--s-muted:var(--s-cx-muted);--s-text:var(--s-cx-ink);background:var(--s-cx-side);color:var(--s-cx-ink);border-left:1px solid var(--s-cx-line)}
.s-cx-side-in{max-width:470px;padding:38px 44px 48px;position:sticky;top:0}
.s-cx-hstore .s-cx-side-in{top:70px}
.s-cx-toggle{display:none;width:100%;align-items:center;gap:8px;background:none;border:0;padding:16px 20px;cursor:pointer;color:var(--s-accent-text);font:inherit;font-size:14.5px;text-align:left}
.s-cx-toggle svg{width:18px;height:18px;flex:none}
.s-cx-chev{transition:transform .15s ease}
.s-cx-open .s-cx-chev{transform:rotate(180deg)}
.s-cx-toggle-t{margin-left:auto;color:var(--s-cx-ink);font-weight:750;font-size:17px;white-space:nowrap}
.s-cx-items{display:flex;flex-direction:column;gap:16px;margin:0 0 22px}
.s-cx-item{display:flex;align-items:center;gap:14px}
.s-cx-thumb{position:relative;flex:none;width:64px;height:64px;border-radius:var(--s-radius-sm);border:1px solid var(--s-cx-line);background:var(--s-cx-thumb)}
.s-cx-thumb img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}
.s-cx-qty{position:absolute;top:-9px;right:-9px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--s-cx-ink) 80%,var(--s-cx-side));color:var(--s-cx-side);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.s-cx-it{flex:1;min-width:0;font-size:14px;line-height:1.35}
.s-cx-it-n{font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.s-cx-it-v{font-size:12.5px;color:var(--s-cx-muted)}
.s-cx-it-p{font-size:14px;font-weight:600;white-space:nowrap}
.s-cx-side .s-coupon{margin:0 0 20px}
.s-cx-side .s-coupon-row input{text-transform:none;letter-spacing:0;font-weight:500;height:46px}
.s-cx-side .s-coupon-row .s-btn{height:46px}
.s-cx-side .s-sum{margin:0;gap:9px}
.s-cx-side .s-sum div{font-size:14px}
.s-cx-side .s-sum .s-tot{font-size:19px;padding-top:14px;margin-top:6px;align-items:baseline}
.s-cx-total{display:inline-flex;align-items:baseline;gap:7px}
.s-cx-total small{font-size:12px;font-weight:500;color:var(--s-cx-muted)}
.s-cx .s-sec{margin:0 0 30px}
.s-cx .s-sec h3{font-size:20px;margin:0 0 14px;font-family:var(--s-font-h);font-weight:var(--s-hw)}
.s-cx .s-fields{gap:12px}
.s-cx .s-f input,.s-cx .s-f select{height:50px}
.s-cx .s-opts{gap:0;border:1px solid var(--s-line);border-radius:var(--s-radius-sm);overflow:hidden}
.s-cx .s-opt{border:0;border-radius:0;padding:15px 16px}
.s-cx .s-opt+.s-opt{border-top:1px solid var(--s-line)}
.s-cx .s-opt:has(input:checked){box-shadow:inset 0 0 0 1.5px var(--s-accent)}
.s-cx-pay{margin:6px 0 0}
.s-cx-pay .s-btn{height:56px;font-size:17px}
.s-cx-trust{display:flex;align-items:center;justify-content:center;gap:6px;margin:12px 0 0;font-size:12.5px;color:var(--s-muted)}
.s-cx-trust svg{width:14px;height:14px;flex:none}
.s-cx-back{display:inline-flex;align-items:center;gap:4px;font-size:14px;margin:0 0 18px}
.s-cx-back svg{width:15px;height:15px}
.s-cx-foot{display:flex;flex-wrap:wrap;gap:6px 18px;margin:36px 0 0;padding:16px 0 0;border-top:1px solid var(--s-line)}
.s-cx-foot .s-link{font-size:12.5px;font-weight:500}
.s-cx-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 24px;font-size:13px;color:var(--s-muted)}
.s-cx-crumbs button{background:none;border:0;padding:0;cursor:pointer;color:var(--s-accent-text);font:inherit}
.s-cx-crumbs [aria-current]{color:var(--s-text);font-weight:650}
.s-cx-crumbs svg{width:12px;height:12px;flex:none}
.s-cx-review{border:1px solid var(--s-line);border-radius:var(--s-radius-sm);padding:0 16px;margin:0 0 28px}
.s-cx-rv{display:grid;grid-template-columns:86px minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:13px 0;font-size:14px}
.s-cx-rv+.s-cx-rv{border-top:1px solid var(--s-line)}
.s-cx-rv-l{color:var(--s-muted)}
.s-cx-rv-v{overflow-wrap:anywhere}
.s-cx-nav{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:10px 0 0}
.s-cx-nav .s-btn{width:auto;min-width:240px;padding:0 24px;height:54px}
.s-cx-nav .s-cx-back{margin:0}
.s-cx-nav-end{justify-content:flex-start;margin-top:18px}
.s-cx-single{background:var(--s-bg)}
.s-cx-one{max-width:640px;margin:0 auto;padding:26px 20px 52px}
.s-cx-one-top .s-cx-back{margin:0 0 8px}
.s-cx-title{margin:0 0 18px;font-size:26px;font-family:var(--s-font-h);font-weight:var(--s-hw)}
.s-cx-single .s-cx-side{border:1px solid var(--s-cx-line);border-radius:var(--s-radius);margin:0 0 18px;overflow:hidden}
.s-cx-single .s-cx-side-in{position:static;max-width:none;padding:4px 20px 20px}
.s-cx-single .s-cx-toggle{display:flex}
.s-cx-single .s-cx-side:not(.s-cx-open) .s-cx-side-in{display:none}
.s-cx-card{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-radius);padding:26px 24px}
.s-cx-single .s-cx-form{counter-reset:cxs}
.s-cx-single .s-cx-form .s-sec>h3{display:flex;align-items:center;gap:10px}
.s-cx-single .s-cx-form .s-sec>h3::before{counter-increment:cxs;content:counter(cxs);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:var(--s-accent);color:var(--s-ink);font-size:13px;font-weight:700;flex:none}
.s-cx-single .s-cx-foot{border-top:0;justify-content:center;margin-top:20px}
.s-lbl-in .s-f{position:relative}
.s-lbl-in .s-f>label{position:absolute;left:13px;top:15px;margin:0;font-size:14.5px;font-weight:450;color:var(--s-muted);pointer-events:none;transition:top .12s ease,font-size .12s ease;max-width:calc(100% - 28px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s-lbl-in .s-f input,.s-lbl-in .s-f select{height:52px;padding-top:17px}
.s-lbl-in .s-f textarea{height:96px;padding-top:24px}
.s-lbl-in .s-f:focus-within>label,.s-lbl-in .s-f.s-has>label,.s-lbl-in .s-f:has(select)>label{top:7px;font-size:11.5px}
.s-lbl-in .s-f:has(input:autofill)>label{top:7px;font-size:11.5px}
@media (max-width:999px){
.s-cx-grid{grid-template-columns:1fr;min-height:0}
.s-cx-side{order:-1;border-left:0;border-bottom:1px solid var(--s-cx-line)}
.s-cx-side-in{position:static;max-width:640px;margin:0 auto;padding:4px 20px 22px}
.s-cx-toggle{display:flex;max-width:640px;margin:0 auto}
.s-cx-side:not(.s-cx-open) .s-cx-side-in{display:none}
.s-cx-main{padding:24px 20px 40px}
.s-cx-main-in{max-width:640px;margin:0 auto}
.s-cx-head-in{display:flex;justify-content:space-between;height:58px;padding:0 16px}
.s-cx-head-l,.s-cx-head-r{padding:0}
.s-cx-head-r .s-cx-bag{margin-left:0}
.s-cx-nav{flex-direction:column-reverse;align-items:stretch}
.s-cx-nav .s-btn{width:100%;min-width:0}
.s-cx-nav .s-cx-back{justify-content:center}
}
@media (max-width:640px){.s-cx-one{padding:16px 12px 40px}.s-cx-card{padding:20px 16px}.s-cx-title{font-size:22px}.s-cx .s-sec h3{font-size:18px}.s-cx-rv{grid-template-columns:1fr auto}.s-cx-rv-l{grid-column:1/-1;margin-bottom:-8px;font-size:12.5px}}
@keyframes s-fade{from{opacity:0}to{opacity:1}}
@keyframes s-slide{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
@keyframes s-up{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
@keyframes s-pop{from{opacity:0;transform:translate(-50%,-48%) scale(.98)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes s-rot{to{transform:rotate(360deg)}}
@keyframes s-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (max-width:640px){.s-toast{bottom:calc(86px + env(safe-area-inset-bottom))}}
/* v0.1.422 — Avisos de estado que respetan el modo oscuro */
.s-note.s-good{background:color-mix(in srgb,#22c55e 10%,var(--s-card));border-color:color-mix(in srgb,#22c55e 30%,var(--s-card));color:var(--s-ok-ink)}
.s-note.s-caution{background:color-mix(in srgb,#f59e0b 10%,var(--s-card));border-color:color-mix(in srgb,#f59e0b 32%,var(--s-card));color:var(--s-warn-ink)}
.s-status.s-neutral{background:var(--s-soft);color:var(--s-text2)}
.s-status.s-sub{background:color-mix(in srgb,#ec4899 12%,var(--s-card));color:var(--s-text)}
/* v0.1.422 — Variantes del estilo: las prende el diseño con clases en <body> */
.s-square .s-modal{border-radius:6px}
.s-square .s-cart-btn,.s-square .s-my-btn{border-radius:6px}
.s-cards-shadow .s-card{border-color:transparent;box-shadow:0 1px 2px var(--s-shadow),0 6px 20px var(--s-shadow)}
.s-cards-shadow .s-card:hover{box-shadow:0 2px 4px var(--s-shadow),0 16px 36px var(--s-shadow)}
.s-cards-flat .s-card{border-color:transparent}
.s-cards-plain .s-card{background:transparent;border-color:transparent;overflow:visible}
.s-cards-plain .s-card:hover{box-shadow:none;transform:none}
.s-cards-plain .s-media{border-radius:var(--s-radius);overflow:hidden}
.s-cards-plain .s-media img{transition:transform .35s ease}
.s-cards-plain .s-card:hover .s-media img{transform:scale(1.035)}
.s-cards-plain .s-body{padding:12px 2px 4px}
.s-al-center .s-body{align-items:center;text-align:center}
.s-al-center .s-title{text-align:center}
.s-al-center .s-price{justify-content:center}
.s-al-center .s-act{align-self:stretch;text-align:center}
.s-btn-outline .s-add:not(:disabled){background:transparent;color:var(--s-accent-text);box-shadow:inset 0 0 0 1.5px var(--s-accent-text)}
.s-btn-outline .s-add:not(:disabled):hover{background:var(--s-accent);color:var(--s-ink);box-shadow:none}
.s-head-static .s-top{position:static}
.s-head-plain .s-top,.s-head-brand .s-top,.s-head-dark .s-top{backdrop-filter:none;-webkit-backdrop-filter:none}
.s-head-center .s-top-in{display:grid;grid-template-columns:1fr minmax(0,auto) 1fr}.s-head-center .s-brand{grid-column:2;grid-row:1;justify-content:center;flex:none}.s-head-center .s-my-btn{grid-column:1;grid-row:1;justify-self:start}.s-head-center .s-cart-btn{grid-column:3;grid-row:1;justify-self:end}
.s-hero-center .s-hero{text-align:center}
.s-hero-center .s-hero p{margin-left:auto;margin-right:auto}
.s-hero-none .s-hero{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.s-hero-none .s-tools{margin-top:24px}
.s-hero-banner .s-hero{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:var(--s-hero-h);margin:24px 0 22px;padding:clamp(28px,5vw,60px) clamp(20px,5vw,56px);border-radius:var(--s-radius);background:var(--s-hero-bg);color:var(--s-hero-ink);overflow:hidden}
.s-hero-banner .s-hero p{color:inherit;opacity:.9}
.s-hero-banner.s-hero-center .s-hero{align-items:center}
.s-hero-banner.s-hero-img .s-hero{background:linear-gradient(rgba(0,0,0,var(--s-hero-ov)),rgba(0,0,0,var(--s-hero-ov))),var(--s-hero-img,none) center/cover no-repeat,#1f2937;color:#fff;text-shadow:0 1px 14px rgba(0,0,0,.35)}
@media (max-width:640px){.s-hero-banner .s-hero{min-height:calc(var(--s-hero-h) * .7);margin-top:14px}}
@media (prefers-reduced-motion:reduce){.s-veil,.s-sheet,.s-toast,.s-bump,.s-added,.s-line.s-flash{animation:none}.s-card,.s-cards-plain .s-media img{transition:none}}
/* v0.1.428 — Las fotos de los productos: esquinas, borde, margen, sombra (clases en <body>) */
.s-img-inset .s-card .s-media{margin:10px 10px 0;width:calc(100% - 20px);border-radius:max(0px,calc(var(--s-radius) - 6px))}
.s-cards-plain.s-img-inset .s-card .s-media{margin:0;width:100%;border-radius:var(--s-radius)}
.s-img-c .s-media,.s-img-c.s-img-inset .s-card .s-media,.s-img-c .s-gal-main,.s-img-c .s-pr-auto .s-gal-main img{border-radius:var(--s-img-r)}
.s-img-c .s-thumb{border-radius:min(var(--s-img-r),12px)}
.s-img-c-circle .s-grid .s-media{aspect-ratio:1/1}
.s-img-c-circle .s-thumb{border-radius:50%}
.s-img-c-circle .s-pd:not(.s-pd-compact) .s-gal-main,.s-img-c-circle .s-pd:not(.s-pd-compact).s-pr-auto .s-gal-main img{border-radius:22px}
.s-img-border .s-media::after,.s-img-border .s-gal-main::after{content:"";position:absolute;inset:0;border:var(--s-img-bw) solid var(--s-img-bc);border-radius:inherit;pointer-events:none}
.s-img-border .s-pr-auto .s-gal-main::after{border-radius:var(--s-img-r,var(--s-radius))}
.s-img-shadow .s-media,.s-img-shadow .s-gal-main{box-shadow:0 8px 22px var(--s-shadow)}
.s-img-shadow .s-pr-auto .s-gal-main{box-shadow:none}
.s-img-shadow .s-pr-auto .s-gal-main img{box-shadow:0 8px 22px var(--s-shadow)}
/* v0.1.428 — La vista previa del editor: tocar una parte lleva a su ajuste */
.s-pv-box{position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #2563eb;border-radius:6px;box-shadow:0 0 0 3px rgba(37,99,235,.18);transition:top .08s,left .08s,width .08s,height .08s;display:none}
.s-pv-chip{position:fixed;z-index:2147483001;display:none;align-items:center;gap:5px;height:24px;padding:0 9px 0 7px;border:0;border-radius:999px;background:#2563eb;color:#fff;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;box-shadow:0 4px 12px rgba(15,23,42,.25);white-space:nowrap}
.s-pv-chip svg{width:13px;height:13px}
.s-pv-chip:hover{background:#1d4ed8}
.s-pv-on [data-pv]{cursor:pointer}
.s-ssr{padding-top:28px}.s-ssr h1{margin:0 0 8px}.s-ssr-nav{margin:0 0 14px}.s-ssr-list{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:10px}.s-ssr-list a{font-weight:600}.s-ssr-price{font-weight:700;font-size:20px}.s-ssr img{max-width:min(100%,520px);height:auto;border-radius:var(--s-radius);margin:12px 0}
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
    /** v0.1.423 — La tienda en SU dominio: lo que leen los buscadores. */
    site?: ShopSiteHead | null;
}

/**
 * v0.1.423 — La cabecera de una página de la tienda en su dominio propio
 * (inicio o un producto): título, descripción, dirección canónica, imagen
 * para compartir, datos estructurados y el contenido que se ve sin
 * JavaScript (lo que lee un buscador antes de ejecutar la tienda).
 */
export interface ShopSiteHead {
    index: boolean;
    title: string;
    description: string;
    canonical: string;
    image: string | null;
    siteName: string;
    ogType: 'website' | 'product';
    jsonLd: unknown[];
    /** HTML ya escapado (se reemplaza al cargar la tienda). */
    body: string;
    productId: number | null;
    /** El título de la pestaña en el inicio (al cerrar un producto). */
    homeTitle: string;
}

export function renderShopPage(opts: ShopPageOpts): string {
    const site = opts.site ?? null;
    const boot = jsonForScript({
        token: opts.token,
        preview: opts.meta === null,
        meta: opts.meta,
        products: opts.products,
        scripts: opts.captchaScripts,
        ...(site ? { site: { product_id: site.productId, home_title: site.homeTitle } } : {}),
    });
    const nonce = opts.nonce ? ` nonce="${opts.nonce}"` : '';
    const main = opts.client
        ? `<script${nonce}>${inlineScriptText(opts.client)}</script>`
        : `<script type="module"${nonce} src="/app/public-shop/main.ts"></script>`;
    // v0.1.418 — Las etiquetas del enlace directo van ANTES de la tienda (expone `window.imbPixels`).
    const client = opts.meta?.conversion?.direct ? `<script>${directTagsScriptText()}</script>\n${main}` : main;
    const description = site
        ? siteHead(site)
        : opts.meta?.description
          ? `<meta name="description" content="${escapeHtml(opts.meta.description.slice(0, 200))}" />\n<meta property="og:title" content="${escapeHtml(opts.title)}" />\n`
          : `<meta property="og:title" content="${escapeHtml(opts.title)}" />\n`;
    // v0.1.422 — El estilo (armado en el servidor) va desde el primer pintado; la vista previa lo reemplaza en vivo.
    const design = opts.meta?.design;
    const designCss = design ? `<style id="s-design">${design.css.replace(/<\//g, '<\\/')}</style>\n` : '';
    const bodyCls = design?.classes ? ` class="${escapeHtml(design.classes)}"` : '';
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="${site?.index ? 'index, follow' : 'noindex, nofollow'}" />
<title>${escapeHtml(site ? site.title : opts.title)}</title>
${description}<style>${SHOP_CSS}</style>
${designCss}</head>
<body${bodyCls}>
<div id="app">${site ? site.body : ''}</div>
<noscript><div class="s-wrap"><p class="s-empty">Para comprar en esta tienda, activa JavaScript en tu navegador.</p></div></noscript>
<script type="application/json" id="boot">${boot}</script>
${client}
</body>
</html>`;
}

/** v0.1.423 — Título, descripción, canónica, Open Graph y JSON-LD (todo escapado). */
function siteHead(site: ShopSiteHead): string {
    const meta = (attr: 'name' | 'property', key: string, value: string): string => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />\n`;
    const out = [
        site.description ? meta('name', 'description', site.description) : '',
        `<link rel="canonical" href="${escapeHtml(site.canonical)}" />\n`,
        meta('property', 'og:type', site.ogType),
        meta('property', 'og:title', site.title),
        site.description ? meta('property', 'og:description', site.description) : '',
        meta('property', 'og:url', site.canonical),
        meta('property', 'og:site_name', site.siteName),
        site.image ? meta('property', 'og:image', site.image) : '',
        meta('name', 'twitter:card', site.image ? 'summary_large_image' : 'summary'),
        // Datos para los buscadores: `application/ld+json` no se ejecuta (la CSP no lo afecta).
        ...site.jsonLd.map((d) => `<script type="application/ld+json">${jsonForScript(d)}</script>\n`),
    ];
    return out.join('');
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
export function shopMessagePage(title: string, text: string, back: string | null = null, backText = 'Volver a mi pedido'): string {
    const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const link = back ? `<p style="margin-top:16px"><a href="${esc(back)}" style="color:#0e7490;font-weight:600">${esc(backText)}</a></p>` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${esc(title)}</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f7f9;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:440px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#6b7280;margin:0}</style></head>
<body><div><h1>${esc(title)}</h1><p>${esc(text)}</p>${link}</div></body></html>`;
}
