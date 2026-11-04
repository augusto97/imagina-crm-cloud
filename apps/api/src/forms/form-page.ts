import { randomBytes } from 'node:crypto';
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
 * etiqueta, descripción u opción llega como HTML. El script lleva nonce y
 * la CSP no deja correr otro.
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
    const c = captchaCspSources(captcha);
    const join = (base: string, extra: string[]): string => [base, ...extra].join(' ');
    return [
        "default-src 'none'",
        // En desarrollo el cliente es un módulo de vite que importa otros: 'self'.
        join(`script-src ${opts.dev ? "'self' " : ''}'nonce-${nonce}'`, c.script),
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

export function newNonce(): string {
    return randomBytes(16).toString('base64');
}

interface PageOpts {
    nonce: string;
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
 * EN LÍNEA con el nonce. Quien abre un formulario casi siempre lo abre una
 * sola vez: así llega todo en un solo viaje, sin esperar otro archivo.
 */
export function renderFormPage(opts: PageOpts): string {
    const boot = jsonForScript({ token: opts.token, preview: opts.meta === null, meta: opts.meta, scripts: CAPTCHA_SCRIPTS });
    const preload = opts.preloadFont
        ? `<link rel="preload" href="${escapeHtml(opts.preloadFont)}" as="font" type="font/woff2" crossorigin>\n`
        : '';
    const script = opts.client
        ? `<script nonce="${opts.nonce}">${opts.client.replace(/<\/script/gi, '<\\/script')}</script>`
        : `<script type="module" nonce="${opts.nonce}" src="/app/public-form/main.ts"></script>`;
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
 */
export const FORM_EMBED_JS = String.raw`(function () {
  if (window.__imbFormsEmbed) return;
  window.__imbFormsEmbed = true;
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
        var r = f.getBoundingClientRect();
        if (r.top < 0) window.scrollBy(0, r.top - 16);
      }
      return;
    }
  });
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
        : opts.continueUrl
          ? `<a class="ib-btn ib-btn-primary" href="${e(opts.continueUrl)}">Continuar</a>`
          : '';
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
${action}
</div></div></div></main></div></body></html>`;
}
