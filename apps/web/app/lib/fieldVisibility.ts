import {
    fieldShowIfOf,
    fieldsHiddenByCondition,
    isUserWritableType,
    jsonbKeyForField,
    showIfHiddenReason,
    validateFieldValue,
    type FieldShowIf,
    type FieldType,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.457 (A7) — «Mostrar sólo si…» en el navegador, con la MISMA función
 * de shared que usa el servidor (`fieldsHiddenByCondition`). El navegador
 * trabaja por slug; las condiciones miran los datos por `f{id}` ya
 * normalizados (un número tipeado como texto, la etiqueta de una opción…),
 * igual que el servidor al guardar.
 */

type VisInput = Pick<FieldEntity, 'id' | 'slug' | 'label' | 'type' | 'config'>;

/** ¿La lista tiene algún campo con condición? (si no, nada que calcular). */
export function hasConditionalFields(fields: readonly VisInput[]): boolean {
    return fields.some((f) => fieldShowIfOf(f.config) !== null);
}

/** Los valores por slug → los datos por `f{id}` normalizados. */
function dataOf(fields: readonly VisInput[], valuesBySlug: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
        if (!(f.slug in valuesBySlug)) continue;
        const raw = valuesBySlug[f.slug];
        if (isUserWritableType(f.type as FieldType)) {
            const res = validateFieldValue({ type: f.type as FieldType, config: f.config, is_required: false }, raw);
            data[jsonbKeyForField(f.id)] = res.ok ? res.value : raw;
        } else {
            data[jsonbKeyForField(f.id)] = raw;
        }
    }
    return data;
}

function visFields(fields: readonly VisInput[]): Array<{ id: number; slug: string; label: string; type: string; config: Record<string, unknown> }> {
    return fields.map((f) => ({ id: f.id, slug: f.slug, label: f.label, type: f.type, config: f.config ?? {} }));
}

/** Los campos que su condición oculta con estos valores (id → su condición). */
export function conditionHiddenFields(fields: readonly VisInput[], valuesBySlug: Record<string, unknown>): Map<number, FieldShowIf> {
    if (!hasConditionalFields(fields)) return new Map();
    return fieldsHiddenByCondition(visFields(fields), dataOf(fields, valuesBySlug));
}

/** El motivo para mostrarle a la persona por qué un campo no aplica (o null). */
export function conditionHiddenReasonOf(
    hidden: ReadonlyMap<number, FieldShowIf>,
    fieldId: number,
    fields: readonly VisInput[],
): string | null {
    const rule = hidden.get(fieldId);
    return rule ? showIfHiddenReason(rule, visFields(fields)) : null;
}

/**
 * Para la tabla: el motivo de cada celda que no aplica, calculado UNA vez
 * por fila (la caché se indexa por el objeto de valores del registro, que
 * TanStack conserva mientras no cambie).
 */
export function makeConditionReasons(fields: readonly VisInput[]): ((values: Record<string, unknown>, fieldId: number) => string | null) | null {
    if (!hasConditionalFields(fields)) return null;
    const cache = new WeakMap<object, Map<number, FieldShowIf>>();
    const vf = visFields(fields);
    return (values, fieldId) => {
        let hidden = cache.get(values);
        if (!hidden) {
            hidden = fieldsHiddenByCondition(vf, dataOf(fields, values));
            cache.set(values, hidden);
        }
        const rule = hidden.get(fieldId);
        return rule ? showIfHiddenReason(rule, vf) : null;
    };
}

/**
 * El aviso para la confirmación de borrado de un campo que es CONDICIÓN de
 * otros («Mostrar sólo si…»): mientras esté en la papelera esa regla no
 * aplica (los campos se muestran), y al recuperarlo vuelve a aplicar.
 */
export function showIfDeleteWarning(field: Pick<FieldEntity, 'id'>, fields: readonly VisInput[]): string | null {
    const users = fields.filter((f) => f.id !== field.id && (fieldShowIfOf(f.config)?.conditions ?? []).some((c) => c.field_id === field.id));
    if (users.length === 0) return null;
    const names = users.map((f) => `«${f.label}»`).join(', ');
    return sprintf(
        users.length === 1
            ? __('El campo %s se muestra según éste: mientras esté en la papelera esa condición no aplica (se muestra siempre), y al recuperarlo vuelve a aplicar.')
            : __('Los campos %s se muestran según éste: mientras esté en la papelera esa condición no aplica (se muestran siempre), y al recuperarlo vuelve a aplicar.'),
        names,
    );
}
