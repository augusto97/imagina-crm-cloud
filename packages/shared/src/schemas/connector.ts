import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Conectores / integraciones (v0.1.196, ADR-S22) — fase 1.
 *
 * Una CONEXIÓN es la credencial de un servicio externo guardada UNA vez y
 * referenciada por ID desde donde se use. Hasta acá el secreto de firma y las
 * cabeceras de autorización de un webhook vivían en texto plano dentro de
 * `action.config` de CADA automatización: cinco automatizaciones contra el
 * mismo gateway eran cinco copias de la misma clave, rotar era editarlas a
 * mano, y el MCP tuvo que aprender a enmascararlas (v0.1.193) porque estaban
 * en el lugar equivocado.
 *
 * Decisiones tomadas con el usuario:
 *  - **Credenciales de la EMPRESA, nunca de la plataforma**: cada workspace
 *    pone las suyas. Compartir la cuenta del operador entre clientes no tiene
 *    sentido para un WhatsApp o un CRM ajeno.
 *  - **Alcance workspace por defecto**; privada (sólo su dueño) únicamente si
 *    el admin lo habilita.
 *  - **El secreto nunca vuelve al cliente**: sólo un hint de los últimos 4.
 */

// --- Proveedores --------------------------------------------------------

/**
 * Fase 1 trae un único proveedor GENÉRICO: cualquier API HTTP. Alcanza para
 * conectar lo que ya se usa hoy por webhook y es el equivalente honesto a la
 * "Generic Credential Type" de n8n o al resource REST de Retool. Los
 * proveedores con acciones propias (por ejemplo "Enviar WhatsApp") llegan en
 * la fase 2, cuando el catálogo de acciones deje de ser un array literal.
 */
export const CONNECTOR_PROVIDERS = ['http'] as const;
export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);
export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;

// --- Autenticación ------------------------------------------------------

/**
 * Cómo se inyecta la credencial en cada petición. Es el eje que hace que un
 * conector sirva para APIs distintas sin escribir código nuevo.
 */
export const CONNECTOR_AUTH_TYPES = ['none', 'bearer', 'header', 'basic', 'query', 'body'] as const;
export const connectorAuthTypeSchema = z.enum(CONNECTOR_AUTH_TYPES);
export type ConnectorAuthType = z.infer<typeof connectorAuthTypeSchema>;

export const CONNECTOR_AUTH_LABEL: Record<ConnectorAuthType, string> = {
    none: 'Sin autenticación',
    bearer: 'Token Bearer',
    header: 'Cabecera personalizada',
    basic: 'Usuario y contraseña (Basic)',
    query: 'Parámetro en la URL',
    body: 'Campo del cuerpo',
};

/** Qué significa `auth_key` en cada caso, para rotular bien el formulario. */
export const CONNECTOR_AUTH_KEY_LABEL: Partial<Record<ConnectorAuthType, string>> = {
    header: 'Nombre de la cabecera',
    query: 'Nombre del parámetro',
    body: 'Nombre del campo',
};

/** Alcance de la conexión: la comparte el equipo o es sólo de quien la creó. */
export const CONNECTOR_VISIBILITIES = ['workspace', 'private'] as const;
export const connectorVisibilitySchema = z.enum(CONNECTOR_VISIBILITIES);
export type ConnectorVisibility = z.infer<typeof connectorVisibilitySchema>;

/** Estado del secreto guardado — mismo criterio de 3 estados que el SMTP. */
export const connectorSecretStateSchema = z.enum(['none', 'ok', 'unreadable']);
export type ConnectorSecretState = z.infer<typeof connectorSecretStateSchema>;

// --- Cabeceras y parámetros fijos (NO secretos) -------------------------

export const connectorPairSchema = z.object({
    key: z.string().trim().min(1).max(120),
    value: z.string().max(2000).default(''),
});
export type ConnectorPair = z.infer<typeof connectorPairSchema>;

// --- Entidad ------------------------------------------------------------

export const connectionSchema = z.object({
    id: idSchema,
    provider: connectorProviderSchema,
    name: z.string().min(1).max(120),
    /** Base opcional: una acción puede escribir sólo el path (`/send`). */
    base_url: z.string().max(2000),
    auth_type: connectorAuthTypeSchema,
    /** Nombre de la cabecera o del parámetro, según `auth_type`. */
    auth_key: z.string().max(120),
    /** Cabeceras fijas que se mandan siempre (no secretas). */
    headers: z.array(connectorPairSchema).max(20),
    /** Parámetros de URL fijos (no secretos). */
    query_params: z.array(connectorPairSchema).max(20),
    visibility: connectorVisibilitySchema,
    owner_user_id: idSchema.nullable(),
    owner_name: z.string().nullable(),
    /** Últimos 4 del secreto, para reconocerlo sin exponerlo. */
    secret_hint: z.string().nullable(),
    secret_state: connectorSecretStateSchema,
    /** Si tiene secreto de firma HMAC configurado (el valor no viaja). */
    has_signing_secret: z.boolean(),
    last_check_at: isoDateTimeSchema.nullable(),
    last_check_ok: z.boolean().nullable(),
    last_check_error: z.string().nullable(),
    /** Cuántas acciones de automatización la usan hoy. */
    usage_count: z.number().int().min(0),
    can_edit: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type Connection = z.infer<typeof connectionSchema>;

// --- Alta y edición -----------------------------------------------------

/**
 * Los secretos se mandan en claro UNA vez y se guardan cifrados. En el PATCH,
 * omitirlos o mandar cadena vacía CONSERVA el guardado (mismo contrato que el
 * password del SMTP); `null` explícito lo borra.
 */
const secretsShape = {
    token: z.string().max(4000).nullish(),
    username: z.string().max(200).nullish(),
    password: z.string().max(4000).nullish(),
    signing_secret: z.string().max(4000).nullish(),
};

export const createConnectionSchema = z.object({
    provider: connectorProviderSchema.default('http'),
    name: z.string().trim().min(1).max(120),
    base_url: z.string().trim().max(2000).default(''),
    auth_type: connectorAuthTypeSchema.default('none'),
    auth_key: z.string().trim().max(120).default(''),
    headers: z.array(connectorPairSchema).max(20).default([]),
    query_params: z.array(connectorPairSchema).max(20).default([]),
    visibility: connectorVisibilitySchema.default('workspace'),
    ...secretsShape,
});
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    base_url: z.string().trim().max(2000).optional(),
    auth_type: connectorAuthTypeSchema.optional(),
    auth_key: z.string().trim().max(120).optional(),
    headers: z.array(connectorPairSchema).max(20).optional(),
    query_params: z.array(connectorPairSchema).max(20).optional(),
    visibility: connectorVisibilitySchema.optional(),
    ...secretsShape,
});
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

// --- Ajustes del workspace ---------------------------------------------

export const connectorSettingsSchema = z.object({
    /** Si los miembros pueden crear conexiones privadas (decide el admin). */
    allow_private: z.boolean().default(false),
});
export type ConnectorSettings = z.infer<typeof connectorSettingsSchema>;

export const connectorSettingsViewSchema = connectorSettingsSchema.extend({
    /** Si quien pregunta puede editar estos ajustes y las conexiones del equipo. */
    can_manage: z.boolean(),
});
export type ConnectorSettingsView = z.infer<typeof connectorSettingsViewSchema>;

// --- Prueba de conexión -------------------------------------------------

export const connectionTestInputSchema = z.object({
    /** Ruta relativa a la base, opcional: por defecto se prueba la base. */
    path: z.string().max(2000).default(''),
    method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
});
export type ConnectionTestInput = z.infer<typeof connectionTestInputSchema>;

/**
 * Prueba del FORMULARIO antes de guardar. Mismo criterio que el diagnóstico
 * de SMTP (v0.1.151): obligar a guardar una configuración rota para poder
 * probarla es al revés de como se configura una integración.
 */
export const connectionDraftTestSchema = createConnectionSchema.extend({
    name: z.string().trim().max(120).default('Prueba'),
    path: z.string().max(2000).default(''),
    method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
    /** Id de la conexión guardada, para reusar sus secretos sin reescribirlos. */
    connection_id: idSchema.nullish(),
});
export type ConnectionDraftTestInput = z.infer<typeof connectionDraftTestSchema>;

export const connectionTestResultSchema = z.object({
    ok: z.boolean(),
    status: z.number().int().nullable(),
    /** Cabeceras REALMENTE enviadas, con el secreto enmascarado. */
    sent_headers: z.record(z.string()),
    url: z.string(),
    body: z.string().nullable(),
    error: z.string().nullable(),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

// --- Dónde se usa -------------------------------------------------------

export const connectionUsageSchema = z.object({
    automation_id: idSchema,
    automation_name: z.string(),
    list_id: idSchema,
    list_slug: z.string(),
    list_name: z.string(),
    /** Cuántas acciones de esa automatización la referencian. */
    actions: z.number().int().min(1),
});
export type ConnectionUsage = z.infer<typeof connectionUsageSchema>;

// --- Conversión de los secretos que hoy viven dentro de las acciones ----

/**
 * Un candidato = todas las acciones `call_webhook` que apuntan al MISMO host y
 * comparten credencial. Se agrupa por host porque es la unidad que el usuario
 * reconoce ("mi gateway de WhatsApp"), no la URL completa.
 */
export const inlineSecretCandidateSchema = z.object({
    /** Clave estable del grupo (el host), para mandarla al convertir. */
    host: z.string(),
    suggested_name: z.string(),
    base_url: z.string(),
    auth_type: connectorAuthTypeSchema,
    auth_key: z.string(),
    /** Qué se encontró escrito, enmascarado: nunca se devuelve el secreto. */
    found: z.array(z.enum(['auth_header', 'auth_query', 'signing_secret'])),
    secret_hint: z.string().nullable(),
    automations: z.array(
        z.object({
            id: idSchema,
            name: z.string(),
            list_slug: z.string(),
            actions: z.number().int().min(1),
        }),
    ),
});
export type InlineSecretCandidate = z.infer<typeof inlineSecretCandidateSchema>;

export const convertInlineSecretsSchema = z.object({
    /** Hosts a convertir; el nombre de la conexión es editable por el usuario. */
    items: z
        .array(
            z.object({
                host: z.string().min(1),
                name: z.string().trim().min(1).max(120),
                visibility: connectorVisibilitySchema.default('workspace'),
            }),
        )
        .min(1)
        .max(20),
});
export type ConvertInlineSecretsInput = z.infer<typeof convertInlineSecretsSchema>;

export const convertInlineSecretsResultSchema = z.object({
    created: z.array(z.object({ connection_id: idSchema, name: z.string(), host: z.string() })),
    /** Acciones reescritas para apuntar a la conexión (y sin el secreto). */
    actions_rewritten: z.number().int().min(0),
    automations_updated: z.number().int().min(0),
    warnings: z.array(z.string()),
});
export type ConvertInlineSecretsResult = z.infer<typeof convertInlineSecretsResultSchema>;
