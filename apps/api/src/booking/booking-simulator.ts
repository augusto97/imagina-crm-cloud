import type { BookingEvent, BookingEventInfo } from '@imagina-base/shared';

/**
 * D5 — Lo que el motor de automatizaciones necesita de la agenda para
 * «Probar» el disparador «Cuando se agenda, reprograma o cancela una cita»:
 * la cita del registro (si llegó por una página de agenda) con el evento
 * supuesto. Es una interfaz con token propio para que el motor no importe el
 * módulo de la agenda (que a su vez usa el despachador de automatizaciones).
 */
export interface BookingSimulator {
    simulatedEvent(tenantId: number, recordId: number, event: BookingEvent): Promise<BookingEventInfo | null>;
}

export const BOOKING_SIMULATOR = Symbol('BOOKING_SIMULATOR');
