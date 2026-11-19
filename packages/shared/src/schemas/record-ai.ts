import { z } from 'zod';
import { bulkEditTargetSchema } from './bulk-edit';
import { idSchema } from './common';
import { AI_AGENT_MAX_EXTRA_INSTRUCTION, type AiAgentMode, type AiAgentRunStatus } from './ai-agents';

/**
 * v0.1.456 (ADR-S109) — IA en el día a día: lo que la persona le pide a la IA
 * desde la ficha de un registro, sin abrir el asistente.
 *
 *  - Resumen del registro («¿qué pasó con este cliente?»): un pedido de la
 *    cuota con lo que la persona PUEDE ver del registro (su ACL), guardado en
 *    caché mientras eso no cambie.
 *  - Escribir con IA: redactar en la descripción (menú «/»), reescribir una
 *    selección (mejorar, acortar, corregir, cambiar el tono, traducir) y
 *    sugerir la respuesta a un comentario. Devuelve TEXTO: la persona lo
 *    revisa y decide; nada se guarda ni se envía solo.
 *  - Pedir a un agente de IA desde la ficha, y correrlo en lote sobre
 *    registros que ya existen.
 *
 * Mismas reglas que el asistente (ADR-S21): la empresa activó la IA, el plan
 * la incluye, clave de la plataforma con la cuota del plan o la propia de la
 * empresa, y lo que viene del registro viaja como DATO, no como instrucción.
 */

// ── Resumen del registro ────────────────────────────────────────────────

export const recordAiSummaryRequestSchema = z
    .object({
        /** «Actualizar»: vuelve a preguntarle a la IA aunque haya uno guardado. */
        refresh: z.boolean().default(false),
    })
    .strict();
export type RecordAiSummaryRequest = z.infer<typeof recordAiSummaryRequestSchema>;

/** Topes de lo que devuelve el resumen (lo que se dibuja en la ficha). */
export const RECORD_AI_SUMMARY_MAX_ITEMS = 6;

export const recordAiSummarySchema = z.object({
    /** Una o dos oraciones: en qué está el registro. */
    headline: z.string(),
    /** Lo más importante que pasó o que hay que saber. */
    points: z.array(z.string()).max(RECORD_AI_SUMMARY_MAX_ITEMS),
    /** Lo que quedó pendiente (tareas, cobros, aprobaciones, respuestas). */
    pending: z.array(z.string()).max(RECORD_AI_SUMMARY_MAX_ITEMS),
    /** Lo próximo con fecha (vencimientos, citas, el siguiente paso). */
    next: z.array(z.string()).max(RECORD_AI_SUMMARY_MAX_ITEMS),
    /** Cuándo se generó (ISO). */
    generated_at: z.string(),
    /** Vino de la caché: no se gastó un pedido. */
    cached: z.boolean(),
    /** Nombre legible del modelo que lo escribió. */
    model_name: z.string().nullable(),
});
export type RecordAiSummary = z.infer<typeof recordAiSummarySchema>;

// ── Escribir con IA ─────────────────────────────────────────────────────

/** Qué hacer con un texto seleccionado (barra flotante de la descripción). */
export const RECORD_AI_REWRITE_ACTIONS = ['improve', 'shorter', 'longer', 'fix', 'formal', 'friendly', 'translate_en', 'translate_pt', 'translate_es'] as const;
export const recordAiRewriteActionSchema = z.enum(RECORD_AI_REWRITE_ACTIONS);
export type RecordAiRewriteAction = z.infer<typeof recordAiRewriteActionSchema>;

/** Etiqueta y grupo de cada acción (la barra flotante los dibuja así). */
export const RECORD_AI_REWRITE_META: Record<RecordAiRewriteAction, { label: string; group: 'edit' | 'tone' | 'translate' }> = {
    improve: { label: 'Mejorar la redacción', group: 'edit' },
    shorter: { label: 'Más corto', group: 'edit' },
    longer: { label: 'Más largo', group: 'edit' },
    fix: { label: 'Corregir ortografía', group: 'edit' },
    formal: { label: 'Tono formal', group: 'tone' },
    friendly: { label: 'Tono cercano', group: 'tone' },
    translate_en: { label: 'Traducir al inglés', group: 'translate' },
    translate_pt: { label: 'Traducir al portugués', group: 'translate' },
    translate_es: { label: 'Traducir al español', group: 'translate' },
};

/** Largo máximo del texto que se manda a reescribir y de lo que se pide redactar. */
export const RECORD_AI_TEXT_MAX = 8000;
export const RECORD_AI_PROMPT_MAX = 1000;

export const recordAiWriteSchema = z.discriminatedUnion('mode', [
    z
        .object({
            /** Redactar algo nuevo (menú «/» → «Escribir con IA»). */
            mode: z.literal('compose'),
            prompt: z.string().trim().min(3).max(RECORD_AI_PROMPT_MAX),
        })
        .strict(),
    z
        .object({
            /** Reescribir lo seleccionado. */
            mode: z.literal('rewrite'),
            action: recordAiRewriteActionSchema,
            text: z.string().trim().min(1).max(RECORD_AI_TEXT_MAX),
        })
        .strict(),
]);
export type RecordAiWriteInput = z.infer<typeof recordAiWriteSchema>;

/** Lo que devuelve «Escribir con IA»: texto en el formato sencillo (`markdownToRichDoc`). */
export interface RecordAiTextResult {
    text: string;
    model_name: string | null;
}

export const recordAiReplySchema = z
    .object({
        /** El comentario (raíz del hilo) al que se responde; sin él, al registro en general. */
        comment_id: idSchema.optional(),
        /** Lo que la persona ya escribió: la IA lo toma como lo que quiere decir. */
        hint: z.string().trim().max(2000).default(''),
        /** A quién va: una nota interna o una respuesta que verá el cliente. */
        for_client: z.boolean().default(false),
    })
    .strict();
export type RecordAiReplyInput = z.infer<typeof recordAiReplySchema>;

// ── Pedir a un agente desde la ficha ────────────────────────────────────

/** Un agente que la persona puede usar en este registro (sin su configuración). */
export interface RecordAgentOption {
    id: number;
    name: string;
    description: string;
    color: string | null;
    icon: string | null;
    mode: AiAgentMode;
}

export const askRecordAgentSchema = z
    .object({
        agent_id: idSchema,
        /** Instrucción extra para esta vez (como la de una automatización). */
        instruction: z.string().trim().max(AI_AGENT_MAX_EXTRA_INSTRUCTION).default(''),
    })
    .strict();
export type AskRecordAgentInput = z.infer<typeof askRecordAgentSchema>;

/** El estado de una corrida pedida desde la ficha (o de las últimas del registro). */
export interface RecordAgentRunDto {
    id: number;
    agent_id: number;
    agent_name: string;
    status: AiAgentRunStatus;
    /** Lo que respondió el agente al terminar. */
    summary: string;
    error: string | null;
    /** Cambios que el agente ya hizo (modo «hace los cambios»). */
    writes: number;
    /** La propuesta que dejó (modo «propone»): id, estado y cuántos cambios trae. */
    proposal: { id: number; status: string; items: number } | null;
    created_by_name: string | null;
    created_at: string;
    finished_at: string | null;
}

// ── Agente en lote ──────────────────────────────────────────────────────

/** Tope de registros de un lote (cada uno es una corrida del agente). */
export const AI_AGENT_BATCH_MAX = 200;
/** Corridas de un mismo lote que van a la vez (el resto espera su turno). */
export const AI_AGENT_BATCH_PARALLEL = 3;

export const agentBatchPreviewSchema = z
    .object({
        agent_id: idSchema,
        target: bulkEditTargetSchema,
    })
    .strict();
export type AgentBatchPreviewInput = z.infer<typeof agentBatchPreviewSchema>;

export const agentBatchStartSchema = z
    .object({
        agent_id: idSchema,
        target: bulkEditTargetSchema,
        instruction: z.string().trim().max(AI_AGENT_MAX_EXTRA_INSTRUCTION).default(''),
    })
    .strict();
export type AgentBatchStartInput = z.infer<typeof agentBatchStartSchema>;

/** Lo que se confirma antes de correr un agente en lote. */
export interface AgentBatchPreview {
    agent: { id: number; name: string; mode: AiAgentMode; max_runs_per_day: number };
    /** Registros que coinciden (antes de los topes). */
    matched: number;
    /** De esos, los que la persona puede editar (entran al lote, máximo `AI_AGENT_BATCH_MAX`). */
    eligible: number;
    /** Corridas que le quedan hoy al agente. */
    runs_left_today: number;
    /** Pedidos de la cuota del plan que quedan este mes (`null` = sin tope: clave propia o plan ilimitado). */
    quota_left: number | null;
    /** Tokens que le quedan al agente este mes (`null` = sin presupuesto). */
    budget_left: number | null;
    /** Tokens promedio de sus últimas corridas (`null` = todavía no corrió). */
    tokens_per_run: number | null;
    /** Los que se van a correr de verdad (el menor de todo lo anterior). */
    will_run: number;
    /** Por qué no corren todos (en lenguaje claro). */
    notes: string[];
}

export const AGENT_BATCH_STATUSES = ['running', 'done', 'stopped', 'cancelled'] as const;
export type AgentBatchStatus = (typeof AGENT_BATCH_STATUSES)[number];

export interface AgentBatchDto {
    id: number;
    agent_id: number;
    agent_name: string;
    list_id: number | null;
    status: AgentBatchStatus;
    /** Por qué se detuvo antes de terminar (tope del agente, cuota). */
    stopped_reason: string | null;
    total: number;
    /** Corridas creadas hasta ahora (las demás esperan su turno). */
    dispatched: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    skipped: number;
    /** Registros que el agente cambió (modo «hace los cambios»). */
    changed: number;
    /** Propuestas que esperan a una persona (modo «propone»). */
    proposals_pending: number;
    /** Las corridas que fallaron o no corrieron, con el motivo (máx. 20). */
    errors: Array<{ record_id: number | null; title: string; message: string }>;
    created_at: string;
    finished_at: string | null;
}
