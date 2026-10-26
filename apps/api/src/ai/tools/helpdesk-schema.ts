import { readHelpdeskMailboxMarker, readHelpdeskSettings, type Field } from '@imagina-base/shared';

/**
 * D2/E5 — La mesa de ayuda de una lista, en el vocabulario del modelo
 * (`get_list_schema`): si tiene buzón de soporte, cómo se mapea el correo, los
 * estados, las respuestas guardadas y la política de SLA. NUNCA secretos: del
 * buzón sólo viaja la dirección de soporte (ni servidor, ni usuario, ni
 * contraseña). null si la lista no usa la mesa de ayuda.
 */
export function describeHelpdeskForModel(listSettings: unknown, fieldById: Map<number, Field>): Record<string, unknown> | null {
    const marker = readHelpdeskMailboxMarker(listSettings);
    const s = readHelpdeskSettings(listSettings);
    if (!marker && !s.sla.enabled) return null;
    const slug = (id: number | null): string | null => (id ? (fieldById.get(id)?.slug ?? null) : null);
    const optionLabel = (fieldId: number | null, value: string | null): string | null => {
        if (value === null) return null;
        const f = fieldId ? fieldById.get(fieldId) : undefined;
        const opts = ((f?.config as { options?: Array<{ value?: string; label?: string }> } | undefined)?.options ?? []);
        return opts.find((o) => o.value === value)?.label ?? value;
    };
    const statusLabel = (v: string | null): string | null => optionLabel(s.status_field_id, v);
    const p = s.sla;
    return {
        mailbox: marker ? { connected: true, support_address: marker.support_address } : { connected: false },
        // Cada correo nuevo crea un registro; las respuestas del cliente se suman como comentarios.
        mapping: {
            title: slug(s.title_field_id),
            from_name: slug(s.from_name_field_id),
            from_email: slug(s.from_email_field_id),
            contact_relation: slug(s.contact_field_id),
            received_at: slug(s.received_at_field_id),
            body_text: slug(s.body_text_field_id),
            attachments: slug(s.attachments_field_id),
        },
        status_field: slug(s.status_field_id),
        initial_status: statusLabel(s.initial_status),
        paused_statuses: s.paused_statuses.map((v) => statusLabel(v)),
        closed_statuses: s.closed_statuses.map((v) => statusLabel(v)),
        reopen_status: statusLabel(s.reopen_status),
        reply_templates: s.reply_templates.map((t) => t.name),
        sla: p.enabled
            ? {
                  enabled: true,
                  priority_field: slug(p.priority_field_id),
                  targets: p.targets.map((t) => ({
                      priority: t.priority === null ? 'todas' : optionLabel(p.priority_field_id, t.priority),
                      first_response_hours: t.first_response_hours,
                      resolution_hours: t.resolution_hours,
                  })),
                  business_hours: {
                      days: p.calendar.days,
                      start: p.calendar.start,
                      end: p.calendar.end,
                      holidays: p.calendar.holidays === 'co' ? 'festivos de Colombia' : 'ninguno',
                  },
                  at_risk_percent: p.at_risk_percent,
                  notify: { user_ids: p.notify_user_ids, roles: p.notify_roles, team_ids: p.notify_team_ids, assignee_field: slug(p.notify_assignee_field_id) },
                  escalate: {
                      user_ids: p.escalate_user_ids,
                      roles: p.escalate_roles,
                      team_ids: p.escalate_team_ids,
                      set_field: slug(p.escalate_set_field_id),
                  },
                  // Columnas que mantiene el SLA (sólo lectura): se filtran, ordenan y agrupan.
                  columns: {
                      first_response_due: slug(p.first_due_field_id),
                      resolution_due: slug(p.resolution_due_field_id),
                      sla_status: slug(p.sla_status_field_id),
                  },
              }
            : { enabled: false },
    };
}
