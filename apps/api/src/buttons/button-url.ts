import { applyMergeTags, MERGE_TAG_RE, type MergeFormatter } from '../automations/merge-tags';

/**
 * Campo «Botón» — el enlace de la acción «Abrir un enlace», armado con las
 * variables del registro y validado DESPUÉS de resolverlas.
 *
 * Reglas (las mismas en la ficha, la tabla, el lote y el portal):
 *  - Una variable al PRINCIPIO del enlace es la dirección base y se copia tal
 *    cual (`{{sitio_web}}/contacto`); las demás se codifican para la URL
 *    (`encodeURIComponent`), así un mensaje de WhatsApp con espacios, tildes
 *    o «&» llega entero.
 *  - El texto que escribió quien armó el botón también se codifica (espacios,
 *    tildes, saltos de línea), sin tocar lo que ya venía codificado (`%20`).
 *    Después del «?», un «#» es texto («Pedido #12»), no un ancla.
 *  - Un TELÉFONO va con el indicativo y sin «+» (`573001112233`), que es como
 *    lo pide WhatsApp (`wa.me`); en un enlace `tel:` va con «+».
 *  - Sólo `https:`, `mailto:` y `tel:`. Nada de `javascript:`, `data:` ni
 *    `http:`: el destino lo decide el valor de un registro y no puede abrir
 *    código ni una conexión sin cifrar.
 */

export const BUTTON_URL_PROTOCOLS = ['https:', 'mailto:', 'tel:'] as const;
/** Tope del enlace ya armado (los navegadores aguantan más, WhatsApp no). */
export const BUTTON_URL_RESOLVED_MAX = 4000;

export interface ButtonUrlContext {
    /** Valor crudo de una variable (slug, `slug.nombre`, `date.today`…). */
    valueOf: (token: string) => unknown;
    /** Tipo del campo de una variable (para el teléfono); undefined si no es un campo. */
    typeOf: (token: string) => string | undefined;
    recordId: number;
    resolveLabel?: (token: string, value: unknown) => unknown;
    formatValue?: MergeFormatter;
}

export type ButtonUrlResult = { ok: true; url: string } | { ok: false; error: string };

export function buildButtonUrl(template: string, ctx: ButtonUrlContext): ButtonUrlResult {
    const t = (template ?? '').trim();
    if (t === '') return { ok: false, error: 'Falta el enlace.' };
    const isTel = /^tel:/i.test(t);

    // Un teléfono: con indicativo y sin «+» (WhatsApp), o con «+» en `tel:`.
    const valueOf = (token: string): unknown => {
        const raw = ctx.valueOf(token);
        if (typeof raw === 'string' && ctx.typeOf(token) === 'phone') {
            return isTel ? raw.replace(/[^\d+]/g, '') : raw.replace(/\D/g, '');
        }
        return raw;
    };

    const re = new RegExp(MERGE_TAG_RE.source, 'g');
    let out = '';
    let last = 0;
    let inQuery = false;
    for (let m = re.exec(t); m !== null; m = re.exec(t)) {
        const literal = t.slice(last, m.index);
        out += encodeLiteral(literal, inQuery);
        if (literal.includes('?')) inQuery = true;
        const text = applyMergeTags(m[0], valueOf, ctx.recordId, undefined, ctx.resolveLabel, ctx.formatValue);
        if (m.index === 0) out += text.trim();
        else if (isTel) out += text.replace(/[^\d+*#]/g, '');
        else out += encodeValue(text);
        last = m.index + m[0].length;
    }
    out += encodeLiteral(t.slice(last), inQuery);

    if (out.length > BUTTON_URL_RESOLVED_MAX) return { ok: false, error: 'El enlace quedó demasiado largo.' };
    return checkButtonUrl(out);
}

/** Valida un enlace ya armado: protocolo permitido y forma de URL. */
export function checkButtonUrl(url: string): ButtonUrlResult {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: 'El enlace no es válido (¿quedó vacía alguna variable?).' };
    }
    const protocol = parsed.protocol.toLowerCase();
    if (!(BUTTON_URL_PROTOCOLS as readonly string[]).includes(protocol)) {
        return { ok: false, error: 'El enlace tiene que empezar con https://, mailto: o tel:.' };
    }
    if (protocol === 'https:' && parsed.hostname === '') return { ok: false, error: 'Al enlace le falta el dominio.' };
    if ((protocol === 'mailto:' || protocol === 'tel:') && parsed.pathname.replace(/[^\w@+]/g, '') === '') {
        return { ok: false, error: protocol === 'tel:' ? 'El enlace no tiene un número.' : 'El enlace no tiene un correo.' };
    }
    return { ok: true, url };
}

/** Un valor dentro de la URL: todo codificado salvo «@» (correos legibles). */
function encodeValue(text: string): string {
    return encodeURIComponent(text).replace(/%40/g, '@');
}

/**
 * El texto fijo: se codifican los caracteres que no van sin codificar en una
 * URL (espacios, tildes, saltos de línea), se respeta lo que ya está
 * codificado (`%XX`) y, en la parte de la consulta, el «#».
 */
function encodeLiteral(text: string, inQuery: boolean): string {
    let query = inQuery;
    let out = '';
    // Por punto de código: un emoji no se parte en dos mitades inválidas.
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i]!;
        if (c === '?') query = true;
        if (c === '%' && /^[0-9A-Fa-f]{2}$/.test(`${chars[i + 1] ?? ''}${chars[i + 2] ?? ''}`)) {
            out += c;
            continue;
        }
        if (c === '#' && query) {
            out += '%23';
            continue;
        }
        out += /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/.test(c) ? c : encodeURIComponent(c);
    }
    return out;
}
