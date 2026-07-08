import { z } from 'zod';

/**
 * Chequeo de slug (CONTRACT.md §1 — /slugs/check): valida formato + reservado
 * + unicidad. Para `field` es obligatorio `list_id` (unicidad por lista).
 * Llega por query string, así que los ids se coercionan desde string.
 */
const queryId = z.coerce.number().int().positive();

export const slugCheckQuerySchema = z
    .object({
        type: z.enum(['list', 'field']),
        slug: z.string().min(1).max(63),
        list_id: queryId.optional(),
        except_id: queryId.optional(),
    })
    .refine((q) => q.type !== 'field' || q.list_id !== undefined, {
        message: 'list_id es obligatorio para slugs de campo',
        path: ['list_id'],
    });
export type SlugCheckQuery = z.infer<typeof slugCheckQuerySchema>;

export const slugCheckResultSchema = z.object({
    available: z.boolean(),
    /** Motivo cuando no está disponible: `format` | `reserved` | `taken`. */
    reason: z.enum(['format', 'reserved', 'taken']).optional(),
});
export type SlugCheckResult = z.infer<typeof slugCheckResultSchema>;
