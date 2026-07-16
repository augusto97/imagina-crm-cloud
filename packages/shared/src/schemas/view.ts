import { z } from 'zod';
import { idSchema } from './common';
import { filterTreeSchema } from './filter';

/** Tipos de vista (CONTRACT.md §7). */
export const VIEW_TYPES = ['table', 'kanban', 'calendar', 'cards'] as const;
export const viewTypeSchema = z.enum(VIEW_TYPES);
export type ViewType = z.infer<typeof viewTypeSchema>;

const sortSchema = z.array(
    z.object({ field_id: idSchema, dir: z.enum(['asc', 'desc']) }),
);

/**
 * Estado COMÚN que el front captura en cualquier vista guardada (filtros,
 * búsqueda, columnas). OJO: los ids de columna del fork son los column ids
 * de TanStack Table — para campos dinámicos es el SLUG del campo y para
 * columnas fijas 'id'/'updated_at' — por eso son strings, no field_ids.
 * (El schema anterior whitelisteaba otro shape — `visible_field_ids`,
 * `column_sizing`, `column_order` numérico — y Zod DESCARTABA en silencio
 * `hidden_columns`/`column_widths`/`search`: ocultar columnas funcionaba en
 * vivo pero se perdía al guardar la vista.)
 */
const viewStateCommon = {
    filter_tree: filterTreeSchema.optional(),
    /** Espejo legacy plano de filter_tree cuando el árbol es AND plano. */
    filters: z
        .array(z.object({ field_id: idSchema, op: z.string(), value: z.unknown() }))
        .optional(),
    search: z.string().optional(),
    sort: sortSchema.default([]),
    hidden_columns: z.array(z.string()).default([]),
    column_widths: z.record(z.string(), z.number()).default({}),
    column_order: z.array(z.coerce.string()).default([]),
    collapsed_groups: z.array(z.string()).default([]),
    footer_aggregates: z.record(z.string(), z.string()).default({}),
};

export const tableViewConfigSchema = z.object({
    ...viewStateCommon,
    // Legacy del shell cloud viejo — se conservan para vistas ya guardadas.
    visible_field_ids: z.array(idSchema).default([]),
    column_sizing: z.record(z.string(), z.number()).default({}),
    group_by_field_id: idSchema.nullable().default(null),
});

export const kanbanViewConfigSchema = z.object({
    ...viewStateCommon,
    group_by_field_id: idSchema,
    kanban_title_field_id: idSchema.nullable().default(null),
    kanban_meta_field_ids: z.array(idSchema).default([]),
});

export const calendarViewConfigSchema = z.object({
    ...viewStateCommon,
    date_field_id: idSchema,
});

export const cardsViewConfigSchema = z.object({
    ...viewStateCommon,
    card_field_ids: z.array(idSchema).default([]),
    card_cover_field_id: idSchema.nullable().default(null),
    card_size: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
});

export const viewConfigSchemas = {
    table: tableViewConfigSchema,
    kanban: kanbanViewConfigSchema,
    calendar: calendarViewConfigSchema,
    cards: cardsViewConfigSchema,
} satisfies Record<ViewType, z.ZodTypeAny>;

/** Valida la config contra el schema del tipo de vista. */
export function parseViewConfig(type: ViewType, config: unknown): Record<string, unknown> {
    return viewConfigSchemas[type].parse(config ?? {}) as Record<string, unknown>;
}

export const viewSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    name: z.string().min(1).max(190),
    type: viewTypeSchema,
    config: z.record(z.unknown()),
    is_default: z.boolean(),
    position: z.number().int().nonnegative(),
});
export type View = z.infer<typeof viewSchema>;

export const createViewSchema = z.object({
    name: z.string().trim().min(1).max(190),
    type: viewTypeSchema,
    config: z.record(z.unknown()).optional(),
    is_default: z.boolean().optional(),
});
export type CreateViewInput = z.infer<typeof createViewSchema>;

export const updateViewSchema = z
    .object({
        name: z.string().trim().min(1).max(190),
        config: z.record(z.unknown()),
        is_default: z.boolean(),
        position: z.number().int().nonnegative(),
    })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, {
        message: 'El patch no puede estar vacío',
    });
export type UpdateViewInput = z.infer<typeof updateViewSchema>;
