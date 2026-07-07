/**
 * Recurrencia ClickUp-style sobre un campo `date`/`datetime` de un
 * record. Espeja `RecurrenceEntity` del backend.
 */

export type RecurrenceFrequency =
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'days_after';

export type RecurrenceMonthlyPattern =
    | 'same_day'
    | 'first_day'
    | 'last_day'
    | 'weekday';

export type RecurrenceTriggerType = 'status_change' | 'schedule';

export type RecurrenceActionType = 'update' | 'clone';

export interface Recurrence {
    id: number;
    list_id: number;
    record_id: number;
    date_field_id: number;
    frequency: RecurrenceFrequency;
    interval_n: number;
    monthly_pattern: RecurrenceMonthlyPattern | null;
    trigger_type: RecurrenceTriggerType;
    trigger_status_field_id: number | null;
    trigger_status_value: string | null;
    action_type: RecurrenceActionType;
    update_status_field_id: number | null;
    update_status_value: string | null;
    repeat_until: string | null;
    last_fired_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface RecurrenceUpsertInput {
    date_field_id: number;
    frequency: RecurrenceFrequency;
    interval_n: number;
    monthly_pattern?: RecurrenceMonthlyPattern | null;
    trigger_type: RecurrenceTriggerType;
    trigger_status_field_id?: number | null;
    trigger_status_value?: string | null;
    action_type: RecurrenceActionType;
    update_status_field_id?: number | null;
    update_status_value?: string | null;
    repeat_until?: string | null;
}
