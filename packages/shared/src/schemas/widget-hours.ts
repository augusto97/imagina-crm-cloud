import { addDaysYmd, zonedDayAndMinute, zonedInstant } from './timezone';

/**
 * v0.1.395 (ADR-S99) — Horario de atención del widget de contacto. PURO y
 * sin Zod: lo importa por ruta la página pública del widget (que se compila
 * a un archivo chico servido en línea) y también el servidor y el editor.
 *
 * El servidor arma el horario una vez (la caché pública lo guarda 30 s) con
 * los festivos de los próximos días ya resueltos; quien decide si «ahora»
 * está abierto es la página, con su reloj: así la caché no se invalida cada
 * minuto y el estado cambia solo cuando llega la hora.
 */

/** Lo público del horario (va en la meta del widget). */
export interface PublicWidgetHours {
    /** La zona en que se escribió el horario (la de la empresa o una propia). */
    tz: string;
    /** 7 días (0 = domingo); cada uno con sus tramos en minutos desde la medianoche `[desde, hasta)`. */
    week: Array<Array<[number, number]>>;
    /** Días cerrados de los próximos días (festivos): `YYYY-MM-DD` en `tz`. */
    closed_dates: string[];
    /** Mostrar «En línea» / «Fuera de horario» en el panel. */
    show_status: boolean;
    online_label: string;
    closed_message: string;
    /** Cómo se escriben las horas: «2:30 p. m.» o «14:30». */
    time_format: 'h12' | 'h24';
}

/** Los días que recorre la búsqueda de la próxima apertura (lo que trae el servidor). */
export const WIDGET_HOURS_LOOKAHEAD_DAYS = 21;

function dowOf(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ¿Está abierto en este instante? */
export function widgetIsOpen(h: PublicWidgetHours, now: Date = new Date()): boolean {
    const { ymd, minute } = zonedDayAndMinute(now, h.tz);
    if (h.closed_dates.includes(ymd)) return false;
    return (h.week[dowOf(ymd)] ?? []).some(([a, b]) => minute >= a && minute < b);
}

/**
 * Cuándo abre la próxima vez (estando cerrado): el inicio del próximo tramo
 * en los próximos días, salteando los cerrados. null = no abre en lo que se
 * conoce (un horario sin días, o todo cerrado por festivos).
 */
export function widgetNextOpening(h: PublicWidgetHours, now: Date = new Date()): Date | null {
    const { ymd: today, minute } = zonedDayAndMinute(now, h.tz);
    for (let i = 0; i <= WIDGET_HOURS_LOOKAHEAD_DAYS; i++) {
        const ymd = addDaysYmd(today, i);
        if (h.closed_dates.includes(ymd)) continue;
        const starts = (h.week[dowOf(ymd)] ?? []).map(([a]) => a).sort((x, y) => x - y);
        for (const a of starts) {
            if (i === 0 && a <= minute) continue;
            return zonedInstant(ymd, h.tz, { h: Math.floor(a / 60), m: a % 60 });
        }
    }
    return null;
}

/** Cuándo cierra (estando abierto): el fin del tramo en curso. */
export function widgetClosesAt(h: PublicWidgetHours, now: Date = new Date()): Date | null {
    const { ymd, minute } = zonedDayAndMinute(now, h.tz);
    if (h.closed_dates.includes(ymd)) return null;
    const seg = (h.week[dowOf(ymd)] ?? []).find(([a, b]) => minute >= a && minute < b);
    if (!seg) return null;
    const end = seg[1];
    return end >= 24 * 60 ? zonedInstant(addDaysYmd(ymd, 1), h.tz) : zonedInstant(ymd, h.tz, { h: Math.floor(end / 60), m: end % 60 });
}

const WEEKDAYS = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado'];

/**
 * «hoy», «mañana» o «el lunes» para un día, mirado desde `today` (los dos
 * `YYYY-MM-DD` en la zona de quien lee). Más de una semana: la fecha.
 */
export function widgetDayWord(ymd: string, today: string): string {
    if (ymd === today) return 'hoy';
    if (ymd === addDaysYmd(today, 1)) return 'mañana';
    for (let i = 2; i < 7; i++) if (ymd === addDaysYmd(today, i)) return WEEKDAYS[dowOf(ymd)]!;
    const [, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return `el ${d}/${m}`;
}

/** «8:00 a. m.» o «08:00» (horas y minutos de un minuto del día). */
export function widgetClock(minuteOfDay: number, format: 'h12' | 'h24'): string {
    const h = Math.floor(minuteOfDay / 60) % 24;
    const m = minuteOfDay % 60;
    const mm = String(m).padStart(2, '0');
    if (format === 'h24') return `${String(h).padStart(2, '0')}:${mm}`;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/**
 * «Abrimos mañana a las 8:00 a. m.» en el reloj de QUIEN LEE (`viewerTz`, la
 * zona de su navegador): una persona de otro país lee la hora de su país.
 * null = no se sabe cuándo abre.
 */
export function widgetNextOpeningText(h: PublicWidgetHours, now: Date, viewerTz: string): string | null {
    const next = widgetNextOpening(h, now);
    if (!next) return null;
    const at = zonedDayAndMinute(next, viewerTz);
    const today = zonedDayAndMinute(now, viewerTz).ymd;
    const word = widgetDayWord(at.ymd, today);
    return `Abrimos ${word} a las ${widgetClock(at.minute, h.time_format)}`.replace('a las 1:', 'a la 1:');
}

/** ¿Se muestra este botón ahora? (`when` del botón contra el horario). */
export function widgetButtonShown(when: 'always' | 'open' | 'closed' | undefined, open: boolean | null): boolean {
    if (open === null || !when || when === 'always') return true;
    return when === 'open' ? open : !open;
}
