import { z } from 'zod';
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
export const conditionRuleSchema = z.object({
    field: z.string().min(1),
    op: filterOperatorSchema,
    value: z.unknown().optional(),
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
});
export type ActionMeta = z.infer<typeof actionMetaSchema>;
