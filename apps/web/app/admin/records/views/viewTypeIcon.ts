import { Calendar, Columns3, GanttChart, Gauge, LayoutGrid, Table } from 'lucide-react';

import type { ListIconComponent } from '@/lib/listIcons';

/** Icono por tipo de vista (el de la pestaña cuando no eligió uno propio). */
export function viewTypeIcon(type: string): ListIconComponent {
    if (type === 'kanban') return Columns3 as unknown as ListIconComponent;
    if (type === 'calendar') return Calendar as unknown as ListIconComponent;
    if (type === 'cards') return LayoutGrid as unknown as ListIconComponent;
    if (type === 'gantt') return GanttChart as unknown as ListIconComponent;
    if (type === 'workload') return Gauge as unknown as ListIconComponent;
    return Table as unknown as ListIconComponent;
}
