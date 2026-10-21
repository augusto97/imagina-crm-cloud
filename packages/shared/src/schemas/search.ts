import { z } from 'zod';
import { idSchema } from './common';

/**
 * Búsqueda GLOBAL de registros (paleta de comandos, Ctrl+K): busca por el
 * campo TÍTULO de cada lista que la persona puede ver, con el mismo ACL por
 * lista del listado (scope de lectura + campos ocultos). Una sola consulta.
 */
export const globalSearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

export const globalSearchHitSchema = z.object({
    record_id: idSchema,
    parent_id: idSchema.nullable(),
    title: z.string(),
    list_id: idSchema,
    list_slug: z.string(),
    list_name: z.string(),
    list_icon: z.string().nullable(),
    list_color: z.string().nullable(),
    updated_at: z.string(),
});
export type GlobalSearchHit = z.infer<typeof globalSearchHitSchema>;
