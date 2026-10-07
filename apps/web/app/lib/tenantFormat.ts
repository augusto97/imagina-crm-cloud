import { FALLBACK_TIME_ZONE, zonedNowNaive } from '@imagina-base/shared';
import { parseUtcDate } from './utcDate';
/**
 * Formato regional por workspace (v0.1.104): separadores de número, orden
 * de fecha y reloj 12/24 h. La config vive en `tenants.settings.format`,
 * viaja dentro del branding (que todo miembro trae al bootear) y acá se
 * mantiene como estado de módulo: los helpers de formateo son funciones
 * puras llamadas en render (renderCellValue, agregados, widgets) donde no
 * hay hooks disponibles. `useBrandingData` la setea apenas llega.
 */

export type NumberFormatId = 'comma_dot' | 'dot_comma' | 'space_comma';
export type DateFormatId = 'ymd' | 'dmy' | 'mdy';
export type TimeFormatId = 'h24' | 'h12';

export interface TenantFormat {
    number_format: NumberFormatId;
    date_format: DateFormatId;
    time_format: TimeFormatId;
    /** v0.1.263 — zona horaria de la empresa (IANA) o null si no eligió. */
    timezone?: string | null;
}

/** Los defaults reproducen el comportamiento histórico de la app. */
export const DEFAULT_TENANT_FORMAT: TenantFormat = {
    number_format: 'comma_dot',
    date_format: 'ymd',
    time_format: 'h24',
};

let current: TenantFormat = DEFAULT_TENANT_FORMAT;

export function setTenantFormat(format: Partial<TenantFormat> | null | undefined): void {
    current = { ...DEFAULT_TENANT_FORMAT, ...(format ?? {}) };
}

export function getTenantFormat(): TenantFormat {
    return current;
}

/** v0.1.263 — la zona horaria de la empresa (null = todavía no eligió). */
export function getTenantTimeZone(): string | null {
    return current.timezone ?? null;
}

/** La zona del navegador de quien mira (null si el runtime no la sabe). */
export function browserTimeZone(): string | null {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return typeof tz === 'string' && tz !== '' ? tz : null;
    } catch {
        return null;
    }
}

/**
 * v0.1.253 — `toLocaleString` crea un `Intl.NumberFormat` NUEVO en cada
 * llamada; con 200 filas × varias columnas numéricas eran 30-120 ms por
 * render. Los formateadores se cachean por precisión (son pocas).
 */
const formatters = new Map<string, Intl.NumberFormat>();
function numberFormatter(minFrac: number, maxFrac: number): Intl.NumberFormat {
    const key = `${minFrac}:${maxFrac}`;
    let f = formatters.get(key);
    if (!f) {
        f = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: minFrac,
            maximumFractionDigits: Math.max(minFrac, maxFrac),
        });
        formatters.set(key, f);
    }
    return f;
}

/**
 * Número con los separadores del workspace. Se formatea SIEMPRE en base
 * en-US (miles «,» decimal «.») y se mapean los separadores — así el
 * resultado no depende del locale del navegador de cada miembro.
 */
export function formatNumber(
    num: number,
    opts: { minFrac?: number; maxFrac?: number } = {},
    format: TenantFormat = current,
): string {
    const base = numberFormatter(opts.minFrac ?? 0, opts.maxFrac ?? Math.max(opts.minFrac ?? 0, 3)).format(num);
    if (format.number_format === 'dot_comma') {
        return base.replace(/[.,]/g, (ch) => (ch === ',' ? '.' : ','));
    }
    if (format.number_format === 'space_comma') {
        // NBSP como separador de miles: no corta línea dentro del número.
        return base.replace(/[.,]/g, (ch) => (ch === ',' ? '\u00a0' : ','));
    }
    return base;
}

/**
 * Locale de Intl.NumberFormat con los MISMOS separadores del formato del
 * workspace — para los casos que necesitan Intl (p. ej. símbolo de moneda
 * con `style: 'currency'`) en vez del mapeo manual de `formatNumber`.
 */
export function numberFormatLocale(format: TenantFormat = current): string {
    if (format.number_format === 'dot_comma') return 'es-CO';
    if (format.number_format === 'space_comma') return 'fr-FR';
    return 'en-US';
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Fecha `YYYY-MM-DD` (el formato de almacenamiento de los campos date) en
 * el orden del workspace. Valores que no matchean se devuelven tal cual.
 */
export function formatDateStr(value: string, format: TenantFormat = current): string {
    const m = YMD_RE.exec(value.trim());
    if (!m) return value;
    const [, y, mo, d] = m;
    if (format.date_format === 'dmy') return `${d}/${mo}/${y}`;
    if (format.date_format === 'mdy') return `${mo}/${d}/${y}`;
    return `${y}-${mo}-${d}`;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/** Hora local de un Date según el reloj configurado (24h → 14:30; 12h → 2:30 p.m.). */
export function formatTimeOfDay(date: Date, format: TenantFormat = current): string {
    return formatClock(date.getHours(), date.getMinutes(), format);
}

/** Hora y minuto ya resueltos (en la zona que sea) con el reloj de la empresa. */
function formatClock(h: number, minutes: number, format: TenantFormat): string {
    const mm = pad2(minutes);
    if (format.time_format === 'h12') {
        const suffix = h < 12 ? 'a. m.' : 'p. m.';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${mm} ${suffix}`;
    }
    return `${pad2(h)}:${mm}`;
}

/**
 * Timestamp naive-UTC del backend (`YYYY-MM-DD HH:mm:ss`, sin zona) →
 * fecha+hora LOCAL con el formato del workspace. Un valor no parseable se
 * devuelve tal cual.
 */
export function formatDateTimeStr(value: string, format: TenantFormat = current): string {
    const date = parseUtcDate(value);
    if (Number.isNaN(date.getTime())) return value;
    return formatDateTime(date, format);
}

/** Un `Date` (instante) en la fecha LOCAL con el formato de la empresa. */
export function formatDate(date: Date, format: TenantFormat = current): string {
    if (Number.isNaN(date.getTime())) return '—';
    const y = date.getFullYear();
    const mo = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return format.date_format === 'dmy'
        ? `${d}/${mo}/${y}`
        : format.date_format === 'mdy'
          ? `${mo}/${d}/${y}`
          : `${y}-${mo}-${d}`;
}

/** Un `Date` (instante) en la fecha y hora LOCALES con el formato de la empresa. */
export function formatDateTime(date: Date, format: TenantFormat = current): string {
    if (Number.isNaN(date.getTime())) return '—';
    return `${formatDate(date, format)} ${formatTimeOfDay(date, format)}`;
}

const MONTHS_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * v0.1.252 — Fecha larga en español ("6 de octubre de 2026"), sin depender
 * del idioma del navegador (antes salía "October 6, 2026" en uno en inglés).
 */
export function formatLongDate(date: Date): string {
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.getDate()} de ${MONTHS_ES[date.getMonth()]} de ${date.getFullYear()}`;
}

/**
 * v0.1.264 — La fecha y la hora de AHORA en la zona `tz` (null = la de
 * respaldo, UTC), con el formato elegido. Para la vista previa de Ajustes →
 * Formato regional: un ejemplo fijo ("31/12/2026 · 2:30 p. m.") se leía como
 * si fuera la hora actual.
 */
export function formatZonedNow(
    tz: string | null,
    format: TenantFormat = current,
    now: Date = new Date(),
): { date: string; time: string } {
    const naive = zonedNowNaive(tz ?? FALLBACK_TIME_ZONE, now);
    const [day = '', clock = ''] = naive.split(' ');
    const [h = '0', m = '0'] = clock.split(':');
    return { date: formatDateStr(day, format), time: formatClock(Number(h), Number(m), format) };
}
