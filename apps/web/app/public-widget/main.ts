/**
 * v0.1.394 (ADR-S99) — El widget de contacto, dentro de su marco.
 *
 * El sitio de la empresa carga `embed.js` con `data-imagina-widget`, que pone
 * UN marco en la esquina con esta página. Aquí viven el botón redondo, el menú
 * de botones, el panel tipo chat y —en un marco anidado— el formulario o la
 * agenda. Este script le dice a `embed.js` qué tamaño necesita el marco (y,
 * abierto en el celular, que ocupe la pantalla) y hace de puente entre el
 * formulario de adentro y el sitio (de dónde vino la persona, la conversión
 * de Google Ads y Meta, la página de gracias).
 *
 * «WhatsApp con datos primero»: el formulario de adentro sabe de qué widget y
 * de qué botón viene (se lo dice este script) y, al enviarlo, el servidor
 * devuelve el enlace de WhatsApp con el mensaje armado.
 *
 * v0.1.395 — Horario de atención: la página decide con SU reloj si ahora
 * está abierto (el horario y los festivos llegan resueltos del servidor, así
 * la caché no se invalida cada minuto). Los botones «sólo en horario» o
 * «sólo fuera de horario» se muestran u ocultan solos cuando llega la hora.
 *
 * v0.1.396 — «Dónde aparece» (páginas, dispositivo, demora, scroll) y el
 * saludo que se adelanta los decide esta página con lo que cuenta `embed.js`
 * del sitio; mientras no le toca aparecer, el marco mide cero. Y cuenta lo
 * que pasa (apareció, lo abrieron, tocaron un botón, dejaron sus datos) para
 * las estadísticas: contadores, nunca datos de la persona.
 *
 * Todo se arma con `createElement`/`textContent`: ningún texto de la empresa
 * llega como HTML. Se compila a un archivo que el servidor sirve EN LÍNEA
 * (con su CSP por hash); de shared sólo importa la lógica pura del horario.
 */
import type { PublicWidgetButton, PublicWidgetMeta, WidgetIcon } from '@imagina-base/shared';
import { widgetButtonShown, widgetClosesAt, widgetIsOpen, widgetNextOpening, widgetNextOpeningText } from '@imagina-base/shared/src/schemas/widget-hours';
import { widgetGreetingFor, widgetRevealState, type WidgetHostView, type WidgetStatEvent } from '@imagina-base/shared/src/schemas/widget-display';

interface Boot {
    preview: boolean;
    meta: PublicWidgetMeta | null;
}
interface HostInfo {
    url: string;
    title: string;
    width: number;
    height: number;
    /** v0.1.396 — milisegundos en la página del sitio y cuánto bajó (%). */
    since?: number;
    scroll?: number;
}

const bootEl = document.getElementById('boot');
const BOOT: Boot = bootEl ? (JSON.parse(bootEl.textContent || '{}') as Boot) : { preview: false, meta: null };
const PREVIEW = BOOT.preview;
let meta: PublicWidgetMeta | null = BOOT.meta;

/** Margen dentro del marco para que la sombra no se corte. */
/** El aire alrededor del widget dentro del marco: deja ver su sombra entera. */
const PAD = 28;
const MOBILE_MAX = 640;
const LAUNCHER = 58;

let embedded = false;
try {
    embedded = window.self !== window.top;
} catch {
    embedded = true;
}

let host: HostInfo | null = null;
let hostAttribution: Record<string, string> | null = null;
let hostOrigin: string | null = null;
let contextReady = false;
/** v0.1.396 — ¿Ya le toca aparecer en esta página? (en la vista previa o abierta sola, siempre). */
let revealed = PREVIEW || !embedded;
let watchScroll = false;
let revealTimer = 0;
/** Cuándo llegó el último `host` (para sumar lo que pasó desde entonces). */
let hostAt = 0;
const bootAt = performance.now();

let open = false;
/** El botón cuyo formulario/agenda está abierto en el panel (null = el inicio). */
let current: PublicWidgetButton | null = null;
/**
 * v0.1.395 — ¿Abierto ahora? (null = sin horario). En la vista previa del
 * editor se puede forzar para ver cómo queda en horario y fuera de horario.
 */
let forcedOpen: boolean | null = null;
let openNow: boolean | null = null;

function computeOpen(): boolean | null {
    if (!meta?.hours) return null;
    if (PREVIEW && forcedOpen !== null) return forcedOpen;
    return widgetIsOpen(meta.hours, new Date());
}

/** Los botones que se ven ahora (según el horario). */
function shownButtons(): PublicWidgetButton[] {
    return meta ? meta.buttons.filter((b) => widgetButtonShown(b.when, openNow)) : [];
}

// ─────────────────────────── Íconos ───────────────────────────

const ICON_PATHS: Record<WidgetIcon | 'close' | 'back' | 'go', string[]> = {
    whatsapp: [],
    chat: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    form: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
    calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 10h18'],
    phone: [
        'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
    ],
    mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'],
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    help: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
    cart: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
    info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
    star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
    pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    close: ['M18 6 6 18', 'M6 6l12 12'],
    back: ['M15 18l-6-6 6-6'],
    go: ['M9 18l6-6-6-6'],
};
/** El logo de WhatsApp (Simple Icons, CC0), relleno. */
const WHATSAPP_PATH =
    'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(name: WidgetIcon | 'close' | 'back' | 'go'): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (name === 'whatsapp') {
        svg.setAttribute('fill', 'currentColor');
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', WHATSAPP_PATH);
        svg.appendChild(p);
        return svg;
    }
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of ICON_PATHS[name] ?? ICON_PATHS.chat) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
    }
    return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function inkOf(color: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(color);
    if (!m) return '#ffffff';
    const n = parseInt(m[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111827' : '#ffffff';
}

// ─────────────────────────── Estado del sitio ───────────────────────────

function isMobile(): boolean {
    // Insertado, el ancho que cuenta es el del SITIO (el marco mide lo que el widget pide).
    const w = host?.width ?? (embedded && !PREVIEW ? MOBILE_MAX : window.innerWidth);
    return w < MOBILE_MAX;
}

function showsBar(): boolean {
    return !!meta && meta.mobile_bar && isMobile() && shownButtons().length > 0;
}

/** El panel ocupa la pantalla: celular, abierto, y no es el menú de botones. */
function fullScreen(): boolean {
    if (!open || !meta) return false;
    if (!isMobile()) return false;
    return meta.layout === 'card' || current !== null || showsBar();
}

function panelHeight(): number {
    const h = host?.height ?? window.innerHeight;
    const oy = meta?.offset_y ?? 20;
    return Math.max(340, Math.min(640, h - oy - LAUNCHER - 14 - 2 * PAD - 8));
}

/** Adónde lleva un botón con enlace (WhatsApp directo: con la página de donde viene). */
function hrefOf(b: PublicWidgetButton): string {
    if (!b.href) return '#';
    if (b.type === 'whatsapp' && b.href.startsWith('/api/v1/public/w/') && host) {
        const q = new URLSearchParams();
        if (host.url) q.set('u', host.url);
        if (host.title) q.set('t', host.title);
        const qs = q.toString();
        return qs ? `${b.href}?${qs}` : b.href;
    }
    return b.href;
}

// ─────────────────────────── DOM ───────────────────────────

const app = document.getElementById('app')!;
let root: HTMLElement | null = null;
let launcher: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let home: HTMLElement | null = null;
let viewBox: HTMLElement | null = null;
let viewTitle: HTMLElement | null = null;
let viewBack: HTMLButtonElement | null = null;
let frameWrap: HTMLElement | null = null;
let menu: HTMLUListElement | null = null;
let bar: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let closedEl: HTMLElement | null = null;
/** Lo que se pintó de la barra (se rearma sólo si cambian los botones a la vista). */
let barKey = '';
/** Un marco por botón, armado UNA vez: moverlo o recrearlo lo recargaría (y se perdería lo escrito). */
const frames = new Map<string, HTMLIFrameElement>();

function linkAttrs(a: HTMLAnchorElement, b: PublicWidgetButton): void {
    a.href = hrefOf(b);
    if (b.target) a.target = b.target;
    if (b.target === '_blank') a.rel = 'noopener';
    a.setAttribute('data-href-for', b.id);
}

/** Lo que hace un botón al tocarlo: un enlace se sigue solo; un formulario o la agenda se abren en el panel. */
function onPick(b: PublicWidgetButton, ev: Event): void {
    stat({ kind: 'click', button: b.id });
    if (b.frame) {
        ev.preventDefault();
        openView(b);
        return;
    }
    if (PREVIEW) {
        ev.preventDefault();
        previewNote(
            b.type === 'whatsapp'
                ? 'En tu sitio, esto abre WhatsApp con tu número y el mensaje ya escrito.'
                : b.type === 'call'
                  ? 'En tu sitio, esto llama a tu número.'
                  : b.type === 'email'
                    ? 'En tu sitio, esto abre el correo de la persona con tu dirección.'
                    : b.type === 'form'
                      ? 'Elige un formulario publicado para verlo aquí.'
                      : b.type === 'booking'
                        ? 'Elige una agenda publicada para verla aquí.'
                        : 'En tu sitio, esto abre el enlace.',
        );
    }
}

function optionNode(b: PublicWidgetButton): HTMLElement {
    const node = b.frame ? el('button', 'w-opt') : el('a', 'w-opt');
    if (node instanceof HTMLButtonElement) node.type = 'button';
    else linkAttrs(node as HTMLAnchorElement, b);
    node.style.setProperty('--b-color', b.color);
    node.style.setProperty('--b-ink', inkOf(b.color));
    node.setAttribute('data-testid', `widget-option-${b.id}`);
    node.setAttribute('data-btn', b.id);
    const ic = el('span', 'w-opt-ic');
    ic.appendChild(icon(b.icon));
    const txt = el('span', 'w-opt-txt');
    txt.appendChild(el('span', 'w-opt-label', b.label));
    if (b.description) txt.appendChild(el('span', 'w-opt-desc', b.description));
    const go = el('span', 'w-opt-go');
    go.appendChild(icon('go'));
    node.append(ic, txt, go);
    node.addEventListener('click', (e) => onPick(b, e));
    return node;
}

function menuItem(b: PublicWidgetButton): HTMLLIElement {
    const li = el('li', 'w-mi');
    li.setAttribute('data-btn', b.id);
    li.appendChild(el('span', 'w-mi-label', b.label));
    const btn = b.frame ? el('button', 'w-mi-btn') : el('a', 'w-mi-btn');
    if (btn instanceof HTMLButtonElement) btn.type = 'button';
    else linkAttrs(btn as HTMLAnchorElement, b);
    btn.setAttribute('aria-label', b.label);
    btn.style.setProperty('--b-color', b.color);
    btn.style.setProperty('--b-ink', inkOf(b.color));
    btn.setAttribute('data-testid', `widget-menu-${b.id}`);
    btn.appendChild(icon(b.icon));
    btn.addEventListener('click', (e) => onPick(b, e));
    li.appendChild(btn);
    return li;
}

function closeButton(label: string): HTMLButtonElement {
    const x = el('button', 'w-x');
    x.type = 'button';
    x.setAttribute('aria-label', label);
    x.appendChild(icon('close'));
    x.addEventListener('click', () => setOpen(false));
    return x;
}

function build(): void {
    app.textContent = '';
    frames.clear();
    current = null;
    if (!meta) return;
    document.documentElement.style.setProperty('--w-accent', meta.accent);
    document.documentElement.style.setProperty('--w-ink', meta.ink);

    root = el('div', `w-root${meta.position === 'left' ? ' w-left' : ''}`);
    root.setAttribute('data-testid', 'widget-root');
    if (PREVIEW || !embedded) {
        // Sin `embed.js` (la vista previa o la página abierta sola), el borde lo pone el widget.
        root.style.bottom = `${meta.offset_y}px`;
        root.style[meta.position === 'left' ? 'left' : 'right'] = `${meta.offset_x}px`;
    } else {
        // Insertado, el marco se corre `offset − PAD` del borde (nunca menos de 0): lo que
        // falta para llegar a la separación elegida lo pone el widget adentro del marco.
        root.style.bottom = `${edgeInset(meta.offset_y)}px`;
        root.style[meta.position === 'left' ? 'left' : 'right'] = `${edgeInset(meta.offset_x)}px`;
    }

    // Panel: el inicio (saludo + botones) y la vista de un formulario/agenda.
    panel = el('div', 'w-panel w-hidden');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', meta.title || 'Contacto');
    panel.setAttribute('data-testid', 'widget-panel');

    home = el('div');
    home.style.display = 'contents';
    const head = el('div', 'w-head');
    if (meta.logo_url || meta.company) {
        const brand = el('div', 'w-brand');
        if (meta.logo_url) {
            const img = el('img', 'w-logo');
            img.src = meta.logo_url;
            img.alt = meta.company;
            brand.appendChild(img);
        }
        if (meta.company && !meta.logo_url) brand.appendChild(el('span', 'w-company', meta.company));
        head.appendChild(brand);
    }
    head.appendChild(el('h2', 'w-title', meta.title));
    if (meta.subtitle) head.appendChild(el('p', 'w-sub', meta.subtitle));
    // v0.1.395 — «● En línea» / «Fuera de horario».
    statusEl = null;
    closedEl = null;
    if (meta.hours?.show_status) {
        statusEl = el('div', 'w-status');
        statusEl.setAttribute('data-testid', 'widget-status');
        statusEl.setAttribute('role', 'status');
        head.appendChild(statusEl);
    }
    head.appendChild(closeButton('Cerrar'));
    const body = el('div', 'w-body');
    if (meta.hours) {
        closedEl = el('div', 'w-closed');
        closedEl.setAttribute('data-testid', 'widget-closed');
        body.appendChild(closedEl);
    }
    const opts = el('div', 'w-opts');
    for (const b of meta.buttons) opts.appendChild(optionNode(b));
    body.appendChild(opts);
    home.append(head, body);

    viewBox = el('div');
    viewBox.style.cssText = 'display:none;flex-direction:column;height:100%;min-height:0';
    const vh = el('div', 'w-view-head');
    viewBack = el('button', 'w-x');
    viewBack.type = 'button';
    viewBack.setAttribute('aria-label', 'Volver');
    viewBack.setAttribute('data-testid', 'widget-back');
    viewBack.appendChild(icon('back'));
    viewBack.addEventListener('click', () => showHome());
    viewTitle = el('div', 'w-view-title');
    vh.append(viewBack, viewTitle, closeButton('Cerrar'));
    frameWrap = el('div', 'w-frame-wrap');
    viewBox.append(vh, frameWrap);

    panel.append(home, viewBox);

    // Menú de botones apilados (layout `menu`).
    menu = el('ul', 'w-menu w-hidden');
    menu.setAttribute('data-testid', 'widget-menu');
    for (const b of meta.buttons) menu.appendChild(menuItem(b));

    launcher = el('button', 'w-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', meta.launcher_label || 'Contáctanos');
    launcher.setAttribute('data-testid', 'widget-launcher');
    const li = icon(meta.launcher_icon);
    li.classList.add('w-l-icon');
    const lc = icon('close');
    lc.classList.add('w-l-close');
    launcher.append(li, lc);
    if (meta.launcher_label) launcher.appendChild(el('span', 'w-l-text', meta.launcher_label));
    else launcher.classList.add('w-icon-only');
    launcher.addEventListener('click', onLauncher);

    // v0.1.396 — el saludo que se adelanta, junto al botón.
    greetEl = el('div', 'w-greet');
    greetEl.hidden = true;
    greetEl.setAttribute('data-testid', 'widget-greeting');
    greetMsg = el('button', 'w-greet-msg');
    greetMsg.type = 'button';
    greetMsg.setAttribute('data-testid', 'widget-greeting-msg');
    greetMsg.addEventListener('click', onGreetClick);
    const gx = el('button', 'w-greet-x');
    gx.type = 'button';
    gx.setAttribute('aria-label', 'Cerrar el mensaje');
    gx.setAttribute('data-testid', 'widget-greeting-close');
    gx.appendChild(icon('close'));
    gx.addEventListener('click', () => {
        dismissGreeting();
        paint();
    });
    greetEl.append(greetMsg, gx);

    root.append(panel, menu, greetEl, launcher);
    app.appendChild(root);

    // Barra fija del celular (sus botones se arman en `paintBar`, según el horario).
    bar = el('nav', 'w-bar w-hidden');
    bar.setAttribute('aria-label', 'Contacto');
    bar.setAttribute('data-testid', 'widget-bar');
    barKey = '';
    app.appendChild(bar);
    openNow = computeOpen();
    paint();
    scheduleHoursTick();
}

function paintBar(): void {
    if (!bar || !meta) return;
    const visible = shownButtons();
    const key = visible.map((b) => b.id).join(',');
    if (key === barKey) return;
    barKey = key;
    bar.textContent = '';
    const many = visible.length > 3;
    const shown = many ? visible.slice(0, 2) : visible;
    for (const b of shown) {
        const n = b.frame ? el('button') : el('a');
        if (n instanceof HTMLButtonElement) n.type = 'button';
        else linkAttrs(n as HTMLAnchorElement, b);
        n.setAttribute('data-testid', `widget-bar-${b.id}`);
        const ic = el('span', 'w-bar-ic');
        ic.style.setProperty('--b-color', b.color);
        ic.appendChild(icon(b.icon));
        n.append(ic, el('span', '', b.label));
        n.addEventListener('click', (e) => onPick(b, e));
        bar.appendChild(n);
    }
    if (many) {
        const more = el('button');
        more.type = 'button';
        more.setAttribute('data-testid', 'widget-bar-more');
        const ic = el('span', 'w-bar-ic');
        ic.style.setProperty('--b-color', meta.accent);
        ic.appendChild(icon(meta.launcher_icon));
        more.append(ic, el('span', '', 'Más'));
        more.addEventListener('click', () => setOpen(true));
        bar.appendChild(more);
    }
}

/** v0.1.395 — El estado del horario en el panel: «● En línea» o «Fuera de horario» y cuándo abre. */
function paintHours(): void {
    if (!meta) return;
    const h = meta.hours;
    if (statusEl && h) {
        statusEl.textContent = '';
        const dot = el('span', `w-dot${openNow ? ' w-on' : ''}`);
        statusEl.append(dot, document.createTextNode(openNow ? h.online_label : 'Fuera de horario'));
    }
    if (closedEl && h) {
        closedEl.hidden = openNow !== false;
        closedEl.textContent = '';
        if (openNow === false) {
            if (h.closed_message) closedEl.appendChild(el('p', '', h.closed_message));
            const when = PREVIEW && forcedOpen === false ? null : widgetNextOpeningText(h, new Date(), viewerTz());
            if (when) closedEl.appendChild(el('p', 'w-closed-when', `${when}.`));
        }
    }
}

/** La zona de quien mira (el navegador): lee la hora de apertura en su reloj. */
function viewerTz(): string {
    const fallback = meta?.hours?.tz ?? 'UTC';
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
    } catch {
        return fallback;
    }
}

// ─────────────────────── Dónde aparece y saludo (v0.1.396) ───────────────────────

/** Lo que se sabe del sitio, con el tiempo en la página al día. */
function hostView(): WidgetHostView {
    const base = typeof host?.since === 'number' ? host.since : 0;
    const since = base + (performance.now() - (host ? hostAt : bootAt));
    return { url: host?.url ?? null, width: host?.width ?? window.innerWidth, since, scroll: host?.scroll };
}

/** ¿Ya puede aparecer? Si no, espera la demora o avisa que hace falta saber cuánto baja la persona. */
function checkReveal(): void {
    window.clearTimeout(revealTimer);
    if (revealed || !meta || !contextReady) return;
    const st = widgetRevealState(meta.display, hostView());
    watchScroll = st.needsScroll;
    if (st.shown) {
        revealed = true;
        watchScroll = false;
        stat({ kind: 'view', dev: isMobile() ? 'mobile' : 'desktop' });
        scheduleGreeting();
    } else if (st.wait !== null) {
        revealTimer = window.setTimeout(checkReveal, Math.min(st.wait + 50, 130_000));
    }
    paint();
}

let greetEl: HTMLElement | null = null;
let greetMsg: HTMLButtonElement | null = null;
let greetText: string | null = null;
let greetTimer = 0;

function greetKey(): string {
    return `imb-greet:${meta?.token ?? ''}`;
}
function greetDismissed(): boolean {
    try {
        return sessionStorage.getItem(greetKey()) === '1';
    } catch {
        return false;
    }
}
/** El saludo no vuelve en esta visita (lo cerró o ya abrió el widget). */
function dismissGreeting(): void {
    window.clearTimeout(greetTimer);
    try {
        sessionStorage.setItem(greetKey(), '1');
    } catch {
        // sin almacenamiento: se va hasta recargar
    }
    greetText = null;
}

function scheduleGreeting(): void {
    window.clearTimeout(greetTimer);
    if (!meta?.greeting || PREVIEW || greetDismissed()) return;
    const view = hostView();
    const text = widgetGreetingFor(meta.greeting, view.url, view.width);
    if (!text) return;
    const wait = Math.max(0, meta.greeting.delay_s * 1000 - (view.since ?? 0));
    greetTimer = window.setTimeout(() => {
        if (open || greetDismissed() || showsBar()) return;
        greetText = text;
        stat({ kind: 'greet' });
        paint();
    }, wait);
}

function onGreetClick(e: Event): void {
    stat({ kind: 'greet_click' });
    dismissGreeting();
    onLauncher(e);
}

// ─────────────────────────── Estadísticas (v0.1.396) ───────────────────────────

const statQueue: WidgetStatEvent[] = [];
let statTimer: number | null = null;
const leadSeen = new Set<string>();

function flushStats(beacon = false): void {
    if (statTimer !== null) {
        window.clearTimeout(statTimer);
        statTimer = null;
    }
    const url = `${location.pathname.replace(/\/+$/, '')}/events`;
    while (statQueue.length) {
        const body = JSON.stringify({ events: statQueue.splice(0, 12) });
        try {
            if (beacon && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) continue;
        } catch {
            // cae al fetch
        }
        void fetch(url, { method: 'POST', credentials: 'omit', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => undefined);
    }
}

/** Cuenta algo para las estadísticas (en la vista previa o abierta sola, no). */
function stat(e: WidgetStatEvent): void {
    if (PREVIEW || !embedded || !meta) return;
    statQueue.push(e);
    if (statQueue.length >= 12) flushStats();
    else if (statTimer === null) statTimer = window.setTimeout(() => flushStats(), 1500);
}

window.addEventListener('pagehide', () => flushStats(true));
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStats(true);
});

// ─────────────────────────── Abrir y cerrar ───────────────────────────

function onLauncher(e: Event): void {
    if (!meta) return;
    // Un solo botón: el botón redondo ES ese botón (no hay nada que elegir).
    // Fuera de horario se abre el panel aunque haya uno: dice cuándo abrimos.
    const visible = shownButtons();
    const only = visible.length === 1 && !(openNow === false && meta.layout === 'card') ? visible[0]! : null;
    if (!open && only && !only.frame) {
        if (PREVIEW) return onPick(only, e);
        stat({ kind: 'click', button: only.id });
        window.open(hrefOf(only), only.target === '_top' ? '_top' : '_blank', only.target === '_blank' ? 'noopener' : undefined);
        return;
    }
    if (!open && only && only.frame) {
        stat({ kind: 'click', button: only.id });
        openView(only);
        return;
    }
    setOpen(!open);
}

/**
 * Abre o cierra el panel. `moveFocus` lleva el foco adentro (al abrir) o al
 * botón redondo (al cerrar), para quien navega con el teclado. v0.1.398 — la
 * vista previa del editor abre el panel por mensaje mientras la persona escribe
 * en el editor: ahí NO se mueve el foco, o el campo que está escribiendo lo
 * perdería con cada tecla.
 */
function setOpen(next: boolean, moveFocus = true): void {
    if (next && !open) {
        stat({ kind: 'open' });
        if (greetText !== null || meta?.greeting) dismissGreeting();
    }
    open = next;
    if (!next) current = null;
    paint();
    if (!moveFocus) return;
    if (next) {
        const first = (current ? viewBack : panel?.querySelector<HTMLElement>('.w-opt')) ?? null;
        window.setTimeout(() => first?.focus(), 30);
    } else {
        window.setTimeout(() => (showsBar() ? null : launcher?.focus()), 30);
    }
}

function frameFor(b: PublicWidgetButton): HTMLIFrameElement {
    let f = frames.get(b.id);
    if (f) return f;
    f = document.createElement('iframe');
    f.className = 'w-frame';
    f.name = 'imagina-widget';
    f.title = b.label;
    f.setAttribute('allow', 'payment');
    f.setAttribute('data-testid', `widget-frame-${b.id}`);
    const src = b.frame!;
    f.src = PREVIEW ? `${src}${src.includes('?') ? '&' : '?'}imb_demo=1` : src;
    frames.set(b.id, f);
    frameWrap!.appendChild(f);
    return f;
}

function openView(b: PublicWidgetButton): void {
    if (!open) {
        stat({ kind: 'open' });
        if (greetText !== null || meta?.greeting) dismissGreeting();
    }
    current = b;
    open = true;
    frameFor(b);
    paint();
    window.setTimeout(() => viewBack?.focus(), 30);
}

/** ¿Hay un «inicio» al que volver? (no en el menú de botones ni con un solo botón). */
function hasHome(): boolean {
    if (!meta || meta.layout === 'menu') return false;
    return shownButtons().length > 1 || openNow === false;
}

function showHome(): void {
    // En el menú de botones (o con un solo botón) no hay «inicio»: volver cierra.
    if (!hasHome()) {
        setOpen(false);
        return;
    }
    current = null;
    paint();
}

// ─────────────────────────── Pintar y medir ───────────────────────────

function paint(): void {
    if (!meta || !root || !panel || !menu || !launcher || !bar || !home || !viewBox) return;
    const barMode = showsBar();
    const full = fullScreen();
    document.body.classList.toggle('w-full', full);
    root.classList.toggle('w-open', open);
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    launcher.setAttribute('aria-label', open ? 'Cerrar' : meta.launcher_label || 'Contáctanos');
    launcher.classList.toggle('w-hidden', barMode);
    bar.classList.toggle('w-hidden', !barMode || open);

    const showPanel = open && (meta.layout === 'card' || current !== null || barMode);
    panel.classList.toggle('w-hidden', !showPanel);
    menu.classList.toggle('w-hidden', !(open && !showPanel));
    if (!full) panel.style.setProperty('--w-ph', `${panelHeight()}px`);

    // El inicio mide lo que tiene; un formulario o la agenda, el alto completo.
    panel.classList.toggle('w-viewing', current !== null);
    home.style.display = current ? 'none' : 'contents';
    viewBox.style.display = current ? 'flex' : 'none';
    if (current && viewTitle) viewTitle.textContent = current.label;
    if (viewBack) viewBack.style.visibility = hasHome() ? 'visible' : 'hidden';
    for (const [id, f] of frames) f.style.display = current?.id === id ? 'block' : 'none';

    // v0.1.395 — los botones según el horario (el formulario abierto no se cierra si cambia la hora).
    const visible = new Set(shownButtons().map((b) => b.id));
    app.querySelectorAll<HTMLElement>('[data-btn]').forEach((n) => {
        n.hidden = !visible.has(n.getAttribute('data-btn') ?? '');
    });
    paintBar();
    paintHours();
    paintGreeting(barMode);

    // WhatsApp directo: la página de donde viene va en el enlace.
    app.querySelectorAll<HTMLAnchorElement>('a[data-href-for]').forEach((a) => {
        const b = meta!.buttons.find((x) => x.id === a.getAttribute('data-href-for'));
        if (b) a.href = hrefOf(b);
    });
    requestAnimationFrame(report);
}

/** v0.1.396 — El saludo: sólo con el widget cerrado (y en la vista previa, para verlo al diseñar). */
function paintGreeting(barMode: boolean): void {
    if (!greetEl || !greetMsg || !meta) return;
    let text = greetText;
    if (PREVIEW) text = meta.greeting ? widgetGreetingFor({ ...meta.greeting, mobile: true }, host?.url ?? null, host?.width ?? 0) : null;
    const show = !!text && !open && !barMode;
    greetEl.hidden = !show;
    if (show && greetMsg.textContent !== text) greetMsg.textContent = text;
}

/** Del lado del borde, el aire dentro del marco: la separación elegida, hasta PAD. */
function edgeInset(offset: number): number {
    return Math.min(Math.max(0, offset), PAD);
}

let lastSize = '';
/** Le dice a `embed.js` cuánto marco hace falta (lo justo: el resto del sitio sigue tocándose). */
function report(): void {
    // Hasta saber cómo es el sitio (su ancho), el marco queda en cero: sin parpadeos.
    if (!embedded || PREVIEW || !meta || !root || !contextReady) return;
    let msg: Record<string, unknown>;
    if (!revealed) {
        // v0.1.396 — todavía no le toca (página, dispositivo, demora o scroll): el marco no ocupa nada.
        msg = { type: 'imb-w-size', w: 0, h: 0, open: false, watch_scroll: watchScroll };
    } else if (fullScreen()) {
        msg = { type: 'imb-w-size', full: true, open: true };
    } else if (showsBar() && !open) {
        const h = bar ? Math.ceil(bar.getBoundingClientRect().height) : 60;
        msg = { type: 'imb-w-size', bar: true, h, open: false };
    } else {
        const r = root.getBoundingClientRect();
        msg = {
            type: 'imb-w-size',
            w: Math.ceil(r.width) + PAD + edgeInset(meta.offset_x),
            h: Math.ceil(r.height) + PAD + edgeInset(meta.offset_y),
            pad: PAD,
            ox: meta.offset_x,
            oy: meta.offset_y,
            side: meta.position,
            open,
        };
    }
    const key = JSON.stringify(msg);
    if (key === lastSize) return;
    lastSize = key;
    try {
        parent.postMessage(msg, hostOrigin ?? '*');
    } catch {
        // nada
    }
}

let noteTimer = 0;
function previewNote(text: string): void {
    document.querySelector('.w-preview-note')?.remove();
    const n = el('div', 'w-preview-note', text);
    n.setAttribute('data-testid', 'widget-preview-note');
    document.body.appendChild(n);
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => n.remove(), 3200);
}

// ─────────────────────────── Mensajes ───────────────────────────

/** Lo que el formulario de adentro necesita saber: de dónde vino la persona y de qué botón viene. */
function contextFor(b: PublicWidgetButton | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = { type: 'imb-context', attribution: hostAttribution ?? {} };
    if (meta && b && !PREVIEW) out.widget = { token: meta.token, button: b.id, ...(host?.title ? { page_title: host.title.slice(0, 300) } : {}) };
    return out;
}

const pendingHello: Array<{ win: Window; b: PublicWidgetButton | undefined }> = [];

function childOf(source: MessageEventSource | null): { win: Window; b: PublicWidgetButton | undefined } | null {
    for (const f of frames.values()) {
        if (f.contentWindow && f.contentWindow === source) {
            const b = [...frames.entries()].find(([, x]) => x === f)?.[0];
            return { win: f.contentWindow, b: meta?.buttons.find((x) => x.id === b) };
        }
    }
    return null;
}

window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; [k: string]: unknown } | null;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;

    if (e.source === parent && parent !== window) {
        if (d.type === 'imb-context') {
            hostOrigin = typeof e.origin === 'string' && /^https?:\/\//.test(e.origin) ? e.origin : hostOrigin;
            hostAttribution = d.attribution && typeof d.attribution === 'object' ? (d.attribution as Record<string, string>) : {};
            if (d.host && typeof d.host === 'object') {
                host = d.host as HostInfo;
                hostAt = performance.now();
            }
            contextReady = true;
            for (const p of pendingHello.splice(0)) p.win.postMessage(contextFor(p.b), location.origin);
            checkReveal();
            paint();
        } else if (d.type === 'imb-w-host' && d.host && typeof d.host === 'object') {
            host = d.host as HostInfo;
            hostAt = performance.now();
            checkReveal();
            paint();
        } else if (d.type === 'imb-w-close') {
            if (current && hasHome()) showHome();
            else setOpen(false);
        } else if (d.type === 'imb-conversion-ack') {
            // El sitio recibió la conversión: se lo decimos al formulario.
            for (const f of frames.values()) f.contentWindow?.postMessage(d, location.origin);
        } else if (d.type === 'imb-w-preview' && PREVIEW && e.origin === location.origin) {
            meta = (d.meta as PublicWidgetMeta | null) ?? null;
            if (d.host && typeof d.host === 'object') host = d.host as HostInfo;
            forcedOpen = typeof d.hours_open === 'boolean' ? d.hours_open : null;
            build();
            // Abierto o cerrado según el editor (antes sólo abría: `open` sobrevive a build() y el
            // panel quedaba abierto con «Cerrado» elegido). Sin mover el foco: quien edita sigue
            // escribiendo en el editor.
            setOpen(d.open === true, false);
        }
        return;
    }

    // De un formulario o una agenda abiertos en el panel (mismo origen).
    if (e.origin !== location.origin) return;
    const child = childOf(e.source);
    if (!child) return;
    if (d.type === 'imb-hello') {
        if (contextReady || PREVIEW || !embedded) child.win.postMessage(contextFor(child.b), location.origin);
        else pendingHello.push(child);
    } else if (d.type === 'imb-conversion' || d.type === 'imb-form-redirect') {
        // v0.1.396 — dejó sus datos (o agendó) desde este botón: un contacto para las estadísticas.
        if (d.type === 'imb-conversion' && child.b) {
            const ev = d.event as { submission_id?: unknown } | undefined;
            const sid = typeof ev?.submission_id === 'string' ? ev.submission_id : '';
            if (!sid || !leadSeen.has(sid)) {
                if (sid) leadSeen.add(sid);
                stat({ kind: 'lead', button: child.b.id });
            }
        }
        // La conversión y la página de gracias son del SITIO: se las pasamos a embed.js.
        if (embedded && !PREVIEW) {
            try {
                parent.postMessage(d, hostOrigin ?? '*');
            } catch {
                // nada
            }
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    if (current && hasHome()) showHome();
    else setOpen(false);
});

// ─────────────────────────── El reloj del horario ───────────────────────────

let hoursTimer = 0;
/** Revisa el horario justo cuando cambia (y, por las dudas, cada minuto). */
function scheduleHoursTick(): void {
    window.clearTimeout(hoursTimer);
    if (!meta?.hours) return;
    const now = new Date();
    const next = openNow ? widgetClosesAt(meta.hours, now) : widgetNextOpening(meta.hours, now);
    const wait = next ? Math.min(60_000, Math.max(1_000, next.getTime() - now.getTime() + 500)) : 60_000;
    hoursTimer = window.setTimeout(() => {
        const was = openNow;
        openNow = computeOpen();
        if (was !== openNow) paint();
        else paintHours();
        scheduleHoursTick();
    }, wait);
}

// ─────────────────────────── Arranque ───────────────────────────

if (PREVIEW) {
    try {
        parent.postMessage({ type: 'imb-w-ready' }, location.origin);
    } catch {
        // nada
    }
} else {
    build();
    if (embedded) {
        try {
            parent.postMessage({ type: 'imb-hello' }, '*');
        } catch {
            // nada
        }
        // Un marco pegado a mano (sin embed.js) no contesta: igual se muestra.
        window.setTimeout(() => {
            if (contextReady) return;
            contextReady = true;
            for (const p of pendingHello.splice(0)) p.win.postMessage(contextFor(p.b), location.origin);
            checkReveal();
            paint();
        }, 1500);
    }
}
