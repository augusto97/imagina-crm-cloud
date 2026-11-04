import { isColombianHoliday, ymdToMs } from '../formula/dates';
import { addDaysYmd, resolveTimeZone, zonedDayAndMinute, zonedInstant, zonedToday } from './timezone';
import { hhmmToMinutes, type BookingAvailability, type BookingInterval, type BookingRules, type PublicBookingSlot } from './booking';

/**
 * D5 — Motor de disponibilidad de la agenda. PURO (sin base ni red): el
 * servidor le pasa lo ocupado y lo usan igual la página pública, la vista
 * previa del constructor y el re-chequeo al confirmar una reserva. Así lo que
 * se ofrece y lo que se acepta salen de la MISMA cuenta.
 *
 * Reglas:
 *  - El horario (semanal + excepciones) está en el reloj de la empresa: un
 *    «8:00» es las 8 de Bogotá aunque el visitante esté en Madrid.
 *  - Cada cita RESERVA [inicio − margen antes, fin + margen después] con los
 *    márgenes DE SU SERVICIO (v0.1.349); dos reservas no se pisan (el margen
 *    de limpieza de una y el de preparación de la siguiente se suman). Lo
 *    ocupado de un calendario externo (Google, Outlook) es sólo [inicio, fin]:
 *    no son citas de la agenda.
 *  - La cita en sí tiene que caber en un tramo del horario —el de quien
 *    atiende, recortado por el horario propio del servicio si lo tiene—; los
 *    márgenes pueden salirse del tramo.
 *  - Cupos (v0.1.349): un servicio grupal recibe hasta N reservas en el MISMO
 *    horario (mismo inicio y fin, mismo servicio); cualquier otra cita que se
 *    cruce lo ocupa entero.
 *  - Aviso mínimo: el inicio tiene que estar a más de N minutos de ahora.
 *  - Ventana: los próximos N días (corridos o hábiles) o un rango de fechas.
 *  - Topes por día, semana (lunes a domingo) y mes por persona o recurso: un
 *    horario grupal cuenta UNA vez, y un horario grupal que ya existe sigue
 *    recibiendo reservas aunque el tope se haya alcanzado (ya está contado).
 *  - Festivos: las fechas que el servidor resolvió para el país de la persona
 *    (`holidays`); sin ese dato, las reglas de Colombia si el país es CO.
 *    Una excepción de esa fecha manda.
 *  - Vacaciones (rangos): no atiende, salvo una excepción de esa fecha.
 */

export interface BusyInterval {
    /** ms epoch */
    start: number;
    end: number;
    /** `appointment` = una cita de la lista (lleva márgenes); `external` = un calendario. */
    kind: 'appointment' | 'external';
    /** v0.1.349 — Márgenes propios de esa cita (ms; los de su servicio). Sin esto, los del horario que se evalúa. */
    before?: number;
    after?: number;
    /** v0.1.349 — Servicio de la cita (para sumar reservas a un horario grupal). */
    serviceId?: string | null;
    /** v0.1.349 — Id del evento en el calendario externo (para no contar dos veces una cita de la agenda). */
    externalId?: string;
}

export interface StaffSlotsInput {
    id: string;
    availability: BookingAvailability;
    busy: readonly BusyInterval[];
    /**
     * v0.1.349 — Inicios (ms) de los horarios ya tomados por esta persona o
     * recurso, uno por horario (un grupo cuenta una vez): con esto se cuentan
     * los topes por día, semana y mes. Tiene que cubrir las semanas y meses
     * enteros del rango si hay topes semanales o mensuales.
     */
    sessions?: readonly number[];
    /** Antes de v0.1.349: citas por día (sólo el tope diario). Se usa si no hay `sessions`. */
    dayCounts?: ReadonlyMap<string, number>;
    /** v0.1.349 — Fechas (zona de la empresa) en que no atiende por festivo. */
    holidays?: ReadonlySet<string>;
}

export interface SlotServiceInput {
    id: string;
    /** Cupos por horario (1 = individual). */
    seats: number;
    /** Horario propio del servicio (recorta el de quien atiende). null = sin recorte. */
    hours: BookingInterval[][] | null;
}

export type SlotRules = Pick<
    BookingRules,
    'buffer_before_min' | 'buffer_after_min' | 'min_notice_min' | 'max_days_ahead' | 'slot_interval_min' | 'max_per_day'
> &
    Partial<Pick<BookingRules, 'window_mode' | 'business_days' | 'range_start' | 'range_end' | 'max_per_week' | 'max_per_month'>>;

export interface ComputeSlotsInput {
    staff: readonly StaffSlotsInput[];
    durationMin: number;
    /** v0.1.349 — Cupos y horario del servicio. Sin esto: individual y sin recorte. */
    service?: SlotServiceInput;
    rules: SlotRules;
    timeZone: string;
    now: Date;
    /** Rango pedido (zona de la empresa, inclusive). Se recorta a la ventana reservable. */
    fromYmd: string;
    toYmd: string;
}

const MIN = 60_000;

function ymdParts(ymd: string): [number, number, number] {
    return ymd.split('-').map(Number) as [number, number, number];
}

function weekday(ymd: string): number {
    const [y, m, d] = ymdParts(ymd);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El lunes de la semana de esa fecha (clave del tope semanal). */
export function weekKey(ymd: string): string {
    const dow = weekday(ymd);
    return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow);
}

/** ¿La persona no atiende ese día por festivo? */
export function isStaffHoliday(availability: BookingAvailability, ymd: string, holidays?: ReadonlySet<string>): boolean {
    if (holidays) return holidays.has(ymd);
    if (availability.holiday_country !== 'CO') return false;
    if ((availability.holiday_work ?? []).includes(ymd)) return false;
    const [y, m, d] = ymdParts(ymd);
    return isColombianHoliday(ymdToMs(y, m, d));
}

/** ¿Esa fecha cae en unas vacaciones? */
export function isStaffTimeOff(availability: BookingAvailability, ymd: string): boolean {
    return (availability.time_off ?? []).some((t) => t.from <= ymd && ymd <= t.to);
}

/**
 * Los tramos de un día para una persona: excepción de esa fecha; si no,
 * vacaciones o festivo (cerrado); si no, el horario semanal.
 */
export function dayIntervals(availability: BookingAvailability, ymd: string, holidays?: ReadonlySet<string>): BookingInterval[] {
    const exception = availability.exceptions.find((e) => e.date === ymd);
    if (exception) return exception.closed ? [] : exception.intervals;
    if (isStaffTimeOff(availability, ymd)) return [];
    if (isStaffHoliday(availability, ymd, holidays)) return [];
    return availability.week[weekday(ymd)] ?? [];
}

/** Lo que tienen en común dos listas de tramos (minutos del día). */
export function intersectIntervals(a: readonly BookingInterval[], b: readonly BookingInterval[]): Array<{ start: number; end: number }> {
    const out: Array<{ start: number; end: number }> = [];
    for (const x of a) {
        for (const y of b) {
            const s = Math.max(hhmmToMinutes(x.start), hhmmToMinutes(y.start));
            const e = Math.min(hhmmToMinutes(x.end), hhmmToMinutes(y.end));
            if (e > s) out.push({ start: s, end: e });
        }
    }
    return out.sort((p, q) => p.start - q.start);
}

/** Los tramos (minutos) en que se puede ofrecer ese servicio con esa persona ese día. */
export function serviceDayIntervals(
    availability: BookingAvailability,
    ymd: string,
    serviceHours: BookingInterval[][] | null,
    holidays?: ReadonlySet<string>,
): Array<{ start: number; end: number }> {
    const staff = dayIntervals(availability, ymd, holidays);
    if (serviceHours === null) return staff.map((i) => ({ start: hhmmToMinutes(i.start), end: hhmmToMinutes(i.end) }));
    return intersectIntervals(staff, serviceHours[weekday(ymd)] ?? []);
}

/** ¿Una reserva [start, end] (ms, SIN márgenes) choca con lo ocupado? (Una cita individual.) */
export function slotConflicts(
    start: number,
    end: number,
    busy: readonly BusyInterval[],
    rules: Pick<BookingRules, 'buffer_before_min' | 'buffer_after_min'>,
): boolean {
    return seatsTaken(start, end, busy, rules, { id: '', seats: 1 }) === null;
}

/**
 * Cuántas reservas YA tiene ese horario grupal (0 en uno individual libre), o
 * null si no se puede: choca con otra cita, con el calendario o está lleno.
 */
export function seatsTaken(
    start: number,
    end: number,
    busy: readonly BusyInterval[],
    rules: Pick<BookingRules, 'buffer_before_min' | 'buffer_after_min'>,
    service: Pick<SlotServiceInput, 'id' | 'seats'>,
): number | null {
    const before = rules.buffer_before_min * MIN;
    const after = rules.buffer_after_min * MIN;
    const rs = start - before;
    const re = end + after;
    let taken = 0;
    for (const b of busy) {
        if (b.kind === 'appointment' && service.seats > 1 && b.serviceId === service.id && b.start === start && b.end === end) {
            taken++;
            continue;
        }
        const bs = b.kind === 'appointment' ? b.start - (b.before ?? before) : b.start;
        const be = b.kind === 'appointment' ? b.end + (b.after ?? after) : b.end;
        if (rs < be && bs < re) return null;
    }
    return taken >= service.seats ? null : taken;
}

/** El día hábil número N después de hoy (lunes a viernes; hoy no cuenta). */
function addBusinessDaysYmd(ymd: string, n: number): string {
    let out = ymd;
    let left = n;
    for (let guard = 0; left > 0 && guard < 1000; guard++) {
        out = addDaysYmd(out, 1);
        const dow = weekday(out);
        if (dow !== 0 && dow !== 6) left--;
    }
    return out;
}

/**
 * Primer y último día reservables (zona de la empresa). Un rango incompleto o
 * ya vencido da una ventana vacía (`first > last`).
 */
export function bookableWindow(rules: SlotRules, timeZone: string, now: Date): { first: string; last: string } {
    const today = zonedToday(timeZone, now);
    if (rules.window_mode === 'range') {
        if (!rules.range_start || !rules.range_end) return { first: today, last: addDaysYmd(today, -1) };
        return { first: rules.range_start > today ? rules.range_start : today, last: rules.range_end };
    }
    const last = rules.business_days ? addBusinessDaysYmd(today, rules.max_days_ahead) : addDaysYmd(today, rules.max_days_ahead);
    return { first: today, last };
}

interface CapCounter {
    dayFull(ymd: string): boolean;
}

function capCounter(s: StaffSlotsInput, rules: SlotRules, tz: string): CapCounter {
    const day = rules.max_per_day ?? null;
    const week = rules.max_per_week ?? null;
    const month = rules.max_per_month ?? null;
    if (day === null && week === null && month === null) return { dayFull: () => false };
    const perDay = new Map<string, number>();
    const perWeek = new Map<string, number>();
    const perMonth = new Map<string, number>();
    if (s.sessions) {
        for (const ms of new Set(s.sessions)) {
            const ymd = zonedDayAndMinute(new Date(ms), tz).ymd;
            perDay.set(ymd, (perDay.get(ymd) ?? 0) + 1);
            const wk = weekKey(ymd);
            perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
            const mo = ymd.slice(0, 7);
            perMonth.set(mo, (perMonth.get(mo) ?? 0) + 1);
        }
    } else if (s.dayCounts) {
        for (const [ymd, n] of s.dayCounts) perDay.set(ymd, n);
    }
    return {
        dayFull: (ymd) =>
            (day !== null && (perDay.get(ymd) ?? 0) >= day) ||
            (week !== null && (perWeek.get(weekKey(ymd)) ?? 0) >= week) ||
            (month !== null && (perMonth.get(ymd.slice(0, 7)) ?? 0) >= month),
    };
}

/**
 * Los horarios libres del rango, ordenados por inicio. Un horario lista a
 * todas las personas o recursos que pueden atenderlo (para «el primero
 * disponible»).
 */
export function computeBookingSlots(input: ComputeSlotsInput): PublicBookingSlot[] {
    const tz = resolveTimeZone(input.timeZone);
    const { first, last } = bookableWindow(input.rules, tz, input.now);
    const from = input.fromYmd < first ? first : input.fromYmd;
    const to = input.toYmd > last ? last : input.toYmd;
    if (from > to) return [];
    const durationMin = Math.max(5, Math.round(input.durationMin));
    const duration = durationMin * MIN;
    const stepMin = input.rules.slot_interval_min > 0 ? Math.max(5, input.rules.slot_interval_min) : durationMin;
    const earliest = input.now.getTime() + input.rules.min_notice_min * MIN;
    const service: SlotServiceInput = input.service ?? { id: '', seats: 1, hours: null };

    const byStart = new Map<number, { staff: Set<string>; left: number }>();
    // El instante de «día + minuto» se calcula una vez aunque varias personas lo usen.
    const instantCache = new Map<string, number>();
    const instant = (ymd: string, minute: number): number => {
        const key = `${ymd}|${minute}`;
        let v = instantCache.get(key);
        if (v === undefined) {
            v = minute >= 24 * 60 ? zonedInstant(addDaysYmd(ymd, 1), tz).getTime() : zonedInstant(ymd, tz, { h: Math.floor(minute / 60), m: minute % 60 }).getTime();
            instantCache.set(key, v);
        }
        return v;
    };

    for (const s of input.staff) {
        const caps = capCounter(s, input.rules, tz);
        for (let ymd = from, guard = 0; ymd <= to && guard < 400; ymd = addDaysYmd(ymd, 1), guard++) {
            const capped = caps.dayFull(ymd);
            for (const interval of serviceDayIntervals(s.availability, ymd, service.hours, s.holidays)) {
                const endAt = instant(ymd, interval.end);
                for (let t = interval.start; t < interval.end; t += stepMin) {
                    const st = instant(ymd, t);
                    const en = st + duration;
                    if (en > endAt) break;
                    if (st < earliest) continue;
                    const taken = seatsTaken(st, en, s.busy, input.rules, service);
                    if (taken === null) continue;
                    // Con el tope del período alcanzado sólo se suma a un horario grupal que ya existe.
                    if (capped && taken === 0) continue;
                    let entry = byStart.get(st);
                    if (!entry) {
                        entry = { staff: new Set(), left: 0 };
                        byStart.set(st, entry);
                    }
                    entry.staff.add(s.id);
                    entry.left = Math.max(entry.left, service.seats - taken);
                }
            }
        }
    }
    const order = new Map(input.staff.map((s, i) => [s.id, i]));
    return [...byStart.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([st, e]) => ({
            start: new Date(st).toISOString(),
            end: new Date(st + duration).toISOString(),
            staff: [...e.staff].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
            ...(service.seats > 1 ? { seats_left: e.left } : {}),
        }));
}

/**
 * Re-chequeo al confirmar: ¿este inicio exacto está libre para esta persona?
 * Devuelve el motivo si no (para el mensaje al visitante) o null si se puede.
 */
export function checkBookingSlot(input: Omit<ComputeSlotsInput, 'staff' | 'fromYmd' | 'toYmd'> & { staff: StaffSlotsInput; start: Date }): string | null {
    const tz = resolveTimeZone(input.timeZone);
    const { ymd } = zonedDayAndMinute(input.start, tz);
    const slots = computeBookingSlots({ ...input, staff: [input.staff], fromYmd: ymd, toYmd: ymd });
    const iso = input.start.toISOString();
    if (slots.some((s) => s.start === iso)) return null;
    const { first, last } = bookableWindow(input.rules, tz, input.now);
    if (input.start.getTime() < input.now.getTime() + input.rules.min_notice_min * MIN) return 'too_soon';
    if (ymd < first || ymd > last) return 'out_of_range';
    return 'taken';
}
