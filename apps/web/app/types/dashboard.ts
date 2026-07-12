export type WidgetType =
    | 'kpi'
    | 'chart_bar'
    | 'chart_pie'
    | 'chart_line'
    | 'chart_area'
    | 'stat_delta'
    | 'table'
    /** Embudo de etapas — mismo evaluador que chart_bar, render funnel. */
    | 'funnel';

/**
 * Agregaciones soportadas para widgets de dashboard. Mismo set que
 * `RecordAggregator.php` (footer aggregations) — el backend ya las
 * sabía calcular per-tipo de campo, ahora también las exponemos en
 * widgets:
 *
 *  - `count`         → COUNT(*) si field_id=0; COUNT(col) si field_id>0
 *  - `count_unique`  → COUNT(DISTINCT col) — valores distintos
 *  - `count_empty`   → registros con la columna vacía / null
 *  - `sum`, `avg`    → solo numeric/currency
 *  - `min`, `max`    → numeric o date/datetime (más antiguo / más reciente)
 *  - `count_true`    → solo checkbox
 *  - `count_false`   → solo checkbox
 *
 * El picker filtra qué métricas mostrar según el tipo del campo
 * elegido (ver `metricsForFieldType` en WidgetFormDialog).
 */
export type KpiMetric =
    | 'count'
    | 'count_unique'
    | 'count_empty'
    | 'sum'
    | 'avg'
    | 'min'
    | 'max'
    | 'count_true'
    | 'count_false';

export interface WidgetLayout {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Tamaño inicial por tipo de widget (0.57.42). Antes TODOS los
 * widgets nacían con 4×3 — un KPI quedaba con la mitad del card en
 * blanco y una tabla quedaba apretada. Unidades del grid: 12 cols,
 * rowHeight 64px.
 *
 * El `y: 9999` manda el widget nuevo AL FINAL del dashboard
 * (compactType vertical lo sube hasta tocar la última fila) en vez
 * de insertarlo arriba a la izquierda desplazando a los demás.
 */
export function defaultLayoutForType(type: WidgetType): WidgetLayout {
    switch (type) {
        case 'kpi':
        case 'stat_delta':
            return { x: 0, y: 9999, w: 3, h: 2 };
        case 'chart_pie':
        case 'chart_bar':
        case 'funnel':
            return { x: 0, y: 9999, w: 4, h: 4 };
        case 'chart_line':
        case 'chart_area':
            return { x: 0, y: 9999, w: 6, h: 4 };
        case 'table':
            return { x: 0, y: 9999, w: 6, h: 5 };
        default:
            return { x: 0, y: 9999, w: 4, h: 3 };
    }
}

/** Tamaño mínimo por tipo — un KPI puede ser 2×2, un chart no baja de 3×3. */
export function minLayoutForType(type: WidgetType): { minW: number; minH: number } {
    switch (type) {
        case 'kpi':
        case 'stat_delta':
            return { minW: 2, minH: 2 };
        case 'table':
            return { minW: 3, minH: 3 };
        default:
            return { minW: 3, minH: 3 };
    }
}

/**
 * Granularidad temporal para charts con eje de fecha. Cuando se setea
 * sobre `chart_bar`/`chart_pie` con un `group_by_field_id` de tipo
 * date/datetime, o sobre `chart_line`/`chart_area` (que siempre usan
 * date_field_id), define el `DATE_FORMAT` que usa el backend para
 * agrupar.
 */
export type ChartTimeBucket = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Período del widget — atajo dedicado para limitar los datos a un
 * rango relativo (este mes, últimos 7 días, este año…) sin pasar
 * por el panel de filtros. El backend (`WidgetEvaluator`) lo
 * inyecta como una condición `between_relative` adicional en el
 * filter tree cada vez que se evalúa el widget. UX equivalente
 * al "Período" del eje X de los charts de ClickUp.
 *
 * Si está ausente o `null`, el widget no aplica restricción
 * temporal (consume el filter_tree tal cual).
 */
export interface WidgetPeriod {
    /** ID del campo date/datetime contra el que se aplica el rango. */
    field_id: number;
    /**
     * Slug del preset relativo (`this_month`, `last_7_days`, …, ver
     * `app/admin/records/dateRangePresets.ts`).
     */
    preset: string;
}

export interface WidgetSpec {
    id: string;
    type: WidgetType;
    list_id: number;
    title: string;
    config: {
        metric?: KpiMetric;
        metric_field_id?: number;
        group_by_field_id?: number;
        date_field_id?: number;
        /** Atajo de período relativo, ver `WidgetPeriod`. */
        period?: WidgetPeriod | null;
        /** Granularidad temporal para charts con eje de fecha. Default: month. */
        time_bucket?: ChartTimeBucket;
        /** Mostrar línea de promedio horizontal (bar/line/area). */
        show_average_line?: boolean;
        /** Mostrar valor numérico encima de cada barra / punto / sector. */
        show_data_labels?: boolean;
        /** Mostrar leyenda de series (pie / charts con multi-serie). */
        show_legend?: boolean;
        /**
         * Filtros opcionales aplicados al widget. Forma legacy plana
         * `{ field_<id>: { op: value } }` — sólo soporta AND. Si el
         * widget se guardó con OR/nesting, mira `filter_tree` en su
         * lugar (ambos pueden coexistir, pero `filter_tree` tiene
         * prioridad en el backend).
         */
        filters?: Record<string, Record<string, unknown>>;
        /**
         * Árbol completo de filtros (ClickUp-style). El backend
         * (`WidgetEvaluator`) lo pasa por
         * `QueryBuilder::compileTreeWhereForList` y lo respeta en
         * todas las queries que ejecuta el widget.
         */
        filter_tree?: unknown;
        [key: string]: unknown;
    };
    layout: WidgetLayout;
}

/**
 * Visibilidad por dashboard (espejo de `dashboardVisibilitySchema` en
 * `@imagina-base/shared`):
 *  - `workspace` (default): lo ve todo miembro interno.
 *  - `private`: sólo el creador (el admin siempre ve todo).
 *  - `roles`: sólo los roles en `allowed_roles` (+ creador y admin).
 * El backend SIEMPRE filtra en list/get — la UI no filtra client-side.
 */
export type DashboardVisibility = 'workspace' | 'private' | 'roles';

export interface DashboardEntity {
    id: number;
    user_id: number | null;
    name: string;
    description: string | null;
    widgets: WidgetSpec[];
    is_default: boolean;
    position: number;
    visibility: DashboardVisibility;
    allowed_roles: string[];
    created_by: number;
    created_at: string;
    updated_at: string;
}

export interface CreateDashboardInput {
    name: string;
    description?: string | null;
    widgets?: WidgetSpec[];
    is_default?: boolean;
    position?: number;
    visibility?: DashboardVisibility;
    allowed_roles?: string[];
}

export interface UpdateDashboardInput {
    name?: string;
    description?: string | null;
    widgets?: WidgetSpec[];
    is_default?: boolean;
    position?: number;
    visibility?: DashboardVisibility;
    allowed_roles?: string[];
}

export type WidgetData =
    | { value: number | string; metric: KpiMetric }
    | { data: Array<{ label: string; value: number | string }> }
    | {
          /** stat_delta — value/previous pueden ser string para min/max de fecha */
          value: number | string;
          previous: number | string;
          delta_pct: number | null;
          period_days: number;
          metric: KpiMetric;
      }
    | {
          /** table */
          columns: Array<{ label: string; slug: string; type: string }>;
          rows: Array<{ id: number; fields: Record<string, unknown> }>;
      };
