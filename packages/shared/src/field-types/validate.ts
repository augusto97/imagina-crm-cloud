import { isoDateSchema, isoDateTimeSchema } from '../schemas/common';
import type { FieldType } from '../schemas/field';

/**
 * Validación + normalización de valores de campo, portada del contrato del
 * plugin (`AbstractFieldType` + tipos concretos — CONTRACT.md §3). Vive en
 * `shared` porque el MISMO chequeo corre en el backend (al escribir records)
 * y en el frontend (feedback inline). Un shape, una definición.
 */

export interface FieldValueSpec {
    type: FieldType;
    config: Record<string, unknown>;
    is_required: boolean;
}

export type ValueValidation =
    | { ok: true; value: unknown }
    | { ok: false; error: string };

/** Reconoce ausencia de valor: null, "" y [] (igual que `isNullish` del plugin). */
export function isNullish(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
}

const ok = (value: unknown): ValueValidation => ({ ok: true, value });
const fail = (error: string): ValueValidation => ({ ok: false, error });

function optionValues(config: Record<string, unknown>): string[] {
    const options = config.options;
    if (!Array.isArray(options)) return [];
    return options
        .map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : undefined))
        .filter((v): v is string => typeof v === 'string');
}

/**
 * Valida y normaliza un valor para un campo. Devuelve el valor serializado
 * listo para guardar en `data` (nullish → null), o un error legible.
 * `checkbox` nunca falla por `required` (ausencia = false).
 */
export function validateFieldValue(field: FieldValueSpec, raw: unknown): ValueValidation {
    const { type, config, is_required } = field;

    // checkbox: caso especial, ausencia = false, jamás required-fail.
    if (type === 'checkbox') {
        if (raw === null || raw === undefined) return ok(false);
        if (typeof raw === 'boolean') return ok(raw);
        if (typeof raw === 'number') return ok(raw !== 0);
        if (typeof raw === 'string') {
            const v = raw.toLowerCase();
            if (['1', 'true', 'yes'].includes(v)) return ok(true);
            if (['0', 'false', 'no', ''].includes(v)) return ok(false);
        }
        return fail('Se esperaba un valor booleano.');
    }

    if (isNullish(raw)) {
        return is_required ? fail('Este campo es obligatorio.') : ok(null);
    }

    switch (type) {
        case 'text':
        case 'long_text': {
            if (typeof raw !== 'string') return fail('Se esperaba texto.');
            const max = numericConfig(config, 'max_length');
            if (max !== null && raw.length > max) return fail(`Máximo ${max} caracteres.`);
            return ok(raw);
        }
        case 'number':
        case 'currency': {
            const num = typeof raw === 'number' ? raw : Number(raw);
            if (typeof raw !== 'number' && (typeof raw !== 'string' || raw.trim() === '')) {
                return fail('Se esperaba un número.');
            }
            if (!Number.isFinite(num)) return fail('Se esperaba un número.');
            const min = numericConfig(config, 'min');
            const max = numericConfig(config, 'max');
            if (min !== null && num < min) return fail(`El valor mínimo es ${min}.`);
            if (max !== null && num > max) return fail(`El valor máximo es ${max}.`);
            return ok(num);
        }
        case 'select': {
            if (typeof raw !== 'string') return fail('Se esperaba una opción.');
            const allowed = optionValues(config);
            if (allowed.length > 0 && !allowed.includes(raw)) {
                return fail('Opción no válida para este campo.');
            }
            return ok(raw);
        }
        case 'multi_select': {
            if (!Array.isArray(raw)) return fail('Se esperaba una lista de opciones.');
            const allowed = optionValues(config);
            for (const item of raw) {
                if (typeof item !== 'string') return fail('Cada opción debe ser texto.');
                if (allowed.length > 0 && !allowed.includes(item)) {
                    return fail('Una opción no es válida.');
                }
            }
            return ok([...new Set(raw)]);
        }
        case 'date': {
            if (typeof raw !== 'string' || !isoDateSchema.safeParse(raw).success) {
                return fail('Fecha inválida. Usá formato YYYY-MM-DD.');
            }
            return ok(raw);
        }
        case 'datetime': {
            if (typeof raw !== 'string' || !isoDateTimeSchema.safeParse(raw).success) {
                return fail('Fecha/hora inválida. Usá formato ISO 8601 con zona.');
            }
            return ok(raw);
        }
        case 'url': {
            if (typeof raw !== 'string') return fail('Se esperaba una URL.');
            // Requiere esquema http(s)/ftp/mailto + host. Sin depender del
            // global `URL` (shared es platform-agnóstico: front y back).
            if (!/^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(raw) && !/^mailto:[^\s@]+@[^\s@]+$/i.test(raw)) {
                return fail('URL inválida.');
            }
            return ok(raw);
        }
        case 'email': {
            if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
                return fail('Email inválido.');
            }
            return ok(raw.toLowerCase());
        }
        case 'user': {
            const id = typeof raw === 'number' ? raw : Number(raw);
            if (!Number.isInteger(id) || id < 1) return fail('Usuario inválido.');
            return ok(id);
        }
        case 'file': {
            if (!Array.isArray(raw)) return fail('Se esperaba una lista de archivos.');
            const max = numericConfig(config, 'max_files');
            if (max !== null && raw.length > max) return fail(`Máximo ${max} archivos.`);
            return ok(raw);
        }
        // relation/computed no viven en `data` — no deberían llegar acá.
        case 'relation':
        case 'computed':
            return fail(`El tipo '${type}' no se escribe en los datos del registro.`);
        default: {
            const _exhaustive: never = type;
            return fail(`Tipo desconocido: ${String(_exhaustive)}`);
        }
    }
}

function numericConfig(config: Record<string, unknown>, key: string): number | null {
    const v = config[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
