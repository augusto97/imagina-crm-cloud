import {
    BOOKING_CLASSIC_THEME,
    CAPTCHA_PROVIDER_INFO,
    PUBLIC_BASE_CSS,
    buildPublicThemeCss,
    publicThemeView,
    type BookingDisplay,
    type CaptchaProvider,
    type PublicBookingMeta,
    type PublicManageMeta,
    type PublicThemeView,
} from '@imagina-base/shared';
import { escapeHtml, inlineScriptHash, inlineScriptText } from '../forms/form-page';

/**
 * D5 — Página pública de una agenda (`/api/v1/public/b/:token`), la de
 * gestión de una cita (`/api/v1/public/b/manage/:ref`) y la vista previa del
 * constructor (`/api/v1/public/b/preview`). La sirve el API —no el SPA— por
 * la misma razón que los formularios (ADR-S39): cada página decide qué sitios
 * la pueden insertar (`frame-ancestors`) y tiene su propia CSP con nonce.
 *
 * Todo el contenido se arma con `textContent`/`createElement`: ni un nombre
 * de servicio, ni una descripción ni una pregunta llegan como HTML.
 *
 * Insertada en un sitio habla el MISMO protocolo que un formulario
 * (`imb-form-height`…), así el script de inserción de los formularios
 * (`/api/v1/public/f/embed.js`) le ajusta el alto sin otro script.
 */

function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const CAPTCHA_SCRIPTS = Object.fromEntries(Object.entries(CAPTCHA_PROVIDER_INFO).map(([k, v]) => [k, v.script_url])) as Record<CaptchaProvider, string>;

/**
 * v0.1.354 — Lo propio de la página de reservas, sobre la estructura y las
 * variantes de los formularios (`PUBLIC_BASE_CSS`) y las variables del tema
 * (`#ib-theme`, ADR-S94): colores, tipografía, tamaños y esquinas salen del
 * tema; aquí sólo va lo que no tiene un formulario (opciones con foto, el
 * calendario, los horarios, el resumen). Las clases `.ib-…` son las que se
 * documentan para el CSS propio.
 */
const BOOKING_CSS = `
.bk-root{container-type:inline-size}
.ib-no-title .bk-manage-title{display:block}
.ib-header .ib-loc{color:var(--ib-muted);font-size:calc(var(--ib-fs) - 1px);margin:4px 0 0}
.bk-hide-loc .ib-loc,.bk-hide-loc .loc2{display:none}
.ib-step-title{font-family:var(--ib-heading-font);font-size:calc(var(--ib-q-fs) + 2px);font-weight:650;line-height:1.3;margin:0 0 12px}
.steps{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:18px 0 14px;font-size:13px;color:var(--ib-muted)}
.bk-progress{margin:-6px 0 16px}
.back{appearance:none;border:0;background:none;padding:6px 0;font:inherit;color:var(--ib-text);cursor:pointer;display:inline-flex;gap:6px;align-items:center;min-height:36px}
.back:hover{text-decoration:underline}
.choices{display:grid;gap:10px}
.opt{appearance:none;text-align:left;width:100%;border:var(--ib-input-bw,1px) solid var(--ib-input-border);background:var(--ib-input-bg);border-radius:min(var(--ib-choice-radius),24px);padding:12px 14px;font:inherit;color:var(--ib-text);cursor:pointer;display:flex;justify-content:space-between;gap:12px;align-items:center;min-height:52px;transition:border-color .15s,box-shadow .15s,background-color .15s}
.opt:hover,.opt:focus-visible{border-color:var(--ib-accent);outline:none;box-shadow:0 0 0 3px var(--ib-accent-ring)}
.opt .t{font-weight:600;overflow-wrap:anywhere}
.opt.cur{border-color:var(--ib-accent)}
.opt .s{color:var(--ib-muted);font-size:13px}
.opt .d{color:var(--ib-muted);font-size:13px;margin-top:2px;white-space:pre-wrap}
.opt .r{color:var(--ib-muted);font-size:13px;white-space:nowrap}
.bk-ch-buttons .choices,.bk-ch-cards .choices{grid-template-columns:repeat(var(--bk-cols,2),minmax(0,1fr))}
.bk-ch-buttons .opt{justify-content:center;text-align:center;border-radius:max(var(--ib-choice-radius),6px);min-height:0;padding:12px 14px}
.bk-ch-buttons .opt .d,.bk-ch-buttons .opt .loc2,.bk-ch-buttons .opt .r{display:none}
.bk-ch-buttons .who{flex-direction:column;gap:6px;text-align:center}
.bk-ch-cards .opt{flex-direction:column;align-items:stretch;text-align:left;padding:16px}
.bk-ch-cards .opt .r{order:-1;align-self:flex-start;font-weight:600;color:var(--ib-accent-text)}
.bk-ch-cards .who{flex-direction:column;align-items:flex-start;gap:10px}
.bk-ch-cards .avatar{width:64px;height:64px;font-size:20px}
@container (max-width:420px){.bk-ch-buttons .choices,.bk-ch-cards .choices{grid-template-columns:repeat(min(var(--bk-cols,2),2),minmax(0,1fr))}}
.bk-hide-sdetails .opt .s:not(.loc2),.bk-hide-sdetails .opt .d{display:none}
.bk-hide-prices .opt .r{display:none}
.bk-hide-photos .opt .avatar:not(.any){display:none}
.bk-hide-stdetails [data-staff] .s,.bk-hide-stdetails [data-staff] .d{display:none}
.who{display:flex;align-items:center;gap:12px}
.avatar{flex:none;width:44px;height:44px;border-radius:50%;background:var(--ib-accent-soft);color:var(--ib-text);display:inline-flex;align-items:center;justify-content:center;font-weight:650;font-size:15px;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.avatar.any{color:var(--ib-accent-text)}
.durs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px}
.dur{appearance:none;border:var(--ib-input-bw,1px) solid var(--ib-input-border);background:var(--ib-input-bg);color:var(--ib-text);border-radius:99px;padding:6px 14px;font:inherit;font-size:14px;cursor:pointer;min-height:36px}
.dur.on{background:var(--ib-accent);color:var(--ib-accent-ink);border-color:var(--ib-accent);font-weight:600}
.dur:focus-visible{outline:2px solid var(--ib-accent);outline-offset:2px}
.slot .seats{display:block;font-size:11px;font-weight:500;opacity:.8}
.chip{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--ib-accent-soft);color:var(--ib-text);font-size:12px}
.summary{border:1px solid var(--ib-border);border-radius:min(var(--ib-choice-radius),14px);padding:10px 12px;margin-bottom:14px;font-size:14px;background:var(--ib-soft)}
.summary b{font-weight:600}
.summary .row{display:flex;gap:8px;padding:2px 0}
.summary .row span:first-child{color:var(--ib-muted);min-width:88px}
.tz{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13px;color:var(--ib-muted);margin:0 0 12px}
.tz select{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--ib-input-border);border-radius:6px;background:var(--ib-input-bg);color:var(--ib-text)}
.cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.cal-head b{font-size:16px}
.nav{appearance:none;border:1px solid var(--ib-border);background:var(--ib-card);border-radius:min(var(--ib-choice-radius),10px);width:40px;height:40px;font-size:18px;cursor:pointer;color:var(--ib-text)}
.nav[disabled]{opacity:.35;cursor:default}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.datepick{display:grid;gap:18px}
.datepick h2.day-title{margin:0 0 4px}
.bk-cal{width:100%;max-width:440px}
.ib-header-center .bk-cal-stacked .bk-cal,.bk-cal-stacked.ib-header-center .bk-cal{margin:0 auto}
@container (min-width:560px){
.bk-cal-side .datepick{grid-template-columns:minmax(0,330px) minmax(0,1fr);align-items:start;gap:24px}
.bk-cal-side .datepick .slots{grid-template-columns:repeat(auto-fill,minmax(92px,1fr))}
}
.dow{text-align:center;font-size:11px;color:var(--ib-muted);text-transform:uppercase;padding:4px 0}
.day{appearance:none;border:0;background:transparent;border-radius:min(var(--ib-choice-radius),12px);aspect-ratio:1/1;font:inherit;font-size:15px;color:color-mix(in srgb,var(--ib-muted) 55%,transparent);cursor:default;position:relative;min-height:40px}
.day.on{background:var(--ib-accent-soft);color:var(--ib-text);font-weight:600;cursor:pointer}
.day.on:hover,.day.on:focus-visible{outline:2px solid var(--ib-accent)}
.day.sel{background:var(--ib-accent);color:var(--ib-accent-ink)}
.day.today::after{content:'';position:absolute;left:50%;bottom:6px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:currentColor}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin-top:14px}
.slot{appearance:none;border:var(--ib-input-bw,1px) solid var(--ib-accent);background:var(--ib-input-bg);color:var(--ib-text);border-radius:var(--ib-choice-radius);padding:10px 8px;font:inherit;font-weight:600;cursor:pointer;min-height:44px}
.slot:hover,.slot:focus-visible{background:var(--ib-accent);color:var(--ib-accent-ink);outline:none}
.bk-slots-list .slots,.bk-slots-list.bk-cal-side .datepick .slots{grid-template-columns:1fr}
.bk-slots-list .slot{text-align:left;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}
.bk-slots-list .slot .seats{display:inline}
.empty,.loading{color:var(--ib-muted);font-size:14px;padding:12px 0}
.bk-form{display:flex;flex-direction:column;gap:var(--ib-gap)}
.bk-form .ib-item{grid-column:auto}
.chk{display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin:6px 0}
.chk input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--ib-accent);flex:none}
.note-ok{border:1px solid color-mix(in srgb,#067647 35%,transparent);background:color-mix(in srgb,#067647 10%,var(--ib-card));color:var(--ib-text);border-radius:10px;padding:10px 12px;margin:12px 0;font-size:14px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.ib-btn-align-center .actions{justify-content:center}
.ib-btn-align-right .actions{justify-content:flex-end}
.ib-btn-full .actions .ib-btn{flex:1}
@media (max-width:520px){.actions .ib-btn{flex:1 1 100%}}
.btn-danger{background:var(--ib-error)!important;color:#fff!important;border-color:var(--ib-error)!important}
.done{text-align:center;padding:8px 0 4px}
.tick{width:54px;height:54px;border-radius:50%;background:var(--ib-accent);color:var(--ib-accent-ink);display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:10px}
.tick.x{background:var(--ib-soft);color:var(--ib-muted)}
.tick.wait{background:color-mix(in srgb,#6d28d9 14%,var(--ib-card));color:#6d28d9}
.badge-pending{display:inline-block;margin:0 0 12px;padding:3px 10px;border-radius:99px;background:color-mix(in srgb,#6d28d9 14%,var(--ib-card));color:color-mix(in srgb,#6d28d9 80%,var(--ib-text));font-size:13px;font-weight:600}
.code-input{font-size:26px!important;letter-spacing:10px;text-align:center;font-variant-numeric:tabular-nums;max-width:240px}
.done .summary{text-align:left;margin-top:14px}
.muted{color:var(--ib-muted)}
.small{font-size:13px}
.captcha{margin-top:16px;min-height:66px}
.pv{border:1.5px dashed var(--ib-border);border-radius:8px;padding:10px;color:var(--ib-muted);font-size:13px;text-align:center;margin-top:12px}
`;

export interface BookingPageBoot {
    mode: 'book' | 'manage' | 'preview';
    /** Token de la página (book) o referencia firmada de la cita (manage). */
    token: string;
    meta: PublicBookingMeta | null;
    manage: PublicManageMeta | null;
    /** `?accion=cancelar`: la página de gestión abre directo la cancelación. */
    action?: 'cancel' | null;
}

/**
 * v0.1.352 (ADR-S95) — `sha256-…` del script de la agenda: la página de
 * reservar se guarda en caché y la CSP autoriza el script por su hash (es el
 * mismo para todas las visitas), no con un nonce distinto por respuesta.
 */
let clientHash: string | null = null;
export function bookingClientHash(): string {
    clientHash ??= inlineScriptHash(CLIENT_JS);
    return clientHash;
}

/**
 * v0.1.354 — Las clases del `<body>`: las del tema (ADR-S94) más lo propio de
 * la agenda (qué se muestra y cómo se distribuye). El cliente las vuelve a
 * poner igual al arrancar; venir ya en el HTML evita un salto al cargar.
 */
export function bookingBodyClasses(view: PublicThemeView | null | undefined, display: Partial<BookingDisplay> | null | undefined): string[] {
    const d = display ?? {};
    const out = [...(view?.classes ?? [])];
    out.push(`bk-ch-${view?.choice_style ?? 'list'}`);
    out.push(`bk-cal-${d.calendar_layout === 'stacked' ? 'stacked' : 'side'}`);
    out.push(`bk-slots-${d.slot_style === 'list' ? 'list' : 'grid'}`);
    if (d.show_location === false) out.push('bk-hide-loc');
    if (d.show_service_details === false) out.push('bk-hide-sdetails');
    if (d.show_prices === false) out.push('bk-hide-prices');
    if (d.show_staff_photos === false) out.push('bk-hide-photos');
    if (d.show_staff_details === false) out.push('bk-hide-stdetails');
    return out;
}

function safeClasses(list: readonly string[]): string {
    return ['ib-body', ...list].map((c) => c.replace(/[^a-z0-9_-]/gi, '')).filter(Boolean).join(' ');
}

/** El diseño de siempre de la agenda (la vista previa arranca con él hasta que el editor manda el suyo). */
export function bookingClassicLook(accent = '#0e7490'): { css: string; classes: string[] } {
    return { css: buildPublicThemeCss(BOOKING_CLASSIC_THEME, { accent }), classes: bookingBodyClasses(publicThemeView(BOOKING_CLASSIC_THEME), null) };
}

export function renderBookingPage(opts: {
    nonce?: string;
    title: string;
    boot: BookingPageBoot;
    /** v0.1.354 — CSS del tema (`buildPublicThemeCss`). */
    themeCss: string;
    bodyClasses: string[];
    preloadFont?: string | null;
}): string {
    const boot = jsonForScript({ ...opts.boot, scripts: CAPTCHA_SCRIPTS });
    const nonce = opts.nonce ? ` nonce="${opts.nonce}"` : '';
    const preload = opts.preloadFont
        ? `<link rel="preload" href="${escapeHtml(opts.preloadFont)}" as="font" type="font/woff2" crossorigin>\n`
        : '';
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(opts.title)}</title>
${preload}<style>${PUBLIC_BASE_CSS}${BOOKING_CSS}</style>
<style id="ib-theme">${opts.themeCss.replace(/<\/style/gi, '')}</style>
</head>
<body class="${safeClasses(opts.bodyClasses)}">
<div class="ib-bg" aria-hidden="true"><div class="ib-bg-img"></div></div>
<div id="app"></div>
<noscript><div class="ib-shell"><main class="ib-wrap"><div class="ib-card"><div class="ib-inner"><p>Para agendar una cita, activa JavaScript en tu navegador.</p></div></div></main></div></noscript>
<script type="application/json" id="boot">${boot}</script>
<script${nonce}>${inlineScriptText(CLIENT_JS)}</script>
</body>
</html>`;
}

export function bookingNotAvailablePage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Agenda no disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>Esta agenda no está disponible</h1><p>Puede que la dirección esté mal escrita o que ya no reciba reservas.</p></div></body></html>`;
}

export function appointmentNotFoundPage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Cita no encontrada</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}</style></head>
<body><div><h1>No encontramos esta cita</h1><p>Revisa que el enlace esté completo (cópialo del correo que te enviamos).</p></div></body></html>`;
}

/**
 * Cliente de la página. Los horarios los calcula SIEMPRE el servidor; aquí se
 * agrupan por día en el reloj elegido para mostrarlos (el del visitante o el
 * de la empresa) y se arma la pantalla.
 */
const CLIENT_JS = String.raw`
(function () {
  'use strict';
  var BOOT = JSON.parse(document.getElementById('boot').textContent);
  var MODE = BOOT.mode;
  var app = document.getElementById('app');
  var root = null;
  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  // v0.1.369 — en la ventana o el panel de embed.js, «Sin marco» no aplica.
  var inPopup = embedded && window.name === 'imagina-popup';
  var PREVIEW = MODE === 'preview';
  var API = MODE === 'manage'
    ? '/api/v1/public/booking/manage/' + encodeURIComponent(BOOT.token)
    : '/api/v1/public/booking/' + encodeURIComponent(BOOT.token);

  var meta = MODE === 'manage' && BOOT.manage ? BOOT.manage.booking : BOOT.meta;
  var manage = BOOT.manage;
  var visitorTz = 'UTC';
  try { visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
  var st = {
    step: 'service', service: null, duration: null, staff: 'any', month: null, day: null, slot: null,
    showTz: null, values: {}, busy: false, cache: {}, alert: '', errors: {}, done: null, cancelOpen: false,
    // v0.1.353 — el código del correo: a qué correo se mandó y la prueba que devuelve el servidor.
    codeSent: null, proof: null, codeValue: ''
  };
  var captchaToken = null, captchaWidget = null;
  var pvReq = 0, pvWait = {};

  // v0.1.352 — el sello anti-robots ya no viaja en la página (así se puede
  // guardar en caché): se pide al primer contacto y, si alguien reserva muy
  // rápido, se espera lo que falte antes de mandar.
  var stampReq = null;
  function ensureStamp() {
    if (meta && meta.stamp) return Promise.resolve({ stamp: meta.stamp, at: 0 });
    if (!stampReq) {
      stampReq = fetch(API + '/stamp', { headers: { accept: 'application/json' }, cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('stamp'); return r.json(); })
        .then(function (j) { if (!j || !j.stamp) throw new Error('stamp'); return { stamp: j.stamp, at: Date.now() }; })
        .catch(function (e) { stampReq = null; throw e; });
    }
    return stampReq;
  }
  function readyStamp() {
    return ensureStamp().then(function (s) {
      var wait = s.at + 2600 - Date.now();
      return wait > 0 ? new Promise(function (r) { setTimeout(function () { r(s.stamp); }, wait); }) : s.stamp;
    });
  }
  if (MODE === 'book') {
    ['pointerdown', 'focusin', 'keydown', 'touchstart'].forEach(function (ev) {
      app.addEventListener(ev, function () { ensureStamp().catch(function () {}); }, { once: true, passive: true });
    });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'cls') n.className = attrs[k];
      else if (k === 'on') { for (var ev in attrs.on) n.addEventListener(ev, attrs.on[ev]); }
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  // ── v0.1.354 — La estructura del diseño (ADR-S94): la arman el tema y lo que se muestra ──
  function view() { return meta && meta.theme ? meta.theme : null; }
  function applyBodyClasses() {
    var v = view(), d = (meta && meta.display) || {};
    var cls = ['ib-body'].concat(v && v.classes ? v.classes : []);
    if (embedded && !PREVIEW) cls.push('ib-embedded');
    if (embedded && !PREVIEW && !inPopup && v && v.embed_bare) cls.push('ib-embed-bare');
    else if (embedded && !PREVIEW && v && v.embed_background) cls.push('ib-embed-bg');
    cls.push('bk-ch-' + (v && v.choice_style ? v.choice_style : 'list'));
    cls.push('bk-cal-' + (d.calendar_layout === 'stacked' ? 'stacked' : 'side'));
    cls.push('bk-slots-' + (d.slot_style === 'list' ? 'list' : 'grid'));
    if (d.show_location === false) cls.push('bk-hide-loc');
    if (d.show_service_details === false) cls.push('bk-hide-sdetails');
    if (d.show_prices === false) cls.push('bk-hide-prices');
    if (d.show_staff_photos === false) cls.push('bk-hide-photos');
    if (d.show_staff_details === false) cls.push('bk-hide-stdetails');
    document.body.className = cls.filter(function (c) { return /^[a-z0-9_-]+$/i.test(c); }).join(' ');
    document.documentElement.style.setProperty('--bk-cols', String(v && v.choice_columns > 1 ? v.choice_columns : 2));
  }
  function buildShell() {
    var v = view();
    var card = el('div', { cls: 'ib-card' });
    if (v && v.cover) card.appendChild(el('div', { cls: 'ib-cover', role: 'presentation' }));
    else if (!v || v.band) card.appendChild(el('div', { cls: 'ib-band' }));
    root = el('div', { cls: 'ib-inner bk-root', id: 'root', 'data-testid': 'booking-root' });
    card.appendChild(root);
    var kids = [];
    if (v && v.split) {
      var media = el('aside', { cls: 'ib-split-media', 'aria-hidden': v.split.headline ? null : 'true' });
      if (v.split.headline) media.appendChild(el('div', { cls: 'ib-split-headline', text: v.split.headline }));
      kids.push(media);
    }
    kids.push(el('main', { cls: 'ib-wrap' }, [card]));
    app.textContent = '';
    app.appendChild(el('div', { cls: 'ib-shell' }, kids));
    applyBodyClasses();
  }
  // Los campos de los datos del cliente toman el estilo del tema.
  function themeInputs() {
    var list = root.querySelectorAll('input[type=text],input[type=email],input[type=tel],input[type=date],input[type=datetime-local],input[type=number],select,textarea');
    for (var i = 0; i < list.length; i++) { if (!list[i].closest('.tz')) list[i].classList.add('ib-input'); }
  }
  function reportHeight() {
    if (!embedded || PREVIEW) return;
    // v0.1.369 — el alto del CONTENIDO (el del documento nunca baja del alto del iframe).
    var shell = document.querySelector('.ib-shell');
    var h = shell ? shell.getBoundingClientRect().height : 0;
    try { parent.postMessage({ type: 'imb-form-height', height: Math.ceil(h > 0 ? h : document.documentElement.scrollHeight) }, '*'); } catch (e) {}
  }
  if (embedded && !PREVIEW && window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body);

  // ── Fechas y zonas ──
  function tzShown() { return st.showTz || (meta && visitorTz !== meta.time_zone ? visitorTz : (meta ? meta.time_zone : 'UTC')); }
  var fmtCache = {};
  function parts(iso, tz) {
    var key = tz;
    if (!fmtCache[key]) fmtCache[key] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var p = fmtCache[key].formatToParts(new Date(iso)), o = {};
    p.forEach(function (x) { o[x.type] = x.value; });
    return { ymd: o.year + '-' + o.month + '-' + o.day, h: Number(o.hour) % 24, m: o.minute };
  }
  function timeLabel(iso, tz) {
    var p = parts(iso, tz);
    return (p.h < 10 ? '0' : '') + p.h + ':' + p.m;
  }
  function longDate(ymd) {
    var a = ymd.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(a[0], a[1] - 1, a[2])));
  }
  function whenLong(iso, tz) {
    var p = parts(iso, tz);
    return cap(longDate(p.ymd)) + ', ' + timeLabel(iso, tz);
  }
  function tzName(tz) {
    try {
      var n = new Intl.DateTimeFormat('es-CO', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).filter(function (x) { return x.type === 'timeZoneName'; })[0];
      return (tz.split('/').pop() || tz).replace(/_/g, ' ') + (n ? ' (' + n.value + ')' : '');
    } catch (e) { return tz; }
  }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function durLabel(min) { var h = Math.floor(min / 60), m = min % 60; return h ? (m ? h + ' h ' + m + ' min' : h + ' h') : m + ' min'; }
  function durationsOf(svc) { return svc && svc.durations && svc.durations.length ? svc.durations : (svc ? [svc.duration_min] : []); }
  function chosenDuration(svc) { return st.duration && durationsOf(svc).indexOf(st.duration) >= 0 ? st.duration : (svc ? svc.duration_min : 30); }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?'; }
  function avatar(s, size) {
    var box = el('span', { cls: 'avatar' + (size === 'lg' ? ' lg' : ''), 'aria-hidden': 'true' });
    if (s && s.photo_url) {
      var img = el('img', { src: s.photo_url, alt: '' });
      img.addEventListener('error', function () { box.textContent = initials(s.name); });
      box.appendChild(img);
    } else box.textContent = initials(s ? s.name : '');
    return box;
  }
  function addDays(ymd, n) {
    var a = ymd.split('-').map(Number), d = new Date(Date.UTC(a[0], a[1] - 1, a[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function todayIn(tz) { return parts(new Date().toISOString(), tz).ymd; }

  // ── Datos ──
  function serviceById(id) { return (meta.services || []).filter(function (s) { return s.id === id; })[0] || null; }
  function staffFor(serviceId) { return (meta.staff || []).filter(function (s) { return !s.services.length || s.services.indexOf(serviceId) >= 0; }); }
  function staffName(id) { var s = (meta.staff || []).filter(function (x) { return x.id === id; })[0]; return s ? s.name : ''; }

  function fetchSlots(from, to) {
    var dur = MODE === 'manage' ? null : st.duration;
    var key = st.service + '|' + st.staff + '|' + (dur || '') + '|' + from + '|' + to;
    if (st.cache[key]) return Promise.resolve(st.cache[key]);
    var p;
    if (PREVIEW) {
      p = new Promise(function (resolve) {
        var id = ++pvReq;
        pvWait[id] = resolve;
        parent.postMessage({ type: 'imb-booking-slots-request', id: id, service: st.service, staff: st.staff, duration: dur, from: from, to: to }, location.origin);
        setTimeout(function () { if (pvWait[id]) { delete pvWait[id]; resolve({ slots: [] }); } }, 15000);
      });
    } else {
      var q = '?service=' + encodeURIComponent(st.service) + '&staff=' + encodeURIComponent(st.staff) + '&from=' + from + '&to=' + to + (dur ? '&duration=' + dur : '');
      p = fetch(API + '/slots' + q, { headers: { accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : { slots: [] }; }).catch(function () { return { slots: [] }; });
    }
    return p.then(function (res) { st.cache[key] = res; return res; });
  }

  // ── Pasos ──
  function steps() {
    var out = [];
    if ((meta.services || []).length > 1) out.push('service');
    if (meta.choose_staff && st.service && staffFor(st.service).length > 1) out.push('staff');
    out.push('date');
    if (MODE !== 'manage') out.push('details');
    return out;
  }
  function go(step) { st.step = step; st.alert = ''; render(); try { root.scrollIntoView({ block: 'start' }); } catch (e) {} reportHeight(); }
  function back() {
    if (st.step === 'code') { go('details'); return; }
    var s = steps(), i = s.indexOf(st.step);
    if (i > 0) go(s[i - 1]);
    else if (MODE === 'manage') { st.step = 'summary'; render(); }
  }

  function header() {
    var box = el('header', { cls: 'ib-header' });
    if (meta.logo_url) box.appendChild(el('div', { cls: 'ib-logo' }, [el('img', { src: meta.logo_url, alt: meta.company })]));
    else if (meta.company) box.appendChild(el('div', { cls: 'ib-logo', text: meta.company }));
    // En la página de una cita, «Tu cita» se ve aunque el diseño oculte el título.
    box.appendChild(el('h1', { cls: MODE === 'manage' ? 'ib-title bk-manage-title' : 'ib-title', text: MODE === 'manage' ? 'Tu cita' : meta.title }));
    if (MODE !== 'manage' && meta.description) {
      var d = el('div', { cls: 'ib-desc' });
      meta.description.split(/\n{2,}/).forEach(function (p) { if (p.trim()) d.appendChild(el('p', { text: p })); });
      box.appendChild(d);
    }
    if (meta.location && MODE !== 'manage') box.appendChild(el('p', { cls: 'ib-loc', text: '\u{1F4CD} ' + meta.location }));
    return box;
  }

  function stepBar() {
    var s = steps(), i = s.indexOf(st.step === 'code' ? 'details' : st.step);
    var prog = (view() && view().progress) || 'steps';
    var bar = el('div', { cls: 'steps' });
    var canBack = i > 0 || MODE === 'manage' || st.step === 'code';
    bar.appendChild(canBack ? el('button', { type: 'button', cls: 'back', text: '\u2190 Volver', on: { click: back }, 'data-testid': 'booking-back' }) : el('span'));
    if (i >= 0 && prog !== 'none') bar.appendChild(el('span', { 'data-testid': 'booking-step', text: 'Paso ' + (i + 1) + ' de ' + s.length }));
    if (i < 0 || prog !== 'bar' || MODE === 'manage') return bar;
    // v0.1.354 — con «Barra», el avance también se dibuja.
    var fill = el('span');
    fill.style.width = Math.round(((i + 1) / s.length) * 100) + '%';
    var meter = el('div', { cls: 'ib-progress bk-progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(s.length), 'aria-valuenow': String(i + 1), 'data-testid': 'booking-progress' }, [fill]);
    return el('div', null, [bar, meter]);
  }

  // v0.1.350 — Dónde es cada servicio («Videollamada (Google Meet o Teams)», «En persona · Calle 10…»).
  function locText(s) {
    var l = s && s.location;
    if (!l || l.kind === 'page' || !l.label) return '';
    return l.detail ? l.label + ' \u00b7 ' + l.detail : l.label;
  }
  // Un enlace de videollamada sólo si es https (lo arma el servidor; esto es una segunda barrera).
  function safeMeeting(u) { return typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u) ? u : null; }
  function meetingButton(a) {
    var u = safeMeeting(a.meeting_url);
    return u ? el('a', { cls: 'ib-btn ib-btn-primary', href: u, target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'booking-join', text: 'Unirse a la videollamada' }) : null;
  }

  function summaryBox(withSlot) {
    var svc = serviceById(st.service);
    var rows = [];
    if (svc) rows.push(['Servicio', svc.name + ' · ' + durLabel(MODE === 'manage' && manage ? Math.round((Date.parse(manage.appointment.end) - Date.parse(manage.appointment.start)) / 60000) : chosenDuration(svc))]);
    if (st.staff && st.staff !== 'any') rows.push(['Con', staffName(st.staff)]);
    else if (meta.choose_staff) rows.push(['Con', 'El primero disponible']);
    if (withSlot && st.slot) rows.push(['Cuándo', whenLong(st.slot.start, tzShown())]);
    if (svc && locText(svc) && MODE !== 'manage') rows.push(['Dónde', locText(svc)]);
    var box = el('div', { cls: 'summary ib-summary', 'data-testid': 'booking-summary' });
    rows.forEach(function (r) { box.appendChild(el('div', { cls: 'row' }, [el('span', { text: r[0] }), el('b', { text: r[1] })])); });
    return box;
  }

  function renderService() {
    root.appendChild(el('h2', { cls: 'ib-step-title', text: 'Elige el servicio' }));
    var list = el('div', { cls: 'choices' });
    (meta.services || []).forEach(function (s) {
      var info = durationsOf(s).map(durLabel).join(' · ');
      if (s.seats > 1) info += ' · grupal, hasta ' + s.seats + ' personas';
      var left = el('div', null, [el('div', { cls: 't', text: s.name }), el('div', { cls: 's', text: info })]);
      var where = locText(s);
      if (where) left.appendChild(el('div', { cls: 's loc2', text: where, 'data-service-location': s.location.kind }));
      if (s.description) left.appendChild(el('div', { cls: 'd', text: s.description }));
      list.appendChild(el('button', { type: 'button', cls: 'opt ib-choice', 'data-service': s.id, on: { click: function () {
        st.service = s.id; st.duration = s.duration_min; st.staff = 'any'; st.day = null; st.slot = null;
        var s2 = steps(); go(s2[s2.indexOf('service') + 1]);
      } } }, [left, s.price_label ? el('span', { cls: 'r', text: s.price_label }) : null]));
    });
    if (!(meta.services || []).length) list.appendChild(el('div', { cls: 'empty', text: 'Todavía no hay servicios para agendar.' }));
    root.appendChild(list);
  }

  function renderStaff() {
    root.appendChild(summaryBox(false));
    root.appendChild(el('h2', { cls: 'ib-step-title', text: '¿Con quién?' }));
    var list = el('div', { cls: 'choices' });
    list.appendChild(el('button', { type: 'button', cls: 'opt ib-choice', 'data-staff': 'any', on: { click: function () { st.staff = 'any'; st.day = null; go('date'); } } },
      [el('div', { cls: 'who' }, [el('span', { cls: 'avatar any', 'aria-hidden': 'true', text: '\u2605' }), el('div', null, [el('div', { cls: 't', text: 'El primero disponible' }), el('div', { cls: 's', text: 'Más horarios para elegir' })])])]));
    staffFor(st.service).forEach(function (s) {
      var now = MODE === 'manage' && manage && manage.staff_id === s.id;
      var txt = el('div', null, [el('div', { cls: 't', text: s.name })]);
      if (s.title) txt.appendChild(el('div', { cls: 's', text: s.title }));
      if (s.bio) txt.appendChild(el('div', { cls: 'd', text: s.bio }));
      if (now) txt.appendChild(el('div', { cls: 's', text: 'Te atiende ahora' }));
      list.appendChild(el('button', { type: 'button', cls: 'opt ib-choice' + (now ? ' cur' : ''), 'data-staff': s.id, on: { click: function () { st.staff = s.id; st.day = null; go('date'); } } },
        [el('div', { cls: 'who' }, [avatar(s), txt])]));
    });
    root.appendChild(list);
  }

  function tzControl() {
    if (!meta || visitorTz === meta.time_zone) {
      return el('div', { cls: 'tz' }, [el('span', { text: 'Horarios en ' + meta.time_zone_label })]);
    }
    var sel = el('select', { 'aria-label': 'Zona horaria', 'data-testid': 'booking-tz', on: { change: function () { st.showTz = sel.value; st.day = null; render(); } } }, [
      el('option', { value: visitorTz, text: 'tu zona: ' + tzName(visitorTz) }),
      el('option', { value: meta.time_zone, text: 'la de la empresa: ' + meta.time_zone_label })
    ]);
    sel.value = tzShown();
    return el('div', { cls: 'tz', 'data-testid': 'booking-tz-note' }, [el('span', { text: 'Horarios en' }), sel,
      el('span', { cls: 'small', text: tzShown() === visitorTz ? '(la empresa está en ' + meta.time_zone_label + ')' : '' })]);
  }

  function durationChips() {
    var svc = serviceById(st.service), opts = durationsOf(svc);
    if (MODE === 'manage' || opts.length < 2) return null;
    var cur = chosenDuration(svc);
    var row = el('div', { cls: 'durs', role: 'group', 'aria-label': 'Duración', 'data-testid': 'booking-durations' }, [el('span', { cls: 'muted small', text: 'Duración' })]);
    opts.forEach(function (m) {
      row.appendChild(el('button', { type: 'button', cls: 'dur' + (m === cur ? ' on' : ''), 'aria-pressed': m === cur ? 'true' : 'false', text: durLabel(m), 'data-duration': String(m), on: { click: function () { if (st.duration === m) return; st.duration = m; st.day = null; render(); } } }));
    });
    return row;
  }

  function renderDate() {
    root.appendChild(summaryBox(false));
    root.appendChild(el('h2', { cls: 'ib-step-title', text: 'Elige el día y la hora' }));
    var chips = durationChips();
    if (chips) root.appendChild(chips);
    root.appendChild(tzControl());
    var tz = tzShown();
    var today = todayIn(tz);
    var winFirst = meta.first_day && meta.first_day > today ? meta.first_day : today;
    if (!st.month) st.month = winFirst.slice(0, 7);
    var y = Number(st.month.slice(0, 4)), mo = Number(st.month.slice(5, 7));
    var first = st.month + '-01';
    var daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var last = st.month + '-' + (daysIn < 10 ? '0' : '') + daysIn;
    var lastAllowed = meta.last_day ? addDays(meta.last_day, 1) : addDays(today, (meta.max_days_ahead || 60) + 1);
    var head = el('div', { cls: 'cal-head' });
    var prev = el('button', { type: 'button', cls: 'nav', 'aria-label': 'Mes anterior', text: '\u2039', 'data-testid': 'booking-prev', on: { click: function () { st.month = addDays(first, -1).slice(0, 7); st.day = null; render(); } } });
    var next = el('button', { type: 'button', cls: 'nav', 'aria-label': 'Mes siguiente', text: '\u203A', 'data-testid': 'booking-next', on: { click: function () { st.month = addDays(last, 1).slice(0, 7); st.day = null; render(); } } });
    if (first <= winFirst) prev.disabled = true;
    if (last >= lastAllowed) next.disabled = true;
    var title = cap(new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, mo - 1, 1))));
    head.appendChild(prev); head.appendChild(el('b', { text: title })); head.appendChild(next);
    // Calendario y horarios lado a lado en pantallas anchas; apilados en el celular.
    var pick = el('div', { cls: 'datepick' });
    var calBox = el('div', { cls: 'bk-cal' });
    calBox.appendChild(head);
    pick.appendChild(calBox);
    root.appendChild(pick);
    var grid = el('div', { cls: 'grid', role: 'grid', 'aria-label': title, 'data-testid': 'booking-calendar' });
    // v0.1.354 — la semana empieza el lunes (o el domingo, si la agenda lo elige).
    var sunday = !!(meta.display && meta.display.week_start === 'sunday');
    (sunday ? ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'] : ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']).forEach(function (d) { grid.appendChild(el('div', { cls: 'dow', text: d })); });
    var dow = sunday ? new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() : (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
    for (var i = 0; i < dow; i++) grid.appendChild(el('div'));
    var cells = {};
    for (var d = 1; d <= daysIn; d++) {
      var ymd = st.month + '-' + (d < 10 ? '0' : '') + d;
      var b = el('button', { type: 'button', cls: 'day ib-day' + (ymd === today ? ' today' : '') + (ymd === st.day ? ' sel' : ''), text: String(d), disabled: true, 'data-day': ymd });
      cells[ymd] = b;
      grid.appendChild(b);
    }
    calBox.appendChild(grid);
    var slotsBox = el('div', { 'data-testid': 'booking-slots-box' }, [el('div', { cls: 'loading', text: 'Buscando horarios…' })]);
    pick.appendChild(slotsBox);
    var month = st.month;
    // El servidor recorta a lo reservable; el margen cubre la diferencia de zona.
    fetchSlots(addDays(first, -1), addDays(last, 1)).then(function (res) {
      if (st.step !== 'date' || st.month !== month) return;
      var byDay = {};
      (res.slots || []).forEach(function (s) { var k = parts(s.start, tz).ymd; (byDay[k] = byDay[k] || []).push(s); });
      Object.keys(cells).forEach(function (ymd) {
        var c = cells[ymd];
        if (byDay[ymd] && byDay[ymd].length) {
          c.disabled = false; c.classList.add('on');
          c.setAttribute('aria-label', longDate(ymd) + ': ' + byDay[ymd].length + ' horarios');
          c.addEventListener('click', function () { st.day = ymd; render(); });
        }
      });
      if (!st.day) {
        var firstDay = Object.keys(byDay).filter(function (k) { return k.slice(0, 7) === month; }).sort()[0];
        slotsBox.textContent = '';
        slotsBox.appendChild(el('div', { cls: 'empty', text: firstDay ? 'Elige un día marcado para ver sus horarios.' : 'No hay horarios libres este mes. Prueba con el mes siguiente.' }));
      } else {
        slotsBox.textContent = '';
        var list = byDay[st.day] || [];
        slotsBox.appendChild(el('h2', { cls: 'day-title', text: cap(longDate(st.day)) }));
        if (!list.length) slotsBox.appendChild(el('div', { cls: 'empty', text: 'Ese día ya no tiene horarios libres.' }));
        var g = el('div', { cls: 'slots', 'data-testid': 'booking-slots' });
        list.forEach(function (s) {
          var svc2 = serviceById(st.service);
          var seats = typeof s.seats_left === 'number' && svc2 && svc2.show_seats_left ? s.seats_left : null;
          var btn = el('button', { type: 'button', cls: 'slot ib-slot', 'data-start': s.start, on: { click: function () { pickSlot(s); } } }, [el('span', { text: timeLabel(s.start, tz) })]);
          if (seats !== null) { btn.appendChild(el('span', { cls: 'seats', text: seats === 1 ? '1 cupo' : seats + ' cupos' })); btn.setAttribute('aria-label', timeLabel(s.start, tz) + ', ' + (seats === 1 ? 'queda 1 cupo' : 'quedan ' + seats + ' cupos')); }
          g.appendChild(btn);
        });
        slotsBox.appendChild(g);
      }
      reportHeight();
    });
  }

  function pickSlot(s) {
    st.slot = s;
    if (MODE === 'manage') { confirmReschedule(); return; }
    go('details');
  }

  // ── Datos del cliente y preguntas ──
  function setErr(key, msg, node) {
    st.errors[key] = msg;
    if (node) node.classList.toggle('ib-invalid', !!msg);
  }
  function fieldBox(key, labelText, required, control, help) {
    var box = el('div', { 'data-q': key, cls: 'ib-item ib-field' });
    if (labelText) box.appendChild(el('label', { cls: 'ib-label', for: 'q_' + key }, [labelText, required ? el('span', { cls: 'ib-req', text: '*' }) : null]));
    if (help) box.appendChild(el('div', { cls: 'ib-help', text: help }));
    box.appendChild(control);
    var msg = st.errors[key];
    if (msg) { box.classList.add('ib-invalid'); box.appendChild(el('div', { cls: 'ib-error', role: 'alert', text: msg })); }
    return box;
  }
  function visible(item) {
    if (!item.show_if) return true;
    var ctl = (meta.questions || []).filter(function (i) { return i.type === 'field' && String(i.key) === String(item.show_if.field_id); })[0];
    if (!ctl || !visible(ctl)) return false;
    var a = st.values[ctl.key], c = item.show_if;
    var empty = a === null || a === undefined || a === false || (typeof a === 'string' && !a.trim()) || (Array.isArray(a) && !a.length);
    if (c.op === 'is_empty') return empty;
    if (c.op === 'is_not_empty') return !empty;
    if (c.op === 'eq' || c.op === 'neq') {
      var m = Array.isArray(a) ? a.map(String).indexOf(String(c.value)) >= 0 : !empty && String(a).toLowerCase() === String(c.value == null ? '' : c.value).toLowerCase();
      return c.op === 'eq' ? m : !m;
    }
    if (c.op === 'in') { var w = Array.isArray(c.value) ? c.value.map(String) : []; return Array.isArray(a) ? a.some(function (x) { return w.indexOf(String(x)) >= 0; }) : !empty && w.indexOf(String(a)) >= 0; }
    if (c.op === 'contains') return !empty && String(a).toLowerCase().indexOf(String(c.value || '').toLowerCase()) >= 0;
    if (c.op === 'gt' || c.op === 'lt') { var x = Number(a), y2 = Number(c.value); if (!isFinite(x) || !isFinite(y2) || empty) return false; return c.op === 'gt' ? x > y2 : x < y2; }
    return true;
  }
  function questionControl(q) {
    var id = 'q_' + q.id, cfg = q.config || {}, key = q.key;
    function bind(input, tf) { input.addEventListener('input', function () { st.values[key] = tf ? tf(input.value) : input.value; if (q.show_if !== undefined) maybeRerenderQuestions(); }); if (st.values[key] !== undefined && typeof st.values[key] !== 'object') input.value = st.values[key]; return input; }
    switch (q.field_type) {
      case 'long_text': return bind(el('textarea', { id: id, placeholder: q.placeholder || undefined }));
      case 'email': return bind(el('input', { type: 'email', id: id }));
      case 'phone': return bind(el('input', { type: 'tel', id: id }));
      case 'url': return bind(el('input', { type: 'text', inputmode: 'url', id: id, placeholder: 'https://' }));
      case 'date': return bind(el('input', { type: 'date', id: id }));
      case 'datetime': return bind(el('input', { type: 'datetime-local', id: id }), function (v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? v : d.toISOString(); });
      case 'number': case 'currency': case 'percent': case 'rating':
        return bind(el('input', { type: 'text', inputmode: 'decimal', id: id, placeholder: q.placeholder || undefined }), function (v) { var s = String(v).replace(/[^0-9.,\-]/g, ''); if (meta.number_format !== 'comma_dot') s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); return s === '' ? null : Number(s); });
      case 'checkbox': {
        var cb = el('input', { type: 'checkbox', id: id });
        cb.checked = st.values[key] === true;
        cb.addEventListener('change', function () { st.values[key] = cb.checked; maybeRerenderQuestions(); });
        return el('label', { cls: 'chk' }, [cb, el('span', { text: q.label })]);
      }
      case 'select': {
        var sel = el('select', { id: id }, [el('option', { value: '', text: 'Elige…' })].concat((q.options || []).map(function (o) { return el('option', { value: o.value, text: o.label }); })));
        sel.value = st.values[key] || '';
        sel.addEventListener('change', function () { st.values[key] = sel.value || null; maybeRerenderQuestions(); });
        return sel;
      }
      case 'multi_select': {
        var box = el('div', { id: id });
        var cur = Array.isArray(st.values[key]) ? st.values[key] : [];
        (q.options || []).forEach(function (o) {
          var c2 = el('input', { type: 'checkbox', value: o.value });
          c2.checked = cur.indexOf(o.value) >= 0;
          c2.addEventListener('change', function () {
            var v = Array.isArray(st.values[key]) ? st.values[key].slice() : [];
            if (c2.checked) { if (v.indexOf(o.value) < 0) v.push(o.value); } else v = v.filter(function (x) { return x !== o.value; });
            st.values[key] = v; maybeRerenderQuestions();
          });
          box.appendChild(el('label', { cls: 'chk' }, [c2, el('span', { text: o.label })]));
        });
        return box;
      }
      default: return bind(el('input', { type: 'text', id: id, placeholder: q.placeholder || undefined }));
    }
  }
  var questionsHost = null;
  function maybeRerenderQuestions() {
    if (!questionsHost) return;
    var hasCond = (meta.questions || []).some(function (q) { return q.show_if; });
    if (hasCond) paintQuestions();
  }
  function paintQuestions() {
    questionsHost.textContent = '';
    (meta.questions || []).forEach(function (q) {
      if (!visible(q)) return;
      if (q.type === 'heading') { questionsHost.appendChild(el('h2', { cls: 'ib-step-title', text: q.text, style: 'margin-top:18px' })); return; }
      if (q.type === 'text') { questionsHost.appendChild(el('p', { cls: 'muted', text: q.text })); return; }
      if (q.hidden) return;
      var c = questionControl(q);
      questionsHost.appendChild(q.field_type === 'checkbox' ? fieldBox(q.id, '', false, c, q.help) : fieldBox(q.id, q.label, q.required, c, q.help));
    });
  }

  function renderDetails() {
    root.appendChild(summaryBox(true));
    root.appendChild(el('h2', { cls: 'ib-step-title', text: 'Tus datos' }));
    var form = el('form', { novalidate: true, cls: 'bk-form', 'data-testid': 'booking-form' });
    var name = el('input', { type: 'text', id: 'q_name', autocomplete: 'name', value: st.values.__name || '' });
    name.addEventListener('input', function () { st.values.__name = name.value; });
    form.appendChild(fieldBox('name', 'Nombre', true, name));
    var email = el('input', { type: 'email', id: 'q_email', autocomplete: 'email', value: st.values.__email || '' });
    email.addEventListener('input', function () { st.values.__email = email.value; });
    form.appendChild(fieldBox('email', 'Correo', true, email, 'Te enviamos la confirmación y los enlaces para cambiar o cancelar.'));
    if (meta.ask_phone !== 'hidden') {
      var phone = el('input', { type: 'tel', id: 'q_phone', autocomplete: 'tel', value: st.values.__phone || '' });
      phone.addEventListener('input', function () { st.values.__phone = phone.value; });
      form.appendChild(fieldBox('phone', 'Teléfono', meta.ask_phone === 'required', phone));
    }
    questionsHost = el('div');
    form.appendChild(questionsHost);
    paintQuestions();
    var consentCb = null;
    if (meta.data_consent) {
      var dc = meta.data_consent;
      consentCb = el('input', { type: 'checkbox', id: 'q___consent', 'data-testid': 'booking-consent' });
      consentCb.checked = st.values.__consent === true;
      consentCb.addEventListener('change', function () { st.values.__consent = consentCb.checked; });
      var full = el('div', { cls: 'ib-consent-text', hidden: true, text: dc.text });
      var toggle = el('button', { type: 'button', cls: 'ib-linkbtn', text: 'Ver la autorización completa', on: { click: function () { full.hidden = !full.hidden; reportHeight(); } } });
      var cbox = el('div', { cls: 'ib-consent' + (st.errors.__consent ? ' ib-invalid' : '') }, [el('label', { cls: 'chk' }, [consentCb, el('span', { text: dc.label })]), toggle, full]);
      if (dc.policy_url && /^https:\/\//i.test(dc.policy_url)) cbox.appendChild(el('div', { cls: 'small' }, [el('a', { href: dc.policy_url, target: '_blank', rel: 'noopener noreferrer', text: 'Política de tratamiento de datos' })]));
      if (st.errors.__consent) cbox.appendChild(el('div', { cls: 'ib-error', role: 'alert', text: st.errors.__consent }));
      form.appendChild(cbox);
    }
    var hp = el('div', { cls: 'ib-hp', 'aria-hidden': 'true' }, [el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', id: 'hp' })]);
    form.appendChild(hp);
    var captchaBox = null;
    if (meta.captcha && !PREVIEW) { captchaBox = el('div', { cls: 'captcha' }); form.appendChild(captchaBox); }
    if (meta.captcha && PREVIEW) form.appendChild(el('div', { cls: 'pv', text: 'Aquí va la verificación anti-robots.' }));
    if (meta.verify_email) form.appendChild(el('p', { cls: 'muted small', 'data-testid': 'booking-verify-note', text: 'Para terminar, te enviaremos un código a tu correo.' }));
    if (st.alert) form.appendChild(el('div', { cls: 'ib-alert', role: 'alert', text: st.alert, 'data-testid': 'booking-alert' }));
    var submit = el('button', { type: 'submit', cls: 'ib-btn ib-btn-primary', text: st.busy ? (meta.verify_email && !hasProof() ? 'Enviando el código…' : 'Agendando…') : 'Confirmar cita', disabled: st.busy, 'data-testid': 'booking-submit' });
    form.appendChild(el('div', { cls: 'actions' }, [submit]));
    form.addEventListener('submit', function (e) { e.preventDefault(); submitBooking(); });
    root.appendChild(form);
    if (captchaBox) mountCaptcha(captchaBox);
  }

  function mountCaptcha(box) {
    var c = meta.captcha;
    function api() { return c.provider === 'turnstile' ? window.turnstile : c.provider === 'hcaptcha' ? window.hcaptcha : window.grecaptcha; }
    window.__imbBookCaptcha = function () {
      var a = api(); if (!a || !a.render) return;
      try { captchaWidget = a.render(box, { sitekey: c.site_key, callback: function (t) { captchaToken = t; }, 'expired-callback': function () { captchaToken = null; } }); } catch (e) {}
    };
    if (api() && api().render) { window.__imbBookCaptcha(); return; }
    var s = document.createElement('script');
    s.src = BOOT.scripts[c.provider] + '?render=explicit&onload=__imbBookCaptcha';
    s.async = true; document.head.appendChild(s);
  }

  function submitBooking() {
    if (st.busy) return;
    st.errors = {};
    var bad = false;
    if (!(st.values.__name || '').trim()) { st.errors.name = 'Escribe tu nombre.'; bad = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((st.values.__email || '').trim())) { st.errors.email = 'Revisa el correo.'; bad = true; }
    if (meta.ask_phone === 'required' && !(st.values.__phone || '').trim()) { st.errors.phone = 'Escribe tu teléfono.'; bad = true; }
    (meta.questions || []).forEach(function (q) {
      if (q.type !== 'field' || q.hidden || !visible(q) || !q.required) return;
      var v = st.values[q.key];
      if (v === null || v === undefined || v === false || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)) { st.errors[q.id] = 'Esta pregunta es obligatoria.'; bad = true; }
    });
    if (meta.data_consent && st.values.__consent !== true) { st.errors.__consent = 'Para agendar, acepta la autorización para el tratamiento de tus datos personales.'; bad = true; }
    if (bad) { st.alert = 'Revisa los datos marcados.'; render(); return; }
    if (PREVIEW) { st.done = { preview: true }; st.step = 'done'; render(); return; }
    // v0.1.353 — primero el código del correo (si la página lo pide y todavía no se confirmó ESE correo).
    if (meta.verify_email && !hasProof()) { requestCode(); return; }
    var values = {};
    (meta.questions || []).forEach(function (q) { if (q.type === 'field' && visible(q) && st.values[q.key] !== undefined) values[q.key] = st.values[q.key]; });
    var body = {
      service_id: st.service, staff_id: st.staff, start: st.slot.start, duration_min: chosenDuration(serviceById(st.service)),
      name: st.values.__name.trim(), email: st.values.__email.trim(), values: values,
      hp: (document.getElementById('hp') || {}).value || '', time_zone: visitorTz
    };
    if ((st.values.__phone || '').trim()) body.phone = st.values.__phone.trim();
    if (meta.data_consent) { body.consent = st.values.__consent === true; body.consent_version = meta.data_consent.version; }
    if (meta.captcha) body.captcha = captchaToken || '';
    if (hasProof()) body.email_proof = st.proof.value;
    st.busy = true; st.alert = ''; render();
    readyStamp()
      .then(function (stamp) {
        body.stamp = stamp;
        return fetch(API + '/book', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        st.busy = false;
        if (res.status >= 200 && res.status < 300) {
          st.done = res.body.appointment || { pending: true };
          st.step = 'done';
          render();
          try { parent.postMessage({ type: 'imb-form-submitted' }, '*'); } catch (e) {}
          return;
        }
        var msg = (res.body && res.body.message) || 'No pudimos agendar tu cita. Prueba de nuevo.';
        var code = res.body && res.body.code;
        if (code === 'booking_stale') stampReq = null;
        if (code === 'booking_email_unverified') { st.proof = null; requestCode(); return; }
        if (code === 'booking_slot_taken') {
          // Otro lo tomó un segundo antes: de vuelta a los horarios (frescos).
          st.cache = {}; st.slot = null; st.step = 'date'; st.alert = msg; render();
          return;
        }
        if (res.body && res.body.data && res.body.data.errors) {
          var er = res.body.data.errors;
          Object.keys(er).forEach(function (k) { st.errors[k] = er[k]; });
        }
        st.alert = msg;
        if (meta.captcha) { captchaToken = null; }
        render();
      })
      .catch(function () { st.busy = false; st.alert = 'No hay conexión. Revisa tu internet y vuelve a intentar.'; render(); });
  }

  // ── Código del correo (v0.1.353) ──
  function currentEmail() { return String(st.values.__email || '').trim().toLowerCase(); }
  function hasProof() { return !!(st.proof && st.proof.email === currentEmail()); }
  function requestCode() {
    if (st.busy) return;
    st.busy = true; st.alert = ''; render();
    readyStamp()
      .then(function (stamp) { return post('/code', { email: String(st.values.__email || '').trim(), stamp: stamp }); })
      .then(function (res) {
        st.busy = false;
        if (res.status >= 200 && res.status < 300) {
          st.codeSent = { email: currentEmail(), minutes: (res.body && res.body.minutes) || 10 };
          st.codeValue = ''; st.step = 'code'; render();
          var c = document.getElementById('q_code'); if (c) try { c.focus(); } catch (e) {}
          return;
        }
        if (res.body && res.body.code === 'booking_stale') stampReq = null;
        if (res.body && res.body.data && res.body.data.errors) { Object.keys(res.body.data.errors).forEach(function (k) { st.errors[k] = res.body.data.errors[k]; }); }
        st.alert = (res.body && res.body.message) || 'No pudimos enviarte el código. Prueba de nuevo.';
        st.step = 'details'; render();
      })
      .catch(function () { st.busy = false; st.alert = 'No hay conexión. Revisa tu internet y vuelve a intentar.'; render(); });
  }
  function verifyCode() {
    if (st.busy) return;
    var code = String(st.codeValue || '').replace(/\D/g, '');
    if (code.length !== 6) { st.alert = 'El código tiene 6 números.'; render(); return; }
    st.busy = true; st.alert = ''; render();
    post('/verify-code', { email: String(st.values.__email || '').trim(), code: code })
      .then(function (res) {
        st.busy = false;
        if (res.status >= 200 && res.status < 300 && res.body && res.body.proof) {
          st.proof = { email: currentEmail(), value: res.body.proof };
          st.step = 'details';
          submitBooking();
          return;
        }
        var c2 = res.body && res.body.code;
        st.alert = (res.body && res.body.message) || 'No pudimos comprobar el código.';
        if (c2 === 'booking_code_locked' || c2 === 'booking_code_expired') st.codeSent = st.codeSent ? { email: st.codeSent.email, minutes: st.codeSent.minutes, expired: true } : null;
        render();
      })
      .catch(function () { st.busy = false; st.alert = 'No hay conexión. Revisa tu internet y vuelve a intentar.'; render(); });
  }
  function renderCode() {
    root.appendChild(summaryBox(true));
    root.appendChild(el('h2', { cls: 'ib-step-title', text: 'Confirma tu correo' }));
    var sent = st.codeSent || { email: currentEmail(), minutes: 10 };
    root.appendChild(el('p', { cls: 'muted', text: 'Te enviamos un código de 6 números a ' + sent.email + '. Escríbelo para terminar de agendar (vence en ' + sent.minutes + ' minutos).' }));
    var form = el('form', { novalidate: true, 'data-testid': 'booking-code-form' });
    var input = el('input', { type: 'text', id: 'q_code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', cls: 'code-input', placeholder: '······', value: st.codeValue || '', 'aria-label': 'Código de 6 números', 'data-testid': 'booking-code' });
    input.addEventListener('input', function () { st.codeValue = input.value.replace(/\D/g, '').slice(0, 6); if (input.value !== st.codeValue) input.value = st.codeValue; if (st.codeValue.length === 6 && !st.busy) verifyCode(); });
    form.appendChild(el('div', { cls: 'field' }, [input]));
    if (st.alert) form.appendChild(el('div', { cls: 'ib-alert', role: 'alert', text: st.alert, 'data-testid': 'booking-alert' }));
    var ok = el('button', { type: 'submit', cls: 'ib-btn ib-btn-primary', text: st.busy ? 'Comprobando…' : 'Confirmar y agendar', disabled: st.busy, 'data-testid': 'booking-code-submit' });
    var again = el('button', { type: 'button', cls: 'ib-btn ib-btn-secondary', text: 'Enviarme otro código', disabled: st.busy, 'data-testid': 'booking-code-resend', on: { click: function () { requestCode(); } } });
    var other = el('button', { type: 'button', cls: 'ib-linkbtn', text: 'Usar otro correo', on: { click: function () { st.codeSent = null; st.alert = ''; go('details'); } } });
    form.appendChild(el('div', { cls: 'actions' }, [ok, again]));
    form.appendChild(other);
    form.addEventListener('submit', function (e) { e.preventDefault(); verifyCode(); });
    root.appendChild(form);
  }

  // ── Confirmación ──
  function renderDone() {
    var a = st.done || {};
    var waiting = a.status === 'pending';
    var box = el('div', { cls: 'done', 'data-testid': 'booking-done', 'data-status': a.status || '' });
    box.appendChild(el('div', { cls: waiting ? 'tick wait' : 'tick', text: waiting ? '\u23F3' : '\u2713', 'aria-hidden': 'true' }));
    box.appendChild(el('h2', { cls: 'ib-step-title', text: a.preview ? 'Vista previa: así se confirma la cita' : waiting ? 'Recibimos tu solicitud' : '¡Tu cita quedó agendada!' }));
    if (waiting) {
      box.appendChild(el('span', { cls: 'badge-pending', 'data-testid': 'booking-pending', text: 'Por confirmar' }));
      if (meta.pending_message) box.appendChild(el('p', { cls: 'muted', text: meta.pending_message }));
    } else if (meta.success_message) box.appendChild(el('p', { cls: 'muted', text: meta.success_message }));
    if (a.preview) {
      box.appendChild(summaryBox(true));
      box.appendChild(el('div', { cls: 'pv', text: 'En la vista previa no se agenda nada.' }));
      root.appendChild(box);
      return;
    }
    if (a.start) {
      var sum = el('div', { cls: 'summary ib-summary' });
      [['Servicio', a.service], ['Con', a.staff], ['Cuándo', whenLong(a.start, tzShown())], ['Dónde', a.location]].forEach(function (r) {
        if (r[1]) sum.appendChild(el('div', { cls: 'row' }, [el('span', { text: r[0] }), el('b', { text: r[1] })]));
      });
      box.appendChild(sum);
      var acts = el('div', { cls: 'actions', style: 'justify-content:center' });
      var join = waiting ? null : meetingButton(a);
      if (join) acts.appendChild(join);
      // Una solicitud todavía no va al calendario del cliente.
      if (!waiting) acts.appendChild(el('a', { cls: join ? 'btn ghost' : 'btn', href: a.ics_url, 'data-testid': 'booking-ics', text: 'Agregar a mi calendario' }));
      if (a.can_reschedule || a.can_cancel) acts.appendChild(el('a', { cls: 'ib-btn ib-btn-secondary', href: a.manage_url, target: embedded ? '_blank' : undefined, rel: 'noopener', 'data-testid': 'booking-manage-link', text: 'Cambiar o cancelar' }));
      box.appendChild(acts);
      if (!join && !waiting && a.location_kind === 'video') box.appendChild(el('p', { cls: 'muted', 'data-testid': 'booking-meeting-later', text: 'El enlace de la videollamada te llega en el correo de confirmación.' }));
    }
    root.appendChild(box);
  }

  // ── Gestión de una cita ──
  function apptSummary(a) {
    var sum = el('div', { cls: 'summary ib-summary', 'data-testid': 'booking-appt' });
    [['Servicio', a.service], ['Con', a.staff], ['Cuándo', whenLong(a.start, tzShown())], ['Dónde', a.location]].forEach(function (r) {
      if (r[1]) sum.appendChild(el('div', { cls: 'row' }, [el('span', { text: r[0] }), el('b', { text: r[1] })]));
    });
    return sum;
  }
  function renderSummary() {
    var a = manage.appointment;
    if (a.status === 'cancelled' || a.status === 'declined') {
      root.appendChild(el('div', { cls: 'done', 'data-testid': 'booking-gone' }, [el('div', { cls: 'tick x', text: '\u2715' }), el('h2', { cls: 'ib-step-title', text: a.status === 'declined' ? 'Esta cita no fue confirmada' : 'Esta cita está cancelada' })]));
      root.appendChild(apptSummary(a));
      if (a.status === 'declined' && meta && !meta.closed) root.appendChild(el('p', { cls: 'muted', text: 'El horario quedó libre. Si quieres, agenda otra desde la página de la empresa.' }));
      return;
    }
    if (a.status === 'pending') {
      root.appendChild(el('span', { cls: 'badge-pending', 'data-testid': 'booking-pending', text: 'Por confirmar' }));
      root.appendChild(el('p', { cls: 'muted', text: (meta && meta.pending_message) || 'Te avisaremos por correo cuando la confirmen.' }));
    }
    root.appendChild(apptSummary(a));
    if (st.alert) root.appendChild(el('div', { cls: st.alertOk ? 'note-ok' : 'alert', role: 'status', text: st.alert, 'data-testid': 'booking-alert' }));
    if (a.locked_reason) root.appendChild(el('p', { cls: 'muted', text: a.locked_reason, 'data-testid': 'booking-locked' }));
    var acts = el('div', { cls: 'actions' });
    var joinM = meetingButton(a);
    if (joinM) acts.appendChild(joinM);
    if (a.status !== 'pending') acts.appendChild(el('a', { cls: 'ib-btn ib-btn-secondary', href: a.ics_url, text: 'Agregar a mi calendario' }));
    if (a.can_reschedule) acts.appendChild(el('button', { type: 'button', cls: 'ib-btn ib-btn-primary', text: 'Cambiar el horario', 'data-testid': 'booking-reschedule', on: { click: function () {
      st.service = manage.service_id; st.staff = manage.staff_id || 'any'; st.month = null; st.day = null; st.cache = {};
      var s = steps(); go(s.indexOf('staff') >= 0 ? 'staff' : 'date');
    } } }));
    if (a.can_cancel) acts.appendChild(el('button', { type: 'button', cls: 'ib-btn ib-btn-primary btn-danger', text: a.status === 'pending' ? 'Cancelar la solicitud' : 'Cancelar la cita', 'data-testid': 'booking-cancel', on: { click: function () { st.cancelOpen = true; render(); } } }));
    root.appendChild(acts);
    if (st.cancelOpen && a.can_cancel) {
      var reason = el('textarea', { id: 'q_reason', placeholder: 'Opcional: cuéntanos por qué', maxlength: '500' });
      var confirm = el('button', { type: 'button', cls: 'ib-btn ib-btn-primary btn-danger', text: st.busy ? 'Cancelando…' : 'Sí, cancelar mi cita', disabled: st.busy, 'data-testid': 'booking-cancel-confirm', on: { click: function () { doCancel(reason.value); } } });
      var keep = el('button', { type: 'button', cls: 'ib-btn ib-btn-secondary', text: 'No, mantenerla', on: { click: function () { st.cancelOpen = false; render(); } } });
      root.appendChild(el('div', { cls: 'ib-consent' }, [el('b', { text: '¿Cancelar la cita?' }), el('label', { cls: 'ib-label', for: 'q_reason', text: 'Motivo', style: 'margin-top:10px' }), reason, el('div', { cls: 'actions' }, [confirm, keep])]));
    }
  }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }
  // v0.1.353 — después de un cambio, el enlace viejo ya no sirve: la página pasa al nuevo.
  function useLink(url) {
    var m = /\/manage\/([^/?#]+)/.exec(String(url || ''));
    if (!m) return;
    API = '/api/v1/public/booking/manage/' + m[1];
    try { if (!embedded) history.replaceState(null, '', '/api/v1/public/b/manage/' + m[1]); } catch (e) {}
  }
  function doCancel(reason) {
    st.busy = true; render();
    post('/cancel', reason ? { reason: reason } : {}).then(function (res) {
      st.busy = false; st.cancelOpen = false;
      if (res.status >= 200 && res.status < 300) { manage.appointment = res.body; st.alert = ''; }
      else { st.alert = (res.body && res.body.message) || 'No pudimos cancelar la cita.'; st.alertOk = false; }
      st.step = 'summary'; render();
    }).catch(function () { st.busy = false; st.alert = 'No hay conexión.'; render(); });
  }
  function confirmReschedule() {
    var s = st.slot;
    root.textContent = '';
    root.appendChild(header());
    root.appendChild(el('h2', { cls: 'ib-step-title', text: '¿Cambiar tu cita a este horario?' }));
    root.appendChild(apptSummary({ service: manage.appointment.service, staff: st.staff !== 'any' ? staffName(st.staff) : manage.appointment.staff, start: s.start, location: manage.appointment.location }));
    var yes = el('button', { type: 'button', cls: 'ib-btn ib-btn-primary', text: 'Sí, cambiar', 'data-testid': 'booking-reschedule-confirm', on: { click: function () {
      yes.disabled = true; yes.textContent = 'Cambiando…';
      post('/reschedule', { start: s.start, staff_id: st.staff, time_zone: visitorTz }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          manage.appointment = res.body;
          useLink(res.body.manage_url);
          st.alert = res.body.status === 'pending' ? 'Listo: cambiamos el horario de tu solicitud. Sigue por confirmar.' : 'Listo: tu cita cambió de horario. Te enviamos la confirmación por correo.';
          st.alertOk = true; st.step = 'summary'; render(); return;
        }
        st.alert = (res.body && res.body.message) || 'No pudimos cambiar la cita.'; st.alertOk = false;
        if (res.body && res.body.code === 'booking_slot_taken') { st.cache = {}; st.step = 'date'; render(); return; }
        st.step = 'summary'; render();
      });
    } } });
    var no = el('button', { type: 'button', cls: 'ib-btn ib-btn-secondary', text: 'Elegir otro', on: { click: function () { st.slot = null; go('date'); } } });
    root.appendChild(el('div', { cls: 'actions' }, [yes, no]));
    reportHeight();
  }

  // ── Render ──
  function render() {
    if (!root) buildShell();
    root.textContent = '';
    if (!meta) { root.appendChild(el('div', { cls: 'loading', text: 'Cargando…' })); return; }
    paint();
    themeInputs();
    reportHeight();
  }
  function paint() {
    root.appendChild(header());
    if (MODE === 'book' && meta.closed) { root.appendChild(el('p', { cls: 'empty', text: meta.closed, 'data-testid': 'booking-closed' })); return; }
    if (MODE === 'manage' && st.step === 'summary') { renderSummary(); reportHeight(); return; }
    if (st.step === 'done') { renderDone(); reportHeight(); return; }
    if (MODE !== 'manage' && st.alert && st.step === 'date') root.appendChild(el('div', { cls: 'ib-alert', role: 'alert', text: st.alert, 'data-testid': 'booking-alert' }));
    if (MODE === 'manage' && st.alert && st.step === 'date') root.appendChild(el('div', { cls: 'ib-alert', role: 'alert', text: st.alert }));
    root.appendChild(stepBar());
    if (st.step === 'service') renderService();
    else if (st.step === 'staff') renderStaff();
    else if (st.step === 'date') renderDate();
    else if (st.step === 'details') renderDetails();
    else if (st.step === 'code') renderCode();
  }

  function start() {
    st.cache = {};
    if (MODE === 'manage') {
      st.step = 'summary';
      st.service = manage.service_id;
      if (BOOT.action === 'cancel' && manage.appointment.can_cancel) st.cancelOpen = true;
      render();
      return;
    }
    var svcs = meta.services || [];
    if (svcs.length === 1) { st.service = svcs[0].id; }
    var s = steps();
    st.step = s[0];
    render();
  }

  buildShell();
  if (PREVIEW) {
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'imb-booking-preview') {
        var hadMeta = meta !== null;
        var prevSteps = hadMeta ? steps().join(',') : '';
        meta = e.data.meta;
        // v0.1.354 — el diseño en edición: el CSS del tema, el modo y la estructura.
        if (typeof e.data.css === 'string') { var style = document.getElementById('ib-theme'); if (style) style.textContent = e.data.css; }
        if (e.data.scheme) document.documentElement.setAttribute('data-scheme', e.data.scheme);
        else document.documentElement.removeAttribute('data-scheme');
        var keep = window.scrollY;
        buildShell();
        setTimeout(function () { window.scrollTo(0, keep); }, 0);
        // Si cambian los pasos (un segundo servicio, otra persona), la vista
        // previa vuelve al primero: si no, seguiría en un paso que ya no es el
        // que vería el cliente.
        if (!hadMeta || !meta.services.some(function (s) { return s.id === st.service; }) || steps().join(',') !== prevSteps) { start(); return; }
        st.cache = {}; render();
      } else if (e.data.type === 'imb-booking-slots' && pvWait[e.data.id]) {
        var r = pvWait[e.data.id]; delete pvWait[e.data.id]; r({ slots: e.data.slots || [] });
      }
    });
    parent.postMessage({ type: 'imb-booking-ready' }, location.origin);
    render();
    return;
  }
  start();
})();
`;
