import { zonedToUtc, validTimeZone, type FieldType, type SqlSuggestedFieldType } from '@imagina-base/shared';

/**
 * De un valor de SQL Server al texto que entiende el import (v0.1.243).
 *
 * El motor convierte cada celda a TEXTO y la pasa por el mismo camino que una
 * celda de CSV (`coerceCellValue` + `validateFieldValue`): una sola forma de
 * interpretar "1.250,50", "Sí" o una etiqueta de select, venga de un archivo o
 * de una base. Lo propio de SQL —las fechas— se resuelve acá:
 *
 *  - `datetimeoffset` trae su zona: es un instante y se pasa a UTC.
 *  - `datetime`/`datetime2`/`smalldatetime` NO traen zona: son la hora "de
 *    pared" del servidor de la empresa. Con `useUTC` el driver la deja en los
 *    campos UTC del Date; acá se interpreta en la zona elegida en la
 *    sincronización y se pasa a UTC (la app guarda fechas-hora en UTC naive).
 *  - Si el destino es una FECHA (sin hora), se toma el día de pared tal cual:
 *    pasar a UTC primero movería un "lunes 21:00" de Bogotá al martes.
 *
 * Puro: se testea sin base.
 */
export function sqlCellToText(value: unknown, sqlType: string, targetType: FieldType | 'text', timezone: string): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return dateToText(value, sqlType, targetType, timezone);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value;
    // Binarios (varbinary, image): no tienen una representación útil en un campo.
    if (value instanceof Uint8Array) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function dateToText(d: Date, sqlType: string, targetType: FieldType | 'text', timezone: string): string | null {
    if (Number.isNaN(d.getTime())) return null;
    const t = sqlType.toLowerCase();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const wallDate = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    if (t === 'date' || targetType === 'date') {
        if (t === 'datetimeoffset' && targetType === 'date') {
            // Un instante: el día es el de la zona elegida.
            const local = toZoneWall(d, timezone);
            return `${pad(local.y, 4)}-${pad(local.mo)}-${pad(local.d)}`;
        }
        return wallDate;
    }
    if (t === 'time') return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    let instant = d;
    if (t !== 'datetimeoffset') {
        const tz = validTimeZone(timezone) ? timezone : 'UTC';
        instant = zonedToUtc(
            d.getUTCFullYear(),
            d.getUTCMonth() + 1,
            d.getUTCDate(),
            d.getUTCHours(),
            d.getUTCMinutes(),
            tz,
            d.getUTCSeconds(),
        );
    }
    // ISO 8601 en UTC: es lo que guarda (y valida) un campo fecha-hora.
    return `${pad(instant.getUTCFullYear(), 4)}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}T${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())}:${pad(instant.getUTCSeconds())}Z`;
}

function toZoneWall(d: Date, tz: string): { y: number; mo: number; d: number } {
    const zone = validTimeZone(tz) ? tz : 'UTC';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    return { y: get('year'), mo: get('month'), d: get('day') };
}

/** Qué tipo de campo conviene para una columna (al crear el campo desde la sincronización). */
export function suggestFieldType(sqlType: string, length: number | null): SqlSuggestedFieldType {
    const t = sqlType.toLowerCase();
    if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real'].includes(t)) return 'number';
    if (t === 'money' || t === 'smallmoney') return 'currency';
    if (t === 'bit') return 'checkbox';
    if (t === 'date') return 'date';
    if (['datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'].includes(t)) return 'datetime';
    if (t === 'ntext' || t === 'text' || t === 'xml') return 'long_text';
    if ((t === 'nvarchar' || t === 'varchar') && (length === null || length < 0 || length > 500)) return 'long_text';
    return 'text';
}

/** Resuelve el nombre de una columna del resultado sin distinguir mayúsculas. */
export function findColumn(columns: Array<{ name: string }>, wanted: string): string | null {
    const exact = columns.find((c) => c.name === wanted);
    if (exact) return exact.name;
    const lower = wanted.toLowerCase();
    return columns.find((c) => c.name.toLowerCase() === lower)?.name ?? null;
}
