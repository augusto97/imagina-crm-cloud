/**
 * v0.1.375 (ADR-S97, addendum) — Las etiquetas de Google y Meta en el ENLACE
 * DIRECTO de un formulario o una agenda (el anuncio lleva directo a nuestra
 * página, sin el sitio de la empresa de por medio).
 *
 * Se cargan los scripts OFICIALES (`gtag.js` y `fbevents.js`) por el ID de la
 * empresa, nunca código pegado ni Tag Manager (que corre código arbitrario).
 * Como la página pública vive en el mismo origen que la app, esos scripts
 * quedan encerrados:
 *  - la CSP sólo deja hablar con la ruta pública del API (`/api/v1/public/`),
 *    no con el resto (un script de afuera no puede leer datos con la sesión
 *    de alguien del equipo que abra el enlace);
 *  - no puede cargar la app en un marco (`frame-src` sin 'self'), ni
 *    registrar workers, ni mandar formularios fuera de la ruta pública;
 *  - `Cross-Origin-Opener-Policy: same-origin`: si abre la app en otra
 *    ventana, no la puede tocar (la app no lleva esa cabecera → quedan en
 *    grupos de ventanas distintos);
 *  - las cookies de Google van a la ruta pública (no viajan a la app) y la
 *    dirección que ven las etiquetas lleva sólo la campaña (nunca respuestas
 *    precargadas, códigos ni datos personales).
 *
 * El código corre en la página (el cliente decide cuándo arrancarlo: nunca
 * insertado, en la vista previa ni actualizando un registro) y se autoriza
 * por su hash. Carga las etiquetas cuando la página ya se pintó.
 */
import { createHash } from 'node:crypto';
import { TRACKING_URL_PARAMS, type PublicDirectTags } from '@imagina-base/shared';

/** Dónde dejan sus cookies Google (no viajan con las llamadas de la app). */
export const DIRECT_TAGS_COOKIE_PATH = '/api/v1/public/';

/**
 * El código de las etiquetas. Expone `window.imbPixels` con `start(cfg)` y
 * `conversion(ev, done)`; `done` se llama cuando las etiquetas avisaron (o a
 * los 1,6 s como mucho), así la página de gracias espera lo justo.
 */
export const DIRECT_TAGS_JS = String.raw`(function () {
  'use strict';
  if (window.imbPixels) return;
  var top = false;
  try { top = window.top === window.self; } catch (e) { top = false; }
  var TRACK = ${JSON.stringify(TRACKING_URL_PARAMS)};
  var COOKIE_PATH = ${JSON.stringify(DIRECT_TAGS_COOKIE_PATH)};
  var cfg = null, loaded = false;

  function safeUrl() {
    try {
      var u = new URL(location.href), q = [];
      for (var i = 0; i < TRACK.length; i++) {
        var v = u.searchParams.get(TRACK[i]);
        if (v && v.length <= 400) q.push(encodeURIComponent(TRACK[i]) + '=' + encodeURIComponent(v));
      }
      return u.origin + u.pathname + (q.length ? '?' + q.join('&') : '');
    } catch (e) { return location.origin + location.pathname; }
  }
  function addScript(src) {
    var s = document.createElement('script');
    s.async = true; s.src = src;
    (document.head || document.documentElement).appendChild(s);
  }
  function load() {
    if (loaded || !cfg) return;
    loaded = true;
    // Las etiquetas mandan la dirección completa: sólo la campaña, nunca
    // respuestas precargadas ni códigos (la página ya los leyó al abrir).
    var clean = safeUrl();
    try { if (clean !== location.href) history.replaceState(history.state, '', clean.slice(location.origin.length)); } catch (e) {}
    if (cfg.google_ads_id || cfg.google_tag_id) {
      window.dataLayer = window.dataLayer || [];
      if (typeof window.gtag !== 'function') window.gtag = function () { window.dataLayer.push(arguments); };
      var common = { cookie_path: COOKIE_PATH, cookie_domain: 'none', page_location: clean, page_title: document.title };
      window.gtag('js', new Date());
      if (cfg.google_ads_id) window.gtag('config', cfg.google_ads_id, common);
      if (cfg.google_tag_id) window.gtag('config', cfg.google_tag_id, common);
      addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.google_tag_id || cfg.google_ads_id));
    }
    if (cfg.meta_pixel_id) {
      if (typeof window.fbq !== 'function') {
        var n = window.fbq = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
        if (!window._fbq) window._fbq = n;
        n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      }
      // Sin la detección automática de botones ni de datos de la página.
      window.fbq('set', 'autoConfig', false, cfg.meta_pixel_id);
      window.fbq('init', cfg.meta_pixel_id);
      window.fbq('track', 'PageView');
      addScript('https://connect.facebook.net/en_US/fbevents.js');
    }
  }
  function whenIdle(fn) {
    var go = function () { if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2000 }); else setTimeout(fn, 800); };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  }
  function str(v) { return typeof v === 'string' ? v.slice(0, 300) : ''; }

  window.imbPixels = {
    /** Arranca las etiquetas (una vez). Sólo en la página principal, nunca dentro de un marco. */
    start: function (c) {
      if (!top || cfg || !c || typeof c !== 'object') return false;
      var ok = function (v, re) { return typeof v === 'string' && re.test(v) ? v : null; };
      cfg = {
        google_ads: ok(c.google_ads, /^AW-\d{6,14}\/[A-Za-z0-9_-]{4,80}$/),
        google_ads_id: ok(c.google_ads_id, /^AW-\d{6,14}$/),
        google_tag_id: ok(c.google_tag_id, /^G-[A-Z0-9]{4,20}$/),
        meta_pixel_id: ok(c.meta_pixel_id, /^\d{8,20}$/)
      };
      if (!cfg.google_ads_id && !cfg.google_tag_id && !cfg.meta_pixel_id) { cfg = null; return false; }
      whenIdle(load);
      return true;
    },
    /** La conversión de un envío o una reserva; done() cuando las etiquetas terminaron (o a los 1,6 s). */
    conversion: function (ev, done) {
      var finished = false, waiting = 0;
      function end() { if (finished) return; finished = true; if (typeof done === 'function') done(); }
      function one() { waiting--; if (waiting <= 0) end(); }
      if (!cfg || !ev || typeof ev !== 'object') { end(); return; }
      load();
      var booking = ev.kind === 'booking';
      var sub = str(ev.submission_id);
      var value = typeof ev.value === 'number' && isFinite(ev.value) && ev.value >= 0 ? ev.value : null;
      var currency = value !== null && /^[A-Z]{3}$/.test(ev.currency || '') ? ev.currency : null;
      if (value !== null && !currency) value = null;
      var ud = ev.user_data && typeof ev.user_data === 'object' ? ev.user_data : null;
      var email = ud ? str(ud.email) : '', phone = ud ? str(ud.phone_number) : '';
      if (typeof window.gtag === 'function') {
        try {
          if (email || phone) {
            var user = {};
            if (email) user.email = email;
            if (phone) user.phone_number = phone;
            window.gtag('set', 'user_data', user);
          }
          if (cfg.google_ads) {
            var p = { send_to: cfg.google_ads, transaction_id: sub };
            if (value !== null) { p.value = value; p.currency = currency; }
            waiting++; p.event_callback = one; p.event_timeout = 1500;
            window.gtag('event', 'conversion', p);
          }
          if (cfg.google_tag_id) {
            var g = { send_to: cfg.google_tag_id, lead_source: booking ? 'booking' : 'form', form_name: str(ev.name) };
            if (value !== null) { g.value = value; g.currency = currency; }
            waiting++; g.event_callback = one; g.event_timeout = 1500;
            window.gtag('event', 'generate_lead', g);
          }
        } catch (e) {}
      }
      if (cfg.meta_pixel_id && typeof window.fbq === 'function') {
        try {
          // Conversiones mejoradas: Meta normaliza y cifra lo que recibe en init.
          if (email || phone) {
            var am = {};
            if (email) am.em = email.toLowerCase();
            if (phone) am.ph = phone.replace(/\D/g, '');
            window.fbq('init', cfg.meta_pixel_id, am);
          }
          window.fbq('track', booking ? 'Schedule' : 'Lead', value !== null ? { value: value, currency: currency } : {}, { eventID: sub });
        } catch (e) {}
      }
      if (waiting <= 0) setTimeout(end, 300);
      else setTimeout(end, 1600);
    }
  };
})();`;

/** El texto exacto que va en la página (nada puede cerrar la etiqueta). */
export function directTagsScriptText(): string {
    return DIRECT_TAGS_JS.replace(/<\/script/gi, '<\\/script');
}

let hash: string | null = null;
/** `sha256-…` del código de las etiquetas (va a `script-src`). */
export function directTagsHash(): string {
    hash ??= `sha256-${createHash('sha256').update(directTagsScriptText(), 'utf8').digest('base64')}`;
    return hash;
}

/**
 * Google pide cada dominio de su país por separado (la CSP no admite
 * comodines al final del dominio): los de las regiones donde se usa la app.
 */
const GOOGLE_COUNTRY_TLDS = [
    'com.co',
    'com.mx',
    'com.ar',
    'cl',
    'com.pe',
    'com.ec',
    'com.uy',
    'com.py',
    'com.bo',
    'co.ve',
    'com.gt',
    'com.do',
    'co.cr',
    'com.pa',
    'com.sv',
    'com.hn',
    'com.ni',
    'com.pr',
    'com.br',
    'es',
    'us',
];

export interface DirectTagsCsp {
    script: string[];
    img: string[];
    connect: string[];
    frame: string[];
    formAction: string[];
}

/** Los orígenes que cada etiqueta necesita (las guías de CSP de Google y Meta). */
export function directTagsCsp(t: Pick<PublicDirectTags, 'google_ads_id' | 'google_tag_id' | 'meta_pixel_id'>): DirectTagsCsp {
    const out: DirectTagsCsp = { script: [], img: [], connect: [], frame: [], formAction: [] };
    const add = (k: keyof DirectTagsCsp, ...v: string[]): void => {
        for (const s of v) if (!out[k].includes(s)) out[k].push(s);
    };
    const country = GOOGLE_COUNTRY_TLDS.map((tld) => `https://www.google.${tld}`);
    if (t.google_ads_id || t.google_tag_id) {
        add('script', 'https://www.googletagmanager.com');
        add('img', 'https://www.googletagmanager.com', 'https://*.google.com', ...country, 'https://*.g.doubleclick.net');
        add('connect', 'https://www.googletagmanager.com', 'https://*.google.com', ...country, 'https://*.g.doubleclick.net', 'https://pagead2.googlesyndication.com');
        add('frame', 'https://www.googletagmanager.com');
    }
    if (t.google_ads_id) {
        add('script', 'https://www.googleadservices.com', 'https://www.google.com');
        add('img', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://pagead2.googlesyndication.com');
        add('connect', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://ad.doubleclick.net');
        add('frame', 'https://td.doubleclick.net');
    }
    if (t.google_tag_id) {
        add('img', 'https://*.google-analytics.com');
        add('connect', 'https://*.google-analytics.com', 'https://*.analytics.google.com');
    }
    if (t.meta_pixel_id) {
        add('script', 'https://connect.facebook.net');
        add('img', 'https://www.facebook.com');
        add('connect', 'https://www.facebook.com', 'https://connect.facebook.net');
        add('frame', 'https://www.facebook.com');
        add('formAction', 'https://www.facebook.com');
    }
    return out;
}

/** El origen de la página (para limitar la CSP a la ruta pública). null si no se puede saber con certeza. */
export function pageOrigin(protocol: string | undefined, host: string | undefined): string | null {
    const h = (host ?? '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
    const p = protocol === 'http' ? 'http' : 'https';
    return `${p}://${h}`;
}
