import { z } from 'zod';
import { automationTriggerSlugSchema } from './automation';
import { idSchema } from './common';

/**
 * v0.1.463 — «Describe la automatización y la armo» DENTRO del editor de
 * automatizaciones (addendum de ADR-S21 y ADR-S47).
 *
 * La persona cuenta en sus palabras lo que quiere («cuando una factura pase a
 * Vencida, avisa al responsable y espera 2 días; si sigue vencida, manda un
 * WhatsApp al cliente») y la IA arma el disparador y los pasos. El resultado
 * se CARGA en el editor para revisarlo: nada se guarda hasta «Guardar». Con
 * una automatización ya armada, «Pedir un cambio con IA» manda la actual
 * (sin secretos) y vuelve la versión cambiada.
 *
 * El modelo no escribe: entrega la automatización con UNA herramienta en el
 * MISMO vocabulario del asistente (`propose_create_automation`) y el servidor
 * la pasa por el MISMO constructor que traduce slugs → ids y valida.
 */

/** Largo máximo de lo que se describe. */
export const AUTOMATION_AI_DRAFT_MAX_CHARS = 2000;
/** Topes de lo que vuelve (avisos que se muestran arriba del editor). */
export const AUTOMATION_AI_DRAFT_MAX_WARNINGS = 8;

/**
 * La automatización que está en el editor (para «Pedir un cambio»): puede
 * tener cambios sin guardar. Se lee con tolerancia; el servidor le tapa los
 * secretos antes de mandarla al modelo y se los devuelve al resultado.
 */
export const automationAiDraftCurrentSchema = z.object({
    /** La automatización guardada que se está editando (sólo para la bitácora). */
    id: idSchema.optional(),
    name: z.string().max(190).default(''),
    description: z.string().max(2000).nullish(),
    trigger_type: automationTriggerSlugSchema,
    trigger_config: z.record(z.unknown()).default({}),
    actions: z.array(z.record(z.unknown())).max(60).default([]),
    is_active: z.boolean().optional(),
});
export type AutomationAiDraftCurrent = z.infer<typeof automationAiDraftCurrentSchema>;

export const automationAiDraftRequestSchema = z
    .object({
        /** Lo que la persona escribió (viaja como su pedido, no como datos). */
        description: z.string().trim().min(3, 'Cuéntale a la IA qué quieres que haga.').max(AUTOMATION_AI_DRAFT_MAX_CHARS),
        /** Con la automatización actual = «Pedir un cambio». Sin ella = armar una nueva. */
        current: automationAiDraftCurrentSchema.optional(),
    })
    .strict();
export type AutomationAiDraftRequest = z.infer<typeof automationAiDraftRequestSchema>;

export type AutomationAiDraftMode = 'create' | 'change';

/** Lo que se carga en el editor: el mismo shape que se guarda (por ids). */
export interface AutomationAiDraftAutomation {
    name: string;
    description: string | null;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    actions: Array<Record<string, unknown>>;
    is_active: boolean;
}

export interface AutomationAiDraftResult {
    mode: AutomationAiDraftMode;
    automation: AutomationAiDraftAutomation;
    /** Lo que armó, en palabras: «Cuando… → Avisa… → Espera…». */
    summary: string;
    /** Lo que la persona tiene que completar o revisar antes de activarla. */
    warnings: string[];
    /** Nombre legible del modelo que la armó. */
    model_name: string | null;
}

/** En qué anda el pedido (la IA puede tardar: el navegador pregunta cada poco). */
export type AutomationAiDraftStage = 'thinking' | 'checking' | 'fixing';

export interface AutomationAiDraftJob {
    id: string;
    state: 'running' | 'done' | 'error';
    stage: AutomationAiDraftStage | null;
    result: AutomationAiDraftResult | null;
    error: { code: string; message: string } | null;
}

/** Si el botón se puede usar ahora y, si no, por qué (no gasta nada). */
export interface AutomationAiDraftStatus {
    available: boolean;
    reason: string | null;
    /** `platform` gasta un pedido de la cuota del plan; `tenant` usa la clave propia. */
    source: 'platform' | 'tenant' | null;
}
