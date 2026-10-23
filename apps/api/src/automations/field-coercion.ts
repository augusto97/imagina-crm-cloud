import {
    FALLBACK_TIME_ZONE,
    resolveTimeZone,
    validateFieldValue,
    zonedInstant,
    zonedToday,
    type FieldValueSpec,
    type TenantFormat,
} from '@imagina-base/shared';

/**
 * Coerción de valores que una AUTOMATIZACIÓN escribe en un campo
 * (`update_field` / `create_record`).
 *
 * El valor llega de una plantilla con variables (`{{monto}}`, «150.000»,
 * «sí», «vip, promo», «2026-10-21 14:30») y antes se escribía TAL CUAL en
 * `data`: un número como texto, un multi_select como una cadena, un
 * checkbox «0» (que en JS es verdadero), una fecha «mañana» que después
 * tiraba con 500 el orden y los filtros de toda la lista. Aquí cada valor se
 * lleva a la forma que el campo guarda y pasa por el MISMO validador
 * compartido que usan la interfaz, el import y la API; lo que no se puede
 * convertir se rechaza con el motivo (el motor lo saltea y lo anota).
 *
 * Puro: sin base de datos ni red (se prueba aparte y lo comparte el motor).
 */

export interface CoercibleField {
    type: string;
    config: unknown;
    label?: string;
}

export interface CoerceOptions {
    /** Zona de la empresa: «2026-10-21 14:30» sin zona es la hora de su reloj. */
    timeZone?: string;
    /** Formato regional: «150.000» es 150 mil con punto de miles. */
    format?: Pick<TenantFormat, 'number_format' | 'date_format'>;
    /**
     * true cuando el valor salió de UNA sola variable (`{{monto}}`): viene en
     * el formato interno de la app (número JS, ISO), no tipeado por una persona.
     */
    fromVariable?: boolean;
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Tipos que una automatización no escribe: los calcula el servidor o viven fuera de `data`. */
export const READ_ONLY_TYPES: readonly string[] = [
    'computed', 'lookup', 'rollup', 'ai', 'time_tracked', 'formula',
    // v0.1.300 — ID automático y columnas de sistema.
    'autonumber', 'created_at', 'updated_at', 'created_by', 'updated_by',
    // Campo «Botón»: no tiene valor.
    'button',
];

const NUMERIC_TYPES = ['number', 'currency', 'percent', 'rating'];
const TRUE_WORDS = ['1', 'true', 'yes', 'si', 'sí', 'verdadero', 'on', 'x', 'marcado', 'activo'];
const FALSE_WORDS = ['0', 'false', 'no', 'falso', 'off', '', 'desmarcado', 'inactivo'];

export function coerceFieldValue(field: CoercibleField, raw: unknown, opts: CoerceOptions = {}): CoerceResult {
    const spec: FieldValueSpec = {
        type: field.type as FieldValueSpec['type'],
        config: (field.config ?? {}) as Record<string, unknown>,
        is_required: false,
    };
    const value = prepare(field, typeof raw === 'string' ? raw.trim() : raw, opts);
    if (value instanceof CoerceError) return { ok: false, error: value.message };
    const res = validateFieldValue(spec, value);
    return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.error };
}

class CoerceError {
    constructor(readonly message: string) {}
}

function prepare(field: CoercibleField, raw: unknown, opts: CoerceOptions): unknown {
    if (raw === undefined || raw === null) return null;
    switch (field.type) {
        case 'checkbox':
            return toBoolean(raw);
        case 'select':
            return Array.isArray(raw) ? optionValue(field, raw[0]) : optionValue(field, raw);
        case 'multi_select':
            return toOptionList(field, raw);
        case 'number':
        case 'currency':
        case 'percent':
        case 'rating':
            return toNumber(raw, opts);
        case 'date':
            return toDate(raw, opts);
        case 'datetime':
            return toDateTime(raw, opts);
        case 'user':
            if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
            return raw;
        case 'text':
        case 'long_text':
        case 'email':
        case 'url':
        case 'phone':
            if (Array.isArray(raw)) return raw.map((x) => String(x)).join(', ');
            if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
            return raw;
        case 'file':
            if (Array.isArray(raw)) return raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
            if (typeof raw === 'string') {
                const ids = raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
                return ids;
            }
            if (typeof raw === 'number') return [raw];
            return raw;
        default:
            return raw;
    }
}

function toBoolean(raw: unknown): unknown {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    if (typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (TRUE_WORDS.includes(v)) return true;
        if (FALSE_WORDS.includes(v)) return false;
        return new CoerceError(`«${raw}» no es sí/no.`);
    }
    return raw;
}

interface OptionLike {
    value: string;
    label: string;
}

function optionsOf(field: CoercibleField): OptionLike[] {
    const raw = (field.config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(raw)) return [];
    const out: OptionLike[] = [];
    for (const o of raw) {
        if (!o || typeof o !== 'object') continue;
        const value = (o as { value?: unknown }).value;
        const label = (o as { label?: unknown }).label;
        if (typeof value === 'string') out.push({ value, label: typeof label === 'string' ? label : value });
    }
    return out;
}

const fold = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();

/** El value de una opción a partir de su value o de su ETIQUETA («Pagada» → `pagada`). */
function optionValue(field: CoercibleField, raw: unknown): unknown {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (s === '') return null;
    const options = optionsOf(field);
    if (options.length === 0 || options.some((o) => o.value === s)) return s;
    const f = fold(s);
    const byValue = options.find((o) => fold(o.value) === f);
    if (byValue) return byValue.value;
    const byLabel = options.find((o) => fold(o.label) === f);
    return byLabel ? byLabel.value : s;
}

/** Lista de opciones: un array, o un texto separado por comas («vip, promo»). */
function toOptionList(field: CoercibleField, raw: unknown): unknown {
    const items: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(',')
          : [raw];
    const out: string[] = [];
    for (const item of items) {
        const v = optionValue(field, item);
        if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v);
    }
    return out.length === 0 ? null : out;
}

/**
 * Un número. Desde una variable (`{{monto}}`) viene en formato JS («1250000.5»);
 * tipeado por una persona, en el formato regional de la empresa («1.250.000,5»).
 */
function toNumber(raw: unknown, opts: CoerceOptions): unknown {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return raw;
    if (raw.trim() === '') return null;
    if (!/\d/.test(raw)) return new CoerceError(`«${raw}» no es un número.`);
    // Fuera espacios, % y un símbolo o código de moneda adelante («$ 1.000», «COP 1.000»).
    const s = raw.replace(/[%\s]/g, '').replace(/^[^\d+.,-]+/, '');
    const regional = opts.format?.number_format ?? 'comma_dot';
    const dot = regional === 'dot_comma' || regional === 'space_comma';
    if (/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) {
        // «150.000» sólo es ciento cincuenta MIL si lo tipeó una persona en
        // una empresa que usa punto de miles; de una variable o con punto
        // decimal, es el número tal cual.
        const looksGrouped = /^[+-]?\d{1,3}(\.\d{3})+$/.test(s);
        if (opts.fromVariable || !looksGrouped || !dot) return Number(s);
    }
    let t = s.replace(/[^\d.,-]/g, '');
    if (dot) {
        // 1.250.000,50 → miles con punto, decimal con coma.
        t = t.replace(/\./g, '').replace(',', '.');
    } else if (t.includes(',') && t.includes('.')) {
        t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (t.includes(',')) {
        t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
        t = t.replace(/\./g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) && t !== '' ? n : new CoerceError(`«${raw}» no es un número.`);
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_DT = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const WITH_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/** «31/12/2026» (dmy) o «12/31/2026» (mdy) según el formato de la empresa → YYYY-MM-DD. */
function slashDate(s: string, format: CoerceOptions['format']): string | null {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [day, month] = format?.date_format === 'mdy' ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validYmd(ymd: string): boolean {
    const m = YMD.exec(ymd);
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function toDate(raw: unknown, opts: CoerceOptions): unknown {
    if (typeof raw !== 'string') return raw;
    if (raw === '') return null;
    const tz = resolveTimeZone(opts.timeZone ?? FALLBACK_TIME_ZONE);
    let ymd: string | null = null;
    if (YMD.test(raw)) ymd = raw;
    else if (WITH_ZONE.test(raw) && !Number.isNaN(Date.parse(raw))) ymd = zonedToday(tz, new Date(raw));
    else {
        const naive = NAIVE_DT.exec(raw);
        if (naive) ymd = naive[1]!;
        else ymd = slashDate(raw, opts.format);
    }
    if (!ymd || !validYmd(ymd)) return new CoerceError(`«${raw}» no es una fecha (usa AAAA-MM-DD).`);
    return ymd;
}

function toDateTime(raw: unknown, opts: CoerceOptions): unknown {
    if (typeof raw !== 'string') return raw;
    if (raw === '') return null;
    const tz = resolveTimeZone(opts.timeZone ?? FALLBACK_TIME_ZONE);
    if (WITH_ZONE.test(raw)) {
        const t = Date.parse(raw.replace(' ', 'T'));
        if (Number.isNaN(t)) return new CoerceError(`«${raw}» no es una fecha y hora.`);
        return new Date(t).toISOString();
    }
    const naive = NAIVE_DT.exec(raw);
    if (naive && validYmd(naive[1]!)) {
        const h = Number(naive[2]);
        const m = Number(naive[3]);
        const sec = Number(naive[4] ?? 0);
        if (h > 23 || m > 59 || sec > 59) return new CoerceError(`«${raw}» no es una hora válida.`);
        // Sin zona = la hora del reloj de la EMPRESA (lo que escribe una persona).
        return zonedInstant(naive[1]!, tz, { h, m, s: sec }).toISOString();
    }
    const ymd = YMD.test(raw) ? raw : slashDate(raw, opts.format);
    if (ymd && validYmd(ymd)) return zonedInstant(ymd, tz).toISOString();
    return new CoerceError(`«${raw}» no es una fecha y hora (usa AAAA-MM-DD HH:MM).`);
}

/** ¿El tipo guarda números? (para saber si una variable sola se pasa sin convertir a texto). */
export function isNumericType(type: string): boolean {
    return NUMERIC_TYPES.includes(type) || type === 'duration';
}
