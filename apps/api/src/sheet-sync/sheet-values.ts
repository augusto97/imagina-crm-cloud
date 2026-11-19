import { createHash } from 'node:crypto';
import {
    civilDateString,
    civilDateTimeString,
    civilFromExcelSerial,
    coerceTextToFieldValue,
    normalizeDateString,
    validateFieldValue,
    type Field,
    type SheetSuggestedFieldType,
    type TenantFormat,
} from '@imagina-base/shared';
import { detectFieldType } from '../import/field-type-detector';

/**
 * v0.1.459 (G3) — Piezas puras de la sincronización con Google Sheets: cómo
 * se lee una celda de la hoja como valor de un campo, cómo se escribe el
 * valor de un campo en una celda y la forma CANÓNICA de una celda (la que se
 * compara para saber si algo cambió).
 *
 * La hoja se lee con `valueRenderOption=UNFORMATTED_VALUE` y
 * `dateTimeRenderOption=SERIAL_NUMBER`: los números llegan como números, las
 * casillas como booleanos y las fechas reales como número de días (la misma
 * época que Excel). Se escribe con `valueInputOption=RAW`: un número viaja
 * como número, una casilla como booleano y TODO texto como texto — un dato que
 * empieza con `=` nunca se vuelve una fórmula en la planilla, y el `+` de un
 * teléfono no se pierde.
 */

/** Lo que trae (o lleva) una celda. */
export type SheetCell = string | number | boolean | null;

/** Formato de la empresa: separadores, orden de fecha y zona horaria. */
export interface SheetValueCtx {
    numberFormat?: TenantFormat['number_format'];
    dateFormat?: TenantFormat['date_format'];
    timeZone: string;
}

const NUMERIC = new Set(['number', 'currency', 'percent', 'rating', 'duration']);

/**
 * La forma canónica de una celda, para comparar: vacío = '', un número como
 * su texto de JS, una casilla como TRUE/FALSE, un texto sin espacios a los
 * costados ni saltos de línea de Windows.
 */
export function cellCanon(c: unknown): string {
    if (c === null || c === undefined) return '';
    if (typeof c === 'number') return Number.isFinite(c) ? String(c) : '';
    if (typeof c === 'boolean') return c ? 'TRUE' : 'FALSE';
    return String(c).replace(/\r\n?/g, '\n').trim();
}

/** Lo que se muestra de una celda (vista previa, avisos). */
export function cellDisplay(c: unknown): string | null {
    const t = cellCanon(c);
    return t === '' ? null : t;
}

/**
 * Una celda de la hoja como valor VALIDADO de un campo. Vacía = null (o `[]`
 * en una selección múltiple). Un número de una celda con formato de fecha
 * (serial) se entiende como fecha si el campo es de fecha.
 */
export function cellToFieldValue(
    cell: unknown,
    field: Pick<Field, 'type' | 'config'>,
    ctx: SheetValueCtx,
): { ok: true; value: unknown } | { ok: false; error: string } {
    let candidate: unknown;
    if (cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')) {
        return { ok: true, value: field.type === 'multi_select' ? [] : null };
    }
    if (typeof cell === 'number') {
        if (NUMERIC.has(field.type)) candidate = cell;
        else if (field.type === 'date' || field.type === 'datetime') {
            const civil = civilFromExcelSerial(cell);
            if (!civil) return { ok: false, error: `«${cell}» no es una fecha` };
            candidate =
                field.type === 'date'
                    ? civilDateString(civil)
                    : normalizeDateString(civilDateTimeString(civil), 'datetime', { timeZone: ctx.timeZone });
        } else if (field.type === 'checkbox') candidate = cell !== 0;
        else candidate = coerceTextToFieldValue(String(cell), field, coercionOpts(ctx));
    } else if (typeof cell === 'boolean') {
        candidate = field.type === 'checkbox' ? cell : coerceTextToFieldValue(cell ? 'TRUE' : 'FALSE', field, coercionOpts(ctx));
    } else {
        candidate = coerceTextToFieldValue(String(cell), field, coercionOpts(ctx));
    }
    const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, candidate);
    return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.error };
}

function coercionOpts(ctx: SheetValueCtx) {
    return { numberFormat: ctx.numberFormat, dateFormat: ctx.dateFormat, timeZone: ctx.timeZone, strictBoolean: true };
}

/** El valor de un campo como celda de la hoja (lo que se manda con RAW). */
export function fieldValueToCell(field: Pick<Field, 'type' | 'config'>, value: unknown, ctx: SheetValueCtx): SheetCell {
    if (value === null || value === undefined || value === '') return '';
    if (Array.isArray(value) && value.length === 0) return '';
    switch (field.type) {
        case 'number':
        case 'currency':
        case 'percent':
        case 'rating':
        case 'duration': {
            const n = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(n) ? n : String(value);
        }
        case 'checkbox':
            return value === true || value === 'true' || value === 1;
        case 'datetime':
            return wallDateTime(String(value), ctx.timeZone) ?? String(value);
        case 'select':
            return optionLabel(field, String(value));
        case 'multi_select':
            return (Array.isArray(value) ? value : [value]).map((v) => optionLabel(field, String(v))).join(', ');
        default:
            return String(value);
    }
}

/** La forma canónica del valor de un campo (lo que quedaría en la celda). */
export function appCanon(field: Pick<Field, 'type' | 'config'>, value: unknown, ctx: SheetValueCtx): string {
    return cellCanon(fieldValueToCell(field, value, ctx));
}

function optionLabel(field: Pick<Field, 'config'>, value: string): string {
    const options = (field.config as { options?: unknown }).options;
    if (Array.isArray(options)) {
        for (const o of options) {
            if (o && typeof o === 'object' && String((o as { value?: unknown }).value) === value) {
                const label = (o as { label?: unknown }).label;
                return typeof label === 'string' && label !== '' ? label : value;
            }
        }
    }
    return value;
}

/** Un instante ISO como fecha y hora de pared en la zona de la empresa: `2026-07-30 09:30`. */
export function wallDateTime(iso: string, timeZone: string): string | null {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    let tz = timeZone;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
        tz = 'UTC';
    }
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const sec = get('second');
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}${sec !== '00' ? `:${sec}` : ''}`;
}

/** Huella de una fila de la hoja (sus celdas canónicas, en orden). */
export function rowFingerprint(cells: readonly string[]): string {
    return createHash('sha1').update(JSON.stringify(cells)).digest('hex');
}

/**
 * El tipo de campo que conviene para una columna, por sus valores: casillas
 * de Sheets → sí/no; números → número; el resto, con el MISMO detector del
 * import (email, enlace, teléfono, fecha, pocas opciones → selección).
 */
export function suggestSheetFieldType(cells: readonly unknown[]): SheetSuggestedFieldType {
    const filled = cells.filter((c) => cellCanon(c) !== '').slice(0, 300);
    if (filled.length === 0) return 'text';
    if (filled.every((c) => typeof c === 'boolean')) return 'checkbox';
    if (filled.every((c) => typeof c === 'number')) return 'number';
    const texts = filled.map((c) => cellCanon(c));
    const detected = detectFieldType(texts);
    if (detected === 'text' && texts.some((t) => t.length > 120 || t.includes('\n'))) return 'long_text';
    const known: readonly string[] = ['text', 'long_text', 'email', 'url', 'phone', 'number', 'checkbox', 'date', 'datetime', 'select'];
    return (known.includes(detected) ? detected : 'text') as SheetSuggestedFieldType;
}
