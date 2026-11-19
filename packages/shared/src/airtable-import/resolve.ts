import { uniqueFieldSlug } from '../file-import/draft';
import type { COLOR_PRESETS } from '../schemas/field';

type ColorPreset = (typeof COLOR_PRESETS)[number];
import { slugify } from '../schemas/slug';
import {
    AIRTABLE_MAX_OPTIONS,
    airtableColor,
    airtableCurrency,
    describeAirtableField,
    pairAirtableLinks,
    type AirtableDescribeContext,
    type AirtableFieldInfo,
} from './mapping';
import {
    AIRTABLE_MAX_FIELDS_PER_LIST,
    AIRTABLE_MAX_RECORDS,
    AIRTABLE_MAX_TABLES,
    type AirtableFieldSchema,
    type AirtablePlan,
    type AirtablePlanField,
    type AirtableTableScan,
    type AirtableTableSchema,
    type AirtableTargetType,
} from './schema';

/**
 * v0.1.458 — Del PLAN revisado a lo que se crea: qué listas, con qué campos
 * (y qué tipo, opciones, moneda, vínculo) y cuántos registros y archivos.
 * La MISMA función arma la vista previa del navegador y lo que crea el
 * servidor: lo que la persona aprueba es lo que se crea. Puro.
 */

export interface ResolvedAirtableOption {
    label: string;
    value: string;
    color?: ColorPreset;
}

export interface ResolvedAirtableField {
    /** El campo de Airtable de donde salen los valores. */
    field_id: string;
    label: string;
    slug: string;
    type: AirtableTargetType;
    /** El tipo de los valores que manda Airtable (`airtableValueSource`). */
    source: string;
    /** Calculado en Airtable: se trae como dato fijo. */
    fixed: boolean;
    options?: ResolvedAirtableOption[];
    /** Nombre de la opción en Airtable (y `~` + su forma sin acentos) → valor en la app. */
    option_map?: Record<string, string>;
    currency?: string;
    precision?: number;
    max?: number;
    default_country?: string;
    /** Relación: la `key` (el id de la tabla de Airtable) de la lista destino. */
    relation_to?: string;
    /** Fecha y hora: la zona propia del campo en Airtable. */
    time_zone?: string;
    description?: string;
    /** ID automático: el mayor número que trae Airtable (los nuevos siguen desde ahí). */
    autonumber_max?: number;
}

export interface ResolvedAirtableList {
    /** La clave de la lista dentro del pedido (el id de la tabla de Airtable). */
    key: string;
    table_id: string;
    name: string;
    title_slug: string;
    fields: ResolvedAirtableField[];
    records: number;
    /** Adjuntos que se bajarían y cuánto pesan. */
    files: number;
    file_bytes: number;
}

export interface ResolvedAirtablePlan {
    lists: ResolvedAirtableList[];
    folder_name: string | null;
    records: number;
    files: number;
    file_bytes: number;
    /** Lo que impide crear (en lenguaje claro). */
    errors: string[];
    /** Avisos que no impiden crear. */
    notes: string[];
}

export interface AirtableResolveContext {
    /** Moneda de la empresa («$» de Airtable se lee como ésta si la usa). */
    currency: string;
    /** País de la empresa (los teléfonos sin indicativo). */
    country: string;
}

export function airtableDescribeContext(
    tables: readonly AirtableTableSchema[],
    scan: readonly AirtableTableScan[],
    included: Iterable<string>,
    attachments: boolean,
): AirtableDescribeContext {
    return {
        tables,
        scan: new Map(scan.map((s) => [s.table_id, s])),
        included: new Set(included),
        attachments,
        links: pairAirtableLinks(tables),
    };
}

/** Lo que dice la revisión de cada campo de una tabla, con el plan actual (qué tablas se incluyen, si se bajan los adjuntos). */
export function airtableFieldInfos(table: AirtableTableSchema, ctx: AirtableDescribeContext): Map<string, AirtableFieldInfo> {
    return new Map(table.fields.map((f) => [f.id, describeAirtableField(f, table, ctx)]));
}

function cleanName(name: string, fallback: string): string {
    const n = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    return n === '' ? fallback : n;
}

/**
 * El borrador del plan: todas las tablas (hasta el tope), cada campo con el
 * tipo que propone la app y su nombre de Airtable. La persona lo cambia en
 * la revisión.
 */
export function buildAirtableDraftPlan(
    tables: readonly AirtableTableSchema[],
    scan: readonly AirtableTableScan[],
    opts: { attachments?: boolean; baseName?: string } = {},
): AirtablePlan {
    const attachments = opts.attachments ?? true;
    const includedIds = tables.slice(0, AIRTABLE_MAX_TABLES).map((t) => t.id);
    const ctx = airtableDescribeContext(tables, scan, includedIds, attachments);
    return {
        attachments,
        folder_name: opts.baseName ? cleanName(opts.baseName, 'Airtable') : undefined,
        tables: tables.map((t) => {
            const infos = airtableFieldInfos(t, ctx);
            let count = 0;
            const fields: AirtablePlanField[] = t.fields.map((f) => {
                const info = infos.get(f.id)!;
                const can = info.type !== null && !info.locked;
                const primary = f.id === t.primaryFieldId;
                // Un tope por lista: el título siempre entra; lo demás, en orden, hasta llenar.
                const include = can && (primary || count < AIRTABLE_MAX_FIELDS_PER_LIST - 1);
                if (include && !primary) count++;
                return { field_id: f.id, include, label: cleanName(f.name, 'Campo'), type: info.type ?? 'text' };
            });
            return {
                table_id: t.id,
                include: includedIds.includes(t.id),
                name: cleanName(t.name, 'Tabla'),
                title_field_id: t.primaryFieldId,
                fields,
            };
        }),
    };
}

function fold(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** Las opciones de una selección de Airtable con su color, y el mapa nombre → valor. */
export function airtableOptions(field: AirtableFieldSchema): { options: ResolvedAirtableOption[]; map: Record<string, string> } {
    const raw = Array.isArray(field.options?.choices) ? (field.options!.choices as Array<Record<string, unknown>>) : [];
    const used = new Set<string>();
    const options: ResolvedAirtableOption[] = [];
    const map: Record<string, string> = {};
    for (const c of raw.slice(0, AIRTABLE_MAX_OPTIONS)) {
        const label = typeof c.name === 'string' ? c.name.trim().slice(0, 190) : '';
        if (label === '' || map[label] !== undefined) continue;
        let value = slugify(label).slice(0, 180) || 'opcion';
        const base = value;
        let n = 2;
        while (used.has(value)) value = `${base}_${n++}`;
        used.add(value);
        const color = airtableColor(c.color);
        options.push({ label, value, ...(color ? { color } : {}) });
        map[label] = value;
        const k = `~${fold(label)}`;
        if (map[k] === undefined) map[k] = value;
    }
    return { options, map };
}

function precisionOf(field: AirtableFieldSchema): number | undefined {
    const opts = (field.options?.result as { options?: Record<string, unknown> } | undefined)?.options ?? field.options ?? {};
    const p = opts.precision;
    return typeof p === 'number' && Number.isInteger(p) ? Math.min(4, Math.max(0, p)) : undefined;
}

function currencySymbol(field: AirtableFieldSchema): unknown {
    const opts = (field.options?.result as { options?: Record<string, unknown> } | undefined)?.options ?? field.options ?? {};
    return opts.symbol;
}

function timeZoneOf(field: AirtableFieldSchema): string | undefined {
    const opts = (field.options?.result as { options?: Record<string, unknown> } | undefined)?.options ?? field.options ?? {};
    const tz = opts.timeZone;
    return typeof tz === 'string' && tz.includes('/') ? tz : undefined;
}

export function resolveAirtablePlan(
    plan: AirtablePlan,
    tables: readonly AirtableTableSchema[],
    scan: readonly AirtableTableScan[],
    rctx: AirtableResolveContext,
): ResolvedAirtablePlan {
    const errors: string[] = [];
    const notes: string[] = [];
    const tableById = new Map(tables.map((t) => [t.id, t]));
    const scanById = new Map(scan.map((s) => [s.table_id, s]));

    const included = plan.tables.filter((t) => t.include && tableById.has(t.table_id));
    for (const t of plan.tables) if (t.include && !tableById.has(t.table_id)) errors.push(`La tabla «${t.name}» ya no está en la base de Airtable.`);
    if (included.length === 0) errors.push('Elige al menos una tabla para importar.');
    if (included.length > AIRTABLE_MAX_TABLES) errors.push(`Se importarían ${included.length} tablas y el máximo de una vez es ${AIRTABLE_MAX_TABLES}: deja fuera alguna.`);

    const ctx = airtableDescribeContext(tables, scan, included.map((t) => t.table_id), plan.attachments);
    const names = new Map<string, string>();
    const out: ResolvedAirtableList[] = [];
    let truncated = false;

    for (const pt of included) {
        const table = tableById.get(pt.table_id)!;
        const s = scanById.get(table.id);
        if (s?.truncated) truncated = true;
        const name = cleanName(pt.name, table.name);
        const k = fold(name);
        if (names.has(k)) errors.push(`Dos listas se llamarían «${name}»: cámbiale el nombre a una.`);
        names.set(k, name);

        const infos = airtableFieldInfos(table, ctx);
        const planned = new Map(pt.fields.map((f) => [f.field_id, f]));
        const used = new Set<string>();
        const fields: ResolvedAirtableField[] = [];
        let titleSlug = '';
        let files = 0;
        let fileBytes = 0;

        const titleField = table.fields.find((f) => f.id === pt.title_field_id);
        if (!titleField) errors.push(`«${name}»: el campo que hace de título ya no está en Airtable.`);

        for (const af of table.fields) {
            const p = planned.get(af.id);
            const isTitle = af.id === pt.title_field_id;
            if (!p?.include && !isTitle) continue;
            const info = infos.get(af.id)!;
            if (info.type === null || info.locked) {
                if (isTitle) errors.push(`«${name}»: «${af.name}» no se puede usar como título (${info.reason})`);
                continue;
            }
            const label = cleanName(p?.label ?? af.name, 'Campo');
            const type = p ? p.type : info.type;
            if (!info.alternatives.includes(type)) {
                errors.push(`«${name}» → «${label}»: no se puede convertir a ese tipo. Elige otro.`);
                continue;
            }
            if (isTitle && p && !p.include) {
                errors.push(`«${name}»: «${label}» hace de título y no se puede dejar fuera.`);
                continue;
            }
            if (isTitle && type !== 'text' && type !== 'long_text') {
                errors.push(`«${name}»: el título tiene que ser de texto («${label}» no lo es).`);
                continue;
            }
            const f: ResolvedAirtableField = {
                field_id: af.id,
                label,
                slug: uniqueFieldSlug(label, used),
                type,
                source: info.source,
                fixed: info.fixed,
            };
            if (af.description && af.description.trim() !== '') f.description = af.description.trim().slice(0, 500);
            if (type === 'select' || type === 'multi_select') {
                const o = airtableOptions(af);
                f.options = o.options;
                f.option_map = o.map;
            }
            if (type === 'currency') f.currency = airtableCurrency(currencySymbol(af), rctx.currency);
            if (type === 'number' || type === 'currency' || type === 'percent') {
                const prec = precisionOf(af);
                if (prec !== undefined) f.precision = prec;
            }
            if (type === 'rating') {
                const max = typeof af.options?.max === 'number' ? af.options.max : 5;
                f.max = Math.min(10, Math.max(1, Math.round(max)));
            }
            if (type === 'phone') f.default_country = rctx.country;
            if (type === 'relation') f.relation_to = info.link_table_id;
            if (type === 'date' || type === 'datetime') {
                const tz = timeZoneOf(af);
                if (tz) f.time_zone = tz;
            }
            if (type === 'autonumber') f.autonumber_max = s?.autonumber_max[af.id] ?? 0;
            if (type === 'file') {
                const st = s?.attachments[af.id];
                if (st) {
                    files += st.files;
                    fileBytes += st.bytes;
                }
            }
            if (isTitle) titleSlug = f.slug;
            // El título va primero (así queda como el primer campo de la lista).
            if (isTitle) fields.unshift(f);
            else fields.push(f);
        }

        if (fields.length > AIRTABLE_MAX_FIELDS_PER_LIST) {
            errors.push(`«${name}» tendría ${fields.length} campos y el máximo es ${AIRTABLE_MAX_FIELDS_PER_LIST}: deja fuera algunos.`);
        }
        const records = s?.records ?? 0;
        out.push({ key: table.id, table_id: table.id, name, title_slug: titleSlug, fields, records, files, file_bytes: fileBytes });
    }

    if (truncated) notes.push(`La base tiene más de ${AIRTABLE_MAX_RECORDS.toLocaleString('es')} registros: se importan los primeros ${AIRTABLE_MAX_RECORDS.toLocaleString('es')}.`);
    const fixedCount = out.reduce((n, l) => n + l.fields.filter((f) => f.fixed).length, 0);
    if (fixedCount > 0) {
        notes.push(
            `${fixedCount} ${fixedCount === 1 ? 'campo es calculado' : 'campos son calculados'} en Airtable (fórmulas, resúmenes, búsquedas o conteos): se trae su valor como dato fijo y no se recalcula.`,
        );
    }

    const records = out.reduce((n, l) => n + l.records, 0);
    const files = out.reduce((n, l) => n + l.files, 0);
    const fileBytes = out.reduce((n, l) => n + l.file_bytes, 0);
    return {
        lists: out,
        folder_name: out.length > 1 ? cleanName(plan.folder_name ?? '', out[0]!.name) : null,
        records,
        files,
        file_bytes: fileBytes,
        errors: [...new Set(errors)],
        notes: [...new Set(notes)],
    };
}
