import { z } from 'zod';
import { idSchema } from './common';
import { listSlugSchema } from './slug';

export const listSchema = z.object({
    id: idSchema,
    slug: listSlugSchema,
    name: z.string().min(1).max(190),
    icon: z.string().max(64).nullable().default(null),
    color: z.string().max(32).nullable().default(null),
    settings: z.record(z.unknown()).default({}),
    position: z.number().int().nonnegative().default(0),
});
export type List = z.infer<typeof listSchema>;

export const createListSchema = z.object({
    name: z.string().trim().min(1).max(190),
    slug: listSlugSchema.optional(),
    icon: z.string().max(64).optional(),
    color: z.string().max(32).optional(),
});
export type CreateListInput = z.infer<typeof createListSchema>;

/**
 * Patch de lista. Todos los campos opcionales (PATCH). `slug` editable
 * (el ID es la verdad; el slug es etiqueta humana). `null` en icon/color
 * los limpia; ausente = sin cambio.
 */
export const updateListSchema = z
    .object({
        name: z.string().trim().min(1).max(190),
        slug: listSlugSchema,
        icon: z.string().max(64).nullable(),
        color: z.string().max(32).nullable(),
        position: z.number().int().nonnegative(),
        settings: z.record(z.unknown()),
    })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, {
        message: 'El patch no puede estar vacío',
    });
export type UpdateListInput = z.infer<typeof updateListSchema>;
