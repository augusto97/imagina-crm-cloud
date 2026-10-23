import type {
    CalendarColorBy,
    CalendarMode,
    CalendarSourceConfig,
    GanttColorBy,
    GanttColumn,
    GanttZoom,
    KanbanMoveRule,
    KanbanWipLimit,
    ViewColorRule,
} from '@imagina-base/shared';

export type SavedViewType = 'table' | 'kanban' | 'calendar' | 'cards' | 'gantt';

export interface SavedViewConfig {
    visible_fields?: number[];
    /** Column ids ocultos (Excel-style hide). Usa el `id` de la
     * columna TanStack Table — para campos dinámicos es el slug del
     * field, para columnas fijas es 'id' / 'updated_at' / etc. */
    hidden_columns?: string[];
    /** Anchura por columna en px. Persistida cuando el usuario hace
     * drag del resizer. Excel-style. */
    column_widths?: Record<string, number>;
    /**
     * Orden custom de columnas (TanStack convention): array de column
     * ids en el orden visual deseado. Persistido cuando el usuario
     * hace drag-and-drop sobre los headers. Si está vacío / ausente,
     * se usa el orden default (`field.position`).
     */
    column_order?: string[];
    /**
     * Bucket keys que el user quiere CERRADOS por defecto al abrir
     * esta vista. Solo aplica cuando `group_by_field_id` está set.
     * Persistido para que la próxima visita encuentre los grupos en
     * el mismo estado.
     */
    collapsed_groups?: string[];
    /** Si `true`, las celdas muestran el texto completo (varias líneas)
     * en vez de recortarlo. "Ajustar texto" del panel de la vista. */
    wrap_text?: boolean;
    /** Si `true`, la tabla se muestra como hoja de cálculo: numeración de
     * filas, separadores verticales y sin agrupar. */
    spreadsheet?: boolean;
    /** Densidad de las filas: 'compact' | 'normal' | 'comfortable'. */
    density?: string;
    /** Tamaño de letra de la tabla: 'sm' | 'md' | 'lg'. */
    font_size?: string;
    /** v0.1.295 — un click en una celda la edita (sin elegirla antes). */
    single_click_edit?: boolean;
    /**
     * Cálculo opt-in en el footer de cada columna: map
     * `{column_id: kind_slug}` (ej. `{"valor_cop": "sum"}`). Si la
     * column id no está aquí, su footer queda con el CTA "Calcular".
     * Slugs válidos en `AggregateKind` (ver
     * `views/FooterAggregateCell.tsx`).
     */
    footer_aggregates?: Record<string, string>;
    /**
     * Forma legacy plana: `[{field_id, op, value}, ...]`. Solo se
     * usaba cuando los filtros eran AND plano. Se mantiene como
     * espejo opcional cuando `filter_tree` es AND plano para
     * compatibilidad con backends antiguos. Para árboles con OR /
     * nested, este campo NO se escribe.
     */
    filters?: Array<{ field_id: number; op: string; value: unknown }>;
    /**
     * Árbol completo de filtros (forma nueva, ClickUp-style). Tipo
     * declarado como `unknown` porque `view.ts` se importa desde
     * código que no debe traer toda la cadena de tipos del filtro;
     * los consumers (`viewConfigToState`) lo castean a `FilterTree`.
     */
    filter_tree?: unknown;
    sort?: Array<{ field_id: number; dir: 'asc' | 'desc' }>;
    search?: string;
    /**
     * - Vistas `kanban`: id del campo `select` que define columnas (requerido).
     * - Vistas `table`: id del campo de agrupación ClickUp-style (opcional;
     *   tipos válidos: select, multi_select, user, checkbox, date, datetime).
     */
    group_by_field_id?: number;
    /**
     * v0.1.287 — Sólo tablas agrupadas: segundo nivel («Y luego por»). Cada
     * grupo se parte en subgrupos por este campo.
     */
    sub_group_by_field_id?: number;
    /**
     * v0.1.287 — Cuántas de las primeras columnas visibles quedan fijas a la
     * izquierda al scrollear en horizontal. Sin valor = sólo la primera.
     */
    frozen_columns?: number;
    /**
     * v0.1.287 — Colores condicionales: cada regla pinta la fila o la celda
     * de una columna cuando el registro cumple su condición.
     */
    color_rules?: ViewColorRule[];
    /** Sólo para vistas tipo `calendar`: id del campo `date`/`datetime` que ubica cada record. */
    date_field_id?: number;
    /**
     * B4 — Calendario completo (ver `calendarViewConfigSchema` en shared): fin
     * o duración de la fuente principal, fuentes adicionales, fuentes
     * apagadas, color, vista por defecto, semana, horario y duración por
     * defecto.
     */
    calendar_end_field_id?: number | null;
    calendar_duration_field_id?: number | null;
    calendar_main_label?: string;
    calendar_main_color?: CalendarSourceConfig['color'];
    calendar_sources?: CalendarSourceConfig[];
    calendar_hidden_sources?: string[];
    calendar_color_by?: CalendarColorBy;
    calendar_color_field_id?: number | null;
    calendar_default_mode?: CalendarMode;
    calendar_week_start?: 0 | 1 | 6;
    calendar_day_start?: number;
    calendar_day_end?: number;
    calendar_show_weekends?: boolean;
    calendar_default_duration?: number;
    /**
     * Sólo para vistas tipo `cards`: ids de los fields que se
     * muestran en cada tarjeta debajo del título. Vacío = solo
     * primary field. Orden = orden visual dentro de la tarjeta.
     * (Fase 12.A+)
     */
    card_field_ids?: number[];
    /**
     * Sólo para vistas tipo `cards`: id del field `file` que se usa
     * como imagen de portada de la tarjeta. Si no se setea, la
     * tarjeta usa un avatar colorizado generado desde el título.
     * (Fase 12.A+)
     */
    card_cover_field_id?: number;
    /**
     * Sólo para vistas tipo `cards`: tamaño de cada tarjeta del grid.
     * `compact` = más densas (3-4 col), `comfortable` = default
     * (2-3 col), `spacious` = grandes (1-2 col).
     * (Fase 12.A+)
     */
    card_size?: 'compact' | 'comfortable' | 'spacious';
    /**
     * Sólo para vistas tipo `kanban`: id del campo que se usa como
     * título prominente de cada card. Si no se setea, KanbanView
     * elige el primary field (o el primer text/email como fallback).
     */
    kanban_title_field_id?: number | null;
    /**
     * Sólo para vistas tipo `kanban`: ids de los campos que se
     * muestran como meta debajo del título (max 3-4). Si no se setea,
     * KanbanView elige por heurística los 3 primeros no excluidos.
     */
    kanban_meta_field_ids?: number[];
    /** v0.1.297 — Kanban para ventas (B5): campo que se suma/promedia por columna y carril. */
    kanban_value_field_id?: number | null;
    kanban_value_metric?: 'sum' | 'avg';
    /** v0.1.297 — carriles por un segundo campo. */
    kanban_lane_field_id?: number | null;
    kanban_collapsed_lanes?: string[];
    kanban_collapsed_columns?: string[];
    kanban_hidden_columns?: string[];
    kanban_hide_empty?: boolean;
    /** v0.1.297 — límite de tarjetas por columna (clave de la columna). */
    kanban_wip_limits?: KanbanWipLimit[];
    /** v0.1.297 — campos que se piden al mover una tarjeta a una columna. */
    kanban_move_rules?: KanbanMoveRule[];
    kanban_cover_field_id?: number | null;
    kanban_card_size?: 'compact' | 'normal';
    /** B1 — vista Gantt: campos de inicio y fin (date/datetime). */
    gantt_start_field_id?: number;
    gantt_end_field_id?: number | null;
    /** B1 — agrupación del Gantt (select, persona o casilla). */
    gantt_group_by_field_id?: number | null;
    /** B1 — color de las barras: por un select, por las reglas de la vista o sin color. */
    gantt_color_field_id?: number | null;
    gantt_color_by?: GanttColorBy;
    /** B1 — columnas del panel izquierdo (además del título) y sus anchos. */
    gantt_columns?: GanttColumn[];
    gantt_title_width?: number;
    gantt_zoom?: GanttZoom;
    gantt_show_subtasks?: boolean;
    gantt_show_dependencies?: boolean;
    gantt_show_baseline?: boolean;
}

export interface SavedViewEntity {
    id: number;
    list_id: number;
    user_id: number | null;
    name: string;
    type: SavedViewType;
    config: SavedViewConfig;
    is_default: boolean;
    position: number;
    /** v0.1.259 — icono y color de la pestaña (catálogo de las listas). */
    icon?: string | null;
    color?: string | null;
    /** v0.1.260 — opciones de la pestaña (estilo ClickUp). */
    created_by?: number | null;
    is_private?: boolean;
    is_locked?: boolean;
    autosave?: boolean;
    created_at: string;
    updated_at: string;
}
