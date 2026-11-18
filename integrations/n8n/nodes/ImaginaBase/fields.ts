import type { FieldType as N8nFieldType, IDataObject, INodePropertyOptions, ResourceMapperField } from 'n8n-workflow';

/**
 * Piezas PURAS del nodo (sin red ni contexto de n8n): cómo se ve cada campo de
 * una lista en el mapeo de columnas, cómo se convierte lo que llega de n8n al
 * valor que espera la API, y cómo se aplana un registro para el flujo. Se
 * prueban solas en test/fields.test.ts.
 */

export interface ApiFieldOption {
    value: string;
    label?: string;
}

export interface ApiField {
    id: number;
    slug: string;
    label: string;
    type: string;
    config?: { options?: ApiFieldOption[]; multiple?: boolean } & Record<string, unknown>;
    is_required?: boolean;
    is_primary?: boolean;
}

export interface ApiRecord {
    id: number;
    list_id?: number;
    parent_id?: number | null;
    data?: Record<string, unknown>;
    relations?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
}

/** Tipos que se escriben a mano (los calculados, el ID automático y los de sistema, no). */
const TYPE_MAP: Record<string, N8nFieldType> = {
    text: 'string',
    long_text: 'string',
    email: 'string',
    url: 'string',
    phone: 'string',
    number: 'number',
    currency: 'number',
    rating: 'number',
    percent: 'number',
    duration: 'number',
    checkbox: 'boolean',
    date: 'dateTime',
    datetime: 'dateTime',
    select: 'options',
    multi_select: 'array',
    user: 'number',
    team: 'array',
    relation: 'array',
    file: 'array',
};

export function isWritable(type: string): boolean {
    return type in TYPE_MAP;
}

/** «https://app.x.com/», «https://app.x.com/api/v1» → «https://app.x.com/api/v1». */
export function apiBase(url: string): string {
    const clean = String(url ?? '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/api\/v1$/i, '');
    return `${clean}/api/v1`;
}

function optionsOf(field: ApiField): INodePropertyOptions[] {
    return (field.config?.options ?? []).map((o) => ({ name: o.label || o.value, value: o.value }));
}

/** Un campo de la lista como columna del mapeo (null = no se escribe a mano). */
export function fieldToColumn(field: ApiField): ResourceMapperField | null {
    const type = TYPE_MAP[field.type];
    if (!type) return null;
    const col: ResourceMapperField = {
        id: `f${field.id}`,
        displayName: field.label || field.slug,
        required: !!field.is_required,
        defaultMatch: false,
        display: true,
        type,
    };
    if (type === 'options') col.options = optionsOf(field);
    return col;
}

function norm(s: unknown): string {
    return String(s ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
}

/** Una opción por su valor o por su etiqueta (sin tildes ni mayúsculas). */
function optionValue(field: ApiField, v: unknown): string {
    const opts = field.config?.options ?? [];
    const raw = String(v ?? '').trim();
    const hit = opts.find((o) => o.value === raw) ?? opts.find((o) => norm(o.value) === norm(raw) || norm(o.label) === norm(raw));
    return hit ? hit.value : raw;
}

function toList(v: unknown): unknown[] {
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined) return [];
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return [];
        if (s.startsWith('[')) {
            try {
                const parsed: unknown = JSON.parse(s);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                // no era JSON: se separa por comas
            }
        }
        return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return [v];
}

/**
 * Un número escrito a mano: «1250.5», «1.250,5», «1,250.5», «1.250.000» o
 * «$ 1.250». El ÚLTIMO separador es el decimal salvo que sea un grupo de miles
 * (exactamente 3 cifras detrás y sin el otro separador).
 */
export function parseLooseNumber(raw: string): number | null {
    let s = raw.replace(/[\s$€£]|COP|USD|EUR|MXN/gi, '');
    if (!s || !/^[-+]?[\d.,]+$/.test(s)) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        const dec = lastDot > lastComma ? '.' : ',';
        s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (lastComma >= 0 || lastDot >= 0) {
        const sep = lastComma >= 0 ? ',' : '.';
        const parts = s.split(sep);
        const thousands = parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3 && sep === '.');
        s = thousands ? parts.join('') : parts.join('.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function toNumber(v: unknown): unknown {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        if (!v.trim()) return null;
        const n = parseLooseNumber(v.trim());
        return n === null ? v : n;
    }
    return v;
}

function isoOf(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'object' && v !== null && typeof (v as { toISO?: unknown }).toISO === 'function') {
        return String((v as { toISO: () => string }).toISO());
    }
    if (v instanceof Date) return v.toISOString();
    return String(v);
}

/**
 * Lo que llega de n8n → el valor que guarda la API. Una fecha sin hora va como
 * `AAAA-MM-DD`; una fecha y hora como instante UTC. `undefined` = no mandar.
 */
export function toApiValue(field: ApiField, value: unknown): unknown {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    switch (field.type) {
        case 'number':
        case 'currency':
        case 'rating':
        case 'percent':
        case 'duration':
            return toNumber(value);
        case 'user':
            return toNumber(value);
        case 'checkbox':
            if (typeof value === 'boolean') return value;
            return ['true', '1', 'si', 'sí', 'yes', 'x'].includes(norm(value));
        case 'date': {
            const iso = isoOf(value);
            return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
        }
        case 'datetime': {
            const iso = isoOf(value);
            if (!iso) return null;
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? iso : d.toISOString();
        }
        case 'select':
            return optionValue(field, value);
        case 'multi_select':
            return toList(value).map((x) => optionValue(field, x));
        case 'team':
        case 'relation':
        case 'file':
            return toList(value).map((x) => toNumber(x));
        default:
            return typeof value === 'string' ? value : String(value);
    }
}

/**
 * Arma `data` (`f{id}` → valor) con lo que mapeó el flujo. En un alta lo vacío
 * no se manda (queda con el valor por defecto del campo); en un cambio, vacío
 * = vaciar el campo.
 */
export function buildData(
    fields: ApiField[],
    values: Record<string, unknown> | null | undefined,
    mode: 'create' | 'update',
): Record<string, unknown> {
    const byKey = new Map(fields.map((f) => [`f${f.id}`, f]));
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const data: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(values ?? {})) {
        const field = byKey.get(key) ?? bySlug.get(key);
        if (!field || !isWritable(field.type)) continue;
        const v = toApiValue(field, raw);
        if (v === undefined) continue;
        if (mode === 'create' && (v === null || (Array.isArray(v) && v.length === 0))) continue;
        data[`f${field.id}`] = v;
    }
    return data;
}

/**
 * Un registro aplanado para el flujo: `id`, fechas y cada valor por el nombre
 * interno del campo (los vínculos con los ids de los registros vinculados).
 */
export function simplifyRecord(record: ApiRecord, fields: ApiField[]): IDataObject {
    const byKey = new Map(fields.map((f) => [`f${f.id}`, f.slug]));
    const out: IDataObject = { id: record.id };
    if (record.parent_id) out.parent_id = record.parent_id;
    for (const [key, v] of Object.entries(record.data ?? {})) out[byKey.get(key) ?? key] = v as IDataObject[string];
    for (const [key, v] of Object.entries(record.relations ?? {})) out[byKey.get(key) ?? key] = v as IDataObject[string];
    if (record.created_at) out.created_at = record.created_at;
    if (record.updated_at) out.updated_at = record.updated_at;
    return out;
}
