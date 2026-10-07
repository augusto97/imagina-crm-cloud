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
    /** Filas de alto variable: el texto largo se muestra completo en vez
     * de recortarse con elipsis ("Ajustar texto" de ClickUp). */
    wrap_text: z.boolean().optional(),
    /** v0.1.137 — "Hoja de cálculo": tabla plana estilo Excel (numeración
     * de filas + separadores verticales, sin agrupar). */
    spreadsheet: z.boolean().optional(),
    /**
     * v0.1.140 — Densidad de las filas, elegida por quien mira la vista.
     * La hoja de cálculo arrancaba fija en "compacta" y para algunos era
     * demasiado apretada: ahora cada vista guarda la suya.
     */
    density: z.enum(['compact', 'normal', 'comfortable']).optional(),
    /**
     * v0.1.141 — Tamaño de letra de la tabla, elegido junto a la densidad
     * (no tenía sentido poder apretar las filas y no poder achicar o
     * agrandar el texto).
     */
    font_size: z.enum(['sm', 'md', 'lg']).optional(),
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
    /**
     * v0.1.259 — icono y color de la PESTAÑA (mismo catálogo que las listas).
     * `null` = el icono del tipo de vista. Viven en columnas propias y no en
     * `config`: guardar los cambios de la vista reemplaza el config entero.
     */
    icon: z.string().max(64).nullable(),
    color: z.string().max(32).nullable(),
    /**
     * v0.1.260 — opciones del menú de la pestaña (estilo ClickUp):
     * - `is_private`: sólo la ve quien la creó (nunca puede ser la por defecto).
     * - `is_locked`: protegida — sólo quien la creó o un admin la cambia o borra.
     * - `autosave`: los cambios de filtros/columnas se guardan solos.
     */
    created_by: z.number().int().nullable(),
    is_private: z.boolean(),
    is_locked: z.boolean(),
    autosave: z.boolean(),
});
export type View = z.infer<typeof viewSchema>;

export const createViewSchema = z.object({
    name: z.string().trim().min(1).max(190),
    type: viewTypeSchema,
    config: z.record(z.unknown()).optional(),
    is_default: z.boolean().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    is_private: z.boolean().optional(),
    is_locked: z.boolean().optional(),
    autosave: z.boolean().optional(),
});
export type CreateViewInput = z.infer<typeof createViewSchema>;

export const updateViewSchema = z
    .object({
        name: z.string().trim().min(1).max(190),
        config: z.record(z.unknown()),
        is_default: z.boolean(),
        position: z.number().int().nonnegative(),
        icon: z.string().max(64).nullable(),
        color: z.string().max(32).nullable(),
        is_private: z.boolean(),
        is_locked: z.boolean(),
        autosave: z.boolean(),
    })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, {
        message: 'El patch no puede estar vacío',
    });
export type UpdateViewInput = z.infer<typeof updateViewSchema>;

/**
 * v0.1.259 — orden de las pestañas de vistas de una lista (arrastrar en la
 * barra). Los ids que no vengan quedan después, en su orden actual.
 */
export const reorderViewsSchema = z.object({
    view_ids: z.array(idSchema).min(1).max(500),
});
export type ReorderViewsInput = z.infer<typeof reorderViewsSchema>;
