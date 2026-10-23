import type { CalendarEvent, DropTarget } from './calendarModel';

/**
 * Lo que las vistas del calendario (mes, semana/día, agenda) le piden a la
 * vista que las contiene: abrir, crear, mover, estirar. Un solo objeto para
 * no pasar quince props a cada una.
 */
export interface CalendarActions {
    timeZone: string;
    /** Reloj de 12 horas (formato regional de la empresa). */
    h12: boolean;
    today: string;
    /** Hay alta (permiso y lista que no es de una tienda). */
    canCreate: boolean;
    /** Se arrastra (mouse/lápiz; en táctil, «Mover a…»). */
    dragEnabled: boolean;
    touch: boolean;
    /** Varias fuentes: el evento muestra de cuál es. */
    showSource: boolean;
    open: (event: CalendarEvent) => void;
    /** «Mover a…» (undefined si este evento no se puede mover). */
    moveTo: (event: CalendarEvent) => ((event: CalendarEvent) => void) | undefined;
    /** Por qué no se puede mover o estirar este evento (null = se puede). */
    lockedReason: (event: CalendarEvent, what: 'move' | 'resize') => string | null;
    canResize: (event: CalendarEvent) => boolean;
    commitMove: (event: CalendarEvent, target: DropTarget) => void;
    commitResize: (event: CalendarEvent, target: DropTarget) => void;
    /** Crear en un hueco: el día y, en la grilla de horas, el minuto (y el fin al arrastrar). */
    create: (slot: { day: string; endDay?: string; minute?: number; endMinute?: number }) => void;
    /** Todos los eventos de un día («+N más»). */
    showDay: (day: string) => void;
    recurring: (event: CalendarEvent) => boolean;
    sourceLabel: (event: CalendarEvent) => string;
}
