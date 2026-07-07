export interface RecordEntity {
    id: number;
    fields: Record<string, unknown>;
    relations: Record<string, number[]>;
    created_by: number;
    created_at: string;
    updated_at: string;
}

export interface RecordListMeta {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
}

export interface RecordListResponse {
    data: RecordEntity[];
    meta: RecordListMeta;
}

export type FilterOperator =
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'in'
    | 'nin'
    | 'is_null'
    | 'is_not_null'
    /**
     * Rango relativo dinámico aplicable a campos `date`/`datetime`.
     * El `value` es el slug del preset (`this_month`, `last_30_days`,
     * etc., ver `dateRangePresets.ts`). El backend
     * (`QueryBuilder::compileFilter`) lo resuelve a `[from, to]` con
     * `wp_timezone()` cada vez que la query se ejecuta — así "este
     * mes" sigue apuntando a este mes la próxima vez que se carga el
     * dashboard, no a las fechas fijas de cuando se guardó.
     */
    | 'between_relative';

export interface RecordsQuery {
    page?: number;
    per_page?: number;
    sort?: string;
    search?: string;
    fields?: string;
    /**
     * Forma plana (legacy / atajo): `{ field_<id>: { op: value } }`. El
     * backend la trata como un grupo AND raíz. Mantenida para retro-
     * compat de SavedViews antiguos. Para nuevos usos preferir
     * `filter_tree`.
     */
    filter?: Record<string, Partial<Record<FilterOperator, unknown>> | unknown>;
    /**
     * Árbol completo de filtros. En la URL viaja como JSON-encoded
     * string (lo serializa `buildRecordsQuery`). El backend acepta
     * tanto el string como el array ya decodificado por WP REST y lo
     * prioriza sobre `filter` cuando ambos vienen.
     */
    filter_tree?: FilterTree | string;
}

/**
 * Boolean logic entre los hijos de un grupo de filtros. Lo mostramos
 * en la UI como conector "Y" (and) o "O" (or) entre rows.
 */
export type FilterLogic = 'and' | 'or';

/**
 * Una condición concreta sobre un campo (= una fila del panel de
 * filtros). El triple `(field_id, op, value)` se compila a una
 * cláusula SQL en el backend.
 *
 * El operador `is_null`/`is_not_null` ignora `value` (por convención
 * lo dejamos `null`).
 */
export interface FilterCondition {
    type: 'condition';
    field_id: number;
    op: FilterOperator;
    value: unknown;
}

/**
 * Un grupo combina hijos (condiciones u otros grupos) bajo una
 * lógica AND u OR. Los grupos pueden anidarse — eso permite expresar
 * `(A AND B) OR (C AND D)`, igual que ClickUp.
 */
export interface FilterGroup {
    type: 'group';
    logic: FilterLogic;
    children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

/**
 * El root del árbol siempre es un grupo (puede estar vacío). La UI
 * empieza con un grupo AND vacío y va agregando filas/grupos bajo él.
 */
export type FilterTree = FilterGroup;

export const EMPTY_FILTER_TREE: FilterTree = {
    type: 'group',
    logic: 'and',
    children: [],
};

export function isConditionNode(node: FilterNode): node is FilterCondition {
    return node.type === 'condition';
}

export function isGroupNode(node: FilterNode): node is FilterGroup {
    return node.type === 'group';
}

export function isEmptyTree(tree: FilterTree): boolean {
    return tree.children.length === 0;
}

export function countConditions(node: FilterNode): number {
    if (node.type === 'condition') return 1;
    let n = 0;
    for (const c of node.children) n += countConditions(c);
    return n;
}

/**
 * Bucket de la respuesta del endpoint `/records/groups`.
 *
 * `value` es lo que el frontend usa para filtrar al expandir el grupo
 * (un eq simple para tipos escalares, un contains para multi_select).
 * `null` representa el grupo "(Sin valor)".
 */
export interface RecordGroupBucket {
    value: string | null;
    count: number;
}

export interface RecordGroupsResponse {
    data: RecordGroupBucket[];
    meta: {
        group_by_field_id: number;
        group_by_slug: string;
        group_by_type: string;
        total_groups: number;
        total_records: number;
    };
}

export const GROUPABLE_FIELD_TYPES = [
    'select',
    'multi_select',
    'user',
    'checkbox',
    'date',
    'datetime',
] as const;

export type GroupableFieldType = (typeof GROUPABLE_FIELD_TYPES)[number];

export function isGroupableType(type: string): type is GroupableFieldType {
    return (GROUPABLE_FIELD_TYPES as readonly string[]).includes(type);
}
