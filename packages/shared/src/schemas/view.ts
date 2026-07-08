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
 * Config por tipo de vista. TODO referencia por field_id, jamás slug
 * (CONTRACT.md §7 / regla de oro nº 1) — así renombrar no rompe la vista.
 */
export const tableViewConfigSchema = z.object({
    visible_field_ids: z.array(idSchema).default([]),
    column_order: z.array(idSchema).default([]),
    column_sizing: z.record(z.string(), z.number()).default({}),
    sort: sortSchema.default([]),
    filter_tree: filterTreeSchema.optional(),
    group_by_field_id: idSchema.nullable().default(null),
    collapsed_groups: z.array(z.string()).default([]),
    footer_aggregates: z.record(z.string(), z.string()).default({}),
});

export const kanbanViewConfigSchema = z.object({
    group_by_field_id: idSchema,
    kanban_title_field_id: idSchema.nullable().default(null),
    kanban_meta_field_ids: z.array(idSchema).default([]),
    filter_tree: filterTreeSchema.optional(),
});

export const calendarViewConfigSchema = z.object({
    date_field_id: idSchema,
    filter_tree: filterTreeSchema.optional(),
});

export const cardsViewConfigSchema = z.object({
    card_field_ids: z.array(idSchema).default([]),
    card_cover_field_id: idSchema.nullable().default(null),
    card_size: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
    filter_tree: filterTreeSchema.optional(),
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
