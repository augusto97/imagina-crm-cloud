import {
    BLUEPRINT_VERSION,
    type BlueprintWidget,
    type DashboardTemplate,
    type FieldType,
    type TemplateCategory,
    type TemplateRoleField,
} from '@imagina-base/shared';

/**
 * Plantillas de dashboard del SISTEMA (v0.1.167). Cada una habla de ROLES
 * de campo ("el estado", "el monto", "la fecha") sobre UNA lista (`main`):
 * al aplicarla se elige la lista y qué campo cumple cada rol, y los widgets
 * quedan apuntando a ids reales. Un rol opcional que no se mapee deja fuera
 * sólo los widgets que lo usan.
 *
 * Grilla de 12 columnas × filas de 64px (la del DashboardGrid).
 */
export interface SystemDashboardTemplate {
    key: string;
    name: string;
    description: string;
    category: TemplateCategory;
    template: DashboardTemplate;
}

const role = (key: string, label: string, types: FieldType[], required = true): TemplateRoleField => ({
    key,
    label,
    types,
    required,
});
const ref = (key: string) => ({ $field: key });
const MAIN = { $list: 'main' };

const w = (
    type: string,
    title: string,
    config: Record<string, unknown>,
    x: number,
    y: number,
    width: number,
    h: number,
): BlueprintWidget => ({ type, list: MAIN, title, config, layout: { x, y, w: width, h } });

const kpi = (title: string, config: Record<string, unknown>, x: number, y: number, width = 3) =>
    w('kpi', title, { metric: 'count', ...config }, x, y, width, 2);

const dash = (
    key: string,
    name: string,
    description: string,
    category: TemplateCategory,
    fields: TemplateRoleField[],
    widgets: BlueprintWidget[],
): SystemDashboardTemplate => ({
    key,
    name,
    description,
    category,
    template: {
        version: BLUEPRINT_VERSION,
        lists: [{ key: 'main', label: 'Lista', fields }],
        widgets,
        settings: {},
    },
});

const ESTADO = role('estado', 'Estado', ['select', 'multi_select']);
const RESPONSABLE = role('responsable', 'Responsable', ['user'], false);
const FECHA = role('fecha', 'Fecha', ['date', 'datetime']);
const MONTO = role('monto', 'Monto', ['currency', 'number']);

export const SYSTEM_DASHBOARD_TEMPLATES: readonly SystemDashboardTemplate[] = [
    dash(
        'resumen-por-estado',
        'Resumen por estado',
        'Cuántos registros hay, cómo se reparten por estado y por responsable, y cómo evolucionan en el tiempo.',
        'operaciones',
        [ESTADO, RESPONSABLE, role('fecha', 'Fecha (para la tendencia)', ['date', 'datetime'], false)],
        [
            kpi('Total de registros', { icon: 'list' }, 0, 0),
            kpi('Estados distintos', { metric: 'count_unique', metric_field_id: ref('estado'), icon: 'layers' }, 3, 0),
            w('stat_delta', 'Nuevos vs. período anterior', { metric: 'count', date_field_id: ref('fecha'), period_days: 30 }, 6, 0, 6, 2),
            w('chart_pie', 'Por estado', { metric: 'count', group_by_field_id: ref('estado'), center_label: 'Total' }, 0, 2, 6, 4),
            w('chart_bar', 'Por responsable', { metric: 'count', group_by_field_id: ref('responsable'), hide_zero_groups: true }, 6, 2, 6, 4),
            w('chart_line', 'Altas por mes', { metric: 'count', date_field_id: ref('fecha'), time_bucket: 'month' }, 0, 6, 12, 4),
            w('table', 'Últimos registros', { limit: 8 }, 0, 10, 12, 4),
        ],
    ),
    dash(
        'embudo-de-ventas',
        'Embudo de ventas',
        'Pipeline por etapa con monto total, ticket promedio, embudo y cierres del mes. Para una lista de oportunidades.',
        'ventas',
        [role('etapa', 'Etapa', ['select']), MONTO, role('cierre', 'Fecha de cierre', ['date', 'datetime'], false), RESPONSABLE],
        [
            kpi('Oportunidades', { icon: 'target' }, 0, 0),
            kpi('Monto en pipeline', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'wallet' }, 3, 0),
            kpi('Ticket promedio', { metric: 'avg', metric_field_id: ref('monto'), prefix: '$', icon: 'pie_chart' }, 6, 0),
            w('stat_delta', 'Cierres (30 días)', { metric: 'count', date_field_id: ref('cierre'), period_days: 30 }, 9, 0, 3, 2),
            w('funnel', 'Embudo por etapa', { metric: 'count', group_by_field_id: ref('etapa') }, 0, 2, 6, 5),
            w('chart_bar', 'Monto por etapa', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('etapa') }, 6, 2, 6, 5),
            w('chart_bar', 'Monto por responsable', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('responsable'), hide_zero_groups: true }, 0, 7, 6, 4),
            w('chart_line', 'Cierres por mes', { metric: 'sum', metric_field_id: ref('monto'), date_field_id: ref('cierre'), time_bucket: 'month' }, 6, 7, 6, 4),
            w('table', 'Próximos cierres', { limit: 8, sort_field_id: ref('cierre'), sort_dir: 'asc' }, 0, 11, 12, 4),
        ],
    ),
    dash(
        'cartera-y-cobros',
        'Cartera y cobros',
        'Cuánto hay facturado, cómo se reparte por estado de pago y qué vence cuándo. Para una lista de facturas o cuotas.',
        'finanzas',
        [ESTADO, MONTO, role('vencimiento', 'Fecha de vencimiento', ['date', 'datetime'])],
        [
            kpi('Documentos', { icon: 'receipt' }, 0, 0),
            kpi('Monto total', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'wallet' }, 3, 0),
            kpi('Monto promedio', { metric: 'avg', metric_field_id: ref('monto'), prefix: '$' }, 6, 0),
            w('stat_delta', 'Facturado (30 días)', { metric: 'sum', metric_field_id: ref('monto'), date_field_id: ref('vencimiento'), period_days: 30 }, 9, 0, 3, 2),
            w('chart_pie', 'Por estado de pago', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('estado'), center_label: 'Total' }, 0, 2, 6, 4),
            w('chart_bar', 'Vencimientos por mes', { metric: 'sum', metric_field_id: ref('monto'), date_field_id: ref('vencimiento'), time_bucket: 'month' }, 6, 2, 6, 4),
            w('table', 'Próximos vencimientos', { limit: 10, sort_field_id: ref('vencimiento'), sort_dir: 'asc' }, 0, 6, 12, 5),
        ],
    ),
    dash(
        'carga-de-trabajo',
        'Carga de trabajo',
        'Qué tiene cada persona entre manos, por estado y prioridad, y lo que vence pronto. Para tareas, tickets o pedidos.',
        'proyectos',
        [role('responsable', 'Responsable', ['user']), ESTADO, role('prioridad', 'Prioridad', ['select'], false), role('fecha', 'Fecha límite', ['date', 'datetime'], false)],
        [
            kpi('Pendientes en total', { icon: 'clipboard' }, 0, 0),
            kpi('Personas con trabajo', { metric: 'count_unique', metric_field_id: ref('responsable'), icon: 'users' }, 3, 0),
            kpi('Sin responsable', { metric: 'count_empty', metric_field_id: ref('responsable'), icon: 'flag' }, 6, 0),
            w('chart_bar', 'Por responsable', { metric: 'count', group_by_field_id: ref('responsable'), hide_zero_groups: true }, 0, 2, 6, 5),
            w('chart_pie', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 6, 2, 3, 5),
            w('chart_pie', 'Por prioridad', { metric: 'count', group_by_field_id: ref('prioridad') }, 9, 2, 3, 5),
            w('table', 'Vence pronto', { limit: 8, sort_field_id: ref('fecha'), sort_dir: 'asc' }, 0, 7, 12, 4),
        ],
    ),
    dash(
        'actividad-en-el-tiempo',
        'Actividad en el tiempo',
        'Cuántos registros entran por día, semana y mes, y cómo se compara con el período anterior.',
        'otros',
        [FECHA],
        [
            kpi('Total', { icon: 'database' }, 0, 0, 4),
            w('stat_delta', 'Últimos 7 días', { metric: 'count', date_field_id: ref('fecha'), period_days: 7 }, 4, 0, 4, 2),
            w('stat_delta', 'Últimos 30 días', { metric: 'count', date_field_id: ref('fecha'), period_days: 30 }, 8, 0, 4, 2),
            w('chart_area', 'Por semana', { metric: 'count', date_field_id: ref('fecha'), time_bucket: 'week', period: { field_id: ref('fecha'), preset: 'last_90_days' } }, 0, 2, 12, 4),
            w('chart_bar', 'Por mes', { metric: 'count', date_field_id: ref('fecha'), time_bucket: 'month' }, 0, 6, 12, 4),
        ],
    ),
    dash(
        'satisfaccion',
        'Satisfacción',
        'Promedio de calificación, meta y distribución. Para encuestas, tickets con calificación o evaluaciones.',
        'clientes',
        [role('calificacion', 'Calificación', ['rating', 'number', 'percent']), role('estado', 'Estado o categoría', ['select', 'multi_select'], false)],
        [
            w('gauge', 'Promedio vs. meta', { metric: 'avg', metric_field_id: ref('calificacion'), goal: 4.5 }, 0, 0, 4, 4),
            kpi('Respuestas', { icon: 'star' }, 4, 0, 4),
            kpi('Promedio', { metric: 'avg', metric_field_id: ref('calificacion'), icon: 'heart' }, 8, 0, 4),
            w('chart_bar', 'Cuántos dieron cada nota', { metric: 'count', group_by_field_id: ref('calificacion') }, 4, 2, 8, 2),
            w('chart_bar', 'Promedio por estado', { metric: 'avg', metric_field_id: ref('calificacion'), group_by_field_id: ref('estado'), hide_zero_groups: true }, 0, 4, 12, 4),
        ],
    ),
    dash(
        'inventario',
        'Inventario',
        'Unidades en stock por categoría, valor del inventario y productos con poco stock.',
        'operaciones',
        [role('stock', 'Stock', ['number']), role('categoria', 'Categoría', ['select', 'multi_select']), role('precio', 'Precio', ['currency', 'number'], false), role('minimo', 'Stock mínimo', ['number'], false)],
        [
            kpi('Productos', { icon: 'package' }, 0, 0),
            kpi('Unidades en stock', { metric: 'sum', metric_field_id: ref('stock'), icon: 'layers' }, 3, 0),
            kpi('Precio promedio', { metric: 'avg', metric_field_id: ref('precio'), prefix: '$', icon: 'tag' }, 6, 0),
            kpi('Sin stock', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('stock'), op: 'lte', value: 0 }, icon: 'flag' }, 9, 0),
            w('chart_bar', 'Stock por categoría', { metric: 'sum', metric_field_id: ref('stock'), group_by_field_id: ref('categoria') }, 0, 2, 6, 4),
            w('chart_pie', 'Productos por categoría', { metric: 'count', group_by_field_id: ref('categoria') }, 6, 2, 6, 4),
            w('table', 'Menos stock', { limit: 10, sort_field_id: ref('stock'), sort_dir: 'asc' }, 0, 6, 12, 4),
        ],
    ),
];

export function systemDashboardTemplate(key: string): SystemDashboardTemplate | undefined {
    return SYSTEM_DASHBOARD_TEMPLATES.find((t) => t.key === key);
}
