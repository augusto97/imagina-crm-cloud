import { formatAutonumber } from '../field-types/autonumber';
import type { COLOR_PRESETS } from '../schemas/field';

type ColorPreset = (typeof COLOR_PRESETS)[number];
import type {
    AirtableFieldSchema,
    AirtablePersonSeen,
    AirtableTableScan,
    AirtableTableSchema,
    AirtableTargetType,
} from './schema';

/**
 * v0.1.458 — Cómo cae cada tipo de campo de Airtable en la app (la tabla del
 * ADR). Puro: lo usan la revisión del navegador y el servidor.
 *
 * Reglas que no se negocian:
 *  - Lo CALCULADO en Airtable (fórmulas, resúmenes, búsquedas, conteos) se
 *    trae como dato FIJO del tipo de su resultado: no se recalcula y la
 *    revisión lo dice.
 *  - Un vínculo de Airtable existe en las DOS tablas (cada lado es un campo).
 *    En la app un vínculo es UN campo relación que se ve desde las dos listas:
 *    se crea en un solo lado (el que apunta a «un solo registro», si lo hay) y
 *    el otro queda fuera con el motivo.
 *  - Nada se adivina en silencio: lo que no se importa lleva su porqué.
 */

/** Nombre visible de cada tipo de Airtable (los que no están aquí: «Tipo «x» de Airtable»). */
export const AIRTABLE_TYPE_LABELS: Record<string, string> = {
    singleLineText: 'Texto de una línea',
    multilineText: 'Texto largo',
    richText: 'Texto con formato',
    email: 'Correo',
    url: 'Enlace',
    phoneNumber: 'Teléfono',
    number: 'Número',
    currency: 'Moneda',
    percent: 'Porcentaje',
    rating: 'Calificación',
    duration: 'Duración',
    checkbox: 'Casilla',
    singleSelect: 'Selección',
    multipleSelects: 'Selección múltiple',
    date: 'Fecha',
    dateTime: 'Fecha y hora',
    createdTime: 'Fecha de creación',
    lastModifiedTime: 'Última modificación',
    autoNumber: 'Número automático',
    singleCollaborator: 'Colaborador',
    multipleCollaborators: 'Colaboradores',
    createdBy: 'Creado por',
    lastModifiedBy: 'Modificado por',
    multipleRecordLinks: 'Vínculo a otra tabla',
    multipleAttachments: 'Adjuntos',
    formula: 'Fórmula',
    rollup: 'Resumen',
    multipleLookupValues: 'Búsqueda',
    lookup: 'Búsqueda',
    count: 'Conteo',
    barcode: 'Código de barras',
    button: 'Botón',
    aiText: 'Texto con IA',
    externalSyncSource: 'Origen sincronizado',
};

export function airtableTypeLabel(type: string): string {
    return AIRTABLE_TYPE_LABELS[type] ?? `Tipo «${type}» de Airtable`;
}

/** Nombre visible de los tipos de la app en que puede caer un campo. */
export const AIRTABLE_TARGET_LABELS: Record<AirtableTargetType, string> = {
    text: 'Texto',
    long_text: 'Texto largo',
    number: 'Número',
    currency: 'Moneda',
    percent: 'Porcentaje',
    rating: 'Calificación',
    duration: 'Duración',
    select: 'Selección',
    multi_select: 'Selección múltiple',
    date: 'Fecha',
    datetime: 'Fecha y hora',
    checkbox: 'Casilla',
    email: 'Correo',
    url: 'Enlace',
    phone: 'Teléfono',
    user: 'Persona',
    relation: 'Relación',
    file: 'Archivo',
    autonumber: 'ID automático',
};

// ── Colores ────────────────────────────────────────────────────────────────

const COLOR_BASES: Array<[string, ColorPreset]> = [
    ['blue', 'blue'],
    ['cyan', 'cyan'],
    ['teal', 'teal'],
    ['green', 'green'],
    ['yellow', 'yellow'],
    ['orange', 'orange'],
    ['red', 'red'],
    ['pink', 'pink'],
    ['purple', 'violet'],
    ['gray', 'gray'],
];

/** `blueLight2`, `purpleBright`, `greenDark1`… → el color de la app del mismo tono. */
export function airtableColor(color: unknown): ColorPreset | undefined {
    if (typeof color !== 'string') return undefined;
    const hit = COLOR_BASES.find(([base]) => color.startsWith(base));
    return hit?.[1];
}

// ── Moneda ─────────────────────────────────────────────────────────────────

const DOLLAR_CURRENCIES = new Set(['USD', 'COP', 'MXN', 'ARS', 'CLP', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'UYU', 'DOP', 'NIO']);
const SYMBOLS: Record<string, string> = {
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    'R$': 'BRL',
    'S/': 'PEN',
    'S/.': 'PEN',
    '₡': 'CRC',
    Q: 'GTQ',
    '₲': 'PYG',
    Bs: 'BOB',
    'Bs.': 'BOB',
    'RD$': 'DOP',
    'C$': 'NIO',
    L: 'HNL',
    '₹': 'INR',
    CHF: 'CHF',
    'US$': 'USD',
    'COL$': 'COP',
    'MX$': 'MXN',
    'AR$': 'ARS',
    'CLP$': 'CLP',
};

/**
 * El símbolo de Airtable («$», «€», «R$») → código ISO. «$» es la moneda de
 * la empresa si ésta usa ese símbolo (COP, MXN…), y dólares si no.
 */
export function airtableCurrency(symbol: unknown, fallback: string): string {
    const s = typeof symbol === 'string' ? symbol.trim() : '';
    if (/^[A-Z]{3}$/.test(s)) return s;
    const hit = SYMBOLS[s];
    if (hit) return hit;
    if (s === '$' || s === '') return DOLLAR_CURRENCIES.has(fallback) ? fallback : 'USD';
    return fallback;
}

// ── Vínculos ───────────────────────────────────────────────────────────────

export interface AirtableLinkRole {
    /** `relation` = este lado se crea como campo relación; `inverse` = es la otra cara. */
    side: 'relation' | 'inverse';
    /** La tabla a la que apunta este campo. */
    target_table_id: string;
    /** El campo del otro lado (si el vínculo es de dos caras). */
    partner_field_id?: string;
    partner_table_id?: string;
}

/**
 * Elige, para cada vínculo de dos caras, el lado que se crea: el que prefiere
 * «un solo registro» (la tarea apunta a SU proyecto); si los dos o ninguno,
 * el primero que aparece. Un vínculo de una sola cara siempre se crea.
 */
export function pairAirtableLinks(tables: readonly AirtableTableSchema[]): Map<string, AirtableLinkRole> {
    const out = new Map<string, AirtableLinkRole>();
    const where = new Map<string, { table: AirtableTableSchema; field: AirtableFieldSchema }>();
    for (const t of tables) for (const fld of t.fields) where.set(fld.id, { table: t, field: fld });
    for (const t of tables) {
        for (const fld of t.fields) {
            if (fld.type !== 'multipleRecordLinks' || out.has(fld.id)) continue;
            const opts = fld.options ?? {};
            const target = typeof opts.linkedTableId === 'string' ? opts.linkedTableId : '';
            const inverseId = typeof opts.inverseLinkFieldId === 'string' ? opts.inverseLinkFieldId : '';
            const inv = inverseId ? where.get(inverseId) : undefined;
            if (!inv || inv.field.type !== 'multipleRecordLinks' || inv.field.id === fld.id) {
                out.set(fld.id, { side: 'relation', target_table_id: target });
                continue;
            }
            const aSingle = opts.prefersSingleRecordLink === true;
            const bSingle = inv.field.options?.prefersSingleRecordLink === true;
            const keepOther = bSingle && !aSingle;
            const keep = keepOther ? { table: inv.table, field: inv.field } : { table: t, field: fld };
            const drop = keepOther ? { table: t, field: fld } : { table: inv.table, field: inv.field };
            out.set(keep.field.id, { side: 'relation', target_table_id: drop.table.id, partner_field_id: drop.field.id, partner_table_id: drop.table.id });
            out.set(drop.field.id, { side: 'inverse', target_table_id: keep.table.id, partner_field_id: keep.field.id, partner_table_id: keep.table.id });
        }
    }
    return out;
}

// ── Qué tipo se propone para cada campo ────────────────────────────────────

export interface AirtableFieldInfo {
    /** Tipo que propone la app (`null` = no se puede importar). */
    type: AirtableTargetType | null;
    /** Tipos que se pueden elegir (incluye el propuesto). */
    alternatives: AirtableTargetType[];
    /** Por qué (en lenguaje claro). */
    reason: string;
    /** Calculado en Airtable: se trae su valor y no se recalcula. */
    fixed: boolean;
    /** No se puede incluir (la otra cara de un vínculo, un botón, un tipo desconocido…). */
    locked: boolean;
    /** Vínculo: la tabla del otro lado. */
    link_table_id?: string;
    /** El tipo de los VALORES que manda Airtable (el resultado de una fórmula, p. ej.). */
    source: string;
}

export interface AirtableDescribeContext {
    tables: readonly AirtableTableSchema[];
    scan: ReadonlyMap<string, AirtableTableScan>;
    /** Tablas que se importan (un vínculo hacia una que no, no se puede crear). */
    included: ReadonlySet<string>;
    /** Se bajan los adjuntos. */
    attachments: boolean;
    links: ReadonlyMap<string, AirtableLinkRole>;
}

/** Opciones que admite una selección de la app. */
export const AIRTABLE_MAX_OPTIONS = 60;

/** El tipo de los valores: el resultado de una fórmula o un resumen, la fecha de «creación»… */
export function airtableValueSource(field: AirtableFieldSchema): string {
    const result = field.options?.result as { type?: unknown } | undefined;
    switch (field.type) {
        case 'formula':
        case 'rollup':
            return typeof result?.type === 'string' ? result.type : 'singleLineText';
        case 'createdTime':
        case 'lastModifiedTime':
            return result?.type === 'date' ? 'date' : 'dateTime';
        case 'multipleLookupValues':
        case 'lookup':
            return 'lookup';
        case 'count':
            return 'number';
        default:
            return field.type;
    }
}

/** Tipo de un VALOR calculado (resultado de una fórmula o un resumen). */
function scalarFor(source: string): { type: AirtableTargetType; alternatives: AirtableTargetType[] } {
    switch (source) {
        case 'number':
            return { type: 'number', alternatives: ['number', 'text'] };
        case 'currency':
            return { type: 'currency', alternatives: ['currency', 'number', 'text'] };
        case 'percent':
            return { type: 'percent', alternatives: ['percent', 'number', 'text'] };
        case 'duration':
            return { type: 'duration', alternatives: ['duration', 'number', 'text'] };
        case 'date':
            return { type: 'date', alternatives: ['date', 'text'] };
        case 'dateTime':
            return { type: 'datetime', alternatives: ['datetime', 'date', 'text'] };
        case 'checkbox':
            return { type: 'checkbox', alternatives: ['checkbox', 'text'] };
        case 'multilineText':
        case 'richText':
            return { type: 'long_text', alternatives: ['long_text', 'text'] };
        default:
            return { type: 'text', alternatives: ['text', 'long_text'] };
    }
}

function peopleNote(people: readonly AirtablePersonSeen[]): { all: boolean; others: string[] } {
    const others = people.filter((p) => !p.member).map((p) => p.name);
    return { all: people.length > 0 && others.length === 0, others };
}

export function describeAirtableField(field: AirtableFieldSchema, table: AirtableTableSchema, ctx: AirtableDescribeContext): AirtableFieldInfo {
    const info = describeRaw(field, table, ctx);
    // El campo principal es el título de cada registro: tiene que poder quedar como texto.
    if (field.id === table.primaryFieldId && info.type !== null && info.type !== 'text' && info.type !== 'long_text' && !info.locked) {
        const alternatives = info.alternatives.includes('text') ? info.alternatives : ['text' as const, ...info.alternatives];
        return { ...info, type: 'text', alternatives, reason: `Es el campo principal (el título de cada registro): queda como texto. ${info.reason}` };
    }
    return info;
}

function describeRaw(field: AirtableFieldSchema, table: AirtableTableSchema, ctx: AirtableDescribeContext): AirtableFieldInfo {
    const source = airtableValueSource(field);
    const opts = field.options ?? {};
    const base = { fixed: false, locked: false, source };
    const scan = ctx.scan.get(table.id);
    switch (field.type) {
        case 'singleLineText':
            return { ...base, type: 'text', alternatives: ['text', 'long_text', 'email', 'url', 'phone'], reason: 'Texto de una línea.' };
        case 'multilineText':
            return { ...base, type: 'long_text', alternatives: ['long_text', 'text'], reason: 'Texto largo.' };
        case 'richText':
            return {
                ...base,
                type: 'long_text',
                alternatives: ['long_text', 'text'],
                reason: 'Texto con formato: queda como texto largo (las marcas de negrita o listas se conservan como texto).',
            };
        case 'email':
            return { ...base, type: 'email', alternatives: ['email', 'text'], reason: 'Correo.' };
        case 'url':
            return { ...base, type: 'url', alternatives: ['url', 'text'], reason: 'Enlace.' };
        case 'phoneNumber':
            return { ...base, type: 'phone', alternatives: ['phone', 'text'], reason: 'Teléfono: los números sin indicativo toman el país de tu empresa.' };
        case 'barcode':
            return { ...base, type: 'text', alternatives: ['text'], reason: 'Código de barras: se trae el texto del código.' };
        case 'number':
            return { ...base, type: 'number', alternatives: ['number', 'currency', 'text'], reason: 'Número.' };
        case 'currency':
            return { ...base, type: 'currency', alternatives: ['currency', 'number', 'text'], reason: `Moneda (${typeof opts.symbol === 'string' ? opts.symbol : '$'}).` };
        case 'percent':
            return { ...base, type: 'percent', alternatives: ['percent', 'number', 'text'], reason: 'Porcentaje.' };
        case 'rating':
            return { ...base, type: 'rating', alternatives: ['rating', 'number'], reason: `Calificación de 1 a ${typeof opts.max === 'number' ? opts.max : 5}.` };
        case 'duration':
            return { ...base, type: 'duration', alternatives: ['duration', 'number', 'text'], reason: 'Duración: se guarda en minutos.' };
        case 'checkbox':
            return { ...base, type: 'checkbox', alternatives: ['checkbox', 'text'], reason: 'Casilla.' };
        case 'singleSelect':
        case 'multipleSelects': {
            const choices = Array.isArray(opts.choices) ? opts.choices : [];
            const multi = field.type === 'multipleSelects';
            if (choices.length === 0) return { ...base, type: 'text', alternatives: ['text'], reason: 'Selección sin opciones en Airtable: queda como texto.' };
            if (choices.length > AIRTABLE_MAX_OPTIONS) {
                return {
                    ...base,
                    type: 'text',
                    alternatives: ['text', 'long_text'],
                    reason: `Tiene ${choices.length} opciones y una selección de la app admite hasta ${AIRTABLE_MAX_OPTIONS}: queda como texto con el nombre de la opción.`,
                };
            }
            return {
                ...base,
                type: multi ? 'multi_select' : 'select',
                alternatives: multi ? ['multi_select', 'text'] : ['select', 'text'],
                reason: `${multi ? 'Selección múltiple' : 'Selección'} con ${choices.length} ${choices.length === 1 ? 'opción' : 'opciones'} y sus colores.`,
            };
        }
        case 'date':
            return { ...base, type: 'date', alternatives: ['date', 'text'], reason: 'Fecha.' };
        case 'dateTime': {
            const tz = typeof opts.timeZone === 'string' && opts.timeZone.includes('/') ? opts.timeZone : null;
            return { ...base, type: 'datetime', alternatives: ['datetime', 'date', 'text'], reason: tz ? `Fecha y hora (zona ${tz}).` : 'Fecha y hora.' };
        }
        case 'createdTime':
        case 'lastModifiedTime': {
            const s = scalarFor(source);
            return {
                ...base,
                fixed: true,
                type: s.type,
                alternatives: s.alternatives,
                reason: `${field.type === 'createdTime' ? 'Fecha de creación' : 'Última modificación'} de Airtable: se trae como dato fijo. La app además lleva sus propias fechas de creación y modificación.`,
            };
        }
        case 'autoNumber':
            return {
                ...base,
                type: 'autonumber',
                alternatives: ['autonumber', 'number', 'text'],
                reason: 'Número automático: se conservan los números de Airtable y los registros nuevos siguen desde el último.',
            };
        case 'singleCollaborator':
        case 'createdBy':
        case 'lastModifiedBy':
        case 'multipleCollaborators': {
            const people = scan?.people[field.id] ?? [];
            const note = peopleNote(people);
            const fixed = field.type === 'createdBy' || field.type === 'lastModifiedBy';
            const prefix = fixed ? `${field.type === 'createdBy' ? 'Quién creó el registro' : 'Quién lo modificó por última vez'} en Airtable (dato fijo). ` : '';
            if (field.type === 'multipleCollaborators') {
                return {
                    ...base,
                    type: 'text',
                    alternatives: ['text', 'user'],
                    reason: 'Varias personas por registro: quedan como texto con los nombres (un campo Persona guarda una sola). Si eliges «Persona», queda la primera que sea de tu equipo.',
                };
            }
            if (people.length === 0 || note.all) {
                return { ...base, fixed, type: 'user', alternatives: ['user', 'text'], reason: `${prefix}Todas las personas son de tu equipo: queda como Persona.` };
            }
            const names = note.others.slice(0, 3).join(', ');
            return {
                ...base,
                fixed,
                type: 'text',
                alternatives: ['text', 'user'],
                reason: `${prefix}Hay personas que no son de tu equipo (${names}${note.others.length > 3 ? '…' : ''}): queda como texto con el nombre. Si eliges «Persona», las de tu equipo quedan y las demás vacías.`,
            };
        }
        case 'multipleRecordLinks': {
            const role = ctx.links.get(field.id);
            const target = role?.target_table_id ?? (typeof opts.linkedTableId === 'string' ? opts.linkedTableId : '');
            const targetTable = ctx.tables.find((t) => t.id === target);
            const targetName = targetTable?.name ?? 'otra tabla';
            if (role?.side === 'inverse') {
                const partnerTable = ctx.tables.find((t) => t.id === role.partner_table_id);
                const partner = partnerTable?.fields.find((x) => x.id === role.partner_field_id);
                return {
                    ...base,
                    type: null,
                    alternatives: [],
                    locked: true,
                    link_table_id: target,
                    reason: `Es la otra cara del vínculo «${partner?.name ?? field.name}» de «${partnerTable?.name ?? targetName}»: en la app un vínculo es un solo campo que se ve desde las dos listas.`,
                };
            }
            if (!targetTable || !ctx.included.has(target)) {
                return {
                    ...base,
                    type: null,
                    alternatives: [],
                    locked: true,
                    link_table_id: target,
                    reason: `La tabla «${targetName}» no se importa: inclúyela para conservar este vínculo.`,
                };
            }
            return {
                ...base,
                type: 'relation',
                alternatives: ['relation'],
                link_table_id: target,
                reason:
                    target === table.id
                        ? 'Vínculo con registros de la misma tabla: queda como relación.'
                        : `Vínculo con «${targetName}»: queda como relación (también se ve desde «${targetName}»).`,
            };
        }
        case 'multipleAttachments': {
            const stats = scan?.attachments[field.id];
            if (!ctx.attachments) {
                return { ...base, type: null, alternatives: [], locked: true, reason: 'Los adjuntos no se bajan: actívalo arriba para traerlos.' };
            }
            const big = stats && stats.too_big > 0 ? ` ${stats.too_big} ${stats.too_big === 1 ? 'archivo pesa' : 'archivos pesan'} más de 15 MB y no se baja${stats.too_big === 1 ? '' : 'n'}.` : '';
            return { ...base, type: 'file', alternatives: ['file'], reason: `Adjuntos: se bajan y quedan como archivos de la app.${big}` };
        }
        case 'formula':
        case 'rollup': {
            const s = scalarFor(source);
            const what = field.type === 'formula' ? 'Fórmula' : 'Resumen';
            return {
                ...base,
                fixed: true,
                type: s.type,
                alternatives: s.alternatives,
                reason: `${what} de Airtable: se trae el valor de cada registro como dato fijo (no se recalcula). En la app puedes armarla con un campo Fórmula o un resumen.`,
            };
        }
        case 'multipleLookupValues':
        case 'lookup':
            return {
                ...base,
                fixed: true,
                type: 'text',
                alternatives: ['text', 'long_text'],
                reason: 'Búsqueda de Airtable: se traen los valores como texto fijo (no se actualiza). En la app puedes armarla con un campo Búsqueda sobre la relación.',
            };
        case 'count':
            return { ...base, fixed: true, type: 'number', alternatives: ['number', 'text'], reason: 'Conteo de Airtable: se trae el número como dato fijo (no se recalcula).' };
        case 'aiText':
            return { ...base, fixed: true, type: 'long_text', alternatives: ['long_text', 'text'], reason: 'Texto generado con IA en Airtable: se trae el texto (no se vuelve a generar).' };
        case 'externalSyncSource':
            return { ...base, fixed: true, type: 'text', alternatives: ['text'], reason: 'Origen de una sincronización de Airtable: se trae el nombre como texto.' };
        case 'button':
            return { ...base, type: null, alternatives: [], locked: true, reason: 'Los botones de Airtable no se importan (en la app puedes crear un campo Botón).' };
        default:
            return { ...base, type: null, alternatives: [], locked: true, reason: `La app todavía no conoce este tipo de campo de Airtable («${field.type}»): no se importa.` };
    }
}

// ── Valores ────────────────────────────────────────────────────────────────

export interface AirtableAttachment {
    id: string;
    url: string;
    filename: string;
    size: number;
    type: string;
}

export type AirtableCell =
    | { kind: 'empty' }
    | { kind: 'value'; value: unknown }
    | { kind: 'links'; ids: string[] }
    | { kind: 'files'; files: AirtableAttachment[] }
    | { kind: 'warn'; message: string };

/** Lo mínimo del campo destino que necesita la conversión. */
export interface AirtableCellTarget {
    label: string;
    type: AirtableTargetType;
    /** `airtableValueSource` del campo de Airtable. */
    source: string;
    /** Selección: nombre de la opción en Airtable → valor de la opción de la app. */
    option_map?: Record<string, string>;
    /** Zona de las fechas y horas del campo en Airtable (si tiene una propia). */
    time_zone?: string;
}

export interface AirtableCellContext {
    /** Zona horaria de la empresa (para pasar una fecha y hora a sólo fecha). */
    timeZone?: string;
    /** Correo (minúsculas) → id del miembro del equipo. */
    memberIdByEmail?: ReadonlyMap<string, number>;
}

const empty = { kind: 'empty' } as const;

/** Un valor de Airtable como texto legible (colaboradores por nombre, adjuntos por archivo…). */
export function airtableText(raw: unknown): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') return raw.trim() === '' ? null : raw.replace(/\s+$/, '');
    if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
    if (typeof raw === 'boolean') return raw ? 'Sí' : 'No';
    if (Array.isArray(raw)) {
        const parts = raw.map(airtableText).filter((s): s is string => s !== null);
        return parts.length === 0 ? null : parts.join(', ');
    }
    if (typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        if ('error' in o || 'specialValue' in o) return null;
        if (o.valuesByLinkedRecordId && typeof o.valuesByLinkedRecordId === 'object') {
            return airtableText(Object.values(o.valuesByLinkedRecordId as Record<string, unknown>).flat());
        }
        for (const k of ['name', 'text', 'value', 'filename', 'label', 'email']) {
            const v = o[k];
            if (typeof v === 'string' && v.trim() !== '') return v;
        }
    }
    return null;
}

function numberOf(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
    if (Array.isArray(raw) && raw.length === 1) return numberOf(raw[0]);
    return null;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Fecha (AAAA-MM-DD) de un valor de Airtable: una fecha tal cual; una fecha y hora en la zona que corresponda. */
export function airtableDateOnly(raw: string, timeZone?: string): string | null {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Una «fecha» que viene de una fórmula llega a medianoche UTC: es esa fecha.
    const midnight = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/.exec(s);
    if (midnight) return midnight[1]!;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    if (!timeZone) return d.toISOString().slice(0, 10);
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch {
        return d.toISOString().slice(0, 10);
    }
}

function peopleOf(raw: unknown): Array<{ email: string; name: string }> {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const out: Array<{ email: string; name: string }> = [];
    for (const p of list) {
        if (!p || typeof p !== 'object') continue;
        const o = p as Record<string, unknown>;
        const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
        const name = typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : email;
        if (name || email) out.push({ email, name });
    }
    return out;
}

/**
 * Un valor de Airtable → lo que se guarda en el campo de la app (antes de
 * pasar por `validateFieldValue`, que el servidor corre contra el campo YA
 * creado). Un vínculo devuelve los ids de Airtable (se resuelven al final) y
 * un adjunto sus archivos (se bajan aparte).
 */
export function convertAirtableValue(target: AirtableCellTarget, raw: unknown, ctx: AirtableCellContext = {}): AirtableCell {
    if (raw === null || raw === undefined || raw === '') return empty;
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && ('error' in raw || 'specialValue' in raw)) {
        return { kind: 'warn', message: 'Airtable devolvió un error en el cálculo: la celda quedó vacía.' };
    }
    if (Array.isArray(raw) && raw.length === 0) return empty;
    const src = target.source;
    switch (target.type) {
        case 'text':
        case 'long_text':
        case 'email':
        case 'url':
        case 'phone': {
            if (src === 'checkbox' && typeof raw === 'boolean') return { kind: 'value', value: raw ? 'Sí' : 'No' };
            if ((src === 'date' || src === 'dateTime') && typeof raw === 'string') return { kind: 'value', value: raw };
            if (src === 'percent' && typeof raw === 'number') return { kind: 'value', value: `${round4(raw * 100)} %` };
            const t = airtableText(raw);
            return t === null ? empty : { kind: 'value', value: target.type === 'text' ? t.replace(/\r?\n+/g, ' ').trim() : t };
        }
        case 'number':
        case 'currency': {
            let n = numberOf(raw);
            if (n === null) return { kind: 'warn', message: `«${String(airtableText(raw) ?? '').slice(0, 40)}» no es un número.` };
            if (src === 'percent') n = round4(n * 100);
            if (src === 'duration') n = round4(n / 60);
            return { kind: 'value', value: n };
        }
        case 'percent': {
            const n = numberOf(raw);
            if (n === null) return { kind: 'warn', message: 'No es un porcentaje.' };
            return { kind: 'value', value: src === 'percent' ? round4(n * 100) : n };
        }
        case 'rating': {
            const n = numberOf(raw);
            return n === null ? { kind: 'warn', message: 'No es una calificación.' } : { kind: 'value', value: Math.round(n) };
        }
        case 'duration': {
            const n = numberOf(raw);
            if (n === null) return { kind: 'warn', message: 'No es una duración.' };
            // Airtable guarda la duración en SEGUNDOS; la app, en minutos.
            return { kind: 'value', value: Math.round(src === 'duration' ? n / 60 : n) };
        }
        case 'checkbox':
            if (typeof raw === 'boolean') return raw ? { kind: 'value', value: true } : { kind: 'value', value: false };
            return { kind: 'value', value: Boolean(numberOf(raw) ?? airtableText(raw)) };
        case 'select': {
            const name = airtableText(Array.isArray(raw) ? raw[0] : raw);
            if (name === null) return empty;
            const value = optionValue(target, name);
            return value === null ? { kind: 'warn', message: `«${name.slice(0, 40)}» no es una opción de «${target.label}».` } : { kind: 'value', value };
        }
        case 'multi_select': {
            const names = (Array.isArray(raw) ? raw : [raw]).map(airtableText).filter((s): s is string => s !== null);
            const values: string[] = [];
            const missing: string[] = [];
            for (const n of names) {
                const v = optionValue(target, n);
                if (v === null) missing.push(n);
                else if (!values.includes(v)) values.push(v);
            }
            if (values.length === 0) return missing.length ? { kind: 'warn', message: `«${missing[0]!.slice(0, 40)}» no es una opción de «${target.label}».` } : empty;
            return { kind: 'value', value: values };
        }
        case 'date': {
            if (typeof raw !== 'string') return { kind: 'warn', message: 'No es una fecha.' };
            const d = airtableDateOnly(raw, target.time_zone ?? ctx.timeZone);
            return d === null ? { kind: 'warn', message: `«${raw.slice(0, 40)}» no es una fecha.` } : { kind: 'value', value: d };
        }
        case 'datetime': {
            if (typeof raw !== 'string') return { kind: 'warn', message: 'No es una fecha y hora.' };
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { kind: 'value', value: `${raw}T00:00:00.000Z` };
            const d = new Date(raw);
            return Number.isNaN(d.getTime()) ? { kind: 'warn', message: `«${raw.slice(0, 40)}» no es una fecha y hora.` } : { kind: 'value', value: d.toISOString() };
        }
        case 'user': {
            const people = peopleOf(raw);
            if (people.length === 0) return empty;
            for (const p of people) {
                const id = p.email ? ctx.memberIdByEmail?.get(p.email) : undefined;
                if (id !== undefined) return { kind: 'value', value: id };
            }
            return { kind: 'warn', message: `«${people[0]!.name.slice(0, 60)}» no es parte de tu equipo: la celda quedó vacía.` };
        }
        case 'relation': {
            const ids = (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === 'string' && x.startsWith('rec'));
            return ids.length === 0 ? empty : { kind: 'links', ids };
        }
        case 'file': {
            const files: AirtableAttachment[] = [];
            for (const a of Array.isArray(raw) ? raw : []) {
                if (!a || typeof a !== 'object') continue;
                const o = a as Record<string, unknown>;
                if (typeof o.url !== 'string' || typeof o.id !== 'string') continue;
                files.push({
                    id: o.id,
                    url: o.url,
                    filename: typeof o.filename === 'string' && o.filename.trim() !== '' ? o.filename : 'archivo',
                    size: typeof o.size === 'number' ? o.size : 0,
                    type: typeof o.type === 'string' ? o.type : 'application/octet-stream',
                });
            }
            return files.length === 0 ? empty : { kind: 'files', files };
        }
        case 'autonumber': {
            const n = numberOf(raw);
            return n === null ? empty : { kind: 'value', value: formatAutonumber(AIRTABLE_AUTONUMBER_CONFIG, n) };
        }
        default:
            return empty;
    }
}

/** El ID automático que conserva los números de Airtable tal cual («42»). */
export const AIRTABLE_AUTONUMBER_CONFIG = { prefix: '', digits: 1 } as const;

function fold(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
}

function optionValue(target: AirtableCellTarget, name: string): string | null {
    const map = target.option_map ?? {};
    return map[name] ?? map[`~${fold(name)}`] ?? null;
}
