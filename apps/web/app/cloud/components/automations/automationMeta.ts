import type {
    Automation,
    AutomationAction,
    AutomationTrigger,
    Field,
} from '@imagina-base/shared';

/** Etiquetas legibles de triggers y acciones (el backend NestJS no expone catálogo). */
export const TRIGGER_LABELS: Record<AutomationTrigger['type'], string> = {
    record_created: 'Se crea un registro',
    record_updated: 'Se actualiza un registro',
    field_changed: 'Cambia un campo',
    due_date_reached: 'Se alcanza una fecha',
    scheduled: 'En un horario (cron)',
};

export const ACTION_LABELS: Record<AutomationAction['type'], string> = {
    update_field: 'Actualizar un campo',
    create_record: 'Crear un registro',
    call_webhook: 'Llamar un webhook',
    send_email: 'Enviar un email',
};

/** Operadores de condición con etiqueta y si llevan valor. */
export const CONDITION_OPS: ReadonlyArray<{ op: string; label: string; nullary?: boolean }> = [
    { op: 'eq', label: 'es igual a' },
    { op: 'neq', label: 'no es igual a' },
    { op: 'contains', label: 'contiene' },
    { op: 'not_contains', label: 'no contiene' },
    { op: 'starts_with', label: 'empieza con' },
    { op: 'ends_with', label: 'termina con' },
    { op: 'gt', label: 'mayor que' },
    { op: 'gte', label: 'mayor o igual' },
    { op: 'lt', label: 'menor que' },
    { op: 'lte', label: 'menor o igual' },
    { op: 'is_null', label: 'está vacío', nullary: true },
    { op: 'is_not_null', label: 'no está vacío', nullary: true },
];

/** Resumen corto del trigger para la card de la lista. */
export function triggerSummary(trigger: AutomationTrigger, fields: Field[]): string {
    switch (trigger.type) {
        case 'scheduled':
            return `Horario · ${trigger.cron}`;
        case 'due_date_reached': {
            const f = fields.find((x) => x.id === trigger.field_id);
            const off = trigger.offset_minutes;
            const when = off === 0 ? '' : off > 0 ? ` (+${off}m)` : ` (${off}m)`;
            return `Fecha de ${f?.label ?? `#${trigger.field_id}`}${when}`;
        }
        case 'field_changed': {
            const f = fields.find((x) => x.id === trigger.field_id);
            return `Cambia ${f?.label ?? `#${trigger.field_id}`}`;
        }
        default:
            return TRIGGER_LABELS[trigger.type];
    }
}

/** Resumen corto de una acción para chips. */
export function actionSummary(action: AutomationAction, fields: Field[]): string {
    switch (action.type) {
        case 'update_field': {
            const f = fields.find((x) => x.id === action.field_id);
            return `Actualizar ${f?.label ?? `#${action.field_id}`}`;
        }
        case 'create_record':
            return 'Crear registro';
        case 'call_webhook':
            return 'Webhook';
        case 'send_email':
            return 'Email';
    }
}

/** Coerción liviana de un string de input a número/booleano/string. */
export function coerceValue(raw: string): unknown {
    if (raw === '') return '';
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n : raw;
}

/** Extrae las filas (field_id/op/value) de un filter_tree AND/OR plano. */
export function conditionToRows(
    condition: Automation['condition'],
): { logic: 'and' | 'or'; rows: Array<{ field_id: number | ''; op: string; value: string }> } {
    if (!condition || condition.type !== 'group') return { logic: 'and', rows: [] };
    const rows = condition.children
        .filter((c): c is Extract<typeof c, { type: 'condition' }> => c.type === 'condition')
        .map((c) => ({
            field_id: c.field_id as number | '',
            op: c.op,
            value: c.value === undefined || c.value === null ? '' : String(c.value),
        }));
    return { logic: condition.logic, rows };
}
