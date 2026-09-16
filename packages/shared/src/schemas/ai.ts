import { z } from 'zod';
import { fieldTypeSchema } from './field';
import { viewTypeSchema } from './view';

/**
 * Asistente IA (ADR-S21, v0.1.181).
 *
 * Un asistente DENTRO de la app que convierte pedidos en lenguaje natural
 * ("armame una lista de proveedores con contacto y saldo") en las mismas
 * operaciones que la persona haría a mano — con sus mismos permisos y con
 * una VISTA PREVIA antes de aplicar. Nunca escribe sin confirmación.
 *
 * Dos claves posibles para hablar con el proveedor: la de la PLATAFORMA (la
 * paga el operador → cuota por plan, como los correos de ADR-S18) o la PROPIA
 * de cada empresa (BYOK → sin cuota, mismo criterio que el SMTP propio).
 */

/** Modelos habilitados. El default es el más capaz; Sonnet/Haiku son la palanca de costo. */
export const AI_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export const aiModelSchema = z.enum(AI_MODELS);
export type AiModel = z.infer<typeof aiModelSchema>;
export const DEFAULT_AI_MODEL: AiModel = 'claude-opus-5';

/** Sólo se acepta el formato de clave de Anthropic (evita pegar cualquier cosa). */
export const aiApiKeySchema = z.string().trim().min(20).max(400).regex(/^sk-ant-/, 'La clave debe empezar con sk-ant-');

// ── Plataforma (superadmin) ──────────────────────────────────────────────

/** Vista pública de la config de plataforma: NUNCA devuelve la clave. */
export const platformAiSettingsSchema = z.object({
    /** Interruptor general: apagado → ninguna empresa puede usar el asistente. */
    enabled: z.boolean(),
    /** Hay una clave de plataforma guardada (o en el env). */
    has_key: z.boolean(),
    /** Últimos 4 caracteres de la clave, para reconocerla. */
    key_hint: z.string().nullable(),
    /** La clave guardada no descifra con la SECRETS_KEY actual. */
    key_unreadable: z.boolean(),
    model: aiModelSchema,
    /**
     * Las empresas pueden usar la clave de la PLATAFORMA (con la cuota de su
     * plan). Apagado = sólo empresas con clave propia.
     */
    share_platform_key: z.boolean(),
    /** Las empresas pueden cargar SU propia clave (BYOK). */
    allow_tenant_keys: z.boolean(),
});
export type PlatformAiSettings = z.infer<typeof platformAiSettingsSchema>;

export const updatePlatformAiSettingsSchema = z
    .object({
        enabled: z.boolean(),
        /** Clave nueva. Vacío = conservar la guardada. */
        api_key: z.union([aiApiKeySchema, z.literal('')]),
        /** Borrar la clave guardada (vuelve al env, si hay). */
        clear_key: z.boolean(),
        model: aiModelSchema,
        share_platform_key: z.boolean(),
        allow_tenant_keys: z.boolean(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El patch no puede estar vacío' });
export type UpdatePlatformAiSettingsInput = z.infer<typeof updatePlatformAiSettingsSchema>;

// ── Empresa (admin del workspace) ────────────────────────────────────────

export const tenantAiSettingsSchema = z.object({
    /** El admin habilitó el asistente para su empresa (opt-in explícito). */
    enabled: z.boolean(),
    has_own_key: z.boolean(),
    key_hint: z.string().nullable(),
    key_unreadable: z.boolean(),
    /** `null` = el modelo por defecto de la plataforma. */
    model: aiModelSchema.nullable(),
    /** Lo que la plataforma permite a esta empresa. */
    platform: z.object({
        enabled: z.boolean(),
        share_platform_key: z.boolean(),
        allow_tenant_keys: z.boolean(),
        default_model: aiModelSchema,
    }),
});
export type TenantAiSettings = z.infer<typeof tenantAiSettingsSchema>;

export const updateTenantAiSettingsSchema = z
    .object({
        enabled: z.boolean(),
        api_key: z.union([aiApiKeySchema, z.literal('')]),
        clear_key: z.boolean(),
        model: aiModelSchema.nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El patch no puede estar vacío' });
export type UpdateTenantAiSettingsInput = z.infer<typeof updateTenantAiSettingsSchema>;

// ── Estado para el chat ──────────────────────────────────────────────────

export const AI_KEY_SOURCES = ['tenant', 'platform'] as const;
export const aiKeySourceSchema = z.enum(AI_KEY_SOURCES);
export type AiKeySource = z.infer<typeof aiKeySourceSchema>;

/** `GET /ai/status` — lo que el panel necesita para saber si puede hablar. */
export const aiStatusSchema = z.object({
    available: z.boolean(),
    /** Motivo legible cuando no está disponible. */
    reason: z.string().nullable(),
    /** Con qué clave se hablaría. */
    source: aiKeySourceSchema.nullable(),
    model: aiModelSchema.nullable(),
    /** Cuota mensual (sólo con clave de plataforma). `limit: null` = ilimitado. */
    usage: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().nullable() }),
    /** El admin del workspace puede configurarlo (para el link "Configurar"). */
    can_configure: z.boolean(),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

// ── Chat ─────────────────────────────────────────────────────────────────

export const aiChatRequestSchema = z.object({
    /** Continuar una conversación (se guarda en el servidor, TTL 24 h). */
    conversation_id: z.string().min(1).max(64).optional(),
    message: z.string().trim().min(1).max(4000),
    /** Dónde está parada la persona, para que el asistente no pregunte lo obvio. */
    context: z
        .object({
            list_slug: z.string().max(63).optional(),
            route: z.string().max(200).optional(),
        })
        .optional(),
});
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

/**
 * Tipos de propuesta. Toda escritura pasa por una propuesta que la persona
 * APLICA desde la tarjeta (plan → preview → apply).
 */
export const AI_PROPOSAL_KINDS = [
    'create_list',
    'add_fields',
    'update_field',
    'delete_field',
    'create_view',
    'create_dashboard',
    'create_automation',
    'update_list',
] as const;
export const aiProposalKindSchema = z.enum(AI_PROPOSAL_KINDS);
export type AiProposalKind = z.infer<typeof aiProposalKindSchema>;

/** Vista previa que la tarjeta dibuja SIN interpretar el payload. */
export const aiProposalPreviewSchema = z.object({
    lists: z
        .array(
            z.object({
                name: z.string(),
                fields: z.array(z.object({ label: z.string(), type: fieldTypeSchema })),
                views: z.array(z.object({ name: z.string(), type: viewTypeSchema })),
                automations: z.array(z.string()),
                records_count: z.number().int().nonnegative(),
            }),
        )
        .default([]),
    fields: z.array(z.object({ label: z.string(), type: fieldTypeSchema, detail: z.string().nullable().default(null) })).default([]),
    widgets: z.array(z.object({ type: z.string(), title: z.string(), detail: z.string().nullable().default(null) })).default([]),
    automation: z
        .object({ name: z.string(), trigger: z.string(), actions: z.array(z.string()) })
        .nullable()
        .default(null),
    /** Cambios campo → valor (update_field / update_list). */
    changes: z.array(z.object({ label: z.string(), from: z.string().nullable(), to: z.string() })).default([]),
});
export type AiProposalPreview = z.infer<typeof aiProposalPreviewSchema>;

export const aiProposalSchema = z.object({
    id: z.string().min(1),
    kind: aiProposalKindSchema,
    title: z.string(),
    /** Frase en lenguaje humano de lo que va a pasar al aplicar. */
    summary: z.string(),
    /** Acción destructiva o masiva: la UI pide confirmación reforzada. */
    destructive: z.boolean().default(false),
    /** Lista afectada (slug), si aplica — para los deep links. */
    list_slug: z.string().nullable().default(null),
    preview: aiProposalPreviewSchema,
    /** Estado tras aplicar. */
    applied: z.boolean().default(false),
    result: z
        .object({
            message: z.string(),
            links: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
            warnings: z.array(z.string()).default([]),
        })
        .nullable()
        .default(null),
    created_at: z.string(),
});
export type AiProposal = z.infer<typeof aiProposalSchema>;

/** Eventos SSE del chat (`POST /ai/chat`). */
export const aiChatEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('start'), conversation_id: z.string() }),
    z.object({ type: z.literal('text_delta'), text: z.string() }),
    z.object({ type: z.literal('tool_start'), name: z.string(), label: z.string() }),
    z.object({ type: z.literal('tool_end'), name: z.string(), ok: z.boolean(), summary: z.string() }),
    z.object({ type: z.literal('proposal'), proposal: aiProposalSchema }),
    z.object({
        type: z.literal('done'),
        conversation_id: z.string(),
        usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
    }),
    z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AiChatEvent = z.infer<typeof aiChatEventSchema>;

/** Mensaje del transcript que se muestra en la UI (persistido en el servidor). */
export const aiTranscriptMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string(),
    proposals: z.array(aiProposalSchema).default([]),
    at: z.string(),
});
export type AiTranscriptMessage = z.infer<typeof aiTranscriptMessageSchema>;

export const aiConversationSchema = z.object({
    id: z.string(),
    messages: z.array(aiTranscriptMessageSchema),
});
export type AiConversation = z.infer<typeof aiConversationSchema>;

/** `POST /ai/proposals/:id/apply` */
export const aiApplyResultSchema = z.object({
    proposal: aiProposalSchema,
});
export type AiApplyResult = z.infer<typeof aiApplyResultSchema>;

/**
 * Herramientas que el asistente puede ejecutar y a qué capability mapea cada
 * una. Es la MISMA lista que usa el servidor MCP (fase 3): una sola fuente.
 */
export const AI_TOOL_NAMES = [
    'list_lists',
    'get_list_schema',
    'propose_create_list',
    'propose_add_fields',
    'propose_update_field',
    'propose_delete_field',
    'propose_create_view',
    'propose_create_dashboard',
    'propose_create_automation',
    'propose_update_list',
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];
