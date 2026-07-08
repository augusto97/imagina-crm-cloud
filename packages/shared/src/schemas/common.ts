import { z } from 'zod';

/** ID numérico canónico. El slug es etiqueta humana; el ID es la verdad. */
export const idSchema = z.number().int().positive();
export type Id = z.infer<typeof idSchema>;

/** Fechas SIEMPRE UTC/ISO en storage y en el API; el cliente formatea. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha ISO (YYYY-MM-DD)');

/**
 * Shape de error del contrato REST (CONTRACT.md §1):
 * `errors` es un mapa campo → mensaje para errores de validación.
 */
export const apiErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
    data: z.object({
        status: z.number().int(),
        errors: z.record(z.string()).optional(),
    }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Meta de listados. Cursor pagination (keyset) — nunca OFFSET profundo
 * (STANDALONE.md §3.5 / §6). `total` es opcional porque contarlo puede ser caro.
 */
export const listMetaSchema = z.object({
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
});
export type ListMeta = z.infer<typeof listMetaSchema>;

/** Envoltura estándar de listados: `{ data: [...], meta: { next_cursor } }`. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
    z.object({
        data: z.array(item),
        meta: listMetaSchema,
    });
