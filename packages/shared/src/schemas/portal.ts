import { z } from 'zod';
import { idSchema } from './common';
import { fieldSchema } from './field';
import { recordSchema } from './record';
import { publicBrandingSchema } from './tenant';

/**
 * Portal del cliente (CONTRACT.md §9): un usuario rol `client` vinculado a UN
 * record. Magic link (token de un solo uso) → sesión. `GET /portal/me`
 * devuelve el record + meta de campos + template de bloques (JSON en
 * list.settings.portal_template; el editor/renderer ya vive en el front).
 */
export const portalBootSchema = z.object({
    list_id: idSchema,
    list_slug: z.string(),
    list_name: z.string(),
    user_id: idSchema,
    record: recordSchema,
    fields: z.array(fieldSchema),
    template: z.array(z.record(z.unknown())),
    /** White-label del workspace (logo por URL firmada — rol client). */
    branding: publicBrandingSchema.default({ primary_color: null, app_name: null, logo_url: null }),
});
export type PortalBoot = z.infer<typeof portalBootSchema>;

/**
 * PATCH /portal/me — el cliente edita SU record. Solo se aceptan slugs
 * declarados en algún bloque `editable_form` del template (whitelist
 * server-side; slug fuera de la lista → 403 explícito).
 */
export const portalUpdateMeSchema = z.object({
    fields: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length > 0, {
        message: 'No se enviaron cambios',
    }),
});
export type PortalUpdateMeInput = z.infer<typeof portalUpdateMeSchema>;

/** POST /portal/me/comments — nota simple del cliente (sin threading). */
export const portalCommentSchema = z.object({
    content: z.string().trim().min(1).max(5000),
});
export type PortalCommentInput = z.infer<typeof portalCommentSchema>;

/** Alta de acceso al portal para un record (lo emite un admin/manager). */
export const issueMagicLinkSchema = z.object({
    record_id: idSchema,
    email: z.string().trim().toLowerCase().email().max(255),
});
export type IssueMagicLinkInput = z.infer<typeof issueMagicLinkSchema>;

export const magicLinkResultSchema = z.object({
    token: z.string(),
    /** Ruta pública del SPA para consumir el token (`/portal/acceso?token=…`). */
    path: z.string(),
});
export type MagicLinkResult = z.infer<typeof magicLinkResultSchema>;

export const consumeMagicLinkSchema = z.object({ token: z.string().min(1) });
export type ConsumeMagicLinkInput = z.infer<typeof consumeMagicLinkSchema>;
