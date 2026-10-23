import {
    checkRequiredIf,
    fieldValidationOf,
    isUserWritableType,
    jsonbKeyForField,
    requiredIfMatches,
    resolveFieldDefault,
    validateFieldValue,
    type FieldType,
} from '@imagina-base/shared';

import { getTenantTimeZone } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.300 — Valores por defecto y validaciones en el navegador, con las MISMAS
 * funciones de shared que usa el servidor (field-rules.ts): el alta se abre
 * con los valores por defecto puestos y avisa lo que el servidor rechazaría
 * antes del viaje. El servidor vuelve a validar todo igual.
 */

/** Los valores por defecto de los campos que se escriben a mano, por slug. */
export function fieldDefaultsBySlug(fields: readonly FieldEntity[], userId: number | null, now: Date = new Date()): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const timeZone = getTenantTimeZone() ?? 'UTC';
    for (const f of fields) {
        if (!isUserWritableType(f.type as FieldType)) continue;
        const v = resolveFieldDefault({ type: f.type as FieldType, config: f.config }, { now, timeZone, userId });
        if (v !== undefined) out[f.slug] = v;
    }
    return out;
}

/** ¿El campo es obligatorio AHORA (siempre, o porque se cumple su "obligatorio si")? */
export function isRequiredNow(field: FieldEntity, fields: readonly FieldEntity[], valuesBySlug: Record<string, unknown>): boolean {
    if (field.is_required) return true;
    const rule = fieldValidationOf(field.config)?.required_if;
    if (!rule || rule.field_id === null || rule.field_id === undefined) return false;
    const other = fields.find((f) => f.id === rule.field_id);
    if (!other) return false;
    return requiredIfMatches({ type: other.type as FieldType }, valuesBySlug[other.slug], rule.op, rule.value);
}

/**
 * Errores por slug de un borrador de alta: cada valor contra su campo
 * (forma + reglas) y los "obligatorio si". Vacío = se puede mandar.
 */
export function draftErrors(fields: readonly FieldEntity[], valuesBySlug: Record<string, unknown>): Record<string, string> {
    const errors: Record<string, string> = {};
    const data: Record<string, unknown> = {};
    for (const f of fields) {
        if (!isUserWritableType(f.type as FieldType)) continue;
        if (!(f.slug in valuesBySlug)) continue;
        const res = validateFieldValue({ type: f.type as FieldType, config: f.config, is_required: f.is_required }, valuesBySlug[f.slug]);
        if (!res.ok) errors[f.slug] = res.error;
        else data[jsonbKeyForField(f.id)] = res.value;
    }
    const ruleFields = fields.map((f) => ({ id: f.id, slug: f.slug, label: f.label, type: f.type as FieldType, config: f.config }));
    for (const e of checkRequiredIf(ruleFields, data)) {
        if (e.field.slug && errors[e.field.slug] === undefined) errors[e.field.slug] = e.message;
    }
    return errors;
}
