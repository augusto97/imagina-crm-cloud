import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Comentarios por record (CONTRACT.md §1). El composer es multi-modo: el
 * backend NO interpreta cada `kind`, sólo enforza el shape (guard rail
 * anti-typo). Threading a 1 nivel via `parent_id`.
 */
export const COMMENT_KINDS = ['note', 'call', 'email', 'meeting'] as const;
export const commentKindSchema = z.enum(COMMENT_KINDS);
export type CommentKind = z.infer<typeof commentKindSchema>;

/**
 * Quién ve el comentario. `internal` = sólo el equipo (lo de siempre);
 * `client` = también el cliente en su portal. Los comentarios que escribe el
 * cliente desde el portal son siempre `client`. Default `internal`: lo que el
 * equipo habla entre sí jamás se le muestra al cliente por accidente.
 */
export const COMMENT_VISIBILITIES = ['internal', 'client'] as const;
export const commentVisibilitySchema = z.enum(COMMENT_VISIBILITIES);
export type CommentVisibility = z.infer<typeof commentVisibilitySchema>;

export const commentSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    record_id: idSchema,
    user_id: idSchema,
    body: z.string(),
    kind: commentKindSchema,
    parent_id: idSchema.nullable(),
    metadata: z.record(z.unknown()),
    visibility: commentVisibilitySchema.default('internal'),
    /** El autor es un cliente del portal (no un miembro del equipo). */
    from_client: z.boolean().default(false),
    /** Nombre del autor cuando no es miembro del equipo (el cliente del portal). */
    author_name: z.string().nullable().default(null),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type CommentDto = z.infer<typeof commentSchema>;

export const createCommentSchema = z.object({
    body: z.string().trim().min(1).max(10000),
    kind: commentKindSchema.default('note'),
    parent_id: idSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    /** Sin valor = `internal`. */
    visibility: commentVisibilitySchema.optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z
    .object({
        body: z.string().trim().min(1).max(10000),
        metadata: z.record(z.unknown()),
        visibility: commentVisibilitySchema,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El patch no puede estar vacío' });
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
