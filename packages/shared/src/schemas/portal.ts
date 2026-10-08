import { z } from 'zod';
import { idSchema } from './common';
import { fieldSchema } from './field';
import { recordSchema } from './record';
import { recordLayoutV3Schema } from './record-layout';
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

/**
 * v0.1.233 — datos de los bloques de datos del portal + las definiciones de
 * las listas y campos que usan (colores, etiquetas), sin pedir nada al admin.
 */
export const portalLayoutDataSchema = z.object({
    data: z.record(z.unknown()),
    lists: z.record(
        z.object({ id: idSchema, slug: z.string(), name: z.string(), icon: z.string().nullable(), color: z.string().nullable() }),
    ),
    fields: z.record(z.array(fieldSchema)),
    /** De qué lista lee cada bloque (colores y etiquetas de sus gráficos). */
    block_lists: z.record(idSchema).default({}),
});
export type PortalLayoutData = z.infer<typeof portalLayoutDataSchema>;

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
    /**
     * v0.1.233 — el portal en el modelo v3 de la ficha (ADR-S26 fase C): el
     * diseño guardado, el anterior convertido o el automático. Siempre viene.
     */
    layout: recordLayoutV3Schema.nullable().default(null),
    layout_origin: z.enum(['saved', 'legacy', 'auto']).default('auto'),
    /** Datos de los gráficos y tablas del diseño, ya acotados al cliente. */
    layout_data: portalLayoutDataSchema.nullable().default(null),
    /** Campos que el cliente puede editar (los de bloques marcados editables). */
    editable_field_ids: z.array(idSchema).default([]),
    /**
     * v0.1.241 — el ACCESO que se está viendo (id del vínculo). Una persona
     * puede tener varios en la misma empresa (uno por registro) y elige cuál
     * ver; el SPA lo manda de vuelta en `X-Portal-Account`.
     */
    account_id: idSchema.nullable().default(null),
    /** v0.1.241 — nombre de la empresa (para el selector de cuentas). */
    tenant_name: z.string().default(''),
    /**
     * v0.1.267 (ADR-S35 fase 2) — documentos PDF que la empresa publicó en el
     * portal (plantillas marcadas «disponible en el portal»). Se bajan con
     * `GET /portal/me/documents/:id`, siempre del registro del cliente.
     */
    documents: z.array(z.object({ id: idSchema, name: z.string() })).default([]),
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
    /**
     * SEC-24 (v0.1.225): `null` cuando la cuenta ya existía fuera de esta
     * empresa — el enlace abre una sesión de ESA persona y sólo le llega a ella
     * por correo; a quien lo emite no se le devuelve.
     */
    token: z.string().nullable(),
    /** Ruta pública del SPA para consumir el token (`/portal/acceso?token=…`). */
    path: z.string().nullable(),
    /**
     * v0.1.245 — el enlace COMPLETO, por el dominio del portal de la empresa
     * (el mismo que llega por correo). Antes la UI armaba el link con el
     * dominio desde donde miraba el admin. Null cuando no se devuelve el token.
     */
    url: z.string().nullable().default(null),
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

/**
 * v0.1.241 — ANTES de dar acceso, el admin pregunta qué pasa con ese email EN
 * SU EMPRESA (nunca en otras: no es un directorio de quién es cliente de
 * quién). `new` = no tiene acceso; `this_record` = ya lo tiene en este
 * registro; `other_records` = tiene acceso a OTROS registros de esta empresa
 * (dárselo suma uno más, no reemplaza nada); `staff` = es del equipo de esta
 * empresa y el portal no es para él.
 */
export const portalAccessCheckSchema = z.object({
    status: z.enum(['new', 'this_record', 'other_records', 'staff']),
    records: z
        .array(z.object({ list_name: z.string(), record_id: idSchema, record_title: z.string() }))
        .default([]),
});
export type PortalAccessCheck = z.infer<typeof portalAccessCheckSchema>;

/**
 * v0.1.241 — una CUENTA del portal: un registro al que la persona tiene
 * acceso (su ficha en una empresa). `same_company` = se cambia sin recargar
 * (misma empresa que la sesión); las de otra empresa se abren con un enlace
 * de un solo uso que acuña el servidor.
 */
export const portalAccountSchema = z.object({
    id: idSchema,
    tenant_id: idSchema,
    tenant_name: z.string(),
    list_name: z.string(),
    record_id: idSchema,
    record_title: z.string(),
    current: z.boolean(),
    same_company: z.boolean(),
    available: z.boolean(),
});
export type PortalAccount = z.infer<typeof portalAccountSchema>;

export const portalAccountsSchema = z.object({
    accounts: z.array(portalAccountSchema),
    /**
     * La sesión ve las cuentas de TODAS sus empresas. Sólo las sesiones que
     * abrió un enlace llegado al correo de la persona (y en el dominio de la
     * plataforma — un dominio propio lo controla una empresa) lo tienen.
     */
    all_companies: z.boolean(),
});
export type PortalAccounts = z.infer<typeof portalAccountsSchema>;

/** Cambiar a una cuenta de otra empresa: ruta de un solo uso para navegar. */
export const portalSwitchResultSchema = z.object({ path: z.string().nullable() });
export type PortalSwitchResult = z.infer<typeof portalSwitchResultSchema>;

export const portalEmailLinkResultSchema = z.object({
    email_sent: z.boolean(),
    /** El email enmascarado al que salió (`an***@gmail.com`). */
    email_hint: z.string(),
});
export type PortalEmailLinkResult = z.infer<typeof portalEmailLinkResultSchema>;

/** Candidatas a "listas relacionadas" del portal, detectadas por el backend. */
export const portalRelatedOptionsSchema = z.object({
    options: z.array(portalRelatedListSchema),
});
export type PortalRelatedOptions = z.infer<typeof portalRelatedOptionsSchema>;
