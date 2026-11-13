import type { TenantFormat } from './tenant';

/**
 * v0.1.430 (ADR-S103) — Los datos que se piden al pagar en la tienda.
 *
 * Nombre y correo se piden siempre: sin correo no hay confirmación, ni «Mis
 * pedidos», ni cliente al que vincular el pedido. Celular, cédula o NIT y
 * notas se eligen: no pedirlos, opcionales u obligatorios, con su nombre
 * («RUT», «DNI»). La dirección y la ciudad las pide la forma de entrega.
 *
 * Además, PREGUNTAS PROPIAS (hasta 12): texto, texto largo, número, una
 * opción de una lista, casilla o fecha; opcionales u obligatorias; con sus
 * datos, con la dirección (sólo si la entrega pide dirección) o al final, con
 * las notas. Cada respuesta se guarda en una columna de «Pedidos».
 *
 * PURO y sin zod: lo usan la página pública (lo que pide y valida) y el
 * servidor (lo que vale, con las mismas funciones).
 */

export const SHOP_FIELD_MODES = ['hidden', 'optional', 'required'] as const;
export type ShopFieldMode = (typeof SHOP_FIELD_MODES)[number];

export const SHOP_QUESTION_TYPES = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'] as const;
export type ShopQuestionType = (typeof SHOP_QUESTION_TYPES)[number];

/** Dónde va la pregunta: con «Tus datos», con la dirección de entrega o al final (con las notas). */
export const SHOP_QUESTION_PLACES = ['you', 'delivery', 'end'] as const;
export type ShopQuestionPlace = (typeof SHOP_QUESTION_PLACES)[number];

export const SHOP_MAX_QUESTIONS = 12;
export const SHOP_MAX_QUESTION_OPTIONS = 30;
/** Largo máximo de una respuesta de texto (texto largo: el doble). */
export const SHOP_ANSWER_MAX = 500;
export const SHOP_ANSWER_LONG_MAX = 2000;

export const SHOP_QUESTION_TYPE_LABELS: Record<ShopQuestionType, string> = {
    text: 'Texto corto',
    textarea: 'Texto largo',
    number: 'Número',
    select: 'Una opción de una lista',
    checkbox: 'Casilla (sí o no)',
    date: 'Fecha',
};

export const SHOP_QUESTION_PLACE_LABELS: Record<ShopQuestionPlace, string> = {
    you: 'Con «Tus datos»',
    delivery: 'Con la dirección de entrega',
    end: 'Al final, antes de pagar',
};

/** En qué columnas de «Pedidos» se puede guardar cada tipo (la primera es la que se crea). */
export const SHOP_QUESTION_COLUMN_TYPES: Record<ShopQuestionType, readonly string[]> = {
    text: ['text', 'long_text'],
    textarea: ['long_text', 'text'],
    number: ['number', 'currency'],
    select: ['select', 'text'],
    checkbox: ['checkbox', 'text'],
    date: ['date', 'text'],
};

/** Una pregunta como la ve la página pública (sin la columna donde se guarda). */
export interface PublicShopQuestion {
    id: string;
    label: string;
    type: ShopQuestionType;
    required: boolean;
    help: string;
    placeholder: string;
    options: string[];
    place: ShopQuestionPlace;
}

/** Los datos del pago como los ve la página pública. */
export interface PublicShopCheckoutFields {
    phone: ShopFieldMode;
    document: ShopFieldMode;
    notes: ShopFieldMode;
    labels: { phone: string; document: string; notes: string };
    questions: PublicShopQuestion[];
}

export const SHOP_DEFAULT_FIELD_LABELS = { phone: 'Celular', document: 'Cédula o NIT', notes: 'Notas para el pedido' } as const;

/** El nombre que se muestra de un dato fijo (el propio o el de siempre). */
export function shopFieldLabel(fields: Pick<PublicShopCheckoutFields, 'labels'>, key: 'phone' | 'document' | 'notes'): string {
    const own = (fields.labels?.[key] ?? '').trim();
    return own || SHOP_DEFAULT_FIELD_LABELS[key];
}

/** Una respuesta ya limpia: texto, número, sí/no o fecha `AAAA-MM-DD`. */
export type ShopAnswer = string | number | boolean;

/** Las opciones de una pregunta de lista: sin vacías ni repetidas (sin tildes ni mayúsculas). */
export function cleanShopQuestionOptions(raw: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const o of raw) {
        const t = String(o ?? '').trim().slice(0, 80);
        const k = optionKey(t);
        if (!t || seen.has(k)) continue;
        seen.add(k);
        out.push(t);
        if (out.length >= SHOP_MAX_QUESTION_OPTIONS) break;
    }
    return out;
}

function optionKey(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Lee un número escrito por una persona con el formato de la empresa: con
 * punto de miles, «1.500» es 1500 y «1.500,5» es 1500,5. Acepta negativos y
 * hasta 4 decimales. null = no es un número.
 */
export function parseShopNumberInput(raw: string, format?: TenantFormat['number_format']): number | null {
    let t = String(raw ?? '').trim().replace(/\s+/g, '');
    if (!t) return null;
    const neg = t.startsWith('-');
    if (neg) t = t.slice(1);
    const thousands = format === 'dot_comma' ? '.' : format === 'comma_dot' ? ',' : format === 'space_comma' ? ' ' : null;
    const decimal = format === 'comma_dot' ? '.' : ',';
    if (thousands && thousands !== ' ') {
        const grouped = new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+(\\${decimal}\\d{1,4})?$`);
        if (grouped.test(t)) t = t.split(thousands).join('');
    }
    if (!/^\d{1,13}([.,]\d{1,4})?$/.test(t)) return null;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
}

/** ¿Es una fecha real `AAAA-MM-DD`? (30 de febrero no). */
export function isShopDate(s: string): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** ¿La pregunta se pide en este pedido? Las de la dirección, sólo si la entrega pide dirección. */
export function shopQuestionAsked(q: Pick<PublicShopQuestion, 'place'>, ctx: { withAddress: boolean }): boolean {
    return q.place !== 'delivery' || ctx.withAddress;
}

/**
 * Limpia la respuesta de una pregunta. Devuelve `{ value }` (undefined =
 * sin respuesta) o `{ error }` con lo que hay que corregir. El número llega
 * ya leído por la página (con el formato de la empresa); un texto con un
 * número también se acepta.
 */
export function cleanShopAnswer(
    q: PublicShopQuestion,
    raw: unknown,
    format?: TenantFormat['number_format'],
): { value: ShopAnswer | undefined; error?: undefined } | { value?: undefined; error: string } {
    const name = q.label.trim() || 'esta pregunta';
    const missing = (): { error: string } | { value: undefined } => (q.required ? { error: q.type === 'checkbox' ? `Marca «${name}».` : q.type === 'select' ? `Elige una opción en «${name}».` : `Completa «${name}».` } : { value: undefined });
    if (raw === undefined || raw === null) return missing();
    switch (q.type) {
        case 'checkbox': {
            const on = raw === true || raw === 'true' || raw === 1 || raw === '1';
            if (!on) return q.required ? missing() : { value: false };
            return { value: true };
        }
        case 'number': {
            const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseShopNumberInput(raw, format) : null;
            if (typeof raw === 'string' && raw.trim() === '') return missing();
            if (n === null || !Number.isFinite(n) || Math.abs(n) > 1e13) return { error: `Escribe un número en «${name}».` };
            return { value: n };
        }
        case 'date': {
            const s = String(raw).trim();
            if (!s) return missing();
            if (!isShopDate(s)) return { error: `Elige una fecha válida en «${name}».` };
            return { value: s };
        }
        case 'select': {
            const s = String(raw).trim();
            if (!s) return missing();
            const hit = q.options.find((o) => optionKey(o) === optionKey(s));
            if (!hit) return { error: `Elige una de las opciones de «${name}».` };
            return { value: hit };
        }
        default: {
            if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `Revisa «${name}».` };
            const s = String(raw).trim();
            if (!s) return missing();
            const max = q.type === 'textarea' ? SHOP_ANSWER_LONG_MAX : SHOP_ANSWER_MAX;
            if (s.length > max) return { error: `«${name}» es muy largo: hasta ${max} caracteres.` };
            return { value: s };
        }
    }
}

/**
 * Limpia todas las respuestas de un pedido: sólo las preguntas que se piden
 * en este pedido; lo demás se descarta. `error` = la primera que hay que
 * corregir (con su id, para marcarla).
 */
export function cleanShopAnswers(
    questions: readonly PublicShopQuestion[],
    raw: Record<string, unknown> | null | undefined,
    ctx: { withAddress: boolean; format?: TenantFormat['number_format'] },
): { answers: Record<string, ShopAnswer>; error: { id: string; text: string } | null } {
    const answers: Record<string, ShopAnswer> = {};
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const q of questions) {
        if (!shopQuestionAsked(q, ctx)) continue;
        const r = cleanShopAnswer(q, Object.prototype.hasOwnProperty.call(src, q.id) ? src[q.id] : undefined, ctx.format);
        if (r.error !== undefined) return { answers, error: { id: q.id, text: r.error } };
        if (r.value !== undefined) answers[q.id] = r.value;
    }
    return { answers, error: null };
}

/** Una respuesta en palabras (correo de confirmación, mensaje de WhatsApp). */
export function shopAnswerText(q: Pick<PublicShopQuestion, 'type'>, value: ShopAnswer, format?: TenantFormat['number_format']): string {
    if (q.type === 'checkbox') return value === true ? 'Sí' : 'No';
    if (q.type === 'date' && typeof value === 'string' && isShopDate(value)) {
        const [y, m, d] = value.split('-');
        return `${d}/${m}/${y}`;
    }
    if (q.type === 'number' && typeof value === 'number') {
        const dec = format === 'comma_dot' ? '.' : ',';
        const th = format === 'comma_dot' ? ',' : format === 'space_comma' ? ' ' : '.';
        const [int, frac] = Math.abs(value).toString().split('.');
        const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, th);
        return `${value < 0 ? '-' : ''}${grouped}${frac ? dec + frac : ''}`;
    }
    return String(value);
}

/** ¿El celular escrito tiene al menos 7 dígitos? */
export function shopPhoneOk(s: string): boolean {
    return (s.match(/\d/g) ?? []).length >= 7;
}
