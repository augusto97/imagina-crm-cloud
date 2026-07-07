/**
 * Tipos del cliente para el módulo de Automatizaciones (CLAUDE.md §15 Fase 2).
 * Espejan las shapes que devuelve `/imagina-crm/v1/lists/{list}/automations`,
 * `/automations/{id}/runs`, `/triggers` y `/actions`.
 */

export type TriggerSlug = 'record_created' | 'record_updated' | string;

export type ActionSlug = 'update_field' | 'call_webhook' | string;

/**
 * Forma de las condiciones (trigger filter / action condition / if_else
 * branch). Acepta dos shapes — `ConditionEvaluator::matches` backend
 * detecta cuál es:
 *
 *  1. Legacy plano `{slug: value}` (eq-only). Compat 0.1.x → 0.18.x.
 *  2. Nuevo array `[{slug, op, value}]` con operadores (0.20.0+).
 *
 * El UI nuevo (`<ConditionEditor>`) siempre escribe el shape 2 y lee
 * cualquiera de los dos.
 */
export type ConditionData =
    | Record<string, unknown>
    | Array<{ slug: string; op: string; value: unknown }>;

export interface TriggerConfig {
    field_filters?: ConditionData;
    changed_fields?: string[];
    [key: string]: unknown;
}

export interface ActionSpec {
    type: ActionSlug;
    config: Record<string, unknown>;
    /**
     * Condición opcional. Si se define y la evaluación contra el
     * registro del trigger falla, la acción se omite con
     * `status: 'skipped'`. Misma shape que `TriggerConfig.field_filters`.
     */
    condition?: ConditionData;
}

/**
 * Shape canónica del config de una acción `if_else`. El backend valida
 * recursivamente — `then_actions` y `else_actions` aceptan cualquier
 * acción válida (incluyendo otro `if_else`, hasta `MAX_IF_ELSE_DEPTH`
 * niveles).
 */
export interface IfElseActionConfig {
    condition: Record<string, unknown>;
    then_actions: ActionSpec[];
    else_actions: ActionSpec[];
    [key: string]: unknown;
}

export interface AutomationEntity {
    id: number;
    list_id: number;
    name: string;
    description: string | null;
    trigger_type: TriggerSlug;
    trigger_config: TriggerConfig;
    actions: ActionSpec[];
    is_active: boolean;
    created_by: number;
    created_at: string;
    updated_at: string;
}

export interface CreateAutomationInput {
    name: string;
    description?: string | null;
    trigger_type: TriggerSlug;
    trigger_config?: TriggerConfig;
    actions: ActionSpec[];
    is_active?: boolean;
}

export interface UpdateAutomationInput {
    name?: string;
    description?: string | null;
    trigger_type?: TriggerSlug;
    trigger_config?: TriggerConfig;
    actions?: ActionSpec[];
    is_active?: boolean;
}

export interface TriggerMeta {
    slug: TriggerSlug;
    label: string;
    event: string;
    config_schema: Record<string, Record<string, unknown>>;
}

export interface ActionMeta {
    slug: ActionSlug;
    label: string;
    config_schema: Record<string, Record<string, unknown>>;
}

export type AutomationRunStatus = 'pending' | 'running' | 'success' | 'failed';

export type ActionLogStatus = 'success' | 'failed' | 'skipped';

export interface ActionLogEntry {
    action: string;
    status: ActionLogStatus;
    message: string | null;
    details: Record<string, unknown>;
}

export interface AutomationRunEntity {
    id: number;
    automation_id: number;
    list_id: number;
    record_id: number | null;
    status: AutomationRunStatus;
    trigger_context: Record<string, unknown> | null;
    actions_log: ActionLogEntry[];
    error: string | null;
    retries: number;
    started_at: string | null;
    finished_at: string | null;
    created_at: string | null;
}
