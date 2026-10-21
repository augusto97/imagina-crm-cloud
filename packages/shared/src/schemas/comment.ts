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

/**
 * v0.1.288 — Reacciones con emoji. Un set CURADO (no cualquier emoji): así
 * el contador se lee de un vistazo y nadie puede guardar texto arbitrario
 * disfrazado de reacción. Cada persona pone o quita cada uno (toggle).
 */
export const COMMENT_REACTION_EMOJIS = ['👍', '❤️', '😄', '🎉', '👀', '🙏', '✅', '🔥'] as const;
export const commentReactionEmojiSchema = z.enum(COMMENT_REACTION_EMOJIS);
export type CommentReactionEmoji = z.infer<typeof commentReactionEmojiSchema>;

/** Cuántos reaccionaron con un emoji y quiénes (para el tooltip). */
export const commentReactionSummarySchema = z.object({
    emoji: commentReactionEmojiSchema,
    count: z.number().int().nonnegative(),
    user_ids: z.array(idSchema),
    /** Nombre visible de cada uno, en el mismo orden que `user_ids`. */
    user_names: z.array(z.string()),
});
export type CommentReactionSummary = z.infer<typeof commentReactionSummarySchema>;

/** Toggle de una reacción (`POST …/comments/:id/reactions`). */
export const toggleCommentReactionSchema = z.object({ emoji: commentReactionEmojiSchema });
export type ToggleCommentReactionInput = z.infer<typeof toggleCommentReactionSchema>;

export const commentSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    record_id: idSchema,
    user_id: idSchema,
    /**
     * Nombre visible del autor (o su email si no tiene nombre). Se resuelve en
     * la misma query del listado: sin esto la ficha mostraba "Usuario #2".
     * Opcional: el portal del cliente no nombra a los empleados.
     */
    user_name: z.string().nullable().optional(),
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
    /** v0.1.288 — reacciones, en el orden del set curado. */
    reactions: z.array(commentReactionSummarySchema).default([]),
    /**
     * v0.1.288 — el comentario RAÍZ se borró pero tiene respuestas vivas: se
     * conserva como «Comentario eliminado» (sin texto) para que el hilo no
     * quede huérfano. Borrar lo que otros respondieron no es decisión de quien
     * escribió el primer mensaje.
     */
    deleted: z.boolean().default(false),
});
export type CommentDto = z.infer<typeof commentSchema>;

export const createCommentSchema = z.object({
    body: z.string().trim().min(1).max(10000),
    kind: commentKindSchema.default('note'),
    /**
     * Responder a un comentario (hilos de UN nivel): si el padre ya es una
     * respuesta, la respuesta cuelga de SU raíz. La visibilidad de una
     * respuesta la hereda del raíz (la que se mande aquí se ignora).
     */
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
