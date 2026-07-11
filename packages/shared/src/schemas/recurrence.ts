import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Recurrencias ClickUp-style sobre un campo `date`/`datetime` de un record
 * (paridad con `Recurrences/*` del plugin). Una recurrencia por
 * (record, campo de fecha) — el POST hace upsert.
 *
 * Triggers:
 *   - `status_change`: cuando el campo de estado cambia al valor target,
 *     la fecha avanza.
 *   - `schedule`: el tick periódico avanza la fecha cuando `now >= fecha`.
 *
 * Acciones: `update` muta el record actual; `clone` crea un record nuevo
 * con la fecha rodada (el original queda intacto).
 */
export const RECURRENCE_FREQUENCIES = [
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'days_after',
] as const;
export const recurrenceFrequencySchema = z.enum(RECURRENCE_FREQUENCIES);
export type RecurrenceFrequency = z.infer<typeof recurrenceFrequencySchema>;

export const RECURRENCE_MONTHLY_PATTERNS = [
    'same_day',
    'first_day',
    'last_day',
    'weekday',
] as const;
export const recurrenceMonthlyPatternSchema = z.enum(RECURRENCE_MONTHLY_PATTERNS);
export type RecurrenceMonthlyPattern = z.infer<typeof recurrenceMonthlyPatternSchema>;

export const RECURRENCE_TRIGGER_TYPES = ['status_change', 'schedule'] as const;
export const recurrenceTriggerTypeSchema = z.enum(RECURRENCE_TRIGGER_TYPES);
export type RecurrenceTriggerType = z.infer<typeof recurrenceTriggerTypeSchema>;

export const RECURRENCE_ACTION_TYPES = ['update', 'clone'] as const;
export const recurrenceActionTypeSchema = z.enum(RECURRENCE_ACTION_TYPES);
export type RecurrenceActionType = z.infer<typeof recurrenceActionTypeSchema>;

/**
 * DTO de recurrencia (espeja `RecurrenceEntity` del plugin). `repeat_until`
 * y `last_fired_at` son strings "naive" que se comparan lexicográficamente
 * contra los valores de fecha del JSONB (estilo plugin), NO timestamps.
 */
export const recurrenceSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    record_id: idSchema,
    date_field_id: idSchema,
    frequency: recurrenceFrequencySchema,
    interval_n: z.number().int().min(1),
    monthly_pattern: recurrenceMonthlyPatternSchema.nullable(),
    trigger_type: recurrenceTriggerTypeSchema,
    trigger_status_field_id: idSchema.nullable(),
    trigger_status_value: z.string().nullable(),
    action_type: recurrenceActionTypeSchema,
    update_status_field_id: idSchema.nullable(),
    update_status_value: z.string().nullable(),
    repeat_until: z.string().nullable(),
    last_fired_at: z.string().nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type RecurrenceDto = z.infer<typeof recurrenceSchema>;

/**
 * Input del upsert (POST /lists/:l/records/:id/recurrences). Las reglas
 * finas (campo de fecha de la lista, tipo select/checkbox del campo de
 * estado, etc.) se validan en el service contra los fields reales.
 */
export const recurrenceUpsertSchema = z.object({
    date_field_id: idSchema,
    frequency: recurrenceFrequencySchema,
    interval_n: z.number().int().min(1).default(1),
    monthly_pattern: recurrenceMonthlyPatternSchema.nullable().optional(),
    trigger_type: recurrenceTriggerTypeSchema.default('schedule'),
    trigger_status_field_id: idSchema.nullable().optional(),
    trigger_status_value: z.string().max(190).nullable().optional(),
    action_type: recurrenceActionTypeSchema.default('update'),
    update_status_field_id: idSchema.nullable().optional(),
    update_status_value: z.string().max(190).nullable().optional(),
    repeat_until: z.string().max(32).nullable().optional(),
});
export type RecurrenceUpsertInput = z.infer<typeof recurrenceUpsertSchema>;
