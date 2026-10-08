import { z } from 'zod';
import { FALLBACK_TIME_ZONE, isValidTimeZone } from './timezone';
import { idSchema, isoDateTimeSchema } from './common';
import { filterOperatorSchema } from './filter';

/**
 * Automatizaciones (CONTRACT.md §8) — modelo FLEXIBLE alineado al plugin
 * (paridad total del editor Formulario + Diagrama):
 *
 *   trigger_type (slug) + trigger_config (field_filters / changed_fields /
 *   claves específicas del trigger) + actions[] (cada una con `condition`
 *   propia + el tipo especial `if_else` con ramas then/else recursivas) +
 *   description.
 *
 * El config de cada acción es un record laxo: el motor lee las claves que
 * necesita (el catálogo `/actions` describe el schema para el UI). Las
 * condiciones referencian el campo por SLUG (entrada/salida humana); el motor
 * resuelve slug→valor del record al evaluar.
 */

// --- Triggers (slugs conocidos; el tipo es abierto para el catálogo) ---
export const AUTOMATION_TRIGGERS = [
    'record_created',
    'record_updated',
    'field_changed',
    'due_date_reached',
    'scheduled',
] as const;
export const automationTriggerSlugSchema = z.string().min(1);
export type AutomationTriggerSlug = z.infer<typeof automationTriggerSlugSchema>;

// --- Condiciones ---
// Shape rico: array de `{field, op, value}` unidas por AND (lo que escribe el
// ConditionEditor del plugin). Se acepta también el legacy plano `{slug:value}`.
// `field` o `slug` (alias): el ConditionEditor del fork emite `{slug, op,
// value}` y el evaluador del motor acepta ambos desde siempre — el schema
// exigía `field` a secas y rechazaba con "Datos inválidos" cualquier
// condición guardada desde la UI.
export const conditionRuleSchema = z
    .object({
        field: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        op: filterOperatorSchema,
        value: z.unknown().optional(),
    })
    .refine((r) => (r.field ?? r.slug ?? '') !== '', {
        message: 'La condición necesita un campo (field o slug)',
    });
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const conditionDataSchema = z.union([
    z.array(conditionRuleSchema),
    z.record(z.unknown()),
]);
export type ConditionData = z.infer<typeof conditionDataSchema>;

// --- Acciones (recursivas por `if_else`) ---
export const AUTOMATION_ACTIONS = [
    'send_email',
    'call_webhook',
    'update_field',
    'create_record',
    'bulk_edit',
    'generate_pdf',
    'if_else',
] as const;

export interface ActionSpec {
    type: string;
    config: Record<string, unknown>;
    condition?: ConditionData | null;
}
interface ActionSpecInput {
    type: string;
    config?: Record<string, unknown>;
    condition?: ConditionData | null;
}

export const actionSpecSchema: z.ZodType<ActionSpec, z.ZodTypeDef, ActionSpecInput> = z.lazy(() =>
    z.object({
        type: z.string().min(1),
        config: z.record(z.unknown()).default({}),
        condition: conditionDataSchema.nullish(),
    }),
);

// --- Config del trigger ---
export const triggerConfigSchema = z
    .object({
        field_filters: conditionDataSchema.optional(),
        changed_fields: z.array(z.string()).optional(),
    })
    .catchall(z.unknown());
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

// --- Entidad ---
export const automationSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    name: z.string().min(1).max(190),
    description: z.string().nullable(),
    trigger_type: automationTriggerSlugSchema,
    trigger_config: triggerConfigSchema,
    actions: z.array(actionSpecSchema),
    is_active: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type Automation = z.infer<typeof automationSchema>;

export const createAutomationSchema = z.object({
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullish(),
    trigger_type: automationTriggerSlugSchema,
    trigger_config: triggerConfigSchema.optional(),
    actions: z.array(actionSpecSchema).min(1),
    is_active: z.boolean().optional(),
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z
    .object({
        name: z.string().trim().min(1).max(190),
        description: z.string().max(2000).nullable(),
        trigger_type: automationTriggerSlugSchema,
        trigger_config: triggerConfigSchema,
        actions: z.array(actionSpecSchema).min(1),
        is_active: z.boolean(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El patch no puede estar vacío' });
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

// --- Runs ---
export const AUTOMATION_RUN_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export const automationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export const actionLogStatusSchema = z.enum(['success', 'failed', 'skipped']);
export type ActionLogStatus = z.infer<typeof actionLogStatusSchema>;

export const actionLogEntrySchema = z.object({
    action: z.string(),
    status: actionLogStatusSchema,
    message: z.string().nullable(),
    details: z.record(z.unknown()).default({}),
});
export type ActionLogEntry = z.infer<typeof actionLogEntrySchema>;

export const automationRunSchema = z.object({
    id: idSchema,
    automation_id: idSchema,
    list_id: idSchema,
    record_id: idSchema.nullable(),
    status: automationRunStatusSchema,
    actions_log: z.array(actionLogEntrySchema),
    error: z.string().nullable(),
    started_at: isoDateTimeSchema.nullable(),
    finished_at: isoDateTimeSchema.nullable(),
    created_at: isoDateTimeSchema.nullable(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

// --- Catálogo (para el UI: /triggers y /actions) ---
export const triggerMetaSchema = z.object({
    slug: z.string(),
    label: z.string(),
    event: z.string(),
    config_schema: z.record(z.record(z.unknown())),
});
export type TriggerMeta = z.infer<typeof triggerMetaSchema>;

export const actionMetaSchema = z.object({
    slug: z.string(),
    label: z.string(),
    config_schema: z.record(z.record(z.unknown())),
    /**
     * v0.1.198 — acciones con NOMBRE de un conector. Cuando viene, el ítem del
     * menú no es un tipo de acción sino una acción concreta de una conexión
     * ("Enviar WhatsApp" de «Gateway»); el `slug` sigue siendo
     * `connector_action` porque el motor ejecuta una sola cosa.
     */
    connector: z
        .object({
            connection_id: idSchema,
            connection_name: z.string(),
            action_key: z.string(),
            description: z.string(),
            /** v0.1.203 — app de la galería, para pintar su logo en el menú. */
            integration_key: z.string().nullable().optional(),
        })
        .optional(),
});
export type ActionMeta = z.infer<typeof actionMetaSchema>;

// --- v0.1.111: capturas de prueba del webhook entrante ---
// Los últimos payloads recibidos en `POST /public/hooks/:token`, para que el
// editor muestre qué llega y ayude a mapear claves → campos/merge tags.
export const hookCaptureSchema = z.object({
    payload: z.record(z.unknown()),
    received_at: z.string(),
});
export type HookCapture = z.infer<typeof hookCaptureSchema>;

/**
 * Probador de webhooks salientes (v0.1.155). El backend arma la petición con
 * el MISMO builder que usa el motor, la ejecuta contra el destino real (con
 * el guard anti-SSRF de SEC-03) y devuelve lo que mandó y lo que contestaron.
 * Sin esto, configurar una API ajena era escribir a ciegas y esperar a que
 * saltara un registro para ver si funcionaba.
 */
export const webhookTestInputSchema = z.object({
    /** El `config` de la acción `call_webhook` tal cual se está editando. */
    config: z.record(z.unknown()),
    /** Registro de muestra para resolver las variables. Default: el último. */
    record_id: z.number().int().positive().optional(),
});
export type WebhookTestInput = z.infer<typeof webhookTestInputSchema>;

/**
 * v0.1.265 — «Enviar prueba» / «Ver con datos reales» del editor de correos.
 * La prueba sale SIEMPRE a la casilla de quien la pide.
 */
export const emailTestInputSchema = z.object({
    /** El `config` de la acción `send_email` tal cual se está editando. */
    config: z.record(z.unknown()),
    record_id: z.number().int().positive().optional(),
    /** false = sólo arma el correo (vista previa con datos reales). */
    send: z.boolean().default(false),
});
export type EmailTestInput = z.infer<typeof emailTestInputSchema>;

export interface EmailTestResult {
    subject: string;
    html: string | null;
    text: string | null;
    sample_record_id: number | null;
    /** La casilla a la que salió la prueba (null si no se mandó). */
    sent_to: string | null;
    error: string | null;
    signature_note: string | null;
    /** v0.1.266 — PDFs adjuntos de la prueba enviada. */
    attachments?: Array<{ filename: string; bytes: number }>;
}

export const webhookTestResultSchema = z.object({
    /** Lo que se envió, ya con las variables resueltas. */
    request: z.object({
        url: z.string(),
        method: z.string(),
        headers: z.record(z.string()),
        body: z.string().nullable().default(null),
    }),
    /** `null` si no se llegó a conectar (ver `error`). */
    response: z
        .object({
            status: z.number(),
            content_type: z.string().default(''),
            body: z.string().default(''),
        })
        .nullable()
        .default(null),
    /** Motivo por el que no hubo respuesta (SSRF bloqueado, timeout, DNS…). */
    error: z.string().nullable().default(null),
    /** Id del registro usado para resolver las variables (`null` = ninguno). */
    sample_record_id: z.number().nullable().default(null),
});
export type WebhookTestResult = z.infer<typeof webhookTestResultSchema>;

// --- Trigger «En un horario» (v0.1.221) ---
// La UI guarda una FRECUENCIA legible (la del plugin: cada hora, dos veces al
// día, diario, semanal) más hora, día y zona horaria; el motor necesita un
// cron. Esta función es la ÚNICA traducción entre las dos, así el editor y
// el scheduler no pueden desalinearse. Un `cron` explícito siempre manda.
export const SCHEDULE_FREQUENCIES = ['hourly', 'twicedaily', 'daily', 'weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

function schedInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export interface ScheduleParts {
    frequency: ScheduleFrequency;
    hour: number;
    minute: number;
    /** 0 = domingo … 6 = sábado. */
    weekday: number;
    /** 1-28 (los meses cortos no tienen 29-31). */
    day: number;
}

/** Lee la frecuencia del config con defaults: diario a las 9:00. */
export function scheduleParts(cfg: Record<string, unknown>): ScheduleParts {
    const f = cfg.frequency;
    return {
        frequency: (SCHEDULE_FREQUENCIES as readonly unknown[]).includes(f) ? (f as ScheduleFrequency) : 'daily',
        hour: schedInt(cfg.hour, 0, 23, 9),
        minute: schedInt(cfg.minute, 0, 59, 0),
        weekday: schedInt(cfg.weekday, 0, 6, 1),
        day: schedInt(cfg.day, 1, 28, 1),
    };
}

/**
 * v0.1.263 — En qué reloj corre una automatización programada: la zona propia
 * (`trigger_config.tz`, si alguien la eligió) o, si no, la de la EMPRESA. Sin
 * ninguna de las dos, UTC — y `source: 'fallback'` para que la interfaz lo
 * avise en vez de mostrar una zona que no es la real.
 */
export function scheduleTimeZone(
    cfg: Record<string, unknown>,
    tenantTimeZone: string | null | undefined,
): { tz: string; source: 'own' | 'tenant' | 'fallback' } {
    if (isValidTimeZone(cfg.tz)) return { tz: cfg.tz.trim(), source: 'own' };
    if (isValidTimeZone(tenantTimeZone)) return { tz: tenantTimeZone.trim(), source: 'tenant' };
    return { tz: FALLBACK_TIME_ZONE, source: 'fallback' };
}

/** El cron de una automatización programada (en su zona horaria `tz`). */
export function scheduleCron(cfg: Record<string, unknown>): string {
    const cron = typeof cfg.cron === 'string' ? cfg.cron.trim() : '';
    if (cron !== '') return cron;
    const p = scheduleParts(cfg);
    switch (p.frequency) {
        case 'hourly':
            return `${p.minute} * * * *`;
        case 'twicedaily':
            return `${p.minute} ${Math.min(p.hour, (p.hour + 12) % 24)},${Math.max(p.hour, (p.hour + 12) % 24)} * * *`;
        case 'weekly':
            return `${p.minute} ${p.hour} * * ${p.weekday}`;
        case 'monthly':
            return `${p.minute} ${p.hour} ${p.day} * *`;
        default:
            return `${p.minute} ${p.hour} * * *`;
    }
}
