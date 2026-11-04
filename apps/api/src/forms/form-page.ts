import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    CAPTCHA_PROVIDER_INFO,
    DEFAULT_PUBLIC_THEME,
    PUBLIC_BASE_CSS,
    buildPublicThemeCss,
    captchaCspSources,
    type CaptchaProvider,
    type PublicFormMeta,
} from '@imagina-base/shared';

/**
 * v0.1.275 (ADR-S39) — Página pública de un formulario. La sirve el API
 * (`GET /api/v1/public/f/:token`) y no el SPA por la misma razón que la
 * lista pública (ADR-S14): el proxy le pone al SPA `frame-ancestors 'self'`
 * y eso no se cambia desde una actualización, mientras que aquí cada
 * formulario decide qué sitios lo pueden insertar.
 *
 * Todo el contenido se arma con `textContent`/`createElement`: ni una
 * etiqueta, descripción u opción llega como HTML. La CSP sólo deja correr
 * el script de la página (v0.1.352: autorizado por su hash, no por un nonce,
 * para que la página entera se pueda guardar y reusar).
 *
 * v0.1.351 (ADR-S94) — el cliente ya no vive aquí: es
 * `apps/web/app/public-form/main.ts`, compilado aparte a `form.js` (que se
 * sirve EN LÍNEA). El diseño sale del tema (`@imagina-base/shared`).
 *
 * v0.1.289 — varias páginas (un paso por vez con barra de progreso),
 * verificación anti-robots (sólo los dominios del proveedor elegido entran
 * a la CSP, y sólo si el formulario la pide) y la pantalla de «revisa tu
 * correo» del doble opt-in.
 */

export function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** `<script type="application/json">` seguro: nada puede cerrar la etiqueta. */
function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** Fuentes de `frame-ancestors`: sólo hosts/orígenes bien formados. */
export function formFrameAncestors(domains: string[]): string {
    const sources = domains
        .map((d) => d.trim())
        .filter((d) => d !== '')
        .map((d) => {
            if (d.includes('://')) {
                try {
                    return new URL(d).origin;
                } catch {
                    return null;
                }
            }
            return /^(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(d) ? d.toLowerCase() : null;
        })
        .filter((s): s is string => s !== null);
    return sources.length === 0 ? '*' : `'self' ${sources.join(' ')}`;
}

/**
 * CSP de la página. Con captcha se suman SÓLO los orígenes de ese proveedor
 * (script, marco del widget, verificación y estilos): un formulario sin
 * captcha no puede cargar nada de afuera.
 */
export function formPageCsp(nonce: string, frameAncestors: string, captcha: CaptchaProvider | null = null, opts: { dev?: boolean } = {}): string {
    return buildPageCsp(`'nonce-${nonce}'`, frameAncestors, captcha, opts);
}

/**
 * v0.1.352 (ADR-S95) — La CSP de una página que se guarda en caché: el script
 * en línea se autoriza por su HASH (es el mismo para todas las visitas de la
 * versión), no por un nonce, que tendría que ser distinto en cada respuesta y
 * por eso obligaba a armar la página de cero en cada carga.
 */
export function cacheablePageCsp(scriptHash: string | null, frameAncestors: string, captcha: CaptchaProvider | null = null, opts: { dev?: boolean } = {}): string {
    return buildPageCsp(scriptHash ? `'${scriptHash}'` : '', frameAncestors, captcha, opts);
}

function buildPageCsp(scriptToken: string, frameAncestors: string, captcha: CaptchaProvider | null, opts: { dev?: boolean }): string {
    const c = captchaCspSources(captcha);
    const join = (base: string, extra: string[]): string => [base, ...extra].join(' ');
    return [
        "default-src 'none'",
        // En desarrollo el cliente es un módulo de vite que importa otros: 'self'.
        join(['script-src', ...(opts.dev ? ["'self'"] : []), ...(scriptToken ? [scriptToken] : [])].join(' '), c.script),
        join("style-src 'unsafe-inline'", c.style),
        // v0.1.351 — sólo imágenes y fuentes propias: el CSS propio de una
        // empresa (ya limpio) tampoco podría cargar nada de afuera.
        "img-src 'self' data: blob:",
        "font-src 'self'",
        join(`connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`, c.connect),
        ...(c.frame.length > 0 ? [join('frame-src', c.frame)] : []),
        "form-action 'self'",
        "base-uri 'none'",
        `frame-ancestors ${frameAncestors}`,
    ].join('; ');
}

/** El texto exacto del script en línea (nada puede cerrar la etiqueta). */
export function inlineScriptText(js: string): string {
    return js.replace(/<\/script/gi, '<\\/script');
}

/** `sha256-…` del script en línea, para la CSP de una página cacheable. */
export function inlineScriptHash(js: string): string {
    return `sha256-${createHash('sha256').update(inlineScriptText(js), 'utf8').digest('base64')}`;
}

export function newNonce(): string {
    return randomBytes(16).toString('base64');
}

interface PageOpts {
    /**
     * Sin nonce (v0.1.352): la página se guarda en caché y la CSP autoriza el
     * script por su hash (`inlineScriptHash`). Con nonce: las páginas que se
     * arman en cada pedido (la vista previa del constructor).
     */
    nonce?: string;
    title: string;
    /** null = vista previa del editor: el diseño llega por postMessage. */
    meta: PublicFormMeta | null;
    token: string;
    /** v0.1.351 — CSS del tema (`buildPublicThemeCss`); en la vista previa lo reemplaza el editor. */
    themeCss: string;
    /** Clases del `<body>` (las del tema). */
    bodyClasses: string[];
    /** Fuente del texto a precargar (sólo si es una fuente web). */
    preloadFont: string | null;
    /** El script compilado (`form.js`) para servir EN LÍNEA; null = desarrollo (módulo de vite). */
    client: string | null;
}

/** Scripts de los widgets: el cliente los carga por URL, nunca otra. */
const CAPTCHA_SCRIPTS = Object.fromEntries(
    Object.entries(CAPTCHA_PROVIDER_INFO).map(([k, v]) => [k, v.script_url]),
) as Record<CaptchaProvider, string>;

function safeClasses(list: readonly string[]): string {
    return ['ib-body', ...list].map((c) => c.replace(/[^a-z0-9_-]/gi, '')).filter(Boolean).join(' ');
}

/**
 * v0.1.351 (ADR-S94) — El HTML de la página: la estructura y las variantes
 * (`PUBLIC_BASE_CSS`, fijo), el tema (`#ib-theme`) y el script del cliente
 * EN LÍNEA. Quien abre un formulario casi siempre lo abre una sola vez: así
 * llega todo en un solo viaje, sin esperar otro archivo. v0.1.352 (ADR-S95):
 * la página es igual para todos los visitantes (el sello anti-robots se pide
 * aparte al interactuar), así que se arma una vez, se comprime una vez y se
 * sirve desde memoria; la CSP autoriza el script por su hash.
 */
export function renderFormPage(opts: PageOpts): string {
    const boot = jsonForScript({ token: opts.token, preview: opts.meta === null, meta: opts.meta, scripts: CAPTCHA_SCRIPTS });
    const preload = opts.preloadFont
        ? `<link rel="preload" href="${escapeHtml(opts.preloadFont)}" as="font" type="font/woff2" crossorigin>\n`
        : '';
    const nonce = opts.nonce ? ` nonce="${opts.nonce}"` : '';
    const script = opts.client
        ? `<script${nonce}>${inlineScriptText(opts.client)}</script>`
        : `<script type="module"${nonce} src="/app/public-form/main.ts"></script>`;
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(opts.title)}</title>
${preload}<style>${PUBLIC_BASE_CSS}</style>
<style id="ib-theme">${opts.themeCss.replace(/<\/style/gi, '')}</style>
</head>
<body class="${safeClasses(opts.bodyClasses)}">
<div class="ib-bg" aria-hidden="true"><div class="ib-bg-img"></div></div>
<div id="app"></div>
<noscript><div class="ib-shell"><main class="ib-wrap"><div class="ib-card"><div class="ib-inner"><p>Para completar este formulario, activa JavaScript en tu navegador.</p></div></div></main></div></noscript>
<script type="application/json" id="boot">${boot}</script>
${script}
</body>
</html>`;
}

function clientCandidates(webDistDir: string): string[] {
    const entry = path.join('public-form', 'form.js');
    const out: string[] = [];
    if (webDistDir.trim() !== '') out.push(path.resolve(webDistDir, entry));
    out.push(
        // <release>/apps/api/dist/forms → <release>/web
        path.resolve(__dirname, '../../../../web', entry),
        path.resolve(process.cwd(), '../../web', entry),
        // repo: apps/api/{src,dist}/forms → apps/web/dist-cloud
        path.resolve(__dirname, '../../../web/dist-cloud', entry),
        path.resolve(process.cwd(), '../web/dist-cloud', entry),
    );
    return out;
}

let clientCache: string | null = null;

/** El script compilado del formulario (cacheado: cambia sólo con un release, que reinicia el proceso). */
export function loadFormClient(webDistDir: string): string | null {
    if (clientCache !== null) return clientCache;
    for (const file of clientCandidates(webDistDir)) {
        if (!existsSync(file)) continue;
        try {
            clientCache = readFileSync(file, 'utf8');
            return clientCache;
        } catch {
            // ilegible: probar el siguiente
        }
    }
    return null;
}

/** Sólo para tests. */
export function resetFormClientCache(): void {
    clientCache = null;
}

/** Producción sin el build del front (instalación rota): un aviso, no un 500. */
export function formMissingBuildPage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Formulario no disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>Este formulario no está disponible ahora</h1><p>Si eres quien administra la instalación, actualiza a la última versión.</p></div></body></html>`;
}

/**
 * Script de inserción (`/api/v1/public/f/embed.js`): el sitio de la empresa
 * lo carga junto al `<iframe data-imagina-form>`. Ajusta el alto del marco al
 * del formulario y sigue la redirección al enviar en la página entera. Sólo
 * atiende mensajes del marco y de su origen.
 *
 * v0.1.352 (ADR-S95) — dos formas más que NO cargan nada hasta que alguien
 * las usa: una **ventana emergente** que abre cualquier elemento con
 * `data-imagina-popup="<enlace>"` (al pasar el mouse ya empieza a cargar) y
 * un **botón flotante** (`data-imagina-float` en el propio script). Sólo abre
 * enlaces de formularios o agendas del origen desde donde se cargó el script.
 * Todo el estilo va por `element.style` (no `<style>` ni atributos), así
 * funciona aunque el sitio tenga una CSP estricta.
 *
 * v0.1.359 — la ventana se abre de tres maneras (`data-imagina-open`): al
 * centro (por defecto), como **panel lateral** (`side`, desde la derecha o la
 * izquierda según `data-imagina-side`) o a **pantalla completa** (`full`).
 */
export const FORM_EMBED_JS = String.raw`(function () {
  var me = document.currentScript;
  // Puede haber más de un script en la página (un formulario insertado y un
  // botón flotante): lo general se arma una vez y cada script suma lo suyo.
  if (window.__imbFormsEmbed && typeof window.__imbFormsEmbed === 'object') { window.__imbFormsEmbed.add(me); return; }

  // Los orígenes de la app (de donde se cargó el script): sólo se abren
  // formularios y agendas de ESOS orígenes, nunca otra dirección.
  var origins = {};

  function safeUrl(raw) {
    if (!raw) return null;
    try {
      var u = new URL(raw, location.href);
      if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
      if (!origins[u.origin]) return null;
      if (!/^\/api\/v1\/public\/(f|b)\//.test(u.pathname)) return null;
      return u.href;
    } catch (e) { return null; }
  }

  // ───────────── Mensajes de los marcos (insertados y ventanas) ─────────────
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
    var frames = document.querySelectorAll('iframe[data-imagina-form]');
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.contentWindow !== e.source) continue;
      var origin;
      try { origin = new URL(f.src, location.href).origin; } catch (x) { return; }
      if (e.origin !== origin) return;
      if (d.type === 'imb-form-height' && typeof d.height === 'number' && d.height > 0 && d.height < 20000) {
        f.style.height = Math.ceil(d.height) + 'px';
      } else if (d.type === 'imb-form-redirect' && typeof d.url === 'string' && /^https:\/\//i.test(d.url)) {
        window.location.href = d.url;
      } else if (d.type === 'imb-form-submitted') {
        if (f.getAttribute('data-imagina-popup-frame') !== null) { f.setAttribute('data-imagina-done', ''); return; }
        var r = f.getBoundingClientRect();
        if (r.top < 0) window.scrollBy(0, r.top - 16);
      }
      return;
    }
  });

  // ───────────── Ventana emergente (se carga al hacer clic) ─────────────
  // Una ventana por dirección, armada UNA vez (al pasar el mouse o al hacer
  // clic) y después sólo mostrada u ocultada: mover un iframe de lugar en el
  // DOM lo vuelve a cargar, así que el marco nunca cambia de padre.
  var popups = {};
  var open = null;

  function css(el, props) { for (var k in props) el.style[k] = props[k]; return el; }
  function small() { return window.innerWidth < 600; }
  function still() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  // Cómo se abre: al centro, panel lateral o pantalla completa.
  function styleOf(raw) { return raw === 'side' || raw === 'full' ? raw : 'window'; }
  function sideOf(raw) { return raw === 'left' ? 'left' : 'right'; }

  function layout(p) {
    var s = small();
    if (p.style === 'full') {
      css(p.overlay, { padding: '0', alignItems: 'stretch', justifyContent: 'center' });
      css(p.panel, { width: '100%', height: '100%', maxHeight: '100%', borderRadius: '0' });
    } else if (p.style === 'side') {
      css(p.overlay, { padding: '0', alignItems: 'stretch', justifyContent: p.side === 'left' ? 'flex-start' : 'flex-end' });
      css(p.panel, { width: s ? '100%' : 'min(480px, 100%)', height: '100%', maxHeight: '100%', borderRadius: '0' });
    } else {
      css(p.overlay, { padding: s ? '0' : '16px', alignItems: 'center', justifyContent: 'center' });
      css(p.panel, {
        width: s ? '100%' : 'min(680px, 100%)', height: s ? '100%' : 'auto',
        maxHeight: s ? '100%' : 'calc(100vh - 32px)', borderRadius: s ? '0' : '14px'
      });
    }
  }

  // El panel lateral entra deslizándose desde su lado (sin animación si la
  // persona pidió menos movimiento).
  function slide(p, shown) {
    if (p.style !== 'side') return;
    p.panel.style.transition = still() ? 'none' : 'transform .22s ease';
    p.panel.style.transform = shown ? 'none' : 'translateX(' + (p.side === 'left' ? '-' : '') + '100%)';
  }

  function hide(p) {
    css(p.overlay, { visibility: 'hidden', opacity: '0' });
    p.overlay.setAttribute('aria-hidden', 'true');
    slide(p, false);
  }

  function build(url, title, style, side) {
    style = styleOf(style);
    side = sideOf(side);
    var key = url + '|' + style + '|' + side;
    var p = popups[key];
    if (p && p.frame.getAttribute('data-imagina-done') !== null) {
      // Ya se envió: la próxima vez arranca de cero.
      if (p.overlay.parentNode) p.overlay.parentNode.removeChild(p.overlay);
      p = null;
    }
    if (p) return p;
    var overlay = css(document.createElement('div'), {
      position: 'fixed', inset: '0', zIndex: '2147483000', background: 'rgba(15,23,42,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity .15s'
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title || 'Formulario');
    var panel = css(document.createElement('div'), {
      position: 'relative', background: '#fff', overflowY: 'auto',
      boxShadow: '0 24px 60px rgba(15,23,42,.35)', WebkitOverflowScrolling: 'touch'
    });
    var x = css(document.createElement('button'), {
      position: 'sticky', top: '8px', float: 'right', marginRight: '8px', marginTop: '8px', zIndex: '2',
      width: '36px', height: '36px', borderRadius: '999px', border: '0', cursor: 'pointer',
      background: 'rgba(255,255,255,.92)', boxShadow: '0 1px 4px rgba(15,23,42,.25)', color: '#1d2330',
      font: '600 20px/36px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif', padding: '0'
    });
    x.type = 'button';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '×';
    x.addEventListener('click', close);
    var f = document.createElement('iframe');
    f.src = url;
    f.title = title || 'Formulario';
    f.setAttribute('data-imagina-form', '');
    f.setAttribute('data-imagina-popup-frame', '');
    f.setAttribute('allow', 'payment');
    css(f, { width: '100%', height: '560px', border: '0', display: 'block', background: 'transparent' });
    // De lado o a pantalla completa, el formulario llena el alto disponible.
    if (style !== 'window') f.style.minHeight = '100%';
    panel.appendChild(x);
    panel.appendChild(f);
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    p = { overlay: overlay, panel: panel, frame: f, close: x, style: style, side: side };
    layout(p);
    hide(p);
    document.body.appendChild(overlay);
    popups[key] = p;
    return p;
  }

  // Al pasar el mouse (o tocar) se empieza a cargar: al hacer clic ya está.
  function preload(t) {
    if (!t || !t.url || popups[t.url + '|' + styleOf(t.style) + '|' + sideOf(t.side)]) return;
    build(t.url, t.title, t.style, t.side);
  }

  function close() {
    if (!open) return;
    var o = open;
    open = null;
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.style.overflow = o.overflow;
    hide(o.p);
    if (o.opener && o.opener.focus) { try { o.opener.focus(); } catch (e) {} }
  }

  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

  function openPopup(t) {
    if (open) close();
    var p = build(t.url, t.title, t.style, t.side);
    layout(p);
    css(p.overlay, { visibility: 'visible', opacity: '1' });
    p.overlay.removeAttribute('aria-hidden');
    // Un cuadro después, para que el navegador vea el panel afuera y lo deslice.
    if (p.style === 'side') requestAnimationFrame(function () { slide(p, true); });
    var opener = t.el;
    open = { p: p, opener: opener, overflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    try { p.close.focus(); } catch (e) {}
  }

  function targetOf(el) {
    var t = el && el.closest ? el.closest('[data-imagina-popup]') : null;
    if (!t) return null;
    var url = safeUrl(t.getAttribute('data-imagina-popup') || t.getAttribute('href'));
    return url
      ? {
          el: t, url: url, title: t.getAttribute('data-imagina-title') || '',
          style: t.getAttribute('data-imagina-open') || '', side: t.getAttribute('data-imagina-side') || ''
        }
      : null;
  }

  document.addEventListener('click', function (e) {
    var t = targetOf(e.target);
    if (!t) return;
    e.preventDefault();
    openPopup(t);
  });
  ['mouseover', 'focusin', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      preload(targetOf(e.target));
    }, { passive: true });
  });

  // ───────────── Botón flotante ─────────────
  function contrast(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#111827' : '#fff';
  }

  function floating(me) {
    if (!me) return;
    var url = safeUrl(me.getAttribute('data-imagina-float'));
    if (!url) return;
    var color = /^#[0-9a-f]{6}$/i.test(me.getAttribute('data-imagina-color') || '') ? me.getAttribute('data-imagina-color') : '#0e7490';
    var left = me.getAttribute('data-imagina-position') === 'left';
    var title = me.getAttribute('data-imagina-title') || '';
    var b = css(document.createElement('button'), {
      position: 'fixed', bottom: '20px', zIndex: '2147482999', padding: '12px 20px', borderRadius: '999px', border: '0',
      background: color, color: contrast(color), cursor: 'pointer', boxShadow: '0 10px 30px rgba(15,23,42,.28)',
      font: '600 15px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'
    });
    b.style[left ? 'left' : 'right'] = '20px';
    b.type = 'button';
    b.textContent = me.getAttribute('data-imagina-label') || 'Escríbenos';
    b.setAttribute('data-imagina-popup', url);
    if (title) b.setAttribute('data-imagina-title', title);
    // v0.1.359 — el panel lateral sale del mismo lado que el botón.
    var how = styleOf(me.getAttribute('data-imagina-open'));
    if (how !== 'window') b.setAttribute('data-imagina-open', how);
    if (how === 'side') b.setAttribute('data-imagina-side', left ? 'left' : 'right');
    b.setAttribute('aria-haspopup', 'dialog');
    document.body.appendChild(b);
  }
  function add(script) {
    try { if (script && script.src) origins[new URL(script.src, location.href).origin] = true; } catch (e) {}
    if (document.body) floating(script);
    else document.addEventListener('DOMContentLoaded', function () { floating(script); });
  }
  window.__imbFormsEmbed = { add: add };
  add(me);
})();
`;

// ─────────────────── Confirmación del correo (v0.1.289) ───────────────────

export interface FormNoticeBrand {
    company: string;
    accent: string;
    logoUrl: string | null;
    /** v0.1.351 — el diseño del formulario (CSS y clases); sin él, el clásico con el acento. */
    themeCss?: string;
    bodyClasses?: string[];
}

/**
 * Página del enlace de confirmación (doble opt-in) y de su resultado, con la
 * MARCA de la empresa y, desde v0.1.351, el diseño del formulario. La página
 * de llegada (`confirmAction`) es un formulario que se envía solo (POST): los
 * escáneres de correo abren los enlaces con GET para revisarlos; si el GET
 * confirmara, la respuesta quedaría confirmada sin que la persona hiciera
 * nada. Sin JavaScript, el botón hace lo mismo.
 */
export function renderFormNoticePage(opts: {
    nonce: string;
    brand: FormNoticeBrand;
    title: string;
    message: string;
    tone: 'ok' | 'info' | 'error';
    /** Acción POST que confirma (sólo en la página de llegada). */
    confirmAction?: string;
    /** Botón «Continuar» (la redirección del formulario, https). */
    continueUrl?: string | null;
    /** v0.1.361 — Con cobro al enviar: el botón para pagar (va antes que «Continuar»). */
    pay?: { url: string; label: string; amountText: string } | null;
    /** v0.1.361 — No se pudo armar el pago (la respuesta sí quedó guardada). */
    payError?: string | null;
}): string {
    const e = escapeHtml;
    const accent = /^#[0-9a-fA-F]{6}$/.test(opts.brand.accent) ? opts.brand.accent : '#0e7490';
    const themeCss = opts.brand.themeCss ?? buildPublicThemeCss(DEFAULT_PUBLIC_THEME, { accent });
    const icon = opts.tone === 'ok' ? '✓' : opts.tone === 'error' ? '!' : '✉';
    const logo = opts.brand.logoUrl
        ? `<header class="ib-header"><div class="ib-logo"><img src="${e(opts.brand.logoUrl)}" alt="${e(opts.brand.company)}"></div></header>`
        : opts.brand.company
          ? `<header class="ib-header"><div class="ib-logo">${e(opts.brand.company)}</div></header>`
          : '';
    const action = opts.confirmAction
        ? `<form method="post" action="${e(opts.confirmAction)}" id="confirm"><button type="submit" class="ib-btn ib-btn-primary">Confirmar mi correo</button></form>
<script nonce="${opts.nonce}">(function(){var f=document.getElementById('confirm');if(f){var b=f.querySelector('button');b.disabled=true;b.textContent='Confirmando…';f.submit();}})();</script>`
        : opts.pay && /^https?:\/\//.test(opts.pay.url)
          ? `<p class="ib-pay-total" data-testid="form-notice-pay-total">Total a pagar: <strong>${e(opts.pay.amountText)}</strong></p>
<a class="ib-btn ib-btn-primary" href="${e(opts.pay.url)}" rel="noopener" data-testid="form-notice-pay">${e(opts.pay.label)}</a>`
          : opts.continueUrl
            ? `<a class="ib-btn ib-btn-primary" href="${e(opts.continueUrl)}">Continuar</a>`
            : '';
    const payError = opts.payError ? `<p class="ib-pay-error" data-testid="form-notice-pay-error">${e(opts.payError)}</p>` : '';
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<title>${e(opts.title)}</title>
<style>${PUBLIC_BASE_CSS}</style>
<style>${themeCss.replace(/<\/style/gi, '')}</style></head>
<body class="${safeClasses(opts.brand.bodyClasses ?? [])}"><div class="ib-bg" aria-hidden="true"><div class="ib-bg-img"></div></div>
<div class="ib-shell"><main class="ib-wrap"><div class="ib-card"><div class="ib-band"></div><div class="ib-inner">
${logo}
<div class="ib-done" data-testid="form-notice" data-tone="${opts.tone}">
<div class="ib-tick${opts.tone === 'error' ? ' ib-tick-error' : ''}" aria-hidden="true">${icon}</div>
<h2>${e(opts.title)}</h2>
<p>${e(opts.message)}</p>
${payError}
${action}
</div></div></div></main></div></body></html>`;
}
