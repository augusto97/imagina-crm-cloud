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
    long_text: z.object({}),
    number: z.object({ precision: z.number().int().min(0).max(10).optional() }),
    currency: z.object({
        currency: z.string().length(3).default('USD'),
        precision: z.number().int().min(0).max(4).optional(),
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
