import { holidayBlocksByDefault, holidayCountry, holidayCountryForTimeZone, type HolidayItem } from './holidays';
import { addDaysYmd, resolveTimeZone, zonedDayAndMinute, zonedInstant } from './timezone';
import { widgetDayWord } from './widget-hours';

/**
 * v0.1.467 (E8) — El HORARIO LABORAL de la empresa: qué días y horas trabaja
 * (uno o varios tramos por día: la hora del almuerzo, el sábado hasta el
 * mediodía) y qué festivos cierra. Vive en `tenants.settings.business_hours`
 * y se lee en la ZONA de la empresa (ADR-S33).
 *
 * PURO y sin Zod (el esquema de entrada está en `company-hours-input.ts`): el
 * motor de automatizaciones («Esperar hasta el horario laboral»), la vista
 * previa de Ajustes, el editor de la espera y «Probar» usan estas mismas
 * funciones, así lo que dice la pantalla es lo que después hace el motor.
 *
 * Los festivos llegan YA RESUELTOS como un conjunto de fechas `YYYY-MM-DD`
 * (`closedDates`): el servidor los consigue con el servicio de festivos por
 * país (el de la agenda) y los pasa con `companyClosedDates`.
 */

export interface CompanyHoursInterval {
    /** `HH:MM` (24 h). */
    start: string;
    /** `HH:MM`; `24:00` = hasta la medianoche. */
    end: string;
}

export interface CompanyHours {
    /** 7 días, índice = día de la semana de JS (0 = domingo … 6 = sábado). */
    week: CompanyHoursInterval[][];
    /** País de los festivos que la empresa NO trabaja (null = trabaja los festivos). */
    holiday_country: string | null;
    /** ¿Los festivos regionales también cierran? (de fábrica, no: sólo los nacionales). */
    regional_holidays: boolean;
}

/** Tramos por día como mucho (igual que la agenda y el widget). */
export const COMPANY_HOURS_MAX_INTERVALS = 6;

/** Hasta dónde se busca la próxima apertura (un poco más que la espera más larga). */
export const COMPANY_HOURS_LOOKAHEAD_DAYS = 400;

const HHMM_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function hhmmMinutesOf(v: string): number {
    const [h, m] = v.split(':').map(Number) as [number, number];
    return h * 60 + m;
}

/**
 * De fábrica: lunes a viernes de 8:00 a 17:00 y los festivos del país de la
 * zona de la empresa (Colombia si la zona no dice o todavía no hay zona).
 */
export function defaultCompanyHours(timeZone?: string | null): CompanyHours {
    const day = (): CompanyHoursInterval[] => [{ start: '08:00', end: '17:00' }];
    return {
        week: [[], day(), day(), day(), day(), day(), []],
        holiday_country: holidayCountryForTimeZone(timeZone) ?? 'CO',
        regional_holidays: false,
    };
}

/** Los tramos válidos de un día: formato, fin después del inicio, ordenados y sin pisarse. */
export function cleanCompanyDay(raw: unknown): CompanyHoursInterval[] {
    if (!Array.isArray(raw)) return [];
    const list = raw
        .filter((i): i is CompanyHoursInterval => !!i && typeof i === 'object' && HHMM_RE.test(String((i as CompanyHoursInterval).start)) && HHMM_RE.test(String((i as CompanyHoursInterval).end)))
        .map((i) => ({ start: String(i.start), end: String(i.end) }))
        .filter((i) => hhmmMinutesOf(i.end) > hhmmMinutesOf(i.start))
        .sort((a, b) => hhmmMinutesOf(a.start) - hhmmMinutesOf(b.start));
    const out: CompanyHoursInterval[] = [];
    for (const i of list) {
        const last = out[out.length - 1];
        if (last && hhmmMinutesOf(i.start) < hhmmMinutesOf(last.end)) continue;
        out.push(i);
        if (out.length >= COMPANY_HOURS_MAX_INTERVALS) break;
    }
    return out;
}

/**
 * Lee `tenants.settings.business_hours` con TOLERANCIA: lo que falta o está
 * roto toma el valor de fábrica (una semana sin ningún tramo también: un
 * horario que nunca abre trabaría las esperas). `configured` dice si la
 * empresa lo guardó alguna vez.
 */
export function readCompanyHours(raw: unknown, timeZone?: string | null): { hours: CompanyHours; configured: boolean } {
    const base = defaultCompanyHours(timeZone);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { hours: base, configured: false };
    const r = raw as Record<string, unknown>;
    let week = base.week;
    if (Array.isArray(r.week) && r.week.length === 7) {
        const cleaned = r.week.map(cleanCompanyDay);
        if (cleaned.some((d) => d.length > 0)) week = cleaned;
    }
    let country: string | null = base.holiday_country;
    if (r.holiday_country === null) country = null;
    else if (typeof r.holiday_country === 'string') country = holidayCountry(r.holiday_country)?.code ?? base.holiday_country;
    return {
        hours: { week, holiday_country: country, regional_holidays: r.regional_holidays === true },
        configured: true,
    };
}

/**
 * Las fechas en que la empresa no trabaja por festivo: los nacionales (y los
 * de medio día) siempre; los regionales sólo si se marcó. Sin país, ninguna.
 */
export function companyClosedDates(items: readonly HolidayItem[] | null | undefined, hours: Pick<CompanyHours, 'holiday_country' | 'regional_holidays'>): Set<string> {
    const out = new Set<string>();
    if (hours.holiday_country === null || !items) return out;
    for (const h of items) if (holidayBlocksByDefault(h.kind) || hours.regional_holidays) out.add(h.date);
    return out;
}

// ─────────────────────────── El calendario ───────────────────────────

/** El horario ya armado para calcular: zona, tramos en minutos y días cerrados. */
export interface CompanyCalendar {
    timeZone: string;
    /** 7 días (0 = domingo): tramos `[desde, hasta)` en minutos desde la medianoche. */
    week: Array<Array<[number, number]>>;
    /** Días que no se trabaja (festivos): `YYYY-MM-DD` en `timeZone`. */
    closedDates: ReadonlySet<string>;
}

export function companyCalendar(hours: CompanyHours, timeZone: string | null | undefined, closedDates: ReadonlySet<string> = new Set()): CompanyCalendar {
    return {
        timeZone: resolveTimeZone(timeZone),
        week: hours.week.map((d) => cleanCompanyDay(d).map((i): [number, number] => [hhmmMinutesOf(i.start), hhmmMinutesOf(i.end)])),
        closedDates,
    };
}

function dowOf(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Los tramos de un día del calendario (vacío si no se trabaja: fin de semana o festivo). */
export function companySegmentsOf(cal: CompanyCalendar, ymd: string): Array<[number, number]> {
    if (cal.closedDates.has(ymd)) return [];
    return cal.week[dowOf(ymd)] ?? [];
}

function instantAt(cal: CompanyCalendar, ymd: string, minute: number): Date {
    if (minute >= 24 * 60) return zonedInstant(addDaysYmd(ymd, 1), cal.timeZone);
    return zonedInstant(ymd, cal.timeZone, { h: Math.floor(minute / 60), m: minute % 60 });
}

/** ¿Es horario laboral en este instante? */
export function isCompanyOpen(cal: CompanyCalendar, now: Date = new Date()): boolean {
    const { ymd, minute } = zonedDayAndMinute(now, cal.timeZone);
    return companySegmentsOf(cal, ymd).some(([a, b]) => minute >= a && minute < b);
}

/** ¿Hoy (en la zona de la empresa) es día laborable? (tiene horario y no es festivo). */
export function isCompanyWorkday(cal: CompanyCalendar, now: Date = new Date()): boolean {
    const { ymd } = zonedDayAndMinute(now, cal.timeZone);
    return companySegmentsOf(cal, ymd).length > 0;
}

/**
 * Cuándo cierra (estando abierto): el fin del tramo en curso, juntando los
 * tramos pegados (8-12 y 12-17 es un solo tramo; un día hasta las 24:00 y el
 * siguiente desde las 0:00, también). null = no está abierto, o no cierra en
 * toda la semana.
 */
export function companyClosesAt(cal: CompanyCalendar, now: Date = new Date()): Date | null {
    const { ymd, minute } = zonedDayAndMinute(now, cal.timeZone);
    const seg = companySegmentsOf(cal, ymd).find(([a, b]) => minute >= a && minute < b);
    if (!seg) return null;
    let day = ymd;
    let end = seg[1];
    for (let i = 0; i < 8; i++) {
        const segs = companySegmentsOf(cal, day);
        const next = segs.find(([a]) => a === end);
        if (next) {
            end = next[1];
            continue;
        }
        if (end >= 24 * 60) {
            const tomorrow = addDaysYmd(day, 1);
            const first = companySegmentsOf(cal, tomorrow)[0];
            if (first && first[0] === 0) {
                day = tomorrow;
                end = first[1];
                continue;
            }
        }
        return instantAt(cal, day, end);
    }
    return null;
}

/**
 * La próxima vez que ABRE: el inicio del próximo tramo después de un rato
 * cerrado. Estando abierto, la apertura que sigue al cierre en curso. null =
 * no abre en los próximos 400 días (un horario sin días, o todo festivos).
 */
export function nextCompanyOpening(cal: CompanyCalendar, now: Date = new Date()): Date | null {
    let from = now;
    if (isCompanyOpen(cal, now)) {
        const closes = companyClosesAt(cal, now);
        if (!closes) return null;
        from = closes;
    }
    const { ymd: today } = zonedDayAndMinute(from, cal.timeZone);
    for (let i = 0; i <= COMPANY_HOURS_LOOKAHEAD_DAYS; i++) {
        const ymd = addDaysYmd(today, i);
        for (const [a] of companySegmentsOf(cal, ymd)) {
            const at = instantAt(cal, ymd, a);
            if (at.getTime() > from.getTime()) return at;
        }
    }
    return null;
}

/**
 * El comienzo del PRÓXIMO día laborable (después de hoy, en la zona de la
 * empresa): la hora en que abre ese día o, con `atTime`, esa hora.
 */
export function nextCompanyWorkdayStart(cal: CompanyCalendar, now: Date = new Date(), atTime?: { h: number; m: number } | null): Date | null {
    const { ymd: today } = zonedDayAndMinute(now, cal.timeZone);
    for (let i = 1; i <= COMPANY_HOURS_LOOKAHEAD_DAYS; i++) {
        const ymd = addDaysYmd(today, i);
        const first = companySegmentsOf(cal, ymd)[0];
        if (!first) continue;
        return atTime ? zonedInstant(ymd, cal.timeZone, atTime) : instantAt(cal, ymd, first[0]);
    }
    return null;
}

/** Los dos modos de «Esperar» que dependen del horario laboral. */
export type CompanyWaitMode = 'business_day' | 'business_hours';

/**
 * Cuándo sigue una espera que depende del horario laboral:
 *  - `business_hours`: si es horario laboral, ahora; si no, la próxima apertura.
 *  - `business_day`: si hoy es día laborable, ahora; si no, el comienzo del
 *    próximo (a la hora de apertura o a `atTime`).
 * `immediate` = sigue en el acto (la corrida no se pausa). null = nunca abre.
 */
export function companyWaitTarget(
    cal: CompanyCalendar,
    mode: CompanyWaitMode,
    now: Date = new Date(),
    atTime?: { h: number; m: number } | null,
): { at: Date; immediate: boolean } | null {
    if (mode === 'business_hours') {
        if (isCompanyOpen(cal, now)) return { at: now, immediate: true };
        const at = nextCompanyOpening(cal, now);
        return at ? { at, immediate: false } : null;
    }
    if (isCompanyWorkday(cal, now)) return { at: now, immediate: true };
    const at = nextCompanyWorkdayStart(cal, now, atTime);
    return at ? { at, immediate: false } : null;
}

// ─────────────────────────── En palabras ───────────────────────────

/** «8:00» / «17:30» (24 h, sin cero adelante) o «8:00 a. m.» (12 h). */
export function companyClock(minuteOfDay: number, format: 'h12' | 'h24' = 'h24'): string {
    // La medianoche como FIN de un tramo («hasta las 24:00»).
    if (minuteOfDay >= 24 * 60 && format === 'h24') return '24:00';
    const h = Math.floor(minuteOfDay / 60) % 24;
    const mm = String(minuteOfDay % 60).padStart(2, '0');
    if (format === 'h24') return `${h}:${mm}`;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

function atClock(minute: number, format: 'h12' | 'h24'): string {
    const t = companyClock(minute, format);
    // «a la 1:00», no «a las 1:00».
    return t.startsWith('1:') ? `a la ${t}` : `a las ${t}`;
}

/**
 * El estado de ahora en una frase: «Ahora: abierto, cierra a las 17:00» /
 * «Ahora: cerrado, abre el lunes a las 8:00». Las horas son las de la zona de
 * la empresa.
 */
export function describeCompanyStatus(cal: CompanyCalendar, now: Date = new Date(), format: 'h12' | 'h24' = 'h24'): { open: boolean; text: string } {
    const today = zonedDayAndMinute(now, cal.timeZone).ymd;
    const when = (at: Date): string => {
        const z = zonedDayAndMinute(at, cal.timeZone);
        const word = widgetDayWord(z.ymd, today);
        return word === 'hoy' ? atClock(z.minute, format) : `${word} ${atClock(z.minute, format)}`;
    };
    if (isCompanyOpen(cal, now)) {
        const closes = companyClosesAt(cal, now);
        return { open: true, text: closes ? `Ahora: abierto, cierra ${when(closes)}` : 'Ahora: abierto (no cierra)' };
    }
    const next = nextCompanyOpening(cal, now);
    return { open: false, text: next ? `Ahora: cerrado, abre ${when(next)}` : 'Ahora: cerrado (no hay días laborables)' };
}

const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
/** Lunes primero, como se lee una semana de trabajo. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function dayText(day: CompanyHoursInterval[], format: 'h12' | 'h24'): string {
    const parts = day.map((i) => `${companyClock(hhmmMinutesOf(i.start), format)}–${companyClock(hhmmMinutesOf(i.end), format)}`);
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/**
 * La semana en una línea: «Lun a vie 8:00–17:00 · Sáb 8:00–12:00». Los días
 * seguidos con el mismo horario se juntan.
 */
export function describeCompanyWeek(hours: Pick<CompanyHours, 'week'>, format: 'h12' | 'h24' = 'h24'): string {
    const groups: Array<{ from: number; to: number; text: string }> = [];
    for (const dow of WEEK_ORDER) {
        const day = cleanCompanyDay(hours.week[dow]);
        if (day.length === 0) continue;
        const text = dayText(day, format);
        const last = groups[groups.length - 1];
        const prevDow = last ? last.to : -1;
        const consecutive = last && WEEK_ORDER.indexOf(dow) === WEEK_ORDER.indexOf(prevDow) + 1;
        if (last && consecutive && last.text === text) last.to = dow;
        else groups.push({ from: dow, to: dow, text });
    }
    if (groups.length === 0) return 'Sin días laborables';
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return groups
        .map((g) => {
            const span = WEEK_ORDER.indexOf(g.to) - WEEK_ORDER.indexOf(g.from);
            const days = g.from === g.to ? SHORT_DAYS[g.from]! : `${SHORT_DAYS[g.from]} ${span === 1 ? 'y' : 'a'} ${SHORT_DAYS[g.to]}`;
            return `${cap(days)} ${g.text}`;
        })
        .join(' · ');
}

/** Los festivos en palabras: «Cierra los festivos de Colombia» / «Trabaja los festivos». */
export function describeCompanyHolidays(hours: Pick<CompanyHours, 'holiday_country' | 'regional_holidays'>): string {
    const c = hours.holiday_country ? holidayCountry(hours.holiday_country) : null;
    if (!c) return 'Trabaja los festivos';
    return hours.regional_holidays ? `Cierra los festivos de ${c.name} (también los regionales)` : `Cierra los festivos de ${c.name}`;
}

/** Todo el horario en una línea (la del editor de la espera). */
export function describeCompanyHours(hours: CompanyHours, format: 'h12' | 'h24' = 'h24'): string {
    return `${describeCompanyWeek(hours, format)} · ${describeCompanyHolidays(hours)}`;
}
