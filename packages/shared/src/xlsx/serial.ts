/**
 * Fechas de Excel: un NÚMERO de días (con la hora como fracción) contado
 * desde una época. Dos sistemas:
 *  - 1900 (el de siempre): el día 1 es el 1/1/1900 y, por un error heredado
 *    de Lotus 1-2-3, existe el 29/2/1900 (día 60) que en el calendario no
 *    existe. Desde el 1/3/1900 el número es "días desde el 30/12/1899".
 *  - 1904 (Excel viejo de Mac): días desde el 1/1/1904.
 *
 * Sin zona: el número es el reloj de pared de quien escribió la fecha. Quien
 * llama decide en qué zona interpretarlo (la de la empresa, ADR-S33).
 */

const MS_PER_DAY = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
/** 1/3/1900: desde aquí los números de Excel coinciden con el calendario. */
const MARCH_1900 = Date.UTC(1900, 2, 1);

export interface CivilDateTime {
    y: number;
    m: number;
    d: number;
    h: number;
    mi: number;
    s: number;
}

/**
 * El número de Excel (sistema 1900) de una fecha y hora civil. `null` si la
 * fecha es anterior al 1/1/1900 (Excel no la representa: se escribe como texto).
 */
export function excelSerialFromCivil(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number | null {
    const day = Date.UTC(y, m - 1, d);
    if (!Number.isFinite(day) || day < Date.UTC(1900, 0, 1)) return null;
    let serial = (day - EPOCH_1900) / MS_PER_DAY;
    // Enero y febrero de 1900: Excel cuenta un día menos (no tiene el 29/2 "falso" todavía).
    if (day < MARCH_1900) serial -= 1;
    return serial + (h * 3600 + mi * 60 + s) / 86_400;
}

/**
 * La fecha y hora civil de un número de Excel. La hora se redondea al
 * segundo (los números de Excel arrastran ruido de punto flotante:
 * 14:30 suele llegar como 14:29:59.9999).
 */
export function civilFromExcelSerial(serial: number, date1904 = false): CivilDateTime | null {
    if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_466) return null;
    let days = Math.floor(serial);
    let seconds = Math.round((serial - days) * 86_400);
    if (seconds >= 86_400) {
        days += 1;
        seconds -= 86_400;
    }
    let ms: number;
    if (date1904) {
        ms = EPOCH_1904 + days * MS_PER_DAY;
    } else if (days === 0) {
        // "Día 0" = la hora sola (una celda con formato de hora).
        ms = Date.UTC(1899, 11, 31);
    } else if (days < 60) {
        ms = Date.UTC(1899, 11, 31) + days * MS_PER_DAY;
    } else if (days === 60) {
        // El 29/2/1900 que no existe: lo más honesto es el 28.
        ms = Date.UTC(1900, 1, 28);
    } else {
        ms = EPOCH_1900 + days * MS_PER_DAY;
    }
    const dt = new Date(ms);
    return {
        y: dt.getUTCFullYear(),
        m: dt.getUTCMonth() + 1,
        d: dt.getUTCDate(),
        h: Math.floor(seconds / 3600),
        mi: Math.floor((seconds % 3600) / 60),
        s: seconds % 60,
    };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** `YYYY-MM-DD`. */
export function civilDateString(c: CivilDateTime): string {
    return `${pad(c.y, 4)}-${pad(c.m)}-${pad(c.d)}`;
}

/** `YYYY-MM-DD HH:MM` (con `:SS` sólo si hay segundos). */
export function civilDateTimeString(c: CivilDateTime): string {
    return `${civilDateString(c)} ${civilTimeString(c)}`;
}

/** `HH:MM` (con `:SS` sólo si hay segundos). */
export function civilTimeString(c: CivilDateTime): string {
    return `${pad(c.h)}:${pad(c.mi)}${c.s !== 0 ? `:${pad(c.s)}` : ''}`;
}
