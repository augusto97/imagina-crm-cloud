import type { CalendarMode, GanttZoom, WorkloadMetric, WorkloadZoom } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

/**
 * Las etiquetas que comparten cada vista y su diálogo de configuración. Aparte
 * de los diálogos para que la vista no arrastre el diálogo entero (que se baja
 * la primera vez que se abre).
 */
export const GANTT_ZOOM_LABEL: Record<GanttZoom, string> = {
    day: __('Día'),
    week: __('Semana'),
    month: __('Mes'),
    quarter: __('Trimestre'),
};

export const CALENDAR_MODE_LABEL: Record<CalendarMode, string> = {
    month: __('Mes'),
    week: __('Semana'),
    day: __('Día'),
    agenda: __('Agenda'),
};

export const WORKLOAD_ZOOM_LABEL: Record<WorkloadZoom, string> = {
    day: __('Día'),
    week: __('Semana'),
    month: __('Mes'),
};

export const WORKLOAD_METRIC_LABEL: Record<WorkloadMetric, string> = {
    count: __('Registros'),
    estimate: __('Esfuerzo estimado'),
    time: __('Tiempo registrado'),
};
