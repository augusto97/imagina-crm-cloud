import { z } from 'zod';
import { idSchema } from './common';
import { fieldSchema } from './field';
import { recordSchema } from './record';

/**
 * Portal del cliente (CONTRACT.md §9): un usuario rol `client` vinculado a UN
 * record. Magic link (token de un solo uso) → sesión. `GET /portal/me`
 * devuelve el record + meta de campos + template de bloques (JSON en
 * list.settings.portal_template; el editor/renderer ya vive en el front).
 */
export const portalBootSchema = z.object({
    list_id: idSchema,
    list_name: z.string(),
    record: recordSchema,
    fields: z.array(fieldSchema),
    template: z.array(z.record(z.unknown())),
});
export type PortalBoot = z.infer<typeof portalBootSchema>;

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
