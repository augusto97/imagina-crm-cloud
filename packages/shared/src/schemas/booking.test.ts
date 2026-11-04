import { describe, expect, it } from 'vitest';

import {
    bookingConfigSchema,
    bookingLocationPublic,
    bookingLocationText,
    bookingMergeValue,
    bookingProblems,
    sampleBookingEvent,
    staffVideoProblem,
    bookingRulesSchema,
    bookingTriggerMatches,
    bookingUsesApproval,
    decideBookingSchema,
    defaultBookingConfig,
    serviceApprovalMode,
    verifyBookingCodeSchema,
    defaultBookingWeek,
    hhmmToMinutes,
    minutesToHhmm,
    type BookingAvailability,
} from './booking';
import { isDisposableEmail } from './disposable-email';
import { bookableWindow, checkBookingSlot, computeBookingSlots, dayIntervals, type StaffSlotsInput } from './booking-slots';

const TZ = 'America/Bogota';
// Martes 3 de noviembre de 2026, 07:00 en Bogotá.
const NOW = new Date('2026-11-03T12:00:00Z');

function avail(over: Partial<BookingAvailability> = {}): BookingAvailability {
    return { week: defaultBookingWeek(), exceptions: [], holiday_country: 'CO', holiday_work: [], holiday_off: [], time_off: [], ...over };
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
        const noSkip = avail({ holiday_country: null });
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
        const a = staff('a', { availability: avail({ holiday_country: null }) });
        const now = new Date('2026-10-20T00:00:00Z');
        const slots = computeBookingSlots({ staff: [a], durationMin: 30, rules: { ...RULES, min_notice_min: 0 }, timeZone: 'Europe/Madrid', now, fromYmd: '2026-10-23', toYmd: '2026-10-26' });
        expect(slots.some((s) => s.start === '2026-10-23T06:00:00.000Z')).toBe(true); // viernes, CEST (+2)
        expect(slots.some((s) => s.start === '2026-10-26T07:00:00.000Z')).toBe(true); // lunes, CET (+1)
    });

    it('v0.1.349 — horario grupal: varias reservas en el mismo horario hasta llenarlo', () => {
        const svc = { id: 'clase', seats: 3, hours: null };
        const at = Date.parse(bog('2026-11-04', '09:00'));
        const one = { start: at, end: at + 30 * 60_000, kind: 'appointment' as const, serviceId: 'clase' };
        const base = { durationMin: 30, rules: RULES, timeZone: TZ, now: NOW, service: svc, fromYmd: '2026-11-04', toYmd: '2026-11-04' };
        const two = computeBookingSlots({ ...base, staff: [staff('a', { busy: [one, one] })] });
        expect(two.find((x) => x.start === bog('2026-11-04', '09:00'))?.seats_left).toBe(1);
        // Lleno: ya no se ofrece.
        const full = computeBookingSlots({ ...base, staff: [staff('a', { busy: [one, one, one] })] });
        expect(full.find((x) => x.start === bog('2026-11-04', '09:00'))).toBeUndefined();
        // Una cita de OTRO servicio en ese horario lo ocupa entero.
        const other = computeBookingSlots({ ...base, staff: [staff('a', { busy: [{ ...one, serviceId: 'consulta' }] })] });
        expect(other.find((x) => x.start === bog('2026-11-04', '09:00'))).toBeUndefined();
        // Individual: el horario libre no trae cupos.
        const solo = computeBookingSlots({ ...base, service: { id: 'x', seats: 1, hours: null }, staff: [staff('a')] });
        expect(solo[0]?.seats_left).toBeUndefined();
    });

    it('v0.1.349 — los márgenes de cada cita son los de su servicio', () => {
        // Una cita de 9:00-9:30 con 60 min de margen después ocupa hasta las 10:30.
        const at = Date.parse(bog('2026-11-04', '09:00'));
        const busy = [{ start: at, end: at + 30 * 60_000, kind: 'appointment' as const, before: 0, after: 60 * 60_000 }];
        const slots = computeBookingSlots({ staff: [staff('a', { busy })], durationMin: 30, rules: RULES, timeZone: TZ, now: NOW, fromYmd: '2026-11-04', toYmd: '2026-11-04' });
        expect(startsOn(slots, '2026-11-04').slice(0, 4)).toEqual(['08:00', '08:30', '10:30', '11:00']);
    });

    it('v0.1.349 — el horario propio del servicio recorta el de quien atiende', () => {
        const mornings = [[], [{ start: '09:00', end: '10:00' }], [{ start: '09:00', end: '10:00' }], [{ start: '09:00', end: '10:00' }], [{ start: '09:00', end: '10:00' }], [{ start: '09:00', end: '10:00' }], []];
        const slots = computeBookingSlots({
            staff: [staff('a')],
            durationMin: 30,
            service: { id: 'v', seats: 1, hours: mornings },
            rules: RULES,
            timeZone: TZ,
            now: NOW,
            fromYmd: '2026-11-04',
            toYmd: '2026-11-04',
        });
        expect(startsOn(slots, '2026-11-04')).toEqual(['09:00', '09:30']);
    });

    it('v0.1.349 — intervalo «igual a la duración»', () => {
        const slots = computeBookingSlots({ staff: [staff('a')], durationMin: 45, rules: { ...RULES, slot_interval_min: 0 }, timeZone: TZ, now: NOW, fromYmd: '2026-11-04', toYmd: '2026-11-04' });
        expect(startsOn(slots, '2026-11-04').slice(0, 5)).toEqual(['08:00', '08:45', '09:30', '10:15', '11:00']);
    });

    it('v0.1.349 — festivos del país que trae el servidor, festivos que sí atiende y vacaciones', () => {
        // Sin el dato del servidor: reglas de Colombia (16 nov 2026 es festivo).
        expect(dayIntervals(avail(), '2026-11-16')).toEqual([]);
        expect(dayIntervals(avail({ holiday_work: ['2026-11-16'] }), '2026-11-16').length).toBe(2);
        // Con el dato del servidor (México): manda ese conjunto.
        const mx = new Set(['2026-11-16']);
        expect(dayIntervals(avail({ holiday_country: 'MX' }), '2026-11-02').length).toBe(2);
        expect(dayIntervals(avail({ holiday_country: 'MX' }), '2026-11-16', mx)).toEqual([]);
        // Vacaciones del 9 al 13; una excepción dentro del rango manda.
        const a = avail({
            time_off: [{ id: 'vac1', from: '2026-11-09', to: '2026-11-13', note: '' }],
            exceptions: [{ date: '2026-11-12', closed: false, intervals: [{ start: '09:00', end: '12:00' }], note: '' }],
        });
        expect(dayIntervals(a, '2026-11-10')).toEqual([]);
        expect(dayIntervals(a, '2026-11-12')).toEqual([{ start: '09:00', end: '12:00' }]);
        expect(dayIntervals(a, '2026-11-17').length).toBe(2);
    });

    it('v0.1.349 — ventana en días hábiles y por rango de fechas', () => {
        // Martes 3: 5 días hábiles → martes 10.
        expect(bookableWindow({ ...RULES, max_days_ahead: 5, business_days: true }, TZ, NOW)).toEqual({ first: '2026-11-03', last: '2026-11-10' });
        expect(bookableWindow({ ...RULES, window_mode: 'range', range_start: '2026-12-01', range_end: '2026-12-15' }, TZ, NOW)).toEqual({ first: '2026-12-01', last: '2026-12-15' });
        // Rango ya empezado: desde hoy. Rango sin fechas: vacío.
        expect(bookableWindow({ ...RULES, window_mode: 'range', range_start: '2026-10-01', range_end: '2026-11-20' }, TZ, NOW).first).toBe('2026-11-03');
        const empty = bookableWindow({ ...RULES, window_mode: 'range', range_start: null, range_end: null }, TZ, NOW);
        expect(empty.first > empty.last).toBe(true);
        const slots = computeBookingSlots({ staff: [staff('a')], durationMin: 30, rules: { ...RULES, window_mode: 'range', range_start: '2026-11-05', range_end: '2026-11-05' }, timeZone: TZ, now: NOW, fromYmd: '2026-11-01', toYmd: '2026-11-30' });
        expect(new Set(slots.map((x) => new Date(new Date(x.start).getTime() - 5 * 3600_000).toISOString().slice(0, 10)))).toEqual(new Set(['2026-11-05']));
    });

    it('v0.1.349 — topes por semana y por mes cuentan horarios (un grupo una vez)', () => {
        // Dos sesiones el lunes 2 (semana del 2 al 8) y tope semanal de 2: esa semana no ofrece más.
        const mon = Date.parse(bog('2026-11-02', '09:00'));
        const a = staff('a', { sessions: [mon, mon, mon + 3600_000] });
        const rules = { ...RULES, max_days_ahead: 30, max_per_week: 2 };
        const slots = computeBookingSlots({ staff: [a], durationMin: 30, rules, timeZone: TZ, now: NOW, fromYmd: '2026-11-03', toYmd: '2026-11-10' });
        expect(startsOn(slots, '2026-11-04')).toEqual([]);
        expect(startsOn(slots, '2026-11-09').length).toBeGreaterThan(0);
        const monthly = computeBookingSlots({ staff: [a], durationMin: 30, rules: { ...RULES, max_days_ahead: 40, max_per_month: 2 }, timeZone: TZ, now: NOW, fromYmd: '2026-11-03', toYmd: '2026-12-02' });
        expect(startsOn(monthly, '2026-11-20')).toEqual([]);
        expect(startsOn(monthly, '2026-12-01').length).toBeGreaterThan(0);
    });

    it('v0.1.349 — una configuración vieja con «no atender festivos de Colombia» se lee igual', () => {
        const on = bookingConfigSchema.parse({ staff: [{ id: 'abcd1', availability: { skip_holidays: true } }] });
        expect(on.staff[0]?.availability.holiday_country).toBe('CO');
        const off = bookingConfigSchema.parse({ staff: [{ id: 'abcd1', availability: { skip_holidays: false } }] });
        expect(off.staff[0]?.availability.holiday_country).toBeNull();
        const svc = bookingConfigSchema.parse({ services: [{ id: 'svc01', name: 'Consulta' }] }).services[0]!;
        expect(svc.seats).toBe(1);
        expect(svc.durations).toEqual([]);
        expect(svc.hours).toBeNull();
    });
});

describe('v0.1.350 — calendario de cada persona y lugar de la cita', () => {
    it('una persona vieja con conexión sigue con esa conexión; sin conexión usa la suya', () => {
        const cfg = bookingConfigSchema.parse({
            staff: [
                { id: 'stfa0001', kind: 'user', staff_user_id: 3, connection_id: 9 },
                { id: 'stfb0002', kind: 'user', staff_user_id: 4 },
                { id: 'stfc0003', kind: 'user', staff_user_id: 5, calendar_source: 'connection', connection_id: 7 },
            ],
        });
        expect(cfg.staff.map((s) => s.calendar_source)).toEqual(['connection', 'person', 'connection']);
        expect(cfg.staff[1]!.busy_calendars).toEqual([]);
        expect(cfg.staff[1]!.write_calendar).toBeNull();
        expect(cfg.calendar_sync).toEqual({ move: true, cancel: true });
        expect(cfg.services).toEqual([]);
    });

    it('el enlace fijo tiene que ser https y un calendario no lleva espacios ni <>', () => {
        expect(bookingConfigSchema.safeParse({ staff: [{ id: 'stfa0001', meeting_url: 'http://zoom.us/j/1' }] }).success).toBe(false);
        expect(bookingConfigSchema.safeParse({ staff: [{ id: 'stfa0001', meeting_url: 'https://zoom.us/j/1' }] }).success).toBe(true);
        expect(bookingConfigSchema.safeParse({ staff: [{ id: 'stfa0001', busy_calendars: ['<x>'] }] }).success).toBe(false);
        expect(bookingConfigSchema.safeParse({ staff: [{ id: 'stfa0001', busy_calendars: ['equipo@group.calendar.google.com'] }] }).success).toBe(true);
        expect(bookingConfigSchema.safeParse({ services: [{ id: 'svca0001', name: 'X', location: { kind: 'link', url: 'javascript:alert(1)' } }] }).success).toBe(false);
    });

    it('lo que ve el cliente antes de reservar nunca trae el enlace', () => {
        const link = bookingLocationPublic({ kind: 'link', video: 'auto', url: 'https://zoom.us/j/123', address: '', phone: 'client', phone_number: '', note: '' }, '');
        expect(JSON.stringify(link)).not.toContain('zoom.us');
        expect(link.label).toBe('Videollamada');
        expect(bookingLocationPublic({ kind: 'video', video: 'meet', url: '', address: '', phone: 'client', phone_number: '', note: '' }, '').label).toBe('Videollamada por Google Meet');
        expect(bookingLocationPublic({ kind: 'in_person', video: 'auto', url: '', address: '', phone: 'client', phone_number: '', note: 'Piso 3' }, 'Cra. 7 #12-34').detail).toBe('Cra. 7 #12-34 · Piso 3');
        expect(bookingLocationPublic({ kind: 'phone', video: 'auto', url: '', address: '', phone: 'company', phone_number: '+57 300 1112233', note: '' }, '').detail).toBe('Llámanos al +57 300 1112233.');
        expect(bookingLocationPublic({ kind: 'page', video: 'auto', url: '', address: '', phone: 'client', phone_number: '', note: '' }, 'Sede norte')).toEqual({ kind: 'page', label: 'Sede norte', detail: '' });
    });

    it('una cita reservada dice dónde es y con qué plataforma', () => {
        const loc = { kind: 'video' as const, video: 'auto' as const, url: '', address: '', phone: 'client' as const, phone_number: '', note: '' };
        expect(bookingLocationText(loc, '', { url: 'https://teams.microsoft.com/l/x', provider: 'teams' })).toBe('Videollamada por Microsoft Teams');
        expect(bookingLocationText(loc, '')).toBe('Videollamada');
        const info = { ...sampleBookingEvent(), location: 'En persona · Sede', meeting_url: 'https://meet.google.com/a', by: 'calendar' as const };
        expect(bookingMergeValue(info, 'lugar')).toBe('En persona · Sede');
        expect(bookingMergeValue(info, 'enlace_reunion')).toBe('https://meet.google.com/a');
        expect(bookingMergeValue(info, 'por')).toBe('quien atiende (desde su calendario)');
    });

    it('quién puede atender por videollamada', () => {
        const base = { kind: 'user' as const, create_events: true, meeting_url: '' };
        expect(staffVideoProblem(base, 'auto', 'google_calendar')).toBeNull();
        expect(staffVideoProblem(base, 'teams', 'outlook')).toBeNull();
        expect(staffVideoProblem(base, 'meet', 'outlook')).toMatch(/Google Calendar/);
        expect(staffVideoProblem(base, 'auto', null)).toMatch(/Mi calendario/);
        expect(staffVideoProblem({ ...base, create_events: false }, 'auto', 'google_calendar')).toMatch(/Agregar cada cita/);
        expect(staffVideoProblem({ ...base, meeting_url: 'https://zoom.us/j/1' }, 'meet', null)).toBeNull();
        expect(staffVideoProblem({ ...base, kind: 'resource' }, 'auto', null)).toMatch(/recurso/);
    });

    it('los problemas de publicar revisan el lugar de cada servicio', () => {
        const cfg = bookingConfigSchema.parse({
            services: [
                { id: 'svca0001', name: 'Asesoría', location: { kind: 'video', video: 'meet' } },
                { id: 'svcb0002', name: 'Visita', location: { kind: 'in_person' } },
                { id: 'svcc0003', name: 'Llamada', location: { kind: 'phone', phone: 'company' } },
                { id: 'svcd0004', name: 'Zoom', location: { kind: 'link' } },
            ],
            staff: [{ id: 'stfa0001', kind: 'user', staff_user_id: 3 }],
        });
        const without = bookingProblems(cfg, []);
        expect(without.some((p) => p.includes('videollamada: '))).toBe(false);
        expect(without).toEqual(expect.arrayContaining([
            expect.stringContaining('dirección de «Visita»'),
            expect.stringContaining('número al que llama el cliente para «Llamada»'),
            expect.stringContaining('enlace de la videollamada de «Zoom»'),
        ]));
        const withCal = bookingProblems(cfg, [], { staffCalendars: { stfa0001: { provider: 'outlook' } } });
        expect(withCal.some((p) => p.includes('no puede atender «Asesoría» por videollamada') && p.includes('Google Calendar'))).toBe(true);
        expect(bookingProblems(cfg, [], { staffCalendars: { stfa0001: { provider: 'google_calendar' } } }).some((p) => p.includes('Asesoría'))).toBe(false);
    });
});


describe('v0.1.353 — aprobación de las citas y seguridad de la página', () => {
    it('una configuración vieja se lee sin aprobación y sin cambiar los eventos del disparador', () => {
        const c = bookingConfigSchema.parse({ services: [{ id: 'svca0001', name: 'Consulta' }] });
        expect(c.approval.mode).toBe('none');
        expect(c.approval.on_timeout).toBe('decline');
        expect(c.services[0]?.approval).toBe('inherit');
        expect(c.settings.verify_email).toBe(false);
        expect(bookingUsesApproval(c)).toBe(false);
        // Sin eventos elegidos = los tres de siempre: una automatización vieja no se dispara con una solicitud.
        expect(bookingTriggerMatches({}, { page_id: 3, event: 'requested' })).toBe(false);
        expect(bookingTriggerMatches({}, { page_id: 3, event: 'declined' })).toBe(false);
        expect(bookingTriggerMatches({ events: ['requested', 'declined'] }, { page_id: 3, event: 'declined' })).toBe(true);
    });

    it('cada servicio puede tener su propia regla', () => {
        const page = { mode: 'all' as const };
        expect(serviceApprovalMode(page, { approval: 'inherit' })).toBe('all');
        expect(serviceApprovalMode(page, { approval: 'none' })).toBe('none');
        expect(serviceApprovalMode({ mode: 'none' }, { approval: 'new_clients' })).toBe('new_clients');
        expect(serviceApprovalMode({ mode: 'new_clients' }, null)).toBe('new_clients');
        // La página no aprueba pero un servicio activo sí: la agenda usa aprobación.
        expect(bookingUsesApproval({ approval: { mode: 'none' }, services: [{ approval: 'all', active: true }] })).toBe(true);
        expect(bookingUsesApproval({ approval: { mode: 'none' }, services: [{ approval: 'all', active: false }] })).toBe(false);
    });

    it('el código son 6 números y decidir sólo acepta aprobar o rechazar', () => {
        expect(verifyBookingCodeSchema.safeParse({ email: 'ana@acme.co', code: ' 123456 ' }).success).toBe(true);
        expect(verifyBookingCodeSchema.safeParse({ email: 'ana@acme.co', code: '12345' }).success).toBe(false);
        expect(verifyBookingCodeSchema.safeParse({ email: 'ana@acme.co', code: '12a456' }).success).toBe(false);
        expect(decideBookingSchema.safeParse({ decision: 'decline', reason: 'Ese día no atendemos' }).success).toBe(true);
        expect(decideBookingSchema.safeParse({ decision: 'cancel' }).success).toBe(false);
        expect(decideBookingSchema.safeParse({ decision: 'decline', reason: 'x'.repeat(501) }).success).toBe(false);
    });

    it('reconoce los correos temporales, también en subdominios y con mayúsculas', () => {
        expect(isDisposableEmail('alguien@mailinator.com')).toBe(true);
        expect(isDisposableEmail('Alguien@YOPMAIL.COM')).toBe(true);
        expect(isDisposableEmail('x@inbox.mailinator.com')).toBe(true);
        expect(isDisposableEmail('x@guerrillamail.com.')).toBe(true);
        expect(isDisposableEmail('ana@gmail.com')).toBe(false);
        expect(isDisposableEmail('ana@mailinator.com.co')).toBe(false);
        expect(isDisposableEmail('ana@notmailinator.com')).toBe(false);
        expect(isDisposableEmail('sin-arroba')).toBe(false);
    });
});
