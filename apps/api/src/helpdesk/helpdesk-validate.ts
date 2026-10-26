import type { Field, HelpdeskSettings } from '@imagina-base/shared';

/**
 * D2/E5 — ¿La configuración de la mesa de ayuda tiene sentido contra los
 * campos de HOY de la lista? Cada `*_field_id` tiene que ser un campo de esta
 * lista del tipo que corresponde, y cada estado / prioridad una opción que
 * exista. PURO: devuelve `ruta → motivo` (vacío = válido).
 */
export function helpdeskSettingsErrors(s: HelpdeskSettings, fields: readonly Field[]): Record<string, string> {
    const errors: Record<string, string> = {};
    const byId = new Map(fields.map((f) => [f.id, f]));
    const optionValues = (f: Field | undefined): Set<string> =>
        new Set(
            (((f?.config as { options?: unknown } | undefined)?.options as Array<{ value?: unknown }> | undefined) ?? [])
                .map((o) => (typeof o?.value === 'string' ? o.value : ''))
                .filter((v) => v !== ''),
        );
    const need = (path: string, id: number | null, types: readonly string[], what: string): Field | undefined => {
        if (id === null) return undefined;
        const f = byId.get(id);
        if (!f) {
            errors[path] = `El campo elegido para ${what} ya no existe en la lista.`;
            return undefined;
        }
        if (!types.includes(f.type)) errors[path] = `«${f.label}» no sirve para ${what}.`;
        return f;
    };

    need('title_field_id', s.title_field_id, ['text', 'long_text'], 'el asunto');
    need('from_name_field_id', s.from_name_field_id, ['text'], 'el nombre del remitente');
    need('from_email_field_id', s.from_email_field_id, ['email', 'text'], 'el correo del remitente');
    need('contact_field_id', s.contact_field_id, ['relation'], 'el vínculo al contacto');
    need('received_at_field_id', s.received_at_field_id, ['datetime', 'date'], 'la fecha de recepción');
    need('body_text_field_id', s.body_text_field_id, ['long_text', 'text'], 'la copia en texto del correo');
    need('attachments_field_id', s.attachments_field_id, ['file'], 'los adjuntos');

    const status = need('status_field_id', s.status_field_id, ['select'], 'el estado');
    const statusValues = optionValues(status);
    const checkStatus = (path: string, v: string | null): void => {
        if (v === null) return;
        if (!status) {
            errors[path] = 'Primero elige el campo de estado.';
            return;
        }
        if (!statusValues.has(v)) errors[path] = `«${v}» no es una opción de «${status.label}».`;
    };
    checkStatus('initial_status', s.initial_status);
    checkStatus('reopen_status', s.reopen_status);
    s.paused_statuses.forEach((v, i) => checkStatus(`paused_statuses.${i}`, v));
    s.closed_statuses.forEach((v, i) => checkStatus(`closed_statuses.${i}`, v));
    const both = s.paused_statuses.filter((v) => s.closed_statuses.includes(v));
    if (both.length > 0) errors.paused_statuses = `«${both[0]}» no puede pausar y cerrar a la vez.`;

    const sla = s.sla;
    const priority = need('sla.priority_field_id', sla.priority_field_id, ['select'], 'la prioridad');
    const priorities = optionValues(priority);
    const seen = new Set<string>();
    sla.targets.forEach((t, i) => {
        const key = t.priority ?? '*';
        if (seen.has(key)) errors[`sla.targets.${i}.priority`] = 'Esa prioridad ya tiene objetivos.';
        seen.add(key);
        if (t.priority !== null && (!priority || !priorities.has(t.priority))) {
            errors[`sla.targets.${i}.priority`] = priority ? `«${t.priority}» no es una opción de «${priority.label}».` : 'Elige el campo de prioridad.';
        }
    });
    if (sla.calendar.days.length === 0) errors['sla.calendar.days'] = 'Elige al menos un día laborable.';
    if (sla.calendar.end <= sla.calendar.start) errors['sla.calendar.end'] = 'La hora de fin tiene que ser después de la de inicio.';
    need('sla.notify_assignee_field_id', sla.notify_assignee_field_id, ['user'], 'el responsable');
    const esc = need('sla.escalate_set_field_id', sla.escalate_set_field_id, ['select', 'user', 'checkbox'], 'el escalamiento');
    if (esc?.type === 'select' && sla.escalate_set_value !== null && !optionValues(esc).has(sla.escalate_set_value)) {
        errors['sla.escalate_set_value'] = `«${sla.escalate_set_value}» no es una opción de «${esc.label}».`;
    }
    need('sla.first_due_field_id', sla.first_due_field_id, ['datetime'], 'el vencimiento de la primera respuesta');
    need('sla.resolution_due_field_id', sla.resolution_due_field_id, ['datetime'], 'el vencimiento de la resolución');
    need('sla.sla_status_field_id', sla.sla_status_field_id, ['select'], 'el estado del SLA');

    // Las columnas del SLA son SUYAS: no pueden ser, además, parte del mapeo.
    const managed = [sla.first_due_field_id, sla.resolution_due_field_id, sla.sla_status_field_id].filter((v): v is number => v !== null);
    if (new Set(managed).size !== managed.length) errors['sla.first_due_field_id'] = 'Cada columna del SLA tiene que ser un campo distinto.';
    const mapped: Array<[string, number | null]> = [
        ['title_field_id', s.title_field_id],
        ['from_name_field_id', s.from_name_field_id],
        ['from_email_field_id', s.from_email_field_id],
        ['received_at_field_id', s.received_at_field_id],
        ['status_field_id', s.status_field_id],
        ['sla.priority_field_id', sla.priority_field_id],
        ['sla.escalate_set_field_id', sla.escalate_set_field_id],
    ];
    for (const [path, id] of mapped) {
        if (id !== null && managed.includes(id)) errors[path] = 'Ese campo lo mantiene el SLA: elige otro.';
    }
    return errors;
}
