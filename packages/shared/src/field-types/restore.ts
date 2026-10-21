import { isUserWritableType, type FieldType } from '../schemas/field';
import { isNullish, validateFieldValue } from './validate';

/**
 * v0.1.288 — ¿Se puede volver a poner un valor del historial de un campo?
 *
 * El historial guarda el valor TAL COMO ERA cuando se escribió. Desde entonces
 * el campo pudo cambiar: se borró la opción elegida, se convirtió de tipo, se
 * volvió obligatorio. Restaurar a ciegas haría que el servidor rechace el
 * cambio con un error genérico — o peor, que guarde algo que ya no significa
 * lo mismo. Aquí se decide ANTES de intentarlo y se explica por qué no, con
 * el mismo validador que usa el servidor al escribir (un shape, una
 * definición).
 */
export interface RestoreFieldSpec {
    type: FieldType;
    config: Record<string, unknown>;
    is_required: boolean;
    label?: string;
}

export type RestoreCheck = { ok: true; value: unknown } | { ok: false; reason: string };

function optionLabels(config: Record<string, unknown>): Map<string, string> {
    const out = new Map<string, string>();
    const opts = config.options;
    if (!Array.isArray(opts)) return out;
    for (const o of opts) {
        if (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string') {
            const v = (o as { value: string; label?: unknown }).value;
            out.set(v, typeof (o as { label?: unknown }).label === 'string' ? String((o as { label: string }).label) : v);
        }
    }
    return out;
}

export function checkRestoreValue(field: RestoreFieldSpec, value: unknown): RestoreCheck {
    if (!isUserWritableType(field.type)) {
        return { ok: false, reason: 'Este campo se calcula solo: su valor no se escribe a mano.' };
    }
    if (isNullish(value) && field.type !== 'checkbox') {
        if (field.is_required) {
            return { ok: false, reason: 'El campo es obligatorio ahora: no se puede dejar vacío.' };
        }
        return { ok: true, value: null };
    }
    // Opciones que ya no existen: se nombran, así la persona sabe cuál falta.
    if (field.type === 'select' || field.type === 'multi_select') {
        const known = optionLabels(field.config);
        const values = Array.isArray(value) ? value : [value];
        if (values.some((v) => typeof v !== 'string')) {
            return { ok: false, reason: 'El valor era de otro tipo de campo: no encaja con las opciones de ahora.' };
        }
        const missing = (values as string[]).filter((v) => known.size > 0 && !known.has(v));
        if (missing.length > 0) {
            const names = missing.map((m) => `«${m}»`).join(', ');
            return {
                ok: false,
                reason:
                    missing.length === 1
                        ? `La opción ${names} ya no existe en el campo.`
                        : `Las opciones ${names} ya no existen en el campo.`,
            };
        }
    }
    const checked = validateFieldValue({ type: field.type, config: field.config, is_required: field.is_required }, value);
    if (!checked.ok) {
        return { ok: false, reason: `Ese valor ya no es válido para el campo (¿cambió de tipo o de configuración?): ${checked.error}` };
    }
    return { ok: true, value: checked.value };
}

/** ¿El valor del historial es el mismo que tiene el campo ahora? (para no ofrecer «restaurar» lo que ya está). */
export function sameFieldValue(a: unknown, b: unknown): boolean {
    const norm = (v: unknown): unknown => {
        if (isNullish(v)) return null;
        if (Array.isArray(v)) return [...v].map(String).sort();
        return v;
    };
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
