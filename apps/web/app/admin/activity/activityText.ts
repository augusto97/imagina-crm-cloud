import { formatDuration, formatPhone, type DurationFormat } from '@imagina-base/shared';
import { formatFieldNumber } from '@/lib/fieldNumberFormat';
import { __, sprintf } from '@/lib/i18n';
import { formatDateStr, formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { ActivityEntity } from '@/types/activity';

/**
 * Traducción del log de actividad a lenguaje humano (v0.1.149).
 *
 * El backend guarda el diff por CLAVE JSONB (`{"f101": {from, to}}`) — el id
 * es la verdad, el slug es etiqueta (regla de oro nº 1). Para leerlo hace
 * falta el catálogo de campos de la lista, que la ficha ya tiene cargado. Sin
 * el catálogo (un campo borrado, por ejemplo) se cae al nombre crudo en vez
 * de esconder el cambio: es preferible "cambió f101" a no decir nada.
 */

export interface FieldChange {
    /** Etiqueta legible del campo ("Estado"). */
    label: string;
    field: FieldEntity | undefined;
    from: unknown;
    to: unknown;
    /**
     * El cambio es de la DESCRIPCIÓN del registro (el documento), no de un
     * campo: se lee "editó la descripción" con un adelanto del texto, nunca
     * como "cambió description de X a Y".
     */
    description?: boolean;
}

/** Clave del diff que usa el backend para la descripción del registro. */
export const DESCRIPTION_KEY = 'description';

/** Los cambios de una entrada, ya resueltos contra el catálogo de campos. */
export function changesOf(entry: ActivityEntity, fields: FieldEntity[]): FieldChange[] {
    const raw = entry.changes;
    if (raw === null || typeof raw !== 'object') return [];
    const byKey = new Map(fields.map((f) => [`f${f.id}`, f]));
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const out: FieldChange[] = [];
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === null || typeof value !== 'object') continue;
        if (key === DESCRIPTION_KEY) {
            // `{from,to}` desde v0.1.286; `{old,new}` en las entradas viejas.
            const d = value as { from?: unknown; to?: unknown; old?: unknown; new?: unknown };
            out.push({
                label: __('Descripción'),
                field: undefined,
                from: d.from ?? d.old ?? null,
                to: d.to ?? d.new ?? null,
                description: true,
            });
            continue;
        }
        const pair = value as { from?: unknown; to?: unknown; before?: unknown; after?: unknown };
        // `from/to` es el shape del backend cloud; `before/after` quedó del
        // plugin y se acepta por si alguna entrada vieja lo trae.
        const hasPair = 'from' in pair || 'to' in pair || 'before' in pair || 'after' in pair;
        if (!hasPair) continue;
        const field = byKey.get(key) ?? bySlug.get(key);
        out.push({
            label: field?.label ?? key,
            field,
            from: pair.from ?? pair.before ?? null,
            to: pair.to ?? pair.after ?? null,
        });
    }
    return out;
}

/** ¿La entrada la produjo una persona o el sistema (automatización, import)? */
export function actorOf(entry: ActivityEntity): string {
    if (entry.user_name !== null && entry.user_name !== undefined && entry.user_name !== '') {
        return entry.user_name;
    }
    if (entry.user_id !== null && entry.user_id > 0) {
        return sprintf(/* translators: %d: user id */ __('Usuario #%d'), entry.user_id);
    }
    return __('El sistema');
}

/**
 * A8 — una dependencia agregada o quitada, contada desde ESTE registro:
 * «marcó que está bloqueado por «Diseño»» / «quitó que bloqueaba a «Pruebas»».
 */
export function dependencyText(entry: ActivityEntity): string {
    const dep = (entry.changes as { dependency?: { kind?: string; title?: string; record_id?: number } } | null)?.dependency;
    const title = dep?.title ? `«${dep.title}»` : dep?.record_id ? sprintf(__('el registro #%d'), dep.record_id) : __('otro registro');
    const added = entry.action === 'dependency_added';
    if (dep?.kind === 'blocks') {
        return added ? sprintf(__('marcó que bloquea a %s'), title) : sprintf(__('quitó que bloqueaba a %s'), title);
    }
    return added ? sprintf(__('marcó que está bloqueado por %s'), title) : sprintf(__('quitó que estaba bloqueado por %s'), title);
}

function quoted(s: unknown, fallback: string): string {
    return typeof s === 'string' && s !== '' ? `«${s}»` : fallback;
}

/**
 * A9 — Una entrada de checklist en lenguaje claro: «marcó «Firmar» como hecho
 * en «Arranque»», «agregó 3 ítems al checklist «Arranque»»… El backend guarda
 * `{checklist: {id, name}, item?: {id, text}, count?, items?, changes?}`.
 */
export function checklistText(entry: ActivityEntity): string {
    const c = (entry.changes ?? {}) as {
        checklist?: { name?: string };
        item?: { text?: string };
        count?: number;
        items?: string[];
        from?: string;
        template_id?: number;
        changes?: Record<string, { from?: unknown; to?: unknown }>;
    };
    const list = quoted(c.checklist?.name, __('un checklist'));
    const item = quoted(c.item?.text, __('un ítem'));
    switch (entry.action) {
        case 'checklist_created':
            if (c.template_id) return sprintf(__('agregó el checklist %s desde una plantilla'), list);
            return (c.count ?? 0) > 0
                ? sprintf(__('agregó el checklist %1$s con %2$d ítems'), list, c.count ?? 0)
                : sprintf(__('agregó el checklist %s'), list);
        case 'checklist_updated':
            return sprintf(__('cambió el nombre del checklist %1$s a %2$s'), quoted(c.from, __('sin nombre')), list);
        case 'checklist_deleted':
            return sprintf(__('eliminó el checklist %s'), list);
        case 'checklist_items_added': {
            const n = c.count ?? c.items?.length ?? 0;
            if (n === 1 && c.items?.[0]) return sprintf(__('agregó %1$s al checklist %2$s'), quoted(c.items[0], __('un ítem')), list);
            return sprintf(__('agregó %1$d ítems al checklist %2$s'), n, list);
        }
        case 'checklist_item_checked':
            return sprintf(__('marcó %1$s como hecho en %2$s'), item, list);
        case 'checklist_item_unchecked':
            return sprintf(__('desmarcó %1$s en %2$s'), item, list);
        case 'checklist_item_deleted':
            return sprintf(__('eliminó %1$s del checklist %2$s'), item, list);
        case 'checklist_item_to_subtask':
            return sprintf(__('convirtió %s en subtarea'), item);
        case 'checklist_item_updated': {
            const ch = c.changes ?? {};
            if (ch.text) return sprintf(__('cambió el ítem %1$s a %2$s'), quoted(ch.text.from, __('un ítem')), quoted(ch.text.to, __('un ítem')));
            if (ch.checklist) return sprintf(__('movió %1$s al checklist %2$s'), item, quoted(ch.checklist.to, __('otro checklist')));
            if (ch.assignee_id) return ch.assignee_id.to ? sprintf(__('asignó %s a alguien'), item) : sprintf(__('quitó el responsable de %s'), item);
            if (ch.due) return ch.due.to ? sprintf(__('cambió la fecha de %s'), item) : sprintf(__('quitó la fecha de %s'), item);
            return sprintf(__('editó %s'), item);
        }
        default:
            return __('actualizó un checklist');
    }
}

/** C6 — «creó este registro desde la plantilla «Nuevo cliente» (3 subtareas, 1 checklist)». */
export function templateAppliedText(entry: ActivityEntity): string {
    const c = (entry.changes ?? {}) as { template?: { name?: string }; subtasks?: number; checklists?: number };
    const name = quoted(c.template?.name, __('una plantilla'));
    const parts: string[] = [];
    if ((c.subtasks ?? 0) > 0) parts.push(c.subtasks === 1 ? __('1 subtarea') : sprintf(__('%d subtareas'), c.subtasks ?? 0));
    if ((c.checklists ?? 0) > 0) parts.push(c.checklists === 1 ? __('1 checklist') : sprintf(__('%d checklists'), c.checklists ?? 0));
    const base = sprintf(__('aplicó la plantilla %s'), name);
    return parts.length > 0 ? `${base} (${parts.join(', ')})` : base;
}

/** Lo que guardó un presionado de botón (`diff.button`). */
export function buttonPressOf(entry: Pick<ActivityEntity, 'changes'>): { label: string; ok: boolean; error: string | null } {
    const raw = (entry.changes as Record<string, unknown> | null | undefined)?.button;
    const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
        label: typeof b.label === 'string' && b.label !== '' ? b.label : __('un botón'),
        ok: b.ok !== false,
        error: typeof b.error === 'string' && b.error !== '' ? b.error : null,
    };
}

/**
 * C5 — Lo que guardó un evento de aprobación (`diff.approval`): `event`
 * (requested | approved_step | approved | rejected | returned | cancelled),
 * flujo, paso (índice 0), pasos, motivo, nota, automatización.
 */
export function approvalText(entry: Pick<ActivityEntity, 'changes'>): string {
    const raw = (entry.changes as Record<string, unknown> | null | undefined)?.approval;
    const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const flow = typeof a.flow === 'string' && a.flow !== '' ? a.flow : __('aprobación');
    const steps = typeof a.steps === 'number' && a.steps > 0 ? a.steps : 1;
    const step = (typeof a.step === 'number' && a.step >= 0 ? a.step : 0) + 1;
    const reason = typeof a.reason === 'string' ? a.reason.trim() : '';
    const note = typeof a.note === 'string' ? a.note.trim() : '';
    const automation = typeof a.automation === 'string' && a.automation !== '' ? a.automation : null;
    const waiting = typeof a.waiting_on === 'number' ? a.waiting_on : 0;
    const withReason = (text: string): string => (reason !== '' ? `${text}: ${reason}` : text);
    switch (a.event) {
        case 'requested': {
            let text = sprintf(/* translators: %s: nombre del flujo */ __('pidió aprobación (%s)'), flow);
            if (automation) text += ` · ${sprintf(__('desde la automatización «%s»'), automation)}`;
            return note !== '' ? `${text} · ${note}` : text;
        }
        case 'approved_step': {
            const text = sprintf(/* translators: %1$d paso, %2$d total */ __('aprobó el paso %1$d de %2$d'), step, steps);
            return waiting > 0
                ? `${text} · ${waiting === 1 ? __('falta 1 persona') : sprintf(__('faltan %d personas'), waiting)}`
                : text;
        }
        case 'approved':
            return steps > 1
                ? sprintf(__('aprobó el paso %1$d de %2$d · la solicitud quedó aprobada (%3$s)'), step, steps, flow)
                : sprintf(__('aprobó la solicitud (%s)'), flow);
        case 'rejected':
            return withReason(steps > 1 ? sprintf(__('rechazó en el paso %1$d de %2$d'), step, steps) : __('rechazó'));
        case 'returned':
            return withReason(__('devolvió la solicitud para corregir'));
        case 'cancelled':
            return withReason(sprintf(__('canceló la solicitud de aprobación (%s)'), flow));
        default:
            return sprintf(__('actualizó la aprobación (%s)'), flow);
    }
}

/** El verbo de la entrada, en pasado y con sujeto ya puesto aparte. */
export function actionText(entry: ActivityEntity, changeCount: number): string {
    switch (entry.action) {
        case 'record_created':
        case 'record.created':
            return __('creó este registro');
        case 'record_deleted':
        case 'record.deleted':
            return __('eliminó este registro');
        case 'record_restored':
            return __('restauró este registro desde la papelera');
        case 'comment.created':
            return __('comentó');
        case 'comment.updated':
            return __('editó un comentario');
        case 'comment.deleted':
            return __('eliminó un comentario');
        case 'automation.run':
            return __('ejecutó una automatización');
        case 'dependency_added':
        case 'dependency_removed':
            return dependencyText(entry);
        // C5 — aprobaciones: `diff.approval` = {event, flow, step, steps, reason?…}.
        case 'approval':
            return approvalText(entry);
        // A9 — checklists del registro.
        case 'checklist_created':
        case 'checklist_updated':
        case 'checklist_deleted':
        case 'checklist_items_added':
        case 'checklist_item_checked':
        case 'checklist_item_unchecked':
        case 'checklist_item_updated':
        case 'checklist_item_deleted':
        case 'checklist_item_to_subtask':
            return checklistText(entry);
        // C6 — el registro nació de una plantilla.
        case 'record_template_applied':
            return templateAppliedText(entry);
        // Campo «Botón»: `diff.button` = {label, ok, error?}.
        case 'button_pressed': {
            const b = buttonPressOf(entry);
            const said = sprintf(/* translators: %s: texto del botón */ __('presionó «%s»'), b.label);
            return b.ok ? said : `${said} · ${b.error ? sprintf(__('falló: %s'), b.error) : __('no terminó')}`;
        }
        default:
            // record_updated sin diff legible (o con campos que ya no existen).
            return changeCount === 0 ? __('actualizó este registro') : '';
    }
}

/**
 * El valor de un campo, formateado como lo ve el usuario en la ficha: fechas
 * y números con el formato regional de la empresa, selects con su etiqueta,
 * checkbox como Sí/No. `null` para vacío — quien renderiza decide cómo
 * mostrarlo (chip "vacío", tachado, etc.).
 */
export function formatActivityValue(field: FieldEntity | undefined, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return value.map((v) => formatActivityValue(field, v) ?? String(v)).join(', ');
    }
    if (field === undefined) {
        if (typeof value === 'number') return formatNumber(value, { maxFrac: 6 });
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    switch (field.type) {
        case 'checkbox':
            return value === true || value === 'true' || value === 1 ? __('Sí') : __('No');
        case 'date':
            return typeof value === 'string' ? formatDateStr(value) : String(value);
        case 'datetime':
            return typeof value === 'string' ? formatDateTimeStr(value) : String(value);
        case 'currency':
        case 'number': {
            // Con el formato de número de la empresa («150.000», no «150000»);
            // un número que llegó como texto también se formatea.
            const n = typeof value === 'number' ? value : Number(String(value).trim());
            return Number.isFinite(n) && String(value).trim() !== ''
                ? formatFieldNumber(field, n)
                : String(value);
        }
        case 'select':
        case 'multi_select': {
            const opts = (field.config as { options?: Array<{ value?: string; label?: string }> })
                .options;
            const found = Array.isArray(opts)
                ? opts.find((o) => String(o.value) === String(value))
                : undefined;
            return found?.label ?? String(value);
        }
        // v0.1.255 — salían crudos («Avance en 100», «Duración en 90»).
        case 'percent': {
            const n = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(n) ? `${formatNumber(n, { maxFrac: 2 })} %` : String(value);
        }
        case 'duration': {
            const text = formatDuration(value, (field.config as { format?: DurationFormat }).format);
            return text === '' ? String(value) : text;
        }
        case 'rating': {
            const n = typeof value === 'number' ? value : Number(value);
            const max = Number((field.config as { max?: number }).max) || 5;
            return Number.isFinite(n) ? sprintf(/* translators: 1: stars, 2: max */ __('%1$s de %2$s'), String(n), String(max)) : String(value);
        }
        case 'phone': {
            const text = formatPhone(value);
            return text === '' ? String(value) : text;
        }
        case 'user':
            // El NOMBRE lo resuelve `ActivityValue` (necesita una consulta);
            // éste es el texto de respaldo para un usuario borrado.
            return sprintf(/* translators: %s: user id */ __('Usuario #%s'), String(value));
        case 'file':
            return __('un archivo');
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
}

/**
 * La frase de UN cambio, al estilo ClickUp: "estableció Estado en Activo",
 * "cambió Ciudad de Bogotá a Medellín", "vació Teléfono".
 */
export function changeSentence(change: FieldChange): {
    verb: string;
    from: string | null;
    to: string | null;
} {
    if (change.description) {
        const to = typeof change.to === 'string' && change.to.trim() !== '' ? change.to.trim() : null;
        return { verb: to === null ? __('vació') : __('editó'), from: null, to };
    }
    const from = formatActivityValue(change.field, change.from);
    const to = formatActivityValue(change.field, change.to);
    if (from === null && to !== null) return { verb: __('estableció'), from: null, to };
    if (from !== null && to === null) return { verb: __('vació'), from, to: null };
    return { verb: __('cambió'), from, to };
}

/** Fecha relativa corta ("hace 7 min", "ayer"); la exacta va en el title. */
export function relativeTime(iso: string): string {
    const t = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z');
    const ms = Date.now() - t.getTime();
    if (Number.isNaN(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return __('hace un momento');
    if (min < 60) return sprintf(/* translators: %d: minutes */ __('hace %d min'), min);
    const hours = Math.round(min / 60);
    if (hours < 24) return sprintf(/* translators: %d: hours */ __('hace %d h'), hours);
    const days = Math.round(hours / 24);
    if (days === 1) return __('ayer');
    if (days < 30) return sprintf(/* translators: %d: days */ __('hace %d días'), days);
    const months = Math.round(days / 30);
    if (months < 12) {
        return months === 1 ? __('hace 1 mes') : sprintf(/* translators: %d: months */ __('hace %d meses'), months);
    }
    const years = Math.round(months / 12);
    return years === 1 ? __('hace 1 año') : sprintf(/* translators: %d: years */ __('hace %d años'), years);
}

/**
 * Toda la entrada en UNA línea de texto ("Augusto cambió Estado de Activo a
 * Pausado"). La usa el timeline del layout CRM, que no tiene lugar para el
 * bloque de varias líneas del panel lateral.
 */
export function summarizeActivity(entry: ActivityEntity, fields: FieldEntity[]): string {
    const changes = changesOf(entry, fields);
    const actor = actorOf(entry);
    const verb = actionText(entry, changes.length);
    if (changes.length === 0) return `${actor} ${verb}`.trim();
    const parts = changes.map((c) => {
        if (c.description) return descriptionSentence(c);
        const s = changeSentence(c);
        if (s.from !== null && s.to !== null) {
            return sprintf(
                /* translators: 1: verb, 2: field, 3: old value, 4: new value */
                __('%1$s %2$s de %3$s a %4$s'),
                s.verb,
                c.label,
                s.from,
                s.to,
            );
        }
        if (s.to !== null) {
            return sprintf(
                /* translators: 1: verb, 2: field, 3: value */
                __('%1$s %2$s en %3$s'),
                s.verb,
                c.label,
                s.to,
            );
        }
        return sprintf(/* translators: 1: verb, 2: field */ __('%1$s %2$s'), s.verb, c.label);
    });
    return `${actor} ${parts.join('; ')}`;
}

/** "editó la descripción" / "vació la descripción". */
export function descriptionSentence(change: FieldChange): string {
    const { to } = changeSentence(change);
    return to === null ? __('vació la descripción') : __('editó la descripción');
}
