import { z } from 'zod';
import { idSchema } from './common';
import { isUserWritableType, resolveTitleFieldId, type Field, type FieldType } from './field';

/**
 * A14 — Duplicados: avisar al crear y FUSIONAR (v0.1.445, ADR-S106).
 *
 * Una lista dice qué datos identifican a un registro («reglas»: el correo, el
 * teléfono, el NIT, o el nombre + la ciudad). Dos registros son posibles
 * duplicados si coinciden en TODOS los campos de alguna regla, comparados de
 * forma tolerante: sin mayúsculas, sin tildes, sin puntuación; el teléfono por
 * sus últimos 10 dígitos (con o sin indicativo). Nunca bloquea: avisa. Para
 * que un dato no se pueda repetir está «Sin repetidos».
 *
 * La MISMA normalización corre en JS (lo que se escribe en el alta) y en SQL
 * (lo guardado): `duplicateKey` aquí y `duplicateKeyExpr` en la API, con las
 * mismas tablas de letras (`DUP_FOLD_FROM`/`DUP_FOLD_TO`).
 */

/** Tipos que pueden formar parte de una regla. */
export const DUPLICATE_RULE_FIELD_TYPES: readonly FieldType[] = ['text', 'email', 'phone', 'url', 'number', 'select', 'date'];

export const DUPLICATE_MAX_RULES = 5;
export const DUPLICATE_MAX_RULE_FIELDS = 3;
/** Cuántos registros se fusionan de una vez (el que queda + los demás). */
export const MERGE_MAX_RECORDS = 10;

export function isDuplicateRuleFieldType(type: string): boolean {
    return (DUPLICATE_RULE_FIELD_TYPES as readonly string[]).includes(type);
}

/** Letras con tilde → sin tilde. Mismo orden y largo: lo usa `translate()` en SQL. */
export const DUP_FOLD_FROM = 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ';
export const DUP_FOLD_TO = 'aaaaaaaeeeeeiiiiiooooooouuuuuncyy';

const FOLD_MAP: Record<string, string> = Object.fromEntries([...DUP_FOLD_FROM].map((c, i) => [c, DUP_FOLD_TO[i] ?? c]));

/** Texto comparable: minúsculas, sin tildes, sólo letras y números separados por un espacio. */
export function foldDuplicateText(raw: string): string {
    const lower = raw.toLowerCase();
    let out = '';
    for (const ch of lower) out += FOLD_MAP[ch] ?? ch;
    return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * La forma comparable de un valor. Vacía ('') = no participa (un dato vacío
 * nunca hace a dos registros duplicados).
 */
export function duplicateKey(type: string, value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const s = String(value).trim();
    if (s === '') return '';
    switch (type) {
        case 'email':
            return s.toLowerCase();
        case 'phone': {
            const digits = s.replace(/\D/g, '');
            if (digits.length < 7) return '';
            return digits.length > 10 ? digits.slice(-10) : digits;
        }
        case 'number': {
            const n = Number(s.replace(',', '.'));
            return Number.isFinite(n) ? String(n) : '';
        }
        case 'url':
            return s
                .toLowerCase()
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .replace(/\/+$/, '');
        case 'date':
            return s.slice(0, 10);
        case 'select':
            return s.toLowerCase();
        default:
            return foldDuplicateText(s);
    }
}

/** Separador entre los campos de una regla de varios campos (no aparece en ninguna clave). */
export const DUPLICATE_KEY_SEPARATOR = '\u001f';

/** La clave de un registro para una regla: '' si falta alguno de sus campos. */
export function duplicateRuleKey(rule: readonly number[], fieldsById: ReadonlyMap<number, Pick<Field, 'type'>>, data: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const id of rule) {
        const f = fieldsById.get(id);
        if (!f) return '';
        const k = duplicateKey(f.type, data[`f${id}`]);
        if (k === '') return '';
        parts.push(k);
    }
    return parts.join(DUPLICATE_KEY_SEPARATOR);
}

// ── Ajustes de la lista (`settings.duplicates`) ──────────────────────────────

export const duplicateSettingsInputSchema = z
    .object({
        /** Apagado: ni aviso al crear ni banner en la ficha (el panel sigue buscando). */
        enabled: z.boolean().optional(),
        /** Avisar en el alta cuando lo escrito coincide con un registro. */
        warn_on_create: z.boolean().optional(),
        /** null = volver a las reglas sugeridas. */
        rules: z
            .array(z.object({ fields: z.array(idSchema).min(1).max(DUPLICATE_MAX_RULE_FIELDS) }).strict())
            .max(DUPLICATE_MAX_RULES)
            .nullable()
            .optional(),
    })
    .strict();
export type DuplicateSettingsInput = z.infer<typeof duplicateSettingsInputSchema>;

export interface DuplicateSettings {
    enabled: boolean;
    warn_on_create: boolean;
    /** Cada regla: los ids de campo que tienen que coincidir TODOS. */
    rules: number[][];
    /** false = son las sugeridas (la lista no eligió las suyas). */
    custom: boolean;
}

const LABEL_ID_RE = /\b(nit|rut|ruc|dni|cedula|cédula|documento|identificaci|curp|rfc|cuit|cuil|pasaporte|sku|codigo|código|referencia|placa|serial)/i;

/**
 * Las reglas que se usan si la lista no eligió: cada correo, cada teléfono y
 * cada texto que suena a documento o código; si no hay ninguno, el título.
 */
export function suggestDuplicateRules(
    fields: ReadonlyArray<Pick<Field, 'id' | 'type' | 'label' | 'slug'>>,
    listSettings?: Record<string, unknown> | null,
): number[][] {
    const rules: number[][] = [];
    for (const f of fields) {
        if (rules.length >= DUPLICATE_MAX_RULES) break;
        if (f.type === 'email' || f.type === 'phone') rules.push([f.id]);
        else if (f.type === 'text' && (LABEL_ID_RE.test(f.label) || LABEL_ID_RE.test(f.slug.replace(/_/g, ' ')))) rules.push([f.id]);
    }
    if (rules.length === 0) {
        const title = resolveTitleFieldId(fields as Array<Pick<Field, 'id' | 'type'>>, listSettings ?? null);
        const tf = fields.find((f) => f.id === title);
        if (tf && tf.type === 'text') rules.push([tf.id]);
    }
    return rules;
}

/** Lectura tolerante: reglas con campos que ya no existen o no sirven se descartan. */
export function readDuplicateSettings(
    listSettings: Record<string, unknown> | null | undefined,
    fields: ReadonlyArray<Pick<Field, 'id' | 'type' | 'label' | 'slug'>>,
): DuplicateSettings {
    const raw = (listSettings ?? {}).duplicates;
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const eligible = new Set(fields.filter((f) => isDuplicateRuleFieldType(f.type)).map((f) => f.id));
    const custom = Array.isArray(obj.rules);
    let rules: number[][] = [];
    if (custom) {
        for (const r of obj.rules as unknown[]) {
            const ids = r && typeof r === 'object' && Array.isArray((r as { fields?: unknown }).fields) ? ((r as { fields: unknown[] }).fields as unknown[]) : [];
            const clean = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && eligible.has(n)))].slice(0, DUPLICATE_MAX_RULE_FIELDS);
            if (clean.length > 0) rules.push(clean);
            if (rules.length >= DUPLICATE_MAX_RULES) break;
        }
    } else {
        rules = suggestDuplicateRules(fields, listSettings ?? null);
    }
    return {
        enabled: obj.enabled !== false,
        warn_on_create: obj.warn_on_create !== false,
        rules,
        custom,
    };
}

/** En palabras: «Correo» o «Nombre + Ciudad». */
export function duplicateRuleLabel(rule: readonly number[], fields: ReadonlyArray<Pick<Field, 'id' | 'label'>>): string {
    return rule.map((id) => fields.find((f) => f.id === id)?.label ?? `#${id}`).join(' + ');
}

// ── Pedidos ──────────────────────────────────────────────────────────────────

export const duplicateCheckSchema = z
    .object({
        /** Lo que se está escribiendo, por slug o por `f{id}`. */
        values: z.record(z.string(), z.unknown()),
        /** El registro que se está editando (no se compara consigo mismo). */
        exclude_id: idSchema.optional(),
    })
    .strict();
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const duplicateDismissSchema = z
    .object({ ids: z.array(idSchema).min(2).max(MERGE_MAX_RECORDS) })
    .strict();
export type DuplicateDismissInput = z.infer<typeof duplicateDismissSchema>;

export const MERGE_CHOICE_UNION = 'union' as const;

export const mergePreviewSchema = z
    .object({
        primary_id: idSchema,
        duplicate_ids: z.array(idSchema).min(1).max(MERGE_MAX_RECORDS - 1),
    })
    .strict();
export type MergePreviewInput = z.infer<typeof mergePreviewSchema>;

export const mergeRecordsSchema = mergePreviewSchema
    .extend({
        /** Por id de campo: de qué registro se toma el valor, o «juntar». */
        choices: z.record(z.string(), z.union([idSchema, z.literal(MERGE_CHOICE_UNION)])).optional(),
        /** De qué registro se toma la descripción (por defecto: la primera que tenga). */
        description_from: idSchema.optional(),
    })
    .strict();
export type MergeRecordsInput = z.infer<typeof mergeRecordsSchema>;

// ── Respuestas ───────────────────────────────────────────────────────────────

export interface DuplicateRecordSummary {
    id: number;
    title: string;
    /** Los datos de las reglas, como se ven (para comparar de un vistazo). */
    values: Array<{ label: string; value: string }>;
    updated_at: string;
}

export interface DuplicateMatch {
    id: number;
    title: string;
    /** En qué coincide: «Correo», «Nombre + Ciudad». */
    matched: string[];
}

export interface DuplicateGroup {
    /** Ids del grupo, de menor a mayor (el primero es el más viejo). */
    ids: number[];
    matched: string[];
    records: DuplicateRecordSummary[];
}

export interface DuplicateGroupsPage {
    groups: DuplicateGroup[];
    /** Grupos encontrados (los marcados «no son duplicados» no cuentan). */
    total: number;
    /** Hay más de los que se buscaron (lista muy grande): se muestran los primeros. */
    truncated: boolean;
    settings: DuplicateSettings;
    /** Reglas que no se aplicaron porque usan un campo que esta persona no ve. */
    hidden_rules: number;
}

export interface MergeFieldPreview {
    field_id: number;
    label: string;
    type: FieldType;
    /** Valor guardado por registro (en el orden de `records`); la pantalla lo muestra como en la ficha. */
    values: unknown[];
    /** Elección sugerida: el id del registro o «juntar». */
    suggested: number | typeof MERGE_CHOICE_UNION;
    /** Si se puede juntar (varias opciones, archivos, equipos). */
    can_union: boolean;
    /** Si los valores son distintos (los iguales se muestran plegados). */
    differs: boolean;
}

export interface MergeMoveSummary {
    key: string;
    label: string;
    count: number;
}

export interface MergePreview {
    records: Array<{ id: number; title: string; created_at: string; updated_at: string; has_description: boolean }>;
    fields: MergeFieldPreview[];
    /** Lo que pasa al registro que queda (comentarios, archivos, vínculos…). */
    moves: MergeMoveSummary[];
    /** Por qué no se puede fusionar (vacío = se puede). */
    blockers: string[];
    warnings: string[];
}

export interface MergeResult {
    primary_id: number;
    merged_ids: number[];
    moved: MergeMoveSummary[];
    /** Para «Deshacer» (historial de ediciones masivas). */
    edit_id: number | null;
    warnings: string[];
}

// ── Elegir valores al fusionar ───────────────────────────────────────────────

/** Tipos cuyos valores se pueden JUNTAR (en vez de elegir uno). */
export function mergeCanUnion(type: string, config?: Record<string, unknown> | null): boolean {
    if (type === 'multi_select' || type === 'file') return true;
    if (type === 'team') return (config ?? {}).multiple === true;
    return false;
}

export function isMergeableFieldType(type: string): boolean {
    return isUserWritableType(type as FieldType);
}

function isEmptyValue(v: unknown): boolean {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Lo que se sugiere: juntar si el tipo lo permite y hay 2+ valores distintos;
 * si no, el del registro que queda; si está vacío, el primero que tenga algo.
 * `values[i]` corresponde a `ids[i]` (el primero es el que queda).
 */
export function mergeSuggestedChoice(
    type: string,
    config: Record<string, unknown> | null | undefined,
    ids: readonly number[],
    values: readonly unknown[],
): number | typeof MERGE_CHOICE_UNION {
    const filled = values.map((v, i) => ({ v, id: ids[i]! })).filter((x) => !isEmptyValue(x.v));
    if (mergeCanUnion(type, config)) {
        const distinct = filled.filter((x, i) => filled.findIndex((y) => sameValue(y.v, x.v)) === i);
        if (distinct.length >= 2) return MERGE_CHOICE_UNION;
    }
    return filled[0]?.id ?? ids[0]!;
}

export function mergeValuesDiffer(values: readonly unknown[]): boolean {
    const filled = values.filter((v) => !isEmptyValue(v));
    return filled.some((v) => !sameValue(v, filled[0]));
}

/**
 * El valor que queda. «Juntar» une sin repetir (archivos respetando el máximo
 * del campo, el primero el del registro que queda).
 */
export function mergeResolveValue(
    type: string,
    config: Record<string, unknown> | null | undefined,
    ids: readonly number[],
    values: readonly unknown[],
    choice: number | typeof MERGE_CHOICE_UNION | undefined,
): unknown {
    if (choice === MERGE_CHOICE_UNION && mergeCanUnion(type, config)) {
        const out: unknown[] = [];
        const seen = new Set<string>();
        for (const v of values) {
            if (!Array.isArray(v)) continue;
            for (const item of v) {
                const k = JSON.stringify(item);
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(item);
            }
        }
        const max = type === 'file' ? Number((config ?? {}).max_files) : NaN;
        return Number.isInteger(max) && max > 0 ? out.slice(0, max) : out;
    }
    const idx = typeof choice === 'number' ? ids.indexOf(choice) : -1;
    if (idx >= 0) return values[idx] ?? null;
    return values[0] ?? null;
}
