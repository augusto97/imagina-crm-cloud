import { z } from 'zod';
import { filterTreeSchema } from './filter';
import { idSchema } from './common';

/**
 * Filtros guardados por lista (herencia del plugin, estilo ClickUp). Cada uno
 * guarda un filter_tree con nombre. Alcance:
 *  - `personal` → visible sólo para quien lo creó (`user_id` = ese usuario).
 *  - `shared`   → visible para todo el workspace (`user_id` = null).
 * El filter_tree se valida con el MISMO schema que el QueryBuilder (whitelist).
 */
export const savedFilterScopeSchema = z.enum(['personal', 'shared']);
export type SavedFilterScope = z.infer<typeof savedFilterScopeSchema>;

export const savedFilterSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    /** null = filtro del workspace (shared); un id = filtro personal de ese usuario. */
    user_id: idSchema.nullable(),
    name: z.string(),
    filter_tree: filterTreeSchema,
    created_at: z.string(),
    updated_at: z.string(),
});
export type SavedFilter = z.infer<typeof savedFilterSchema>;

/** Alta de un filtro guardado. */
export const createSavedFilterSchema = z.object({
    name: z.string().trim().min(1).max(120),
    scope: savedFilterScopeSchema.default('personal'),
    filter_tree: filterTreeSchema,
});
export type CreateSavedFilterInput = z.infer<typeof createSavedFilterSchema>;
