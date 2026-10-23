import { z } from 'zod';
import { idSchema } from './common';
import { filterConditionSchema, filterTreeSchema } from './filter';

/** Tipos de vista (CONTRACT.md §7). */
export const VIEW_TYPES = ['table', 'kanban', 'calendar', 'cards'] as const;
export const viewTypeSchema = z.enum(VIEW_TYPES);
export type ViewType = z.infer<typeof viewTypeSchema>;

const sortSchema = z.array(
    z.object({ field_id: idSchema, dir: z.enum(['asc', 'desc']) }),
);

/**
 * v0.1.287 — Colores condicionales de la tabla. La paleta es CERRADA (claves,
 * no hex): cada color se mezcla con transparencia sobre el fondo del tema, así
 * se ve bien en claro y en oscuro y el texto conserva su contraste.
 */
export const VIEW_ROW_COLORS = [
    'red',
    'orange',
    'amber',
    'yellow',
    'green',
    'teal',
    'cyan',
    'blue',
    'violet',
    'pink',
    'gray',
] as const;
export const viewRowColorSchema = z.enum(VIEW_ROW_COLORS);
export type ViewRowColor = z.infer<typeof viewRowColorSchema>;

/**
 * Una regla de color: si la fila cumple la condición (los mismos operadores
 * que los filtros, sobre un campo por ID), se pinta la FILA entera o la
 * CELDA de una columna (`cell_field_id`). El orden del array es la
 * prioridad: gana la primera regla activa que se cumple (por destino: una
 * regla de fila y una de celda pueden convivir).
 */
export const viewColorRuleSchema = z.object({
    id: z.string().min(1).max(40),
    enabled: z.boolean().default(true),
    condition: filterConditionSchema,
    color: viewRowColorSchema,
    target: z.enum(['row', 'cell']).default('row'),
    /** Columna a pintar cuando `target` es `cell` (por ID: sobrevive a renombres). */
    cell_field_id: idSchema.nullable().optional(),
});
export type ViewColorRule = z.infer<typeof viewColorRuleSchema>;

/** Tope de reglas de color por vista (cada una se evalúa por fila visible). */
export const MAX_VIEW_COLOR_RULES = 20;

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
    /**
     * v0.1.295 — «Editar con un click»: un click en una celda abre su editor
     * (el modelo de antes de v0.1.294). Sin valor, un click ELIGE la celda y
     * se edita con un segundo click, doble click, Enter o escribiendo, como en
     * una hoja de cálculo (ADR-S51).
     */
    single_click_edit: z.boolean().optional(),
    /**
     * v0.1.287 — Columnas fijas a la izquierda («Fijar hasta esta columna»):
     * cuántas columnas VISIBLES, contando desde la primera, quedan clavadas
     * al scrollear en horizontal. Sin valor = sólo la primera (como siempre).
     * Es un conteo y no un id: sobrevive a reordenar columnas igual que en
     * Excel o Airtable.
     */
    frozen_columns: z.number().int().min(1).max(20).optional(),
    /** v0.1.287 — Colores condicionales de filas o celdas (ver `viewColorRuleSchema`). */
    color_rules: z.array(viewColorRuleSchema).max(MAX_VIEW_COLOR_RULES).optional(),
};

export const tableViewConfigSchema = z.object({
    ...viewStateCommon,
    // Legacy del shell cloud viejo — se conservan para vistas ya guardadas.
    visible_field_ids: z.array(idSchema).default([]),
    column_sizing: z.record(z.string(), z.number()).default({}),
    group_by_field_id: idSchema.nullable().default(null),
    /**
     * v0.1.287 — Segundo nivel de agrupación («Agrupar por… y luego por…»):
     * subgrupos dentro de cada grupo de la tabla. Sólo aplica con
     * `group_by_field_id` y si es OTRO campo.
     */
    sub_group_by_field_id: idSchema.nullable().optional(),
});

/**
 * v0.1.297 — Kanban para ventas (B5). Las columnas y los carriles se identifican
 * por su CLAVE de grupo: el valor crudo (el `value` de la opción de un select,
 * el id de una persona como texto, `true`/`false`) o `__null__` para «Sin
 * valor» — la misma clave que arma el motor de agregados. Por eso los límites
 * y las reglas viajan como ARRAYS de `{column, …}` y no como un objeto con la
 * clave de la columna: así el re-mapeo de ids (plantillas, migrar empresa) no
 * puede confundir una columna llamada «field_id» con una referencia.
 */
export const kanbanWipLimitSchema = z.object({
    column: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(10_000),
});
export type KanbanWipLimit = z.infer<typeof kanbanWipLimitSchema>;

/** Al ENTRAR a `column`, la tarjeta pide estos campos (si están vacíos). */
export const kanbanMoveRuleSchema = z.object({
    column: z.string().min(1).max(500),
    required_field_ids: z.array(idSchema).max(20),
});
export type KanbanMoveRule = z.infer<typeof kanbanMoveRuleSchema>;

export const KANBAN_VALUE_METRICS = ['sum', 'avg'] as const;
export type KanbanValueMetric = (typeof KANBAN_VALUE_METRICS)[number];
export const KANBAN_CARD_SIZES = ['compact', 'normal'] as const;
export type KanbanCardSize = (typeof KANBAN_CARD_SIZES)[number];

export const kanbanViewConfigSchema = z.object({
    ...viewStateCommon,
    group_by_field_id: idSchema,
    kanban_title_field_id: idSchema.nullable().default(null),
    kanban_meta_field_ids: z.array(idSchema).default([]),
    /** v0.1.297 — campo numérico/moneda que se suma (o promedia) por columna y carril. */
    kanban_value_field_id: idSchema.nullable().optional(),
    kanban_value_metric: z.enum(KANBAN_VALUE_METRICS).optional(),
    /** v0.1.297 — carriles (swimlanes): filas por un segundo campo. */
    kanban_lane_field_id: idSchema.nullable().optional(),
    kanban_collapsed_lanes: z.array(z.string().max(500)).max(500).optional(),
    kanban_collapsed_columns: z.array(z.string().max(500)).max(500).optional(),
    kanban_hidden_columns: z.array(z.string().max(500)).max(500).optional(),
    /** v0.1.297 — ocultar las columnas (y carriles) que no tienen tarjetas. */
    kanban_hide_empty: z.boolean().optional(),
    kanban_wip_limits: z.array(kanbanWipLimitSchema).max(200).optional(),
    kanban_move_rules: z.array(kanbanMoveRuleSchema).max(200).optional(),
    /** v0.1.297 — portada de la tarjeta: un campo archivo o un enlace de imagen. */
    kanban_cover_field_id: idSchema.nullable().optional(),
    kanban_card_size: z.enum(KANBAN_CARD_SIZES).optional(),
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
