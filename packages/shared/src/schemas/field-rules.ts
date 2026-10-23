import { z } from 'zod';
import { idSchema, isoDateSchema } from './common';

/**
 * v0.1.300 — Reglas comunes de un campo que se escribe a mano: VALOR POR DEFECTO y
 * VALIDACIONES. Viven en `field.config` (claves `default_value` y
 * `validation`) junto a la config propia del tipo — así viajan solas en las
 * plantillas, al duplicar una lista y al migrar una empresa (la referencia a
 * otro campo de `required_if` termina en `field_id` a propósito: el blueprint
 * y la migración la re-mapean como cualquier `*_field_id`).
 *
 * La lógica que las aplica vive en `field-types/field-rules.ts`: la MISMA
 * función corre en el navegador (aviso en la celda, el alta, la ficha) y en
 * el servidor (alta, edición, import, edición masiva, formularios,
 * automatizaciones, asistente/MCP).
 */

/**
 * Valor por defecto: se pone cuando el valor NO viene al crear el registro.
 * - `value`: un valor fijo (texto, número, una opción o varias…), validado
 *   contra el tipo al guardar el campo.
 * - `today` (fecha) / `now` (fecha y hora): en el reloj de la empresa.
 * - `creator` (persona): quien crea el registro.
 */
export const FIELD_DEFAULT_KINDS = ['value', 'today', 'now', 'creator'] as const;
export type FieldDefaultKind = (typeof FIELD_DEFAULT_KINDS)[number];

export const fieldDefaultSchema = z.object({
    kind: z.enum(FIELD_DEFAULT_KINDS),
    value: z.unknown().optional(),
});
export type FieldDefault = z.infer<typeof fieldDefaultSchema>;

/**
 * Formatos listos para campos de texto (Colombia primero: es donde está la
 * mayoría de los clientes) + una expresión regular propia.
 * - `nit`: NIT con o sin dígito de verificación (si lo trae, se verifica).
 * - `nit_dv`: NIT con el dígito de verificación OBLIGATORIO y correcto.
 * - `cedula`: cédula de ciudadanía (6 a 10 dígitos, admite puntos).
 * - `placa`: placa de vehículo (ABC123) o de moto (ABC12D).
 * - `digits`: sólo números. `letters`: sólo letras (y espacios).
 * - `regex`: el `pattern` propio (con límites contra ReDoS: ver
 *   `analyzeUserPattern`).
 */
export const FIELD_FORMAT_PRESETS = ['nit', 'nit_dv', 'cedula', 'placa', 'digits', 'letters', 'regex'] as const;
export type FieldFormatPreset = (typeof FIELD_FORMAT_PRESETS)[number];

/** "Obligatorio si otro campo…": es / no es / tiene valor. */
export const REQUIRED_IF_OPS = ['eq', 'neq', 'not_empty'] as const;
export type RequiredIfOp = (typeof REQUIRED_IF_OPS)[number];

/** Tope del patrón propio (caracteres). */
export const USER_PATTERN_MAX_LENGTH = 200;

const messageSchema = z.string().trim().max(200).optional();
/** Mínimo/máximo: un número, o una fecha `YYYY-MM-DD` (campos de fecha). */
const boundSchema = z.union([z.number().finite(), isoDateSchema]).nullable().optional();

export const fieldValidationSchema = z.object({
    /** Números, montos, porcentajes, duración, calificación y fechas. */
    min: boundSchema,
    max: boundSchema,
    range_message: messageSchema,
    /** Largo del texto (caracteres). */
    min_length: z.number().int().min(0).max(65535).nullable().optional(),
    max_length: z.number().int().min(1).max(65535).nullable().optional(),
    length_message: messageSchema,
    /** Formato del texto. */
    format: z.enum(FIELD_FORMAT_PRESETS).nullable().optional(),
    pattern: z.string().max(USER_PATTERN_MAX_LENGTH).optional(),
    pattern_ignore_case: z.boolean().optional(),
    format_message: messageSchema,
    /**
     * Obligatorio sólo si otro campo de la lista cumple la condición.
     * `field_id` nullable: una plantilla cuyo campo de referencia no llegó
     * lo deja en null y la regla no aplica.
     */
    required_if: z
        .object({
            // Opcional además de nullable: una plantilla que limpia la
            // referencia muerta (`dropDeadListRefs`) borra la clave.
            field_id: idSchema.nullable().optional(),
            op: z.enum(REQUIRED_IF_OPS),
            value: z.unknown().optional(),
            message: messageSchema,
        })
        .nullable()
        .optional(),
});
export type FieldValidation = z.infer<typeof fieldValidationSchema>;

/** Las dos claves comunes que acepta la config de un campo escribible. */
export const fieldRulesSchema = z.object({
    default_value: fieldDefaultSchema.nullable().optional(),
    validation: fieldValidationSchema.nullable().optional(),
});
export type FieldRules = z.infer<typeof fieldRulesSchema>;

/**
 * Config del ID automático (`TCK-0001`, `PED-2026-0042`):
 * - `prefix`: letras, números y `- _ . / #` (vacío = sólo el número).
 * - `separator`: entre el prefijo, el año y el número (default `-`).
 * - `digits`: cuántos dígitos como mínimo (relleno con ceros; un número más
 *   largo NO se corta).
 * - `start`: desde qué número arranca (si se sube después, sigue desde ahí;
 *   bajarlo no repite números).
 * - `yearly`: reinicia cada año (en el reloj de la empresa) e incluye el
 *   año en el texto.
 */
export const AUTONUMBER_SEPARATORS = ['-', '/', '.', '_', ''] as const;
export const autonumberConfigSchema = z.object({
    prefix: z
        .string()
        .trim()
        .max(20)
        .regex(/^[\p{L}\p{N}_.#/-]*$/u, 'Usa letras, números o - _ . / #')
        .optional(),
    separator: z.enum(AUTONUMBER_SEPARATORS).optional(),
    digits: z.number().int().min(1).max(10).optional(),
    start: z.number().int().min(0).max(1_000_000_000).optional(),
    yearly: z.boolean().optional(),
});
export type AutonumberConfig = z.infer<typeof autonumberConfigSchema>;
