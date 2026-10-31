import { coerceTextToFieldValue, normalizeDateString, parseNumberText } from '../field-types/text-coercion';
import { foldImportValue as fold } from './profile';
import {
    FILE_IMPORT_MAX_LISTS,
    type FileImportDateOrder,
    type FileImportField,
    type FileImportFieldType,
    type FileImportNumberFormat,
    type FileImportOption,
    type FileImportPlan,
    type FileImportSheetProfile,
} from './schema';

/**
 * v0.1.339 (ADR-S88) — Del PLAN revisado a lo que se crea: qué listas, con
 * qué campos (incluidos los vínculos) y de dónde sale cada valor. La MISMA
 * función arma la vista previa del navegador y la creación del servidor: lo
 * que la persona aprueba es literalmente lo que se crea. Puro.
 */

export type ResolvedImportFieldType = FileImportFieldType | 'relation';

export interface ResolvedImportField {
    /** Columna de la hoja de donde sale el valor (en un vínculo, el texto que nombra al otro registro). */
    column: number;
    label: string;
    slug: string;
    type: ResolvedImportFieldType;
    options?: FileImportOption[];
    currency?: string;
    precision?: number;
    default_country?: string;
    date_order?: FileImportDateOrder;
    number_format?: FileImportNumberFormat;
    is_unique?: boolean;
    format?: FileImportField['format'];
    /** Calificación: cuántas estrellas. */
    max?: number;
    /** Porcentaje escrito como fracción (0,75 → 75). */
    percent_scale?: number;
    /** Vínculo: la `key` de la lista destino. */
    relation_to?: string;
}

export type ResolvedImportSource = { kind: 'sheet'; sheet: number } | { kind: 'entity'; sheet: number; key_column: number };

export interface ResolvedImportList {
    key: string;
    name: string;
    icon?: string;
    color?: string;
    source: ResolvedImportSource;
    title_slug: string;
    skip_duplicates: boolean;
    fields: ResolvedImportField[];
    /** Registros que crearía (estimado sobre el archivo). */
    records: number;
}

export interface ResolvedImportPlan {
    lists: ResolvedImportList[];
    folder_name: string | null;
    records: number;
    /** Lo que impide crear (en lenguaje claro). */
    errors: string[];
    /** Avisos que no impiden crear. */
    notes: string[];
}

const TEXT_TYPES = new Set<ResolvedImportFieldType>(['text', 'long_text']);

export function resolveFileImportPlan(plan: FileImportPlan, sheets: readonly FileImportSheetProfile[]): ResolvedImportPlan {
    const errors: string[] = [];
    const notes: string[] = [];
    const sheetOf = new Map(sheets.map((s) => [s.index, s]));
    const included = plan.lists.filter((l) => l.include);
    if (included.length === 0) errors.push('Elige al menos una hoja para crear la lista.');

    const keys = new Map<string, string>();
    const claimKey = (key: string, name: string): void => {
        const prev = keys.get(key);
        if (prev !== undefined) errors.push(`«${prev}» y «${name}» usan la misma clave interna «${key}»: cámbiale el nombre a una.`);
        else keys.set(key, name);
    };
    const names = new Map<string, string>();
    const claimName = (name: string): void => {
        const k = fold(name);
        if (names.has(k)) errors.push(`Dos listas se llaman «${name}»: cámbiale el nombre a una.`);
        else names.set(k, name);
    };

    const includedKeys = new Set(included.map((l) => l.key));
    const entities = plan.entities.filter((e) => e.include && included.some((l) => l.sheet === e.sheet));
    for (const e of entities) includedKeys.add(e.key);
    const totalLists = included.length + entities.length;
    if (totalLists > FILE_IMPORT_MAX_LISTS) {
        errors.push(`Se crearían ${totalLists} listas y el máximo de una vez es ${FILE_IMPORT_MAX_LISTS}: deja fuera alguna hoja o alguna lista separada.`);
    }

    const out: ResolvedImportList[] = [];
    for (const list of included) {
        const profile = sheetOf.get(list.sheet);
        if (!profile) {
            errors.push(`La hoja de «${list.name}» no está en el archivo.`);
            continue;
        }
        claimKey(list.key, list.name);
        claimName(list.name);
        const width = profile.headers.length;
        const byColumn = new Map<number, FileImportField>();
        for (const f of list.fields) {
            if (f.column >= width) {
                errors.push(`«${list.name}»: el campo «${f.label}» apunta a una columna que no existe.`);
                continue;
            }
            if (byColumn.has(f.column)) errors.push(`«${list.name}»: la columna «${profile.headers[f.column]}» aparece dos veces.`);
            byColumn.set(f.column, f);
        }

        const sheetEntities = entities.filter((e) => e.sheet === list.sheet);
        const sheetLinks = plan.links.filter((l) => l.include && l.sheet === list.sheet);
        const moved = new Set<number>();
        const relationAt = new Map<number, { label: string; slug: string; to: string }>();

        for (const e of sheetEntities) {
            const keyField = byColumn.get(e.key_column);
            if (!keyField || !keyField.include) {
                errors.push(`«${e.name}» sale de la columna «${profile.headers[e.key_column] ?? '?'}», que está descartada: inclúyela o deja «${e.name}» dentro de «${list.name}».`);
                continue;
            }
            if (e.key_column === list.title_column) {
                errors.push(`«${list.name}»: la columna del título no puede pasar a «${e.name}».`);
                continue;
            }
            if (relationAt.has(e.key_column)) {
                errors.push(`«${list.name}»: la columna «${profile.headers[e.key_column]}» no puede vincularse con dos listas.`);
                continue;
            }
            relationAt.set(e.key_column, { label: e.link_label, slug: e.link_slug, to: e.key });
            for (const c of e.columns) {
                if (c === list.title_column) {
                    errors.push(`«${list.name}»: la columna del título no puede pasar a «${e.name}».`);
                    continue;
                }
                if (c === e.key_column) continue;
                if (moved.has(c)) errors.push(`«${list.name}»: la columna «${profile.headers[c]}» no puede pasar a dos listas.`);
                moved.add(c);
            }
        }
        for (const link of sheetLinks) {
            const f = byColumn.get(link.column);
            if (!f || !f.include) continue;
            if (!includedKeys.has(link.to)) {
                notes.push(`«${f.label}» queda como texto en «${list.name}»: la lista con la que se vinculaba no se va a crear.`);
                continue;
            }
            if (link.to === list.key) continue;
            if (link.column === list.title_column) {
                errors.push(`«${list.name}»: la columna del título no puede ser un vínculo.`);
                continue;
            }
            if (relationAt.has(link.column) || moved.has(link.column)) {
                errors.push(`«${list.name}»: la columna «${f.label}» no puede vincularse con dos listas.`);
                continue;
            }
            relationAt.set(link.column, { label: f.label, slug: f.slug, to: link.to });
        }

        // El título.
        const title = byColumn.get(list.title_column);
        let titleSlug = '';
        if (!title) errors.push(`«${list.name}»: falta la columna que hace de título.`);
        else if (!title.include) errors.push(`«${list.name}»: «${title.label}» hace de título y no se puede descartar.`);
        else if (!TEXT_TYPES.has(title.type)) errors.push(`«${list.name}»: el título tiene que ser una columna de texto («${title.label}» no lo es).`);
        else titleSlug = title.slug;

        const fields: ResolvedImportField[] = [];
        for (const f of list.fields) {
            if (!f.include || moved.has(f.column) || f.column >= width) continue;
            const rel = relationAt.get(f.column);
            if (rel) {
                fields.push({ column: f.column, label: rel.label, slug: rel.slug, type: 'relation', relation_to: rel.to });
                continue;
            }
            fields.push(resolveField(f, profile));
        }
        checkFields(list.name, fields, errors);

        const records = Math.max(0, profile.rows - (list.skip_duplicates ? profile.duplicate_rows : 0));
        out.push({
            key: list.key,
            name: list.name,
            icon: list.icon,
            color: list.color,
            source: { kind: 'sheet', sheet: list.sheet },
            title_slug: titleSlug,
            skip_duplicates: list.skip_duplicates,
            fields,
            records,
        });

        // Las listas separadas de esta hoja.
        for (const e of sheetEntities) {
            const keyField = byColumn.get(e.key_column);
            if (!keyField || !keyField.include || relationAt.get(e.key_column)?.to !== e.key) continue;
            claimKey(e.key, e.name);
            claimName(e.name);
            const used = new Set<string>();
            const titleLabel = keyField.type === 'text' || keyField.type === 'select' ? 'Nombre' : keyField.label;
            const titleField: ResolvedImportField = { column: e.key_column, label: titleLabel, slug: takeSlug(titleLabel === 'Nombre' ? 'nombre' : keyField.slug, used), type: 'text' };
            const efields: ResolvedImportField[] = [titleField];
            for (const c of e.columns) {
                if (c === e.key_column || c === list.title_column) continue;
                const f = byColumn.get(c);
                if (!f || !f.include) continue;
                const r = resolveField(f, profile);
                r.slug = takeSlug(r.slug, used);
                efields.push(r);
            }
            checkFields(e.name, efields, errors);
            out.push({
                key: e.key,
                name: e.name,
                icon: e.icon,
                color: e.color,
                source: { kind: 'entity', sheet: e.sheet, key_column: e.key_column },
                title_slug: titleField.slug,
                skip_duplicates: true,
                fields: efields,
                records: e.records,
            });
        }
    }

    const records = out.reduce((n, l) => n + l.records, 0);
    return {
        lists: out,
        folder_name: out.length > 1 ? (plan.folder_name?.trim() || out[0]!.name) : null,
        records,
        errors: [...new Set(errors)],
        notes: [...new Set(notes)],
    };
}

function takeSlug(slug: string, used: Set<string>): string {
    let s = slug;
    let n = 2;
    while (used.has(s)) s = `${slug.slice(0, 58)}_${n++}`;
    used.add(s);
    return s;
}

function resolveField(f: FileImportField, profile: FileImportSheetProfile): ResolvedImportField {
    const col = profile.columns[f.column];
    const r: ResolvedImportField = { column: f.column, label: f.label, slug: f.slug, type: f.type };
    if ((f.type === 'select' || f.type === 'multi_select') && f.options) r.options = f.options;
    if (f.type === 'currency') r.currency = f.currency ?? 'COP';
    if ((f.type === 'currency' || f.type === 'number' || f.type === 'percent') && f.precision !== undefined) r.precision = f.precision;
    if (f.type === 'currency' || f.type === 'number' || f.type === 'percent' || f.type === 'rating') r.number_format = f.number_format ?? col?.number_format;
    if (f.type === 'date' || f.type === 'datetime') r.date_order = f.date_order ?? col?.date_order;
    if (f.type === 'phone') r.default_country = f.default_country ?? 'CO';
    if (f.type === 'text' && f.format) r.format = f.format;
    if (f.is_unique && (f.type === 'text' || f.type === 'email' || f.type === 'phone' || f.type === 'number')) r.is_unique = true;
    if (f.type === 'rating') r.max = col?.numeric && col.numeric.max > 5 ? 10 : 5;
    if (f.type === 'percent' && col?.numeric && col.numeric.max <= 1 && !col.numeric.integers && !col.samples.some((s) => s.includes('%'))) {
        r.percent_scale = 100;
    }
    return r;
}

function checkFields(listName: string, fields: readonly ResolvedImportField[], errors: string[]): void {
    const slugs = new Set<string>();
    for (const f of fields) {
        if (slugs.has(f.slug)) errors.push(`«${listName}»: dos campos usan el nombre interno «${f.slug}»: cámbiale el nombre a uno.`);
        slugs.add(f.slug);
        if ((f.type === 'select' || f.type === 'multi_select') && (!f.options || f.options.length === 0)) {
            errors.push(`«${listName}» → «${f.label}»: agrega al menos una opción o cambia el tipo.`);
        }
        if (f.options) {
            const values = new Set<string>();
            for (const o of f.options) {
                if (values.has(o.value)) errors.push(`«${listName}» → «${f.label}»: la opción «${o.label}» está repetida.`);
                values.add(o.value);
            }
        }
    }
    if (fields.length > 60) errors.push(`«${listName}» tendría ${fields.length} campos y el máximo es 60: descarta algunas columnas.`);
}

// ── De la celda al valor ──────────────────────────────────────────────────

export interface FileImportCellOptions {
    /** Zona de la empresa: una fecha y hora sin zona se lee en su reloj. */
    timeZone?: string;
}

/**
 * Lee una celda del archivo para un campo del plan. Devuelve el valor en la
 * forma que espera `validateFieldValue` (o `null` si está vacía). Las opciones
 * se reconocen por su etiqueta, su valor o cualquiera de sus formas del
 * archivo, sin mayúsculas ni acentos.
 */
export function makeFileImportCellReader(field: ResolvedImportField, opts: FileImportCellOptions = {}): (raw: string) => unknown {
    const nf = field.number_format;
    switch (field.type) {
        case 'select':
        case 'multi_select': {
            const lookup = new Map<string, string>();
            for (const o of field.options ?? []) {
                for (const form of [o.label, o.value, ...o.aliases]) lookup.set(fold(form), o.value);
            }
            const one = (v: string): string | null => {
                const t = v.trim();
                if (t === '') return null;
                return lookup.get(fold(t)) ?? t;
            };
            if (field.type === 'select') return (raw) => one(raw);
            return (raw) => {
                if (raw.trim() === '') return null;
                const exact = lookup.get(fold(raw));
                if (exact) return [exact];
                const vals = raw.split(/[,;\n]/).map(one).filter((v): v is string => v !== null);
                return vals.length === 0 ? null : [...new Set(vals)];
            };
        }
        case 'number':
        case 'currency':
            return (raw) => (raw.trim() === '' ? null : (parseNumberText(raw, nf) ?? raw.trim()));
        case 'percent':
            return (raw) => {
                const t = raw.trim();
                if (t === '') return null;
                const n = parseNumberText(t.replace(/%/g, ''), nf);
                if (n === null) return t;
                return field.percent_scale && !t.includes('%') ? Math.round(n * field.percent_scale * 10000) / 10000 : n;
            };
        case 'rating':
            return (raw) => {
                const v = coerceTextToFieldValue(raw, { type: 'rating', config: {} }, { numberFormat: nf });
                return typeof v === 'number' ? Math.round(v) : v;
            };
        case 'date':
        case 'datetime':
            return (raw) => (raw.trim() === '' ? null : normalizeDateString(raw.trim(), field.type as 'date' | 'datetime', { dateFormat: field.date_order, timeZone: opts.timeZone }));
        case 'checkbox':
            return (raw) => (raw.trim() === '' ? null : coerceTextToFieldValue(raw, { type: 'checkbox', config: {} }));
        case 'url':
            return (raw) => {
                const t = raw.trim();
                if (t === '') return null;
                return /^www\./i.test(t) ? `https://${t}` : t;
            };
        default:
            return (raw) => (raw.trim() === '' ? null : raw.trim());
    }
}
