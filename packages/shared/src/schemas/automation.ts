import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { filterTreeSchema } from './filter';

/**
 * Automatizaciones (CONTRACT.md §8): triggers × actions + condiciones
 * (mismo filter tree) + runs con logs. El motor corre sobre BullMQ.
 */

// --- Triggers ---
export const AUTOMATION_TRIGGERS = [
    'record_created',
    'record_updated',
    'field_changed',
    'due_date_reached',
    'scheduled',
] as const;

export const triggerSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('record_created') }),
    z.object({ type: z.literal('record_updated') }),
    z.object({
        type: z.literal('field_changed'),
        field_id: idSchema,
        to: z.unknown().optional(),
    }),
    z.object({
        type: z.literal('due_date_reached'),
        field_id: idSchema,
        offset_minutes: z.number().int().default(0),
    }),
    z.object({
        type: z.literal('scheduled'),
        cron: z.string().min(1),
    }),
]);
export type AutomationTrigger = z.infer<typeof triggerSchema>;

// --- Actions ---
export const AUTOMATION_ACTIONS = [
    'send_email',
    'call_webhook',
    'update_field',
    'create_record',
] as const;

export const actionSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('send_email'),
        to: z.string().min(1), // email literal o slug de campo (merge tag)
        subject: z.string().min(1),
        body: z.string(),
    }),
    z.object({
        type: z.literal('call_webhook'),
        url: z.string().url(),
        secret: z.string().optional(), // firma HMAC
    }),
    z.object({
        type: z.literal('update_field'),
        field_id: idSchema,
        value: z.unknown(),
    }),
    z.object({
        type: z.literal('create_record'),
        list_id: idSchema,
        data: z.record(z.string().regex(/^f\d+$/), z.unknown()),
    }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

// --- Entidad ---
export const automationSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    name: z.string().min(1).max(190),
    trigger: triggerSchema,
    actions: z.array(actionSchema),
    condition: filterTreeSchema.nullable(),
    is_active: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type Automation = z.infer<typeof automationSchema>;

export const createAutomationSchema = z.object({
    name: z.string().trim().min(1).max(190),
    trigger: triggerSchema,
    actions: z.array(actionSchema).min(1),
    condition: filterTreeSchema.optional(),
    is_active: z.boolean().optional(),
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z
    .object({
        name: z.string().trim().min(1).max(190),
        trigger: triggerSchema,
        actions: z.array(actionSchema).min(1),
        condition: filterTreeSchema.nullable(),
        is_active: z.boolean(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El patch no puede estar vacío' });
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

// --- Runs ---
export const AUTOMATION_RUN_STATUSES = ['success', 'failed', 'skipped'] as const;
export const automationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export const automationRunSchema = z.object({
    id: idSchema,
    automation_id: idSchema,
    record_id: idSchema.nullable(),
    status: automationRunStatusSchema,
    logs: z.array(z.string()),
    duration_ms: z.number().int().nonnegative(),
    created_at: isoDateTimeSchema,
});
export type AutomationRun = z.infer<typeof automationRunSchema>;
