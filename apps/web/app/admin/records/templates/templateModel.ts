import {
    describeRelativeDate,
    isTemplateValueType,
    type FieldType,
    type RecordTemplate,
    type RecordTemplateContent,
    type RelativeDate,
    type TemplatePerson,
    type TemplateValue,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * C6 — Lo puro del editor de plantillas de registro: qué campos admiten un
 * valor, con qué valor arranca cada uno y el resumen de una plantilla en
 * lenguaje claro. Aparte de los componentes para poder probarlo.
 */

export const EMPTY_CONTENT: RecordTemplateContent = { values: {}, subtasks: [], checklists: [], record_description: null };

export const RELATIVE_TODAY: RelativeDate = { days: 0, from_field_id: null, business_days: false, time: null };

/** Los campos de la lista a los que una plantilla les puede poner valor. */
export function templateValueFields(fields: readonly FieldEntity[]): FieldEntity[] {
    return fields.filter((f) => isTemplateValueType(f.type as FieldType));
}

export const isDateField = (f: Pick<FieldEntity, 'type'>): boolean => f.type === 'date' || f.type === 'datetime';
export const isUserField = (f: Pick<FieldEntity, 'type'>): boolean => f.type === 'user';

/** Con qué valor arranca un campo recién agregado a la plantilla. */
export function initialValueFor(field: Pick<FieldEntity, 'type'>): TemplateValue {
    if (isDateField(field)) return { mode: 'relative_date', date: { ...RELATIVE_TODAY } };
    if (isUserField(field)) return { mode: 'person', person: { kind: 'creator' } };
    if (field.type === 'checkbox') return { mode: 'fixed', value: true };
    return { mode: 'fixed', value: null };
}

/** «creador» / «el campo «Responsable»» / «una persona» — para resúmenes. */
export function describePerson(p: TemplatePerson | null, fields: readonly FieldEntity[], userName?: (id: number) => string | undefined): string {
    if (!p) return __('sin responsable');
    if (p.kind === 'creator') return __('quien crea el registro');
    if (p.kind === 'field') {
        const f = fields.find((x) => x.id === p.field_id);
        return f ? sprintf(__('el valor de «%s»'), f.label) : __('un campo que ya no existe');
    }
    return userName?.(p.user_id) ?? sprintf(__('la persona #%d'), p.user_id);
}

/** «+3 días hábiles desde «Inicio» a las 09:00» con las etiquetas de los campos. */
export function describeDate(d: RelativeDate, fields: readonly FieldEntity[]): string {
    return describeRelativeDate(d, (id) => fields.find((f) => f.id === id)?.label);
}

/** «4 valores · 3 subtareas · 2 checklists (12 ítems) · descripción». */
export function templateSummary(t: Pick<RecordTemplate, 'kind' | 'content'>): string {
    const c = t.content;
    const items = c.checklists.reduce((n, cl) => n + cl.items.length, 0);
    if (t.kind === 'checklist') {
        return items === 1 ? __('1 ítem') : sprintf(__('%d ítems'), items);
    }
    const parts: string[] = [];
    const nv = Object.keys(c.values).length;
    if (nv > 0) parts.push(nv === 1 ? __('1 valor') : sprintf(__('%d valores'), nv));
    if (c.subtasks.length > 0) parts.push(c.subtasks.length === 1 ? __('1 subtarea') : sprintf(__('%d subtareas'), c.subtasks.length));
    if (c.checklists.length > 0) {
        const cls = c.checklists.length === 1 ? __('1 checklist') : sprintf(__('%d checklists'), c.checklists.length);
        parts.push(`${cls} (${items === 1 ? __('1 ítem') : sprintf(__('%d ítems'), items)})`);
    }
    if (c.record_description !== null && c.record_description !== undefined) parts.push(__('descripción'));
    return parts.length > 0 ? parts.join(' · ') : __('Vacía: sólo crea el registro');
}

/**
 * El campo «del título» de las subtareas: el que la lista usa como título (o
 * el primer texto). La subtarea guarda su título aparte y el servidor lo pone
 * en ese campo; si la plantilla le pone valor a ese campo, el título gana.
 */
export function titleFieldOf(fields: readonly FieldEntity[]): FieldEntity | undefined {
    return fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
}

/** Saca de un valor fijo lo que no hace falta guardar (vacíos). */
export function cleanValues(values: RecordTemplateContent['values']): RecordTemplateContent['values'] {
    const out: RecordTemplateContent['values'] = {};
    for (const [k, v] of Object.entries(values)) {
        if (v.mode === 'fixed') {
            const x = v.value;
            if (x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)) continue;
        }
        out[k] = v;
    }
    return out;
}
