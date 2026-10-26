import { describe, expect, it } from 'vitest';

import {
    bookingConfigSchema,
    bookingProblems,
    bookingRulesSchema,
    bookingTriggerMatches,
    defaultBookingConfig,
    defaultBookingWeek,
    hhmmToMinutes,
    minutesToHhmm,
    type BookingAvailability,
} from './booking';
import { bookableWindow, checkBookingSlot, computeBookingSlots, dayIntervals, type StaffSlotsInput } from './booking-slots';

const TZ = 'America/Bogota';
// Martes 3 de noviembre de 2026, 07:00 en Bogotá.
const NOW = new Date('2026-11-03T12:00:00Z');

function avail(over: Partial<BookingAvailability> = {}): BookingAvailability {
    return { week: defaultBookingWeek(), exceptions: [], skip_holidays: true, ...over };
}

function staff(id: string, over: Partial<StaffSlotsInput> = {}): StaffSlotsInput {
    return { id, availability: avail(), busy: [], dayCounts: new Map(), ...over };
}

const RULES = bookingRulesSchema.parse({ min_notice_min: 120, slot_interval_min: 30, max_days_ahead: 10 });

/** «09:30» en Bogotá de ese día → ISO UTC. */
function bog(ymd: string, hhmm: string): string {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)), h + 5, m)).toISOString();
}

function startsOn(slots: ReturnType<typeof computeBookingSlots>, ymd: string): string[] {
    return slots
        .filter((s) => {
            const local = new Date(new Date(s.start).getTime() - 5 * 3600_000).toISOString();
            return local.startsWith(ymd);
        })
        .map((s) => new Date(new Date(s.start).getTime() - 5 * 3600_000).toISOString().slice(11, 16));
}

describe('Agenda (D5) — esquemas', () => {
    it('una página vacía tiene defaults razonables', () => {
        const c = bookingConfigSchema.parse({});
        expect(c.rules.slot_interval_min).toBe(30);
        expect(c.notifications.reminders.map((r) => r.minutes_before)).toEqual([1440, 60]);
        expect(c.settings.choose_staff).toBe('visitor');
    });

    it('rechaza un tramo que termina antes de empezar y un intervalo raro', () => {
        expect(() =>
            bookingConfigSchema.parse({
                staff: [{ id: 'abcd1', availability: { week: [[{ start: '10:00', end: '09:00' }], [], [], [], [], [], []] } }],
            }),
        ).toThrow();
        expect(() => bookingRulesSchema.parse({ slot_interval_min: 7 })).toThrow();
    });

    it('HH:MM ↔ minutos', () => {
        expect(hhmmToMinutes('08:30')).toBe(510);
        expect(minutesToHhmm(1439)).toBe('23:59');
    });

    it('lo que falta para publicar, en lenguaje claro', () => {
        const fields = [{ id: 1, type: 'datetime' }, { id: 2, type: 'user' }];
        const empty = bookingConfigSchema.parse({});
        const p = bookingProblems(empty, fields);
        expect(p.some((x) => x.includes('fecha y hora'))).toBe(true);
        expect(p.some((x) => x.includes('servicio'))).toBe(true);
        const ok = bookingConfigSchema.parse({
            services: [{ id: 'svc1', name: 'Consulta' }],
            staff: [{ id: 'stf1', kind: 'user', staff_user_id: 9 }],
            mapping: { start_field_id: 1, person_field_id: 2 },
        });
        expect(bookingProblems(ok, fields)).toEqual([]);
    });

    it('arranca con los campos de la lista que se parecen', () => {
        const c = defaultBookingConfig({
            listName: 'Citas',
            userId: 4,
            fields: [
                { id: 1, type: 'text', slug: 'cliente', label: 'Cliente' },
                { id: 2, type: 'email', slug: 'email', label: 'Email' },
                { id: 3, type: 'datetime', slug: 'fecha', label: 'Fecha y hora' },
                { id: 4, type: 'user', slug: 'profesional', label: 'Profesional' },
                { id: 5, type: 'select', slug: 'estado', label: 'Estado' },
                { id: 6, type: 'select', slug: 'servicio', label: 'Servicio' },
            ],
        });
        expect(c.mapping).toMatchObject({ start_field_id: 3, person_field_id: 4, name_field_id: 1, email_field_id: 2, status_field_id: 5, service_field_id: 6 });
        expect(c.staff[0]?.staff_user_id).toBe(4);
    });

    it('el disparador filtra por página y por evento', () => {
        expect(bookingTriggerMatches({}, { page_id: 3, event: 'cancelled' })).toBe(true);
        expect(bookingTriggerMatches({ booking_page_id: 4 }, { page_id: 3, event: 'booked' })).toBe(false);
        expect(bookingTriggerMatches({ booking_page_id: 3, events: ['booked'] }, { page_id: 3, event: 'booked' })).toBe(true);
        expect(bookingTriggerMatches({ events: ['booked', 'rescheduled'] }, { page_id: 3, event: 'cancelled' })).toBe(false);
    });
});

describe('Agenda (D5) — horarios libres', () => {
    it('horario de la empresa, aviso mínimo e intervalos', () => {
        const slots = computeBookingSlots({ staff: [staff('a')], durationMin: 30, rules: RULES, timeZone: TZ, now: NOW, fromYmd: '2026-11-03', toYmd: '2026-11-03' });
        // 07:00 + 2 h de aviso → desde las 09:00.
        expect(startsOn(slots, '2026-11-03')).toEqual([
            '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
            '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        ]);
        expect(slots[0]?.start).toBe(bog('2026-11-03', '09:00'));
        expect(slots[0]?.end).toBe(bog('2026-11-03', '09:30'));
    });

    it('una cita de 60 minutos tiene que caber en el tramo', () => {
        const slots = computeBookingSlots({ staff: [staff('a')], durationMin: 60, rules: RULES, timeZone: TZ, now: NOW, fromYmd: '2026-11-04', toYmd: '2026-11-04' });
        const day = startsOn(slots, '2026-11-04');
        expect(day).toContain('11:00');
        expect(day).not.toContain('11:30');
        expect(day).toContain('17:00');
        expect(day).not.toContain('17:30');
    });

    it('citas tomadas con márgenes y lo ocupado del calendario externo', () => {
        const rules = { ...RULES, buffer_before_min: 15, buffer_after_min: 15 };
        const busy = [
            { start: Date.parse(bog('2026-11-04', '10:00')), end: Date.parse(bog('2026-11-04', '10:30')), kind: 'appointment' as const },
            { start: Date.parse(bog('2026-11-04', '14:00')), end: Date.parse(bog('2026-11-04', '15:00')), kind: 'external' as const },
        ];
        const slots = computeBookingSlots({ staff: [staff('a', { busy })], durationMin: 30, rules, timeZone: TZ, now: NOW, fromYmd: '2026-11-04', toYmd: '2026-11-04' });
        const day = startsOn(slots, '2026-11-04');
        expect(day).toEqual(['08:00', '08:30', '09:00', '11:00', '11:30', '15:30', '16:00', '16:30', '17:00', '17:30']);
    });

    it('festivos de Colombia, excepciones y días cerrados', () => {
        // 2 nov 2026 (Todos los Santos, trasladado al lunes) y 16 nov (Cartagena).
        const a = staff('a', {
            availability: avail({
                exceptions: [
                    { date: '2026-11-16', closed: false, intervals: [{ start: '09:00', end: '10:00' }], note: '' },
                    { date: '2026-11-05', closed: true, intervals: [], note: 'Vacaciones' },
                ],
            }),
        });
        expect(dayIntervals(a.availability, '2026-11-02')).toEqual([]);
        expect(dayIntervals(a.availability, '2026-11-16')).toEqual([{ start: '09:00', end: '10:00' }]);
        expect(dayIntervals(a.availability, '2026-11-05')).toEqual([]);
        const noSkip = avail({ skip_holidays: false });
        expect(dayIntervals(noSkip, '2026-11-02').length).toBe(2);
        const rules = { ...RULES, max_days_ahead: 30 };
        const slots = computeBookingSlots({ staff: [a], durationMin: 30, rules, timeZone: TZ, now: NOW, fromYmd: '2026-11-05', toYmd: '2026-11-16' });
        expect(startsOn(slots, '2026-11-05')).toEqual([]);
        expect(startsOn(slots, '2026-11-16')).toEqual(['09:00', '09:30']);
        // Sábado y domingo no atienden.
        expect(startsOn(slots, '2026-11-07')).toEqual([]);
    });

    it('tope de citas por día y días hacia adelante', () => {
        const rules = { ...RULES, max_per_day: 2 };
        const a = staff('a', { dayCounts: new Map([['2026-11-04', 2]]) });
        const slots = computeBookingSlots({ staff: [a], durationMin: 30, rules, timeZone: TZ, now: NOW, fromYmd: '2026-11-03', toYmd: '2026-12-31' });
        expect(startsOn(slots, '2026-11-04')).toEqual([]);
        expect(startsOn(slots, '2026-11-06').length).toBeGreaterThan(0);
        expect(bookableWindow(rules, TZ, NOW)).toEqual({ first: '2026-11-03', last: '2026-11-13' });
        expect(startsOn(slots, '2026-11-16')).toEqual([]);
    });

    it('«el primero disponible» junta a todos los que pueden atender', () => {
        const b = staff('b', { availability: avail({ week: [[], [], [{ start: '09:00', end: '10:00' }], [], [], [], []] }) });
        const busy = [{ start: Date.parse(bog('2026-11-03', '09:00')), end: Date.parse(bog('2026-11-03', '09:30')), kind: 'appointment' as const }];
        const slots = computeBookingSlots({ staff: [staff('a', { busy }), b], durationMin: 30, rules: RULES, timeZone: TZ, now: NOW, fromYmd: '2026-11-03', toYmd: '2026-11-03' });
        expect(slots.find((s) => s.start === bog('2026-11-03', '09:00'))?.staff).toEqual(['b']);
        expect(slots.find((s) => s.start === bog('2026-11-03', '09:30'))?.staff).toEqual(['a', 'b']);
        expect(slots.find((s) => s.start === bog('2026-11-03', '10:00'))?.staff).toEqual(['a']);
    });

    it('el re-chequeo al confirmar dice por qué no', () => {
        const busy = [{ start: Date.parse(bog('2026-11-04', '10:00')), end: Date.parse(bog('2026-11-04', '10:30')), kind: 'appointment' as const }];
        const base = { durationMin: 30, rules: RULES, timeZone: TZ, now: NOW, staff: staff('a', { busy }) };
        expect(checkBookingSlot({ ...base, start: new Date(bog('2026-11-04', '11:00')) })).toBeNull();
        expect(checkBookingSlot({ ...base, start: new Date(bog('2026-11-04', '10:00')) })).toBe('taken');
        expect(checkBookingSlot({ ...base, start: new Date(bog('2026-11-03', '08:00')) })).toBe('too_soon');
        expect(checkBookingSlot({ ...base, start: new Date(bog('2026-12-20', '09:00')) })).toBe('out_of_range');
        // Un inicio fuera de la grilla de horarios tampoco se acepta.
        expect(checkBookingSlot({ ...base, start: new Date(bog('2026-11-04', '11:10')) })).toBe('taken');
    });

    it('una zona con cambio de horario sigue el reloj local', () => {
        // Madrid pasa a horario de invierno el 25 oct 2026: las 9:00 son 08:00 UTC.
        const a = staff('a', { availability: avail({ skip_holidays: false }) });
        const now = new Date('2026-10-20T00:00:00Z');
        const slots = computeBookingSlots({ staff: [a], durationMin: 30, rules: { ...RULES, min_notice_min: 0 }, timeZone: 'Europe/Madrid', now, fromYmd: '2026-10-23', toYmd: '2026-10-26' });
        expect(slots.some((s) => s.start === '2026-10-23T06:00:00.000Z')).toBe(true); // viernes, CEST (+2)
        expect(slots.some((s) => s.start === '2026-10-26T07:00:00.000Z')).toBe(true); // lunes, CET (+1)
    });
});
