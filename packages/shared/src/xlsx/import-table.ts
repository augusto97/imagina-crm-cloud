/**
 * De una hoja de Excel a la tabla de texto que entiende el import.
 *
 * El import (CSV) ya resuelve el mapeo, la creación de campos y opciones, los
 * errores por fila y la jerarquía: una planilla sólo cambia DE DÓNDE salen las
 * filas. Cada celda se escribe en una forma que el import lee sin ambigüedad
 * cuando la petición dice `source: 'xlsx'` (el servidor la lee entonces con el
 * formato regional y la zona de la empresa):
 *
 *  - número → sin separador de miles y con el decimal de la empresa
 *    (`1234.5` o `1234,5`): «1.234» nunca se confunde con mil doscientos;
 *  - porcentaje → `75%` (Excel guarda 0,75);
 *  - fecha → `2026-07-30`; fecha y hora → `2026-07-30 14:30` en el reloj de
 *    pared con que se escribió (el servidor la ubica en la zona de la empresa,
 *    la misma con la que la exporta);
 *  - duración (`[h]:mm`) → `1h 30m`; hora sola → `14:30`;
 *  - verdadero/falso → `Sí`/`No`; celda con error → vacía.
 */
import { formatDuration } from '../field-types/duration';
import { civilDateString, civilDateTimeString, civilFromExcelSerial, civilTimeString } from './serial';
import type { XlsxCell, XlsxRow, XlsxSheet } from './reader';

export interface XlsxImportTable {
    sheetName: string;
    headers: string[];
    rows: string[][];
    /** Filas de datos de la hoja (sin la cabecera), aunque pasen del tope. */
    totalRows: number;
    /** Hay más filas de las que se importan de una vez. */
    truncated: boolean;
    /** Índice de columna → tipo de campo que sugiere el FORMATO de sus celdas. */
    typeHints: Record<number, string>;
    /** Filas de arriba que se saltaron por no ser la cabecera (un título, un logo). */
    skippedTopRows: number;
    formulasWithoutValue: number;
    errorCells: number;
    colsTruncated: boolean;
}

export interface XlsxTableOptions {
    /** Decimal de la empresa: `.` (1,234.5) o `,` (1.234,5). */
    decimalSeparator: '.' | ',';
    /** Filas de datos que se toman (las demás se cuentan y se avisa). */
    maxRows: number;
}

/**
 * Convierte la hoja en cabeceras + filas de texto. La cabecera es la primera
 * fila "llena" (con al menos la mitad de las columnas que usa la tabla): un
 * título suelto arriba de la tabla —celdas combinadas incluidas— no la
 * reemplaza.
 */
export function xlsxSheetToImportTable(sheet: XlsxSheet, opts: XlsxTableOptions): XlsxImportTable {
    const filled = (r: XlsxRow): number => r.cells.reduce((n, c) => (c !== null && cellText(c, opts.decimalSeparator) !== '' ? n + 1 : n), 0);
    const head = sheet.rows.slice(0, 10);
    const widest = head.reduce((m, r) => Math.max(m, filled(r)), 0);
    let headerIdx = head.findIndex((r) => filled(r) >= Math.max(1, Math.ceil(widest / 2)));
    if (headerIdx === -1) headerIdx = 0;

    const headerRow = sheet.rows[headerIdx];
    const dataRows = sheet.rows.slice(headerIdx + 1, headerIdx + 1 + opts.maxRows);
    const totalRows = Math.max(0, sheet.totalRows - headerIdx - 1);

    // Columnas en uso: de la primera a la última con algo (una tabla que
    // arranca en la columna C no trae dos columnas vacías adelante).
    let first = Number.POSITIVE_INFINITY;
    let last = -1;
    for (const r of headerRow ? [headerRow, ...dataRows] : dataRows) {
        r.cells.forEach((c, i) => {
            if (c !== null && cellText(c, opts.decimalSeparator) !== '') {
                first = Math.min(first, i);
                last = Math.max(last, i);
            }
        });
    }
    if (last === -1) {
        return {
            sheetName: sheet.name,
            headers: [],
            rows: [],
            totalRows: 0,
            truncated: false,
            typeHints: {},
            skippedTopRows: headerIdx,
            formulasWithoutValue: sheet.formulasWithoutValue,
            errorCells: sheet.errorCells,
            colsTruncated: sheet.colsTruncated,
        };
    }
    const span = (r: XlsxRow | undefined): Array<XlsxCell | null> => {
        const out: Array<XlsxCell | null> = [];
        for (let i = first; i <= last; i++) out.push(r?.cells[i] ?? null);
        return out;
    };

    const headers = span(headerRow).map((c) => (c === null ? '' : cellText(c, opts.decimalSeparator).replace(/\s+/g, ' ').trim()));
    const typed = dataRows.map(span);
    const rows = typed.map((cells) => cells.map((c) => (c === null ? '' : cellText(c, opts.decimalSeparator))));

    const typeHints: Record<number, string> = {};
    headers.forEach((_h, col) => {
        const hint = hintFor(typed.map((r) => r[col] ?? null));
        if (hint !== null) typeHints[col] = hint;
    });

    return {
        sheetName: sheet.name,
        headers,
        rows,
        totalRows,
        truncated: totalRows > dataRows.length,
        typeHints,
        skippedTopRows: headerIdx,
        formulasWithoutValue: sheet.formulasWithoutValue,
        errorCells: sheet.errorCells,
        colsTruncated: sheet.colsTruncated,
    };
}

/** El texto de una celda, en la forma que el import lee sin ambigüedad. */
export function cellText(c: XlsxCell, decimal: '.' | ','): string {
    switch (c.t) {
        case 'str':
            return c.v;
        case 'bool':
            return c.v ? 'Sí' : 'No';
        case 'err':
            return '';
        case 'date':
            return c.time ? civilDateTimeString(c.v) : civilDateString(c.v);
        case 'num':
            switch (c.kind) {
                case 'percent':
                    return `${canonicalNumber(c.v * 100, decimal)}%`;
                case 'elapsed':
                    return c.v < 0 ? canonicalNumber(c.v, decimal) : formatDuration(c.v * 1440);
                case 'time': {
                    const t = civilFromExcelSerial(c.v - Math.floor(c.v));
                    return t ? civilTimeString(t) : canonicalNumber(c.v, decimal);
                }
                default:
                    return canonicalNumber(c.v, decimal);
            }
    }
}

/**
 * Un número sin separador de miles, con el decimal pedido y sin el ruido de
 * punto flotante que guarda Excel (0,1 + 0,2 = 0,30000000000000004): se
 * redondea a 15 cifras significativas, lo mismo que muestra Excel.
 */
export function canonicalNumber(n: number, decimal: '.' | ','): string {
    if (!Number.isFinite(n)) return '';
    let v = Number(n.toPrecision(15));
    if (Object.is(v, -0)) v = 0;
    let s = String(v);
    if (/e/i.test(s)) {
        s = Math.abs(v) >= 1 ? BigInt(Math.round(v)).toString() : v.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
    }
    return decimal === ',' ? s.replace('.', ',') : s;
}

/**
 * Tipo de campo que sugiere el formato de las celdas (≥ 80 % de las que tienen
 * algo). Además: dígitos guardados como TEXTO (`'+57 300…`, `00123`) los
 * escribió así una persona a propósito — un teléfono o un código no es un
 * número (perdería el `+` y los ceros de adelante).
 */
function hintFor(cells: Array<XlsxCell | null>): string | null {
    const counts = new Map<string, number>();
    let total = 0;
    let digitText = 0;
    let phoneLike = 0;
    let withPlus = 0;
    for (const c of cells) {
        if (c === null || c.t === 'err') continue;
        total++;
        const k = c.t === 'date' ? (c.time ? 'datetime' : 'date')
            : c.t === 'bool' ? 'checkbox'
            : c.t === 'num' && c.kind === 'percent' ? 'percent'
            : c.t === 'num' && c.kind === 'currency' ? 'currency'
            : c.t === 'num' && c.kind === 'elapsed' ? 'duration'
            : null;
        if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
        if (c.t === 'str' && /^\+?\d[\d\s().-]*$/.test(c.v.trim())) {
            digitText++;
            const digits = c.v.replace(/\D/g, '').length;
            if (digits >= 7 && digits <= 15) phoneLike++;
            if (c.v.trim().startsWith('+')) withPlus++;
        }
    }
    if (total === 0) return null;
    const enough = Math.ceil(total * 0.8);
    for (const [k, n] of counts) if (n >= enough) return k;
    if (digitText >= enough) return phoneLike >= enough && withPlus > 0 ? 'phone' : 'text';
    return null;
}

/**
 * Cabeceras + filas → CSV (RFC 4180, separado por comas). Se ENTRECOMILLA toda
 * celda con coma, punto y coma, tabulación, comillas o saltos de línea: así
 * el detector de separador del import —que cuenta en la primera línea lo que
 * está fuera de comillas— siempre ve la coma.
 */
export function tableToCsv(headers: string[], rows: string[][]): string {
    const line = (cells: string[]): string =>
        cells.map((c) => (/[",;\t\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
    return [line(headers), ...rows.map(line)].join('\r\n') + '\r\n';
}
