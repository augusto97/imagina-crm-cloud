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

/**
 * v0.1.107 — Favoritos del usuario EN el workspace activo (listas y
 * dashboards anclados en el menú). Viven en `memberships.settings.favorites`
 * (por usuario+tenant). El PATCH es parcial: cada array presente REEMPLAZA
 * su lista completa.
 */
export const favoritesSchema = z.object({
    lists: z.array(idSchema).max(100).default([]),
    dashboards: z.array(idSchema).max(100).default([]),
});
export type Favorites = z.infer<typeof favoritesSchema>;

export const updateFavoritesSchema = z
    .object({
        lists: z.array(idSchema).max(100),
        dashboards: z.array(idSchema).max(100),
    })
    .partial();
export type UpdateFavoritesInput = z.infer<typeof updateFavoritesSchema>;
