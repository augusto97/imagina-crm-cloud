/**
 * v0.1.263 — Zona horaria de la empresa.
 *
 * Una automatización «a las 8» o una fecha sin hora («vence el 7») sólo tienen
 * sentido en el reloj de quien las configura. Antes todo lo que no traía zona
 * corría en UTC: en Colombia (UTC−5) «las 8» salía a las 3 de la mañana y un
 * vencimiento «el 7» se cumplía el 6 a las 7 de la noche.
 *
 * Estas funciones son puras y usan `Intl` (Node y navegadores modernos), así
 * el servidor y la interfaz calculan "hoy" exactamente igual.
 */

/** Zona por defecto cuando la empresa todavía no eligió una. */
export const FALLBACK_TIME_ZONE = 'UTC';

const validCache = new Map<string, boolean>();

/** ¿Es una zona IANA que el runtime reconoce? (`America/Bogota`, `UTC`…) */
export function isValidTimeZone(tz: unknown): tz is string {
    if (typeof tz !== 'string') return false;
    const v = tz.trim();
    if (v === '' || v.length > 64) return false;
    const cached = validCache.get(v);
    if (cached !== undefined) return cached;
    let ok = false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: v });
        ok = true;
    } catch {
        ok = false;
    }
    validCache.set(v, ok);
    return ok;
}

/** La zona si es válida; si no, la de respaldo (UTC). */
export function resolveTimeZone(...candidates: unknown[]): string {
    for (const c of candidates) if (isValidTimeZone(c)) return c.trim();
    return FALLBACK_TIME_ZONE;
}

interface ZonedParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(at: Date, tz: string): ZonedParts {
    let f = partsFormatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        partsFormatters.set(tz, f);
    }
    const parts = f.formatToParts(at);
    const pick = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return {
        year: pick('year'),
        month: pick('month'),
        day: pick('day'),
        hour: pick('hour') % 24,
        minute: pick('minute'),
        second: pick('second'),
    };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "Hoy" (YYYY-MM-DD) en el reloj de `tz`. */
export function zonedToday(tz: string, now: Date = new Date()): string {
    const p = zonedParts(now, resolveTimeZone(tz));
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** "Ahora" como fecha-hora local sin zona (YYYY-MM-DD HH:MM:SS) en `tz`. */
export function zonedNowNaive(tz: string, now: Date = new Date()): string {
    const p = zonedParts(now, resolveTimeZone(tz));
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Diferencia (ms) entre el reloj de `tz` y UTC en el instante `at`. */
function offsetMs(at: Date, tz: string): number {
    const p = zonedParts(at, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * El instante en que el reloj de `tz` marca `ymd` a la hora indicada
 * (por defecto 00:00:00). Resuelve bien los días con cambio de horario.
 */
export function zonedInstant(ymd: string, tz: string, time: { h?: number; m?: number; s?: number; ms?: number } = {}): Date {
    const zone = resolveTimeZone(tz);
    const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
    const guess = Date.UTC(y, mo - 1, d, time.h ?? 0, time.m ?? 0, time.s ?? 0, time.ms ?? 0);
    // Dos pasadas: el offset del instante adivinado puede diferir del real
    // cuando el cambio de horario cae justo en medio.
    let t = guess - offsetMs(new Date(guess), zone);
    t = guess - offsetMs(new Date(t), zone);
    return new Date(t);
}

/** Suma días a un YYYY-MM-DD (calendario puro, sin zona). */
export function addDaysYmd(ymd: string, days: number): string {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
}

/**
 * Zonas sugeridas arriba del selector (las de los clientes de la app). El
 * resto sale de `Intl.supportedValuesOf('timeZone')` en el navegador.
 */
export const COMMON_TIME_ZONES: ReadonlyArray<{ tz: string; label: string }> = [
    { tz: 'America/Bogota', label: 'Colombia (Bogotá)' },
    { tz: 'America/Mexico_City', label: 'México (Ciudad de México)' },
    { tz: 'America/Lima', label: 'Perú (Lima)' },
    { tz: 'America/Guayaquil', label: 'Ecuador (Guayaquil)' },
    { tz: 'America/Panama', label: 'Panamá' },
    { tz: 'America/Caracas', label: 'Venezuela (Caracas)' },
    { tz: 'America/Santiago', label: 'Chile (Santiago)' },
    { tz: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
    { tz: 'America/Montevideo', label: 'Uruguay (Montevideo)' },
    { tz: 'America/Asuncion', label: 'Paraguay (Asunción)' },
    { tz: 'America/La_Paz', label: 'Bolivia (La Paz)' },
    { tz: 'America/Sao_Paulo', label: 'Brasil (São Paulo)' },
    { tz: 'America/Guatemala', label: 'Guatemala' },
    { tz: 'America/Costa_Rica', label: 'Costa Rica' },
    { tz: 'America/El_Salvador', label: 'El Salvador' },
    { tz: 'America/Tegucigalpa', label: 'Honduras (Tegucigalpa)' },
    { tz: 'America/Managua', label: 'Nicaragua (Managua)' },
    { tz: 'America/Santo_Domingo', label: 'República Dominicana' },
    { tz: 'America/Puerto_Rico', label: 'Puerto Rico' },
    { tz: 'America/New_York', label: 'EE. UU. — Este (Nueva York)' },
    { tz: 'America/Chicago', label: 'EE. UU. — Centro (Chicago)' },
    { tz: 'America/Denver', label: 'EE. UU. — Montaña (Denver)' },
    { tz: 'America/Los_Angeles', label: 'EE. UU. — Pacífico (Los Ángeles)' },
    { tz: 'Europe/Madrid', label: 'España (Madrid)' },
    { tz: 'UTC', label: 'UTC (tiempo universal)' },
];

/** Etiqueta legible de una zona: la del catálogo o el id IANA. */
export function timeZoneLabel(tz: string): string {
    return COMMON_TIME_ZONES.find((z) => z.tz === tz)?.label ?? tz.replace(/_/g, ' ');
}
