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
    const base = num.toLocaleString('en-US', {
        minimumFractionDigits: opts.minFrac ?? 0,
        maximumFractionDigits: opts.maxFrac ?? Math.max(opts.minFrac ?? 0, 3),
    });
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
    const h = date.getHours();
    const mm = pad2(date.getMinutes());
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
    const raw = value.trim().replace(' ', 'T');
    const date = new Date(raw.endsWith('Z') || raw.includes('+') ? raw : `${raw}Z`);
    if (Number.isNaN(date.getTime())) return value;
    const y = date.getFullYear();
    const mo = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const datePart =
        format.date_format === 'dmy'
            ? `${d}/${mo}/${y}`
            : format.date_format === 'mdy'
              ? `${mo}/${d}/${y}`
              : `${y}-${mo}-${d}`;
    return `${datePart} ${formatTimeOfDay(date, format)}`;
}
