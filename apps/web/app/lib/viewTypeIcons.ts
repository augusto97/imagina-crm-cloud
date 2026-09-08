import { Calendar, Columns3, LayoutGrid, Table, type LucideIcon } from 'lucide-react';

/**
 * Icono por tipo de vista (tabla / kanban / calendario / tarjetas). Es el
 * mismo vocabulario que usan las pestañas de vistas de la lista; acá lo
 * comparten superficies que sólo muestran un resumen (galería de plantillas).
 */
export function viewTypeIcon(type: string): LucideIcon {
    switch (type) {
        case 'kanban':
            return Columns3;
        case 'calendar':
            return Calendar;
        case 'cards':
            return LayoutGrid;
        default:
            return Table;
    }
}
