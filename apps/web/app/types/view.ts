export type SavedViewType = 'table' | 'kanban' | 'calendar' | 'cards';

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
    /**
     * Cálculo opt-in en el footer de cada columna: map
     * `{column_id: kind_slug}` (ej. `{"valor_cop": "sum"}`). Si la
     * column id no está acá, su footer queda con el CTA "Calcular".
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
    /** Sólo para vistas tipo `calendar`: id del campo `date`/`datetime` que ubica cada record. */
    date_field_id?: number;
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
    kanban_title_field_id?: number;
    /**
     * Sólo para vistas tipo `kanban`: ids de los campos que se
     * muestran como meta debajo del título (max 3-4). Si no se setea,
     * KanbanView elige por heurística los 3 primeros no excluidos.
     */
    kanban_meta_field_ids?: number[];
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
    created_at: string;
    updated_at: string;
}
