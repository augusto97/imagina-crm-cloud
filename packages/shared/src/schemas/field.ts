import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { filterTreeSchema } from './filter';
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
    // v0.1.158 — los que faltaban frente a ClickUp/Airtable. Se guardan en
    // el mismo JSONB que el resto: `phone` como cadena canónica E.164,
    // `rating`/`percent`/`duration` como números (así filtran, ordenan y
    // agregan con el motor numérico que ya existe).
    'phone',
    'rating',
    'percent',
    'duration',
    // v0.1.170 (ADR-S19) — campos "a través de una relación", como el
    // lookup/rollup de Airtable: NO se persisten, se resuelven en cada
    // lectura cruzando la tabla `relations`. `lookup` trae un campo de los
    // registros vinculados; `rollup` los cuenta o agrega (sum/avg/min/max).
    'lookup',
    'rollup',
] as const;
export const fieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof fieldTypeSchema>;

/** Operaciones del rollup (`count` no necesita campo destino). */
export const ROLLUP_OPERATIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export const rollupOperationSchema = z.enum(ROLLUP_OPERATIONS);
export type RollupOperation = z.infer<typeof rollupOperationSchema>;

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
    date: z.object({
        /** Opt-in: pintar en rojo los valores anteriores a hoy (fecha límite). */
        highlight_overdue: z.boolean().optional(),
    }),
    datetime: z.object({
        /** Opt-in: pintar en rojo los valores anteriores a ahora (fecha límite). */
        highlight_overdue: z.boolean().optional(),
    }),
    checkbox: z.object({}),
    url: z.object({}),
    email: z.object({}),
    user: z.object({}),
    relation: z.object({ target_list_id: idSchema.optional() }),
    file: z.object({ max_files: z.number().int().positive().optional() }),
    computed: z.object({
        /** Operación del catálogo cerrado (ver field-types/computed.ts). */
        operation: z
            .enum(['date_diff_months', 'date_diff_days', 'sum', 'product', 'subtract', 'divide', 'concat', 'abs'])
            .optional(),
        /** Field IDs de entrada (pueden ser otros computed — cadena con guard). */
        inputs: z.array(idSchema).max(20).optional(),
        /** Solo para concat. */
        separator: z.string().max(20).optional(),
    }),
    phone: z.object({
        /**
         * País por defecto (ISO 3166-1 alfa-2) para los números que se
         * escriben o importan SIN indicativo. Sin él, un número local se
         * guarda tal cual: preferimos conservar el dato del cliente antes
         * que atribuirle un país inventado.
         */
        default_country: z.string().length(2).optional(),
    }),
    rating: z.object({
        /** Cantidad de estrellas (1-10). */
        max: z.number().int().min(1).max(10).optional(),
        icon: z.enum(['star', 'heart', 'flame']).optional(),
    }),
    percent: z.object({
        precision: z.number().int().min(0).max(2).optional(),
        /** Barra de progreso además del número (default: sí). */
        show_bar: z.boolean().optional(),
    }),
    duration: z.object({
        /** `hm` → `1h 30m`; `clock` → `1:30`. El valor SIEMPRE son minutos. */
        format: z.enum(['hm', 'clock']).optional(),
    }),
    /**
     * v0.1.170 — Lookup: "mostrá el campo X de los registros vinculados por
     * la relación R". `relation_field_id` puede ser una relación de ESTA
     * lista (hacia afuera) o una relación de OTRA lista que apunta a esta
     * (hacia adentro: "las facturas que me apuntan"); el backend deduce la
     * dirección. `target_field_id` es un campo de la lista del otro lado.
     * Los nombres terminan en `_field_id` a propósito: así el blueprint de
     * plantillas los tokeniza y re-resuelve solos (list-template.ts).
     */
    lookup: z.object({
        relation_field_id: idSchema.optional(),
        target_field_id: idSchema.optional(),
    }),
    /**
     * Rollup: "contá / sumá / promediá el campo X de los registros
     * vinculados", con un filtro opcional sobre ESOS registros (el mismo
     * filter tree de las vistas, compilado por el QueryBuilder contra la
     * lista del otro lado — "deuda = suma del monto de las facturas con
     * estado pendiente").
     */
    rollup: z.object({
        relation_field_id: idSchema.optional(),
        target_field_id: idSchema.optional(),
        operation: rollupOperationSchema.optional(),
        filter_tree: filterTreeSchema.optional(),
    }),
} satisfies Record<FieldType, z.ZodTypeAny>;

/** Valida la config de un campo contra el schema de su tipo. */
export function parseFieldConfig(type: FieldType, config: unknown): Record<string, unknown> {
    return fieldConfigSchemas[type].parse(config ?? {}) as Record<string, unknown>;
}

/**
 * Tipos que NO viven en `records.data`:
 * - `relation`: sus valores viven en la tabla `relations` (CONTRACT.md §3).
 * - `computed`: solo lectura, se evalúa server-side.
 * - `lookup` / `rollup`: solo lectura, se resuelven cruzando `relations`.
 */
export const NON_DATA_FIELD_TYPES: readonly FieldType[] = ['relation', 'computed', 'lookup', 'rollup'];

export function isDataField(type: FieldType): boolean {
    return !NON_DATA_FIELD_TYPES.includes(type);
}

/** Tipos que leen A TRAVÉS de una relación (v0.1.170, ADR-S19). */
export const THROUGH_FIELD_TYPES: readonly FieldType[] = ['lookup', 'rollup'];

export function isThroughField(type: FieldType): boolean {
    return THROUGH_FIELD_TYPES.includes(type);
}

/**
 * Tipos que un lookup puede traer del otro lado: cualquier dato del JSONB
 * más los computed (se evalúan sobre la fila vinculada). Quedan afuera los
 * que son referencias a OTRAS entidades (relation, file) y los propios
 * through (encadenar lookups obliga a resolver grafos en cada lectura).
 */
export const LOOKUP_TARGET_TYPES: readonly FieldType[] = [
    'text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime',
    'checkbox', 'url', 'email', 'user', 'computed', 'phone', 'rating', 'percent', 'duration',
];

/** Campos que un rollup puede sumar/promediar. */
export const ROLLUP_NUMERIC_TYPES: readonly FieldType[] = [
    'number', 'currency', 'rating', 'percent', 'duration',
];
/** Campos que admiten mínimo/máximo (numéricos + fechas). */
export const ROLLUP_MINMAX_TYPES: readonly FieldType[] = [
    ...ROLLUP_NUMERIC_TYPES, 'date', 'datetime',
];

/**
 * Resolución (derivada, nunca persistida) de un campo lookup/rollup que el
 * backend adjunta al DTO en el listado de campos: hacia dónde va la
 * relación y cómo es el campo del otro lado — lo que la UI necesita para
 * formatear el valor (moneda, opciones con color, fecha) sin otra request.
 */
export const throughInfoSchema = z.object({
    direction: z.enum(['forward', 'reverse']),
    relation_label: z.string(),
    other_list_id: idSchema,
    other_list_name: z.string(),
    target_field: z
        .object({
            id: idSchema,
            label: z.string(),
            type: fieldTypeSchema,
            config: z.record(z.unknown()).default({}),
        })
        .nullable(),
});
export type ThroughInfo = z.infer<typeof throughInfoSchema>;

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
    /**
     * ¿Es el campo que hace de TÍTULO del registro (v0.1.136)?
     *
     * No es una columna propia: se DERIVA de `list.settings.title_field_id`
     * (una lista tiene un solo título). Si la lista no eligió ninguno, cae al
     * primer campo de texto — que es lo que la UI venía adivinando sola.
     */
    is_primary: z.boolean().default(false),
    position: z.number().int().nonnegative().default(0),
    /**
     * Alta del campo (v0.1.161). El administrador de campos la muestra en su
     * columna "Creado"; la columna existía en la tabla desde F1 pero el DTO
     * nunca la emitía, así que la celda salía siempre vacía.
     */
    created_at: isoDateTimeSchema,
    /**
     * Ayuda para el equipo (v0.1.163): "cómo se usa este campo". Metadata
     * pura — se muestra bajo el campo en los formularios y en el
     * administrador; no participa de la validación del valor.
     */
    description: z.string().max(500).nullable().default(null),
    /**
     * Sólo en lookup/rollup (v0.1.170): la relación resuelta. `null` si la
     * config apunta a algo que ya no existe (el campo se muestra vacío).
     * Ausente en las lecturas internas.
     */
    through: throughInfoSchema.nullable().optional(),
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
    description: z.string().max(500).nullable().optional(),
});
export type CreateFieldInput = z.infer<typeof createFieldSchema>;

/** Patch de campo. El `type` NO se cambia acá (requiere migración de datos). */
export const updateFieldSchema = z
    .object({
        label: z.string().trim().min(1).max(190),
        slug: fieldSlugSchema,
        /**
         * Conversión de tipo (v0.1.85): el backend migra los datos existentes
         * registro a registro con el validador compartido (los valores
         * incompatibles se limpian). `computed`/`relation`/`file` no se
         * convierten (su almacenamiento difiere) — 400.
         */
        type: fieldTypeSchema,
        config: z.record(z.unknown()),
        is_required: z.boolean(),
        is_unique: z.boolean(),
        is_indexed: z.boolean(),
        description: z.string().max(500).nullable(),
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

/**
 * Cuál de los campos hace de TÍTULO del registro (v0.1.136).
 *
 * Una lista elige el suyo en `settings.title_field_id`; si no eligió ninguno
 * (o el elegido ya no existe / no es texto) cae al primer campo de texto —
 * el mismo criterio que la UI venía adivinando sola, ahora en un solo lugar
 * y compartido por back y front.
 */
export const TITLE_FIELD_TYPES: readonly FieldType[] = ['text', 'long_text'];

export function resolveTitleFieldId(
    fields: Array<Pick<Field, 'id' | 'type'>>,
    settings: Record<string, unknown> | null | undefined,
): number | null {
    const chosen = Number((settings ?? {}).title_field_id);
    if (Number.isInteger(chosen) && chosen > 0) {
        const hit = fields.find((f) => f.id === chosen && TITLE_FIELD_TYPES.includes(f.type));
        if (hit) return hit.id;
    }
    return fields.find((f) => TITLE_FIELD_TYPES.includes(f.type))?.id ?? null;
}
