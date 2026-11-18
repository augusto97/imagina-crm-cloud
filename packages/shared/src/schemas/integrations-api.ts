import { z } from 'zod';
import { idSchema } from './common';
import { connectorVisibilitySchema } from './connector';
import { integrationProviderSchema } from './integration-keys';
import { integrationPolicySchema } from './integration-stage';

/**
 * Los shapes de la API de integraciones (galería de la empresa y apps del
 * operador), aparte del catálogo por el mismo motivo que `integration-keys`.
 */

// --- API: galería de la empresa ----------------------------------------

export const integrationsOverviewSchema = z.object({
    /** Proveedores OAuth que el operador ya configuró. */
    providers: z.record(z.object({ configured: z.boolean() })),
    /** Si puede conectar apps para todo el equipo (admin). */
    can_connect_workspace: z.boolean(),
    /** Si puede conectar apps sólo para sí (conexiones privadas habilitadas). */
    can_connect_private: z.boolean(),
    /** Superadmin de plataforma: puede ir a configurar los proveedores. */
    is_platform_admin: z.boolean(),
    /**
     * v0.1.438 — Por app: beta / probada / en retiro y si se ofrece para
     * conectar una nueva (lo decide el operador).
     */
    catalog: z.record(integrationPolicySchema).default({}),
});
export type IntegrationsOverview = z.infer<typeof integrationsOverviewSchema>;

/** Conectar una app por clave (o actualizar la clave de una ya conectada). */
export const connectIntegrationKeySchema = z.object({
    fields: z.record(z.string().max(4000)).default({}),
    visibility: connectorVisibilitySchema.default('workspace'),
    /** Si viene, se actualiza esa conexión en vez de crear otra. */
    connection_id: idSchema.nullish(),
});
export type ConnectIntegrationKeyInput = z.infer<typeof connectIntegrationKeySchema>;

export const verifyIntegrationSchema = z.object({
    fields: z.record(z.string().max(4000)).default({}),
    /** Para reusar la clave ya guardada sin volver a pegarla. */
    connection_id: idSchema.nullish(),
    /**
     * Destino de un mensaje de prueba REAL (número de WhatsApp, chat de
     * Telegram). Es lo único que prueba una clave de verdad: listar cuentas
     * puede estar prohibido para una clave que envía perfecto.
     */
    test_to: z.string().trim().max(120).nullish(),
});
export type VerifyIntegrationInput = z.infer<typeof verifyIntegrationSchema>;

export const verifyIntegrationResultSchema = z.object({
    ok: z.boolean(),
    /** Con qué cuenta quedaría conectada («@mi_bot», «+57 300…»). */
    account_label: z.string().nullable(),
    error: z.string().nullable(),
    /** Aviso no bloqueante (no se pudo comprobar, pero se puede guardar). */
    warning: z.string().nullable(),
    /** Valores posibles para los campos con `lookup` (cuentas de WhatsApp). */
    options: z.record(z.array(z.object({ value: z.string(), label: z.string() }))),
    /** Se pidió un mensaje de prueba y el servicio lo aceptó. */
    test_sent: z.boolean().default(false),
    /**
     * v0.1.403 — Los permisos que tiene la clave, cuando el servicio los informa
     * (Whats). `null` = no se sabe. La ventana marca con ellos los de `permissions`.
     */
    granted: z.array(z.string()).nullable().default(null),
});
export type VerifyIntegrationResult = z.infer<typeof verifyIntegrationResultSchema>;

/** Autorizar una app OAuth (nueva conexión o reconectar una existente). */
export const authorizeIntegrationSchema = z.object({
    visibility: connectorVisibilitySchema.default('workspace'),
    connection_id: idSchema.nullish(),
});
export type AuthorizeIntegrationInput = z.infer<typeof authorizeIntegrationSchema>;

// --- API: apps registradas por el operador ------------------------------

export const platformIntegrationAppSchema = z.object({
    provider: integrationProviderSchema,
    configured: z.boolean(),
    client_id: z.string(),
    has_secret: z.boolean(),
    secret_hint: z.string().nullable(),
    /** El secreto existe pero no se descifra con la SECRETS_KEY actual. */
    secret_unreadable: z.boolean(),
    /** Cuántas conexiones de empresas usan hoy esta app. */
    connections: z.number().int().min(0),
});
export type PlatformIntegrationApp = z.infer<typeof platformIntegrationAppSchema>;

export const platformIntegrationsSchema = z.object({
    /** La URI que hay que registrar en cada proveedor. */
    redirect_uri: z.string(),
    apps: z.array(platformIntegrationAppSchema),
});
export type PlatformIntegrations = z.infer<typeof platformIntegrationsSchema>;

export const updatePlatformIntegrationAppSchema = z.object({
    client_id: z.string().trim().max(400).optional(),
    /** Vacío u omitido = conserva el guardado (mismo contrato que el SMTP). */
    client_secret: z.string().trim().max(4000).optional(),
    /** Borra la app registrada: las conexiones de las empresas dejan de renovarse. */
    clear: z.boolean().optional(),
});
export type UpdatePlatformIntegrationAppInput = z.infer<typeof updatePlatformIntegrationAppSchema>;
