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
 *  - Cada cita RESERVA [inicio − margen antes, fin + margen después]; dos
 *    reservas no se pisan (el margen de limpieza de una y el de preparación de
 *    la siguiente se suman). Lo ocupado de un calendario externo (Google,
 *    Outlook) es sólo [inicio, fin]: no son citas de la agenda.
 *  - La cita en sí tiene que caber en un tramo del horario; los márgenes
 *    pueden salirse del tramo.
 *  - Aviso mínimo: el inicio tiene que estar a más de N minutos de ahora.
 *  - Hasta N días hacia adelante (contando desde hoy en la zona de la empresa).
 *  - Tope diario: con N citas ese día, la persona no ofrece más ese día.
 *  - Festivos de Colombia: si la persona no atiende en festivos, el día se
 *    salta — salvo que una excepción diga otro horario para esa fecha.
 */

export interface BusyInterval {
    /** ms epoch */
    start: number;
    end: number;
    /** `appointment` = una cita de la lista (lleva márgenes); `external` = un calendario. */
    kind: 'appointment' | 'external';
}

export interface StaffSlotsInput {
    id: string;
    availability: BookingAvailability;
    busy: readonly BusyInterval[];
    /** Citas (no canceladas) por día (YYYY-MM-DD en la zona de la empresa). */
    dayCounts: ReadonlyMap<string, number>;
}

export interface ComputeSlotsInput {
    staff: readonly StaffSlotsInput[];
    durationMin: number;
    rules: Pick<BookingRules, 'buffer_before_min' | 'buffer_after_min' | 'min_notice_min' | 'max_days_ahead' | 'slot_interval_min' | 'max_per_day'>;
    timeZone: string;
    now: Date;
    /** Rango pedido (zona de la empresa, inclusive). Se recorta a [hoy, hoy + max_days_ahead]. */
    fromYmd: string;
    toYmd: string;
}

const MIN = 60_000;

/** Los tramos de un día para una persona: excepción, si no festivo, si no el horario semanal. */
export function dayIntervals(availability: BookingAvailability, ymd: string): BookingInterval[] {
    const exception = availability.exceptions.find((e) => e.date === ymd);
    if (exception) return exception.closed ? [] : exception.intervals;
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    if (availability.skip_holidays && isColombianHoliday(ymdToMs(y, m, d))) return [];
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return availability.week[dow] ?? [];
}

/** ¿Una reserva [start, end] (ms, SIN márgenes) choca con lo ocupado? */
export function slotConflicts(
    start: number,
    end: number,
    busy: readonly BusyInterval[],
    rules: Pick<BookingRules, 'buffer_before_min' | 'buffer_after_min'>,
): boolean {
    const before = rules.buffer_before_min * MIN;
    const after = rules.buffer_after_min * MIN;
    const rs = start - before;
    const re = end + after;
    for (const b of busy) {
        const bs = b.kind === 'appointment' ? b.start - before : b.start;
        const be = b.kind === 'appointment' ? b.end + after : b.end;
        if (rs < be && bs < re) return true;
    }
    return false;
}

/** Primer y último día reservables (zona de la empresa). */
export function bookableWindow(rules: Pick<BookingRules, 'max_days_ahead'>, timeZone: string, now: Date): { first: string; last: string } {
    const today = zonedToday(timeZone, now);
    return { first: today, last: addDaysYmd(today, rules.max_days_ahead) };
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
    const duration = Math.max(5, Math.round(input.durationMin)) * MIN;
    const step = Math.max(5, input.rules.slot_interval_min) * MIN;
    const earliest = input.now.getTime() + input.rules.min_notice_min * MIN;
    const cap = input.rules.max_per_day;

    const byStart = new Map<number, Set<string>>();
    // El instante de «día + minuto» se calcula una vez aunque varias personas lo usen.
    const instantCache = new Map<string, number>();
    const instant = (ymd: string, minute: number): number => {
        const key = `${ymd}|${minute}`;
        let v = instantCache.get(key);
        if (v === undefined) {
            v = zonedInstant(ymd, tz, { h: Math.floor(minute / 60), m: minute % 60 }).getTime();
            instantCache.set(key, v);
        }
        return v;
    };

    for (let ymd = from, guard = 0; ymd <= to && guard < 400; ymd = addDaysYmd(ymd, 1), guard++) {
        for (const s of input.staff) {
            if (cap !== null && (s.dayCounts.get(ymd) ?? 0) >= cap) continue;
            for (const interval of dayIntervals(s.availability, ymd)) {
                const startMin = hhmmToMinutes(interval.start);
                const endMin = hhmmToMinutes(interval.end);
                const endAt = endMin >= 24 * 60 ? instant(addDaysYmd(ymd, 1), 0) : instant(ymd, endMin);
                for (let t = startMin; t < endMin; t += step / MIN) {
                    const st = instant(ymd, t);
                    const en = st + duration;
                    if (en > endAt) break;
                    if (st < earliest) continue;
                    if (slotConflicts(st, en, s.busy, input.rules)) continue;
                    let set = byStart.get(st);
                    if (!set) {
                        set = new Set();
                        byStart.set(st, set);
                    }
                    set.add(s.id);
                }
            }
        }
    }
    const order = new Map(input.staff.map((s, i) => [s.id, i]));
    return [...byStart.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([st, set]) => ({
            start: new Date(st).toISOString(),
            end: new Date(st + duration).toISOString(),
            staff: [...set].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
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
