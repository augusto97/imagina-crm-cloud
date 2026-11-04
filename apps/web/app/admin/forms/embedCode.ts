/**
 * v0.1.352 (ADR-S95) — El código para insertar un formulario o una agenda en
 * el sitio de la empresa, en tres formas:
 *
 *  - **En la página** (`inline`): el marco se ve dentro de la página. Lleva
 *    `loading="lazy"`: no se carga hasta que la persona baja hasta él.
 *  - **Ventana al hacer clic** (`popup`): un botón (o cualquier enlace con
 *    `data-imagina-popup`) abre el formulario en una ventana. No se carga nada
 *    hasta que alguien pasa el mouse o lo toca.
 *  - **Botón flotante** (`float`): un botón fijo en una esquina de TODAS las
 *    páginas donde se pegue, que abre la misma ventana.
 *
 * Las dos últimas son las más livianas para un sitio con muchas visitas: la
 * gran mayoría mira la página y nunca abre el formulario, así que ni lo pide.
 *
 * v0.1.359 — la ventana de las dos últimas se abre al centro, como **panel
 * lateral** (desde la derecha o la izquierda) o a **pantalla completa**.
 */
export type EmbedMode = 'inline' | 'popup' | 'float';

/** Cómo se abre la ventana (`popup` y `float`). */
export type EmbedOpen = 'window' | 'side' | 'full';

export interface EmbedTarget {
    /** La dirección pública (absoluta) del formulario o la agenda. */
    url: string;
    /** El origen de la app, de donde se carga `embed.js`. */
    origin: string;
    /** Nombre (para el `title` del marco y de la ventana). */
    title: string;
    kind: 'form' | 'booking';
}

export interface EmbedOptions {
    label: string;
    /** Hex `#rrggbb`. */
    color: string;
    /** La esquina del botón flotante y el lado del panel lateral. */
    position: 'right' | 'left';
    /** v0.1.359 — cómo se abre (por defecto, al centro). */
    open?: EmbedOpen;
}

/** Los atributos que dicen cómo se abre (nada para la ventana al centro). */
function openAttrs(open: EmbedOpen | undefined, side: 'right' | 'left'): string {
    if (open === 'full') return ' data-imagina-open="full"';
    if (open === 'side') return ` data-imagina-open="side" data-imagina-side="${side}"`;
    return '';
}

const attr = (v: string): string => v.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

/** Texto del botón por defecto. */
export function defaultEmbedLabel(kind: EmbedTarget['kind']): string {
    return kind === 'booking' ? 'Agenda tu cita' : 'Escríbenos';
}

/** Tinta legible sobre el color del botón (misma regla que `embed.js`). */
export function buttonInk(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#ffffff';
    const n = parseInt(m[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111827' : '#ffffff';
}

export function safeHex(hex: string, fallback = '#0e7490'): string {
    return /^#[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim().toLowerCase() : fallback;
}

export function embedCode(t: EmbedTarget, mode: EmbedMode, opts: EmbedOptions): string {
    const script = `${t.origin}/api/v1/public/f/embed.js`;
    const title = attr(t.title);
    const label = opts.label.trim() || defaultEmbedLabel(t.kind);
    const color = safeHex(opts.color);
    if (mode === 'popup') {
        const ink = buttonInk(color);
        return (
            `<button type="button" data-imagina-popup="${attr(t.url)}"${openAttrs(opts.open, opts.position)} data-imagina-title="${title}" ` +
            `style="background:${color};color:${ink};border:0;border-radius:999px;padding:12px 22px;font:600 15px/1.2 system-ui,sans-serif;cursor:pointer">` +
            `${attr(label)}</button>\n` +
            `<script src="${script}" async></script>`
        );
    }
    if (mode === 'float') {
        return (
            `<script src="${script}" data-imagina-float="${attr(t.url)}" data-imagina-title="${title}" ` +
            `data-imagina-label="${attr(label)}" data-imagina-color="${color}" data-imagina-position="${opts.position}"` +
            `${opts.open === 'side' || opts.open === 'full' ? ` data-imagina-open="${opts.open}"` : ''} async></script>`
        );
    }
    const height = t.kind === 'booking' ? 720 : 640;
    return (
        `<iframe src="${t.url}" title="${title}" data-imagina-form style="width:100%;height:${height}px;border:0" loading="lazy"></iframe>\n` +
        `<script src="${script}" async></script>`
    );
}

/**
 * El atributo para convertir un botón o enlace propio del sitio en el que abre
 * la ventana (junto con el script, pegado una vez en la página).
 */
export function embedPopupAttribute(t: EmbedTarget, open?: EmbedOpen, side: 'right' | 'left' = 'right'): string {
    return `data-imagina-popup="${attr(t.url)}"${openAttrs(open, side)}`;
}

/**
 * v0.1.359 — La dirección para el código QR: la misma del formulario con
 * `utm_source=qr`, así las estadísticas cuentan aparte a quien llega por el
 * QR impreso.
 */
export function qrTargetUrl(url: string): string {
    try {
        const u = new URL(url);
        u.searchParams.set('utm_source', 'qr');
        return u.toString();
    } catch {
        return url;
    }
}
