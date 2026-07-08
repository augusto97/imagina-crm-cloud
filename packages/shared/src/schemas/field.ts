import { z } from 'zod';
import { idSchema } from './common';
import { fieldSlugSchema } from './slug';

/** Tipos de campo del plugin (CONTRACT.md §3). */
export const FIELD_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'url',
    'email',
    'user',
    'relation',
    'file',
    'computed',
] as const;
export const fieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof fieldTypeSchema>;

/**
 * Presets de color nombrados (CONTRACT.md §3). El color de la opción es la
 * fuente de verdad visual en TODA la app: chips, kanban, charts (HANDOFF.md §3).
 */
export const COLOR_PRESETS = [
    'gray', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
    'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'fuchsia',
    'pink', 'slate',
] as const;
export const optionColorSchema = z.union([
    z.enum(COLOR_PRESETS),
    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido'),
]);
export type OptionColor = z.infer<typeof optionColorSchema>;

export const selectOptionSchema = z.object({
    value: z.string().min(1).max(190),
    label: z.string().min(1).max(190),
    color: optionColorSchema.optional(),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

/**
 * Config por tipo (primeros schemas — se amplían en F1 con la interfaz
 * completa SQL/validate/serialize). La config vive en el campo, nunca por
 * fila (ej. la moneda es config de currency).
 */
export const fieldConfigSchemas = {
    text: z.object({ max_length: z.number().int().positive().max(65535).optional() }),
    long_text: z.object({ max_length: z.number().int().positive().optional() }),
    number: z.object({
        precision: z.number().int().min(0).max(10).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
    }),
    currency: z.object({
        currency: z.string().length(3).default('USD'),
        precision: z.number().int().min(0).max(4).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
    }),
    select: z.object({ options: z.array(selectOptionSchema).default([]) }),
    multi_select: z.object({ options: z.array(selectOptionSchema).default([]) }),
    date: z.object({}),
    datetime: z.object({}),
    checkbox: z.object({}),
    url: z.object({}),
    email: z.object({}),
    user: z.object({}),
    relation: z.object({ target_list_id: idSchema.optional() }),
    file: z.object({ max_files: z.number().int().positive().optional() }),
    computed: z.object({ expression: z.string().optional() }),
} satisfies Record<FieldType, z.ZodTypeAny>;

/** Valida la config de un campo contra el schema de su tipo. */
export function parseFieldConfig(type: FieldType, config: unknown): Record<string, unknown> {
    return fieldConfigSchemas[type].parse(config ?? {}) as Record<string, unknown>;
}

/**
 * Tipos que NO viven en `records.data`:
 * - `relation`: sus valores viven en la tabla `relations` (CONTRACT.md §3).
 * - `computed`: solo lectura, se evalúa server-side.
 */
export const NON_DATA_FIELD_TYPES: readonly FieldType[] = ['relation', 'computed'];

export function isDataField(type: FieldType): boolean {
    return !NON_DATA_FIELD_TYPES.includes(type);
}

export const fieldSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    slug: fieldSlugSchema,
    label: z.string().min(1).max(190),
    type: fieldTypeSchema,
    config: z.record(z.unknown()).default({}),
    is_required: z.boolean().default(false),
    is_unique: z.boolean().default(false),
    is_indexed: z.boolean().default(false),
    position: z.number().int().nonnegative().default(0),
});
export type Field = z.infer<typeof fieldSchema>;

/**
 * Clave JSONB de un campo dentro de `records.data`: `"f{field_id}"`,
 * inmutable (ADR-S02; regla de oro nº 1). El slug NUNCA toca los datos.
 */
export function jsonbKeyForField(fieldId: number): string {
    return `f${fieldId}`;
}

/** Alta de campo dentro de una lista. El `type` es inmutable tras la creación. */
export const createFieldSchema = z.object({
    label: z.string().trim().min(1).max(190),
    type: fieldTypeSchema,
    slug: fieldSlugSchema.optional(),
    config: z.record(z.unknown()).optional(),
    is_required: z.boolean().optional(),
    is_unique: z.boolean().optional(),
    is_indexed: z.boolean().optional(),
});
export type CreateFieldInput = z.infer<typeof createFieldSchema>;

/** Patch de campo. El `type` NO se cambia acá (requiere migración de datos). */
export const updateFieldSchema = z
    .object({
        label: z.string().trim().min(1).max(190),
        slug: fieldSlugSchema,
        config: z.record(z.unknown()),
        is_required: z.boolean(),
        is_unique: z.boolean(),
        is_indexed: z.boolean(),
        position: z.number().int().nonnegative(),
    })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, {
        message: 'El patch no puede estar vacío',
    });
export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;

/** Reordenamiento de campos: lista ordenada de field_ids (CONTRACT.md §1). */
export const reorderFieldsSchema = z.object({
    field_ids: z.array(idSchema).min(1),
});
export type ReorderFieldsInput = z.infer<typeof reorderFieldsSchema>;
