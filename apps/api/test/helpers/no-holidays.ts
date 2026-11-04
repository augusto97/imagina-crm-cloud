import type { BookingHolidaysService } from '../../src/booking/booking-holidays';

/**
 * v0.1.349 — Festivos «desconocidos» para los tests de la agenda que no los
 * prueban: el motor usa entonces sus reglas (Colombia con la Ley Emiliani),
 * igual que antes de que existieran los festivos por país. Sin red.
 */
export const NO_HOLIDAYS = {
    blockedFor: async () => undefined,
    items: async () => null,
} as unknown as BookingHolidaysService;
