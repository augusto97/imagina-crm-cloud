import { CAPTCHA_PROVIDER_INFO, type CaptchaProvider, type PublicBookingMeta, type PublicManageMeta } from '@imagina-base/shared';
import { escapeHtml } from '../forms/form-page';

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

const CSS = `
  :root { color-scheme: light; --accent: #0e7490; --accent-ink: #ffffff; --accent-soft: rgba(14,116,144,.1); --bg: #f4f5f7; --card: #ffffff; --fg: #1d2330;
          --muted: #667085; --border: #d9dde5; --danger: #c0262d; --ok: #067647; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg);
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  body.embedded { background: transparent; }
  [hidden] { display: none !important; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 14px 48px; }
  body.embedded .wrap { padding: 6px 4px 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
          box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 6px 24px rgba(16,24,40,.06); }
  body.embedded .card { box-shadow: none; }
  .band { height: 6px; background: var(--accent); }
  .inner { padding: 24px 24px 22px; }
  @media (max-width: 520px) { .inner { padding: 18px 14px 16px; } .wrap { padding: 10px 8px 28px; } }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: var(--muted); font-size: 13px; }
  .brand img { max-height: 36px; max-width: 160px; object-fit: contain; }
  h1 { font-size: 22px; line-height: 1.25; margin: 0 0 6px; font-weight: 700; letter-spacing: -.01em; }
  h2 { font-size: 17px; margin: 0 0 12px; font-weight: 650; }
  .desc p { margin: 0 0 6px; color: var(--muted); white-space: pre-wrap; }
  .loc { color: var(--muted); font-size: 14px; margin: 4px 0 0; }
  .steps { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 18px 0 14px; font-size: 13px; color: var(--muted); }
  .back { appearance: none; border: 0; background: none; padding: 6px 0; font: inherit; color: var(--fg); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; min-height: 36px; }
  .back:hover { text-decoration: underline; }
  .choices { display: grid; gap: 10px; }
  .opt { appearance: none; text-align: left; width: 100%; border: 1px solid var(--border); background: #fff; border-radius: 10px;
         padding: 12px 14px; font: inherit; color: var(--fg); cursor: pointer; display: flex; justify-content: space-between; gap: 12px; align-items: center; min-height: 52px; }
  .opt:hover, .opt:focus-visible { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }
  .opt .t { font-weight: 600; }
  .opt.cur { border-color: var(--accent); }
  .opt .s { color: var(--muted); font-size: 13px; }
  .opt .d { color: var(--muted); font-size: 13px; margin-top: 2px; white-space: pre-wrap; }
  .opt .r { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--fg); font-size: 12px; }
  .summary { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; font-size: 14px; background: #fafbfc; }
  .summary b { font-weight: 600; }
  .summary .row { display: flex; gap: 8px; padding: 2px 0; }
  .summary .row span:first-child { color: var(--muted); min-width: 88px; }
  .tz { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 13px; color: var(--muted); margin: 0 0 12px; }
  .tz select { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--fg); }
  .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .cal-head b { font-size: 16px; }
  .nav { appearance: none; border: 1px solid var(--border); background: #fff; border-radius: 8px; width: 40px; height: 40px; font-size: 18px; cursor: pointer; color: var(--fg); }
  .nav[disabled] { opacity: .35; cursor: default; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .datepick { display: grid; gap: 18px; }
  .datepick h2.day-title { margin: 0 0 4px; }
  @media (min-width: 640px) {
    .datepick { grid-template-columns: minmax(0, 340px) minmax(0, 1fr); align-items: start; gap: 24px; }
    .datepick .slots { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }
  }
  .dow { text-align: center; font-size: 11px; color: var(--muted); text-transform: uppercase; padding: 4px 0; }
  .day { appearance: none; border: 0; background: transparent; border-radius: 10px; aspect-ratio: 1 / 1; font: inherit; font-size: 15px;
         color: #b4bac5; cursor: default; position: relative; min-height: 40px; }
  .day.on { background: var(--accent-soft); color: var(--fg); font-weight: 600; cursor: pointer; }
  .day.on:hover, .day.on:focus-visible { outline: 2px solid var(--accent); }
  .day.sel { background: var(--accent); color: var(--accent-ink); }
  .day.today::after { content: ''; position: absolute; left: 50%; bottom: 6px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: currentColor; }
  .slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin-top: 14px; }
  .slot { appearance: none; border: 1px solid var(--accent); background: #fff; color: var(--fg); border-radius: 8px; padding: 10px 8px; font: inherit; font-weight: 600; cursor: pointer; min-height: 44px; }
  .slot:hover, .slot:focus-visible { background: var(--accent); color: var(--accent-ink); outline: none; }
  .empty { color: var(--muted); font-size: 14px; padding: 12px 0; }
  .loading { color: var(--muted); font-size: 14px; padding: 12px 0; }
  label.q { display: block; font-weight: 600; margin: 14px 0 6px; }
  .req { color: var(--danger); margin-left: 3px; }
  .help { color: var(--muted); font-size: 13px; margin: -2px 0 6px; white-space: pre-wrap; }
  input[type=text], input[type=email], input[type=tel], input[type=date], input[type=datetime-local], input[type=number], select, textarea {
    width: 100%; font: inherit; color: var(--fg); background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; min-height: 44px; }
  textarea { min-height: 96px; resize: vertical; }
  @media (max-width: 768px) { input, select, textarea { font-size: 16px; } }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  .chk { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; margin: 6px 0; }
  .chk input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent); flex: none; }
  .err { color: var(--danger); font-size: 13px; margin-top: 4px; }
  .invalid input, .invalid select, .invalid textarea { border-color: var(--danger); }
  .alert { border: 1px solid #f3c2c4; background: #fdf1f1; color: var(--danger); border-radius: 8px; padding: 10px 12px; margin: 12px 0; font-size: 14px; }
  .note-ok { border: 1px solid #b7e4cc; background: #effaf4; color: var(--ok); border-radius: 8px; padding: 10px 12px; margin: 12px 0; font-size: 14px; }
  .btn { appearance: none; border: 0; border-radius: 8px; padding: 11px 20px; font: inherit; font-weight: 600; background: var(--accent); color: var(--accent-ink);
         cursor: pointer; min-height: 46px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .btn[disabled] { opacity: .6; cursor: default; }
  .btn.ghost { background: #fff; color: var(--fg); border: 1px solid var(--border); }
  .btn.danger { background: var(--danger); color: #fff; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  @media (max-width: 520px) { .actions .btn { flex: 1 1 100%; } }
  .done { text-align: center; padding: 8px 0 4px; }
  .tick { width: 54px; height: 54px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 10px; }
  .tick.x { background: #f2f4f7; color: var(--muted); }
  .done .summary { text-align: left; margin-top: 14px; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .consent { margin-top: 16px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: #fafbfc; font-size: 14px; }
  .consent-text { white-space: pre-wrap; font-size: 13px; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; max-height: 240px; overflow: auto; margin-top: 8px; background: #fff; }
  .linkbtn { appearance: none; border: 0; background: none; padding: 0; font: inherit; font-size: 13px; color: var(--fg); text-decoration: underline; cursor: pointer; }
  .captcha { margin-top: 16px; min-height: 66px; }
  .pv { border: 1.5px dashed var(--border); border-radius: 8px; padding: 10px; color: var(--muted); font-size: 13px; text-align: center; margin-top: 12px; }
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

export function renderBookingPage(opts: { nonce: string; title: string; boot: BookingPageBoot }): string {
    const boot = jsonForScript({ ...opts.boot, scripts: CAPTCHA_SCRIPTS });
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(opts.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap"><div class="card"><div class="band"></div><div class="inner" id="root" data-testid="booking-root"></div></div></div>
<script type="application/json" id="boot">${boot}</script>
<script nonce="${opts.nonce}">${CLIENT_JS}</script>
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
  var root = document.getElementById('root');
  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  if (embedded) document.body.classList.add('embedded');
  var PREVIEW = MODE === 'preview';
  var API = MODE === 'manage'
    ? '/api/v1/public/booking/manage/' + encodeURIComponent(BOOT.token)
    : '/api/v1/public/booking/' + encodeURIComponent(BOOT.token);

  var meta = MODE === 'manage' && BOOT.manage ? BOOT.manage.booking : BOOT.meta;
  var manage = BOOT.manage;
  var visitorTz = 'UTC';
  try { visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
  var st = {
    step: 'service', service: null, staff: 'any', month: null, day: null, slot: null,
    showTz: null, values: {}, busy: false, cache: {}, alert: '', errors: {}, done: null, cancelOpen: false
  };
  var captchaToken = null, captchaWidget = null;
  var pvReq = 0, pvWait = {};

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
  function ink(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#ffffff';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function ch(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    return L > 0.45 ? '#1d2330' : '#ffffff';
  }
  function soft(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'rgba(14,116,144,.1)';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.12)';
  }
  function reportHeight() {
    if (!embedded || PREVIEW) return;
    try { parent.postMessage({ type: 'imb-form-height', height: Math.ceil(document.documentElement.scrollHeight) }, '*'); } catch (e) {}
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
    var key = st.service + '|' + st.staff + '|' + from + '|' + to;
    if (st.cache[key]) return Promise.resolve(st.cache[key]);
    var p;
    if (PREVIEW) {
      p = new Promise(function (resolve) {
        var id = ++pvReq;
        pvWait[id] = resolve;
        parent.postMessage({ type: 'imb-booking-slots-request', id: id, service: st.service, staff: st.staff, from: from, to: to }, location.origin);
        setTimeout(function () { if (pvWait[id]) { delete pvWait[id]; resolve({ slots: [] }); } }, 15000);
      });
    } else {
      var q = '?service=' + encodeURIComponent(st.service) + '&staff=' + encodeURIComponent(st.staff) + '&from=' + from + '&to=' + to;
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
    var s = steps(), i = s.indexOf(st.step);
    if (i > 0) go(s[i - 1]);
    else if (MODE === 'manage') { st.step = 'summary'; render(); }
  }

  function header() {
    var box = el('div');
    if (meta.logo_url) box.appendChild(el('div', { cls: 'brand' }, [el('img', { src: meta.logo_url, alt: meta.company })]));
    else if (meta.company) box.appendChild(el('div', { cls: 'brand', text: meta.company }));
    box.appendChild(el('h1', { text: MODE === 'manage' ? 'Tu cita' : meta.title }));
    if (MODE !== 'manage' && meta.description) {
      var d = el('div', { cls: 'desc' });
      meta.description.split(/\n{2,}/).forEach(function (p) { if (p.trim()) d.appendChild(el('p', { text: p })); });
      box.appendChild(d);
    }
    if (meta.location && MODE !== 'manage') box.appendChild(el('p', { cls: 'loc', text: '\u{1F4CD} ' + meta.location }));
    return box;
  }

  function stepBar() {
    var s = steps(), i = s.indexOf(st.step);
    var bar = el('div', { cls: 'steps' });
    var canBack = i > 0 || MODE === 'manage';
    bar.appendChild(canBack ? el('button', { type: 'button', cls: 'back', text: '\u2190 Volver', on: { click: back }, 'data-testid': 'booking-back' }) : el('span'));
    if (i >= 0) bar.appendChild(el('span', { text: 'Paso ' + (i + 1) + ' de ' + s.length }));
    return bar;
  }

  function summaryBox(withSlot) {
    var svc = serviceById(st.service);
    var rows = [];
    if (svc) rows.push(['Servicio', svc.name + ' · ' + svc.duration_min + ' min']);
    if (st.staff && st.staff !== 'any') rows.push(['Con', staffName(st.staff)]);
    else if (meta.choose_staff) rows.push(['Con', 'El primero disponible']);
    if (withSlot && st.slot) rows.push(['Cuándo', whenLong(st.slot.start, tzShown())]);
    var box = el('div', { cls: 'summary', 'data-testid': 'booking-summary' });
    rows.forEach(function (r) { box.appendChild(el('div', { cls: 'row' }, [el('span', { text: r[0] }), el('b', { text: r[1] })])); });
    return box;
  }

  function renderService() {
    root.appendChild(el('h2', { text: 'Elige el servicio' }));
    var list = el('div', { cls: 'choices' });
    (meta.services || []).forEach(function (s) {
      var left = el('div', null, [el('div', { cls: 't', text: s.name }), el('div', { cls: 's', text: s.duration_min + ' minutos' })]);
      if (s.description) left.appendChild(el('div', { cls: 'd', text: s.description }));
      list.appendChild(el('button', { type: 'button', cls: 'opt', 'data-service': s.id, on: { click: function () {
        st.service = s.id; st.staff = 'any'; st.day = null; st.slot = null;
        var s2 = steps(); go(s2[s2.indexOf('service') + 1]);
      } } }, [left, s.price_label ? el('span', { cls: 'r', text: s.price_label }) : null]));
    });
    if (!(meta.services || []).length) list.appendChild(el('div', { cls: 'empty', text: 'Todavía no hay servicios para agendar.' }));
    root.appendChild(list);
  }

  function renderStaff() {
    root.appendChild(summaryBox(false));
    root.appendChild(el('h2', { text: '¿Con quién?' }));
    var list = el('div', { cls: 'choices' });
    list.appendChild(el('button', { type: 'button', cls: 'opt', 'data-staff': 'any', on: { click: function () { st.staff = 'any'; st.day = null; go('date'); } } },
      [el('div', null, [el('div', { cls: 't', text: 'El primero disponible' }), el('div', { cls: 's', text: 'Más horarios para elegir' })])]));
    staffFor(st.service).forEach(function (s) {
      var now = MODE === 'manage' && manage && manage.staff_id === s.id;
      list.appendChild(el('button', { type: 'button', cls: 'opt' + (now ? ' cur' : ''), 'data-staff': s.id, on: { click: function () { st.staff = s.id; st.day = null; go('date'); } } },
        [el('div', null, [el('div', { cls: 't', text: s.name }), now ? el('div', { cls: 's', text: 'Te atiende ahora' }) : null])]));
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

  function renderDate() {
    root.appendChild(summaryBox(false));
    root.appendChild(el('h2', { text: 'Elige el día y la hora' }));
    root.appendChild(tzControl());
    var tz = tzShown();
    var today = todayIn(tz);
    if (!st.month) st.month = today.slice(0, 7);
    var y = Number(st.month.slice(0, 4)), mo = Number(st.month.slice(5, 7));
    var first = st.month + '-01';
    var daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var last = st.month + '-' + (daysIn < 10 ? '0' : '') + daysIn;
    var lastAllowed = addDays(today, (meta.max_days_ahead || 60) + 1);
    var head = el('div', { cls: 'cal-head' });
    var prev = el('button', { type: 'button', cls: 'nav', 'aria-label': 'Mes anterior', text: '\u2039', 'data-testid': 'booking-prev', on: { click: function () { st.month = addDays(first, -1).slice(0, 7); st.day = null; render(); } } });
    var next = el('button', { type: 'button', cls: 'nav', 'aria-label': 'Mes siguiente', text: '\u203A', 'data-testid': 'booking-next', on: { click: function () { st.month = addDays(last, 1).slice(0, 7); st.day = null; render(); } } });
    if (first <= today) prev.disabled = true;
    if (last >= lastAllowed) next.disabled = true;
    var title = cap(new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, mo - 1, 1))));
    head.appendChild(prev); head.appendChild(el('b', { text: title })); head.appendChild(next);
    // Calendario y horarios lado a lado en pantallas anchas; apilados en el celular.
    var pick = el('div', { cls: 'datepick' });
    var calBox = el('div');
    calBox.appendChild(head);
    pick.appendChild(calBox);
    root.appendChild(pick);
    var grid = el('div', { cls: 'grid', role: 'grid', 'aria-label': title, 'data-testid': 'booking-calendar' });
    ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'].forEach(function (d) { grid.appendChild(el('div', { cls: 'dow', text: d })); });
    var dow = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
    for (var i = 0; i < dow; i++) grid.appendChild(el('div'));
    var cells = {};
    for (var d = 1; d <= daysIn; d++) {
      var ymd = st.month + '-' + (d < 10 ? '0' : '') + d;
      var b = el('button', { type: 'button', cls: 'day' + (ymd === today ? ' today' : '') + (ymd === st.day ? ' sel' : ''), text: String(d), disabled: true, 'data-day': ymd });
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
          g.appendChild(el('button', { type: 'button', cls: 'slot', text: timeLabel(s.start, tz), 'data-start': s.start, on: { click: function () { pickSlot(s); } } }));
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
    if (node) node.classList.toggle('invalid', !!msg);
  }
  function fieldBox(key, labelText, required, control, help) {
    var box = el('div', { 'data-q': key });
    box.appendChild(el('label', { cls: 'q', for: 'q_' + key }, [labelText, required ? el('span', { cls: 'req', text: '*' }) : null]));
    if (help) box.appendChild(el('div', { cls: 'help', text: help }));
    box.appendChild(control);
    var msg = st.errors[key];
    if (msg) { box.classList.add('invalid'); box.appendChild(el('div', { cls: 'err', role: 'alert', text: msg })); }
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
      if (q.type === 'heading') { questionsHost.appendChild(el('h2', { text: q.text, style: 'margin-top:18px' })); return; }
      if (q.type === 'text') { questionsHost.appendChild(el('p', { cls: 'muted', text: q.text })); return; }
      if (q.hidden) return;
      var c = questionControl(q);
      questionsHost.appendChild(q.field_type === 'checkbox' ? fieldBox(q.id, '', false, c, q.help) : fieldBox(q.id, q.label, q.required, c, q.help));
    });
  }

  function renderDetails() {
    root.appendChild(summaryBox(true));
    root.appendChild(el('h2', { text: 'Tus datos' }));
    var form = el('form', { novalidate: true, 'data-testid': 'booking-form' });
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
      var full = el('div', { cls: 'consent-text', hidden: true, text: dc.text });
      var toggle = el('button', { type: 'button', cls: 'linkbtn', text: 'Ver la autorización completa', on: { click: function () { full.hidden = !full.hidden; reportHeight(); } } });
      var cbox = el('div', { cls: 'consent' + (st.errors.__consent ? ' invalid' : '') }, [el('label', { cls: 'chk' }, [consentCb, el('span', { text: dc.label })]), toggle, full]);
      if (dc.policy_url && /^https:\/\//i.test(dc.policy_url)) cbox.appendChild(el('div', { cls: 'small' }, [el('a', { href: dc.policy_url, target: '_blank', rel: 'noopener noreferrer', text: 'Política de tratamiento de datos' })]));
      if (st.errors.__consent) cbox.appendChild(el('div', { cls: 'err', role: 'alert', text: st.errors.__consent }));
      form.appendChild(cbox);
    }
    var hp = el('div', { cls: 'hp', 'aria-hidden': 'true' }, [el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', id: 'hp' })]);
    form.appendChild(hp);
    var captchaBox = null;
    if (meta.captcha && !PREVIEW) { captchaBox = el('div', { cls: 'captcha' }); form.appendChild(captchaBox); }
    if (meta.captcha && PREVIEW) form.appendChild(el('div', { cls: 'pv', text: 'Aquí va la verificación anti-robots.' }));
    if (st.alert) form.appendChild(el('div', { cls: 'alert', role: 'alert', text: st.alert, 'data-testid': 'booking-alert' }));
    var submit = el('button', { type: 'submit', cls: 'btn', text: st.busy ? 'Agendando…' : 'Confirmar cita', disabled: st.busy, 'data-testid': 'booking-submit' });
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
    var values = {};
    (meta.questions || []).forEach(function (q) { if (q.type === 'field' && visible(q) && st.values[q.key] !== undefined) values[q.key] = st.values[q.key]; });
    var body = {
      service_id: st.service, staff_id: st.staff, start: st.slot.start,
      name: st.values.__name.trim(), email: st.values.__email.trim(), values: values,
      stamp: meta.stamp, hp: (document.getElementById('hp') || {}).value || '', time_zone: visitorTz
    };
    if ((st.values.__phone || '').trim()) body.phone = st.values.__phone.trim();
    if (meta.data_consent) { body.consent = st.values.__consent === true; body.consent_version = meta.data_consent.version; }
    if (meta.captcha) body.captcha = captchaToken || '';
    st.busy = true; st.alert = ''; render();
    fetch(API + '/book', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
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

  // ── Confirmación ──
  function renderDone() {
    var a = st.done || {};
    var box = el('div', { cls: 'done', 'data-testid': 'booking-done' });
    box.appendChild(el('div', { cls: 'tick', text: '\u2713', 'aria-hidden': 'true' }));
    box.appendChild(el('h2', { text: a.preview ? 'Vista previa: así se confirma la cita' : '¡Tu cita quedó agendada!' }));
    if (meta.success_message) box.appendChild(el('p', { cls: 'muted', text: meta.success_message }));
    if (a.preview) {
      box.appendChild(summaryBox(true));
      box.appendChild(el('div', { cls: 'pv', text: 'En la vista previa no se agenda nada.' }));
      root.appendChild(box);
      return;
    }
    if (a.start) {
      var sum = el('div', { cls: 'summary' });
      [['Servicio', a.service], ['Con', a.staff], ['Cuándo', whenLong(a.start, tzShown())], ['Dónde', a.location]].forEach(function (r) {
        if (r[1]) sum.appendChild(el('div', { cls: 'row' }, [el('span', { text: r[0] }), el('b', { text: r[1] })]));
      });
      box.appendChild(sum);
      var acts = el('div', { cls: 'actions', style: 'justify-content:center' });
      acts.appendChild(el('a', { cls: 'btn', href: a.ics_url, 'data-testid': 'booking-ics', text: 'Agregar a mi calendario' }));
      if (a.can_reschedule || a.can_cancel) acts.appendChild(el('a', { cls: 'btn ghost', href: a.manage_url, target: embedded ? '_blank' : undefined, rel: 'noopener', 'data-testid': 'booking-manage-link', text: 'Cambiar o cancelar' }));
      box.appendChild(acts);
    }
    root.appendChild(box);
  }

  // ── Gestión de una cita ──
  function apptSummary(a) {
    var sum = el('div', { cls: 'summary', 'data-testid': 'booking-appt' });
    [['Servicio', a.service], ['Con', a.staff], ['Cuándo', whenLong(a.start, tzShown())], ['Dónde', a.location]].forEach(function (r) {
      if (r[1]) sum.appendChild(el('div', { cls: 'row' }, [el('span', { text: r[0] }), el('b', { text: r[1] })]));
    });
    return sum;
  }
  function renderSummary() {
    var a = manage.appointment;
    if (a.status === 'cancelled') {
      root.appendChild(el('div', { cls: 'done' }, [el('div', { cls: 'tick x', text: '\u2715' }), el('h2', { text: 'Esta cita está cancelada' })]));
      root.appendChild(apptSummary(a));
      return;
    }
    root.appendChild(apptSummary(a));
    if (st.alert) root.appendChild(el('div', { cls: st.alertOk ? 'note-ok' : 'alert', role: 'status', text: st.alert, 'data-testid': 'booking-alert' }));
    if (a.locked_reason) root.appendChild(el('p', { cls: 'muted', text: a.locked_reason, 'data-testid': 'booking-locked' }));
    var acts = el('div', { cls: 'actions' });
    acts.appendChild(el('a', { cls: 'btn ghost', href: a.ics_url, text: 'Agregar a mi calendario' }));
    if (a.can_reschedule) acts.appendChild(el('button', { type: 'button', cls: 'btn', text: 'Cambiar el horario', 'data-testid': 'booking-reschedule', on: { click: function () {
      st.service = manage.service_id; st.staff = manage.staff_id || 'any'; st.month = null; st.day = null; st.cache = {};
      var s = steps(); go(s.indexOf('staff') >= 0 ? 'staff' : 'date');
    } } }));
    if (a.can_cancel) acts.appendChild(el('button', { type: 'button', cls: 'btn danger', text: 'Cancelar la cita', 'data-testid': 'booking-cancel', on: { click: function () { st.cancelOpen = true; render(); } } }));
    root.appendChild(acts);
    if (st.cancelOpen && a.can_cancel) {
      var reason = el('textarea', { id: 'q_reason', placeholder: 'Opcional: cuéntanos por qué', maxlength: '500' });
      var confirm = el('button', { type: 'button', cls: 'btn danger', text: st.busy ? 'Cancelando…' : 'Sí, cancelar mi cita', disabled: st.busy, 'data-testid': 'booking-cancel-confirm', on: { click: function () { doCancel(reason.value); } } });
      var keep = el('button', { type: 'button', cls: 'btn ghost', text: 'No, mantenerla', on: { click: function () { st.cancelOpen = false; render(); } } });
      root.appendChild(el('div', { cls: 'consent', style: 'margin-top:16px' }, [el('b', { text: '¿Cancelar la cita?' }), el('label', { cls: 'q', for: 'q_reason', text: 'Motivo' }), reason, el('div', { cls: 'actions' }, [confirm, keep])]));
    }
  }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
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
    root.appendChild(el('h2', { text: '¿Cambiar tu cita a este horario?' }));
    root.appendChild(apptSummary({ service: manage.appointment.service, staff: st.staff !== 'any' ? staffName(st.staff) : manage.appointment.staff, start: s.start, location: manage.appointment.location }));
    var yes = el('button', { type: 'button', cls: 'btn', text: 'Sí, cambiar', 'data-testid': 'booking-reschedule-confirm', on: { click: function () {
      yes.disabled = true; yes.textContent = 'Cambiando…';
      post('/reschedule', { start: s.start, staff_id: st.staff, time_zone: visitorTz }).then(function (res) {
        if (res.status >= 200 && res.status < 300) { manage.appointment = res.body; st.alert = 'Listo: tu cita cambió de horario. Te enviamos la confirmación por correo.'; st.alertOk = true; st.step = 'summary'; render(); return; }
        st.alert = (res.body && res.body.message) || 'No pudimos cambiar la cita.'; st.alertOk = false;
        if (res.body && res.body.code === 'booking_slot_taken') { st.cache = {}; st.step = 'date'; render(); return; }
        st.step = 'summary'; render();
      });
    } } });
    var no = el('button', { type: 'button', cls: 'btn ghost', text: 'Elegir otro', on: { click: function () { st.slot = null; go('date'); } } });
    root.appendChild(el('div', { cls: 'actions' }, [yes, no]));
    reportHeight();
  }

  // ── Render ──
  function render() {
    root.textContent = '';
    if (!meta) { root.appendChild(el('div', { cls: 'loading', text: 'Cargando…' })); return; }
    var accent = meta.accent_color || '#0e7490';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-ink', ink(accent));
    document.documentElement.style.setProperty('--accent-soft', soft(accent));
    root.appendChild(header());
    if (MODE === 'book' && meta.closed) { root.appendChild(el('p', { cls: 'empty', text: meta.closed, 'data-testid': 'booking-closed' })); return; }
    if (MODE === 'manage' && st.step === 'summary') { renderSummary(); reportHeight(); return; }
    if (st.step === 'done') { renderDone(); reportHeight(); return; }
    if (MODE !== 'manage' && st.alert && st.step === 'date') root.appendChild(el('div', { cls: 'alert', role: 'alert', text: st.alert, 'data-testid': 'booking-alert' }));
    if (MODE === 'manage' && st.alert && st.step === 'date') root.appendChild(el('div', { cls: 'alert', role: 'alert', text: st.alert }));
    root.appendChild(stepBar());
    if (st.step === 'service') renderService();
    else if (st.step === 'staff') renderStaff();
    else if (st.step === 'date') renderDate();
    else if (st.step === 'details') renderDetails();
    reportHeight();
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

  if (PREVIEW) {
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'imb-booking-preview') {
        var hadMeta = meta !== null;
        var prevSteps = hadMeta ? steps().join(',') : '';
        meta = e.data.meta;
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
