import { z } from 'zod';
import { idSchema } from './common';
import { fieldSchema } from './field';
import { recordSchema } from './record';
import { publicBrandingSchema, tenantFormatSchema } from './tenant';

/**
 * Portal del cliente (CONTRACT.md §9): un usuario rol `client` vinculado a UN
 * record. Magic link (token de un solo uso) → sesión. `GET /portal/me`
 * devuelve el record + meta de campos + template de bloques (JSON en
 * list.settings.portal_template; el editor/renderer ya vive en el front).
 */
/**
 * Una lista que el cliente ve en su portal además de su propia ficha
 * (v0.1.153). `via` explica POR QUÉ le pertenecen esas filas: un campo
 * `relation` que apunta a su registro, o un campo `user` que lo apunta a él.
 */
export const portalRelatedListSchema = z.object({
    list_id: idSchema,
    slug: z.string(),
    name: z.string(),
    icon: z.string().nullable().default(null),
    color: z.string().nullable().default(null),
    via: z.enum(['relation', 'user']),
    /** Campo por el que se vincula (para explicarlo en la UI del admin). */
    via_field_label: z.string().default(''),
});
export type PortalRelatedList = z.infer<typeof portalRelatedListSchema>;

export const portalBootSchema = z.object({
    list_id: idSchema,
    list_slug: z.string(),
    list_name: z.string(),
    user_id: idSchema,
    record: recordSchema,
    fields: z.array(fieldSchema),
    template: z.array(z.record(z.unknown())),
    /** v0.1.94 — ajustes de página del portal (fondo/ancho/tipografía), crudos. */
    template_page: z.record(z.unknown()).nullable().default(null),
    /** White-label del workspace (logo por URL firmada — rol client). */
    branding: publicBrandingSchema.default({ primary_color: null, app_name: null, logo_url: null }),
    /** v0.1.104 — formato regional del workspace (números/fecha/hora). */
    format: tenantFormatSchema.default({}),
    /**
     * v0.1.153 — listas RELACIONADAS que el cliente ve además de su ficha
     * (sus facturas, sus tickets…). Opt-in por lista desde el panel del
     * portal: si el admin no eligió ninguna, viene vacío (fail-closed).
     */
    related_lists: z.array(portalRelatedListSchema).default([]),
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
    /**
     * v0.1.150 — ¿el correo salió DE VERDAD? Antes el fallo se tragaba con un
     * `.catch()` y la UI decía "Acceso enviado por email" igual: el admin creía
     * que el cliente lo había recibido. El enlace se devuelve siempre para
     * poder compartirlo a mano.
     */
    email_sent: z.boolean().default(true),
    email_error: z.string().nullable().default(null),
});
export type MagicLinkResult = z.infer<typeof magicLinkResultSchema>;

/**
 * El propio cliente pide un enlace nuevo (v0.1.154). El magic link vence a
 * las 24 h y la sesión a los 30 días de inactividad: sin esto, volver a
 * entrar dependía de llamar a la empresa. NO crea accesos — sólo re-emite
 * para quien YA fue autorizado; la respuesta es siempre la misma, exista o
 * no el email (no se puede usar para averiguar quién es cliente de quién).
 */
export const portalRequestAccessSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(255),
});
export type PortalRequestAccessInput = z.infer<typeof portalRequestAccessSchema>;

export const consumeMagicLinkSchema = z.object({ token: z.string().min(1) });
export type ConsumeMagicLinkInput = z.infer<typeof consumeMagicLinkSchema>;

/**
 * Quién tiene acceso al portal de un record (v0.1.153). El vínculo SIEMPRE
 * estuvo persistido en `portal_links` — lo que faltaba era mostrarlo: el admin
 * tenía que reescribir el email cada vez, sin saber si el cliente ya tenía
 * acceso ni si había entrado alguna vez.
 */
export const portalAccessUserSchema = z.object({
    user_id: idSchema,
    email: z.string(),
    name: z.string(),
    created_at: z.string(),
    /** Última vez que canjeó un enlace y entró. `null` = nunca entró. */
    last_access_at: z.string().nullable().default(null),
});
export type PortalAccessUser = z.infer<typeof portalAccessUserSchema>;

export const portalAccessListSchema = z.object({
    users: z.array(portalAccessUserSchema),
});
export type PortalAccessList = z.infer<typeof portalAccessListSchema>;

/** Candidatas a "listas relacionadas" del portal, detectadas por el backend. */
export const portalRelatedOptionsSchema = z.object({
    options: z.array(portalRelatedListSchema),
});
export type PortalRelatedOptions = z.infer<typeof portalRelatedOptionsSchema>;
