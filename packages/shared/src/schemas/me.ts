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

/**
 * v0.1.121 — Borrado de la cuenta (GDPR art. 17). Exige la contraseña: no
 * alcanza con tener la sesión abierta para una acción irreversible.
 */
export const deleteAccountSchema = z.object({ password: z.string().min(1) });
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/**
 * v0.1.121 — Descarga de datos personales (GDPR art. 15). El backend arma este
 * shape y el front lo valida con el MISMO schema antes de ofrecer el archivo.
 */
export const accountExportSchema = z.object({
    generated_at: z.string(),
    account: z.object({
        id: idSchema,
        email: z.string(),
        name: z.string(),
        locale: z.string(),
        created_at: z.string(),
        email_verified: z.boolean(),
        two_factor_enabled: z.boolean(),
        email_signature: z.string().nullable(),
    }),
    workspaces: z.array(
        z.object({
            id: idSchema,
            name: z.string(),
            slug: z.string(),
            role: z.string(),
            joined_at: z.string(),
            comments: z.array(
                z.object({ record_id: idSchema, body: z.string(), created_at: z.string() }),
            ),
            activity: z.array(
                z.object({
                    record_id: idSchema.nullable(),
                    action: z.string(),
                    created_at: z.string(),
                }),
            ),
            mentions_received: z.array(
                z.object({ comment_id: idSchema, snippet: z.string(), created_at: z.string() }),
            ),
            saved_filters: z.array(z.object({ name: z.string(), created_at: z.string() })),
            files_uploaded: z.array(
                z.object({
                    filename: z.string(),
                    size_bytes: z.number(),
                    created_at: z.string(),
                }),
            ),
        }),
    ),
});
export type AccountExportDto = z.infer<typeof accountExportSchema>;
