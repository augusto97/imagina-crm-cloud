import { foldSearchText } from '../field-types/search';
import { parseCustomDateRange, parseDateRangePreset } from '../field-types/date-ranges';
import type { FilterCondition, FilterGroup, FilterNode, FilterOperator } from './filter';

/**
 * v0.1.468 — «Mostrar sólo los ítems que…» de la tabla de ítems de un
 * documento (ADR-S35, addendum).
 *
 * El filtro se guarda como un árbol de filtros de la tabla (por `field_id`:
 * renombrar un campo de la lista de los ítems no lo rompe) y el servidor lo
 * compila con el QueryBuilder — en SQL, sobre los campos que ve quien genera.
 *
 * Esta función lo LIMPIA antes de usarlo, con la misma regla en el navegador
 * (avisos del editor) y en el servidor (el PDF): una regla rota —un campo
 * borrado, un campo que quien genera no ve, una comparación que ya no aplica
 * al tipo del campo, un valor que no sirve, opciones que ya no existen— se
 * QUITA y queda un aviso; el resto del filtro sigue funcionando. Nunca lanza.
 */

export interface DocFilterField {
    id: number;
    type: string;
    slug?: string | null;
    label?: string | null;
    /** Las opciones de una selección viven en `config.options`. */
    config?: unknown;
    /** Fórmula: el tipo de su resultado (si viene en el DTO). */
    formula?: { result_type?: string | null } | null;
}

export type DocFilterIssueReason =
    | 'malformed'
    | 'missing_field'
    | 'hidden_field'
    | 'not_filterable'
    | 'bad_operator'
    | 'bad_value'
    | 'unknown_option'
    | 'too_big';

export interface DocFilterIssue {
    reason: DocFilterIssueReason;
    field_id: number | null;
    /** Etiqueta del campo (o null si ya no existe). */
    field_label: string | null;
    message: string;
}

export interface CleanDocFilterOptions {
    /** Campos que quien genera no ve: sus reglas no se aplican. */
    hiddenIds?: ReadonlySet<number> | readonly number[];
    /**
     * El servidor sabe si un campo derivado (rollup, lookup, fórmula…) tiene
     * expresión SQL. `false` = no se puede filtrar por él.
     */
    canFilter?: (field: DocFilterField) => boolean;
}

export interface CleanDocFilterResult {
    /** El árbol listo para compilar (null = sin filtro). */
    tree: FilterGroup | null;
    issues: DocFilterIssue[];
}

const TEXT_OPS: readonly FilterOperator[] = ['contains', 'not_contains', 'eq', 'neq', 'starts_with', 'ends_with', 'is_null', 'is_not_null'];
const NUMBER_OPS: readonly FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
const DATE_OPS: readonly FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between_relative', 'is_null', 'is_not_null'];
const CHOICE_OPS: readonly FilterOperator[] = ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'];
const PRESENCE_OPS: readonly FilterOperator[] = ['is_null', 'is_not_null'];
const RELATION_OPS: readonly FilterOperator[] = ['in', 'nin', 'is_null', 'is_not_null'];

type ValueKind = 'text' | 'number' | 'date' | 'choice' | 'boolean' | 'id' | 'none';

interface TypeRule {
    ops: readonly FilterOperator[];
    value: ValueKind;
}

/** Qué comparaciones y qué valores acepta cada tipo (espejo de `operatorsForType` del front). */
function ruleFor(field: DocFilterField): TypeRule | null {
    switch (field.type) {
        case 'text':
        case 'long_text':
        case 'email':
        case 'url':
        case 'phone':
        case 'ai':
        case 'autonumber':
        case 'lookup':
            return { ops: TEXT_OPS, value: 'text' };
        case 'number':
        case 'currency':
        case 'rating':
        case 'percent':
        case 'duration':
        case 'time_tracked':
        case 'checklist_progress':
        case 'computed':
        case 'rollup':
            return { ops: NUMBER_OPS, value: 'number' };
        case 'date':
        case 'datetime':
        case 'created_at':
        case 'updated_at':
            return { ops: DATE_OPS, value: 'date' };
        case 'select':
        case 'multi_select':
        case 'approval':
            return { ops: CHOICE_OPS, value: 'choice' };
        case 'checkbox':
            return { ops: ['eq'], value: 'boolean' };
        case 'user':
        case 'team':
            return { ops: CHOICE_OPS, value: 'id' };
        case 'created_by':
        case 'updated_by':
            return { ops: ['eq', 'neq', 'in', 'nin'], value: 'id' };
        case 'file':
            return { ops: PRESENCE_OPS, value: 'none' };
        case 'relation':
            return { ops: RELATION_OPS, value: 'id' };
        case 'formula': {
            switch (field.formula?.result_type) {
                case 'text':
                    return { ops: TEXT_OPS, value: 'text' };
                case 'date':
                case 'datetime':
                    return { ops: DATE_OPS, value: 'date' };
                case 'checkbox':
                    return { ops: ['eq'], value: 'boolean' };
                case undefined:
                case null:
                    // Sin el tipo del resultado: se acepta lo que el servidor
                    // sepa compilar (el valor se valida como texto o número).
                    return { ops: [...new Set([...NUMBER_OPS, ...TEXT_OPS])], value: 'text' };
                default:
                    return { ops: NUMBER_OPS, value: 'number' };
            }
        }
        default:
            // «Botón» y tipos desconocidos no tienen valor que filtrar.
            return null;
    }
}

/** Las comparaciones que admite un campo en el filtro de los ítems. */
export function docFilterOpsFor(field: DocFilterField): readonly FilterOperator[] {
    return ruleFor(field)?.ops ?? [];
}

/** Las opciones de una selección (valor y etiqueta). */
export function docFilterFieldOptions(field: Pick<DocFilterField, 'config'>): Array<{ value: string; label: string }> {
    const raw = (field.config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(raw)) return [];
    const out: Array<{ value: string; label: string }> = [];
    for (const o of raw) {
        if (!o || typeof o !== 'object') continue;
        const value = (o as { value?: unknown }).value;
        const label = (o as { label?: unknown }).label;
        if (typeof value !== 'string' || value === '') continue;
        out.push({ value, label: typeof label === 'string' && label !== '' ? label : value });
    }
    return out;
}

const NULLARY = new Set<FilterOperator>(['is_null', 'is_not_null']);
const MAX_DEPTH = 5;
const MAX_NODES = 200;
const MAX_LIST = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isScalar(v: unknown): v is string | number | boolean {
    return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';
}

function validDate(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!DATE_RE.test(s)) return null;
    const ymd = s.slice(0, 10);
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    if (s.length > 10 && Number.isNaN(Date.parse(s.length === 16 ? `${s}:00` : s))) return null;
    return s;
}

function asNumber(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function asBoolean(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === 'true' || v === '1') return true;
    if (v === 0 || v === 'false' || v === '0') return false;
    return null;
}

function asId(v: unknown): number | string | null {
    if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
    if (typeof v === 'string') {
        const s = v.trim();
        if (/^\d+$/.test(s)) return Number(s) > 0 ? Number(s) : null;
        // `$my_teams`: «uno de mis equipos», lo resuelve el servidor.
        return /^\$[a-z_]{2,20}$/.test(s) ? s : null;
    }
    return null;
}

type Outcome =
    | { ok: true; value: unknown; dropped?: number }
    | { ok: false; reason: 'bad_value' | 'unknown_option' };

/** Valida (y normaliza) el valor de una condición según el tipo del campo. */
function cleanValue(field: DocFilterField, kind: ValueKind, op: FilterOperator, value: unknown): Outcome {
    if (NULLARY.has(op)) return { ok: true, value: undefined };
    if (op === 'between_relative') {
        if (parseDateRangePreset(value) !== null) return { ok: true, value };
        const custom = parseCustomDateRange(value);
        return custom !== null && custom !== 'invalid' ? { ok: true, value: custom } : { ok: false, reason: 'bad_value' };
    }
    const many = op === 'in' || op === 'nin';
    if (kind === 'choice') {
        const options = docFilterFieldOptions(field);
        const map = (raw: unknown): string | null => {
            if (!isScalar(raw)) return null;
            const s = String(raw);
            if (options.length === 0) return s.trim() === '' ? null : s;
            const exact = options.find((o) => o.value === s);
            if (exact) return exact.value;
            const folded = foldSearchText(s).trim();
            return options.find((o) => foldSearchText(o.label).trim() === folded || foldSearchText(o.value).trim() === folded)?.value ?? null;
        };
        if (many) {
            const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
            if (list.length === 0) return { ok: false, reason: 'bad_value' };
            const kept = [...new Set(list.slice(0, MAX_LIST).map(map).filter((v): v is string => v !== null))];
            if (kept.length === 0) return { ok: false, reason: 'unknown_option' };
            return { ok: true, value: kept, dropped: list.length - kept.length };
        }
        if (Array.isArray(value)) return { ok: false, reason: 'bad_value' };
        const one = map(value);
        return one === null ? { ok: false, reason: options.length > 0 && isScalar(value) ? 'unknown_option' : 'bad_value' } : { ok: true, value: one };
    }
    if (many) {
        const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
        const clean = list.slice(0, MAX_LIST).map((v) => (kind === 'id' ? asId(v) : isScalar(v) ? v : null)).filter((v) => v !== null);
        return clean.length === 0 ? { ok: false, reason: 'bad_value' } : { ok: true, value: clean };
    }
    switch (kind) {
        case 'number': {
            const n = asNumber(value);
            return n === null ? { ok: false, reason: 'bad_value' } : { ok: true, value: n };
        }
        case 'date': {
            const d = validDate(value);
            return d === null ? { ok: false, reason: 'bad_value' } : { ok: true, value: d };
        }
        case 'boolean': {
            const b = asBoolean(value);
            return b === null ? { ok: false, reason: 'bad_value' } : { ok: true, value: b };
        }
        case 'id': {
            const id = asId(value);
            return id === null ? { ok: false, reason: 'bad_value' } : { ok: true, value: id };
        }
        case 'text': {
            if (!isScalar(value)) return { ok: false, reason: 'bad_value' };
            const s = String(value);
            if (s.trim() === '') return { ok: false, reason: 'bad_value' };
            return { ok: true, value: typeof value === 'string' ? value.slice(0, 500) : value };
        }
        default:
            return { ok: false, reason: 'bad_value' };
    }
}

function issueMessage(reason: DocFilterIssueReason, label: string | null): string {
    const f = label ? `«${label}»` : 'un campo';
    switch (reason) {
        case 'missing_field':
            return 'Una regla del filtro usa un campo que ya no existe: se ignora.';
        case 'hidden_field':
            return `La regla sobre ${f} no se aplica: quien genera el documento no puede ver ese campo.`;
        case 'not_filterable':
            return `${label ? `«${label}»` : 'Ese campo'} no se puede usar para filtrar: esa regla se ignora.`;
        case 'bad_operator':
            return `La regla sobre ${f} usa una comparación que no aplica a ese tipo de campo: se ignora.`;
        case 'bad_value':
            return `La regla sobre ${f} no tiene un valor válido: se ignora.`;
        case 'unknown_option':
            return `La regla sobre ${f} usa opciones que ya no existen: se ignora.`;
        case 'too_big':
            return 'El filtro tiene demasiadas reglas: se ignoran las que sobran.';
        case 'malformed':
        default:
            return 'Una parte del filtro está mal armada: se ignora.';
    }
}

/**
 * Limpia el filtro de una tabla de ítems contra los campos de la lista de los
 * ítems. Lo que no se puede aplicar se quita y queda un aviso.
 */
export function cleanDocItemsFilter(
    raw: unknown,
    fields: readonly DocFilterField[],
    opts: CleanDocFilterOptions = {},
): CleanDocFilterResult {
    const issues: DocFilterIssue[] = [];
    if (raw === null || raw === undefined) return { tree: null, issues };
    const byId = new Map(fields.map((f) => [f.id, f]));
    const hidden = opts.hiddenIds instanceof Set ? opts.hiddenIds : new Set(opts.hiddenIds ?? []);
    let nodes = 0;
    const add = (reason: DocFilterIssueReason, field: DocFilterField | null, fieldId: number | null): void => {
        const label = field?.label?.trim() || field?.slug || null;
        issues.push({ reason, field_id: fieldId, field_label: label, message: issueMessage(reason, label) });
    };

    const cleanCondition = (c: Record<string, unknown>): FilterCondition | null => {
        const fieldId = typeof c.field_id === 'number' ? c.field_id : Number(c.field_id);
        if (!Number.isInteger(fieldId) || fieldId <= 0) {
            add('malformed', null, null);
            return null;
        }
        const field = byId.get(fieldId);
        if (!field) {
            add('missing_field', null, fieldId);
            return null;
        }
        if (hidden.has(fieldId)) {
            add('hidden_field', field, fieldId);
            return null;
        }
        const rule = ruleFor(field);
        if (!rule || (opts.canFilter && !opts.canFilter(field))) {
            add('not_filterable', field, fieldId);
            return null;
        }
        const op = c.op as FilterOperator;
        if (typeof op !== 'string' || !rule.ops.includes(op)) {
            add('bad_operator', field, fieldId);
            return null;
        }
        const out = cleanValue(field, rule.value, op, c.value);
        if (!out.ok) {
            add(out.reason, field, fieldId);
            return null;
        }
        if (out.dropped && out.dropped > 0) {
            const label = field.label?.trim() || field.slug || null;
            issues.push({
                reason: 'unknown_option',
                field_id: fieldId,
                field_label: label,
                message: `En la regla sobre ${label ? `«${label}»` : 'un campo'} se quitaron opciones que ya no existen.`,
            });
        }
        const cond: FilterCondition = { type: 'condition', field_id: fieldId, op };
        if (out.value !== undefined) cond.value = out.value;
        return cond;
    };

    const walk = (node: unknown, depth: number): FilterNode | null => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            add('malformed', null, null);
            return null;
        }
        const n = node as Record<string, unknown>;
        if (nodes >= MAX_NODES) {
            if (!issues.some((i) => i.reason === 'too_big')) add('too_big', null, null);
            return null;
        }
        if (n.type === 'condition') {
            nodes++;
            return cleanCondition(n);
        }
        if (n.type === 'group' && Array.isArray(n.children)) {
            if (depth > MAX_DEPTH) {
                add('malformed', null, null);
                return null;
            }
            nodes++;
            const children = n.children.map((ch) => walk(ch, depth + 1)).filter((ch): ch is FilterNode => ch !== null);
            if (children.length === 0) return null;
            return { type: 'group', logic: n.logic === 'or' ? 'or' : 'and', children };
        }
        add('malformed', null, null);
        return null;
    };

    // Una condición suelta en la raíz se lee como un grupo «todas».
    const root =
        raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { type?: unknown }).type === 'condition'
            ? { type: 'group', logic: 'and', children: [raw] }
            : raw;
    const out = walk(root, 1);
    const tree: FilterGroup | null = out === null ? null : out.type === 'group' ? out : { type: 'group', logic: 'and', children: [out] };
    return { tree, issues };
}

/** Cuántas condiciones tiene el filtro (para el resumen del editor). */
export function docItemsFilterCount(tree: FilterNode | null | undefined): number {
    if (!tree) return 0;
    if (tree.type === 'condition') return 1;
    return tree.children.reduce((sum, c) => sum + docItemsFilterCount(c), 0);
}
