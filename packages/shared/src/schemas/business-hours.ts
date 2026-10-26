import { colombianHolidays } from '../formula/dates';
import type { SlaStatusValue, SlaTargetKind } from './helpdesk';
import { addDaysYmd, resolveTimeZone, zonedDayAndMinute, zonedInstant } from './timezone';

/**
 * E5 — Horas HÁBILES de la empresa y el reloj del SLA. PURO: el servidor
 * (motor del SLA) y la interfaz usan estas mismas funciones, así lo que dice
 * la ficha coincide con lo que dispara los avisos.
 *
 * Un calendario es: los días laborables, el horario (de `start` a `end`, en
 * la ZONA de la empresa — ADR-S33) y si se saltan los festivos de Colombia
 * (calculados, los mismos de las fórmulas). Las PAUSAS son intervalos en que
 * el reloj no corre («Esperando al cliente»); una pausa abierta (`to: null`)
 * detiene el reloj hasta que se cierre.
 */

export interface BusinessCalendar {
    timeZone: string;
    /** 0 = domingo … 6 = sábado. */
    days: readonly number[];
    /** `HH:MM` (24 h). */
    start: string;
    /** `HH:MM`; `24:00` = hasta la medianoche. */
    end: string;
    holidays: 'co' | 'none';
}

export interface PauseInterval {
    /** Instante ISO. */
    from: string;
    /** Instante ISO; null = la pausa sigue abierta. */
    to: string | null;
}

/** Tope de días de calendario que se recorren (un objetivo de horas no debería ir más lejos). */
const MAX_DAYS = 3 * 366;
const MIN_MS = 60_000;

function minutesOf(hhmm: string): number {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return 0;
    return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}

/** El tramo hábil (ms) de un día del calendario, o null si no es día laborable. */
export function businessWindowOfDay(ymd: string, cal: BusinessCalendar): [number, number] | null {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    const dayMs = Date.UTC(y, m - 1, d);
    const dow = new Date(dayMs).getUTCDay();
    if (!cal.days.includes(dow)) return null;
    if (cal.holidays === 'co' && colombianHolidays(y).has(dayMs)) return null;
    const s = minutesOf(cal.start);
    const e = minutesOf(cal.end);
    if (e <= s) return null;
    const tz = resolveTimeZone(cal.timeZone);
    const from = zonedInstant(ymd, tz, { h: Math.floor(s / 60), m: s % 60 }).getTime();
    const to = zonedInstant(ymd, tz, { h: Math.floor(e / 60), m: e % 60 }).getTime();
    return to > from ? [from, to] : null;
}

/** Pausas ordenadas y unidas, en ms; una abierta llega hasta el infinito. */
function normalizePauses(pauses: readonly PauseInterval[] | undefined): Array<[number, number]> {
    const list = (pauses ?? [])
        .map((p): [number, number] => [Date.parse(p.from), p.to === null ? Number.POSITIVE_INFINITY : Date.parse(p.to)])
        .filter(([a, b]) => Number.isFinite(a) && !Number.isNaN(b) && b > a)
        .sort((x, y) => x[0] - y[0]);
    const out: Array<[number, number]> = [];
    for (const [a, b] of list) {
        const last = out[out.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out;
}

/** Un tramo menos las pausas. */
function minusPauses(seg: [number, number], pauses: Array<[number, number]>): Array<[number, number]> {
    let parts: Array<[number, number]> = [seg];
    for (const [pa, pb] of pauses) {
        if (pb <= seg[0] || pa >= seg[1]) continue;
        const next: Array<[number, number]> = [];
        for (const [a, b] of parts) {
            if (pb <= a || pa >= b) {
                next.push([a, b]);
                continue;
            }
            if (pa > a) next.push([a, pa]);
            if (pb < b) next.push([pb, b]);
        }
        parts = next;
    }
    return parts;
}

/**
 * Minutos HÁBILES (con decimales) entre dos instantes, sin contar las pausas.
 * `from > to` da 0.
 */
export function businessMinutesBetween(fromMs: number, toMs: number, cal: BusinessCalendar, pauses?: readonly PauseInterval[]): number {
    if (!(toMs > fromMs) || cal.days.length === 0) return 0;
    const tz = resolveTimeZone(cal.timeZone);
    const ps = normalizePauses(pauses);
    let ymd = zonedDayAndMinute(new Date(fromMs), tz).ymd;
    const lastYmd = zonedDayAndMinute(new Date(toMs), tz).ymd;
    let total = 0;
    for (let i = 0; i <= MAX_DAYS * 4; i++) {
        const w = businessWindowOfDay(ymd, cal);
        if (w) {
            const a = Math.max(w[0], fromMs);
            const b = Math.min(w[1], toMs);
            if (b > a) for (const [x, y] of minusPauses([a, b], ps)) total += y - x;
        }
        if (ymd >= lastYmd) break;
        ymd = addDaysYmd(ymd, 1);
    }
    return total / MIN_MS;
}

/**
 * El instante en que se cumplen `minutes` minutos HÁBILES contados desde
 * `startMs`, salteando las pausas. null si no se llega nunca (una pausa
 * abierta detiene el reloj, o el calendario no tiene días laborables).
 */
export function addBusinessMinutes(startMs: number, minutes: number, cal: BusinessCalendar, pauses?: readonly PauseInterval[]): number | null {
    if (cal.days.length === 0 || !Number.isFinite(startMs)) return null;
    const ps = normalizePauses(pauses);
    const open = ps.find(([, b]) => b === Number.POSITIVE_INFINITY);
    // Un objetivo de 0 minutos vence apenas empieza el primer tramo hábil.
    let left = Math.max(0, minutes) * MIN_MS;
    const tz = resolveTimeZone(cal.timeZone);
    let ymd = zonedDayAndMinute(new Date(startMs), tz).ymd;
    for (let i = 0; i < MAX_DAYS; i++) {
        const w = businessWindowOfDay(ymd, cal);
        if (w && w[1] > startMs) {
            const seg: [number, number] = [Math.max(w[0], startMs), w[1]];
            for (const [a, b] of minusPauses(seg, ps)) {
                if (left <= b - a) return a + left;
                left -= b - a;
            }
        }
        if (open && w && w[0] >= open[0]) return null;
        ymd = addDaysYmd(ymd, 1);
    }
    return null;
}

// ─────────────────────────── El reloj del SLA ───────────────────────────

export interface SlaClockInput {
    /** Cuándo empezó el ticket (llegó el correo / se creó). */
    started_at: string;
    first_response_minutes: number | null;
    resolution_minutes: number | null;
    first_response_at: string | null;
    resolved_at: string | null;
    pauses: readonly PauseInterval[];
    calendar: BusinessCalendar;
    at_risk_percent: number;
}

export type SlaTargetState = 'none' | 'on_track' | 'at_risk' | 'breached' | 'met' | 'paused';

export interface SlaTargetResult {
    kind: SlaTargetKind;
    state: SlaTargetState;
    target_minutes: number | null;
    /** Instante ISO del vencimiento (null si no hay objetivo o el reloj está detenido). */
    due: string | null;
    /** Cuándo pasa a «en riesgo». */
    risk_at: string | null;
    /** Cuándo se cumplió (primera respuesta / resolución). */
    done_at: string | null;
    /** Minutos hábiles consumidos hasta ahora (o hasta que se cumplió). */
    elapsed_minutes: number;
}

export interface SlaClockResult {
    first_response: SlaTargetResult;
    resolution: SlaTargetResult;
    /** El estado del ticket (lo peor de los dos objetivos); null = sin objetivos. */
    status: SlaStatusValue | null;
    /** El reloj está detenido por una pausa abierta. */
    paused: boolean;
    /** Próximo instante en que el estado puede cambiar solo (para el planificador). */
    next_check_at: string | null;
}

const iso = (ms: number | null): string | null => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

function evalTarget(
    kind: SlaTargetKind,
    target: number | null,
    doneAt: string | null,
    input: SlaClockInput,
    nowMs: number,
): SlaTargetResult {
    const start = Date.parse(input.started_at);
    const base: SlaTargetResult = { kind, state: 'none', target_minutes: target, due: null, risk_at: null, done_at: doneAt, elapsed_minutes: 0 };
    if (target === null || !Number.isFinite(start)) return base;
    const doneMs = doneAt !== null ? Date.parse(doneAt) : null;
    const until = doneMs !== null && Number.isFinite(doneMs) ? doneMs : nowMs;
    const elapsed = businessMinutesBetween(start, until, input.calendar, input.pauses);
    const due = addBusinessMinutes(start, target, input.calendar, input.pauses);
    const pct = Math.min(99, Math.max(1, input.at_risk_percent)) / 100;
    const riskAt = addBusinessMinutes(start, target * pct, input.calendar, input.pauses);
    const out: SlaTargetResult = { ...base, due: iso(due), risk_at: iso(riskAt), elapsed_minutes: Math.round(elapsed * 100) / 100 };
    if (doneMs !== null && Number.isFinite(doneMs)) {
        // Cumplido: a tiempo si llegó antes del vencimiento (con las pausas ya cerradas).
        out.state = elapsed <= target + 1e-9 ? 'met' : 'breached';
        return out;
    }
    if (due === null) {
        // El reloj está detenido (pausa abierta): vencido si ya se había pasado.
        out.state = target > 0 && elapsed >= target - 1e-9 ? 'breached' : 'paused';
        out.risk_at = null;
        return out;
    }
    if (nowMs >= due) out.state = 'breached';
    else if (riskAt !== null && nowMs >= riskAt) out.state = 'at_risk';
    else out.state = 'on_track';
    return out;
}

/**
 * El estado del SLA de un ticket en `now`. La primera respuesta se da por
 * cumplida al resolverse (un ticket cerrado sin responder no queda «en
 * riesgo» para siempre). El estado del ticket es lo peor de los dos:
 * vencido > en riesgo > pausado > a tiempo; cumplido sólo si todo lo que
 * tenía objetivo se cumplió a tiempo.
 */
export function computeSlaClock(input: SlaClockInput, now: Date = new Date()): SlaClockResult {
    const nowMs = now.getTime();
    const first = evalTarget('first_response', input.first_response_minutes, input.first_response_at ?? input.resolved_at, input, nowMs);
    const resolution = evalTarget('resolution', input.resolution_minutes, input.resolved_at, input, nowMs);
    const active = [first, resolution].filter((t) => t.state !== 'none');
    const paused = (input.pauses ?? []).some((p) => p.to === null) && input.resolved_at === null;
    let status: SlaStatusValue | null = null;
    if (active.length > 0) {
        if (active.some((t) => t.state === 'breached')) status = 'vencido';
        else if (active.some((t) => t.state === 'at_risk')) status = 'en_riesgo';
        else if (active.every((t) => t.state === 'met')) status = 'cumplido';
        else if (paused || active.some((t) => t.state === 'paused')) status = 'pausado';
        else status = 'a_tiempo';
    }
    // Próximo cambio: el umbral de riesgo o el vencimiento más cercano de lo que sigue abierto.
    let next: number | null = null;
    for (const t of active) {
        if (t.state !== 'on_track' && t.state !== 'at_risk') continue;
        for (const at of [t.risk_at, t.due]) {
            const ms = at ? Date.parse(at) : NaN;
            if (Number.isFinite(ms) && ms > nowMs && (next === null || ms < next)) next = ms;
        }
    }
    return { first_response: first, resolution, status, paused, next_check_at: iso(next) };
}

/** El calendario de una política con la zona de la empresa. */
export function businessCalendarOf(cfg: { days: readonly number[]; start: string; end: string; holidays: 'co' | 'none' }, timeZone: string): BusinessCalendar {
    return { timeZone, days: cfg.days, start: cfg.start, end: cfg.end, holidays: cfg.holidays };
}
