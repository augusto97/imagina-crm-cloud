import { z } from 'zod';
import type { ConnectorPair } from './connector';

/**
 * Los proveedores, las claves y las categorías de las integraciones, aparte
 * del CATÁLOGO (`integrations.ts`, ~2.000 líneas de textos y acciones). Quien
 * sólo valida una clave —los schemas de conexiones que usa el cliente HTTP
 * del front desde el login— no arrastra el catálogo entero a su bundle.
 * `integrations.ts` re-exporta todo esto: los imports de siempre no cambian.
 */

// --- Proveedores OAuth (los registra el operador) -----------------------

export const INTEGRATION_PROVIDERS = ['google', 'microsoft', 'slack'] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export interface IntegrationProviderDef {
    key: IntegrationProvider;
    label: string;
    authorize_url: string;
    token_url: string;
    /** Parámetros extra del paso de autorización (refresh token, etc.). */
    extra_params: ConnectorPair[];
    /** Permisos que se piden SIEMPRE (identidad de la cuenta, renovación). */
    base_scopes: string;
    /** Microsoft exige repetir los scopes en el canje y en la renovación. */
    scope_on_token: boolean;
    /** Separador de scopes que espera el proveedor. */
    scope_separator: ' ' | ',';
    /** Dónde se registra la app. */
    console_url: string;
}

export const INTEGRATION_PROVIDER_DEFS: Record<IntegrationProvider, IntegrationProviderDef> = {
    google: {
        key: 'google',
        label: 'Google',
        authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        // Sin estos dos Google entrega un access token y NINGÚN refresh: la
        // conexión anda una hora y después se cae sola.
        extra_params: [
            { key: 'access_type', value: 'offline' },
            { key: 'prompt', value: 'consent' },
            { key: 'include_granted_scopes', value: 'true' },
        ],
        base_scopes: 'openid email',
        scope_on_token: false,
        scope_separator: ' ',
        console_url: 'https://console.cloud.google.com/apis/credentials',
    },
    microsoft: {
        key: 'microsoft',
        label: 'Microsoft 365',
        authorize_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        extra_params: [{ key: 'prompt', value: 'select_account' }],
        // `offline_access` es lo que habilita el refresh; `User.Read`, saber
        // qué cuenta se conectó.
        base_scopes: 'openid email offline_access User.Read',
        scope_on_token: true,
        scope_separator: ' ',
        console_url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    },
    slack: {
        key: 'slack',
        label: 'Slack',
        authorize_url: 'https://slack.com/oauth/v2/authorize',
        token_url: 'https://slack.com/api/oauth.v2.access',
        extra_params: [],
        base_scopes: '',
        scope_on_token: false,
        // Slack separa los scopes de bot con comas.
        scope_separator: ',',
        console_url: 'https://api.slack.com/apps',
    },
};

// --- Integraciones (las tarjetas de la galería) --------------------------

export const INTEGRATION_KEYS = [
    'whatsapp',
    // v0.1.389 — la versión nueva de Imagina WAS (API v1, whats.imagina.cloud):
    // estado de cada envío y mensajes entrantes por avisos firmados.
    'whatsapp_web',
    // D3 — WhatsApp oficial (Meta WhatsApp Cloud API), al lado del de WAS.
    'whatsapp_cloud',
    'telegram',
    // v0.1.332 — SMS con la cuenta de cada empresa (ADR-S82).
    'sms_twilio',
    'sms_bulkgate',
    'sms_infobip',
    'sms_labsmobile',
    'sms_onurix',
    'slack',
    'gmail',
    'google_calendar',
    'google_sheets',
    'google_drive',
    'outlook',
    // v0.1.348 — Microsoft Teams: mensajes a canales y chats (misma app de Microsoft).
    'teams',
    'woocommerce',
    // v0.1.333 (ADR-S83) — sitios WordPress: páginas, entradas, tipos propios y taxonomías.
    'wordpress',
    'sqlserver',
    'mercadopago',
    'wompi',
    // v0.1.372 — PayPal: links de pago en dólares con la cuenta de la empresa.
    'paypal',
    's3',
] as const;
export const integrationKeySchema = z.enum(INTEGRATION_KEYS);
export type IntegrationKey = z.infer<typeof integrationKeySchema>;

export function isIntegrationKey(value: unknown): value is IntegrationKey {
    return typeof value === 'string' && (INTEGRATION_KEYS as readonly string[]).includes(value);
}

export const INTEGRATION_CATEGORY_LABEL = {
    mensajeria: 'Mensajería',
    sms: 'Mensajes de texto (SMS)',
    correo: 'Correo',
    calendario: 'Calendario',
    datos: 'Hojas de cálculo',
    comercio: 'Tiendas online',
    sitios: 'Sitios web',
    bases_datos: 'Bases de datos',
    pagos: 'Cobros y pagos',
    almacenamiento: 'Almacenamiento',
} as const;
export type IntegrationCategory = keyof typeof INTEGRATION_CATEGORY_LABEL;
