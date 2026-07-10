import { z } from 'zod';
import { idSchema } from './common';

/**
 * Endpoints `/me/*`: recursos del usuario autenticado. El shape de resumen de
 * usuario es el que espera el picker heredado del plugin (`useWpUsers`):
 * `login` = email, `display_name` = nombre, `avatar_url` = '' (sin gravatar en
 * la nube; el front ya renderiza el fallback de iniciales).
 */
export const meUserSummarySchema = z.object({
    id: idSchema,
    login: z.string(),
    display_name: z.string(),
    avatar_url: z.string(),
});
export type MeUserSummary = z.infer<typeof meUserSummarySchema>;

/** Firma de email del usuario (se inserta en la acción send_email). */
export const updateEmailSignatureSchema = z.object({
    signature: z.string().max(20_000),
});
export type UpdateEmailSignatureInput = z.infer<typeof updateEmailSignatureSchema>;
