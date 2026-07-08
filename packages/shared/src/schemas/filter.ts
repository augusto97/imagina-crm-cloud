import { z } from 'zod';
import { idSchema } from './common';

/** Operadores escalares del QueryBuilder (CONTRACT.md §4). */
export const FILTER_OPERATORS = [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'in',
    'nin',
    'is_null',
    'is_not_null',
    'between_relative',
] as const;
export const filterOperatorSchema = z.enum(FILTER_OPERATORS);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

/** Operadores que no llevan `value`. */
export const NULLARY_OPERATORS: readonly FilterOperator[] = ['is_null', 'is_not_null'];

/**
 * Presets de rango relativo (CONTRACT.md §4). El valor de `between_relative`
 * es uno de estos slugs; se resuelve contra `now()` EN CADA QUERY, nunca se
 * persiste como fecha fija. (Espejo de apps/web/.../dateRangePresets.ts.)
 */
export const DATE_RANGE_PRESETS = [
    'today',
    'yesterday',
    'this_week',
    'last_week',
    'this_month',
    'last_month',
    'last_7_days',
    'last_15_days',
    'last_30_days',
    'this_year',
    'last_year',
] as const;
export const dateRangePresetSchema = z.enum(DATE_RANGE_PRESETS);
export type DateRangePreset = z.infer<typeof dateRangePresetSchema>;

/**
 * Condición sobre un campo. Referencia SIEMPRE por `field_id` (nunca slug):
 * el ID es la verdad, y así las saved views/filters no se rompen al renombrar
 * (regla de oro nº 1 / HANDOFF §4).
 */
export const filterConditionSchema = z.object({
    type: z.literal('condition'),
    field_id: idSchema,
    op: filterOperatorSchema,
    value: z.unknown().optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export type FilterGroup = {
    type: 'group';
    logic: 'and' | 'or';
    children: FilterNode[];
};
export type FilterNode = FilterCondition | FilterGroup;

const MAX_FILTER_DEPTH = 5;

/**
 * Grupo AND/OR anidado. Profundidad máxima 5 (CONTRACT.md §4). Se valida con
 * un builder recursivo con límite de profundidad para no permitir árboles
 * patológicos.
 */
export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
    z.object({
        type: z.literal('group'),
        logic: z.enum(['and', 'or']),
        children: z.array(filterNodeSchema),
    }),
);

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
    z.union([filterConditionSchema, filterGroupSchema]),
);

/** Valida que el árbol no exceda la profundidad máxima. */
export function filterDepthOk(node: FilterNode, depth = 1): boolean {
    if (node.type === 'condition') return depth <= MAX_FILTER_DEPTH;
    if (depth > MAX_FILTER_DEPTH) return false;
    return node.children.every((c) => filterDepthOk(c, depth + 1));
}

/** Filter tree de nivel raíz: un grupo con validación de profundidad. */
export const filterTreeSchema = filterGroupSchema.refine(
    (tree) => filterDepthOk(tree),
    { message: `El filtro excede la profundidad máxima (${MAX_FILTER_DEPTH})` },
);
