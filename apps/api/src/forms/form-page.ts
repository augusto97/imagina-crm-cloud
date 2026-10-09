import { randomBytes } from 'node:crypto';
import type { PublicFormMeta } from '@imagina-base/shared';

/**
 * v0.1.275 (ADR-S39) — Página pública de un formulario. La sirve el API
 * (`GET /api/v1/public/f/:token`) y no el SPA por la misma razón que la
 * lista pública (ADR-S14): el proxy le pone al SPA `frame-ancestors 'self'`
 * y eso no se cambia desde una actualización, mientras que acá cada
 * formulario decide qué sitios lo pueden insertar.
 *
 * Todo el contenido se arma con `textContent`/`createElement`: ni una
 * etiqueta, descripción u opción llega como HTML. El script lleva nonce y
 * la CSP no deja correr otro.
 */

function escapeHtml(input: string): string {
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

export function formPageCsp(nonce: string, frameAncestors: string): string {
    return [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
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
}

export function renderFormPage(opts: PageOpts): string {
    const boot = jsonForScript({ token: opts.token, preview: opts.meta === null, meta: opts.meta });
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { --accent: #0e7490; --accent-ink: #ffffff; --bg: #f4f5f7; --card: #ffffff; --fg: #1d2330;
          --muted: #667085; --border: #d9dde5; --danger: #c0262d; --radius: 10px; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg);
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  body.embedded { background: transparent; }
  .wrap { max-width: 660px; margin: 0 auto; padding: 32px 16px 48px; }
  body.embedded .wrap { padding: 8px 4px 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px;
          box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 6px 24px rgba(16,24,40,.06); overflow: hidden; }
  body.embedded .card { box-shadow: none; }
  .band { height: 6px; background: var(--accent); }
  .inner { padding: 28px 28px 24px; }
  @media (max-width: 520px) { .inner { padding: 22px 18px 18px; } }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; color: var(--muted); font-size: 13px; }
  .brand img { max-height: 36px; max-width: 160px; object-fit: contain; }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 8px; font-weight: 700; letter-spacing: -.01em; }
  .desc p { margin: 0 0 8px; color: var(--muted); white-space: pre-wrap; }
  .items { margin-top: 22px; display: flex; flex-direction: column; gap: 20px; }
  .item[hidden] { display: none; }
  .sec { font-size: 17px; font-weight: 650; margin: 10px 0 -6px; padding-top: 14px; border-top: 1px solid var(--border); }
  .note p { margin: 0 0 6px; white-space: pre-wrap; color: var(--fg); }
  .q { display: block; font-weight: 600; margin-bottom: 6px; }
  .req { color: var(--danger); margin-left: 3px; }
  .help { color: var(--muted); font-size: 13px; margin: -2px 0 8px; white-space: pre-wrap; }
  input[type=text], input[type=email], input[type=tel], input[type=url], input[type=date],
  input[type=datetime-local], select, textarea {
    width: 100%; font: inherit; color: var(--fg); background: #fff; border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 12px; min-height: 42px; }
  textarea { min-height: 110px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  .affix { display: flex; align-items: stretch; }
  .affix span { display: flex; align-items: center; padding: 0 12px; border: 1px solid var(--border); background: #f8f9fb;
                color: var(--muted); font-size: 14px; }
  .affix span.pre { border-radius: 8px 0 0 8px; border-right: 0; }
  .affix span.suf { border-radius: 0 8px 8px 0; border-left: 0; }
  .affix input.pre { border-radius: 0 8px 8px 0; }
  .affix input.suf { border-radius: 8px 0 0 8px; }
  .choices { display: flex; flex-direction: column; gap: 6px; }
  .choice { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--border);
            border-radius: 8px; cursor: pointer; background: #fff; }
  .choice:hover { border-color: var(--accent); }
  .choice input { width: 17px; height: 17px; accent-color: var(--accent); margin: 0; flex: none; }
  .check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
  .check input { width: 18px; height: 18px; accent-color: var(--accent); margin: 2px 0 0; flex: none; }
  .stars { display: flex; gap: 4px; }
  .stars button { border: 0; background: none; padding: 2px; cursor: pointer; font-size: 28px; line-height: 1; color: #c9ced8; }
  .stars button.on { color: #f5a524; }
  .files .drop { border: 1.5px dashed var(--border); border-radius: 8px; padding: 14px; text-align: center; color: var(--muted);
                 cursor: pointer; font-size: 14px; }
  .files .drop:hover { border-color: var(--accent); color: var(--fg); }
  .files ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .files li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px;
              border: 1px solid var(--border); border-radius: 8px; font-size: 14px; }
  .files li button { border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 13px; }
  .err { color: var(--danger); font-size: 13px; margin-top: 6px; }
  .item.invalid input, .item.invalid select, .item.invalid textarea { border-color: var(--danger); }
  .alert { border: 1px solid #f3c2c4; background: #fdf1f1; color: var(--danger); border-radius: 8px; padding: 10px 12px; margin-top: 18px; font-size: 14px; }
  .foot { margin-top: 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .btn { appearance: none; border: 0; border-radius: 8px; padding: 11px 22px; font: inherit; font-weight: 600;
         background: var(--accent); color: var(--accent-ink); cursor: pointer; min-height: 44px; }
  .btn[disabled] { opacity: .6; cursor: default; }
  .btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--border); }
  .done { text-align: center; padding: 28px 8px 12px; }
  .done .tick { width: 54px; height: 54px; border-radius: 50%; background: var(--accent); color: var(--accent-ink);
                display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 14px; }
  .done h2 { margin: 0 0 6px; font-size: 22px; }
  .done p { color: var(--muted); margin: 0 0 18px; white-space: pre-wrap; }
  .closed { text-align: center; padding: 24px 8px; color: var(--muted); white-space: pre-wrap; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .preview-item { cursor: pointer; border-radius: 8px; outline-offset: 6px; }
  .preview-item:hover { outline: 1px dashed #b7c0cd; }
  .preview-item.selected { outline: 2px solid var(--accent); }
  .pv-tag { display: inline-block; margin-bottom: 6px; padding: 1px 6px; border-radius: 4px; background: rgba(127,127,127,.14); color: var(--muted); font-size: 11px; }
  .pv-empty { color: var(--muted); text-align: center; padding: 24px 0; font-size: 14px; }
</style>
</head>
<body>
<div class="wrap"><div class="card"><div class="band"></div><div class="inner" id="root"></div></div></div>
<script type="application/json" id="boot">${boot}</script>
<script nonce="${opts.nonce}">${CLIENT_JS}</script>
</body>
</html>`;
}

/**
 * Cliente del formulario. Espeja `formItemVisible`/`evaluateFormCondition`
 * de shared (las condiciones las vuelve a evaluar el servidor al enviar: lo
 * que decide qué se guarda es el servidor, esto sólo arma la pantalla).
 */
const CLIENT_JS = String.raw`
(function () {
  'use strict';
  var BOOT = JSON.parse(document.getElementById('boot').textContent);
  var API = '/api/v1/public/forms/' + encodeURIComponent(BOOT.token);
  var root = document.getElementById('root');
  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  if (embedded) document.body.classList.add('embedded');

  var meta = BOOT.meta;
  var values = {};
  var uploads = {};
  var itemEls = {};
  var errEls = {};
  var selectedId = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'cls') n.className = attrs[k];
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function paragraphs(text, cls) {
    var box = el('div', { cls: cls });
    String(text || '').split(/\n{2,}/).forEach(function (p) { if (p.trim()) box.appendChild(el('p', { text: p })); });
    return box;
  }
  function ink(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#ffffff';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function ch(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    return L > 0.45 ? '#1d2330' : '#ffffff';
  }
  function empty(v) {
    if (v === null || v === undefined || v === false) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
  }
  function asNum(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return null;
  }
  function cond(c, a) {
    var e = empty(a);
    switch (c.op) {
      case 'is_empty': return e;
      case 'is_not_empty': return !e;
      case 'eq': case 'neq': {
        var m;
        if (Array.isArray(a)) m = a.map(String).indexOf(String(c.value)) >= 0;
        else if (typeof a === 'boolean') m = a === (c.value === true || c.value === 'true');
        else m = !e && String(a).trim().toLowerCase() === String(c.value == null ? '' : c.value).trim().toLowerCase();
        return c.op === 'eq' ? m : !m;
      }
      case 'in': {
        var w = Array.isArray(c.value) ? c.value.map(String) : [];
        if (!w.length) return false;
        if (Array.isArray(a)) return a.some(function (x) { return w.indexOf(String(x)) >= 0; });
        return !e && w.indexOf(String(a)) >= 0;
      }
      case 'contains':
        if (e) return false;
        if (Array.isArray(a)) return a.map(String).indexOf(String(c.value)) >= 0;
        return String(a).toLowerCase().indexOf(String(c.value == null ? '' : c.value).toLowerCase()) >= 0;
      case 'gt': case 'lt': {
        var x = asNum(a), y = asNum(c.value);
        if (x === null || y === null) return false;
        return c.op === 'gt' ? x > y : x < y;
      }
    }
    return false;
  }
  function visible(item, depth) {
    if (!item.show_if) return true;
    if ((depth || 0) > 20) return false;
    var ctl = null;
    meta.items.forEach(function (i) { if (i.type === 'field' && String(i.key) === String(item.show_if.field_id)) ctl = i; });
    if (!ctl) return false;
    if (!visible(ctl, (depth || 0) + 1)) return false;
    return cond(item.show_if, values[ctl.key]);
  }
  function refresh() {
    meta.items.forEach(function (i) {
      var n = itemEls[i.id]; if (!n) return;
      var show = (i.type !== 'field' || !i.hidden) && visible(i, 0);
      // Al diseñar se ve TODO: lo oculto y lo condicional, atenuado.
      if (BOOT.preview) show = true;
      n.hidden = !show;
    });
  }
  function parseNumber(s) {
    s = String(s || '').trim(); if (!s) return null;
    s = s.replace(/[^0-9.,\-]/g, '');
    // Tolerante: «1.500.000» y «1,500,000» son miles en cualquier formato, y
    // con los dos separadores el último es el decimal; un separador suelto
    // sigue el formato de la empresa.
    var dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
    if (dots && commas) {
      var dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      s = s.split(dec === '.' ? ',' : '.').join('');
      if (dec === ',') s = s.replace(',', '.');
    } else if (dots > 1) s = s.replace(/\./g, '');
    else if (commas > 1) s = s.replace(/,/g, '');
    else if (meta.number_format === 'comma_dot') s = s.replace(/,/g, '');
    else s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function setErr(id, msg) {
    var n = itemEls[id], e = errEls[id];
    if (!n || !e) return;
    e.textContent = msg || '';
    e.hidden = !msg;
    n.classList.toggle('invalid', !!msg);
  }
  function clearErrs() { Object.keys(errEls).forEach(function (id) { setErr(id, ''); }); }

  function control(f) {
    var key = f.key, id = 'q_' + f.id, cfg = f.config || {};
    var ph = f.placeholder || undefined;
    function bindText(input, transform) {
      input.addEventListener('input', function () { values[key] = transform ? transform(input.value) : input.value; setErr(f.id, ''); refresh(); });
      return input;
    }
    switch (f.field_type) {
      case 'long_text':
        return bindText(el('textarea', { id: id, placeholder: ph, maxlength: cfg.max_length }));
      case 'email':
        return bindText(el('input', { type: 'email', id: id, placeholder: ph || 'nombre@ejemplo.com', autocomplete: 'email' }));
      case 'url':
        return bindText(el('input', { type: 'text', inputmode: 'url', id: id, placeholder: ph || 'https://' }));
      case 'phone':
        return bindText(el('input', { type: 'tel', id: id, placeholder: ph, autocomplete: 'tel' }));
      case 'date':
        return bindText(el('input', { type: 'date', id: id }));
      case 'datetime':
        return bindText(el('input', { type: 'datetime-local', id: id }), function (v) {
          if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? v : d.toISOString();
        });
      case 'duration':
        return bindText(el('input', { type: 'text', id: id, placeholder: ph || 'Ej.: 1h 30m' }));
      case 'number': case 'currency': case 'percent': {
        var input = bindText(el('input', { type: 'text', inputmode: 'decimal', id: id, placeholder: ph }), parseNumber);
        if (f.field_type === 'currency') {
          input.className = 'pre';
          return el('div', { cls: 'affix' }, [el('span', { cls: 'pre', text: cfg.currency || '$' }), input]);
        }
        if (f.field_type === 'percent') {
          input.className = 'suf';
          return el('div', { cls: 'affix' }, [input, el('span', { cls: 'suf', text: '%' })]);
        }
        return input;
      }
      case 'checkbox': {
        var cb = el('input', { type: 'checkbox', id: id });
        cb.addEventListener('change', function () { values[key] = cb.checked; setErr(f.id, ''); refresh(); });
        return el('label', { cls: 'check', for: id }, [cb, el('span', { text: f.label })]);
      }
      case 'rating': {
        var max = Math.max(1, Math.min(10, cfg.max || 5));
        var box = el('div', { cls: 'stars', role: 'radiogroup', 'aria-label': f.label });
        var btns = [];
        function paint() { btns.forEach(function (b, i) { b.classList.toggle('on', (values[key] || 0) > i); }); }
        for (var i = 1; i <= max; i++) (function (n) {
          var b = el('button', { type: 'button', 'aria-label': n + ' de ' + max, text: '\u2605' });
          b.addEventListener('click', function () { values[key] = values[key] === n ? null : n; paint(); setErr(f.id, ''); refresh(); });
          btns.push(b); box.appendChild(b);
        })(i);
        box._paint = paint;
        return box;
      }
      case 'select': {
        var opts = f.options || [];
        if (f.display === 'dropdown') {
          var sel = el('select', { id: id }, [el('option', { value: '', text: ph || 'Elegí una opción' })]
            .concat(opts.map(function (o) { return el('option', { value: o.value, text: o.label }); })));
          sel.addEventListener('change', function () { values[key] = sel.value || null; setErr(f.id, ''); refresh(); });
          return sel;
        }
        var group = el('div', { cls: 'choices', role: 'radiogroup' });
        opts.forEach(function (o, idx) {
          var r = el('input', { type: 'radio', name: id, value: o.value, id: id + '_' + idx });
          r.addEventListener('change', function () { values[key] = o.value; setErr(f.id, ''); refresh(); });
          group.appendChild(el('label', { cls: 'choice', for: id + '_' + idx }, [r, el('span', { text: o.label })]));
        });
        return group;
      }
      case 'multi_select': {
        var list = el('div', { cls: 'choices' });
        (f.options || []).forEach(function (o, idx) {
          var c = el('input', { type: 'checkbox', value: o.value, id: id + '_' + idx });
          c.addEventListener('change', function () {
            var cur = Array.isArray(values[key]) ? values[key].slice() : [];
            if (c.checked) { if (cur.indexOf(o.value) < 0) cur.push(o.value); } else cur = cur.filter(function (v) { return v !== o.value; });
            values[key] = cur; setErr(f.id, ''); refresh();
          });
          list.appendChild(el('label', { cls: 'choice', for: id + '_' + idx }, [c, el('span', { text: o.label })]));
        });
        return list;
      }
      case 'file': {
        var maxFiles = Math.max(1, Math.min(10, cfg.max_files || 10));
        uploads[key] = [];
        var picker = el('input', { type: 'file', id: id, multiple: maxFiles > 1, hidden: true });
        var drop = el('div', { cls: 'drop', role: 'button', tabindex: '0', text: 'Elegí ' + (maxFiles > 1 ? 'archivos' : 'un archivo') + ' para subir' });
        var ul = el('ul');
        function render() {
          ul.textContent = '';
          uploads[key].forEach(function (u, idx) {
            var rm = el('button', { type: 'button', text: u.pending ? 'Subiendo…' : 'Quitar', disabled: !!u.pending });
            rm.addEventListener('click', function () { uploads[key].splice(idx, 1); render(); });
            ul.appendChild(el('li', null, [el('span', { text: u.name }), rm]));
          });
          values[key] = uploads[key].filter(function (u) { return !u.pending; }).length ? ['x'] : null;
          refresh();
        }
        drop.addEventListener('click', function () { if (!BOOT.preview) picker.click(); });
        drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!BOOT.preview) picker.click(); } });
        picker.addEventListener('change', function () {
          var chosen = Array.prototype.slice.call(picker.files || []);
          picker.value = '';
          chosen.slice(0, Math.max(0, maxFiles - uploads[key].length)).forEach(function (file) {
            if (file.size > meta.max_upload_bytes) { setErr(f.id, 'El archivo «' + file.name + '» es demasiado grande.'); return; }
            var u = { name: file.name, pending: true };
            uploads[key].push(u); render();
            var fd = new FormData(); fd.append('file', file, file.name);
            fetch(API + '/files', { method: 'POST', body: fd, credentials: 'omit' })
              .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
              .then(function (res) {
                if (!res.ok) throw new Error((res.b && res.b.message) || 'No se pudo subir el archivo.');
                u.pending = false; u.token = res.b.token; u.name = res.b.name || u.name; render(); setErr(f.id, '');
              })
              .catch(function (err) {
                uploads[key] = uploads[key].filter(function (x) { return x !== u; }); render();
                setErr(f.id, err.message || 'No se pudo subir el archivo.');
              });
          });
        });
        return el('div', { cls: 'files' }, [drop, picker, ul]);
      }
      default:
        return bindText(el('input', { type: 'text', id: id, placeholder: ph, maxlength: cfg.max_length }));
    }
  }

  function prefill(controls) {
    if (!meta.allow_prefill || BOOT.preview) return;
    var params = new URLSearchParams(location.search);
    meta.items.forEach(function (f) {
      if (f.type !== 'field' || !params.has(f.slug)) return;
      var raw = params.get(f.slug) || '';
      var c = controls[f.id];
      switch (f.field_type) {
        case 'multi_select': {
          var vals = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          values[f.key] = vals;
          if (c) c.querySelectorAll('input').forEach(function (i) { i.checked = vals.indexOf(i.value) >= 0; });
          break;
        }
        case 'checkbox': {
          var on = /^(1|true|si|sí|yes)$/i.test(raw);
          values[f.key] = on;
          if (c) { var cb = c.querySelector('input'); if (cb) cb.checked = on; }
          break;
        }
        case 'select': {
          values[f.key] = raw;
          if (c) {
            if (c.tagName === 'SELECT') c.value = raw;
            else c.querySelectorAll('input').forEach(function (i) { i.checked = i.value === raw; });
          }
          break;
        }
        case 'rating': values[f.key] = Number(raw) || null; if (c && c._paint) c._paint(); break;
        case 'file': break;
        case 'number': case 'currency': case 'percent':
          values[f.key] = parseNumber(raw);
          if (c) { var inp = c.tagName === 'INPUT' ? c : c.querySelector('input'); if (inp) inp.value = raw; }
          break;
        default:
          values[f.key] = raw;
          if (c && (c.tagName === 'INPUT' || c.tagName === 'TEXTAREA')) c.value = raw;
      }
    });
  }

  function render() {
    root.textContent = '';
    itemEls = {}; errEls = {};
    if (!meta) { root.appendChild(el('div', { cls: 'pv-empty', text: 'Cargando vista previa…' })); return; }
    var accent = meta.accent_color || '#0e7490';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-ink', ink(accent));
    if (!BOOT.preview) document.title = meta.title;

    if (meta.logo_url) root.appendChild(el('div', { cls: 'brand' }, [el('img', { src: meta.logo_url, alt: meta.company })]));
    root.appendChild(el('h1', { text: meta.title }));
    if (meta.description) root.appendChild(paragraphs(meta.description, 'desc'));

    if (meta.closed && !BOOT.preview) {
      root.appendChild(el('div', { cls: 'closed', text: meta.closed }));
      return;
    }

    var form = el('form', { novalidate: true });
    var items = el('div', { cls: 'items' });
    var controls = {};
    meta.items.forEach(function (i) {
      var node;
      if (i.type === 'heading') node = el('div', { cls: 'item sec', text: i.text });
      else if (i.type === 'text') node = el('div', { cls: 'item note' }, [paragraphs(i.text, '')]);
      else {
        var c = control(i);
        controls[i.id] = c;
        var kids = [];
        if (i.field_type !== 'checkbox') {
          var q = el('label', { cls: 'q', for: 'q_' + i.id, text: i.label });
          if (i.required) q.appendChild(el('span', { cls: 'req', text: '*', 'aria-hidden': 'true' }));
          kids.push(q);
        }
        if (i.help) kids.push(el('div', { cls: 'help', text: i.help }));
        kids.push(c);
        var err = el('div', { cls: 'err', role: 'alert', hidden: true });
        kids.push(err);
        errEls[i.id] = err;
        node = el('div', { cls: 'item' }, kids);
        if (BOOT.preview && i.hidden) node.style.opacity = '.55';
        if (BOOT.preview && i.hidden) node.insertBefore(el('span', { cls: 'pv-tag', text: 'Oculta · se completa desde la dirección' }), node.firstChild);
      }
      if (BOOT.preview) {
        node.classList.add('preview-item');
        if (i.show_if) node.insertBefore(el('span', { cls: 'pv-tag', text: 'Condicional · sólo aparece si se cumple su condición' }), node.firstChild);
        if (i.id === selectedId) node.classList.add('selected');
        node.addEventListener('click', function (e) {
          e.preventDefault();
          parent.postMessage({ type: 'imb-form-select', id: i.id }, location.origin);
        }, true);
      }
      itemEls[i.id] = node;
      items.appendChild(node);
    });
    if (BOOT.preview && !meta.items.length) items.appendChild(el('div', { cls: 'pv-empty', text: 'Agregá preguntas desde el panel de la izquierda.' }));
    form.appendChild(items);

    var hp = el('div', { cls: 'hp', 'aria-hidden': 'true' }, [el('label', { text: 'No completar' }), el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' })]);
    form.appendChild(hp);
    var alertBox = el('div', { cls: 'alert', role: 'alert', hidden: true });
    form.appendChild(alertBox);
    var btn = el('button', { type: 'submit', cls: 'btn', text: meta.submit_label || 'Enviar' });
    form.appendChild(el('div', { cls: 'foot' }, [btn]));
    root.appendChild(form);

    prefill(controls);
    refresh();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (BOOT.preview) return;
      clearErrs(); alertBox.hidden = true;
      var missing = false;
      meta.items.forEach(function (i) {
        if (i.type !== 'field' || i.hidden || !visible(i, 0)) return;
        if (i.required && empty(values[i.key])) { setErr(i.id, 'Esta pregunta es obligatoria.'); missing = true; }
        else if (i.field_type === 'email' && !empty(values[i.key]) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[i.key])) { setErr(i.id, 'Revisá el correo.'); missing = true; }
        else if ((i.field_type === 'number' || i.field_type === 'currency' || i.field_type === 'percent') && typeof values[i.key] === 'number' && isNaN(values[i.key])) { setErr(i.id, 'Escribí un número.'); missing = true; }
        else if (i.field_type === 'file' && (uploads[i.key] || []).some(function (u) { return u.pending; })) { setErr(i.id, 'Esperá a que termine de subir.'); missing = true; }
      });
      if (missing) { focusFirstError(); return; }
      var outValues = {}, outUploads = {};
      meta.items.forEach(function (i) {
        if (i.type !== 'field') return;
        if (i.field_type === 'file') { outUploads[i.key] = (uploads[i.key] || []).filter(function (u) { return u.token; }).map(function (u) { return u.token; }); return; }
        if (values[i.key] !== undefined) outValues[i.key] = values[i.key];
      });
      btn.disabled = true; btn.textContent = 'Enviando…';
      fetch(API + '/submit', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: outValues, uploads: outUploads, stamp: meta.stamp, hp: hp.querySelector('input').value })
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }, function () { return { ok: r.ok, b: {} }; }); })
        .then(function (res) {
          if (res.ok) {
            if (res.b.redirect_url) { location.href = res.b.redirect_url; return; }
            done(); return;
          }
          var errs = res.b && res.b.data && res.b.data.errors;
          if (errs) { Object.keys(errs).forEach(function (id) { setErr(id, errs[id]); }); focusFirstError(); }
          alertBox.textContent = (res.b && res.b.message) || 'No se pudo enviar. Probá de nuevo.';
          alertBox.hidden = false;
          btn.disabled = false; btn.textContent = meta.submit_label || 'Enviar';
        })
        .catch(function () {
          alertBox.textContent = 'No hay conexión. Revisá tu internet y probá de nuevo.';
          alertBox.hidden = false;
          btn.disabled = false; btn.textContent = meta.submit_label || 'Enviar';
        });
    });
  }
  function focusFirstError() {
    var first = root.querySelector('.item.invalid');
    if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); var f = first.querySelector('input,select,textarea,button'); if (f) f.focus({ preventScroll: true }); }
  }
  function done() {
    root.textContent = '';
    var box = el('div', { cls: 'done' }, [
      el('div', { cls: 'tick', text: '\u2713', 'aria-hidden': 'true' }),
      el('h2', { text: meta.success_title || '¡Gracias!' }),
      el('p', { text: meta.success_message || '' })
    ]);
    if (meta.allow_another) {
      var again = el('button', { type: 'button', cls: 'btn ghost', text: 'Enviar otra respuesta' });
      again.addEventListener('click', function () { location.reload(); });
      box.appendChild(again);
    }
    root.appendChild(box);
    try { parent.postMessage({ type: 'imb-form-submitted' }, '*'); } catch (e) {}
  }

  if (BOOT.preview) {
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'imb-form-preview') return;
      var keep = window.scrollY;
      meta = e.data.meta; selectedId = e.data.selected || null;
      values = {}; uploads = {};
      render();
      window.scrollTo(0, keep);
    });
    parent.postMessage({ type: 'imb-form-ready' }, location.origin);
  }
  render();
})();
`;
