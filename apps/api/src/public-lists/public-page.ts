/**
 * Página HTML autocontenida para la lista pública embebible. Se sirve en
 * `GET /api/v1/public/l/:token` y está pensada para meterse en un `<iframe>`
 * en cualquier sitio (con restricción por dominio vía CSP `frame-ancestors`,
 * que setea el controller). No depende del bundle del front: trae su propio
 * CSS + un cliente mínimo que consume los endpoints JSON públicos y renderiza
 * la tabla con búsqueda, orden por columna y paginación.
 */

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Construye la directiva CSP `frame-ancestors` desde los dominios permitidos. */
export function frameAncestors(domains: string[]): string {
    const sources = domains
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
            if (d.includes('://')) {
                try {
                    return new URL(d).origin;
                } catch {
                    return null;
                }
            }
            return d; // host-source: `example.com` o `*.example.com`
        })
        .filter((s): s is string => !!s);
    // Sin dominios → cualquiera puede embeber. Con dominios → solo esos + self.
    return sources.length === 0 ? 'frame-ancestors *' : `frame-ancestors 'self' ${sources.join(' ')}`;
}

/**
 * CSP completa de la página: el script inline sólo corre con su nonce (antes
 * la página no declaraba `script-src` y cualquier script inyectado corría).
 */
export function publicListPageCsp(nonce: string, domains: string[]): string {
    return [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        frameAncestors(domains),
    ].join('; ');
}

/**
 * La página cuando el enlace no existe, se despublicó o venció: HTML amable
 * (antes, dentro del marco de un sitio ajeno se veía el JSON crudo del 404).
 * No dice CUÁL de los tres pasó: a quien prueba direcciones no se le confirma
 * nada.
 */
export function publicListUnavailablePage(): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Lista no disponible</title>
<style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;color:#1d2330;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#667085;margin:0}@media (prefers-color-scheme: dark){body{background:#0f1420;color:#e6e9ef}p{color:#9aa3b2}}</style></head>
<body><div><h1>Esta lista no está disponible</h1><p>Puede que la dirección esté mal escrita, que ya no se publique o que el enlace haya vencido.</p></div></body></html>`;
}

/** HTML de la página pública. `name` se inyecta server-side; el resto lo pide el JS. */
export function renderPublicListPage(token: string, name: string, nonce = ''): string {
    const safeName = escapeHtml(name);
    const bootstrap = JSON.stringify({ token, apiBase: '/api/v1/public' }).replace(/</g, '\\u003c');

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${safeName}</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2430; --muted: #6b7280; --border: #e5e7eb;
    --thead: #f9fafb; --row-hover: #f3f4f6; --accent: #2563eb; --radius: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1420; --fg: #e6e9ef; --muted: #9aa3b2; --border: #232a3a;
      --thead: #161c2b; --row-hover: #1a2233; --accent: #5b8cff;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 16px;
  }
  .plw-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .plw-title { font-size: 18px; font-weight: 650; margin: 0; }
  .plw-desc { color: var(--muted); font-size: 13px; margin: 2px 0 0; }
  .plw-search {
    border: 1px solid var(--border); background: var(--bg); color: var(--fg);
    border-radius: 8px; padding: 8px 12px; font-size: 14px; min-width: 200px;
  }
  /* iOS agranda la página al tocar un campo de menos de 16px. */
  @media (max-width: 768px) { .plw-search { font-size: 16px; min-width: 0; width: 100%; } }
  .plw-chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; margin: 1px 4px 1px 0;
    background: var(--row-hover); color: var(--fg); white-space: nowrap; }
  .plw-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .plw-long { white-space: pre-wrap; max-width: 420px; }
  .plw-search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .plw-tablewrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
  table { border-collapse: collapse; width: 100%; }
  thead th {
    background: var(--thead); text-align: left; font-weight: 600; font-size: 12px;
    text-transform: uppercase; letter-spacing: .03em; color: var(--muted);
    padding: 10px 14px; border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  thead th.sortable { cursor: pointer; user-select: none; }
  thead th.sortable:hover { color: var(--fg); }
  thead th .arrow { opacity: .6; font-size: 10px; margin-left: 4px; }
  tbody td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--row-hover); }
  .plw-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
  .plw-btn {
    border: 1px solid var(--border); background: var(--bg); color: var(--fg);
    border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer;
  }
  .plw-btn:disabled { opacity: .45; cursor: default; }
  .plw-btn:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
  .plw-state { color: var(--muted); padding: 28px 8px; text-align: center; }
  .plw-empty { color: var(--muted); padding: 28px 8px; text-align: center; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <div class="plw-head">
    <div style="display:flex;align-items:center;gap:10px">
      <img id="plw-logo" alt="" hidden style="width:32px;height:32px;border-radius:6px;object-fit:contain" />
      <div>
        <h1 class="plw-title" id="plw-title">${safeName}</h1>
        <p class="plw-desc" id="plw-desc" hidden></p>
      </div>
    </div>
    <input type="search" class="plw-search" id="plw-search" placeholder="Buscar…" hidden />
  </div>
  <div class="plw-tablewrap">
    <table>
      <thead><tr id="plw-thead"></tr></thead>
      <tbody id="plw-tbody"><tr><td class="plw-state">Cargando…</td></tr></tbody>
    </table>
  </div>
  <div class="plw-foot">
    <button class="plw-btn" id="plw-prev" disabled>← Anterior</button>
    <span class="plw-state" id="plw-page" style="padding:0"></span>
    <button class="plw-btn" id="plw-next" disabled>Siguiente →</button>
  </div>

<script nonce="${escapeHtml(nonce)}">
(function () {
  var BOOT = ${bootstrap};
  var base = BOOT.apiBase + '/lists/' + encodeURIComponent(BOOT.token);
  var meta = null;
  var sort = null;            // "slug:asc" | "slug:desc" | null
  var search = '';
  var cursorStack = [];       // pila de cursores para "Anterior"
  var cursor = null;          // offset actual (null = primera página)
  var nextCursor = null;

  var els = {
    title: document.getElementById('plw-title'),
    logo: document.getElementById('plw-logo'),
    desc: document.getElementById('plw-desc'),
    search: document.getElementById('plw-search'),
    thead: document.getElementById('plw-thead'),
    tbody: document.getElementById('plw-tbody'),
    prev: document.getElementById('plw-prev'),
    next: document.getElementById('plw-next'),
    page: document.getElementById('plw-page'),
  };

  function esc(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Formato: el MISMO que la app (separadores, fechas y horas de la empresa).
  var FMT = { number_format: 'comma_dot', date_format: 'ymd', time_format: 'h24', timezone: null };
  function fmtNumber(n, minFrac, maxFrac) {
    var base = new Intl.NumberFormat('en-US', { minimumFractionDigits: minFrac, maximumFractionDigits: Math.max(minFrac, maxFrac) }).format(n);
    if (FMT.number_format === 'dot_comma') return base.replace(/[.,]/g, function (c) { return c === ',' ? '.' : ','; });
    if (FMT.number_format === 'space_comma') return base.replace(/[.,]/g, function (c) { return c === ',' ? '\u00a0' : ','; });
    return base;
  }
  function fmtYmd(y, m, d) {
    if (FMT.date_format === 'dmy') return d + '/' + m + '/' + y;
    if (FMT.date_format === 'mdy') return m + '/' + d + '/' + y;
    return y + '-' + m + '-' + d;
  }
  function fmtDate(v) {
    var m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(v));
    return m ? fmtYmd(m[1], m[2], m[3]) : String(v);
  }
  function fmtDateTime(v) {
    var d = new Date(String(v));
    if (isNaN(d.getTime())) return String(v);
    var opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    if (FMT.timezone) opts.timeZone = FMT.timezone;
    var parts = {};
    try { new Intl.DateTimeFormat('en-US', opts).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; }); }
    catch (e) { return d.toISOString(); }
    var h = Number(parts.hour) % 24, mm = parts.minute;
    var clock = FMT.time_format === 'h12' ? ((h % 12 === 0 ? 12 : h % 12) + ':' + mm + (h < 12 ? ' a. m.' : ' p. m.')) : (String(h).padStart(2, '0') + ':' + mm);
    return fmtYmd(parts.year, parts.month, parts.day) + ' ' + clock;
  }
  function fmtDuration(min) {
    var n = Math.round(Number(min));
    if (!isFinite(n)) return String(min);
    var h = Math.floor(Math.abs(n) / 60), m = Math.abs(n) % 60;
    return (n < 0 ? '-' : '') + (h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm');
  }
  function optionOf(f, v) {
    var opts = f.options || [];
    for (var i = 0; i < opts.length; i++) if (opts[i].value === v) return opts[i];
    return { value: v, label: String(v), color: null };
  }
  function chip(o) {
    var s = document.createElement('span');
    s.className = 'plw-chip';
    s.textContent = o.label;
    if (o.color && /^#[0-9a-fA-F]{6}$/.test(o.color)) {
      s.style.background = o.color;
      var r = parseInt(o.color.slice(1, 3), 16), g = parseInt(o.color.slice(3, 5), 16), b = parseInt(o.color.slice(5, 7), 16);
      s.style.color = (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1f2430' : '#ffffff';
    }
    return s;
  }
  function link(href, text) {
    var a = document.createElement('a');
    a.href = href; a.textContent = text; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  /** La celda de un valor, armada con nodos (nunca HTML del dato). */
  function cell(f, v) {
    var td = document.createElement('td');
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) { td.textContent = '—'; return td; }
    switch (f.type) {
      case 'select': td.appendChild(chip(optionOf(f, v))); break;
      case 'multi_select': (Array.isArray(v) ? v : [v]).forEach(function (x) { td.appendChild(chip(optionOf(f, x))); }); break;
      case 'checkbox': td.textContent = v === true || v === 'true' ? 'Sí' : 'No'; break;
      case 'number': td.className = 'plw-num'; td.textContent = typeof v === 'number' ? fmtNumber(v, 0, typeof f.precision === 'number' ? f.precision : 0) : String(v); break;
      case 'currency': { td.className = 'plw-num'; var p = typeof f.precision === 'number' ? f.precision : 2; td.textContent = typeof v === 'number' ? fmtNumber(v, p, p) : String(v); break; }
      case 'percent': td.className = 'plw-num'; td.textContent = typeof v === 'number' ? fmtNumber(v, 0, 2) + ' %' : String(v); break;
      case 'rating': td.textContent = typeof v === 'number' ? v + ' de ' + (f.max || 5) : String(v); break;
      case 'duration': td.textContent = fmtDuration(v); break;
      case 'date': td.textContent = fmtDate(v); break;
      case 'datetime': td.textContent = fmtDateTime(v); break;
      case 'url': if (/^https?:\\/\\//i.test(String(v))) td.appendChild(link(String(v), String(v))); else td.textContent = String(v); break;
      case 'email': td.appendChild(link('mailto:' + String(v), String(v))); break;
      case 'file':
        (Array.isArray(v) ? v : []).forEach(function (fi, i) {
          if (!fi || typeof fi !== 'object' || typeof fi.url !== 'string' || fi.url.indexOf('/api/v1/files/') !== 0) return;
          if (i > 0) td.appendChild(document.createTextNode(', '));
          td.appendChild(link(fi.url, String(fi.name || 'archivo')));
        });
        break;
      case 'long_text': td.className = 'plw-long'; td.textContent = String(v); break;
      default:
        if (Array.isArray(v)) td.textContent = v.join(', ');
        else if (typeof v === 'object') td.textContent = '';
        else td.textContent = String(v);
    }
    return td;
  }

  function renderHead() {
    var html = '';
    meta.fields.forEach(function (f) {
      var canSort = meta.sort_allowed.indexOf(f.slug) !== -1;
      var arrow = '';
      if (sort) {
        var parts = sort.split(':');
        if (parts[0] === f.slug) arrow = parts[1] === 'desc' ? '▼' : '▲';
      }
      html += '<th class="' + (canSort ? 'sortable' : '') + '" data-slug="' + esc(f.slug) + '">' +
        esc(f.label) + (arrow ? '<span class="arrow">' + arrow + '</span>' : '') + '</th>';
    });
    els.thead.innerHTML = html;
    if (meta.sort_allowed.length) {
      Array.prototype.forEach.call(els.thead.querySelectorAll('th.sortable'), function (th) {
        th.addEventListener('click', function () {
          var slug = th.getAttribute('data-slug');
          var dir = 'asc';
          if (sort && sort.split(':')[0] === slug && sort.split(':')[1] === 'asc') dir = 'desc';
          sort = slug + ':' + dir;
          cursorStack = []; cursor = null;
          load();
        });
      });
    }
  }

  function renderRows(rows) {
    if (!rows.length) {
      els.tbody.innerHTML = '<tr><td class="plw-empty" colspan="' + meta.fields.length + '">Sin resultados</td></tr>';
      return;
    }
    els.tbody.textContent = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      meta.fields.forEach(function (f) { tr.appendChild(cell(f, r.data[f.slug])); });
      els.tbody.appendChild(tr);
    });
  }

  function load() {
    els.tbody.innerHTML = '<tr><td class="plw-state" colspan="' + (meta ? meta.fields.length : 1) + '">Cargando…</td></tr>';
    var qs = [];
    if (cursor) qs.push('cursor=' + encodeURIComponent(cursor));
    if (search) qs.push('search=' + encodeURIComponent(search));
    if (sort) qs.push('sort=' + encodeURIComponent(sort));
    fetch(base + '/records' + (qs.length ? '?' + qs.join('&') : ''), { credentials: 'omit' })
      .then(function (res) { if (!res.ok) throw new Error('http'); return res.json(); })
      .then(function (page) {
        renderRows(page.data);
        nextCursor = page.meta && page.meta.next_cursor;
        els.prev.disabled = cursorStack.length === 0;
        els.next.disabled = !nextCursor;
      })
      .catch(function () {
        els.tbody.innerHTML = '<tr><td class="plw-state" colspan="' + (meta ? meta.fields.length : 1) + '">No se pudo cargar.</td></tr>';
      });
  }

  els.prev.addEventListener('click', function () {
    if (!cursorStack.length) return;
    cursor = cursorStack.pop();
    load();
  });
  els.next.addEventListener('click', function () {
    if (!nextCursor) return;
    cursorStack.push(cursor);
    cursor = nextCursor;
    load();
  });

  var searchTimer = null;
  els.search.addEventListener('input', function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      search = els.search.value.trim();
      cursorStack = []; cursor = null;
      load();
    }, 300);
  });

  fetch(base + '/meta', { credentials: 'omit' })
    .then(function (res) { if (!res.ok) throw new Error('http'); return res.json(); })
    .then(function (m) {
      meta = m;
      if (m.format) {
        FMT.number_format = m.format.number_format || FMT.number_format;
        FMT.date_format = m.format.date_format || FMT.date_format;
        FMT.time_format = m.format.time_format || FMT.time_format;
        FMT.timezone = m.format.timezone || null;
      }
      els.title.textContent = m.name || els.title.textContent;
      if (m.description) { els.desc.textContent = m.description; els.desc.hidden = false; }
      // White-label del workspace dueño: acento + logo (URL firmada).
      if (m.branding) {
        if (m.branding.primary_color && /^#[0-9a-fA-F]{6}$/.test(m.branding.primary_color)) {
          document.documentElement.style.setProperty('--accent', m.branding.primary_color);
        }
        if (m.branding.logo_url) { els.logo.src = m.branding.logo_url; els.logo.hidden = false; }
      }
      if (m.search_enabled) els.search.hidden = false;
      if (m.default_sort) sort = m.default_sort;
      renderHead();
      load();
    })
    .catch(function () {
      els.tbody.innerHTML = '<tr><td class="plw-state">No se pudo cargar la lista.</td></tr>';
    });
})();
</script>
</body>
</html>`;
}
