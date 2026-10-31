import { foldSearchText } from '../field-types/search';
import { parseNumberText, type TextNumberFormat } from '../field-types/text-coercion';
import {
    FILE_IMPORT_MAX_COLUMNS,
    type FileImportColumnProfile,
    type FileImportDateOrder,
    type FileImportEntityCandidate,
    type FileImportFieldType,
    type FileImportNumberFormat,
    type FileImportSheetProfile,
} from './schema';

/**
 * v0.1.339 (ADR-S88) — El PERFIL de una hoja: las reglas que corren gratis y
 * sobre TODO el archivo antes de que intervenga (o no) la IA. Puro: lo usan el
 * servidor (análisis) y los tests.
 *
 * Mejoras sobre el detector histórico del import (que sigue intacto para el
 * import a una lista existente):
 *  - el ENCABEZADO cuenta: «NIT» con dígitos es un documento (texto, no un
 *    número que se suma), «Teléfono» con 10 dígitos es un teléfono, «Valor»
 *    con números es moneda;
 *  - moneda, porcentaje, calificación, selección múltiple y texto largo;
 *  - los ceros a la izquierda («00123») mantienen el texto;
 *  - el orden de las fechas (día/mes o mes/día) se decide por los datos;
 *  - sugerencias de descarte con su motivo.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const BOOL_WORDS = new Set(['1', '0', 'true', 'false', 'yes', 'no', 'si', 'sí', 'x', 'verdadero', 'falso', 'on', 'off', '✓', '✔', '✗']);
const CURRENCY_RE = /(^|\s|^-)(\$|us\$|usd|cop|mxn|eur|€|pen|s\/|clp|ars|£)\s?|\s?(usd|cop|mxn|eur|€|pen|clp|ars)$/i;

/** Encabezados que dicen qué es la columna (sin acentos, minúsculas). */
const HINTS = {
    phone: /(tel[eé]?f|telefono|celular|cel\b|movil|whats|phone|mobile|contacto tel)/,
    email: /(correo|e-?mail|mail\b)/,
    id: /(^|\b)(nit|c\.?c\.?|cedula|documento|doc\b|identificacion|id\b|codigo|cod\b|sku|ref\b|referencia|n[°ºo]\.?\s|numero de|no\.\s|placa|rut|rfc|dni|curp|cuit|ruc|factura n|consecutivo)/,
    nit: /(^|\b)(nit|rut|rfc|ruc|cuit)\b/,
    cedula: /(cedula|^c\.?c\.?$|documento|identificacion|dni|curp)/,
    placa: /placa/,
    money: /(valor|monto|precio|total|saldo|costo|pago|importe|subtotal|\biva\b|deuda|abono|venta|ingreso|gasto|salario|sueldo|presupuesto|cuota|tarifa|honorario|comision|facturado|cobrado|pendiente de pago|price|amount|cost)/,
    percent: /(%|porcentaje|avance|progreso|descuento|comision %|margen|tasa)/,
    rating: /(calificaci|rating|estrellas|puntuaci|satisfacci|nps|nota\b)/,
    duration: /(duraci|horas trabajadas|tiempo (de|en)|minutos)/,
    status: /(estado|etapa|status|fase|prioridad|tipo|categor|segmento|origen|fuente|canal|nivel|modalidad|plan\b|ciudad|pais|departamento|sector|industria)/,
    longText: /(nota|descripci|comentario|observaci|detalle|mensaje|resumen|direcci)/,
    tags: /(etiqueta|tags?\b|categorias|intereses|servicios|productos)/,
    name: /(^|\b)(nombre|name|razon social|cliente|empresa|titulo|asunto|producto|proyecto|tarea|contacto|proveedor|negocio|oportunidad|evento|candidato|paciente|alumno|estudiante|articulo)/,
    rowNumber: /^(id|#|n[°º]?|no\.?|item|fila|row|consecutivo)$/,
};

export interface ProfileOptions {
    /** Excel: índice de columna → tipo que sugieren los formatos de sus celdas. */
    typeHints?: Record<string, string>;
    /** Formato de números de la empresa (decide «1.500»). */
    numberFormat?: TextNumberFormat;
    /** Orden de fechas de la empresa (decide «03/04/2026» si ningún dato lo resuelve). */
    dateFormat?: FileImportDateOrder;
    /** Filas que entran (el resto se informa como recortado). */
    maxRows?: number;
}

const fold = (s: string): string => foldSearchText(s).replace(/\s+/g, ' ').trim();

export type FileImportHeaderHint = keyof typeof HINTS;

/** Qué dice el encabezado de una columna («NIT» → id y nit; «Valor total» → money). */
export function headerHints(header: string): Set<FileImportHeaderHint> {
    const h = fold(header);
    const out = new Set<FileImportHeaderHint>();
    for (const [k, re] of Object.entries(HINTS) as Array<[FileImportHeaderHint, RegExp]>) if (re.test(h)) out.add(k);
    return out;
}

/** El texto plegado que usan el perfil, el borrador y la importación para comparar valores. */
export function foldImportValue(s: string): string {
    return fold(s);
}

/** Encabezados limpios y únicos: un vacío pasa a «Columna N», un repetido suma « 2». */
export function cleanHeaders(raw: readonly string[]): string[] {
    const seen = new Map<string, number>();
    return raw.slice(0, FILE_IMPORT_MAX_COLUMNS).map((h, i) => {
        let label = String(h ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (label === '' || /^unnamed:?\s*\d*$/i.test(label)) label = `Columna ${i + 1}`;
        const k = fold(label);
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        return n > 1 ? `${label} ${n}` : label;
    });
}

export function profileSheet(index: number, name: string, headersRaw: readonly string[], rowsRaw: readonly (readonly string[])[], opts: ProfileOptions = {}): FileImportSheetProfile {
    const headers = cleanHeaders(headersRaw);
    const max = opts.maxRows ?? Number.POSITIVE_INFINITY;
    // Filas completamente vacías fuera (las deja un Excel con formato hasta abajo).
    const nonEmpty = rowsRaw.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    const rows = nonEmpty.slice(0, max);
    const width = headers.length;
    const cells = (col: number): string[] => rows.map((r) => String(r[col] ?? '').trim());

    const columns: FileImportColumnProfile[] = [];
    const values: string[][] = [];
    for (let c = 0; c < width; c++) {
        const vals = cells(c);
        values.push(vals);
        columns.push(profileColumn(c, headers[c] ?? `Columna ${c + 1}`, vals, rows.length, opts));
    }
    markDuplicateColumns(columns, values);
    markDerivedColumns(columns, values, opts.numberFormat);

    let duplicateRows = 0;
    const seen = new Set<string>();
    for (const r of rows) {
        const sig = headers.map((_, c) => String(r[c] ?? '').trim()).join('\u0001');
        if (seen.has(sig)) duplicateRows++;
        else seen.add(sig);
    }

    return {
        index,
        name: name.trim().slice(0, 120),
        headers,
        rows: rows.length,
        total_rows: nonEmpty.length,
        truncated: nonEmpty.length > rows.length,
        duplicate_rows: duplicateRows,
        columns,
        ...(headersRaw.length > headers.length ? { extra_columns: headersRaw.length - headers.length } : {}),
    };
}

function share(values: readonly string[], test: (v: string) => boolean): number {
    if (values.length === 0) return 0;
    let n = 0;
    for (const v of values) if (test(v)) n++;
    return n / values.length;
}

function digitsOnly(v: string): string {
    return v.replace(/\D/g, '');
}

/**
 * ¿Parece una cifra? Dígitos con separadores y, a lo sumo, un signo de moneda o
 * un código de moneda conocido. «Tarea 1» o «Cliente 7» NO son números aunque
 * el lector de números (tolerante a «COP 1.500») les saque el 1.
 */
const CURRENCY_CODE = '(?:COP|USD|MXN|EUR|ARS|CLP|PEN|BRL|UYU|BOB|PYG|GTQ|CRC|DOP|HNL|NIO|PAB|VES|CAD|GBP|US|R|S/\\.?)';
const NUMERIC_RE = new RegExp(
    `^\\(?[+\\-\u2212]?\\s*(?:[$\u20ac\u00a3\u00a5\u20a1\u20b2\u20b1]|${CURRENCY_CODE}\\s*\\$?)?\\s*[+\\-\u2212]?[\\d.,'\\s\u00a0\u202f]*\\d[\\d.,'\\s\u00a0\u202f]*\\s*(?:%|${CURRENCY_CODE})?\\s*\\)?$`,
    'i',
);
function looksNumeric(v: string): boolean {
    return NUMERIC_RE.test(v.trim());
}

/** Un número con los miles agrupados de a tres (con punto o coma), con o sin decimales. */
const THOUSANDS_RE = /^-?\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/;

function looksPhone(v: string): boolean {
    if (!/^[+(]?[\d][\d\s().+-]*$/.test(v)) return false;
    const d = digitsOnly(v);
    return d.length >= 7 && d.length <= 15;
}

/** Una fecha: ISO o con barras/guiones/puntos, opcionalmente con hora. */
const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})|^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/;
function looksDate(v: string): boolean {
    const m = DATE_RE.exec(v);
    if (!m) return false;
    if (m[1]) return Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31;
    const a = Number(m[4]);
    const b = Number(m[5]);
    return a >= 1 && b >= 1 && a <= 31 && b <= 31 && (a <= 12 || b <= 12);
}

/** Día primero o mes primero, según los datos (un 25/03 resuelve). */
export function detectDateOrder(values: readonly string[], fallback: FileImportDateOrder | undefined): FileImportDateOrder {
    let dayFirst = 0;
    let monthFirst = 0;
    let iso = 0;
    for (const v of values) {
        const m = DATE_RE.exec(v);
        if (!m) continue;
        if (m[1]) {
            iso++;
            continue;
        }
        const a = Number(m[4]);
        const b = Number(m[5]);
        if (a > 12 && b <= 12) dayFirst++;
        else if (b > 12 && a <= 12) monthFirst++;
    }
    if (iso > 0 && dayFirst === 0 && monthFirst === 0) return 'ymd';
    if (dayFirst > monthFirst) return 'dmy';
    if (monthFirst > dayFirst) return 'mdy';
    return fallback === 'mdy' ? 'mdy' : 'dmy';
}

/** Coma decimal o punto decimal, según los datos («1.234,50» lo resuelve). */
export function detectNumberFormat(values: readonly string[], fallback: TextNumberFormat | undefined): FileImportNumberFormat {
    let dotDecimal = 0;
    let commaDecimal = 0;
    for (const raw of values) {
        const v = raw.replace(/[^\d.,]/g, '');
        if (/\d,\d{3}\.\d+$/.test(v) || /^\d+\.\d{1,2}$/.test(v)) dotDecimal++;
        else if (/\d\.\d{3},\d+$/.test(v) || /^\d+,\d{1,2}$/.test(v)) commaDecimal++;
        else if (/^\d{1,3}(\.\d{3})+$/.test(v)) commaDecimal++; // 1.500.000: punto de miles
        else if (/^\d{1,3}(,\d{3}){2,}$/.test(v)) dotDecimal++; // 1,500,000: coma de miles
    }
    if (commaDecimal > dotDecimal) return 'dot_comma';
    if (dotDecimal > commaDecimal) return 'comma_dot';
    return fallback === 'comma_dot' ? 'comma_dot' : 'dot_comma';
}

function pct(n: number): string {
    return `${Math.round(n * 100)} %`;
}

function profileColumn(index: number, header: string, all: readonly string[], rowCount: number, opts: ProfileOptions): FileImportColumnProfile {
    const vals = all.filter((v) => v !== '');
    const filled = vals.length;
    const distinctSet = new Set(vals);
    const distinct = distinctSet.size;
    const samples = [...distinctSet].slice(0, 5).map((v) => v.slice(0, 120));
    const avg = filled === 0 ? 0 : Math.round(vals.reduce((n, v) => n + v.length, 0) / filled);
    const h = fold(header);
    const base = { index, header, filled, distinct, samples, avg_length: avg };

    // Frecuencias por forma plegada (Pagado/pagado/PAGADO cuentan juntas).
    const freq = new Map<string, { count: number; forms: Map<string, number> }>();
    for (const v of vals) {
        const k = fold(v);
        const e = freq.get(k) ?? { count: 0, forms: new Map<string, number>() };
        e.count++;
        e.forms.set(v, (e.forms.get(v) ?? 0) + 1);
        freq.set(k, e);
    }
    const foldedDistinct = freq.size;
    const top =
        foldedDistinct <= 30
            ? [...freq.values()]
                  .sort((a, b) => b.count - a.count)
                  .map((e) => ({ value: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0]![0], count: e.count }))
            : null;

    const out = (detected: FileImportFieldType, reason: string, extra: Partial<FileImportColumnProfile> = {}): FileImportColumnProfile => ({
        ...base,
        top,
        detected,
        reason,
        ...extra,
    });

    if (filled === 0) return out('text', 'La columna está vacía.', { discard: 'Está vacía en todas las filas.' });

    const discard = discardReason(header, h, vals, filled, distinct, rowCount, opts);
    const hint = opts.typeHints?.[String(index)];

    // 1. Lo que dicen los formatos del Excel manda (fechas, montos, porcentajes).
    if (hint === 'date' || hint === 'datetime') {
        return out(hint, 'Las celdas tienen formato de fecha en el Excel.', { discard, date_order: 'ymd' });
    }
    if (hint === 'percent') return out('percent', 'Las celdas tienen formato de porcentaje en el Excel.', { discard, numeric: numericStats(vals, opts.numberFormat) });
    if (hint === 'currency') return out('currency', 'Las celdas tienen formato de moneda en el Excel.', { discard, numeric: numericStats(vals, opts.numberFormat) });
    if (hint === 'duration') return out('duration', 'Las celdas tienen formato de duración en el Excel.', { discard });
    if (hint === 'checkbox') return out('checkbox', 'Las celdas son verdadero o falso en el Excel.', { discard });
    if (hint === 'phone') return out('phone', 'Números de teléfono escritos como texto en el Excel.', { discard, shape: 'phone' });
    if (hint === 'text' && !HINTS.phone.test(h)) {
        // Dígitos guardados como TEXTO a propósito: un código o documento (con sus ceros).
        return out('text', 'Son códigos escritos como texto en el Excel: se guardan tal cual, con sus ceros.', { discard, shape: 'id' });
    }

    // 2. Formas inequívocas.
    const emailShare = share(vals, (v) => EMAIL_RE.test(v));
    if (emailShare >= 0.9 || (HINTS.email.test(h) && emailShare >= 0.6)) {
        return out('email', emailShare >= 0.999 ? 'Son correos.' : `${pct(emailShare)} son correos (los que no lo son se van a avisar).`, { discard, shape: 'email' });
    }
    if (share(vals, (v) => URL_RE.test(v)) >= 0.9) return out('url', 'Son direcciones web.', { discard, shape: 'url' });
    if (distinct <= 3 && share(vals, (v) => BOOL_WORDS.has(v.toLowerCase())) >= 0.95) return out('checkbox', 'Sólo dice sí o no.', { discard });

    // 3. Teléfonos: con el encabezado alcanza el número pelado; sin él, hace falta + o separadores.
    const phoneShare = share(vals, looksPhone);
    // Un monto con miles agrupados («1.013.500», «2,450,000») NO es un teléfono, y
    // un encabezado de dinero («Valor», «Total») tampoco deja leerlo como tal.
    const explicitPhone = share(vals, (v) => looksPhone(v) && !THOUSANDS_RE.test(v) && (v.startsWith('+') || v.startsWith('00') || /[\s().-]/.test(v)));
    if ((HINTS.phone.test(h) && phoneShare >= 0.8) || (!HINTS.money.test(h) && explicitPhone >= 0.8)) {
        return out('phone', HINTS.phone.test(h) ? 'El encabezado dice teléfono y los valores son números de 7 a 15 dígitos.' : 'Tienen forma de teléfono internacional.', {
            discard,
            shape: 'phone',
        });
    }

    // 4. Documentos y códigos: aunque sean dígitos, NO son números (no se suman, conservan ceros).
    const leadingZeros = share(vals, (v) => /^0\d+$/.test(v)) >= 0.3;
    const idish = share(vals, (v) => /^[\dA-Za-z][\dA-Za-z.\-/ ]*$/.test(v) && /\d/.test(v)) >= 0.9;
    if ((HINTS.id.test(h) && idish && distinct >= filled * 0.8) || (leadingZeros && idish)) {
        const extra: Partial<FileImportColumnProfile> = { discard, shape: 'id' };
        return out('text', leadingZeros ? 'Códigos con ceros a la izquierda: van como texto para no perderlos.' : 'Es un documento o código: va como texto (no se suma).', extra);
    }

    // 5. Números con sentido: porcentaje, moneda, calificación, duración, número.
    const numFormat = detectNumberFormat(vals, opts.numberFormat);
    const numberShare = share(vals, (v) => looksNumeric(v) && parseNumberText(v, numFormat) !== null && !looksDate(v));
    if (numberShare >= 0.9) {
        const stats = numericStats(vals, numFormat);
        const withPercent = share(vals, (v) => /%\s*$/.test(v));
        if (withPercent >= 0.5) return out('percent', 'Los valores traen el signo %.', { discard, numeric: stats, number_format: numFormat });
        if (HINTS.percent.test(h) && stats.min >= 0 && stats.max <= 100) {
            return out('percent', 'El encabezado habla de un porcentaje y los valores van de 0 a 100.', { discard, numeric: stats, number_format: numFormat });
        }
        const withCurrency = share(vals, (v) => CURRENCY_RE.test(v));
        if (withCurrency >= 0.5) return out('currency', 'Los valores traen signo de moneda.', { discard, numeric: stats, number_format: numFormat });
        if (HINTS.money.test(h)) return out('currency', 'El encabezado habla de dinero y los valores son números.', { discard, numeric: stats, number_format: numFormat });
        if (HINTS.rating.test(h) && stats.integers && stats.min >= 0 && stats.max <= 10) {
            return out('rating', 'Es una calificación (números enteros chicos).', { discard, numeric: stats, number_format: numFormat });
        }
        if (HINTS.rowNumber.test(h) && stats.integers && distinct === filled) {
            return out('number', 'Es un número correlativo.', { discard: discard ?? rowNumberDiscard(vals), numeric: stats, number_format: numFormat });
        }
        return out('number', `${pct(numberShare)} son números.`, { discard, numeric: stats, number_format: numFormat });
    }
    if (HINTS.duration.test(h) && share(vals, (v) => /^\d{1,4}:[0-5]\d$|^\d+(\.\d+)?\s*(h|hs|horas?|m|min|minutos?)\b/i.test(v)) >= 0.8) {
        return out('duration', 'Son tiempos (horas y minutos).', { discard });
    }

    // 6. Fechas.
    const dateShare = share(vals, looksDate);
    if (dateShare >= 0.85) {
        const order = detectDateOrder(vals, opts.dateFormat);
        const withTime = share(vals, (v) => /\d{1,2}:\d{2}/.test(v));
        const orderText = order === 'ymd' ? 'año-mes-día' : order === 'mdy' ? 'mes/día/año' : 'día/mes/año';
        return out(withTime >= 0.5 ? 'datetime' : 'date', `${pct(dateShare)} son fechas (${orderText}).`, { discard, date_order: order });
    }

    // 7. Texto: varias opciones, una opción, texto largo, texto.
    const multi = multiSelectTokens(vals);
    if (multi && (HINTS.tags.test(h) || multi.tokens <= 40)) {
        return out('multi_select', `Varias opciones por celda, separadas por coma (${multi.tokens} distintas).`, { discard, token_top: multi.top });
    }
    const repeats = filled >= foldedDistinct * 2;
    const nameLike = HINTS.name.test(h) && !HINTS.status.test(h);
    if (repeats && avg <= 40 && (foldedDistinct <= 12 || (HINTS.status.test(h) && foldedDistinct <= 30)) && !(nameLike && foldedDistinct > 6)) {
        // Un «Cliente» o «Vendedor» con pocos nombres: opciones, pero sigue siendo un nombre (se enmascara para la IA).
        return out('select', `Pocos valores que se repiten (${foldedDistinct}): sirven como opciones.`, { discard, ...(nameLike ? { shape: 'name' as const } : {}) });
    }
    if (avg > 80 || vals.some((v) => v.includes('\n')) || (HINTS.longText.test(h) && avg > 30)) {
        return out('long_text', 'Textos largos o con varias líneas: van en un campo de texto largo.', { discard, shape: 'free_text' });
    }
    const textReason =
        distinct >= filled * 0.8 ? 'Texto libre: casi cada fila trae un valor distinto.' : `Texto libre (${foldedDistinct} valores distintos en ${filled} filas).`;
    return out('text', textReason, { discard, shape: nameLike ? 'name' : 'free_text' });
}

function numericStats(vals: readonly string[], format: TextNumberFormat | undefined): { min: number; max: number; integers: boolean } {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let integers = true;
    for (const v of vals) {
        const n = parseNumberText(v.replace(/%\s*$/, ''), format);
        if (n === null) continue;
        if (n < min) min = n;
        if (n > max) max = n;
        if (!Number.isInteger(n)) integers = false;
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0, integers: true };
    return { min, max, integers };
}

/** Celdas con varias opciones separadas por coma o punto y coma, que se repiten. */
function multiSelectTokens(vals: readonly string[]): { tokens: number; top: Array<{ value: string; count: number }> } | null {
    const withSep = vals.filter((v) => /[,;]/.test(v) && !/^\$?\s*[\d.,]+$/.test(v));
    if (withSep.length < Math.max(2, vals.length * 0.25)) return null;
    const tokens = new Map<string, { count: number; forms: Map<string, number> }>();
    let total = 0;
    for (const v of vals) {
        for (const raw of v.split(/[,;]/)) {
            const t = raw.replace(/\s+/g, ' ').trim();
            const k = fold(t);
            if (k === '' || k.length > 40) continue;
            const e = tokens.get(k) ?? { count: 0, forms: new Map<string, number>() };
            e.count++;
            e.forms.set(t, (e.forms.get(t) ?? 0) + 1);
            tokens.set(k, e);
            total++;
        }
    }
    if (tokens.size === 0 || tokens.size > 60) return null;
    // Tienen que repetirse: si cada pedazo es único, es una lista de nombres, no opciones.
    if (total < tokens.size * 2) return null;
    const top = [...tokens.values()]
        .sort((a, b) => b.count - a.count)
        .map((e) => ({ value: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0]![0], count: e.count }));
    return { tokens: tokens.size, top };
}

function rowNumberDiscard(vals: readonly string[]): string | undefined {
    const nums = vals.map((v) => Number(digitsOnly(v)));
    let sequential = 0;
    for (let i = 1; i < nums.length; i++) if (nums[i]! - nums[i - 1]! === 1) sequential++;
    return sequential >= (nums.length - 1) * 0.9 ? 'Es el número de fila de otro sistema: la app le pone su propio número a cada registro.' : undefined;
}

/** Vacía casi siempre, igual en todas las filas o una columna sin nombre con poco. */
function discardReason(header: string, h: string, vals: readonly string[], filled: number, distinct: number, rows: number, _opts: ProfileOptions): string | undefined {
    if (rows >= 20 && filled / rows < 0.03) return `Está vacía en el ${Math.round((1 - filled / rows) * 100)} % de las filas.`;
    if (rows >= 5 && distinct === 1 && filled === rows) return `Tiene el mismo valor en todas las filas («${String(vals[0]).slice(0, 40)}»).`;
    if (/^columna \d+$/.test(h) && filled / Math.max(rows, 1) < 0.2) return 'No tiene nombre y casi no tiene datos.';
    void header;
    return undefined;
}

/** Una columna igual a otra (mismos valores en todas las filas). */
function markDuplicateColumns(columns: FileImportColumnProfile[], values: readonly string[][]): void {
    const sigs = new Map<string, number>();
    columns.forEach((c, i) => {
        if (c.filled === 0) return;
        const sig = values[i]!.join('\u0001');
        const first = sigs.get(sig);
        if (first === undefined) sigs.set(sig, i);
        else if (!c.discard) c.discard = `Repite los datos de la columna «${columns[first]!.header}».`;
    });
}

/** Totales que son la suma o el producto de otras dos columnas (se pueden calcular). */
function markDerivedColumns(columns: FileImportColumnProfile[], values: readonly string[][], format: TextNumberFormat | undefined): void {
    const numeric = columns.filter((c) => (c.detected === 'number' || c.detected === 'currency') && c.filled >= 10).slice(0, 20);
    if (numeric.length < 3) return;
    const parsed = new Map<number, Array<number | null>>();
    for (const c of numeric) parsed.set(c.index, values[c.index]!.map((v) => (v === '' ? null : parseNumberText(v, c.number_format ?? format))));
    for (const target of numeric) {
        if (target.discard) continue;
        const t = parsed.get(target.index)!;
        for (const a of numeric) {
            if (a === target) continue;
            for (const b of numeric) {
                if (b === target || b.index <= a.index) continue;
                const va = parsed.get(a.index)!;
                const vb = parsed.get(b.index)!;
                let checked = 0;
                let sum = 0;
                let prod = 0;
                for (let i = 0; i < t.length; i++) {
                    const x = va[i];
                    const y = vb[i];
                    const z = t[i];
                    if (x == null || y == null || z == null) continue;
                    checked++;
                    if (Math.abs(x + y - z) <= Math.max(1, Math.abs(z) * 0.001)) sum++;
                    if (Math.abs(x * y - z) <= Math.max(1, Math.abs(z) * 0.001)) prod++;
                }
                if (checked < 10) continue;
                if (sum / checked >= 0.95) {
                    target.discard = `Es la suma de «${a.header}» y «${b.header}»: no hace falta guardarla.`;
                    break;
                }
                if (prod / checked >= 0.95) {
                    target.discard = `Es «${a.header}» por «${b.header}»: no hace falta guardarla.`;
                    break;
                }
            }
            if (target.discard) break;
        }
    }
}

// ── Una cosa distinta escondida en la hoja ────────────────────────────────

/**
 * Columnas que identifican OTRA cosa (un cliente, un proveedor, un vendedor)
 * y que arrastran sus propios datos: cada valor de la columna clave tiene
 * siempre el mismo correo, el mismo teléfono, la misma ciudad. Esos datos se
 * pueden mudar a una lista aparte, vinculada.
 */
export function findEntityCandidates(profile: FileImportSheetProfile, rows: readonly (readonly string[])[], titleColumn: number | null): FileImportEntityCandidate[] {
    const n = profile.rows;
    if (n < 6) return [];
    const data = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== '')).slice(0, n);
    const col = (c: number): string[] => data.map((r) => String(r[c] ?? '').trim());
    const keyTypes = new Set<FileImportFieldType>(['text', 'select', 'email']);
    const candidates: Array<FileImportEntityCandidate & { score: number }> = [];

    for (const k of profile.columns) {
        if (k.index === titleColumn || !keyTypes.has(k.detected) || k.discard) continue;
        if (k.filled < n * 0.8) continue;
        const keys = col(k.index).map((v) => fold(v));
        const d = new Set(keys.filter((v) => v !== '')).size;
        if (d < 3 || d > n / 1.5) continue;

        const deps: number[] = [];
        let identifying = false;
        for (const c of profile.columns) {
            if (c.index === k.index || c.index === titleColumn || c.discard) continue;
            if (c.filled < n * 0.3 || c.distinct < 2) continue;
            if (c.detected === 'date' || c.detected === 'datetime' || c.detected === 'long_text') continue;
            const vals = col(c.index);
            const byKey = new Map<string, string>();
            let keysWithValue = 0;
            let consistent = 0;
            const seenKeys = new Set<string>();
            let bad = false;
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i]!;
                const v = fold(vals[i]!);
                if (key === '' || v === '') continue;
                const prev = byKey.get(key);
                if (prev === undefined) byKey.set(key, v);
                else if (prev !== v) bad = true;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    keysWithValue++;
                }
            }
            if (keysWithValue < 2) continue;
            // Consistencia por clave: ninguna clave con dos valores distintos (≥95 % de las claves).
            if (bad) {
                const conflicts = new Map<string, Set<string>>();
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i]!;
                    const v = fold(vals[i]!);
                    if (key === '' || v === '') continue;
                    const s = conflicts.get(key) ?? new Set<string>();
                    s.add(v);
                    conflicts.set(key, s);
                }
                consistent = [...conflicts.values()].filter((s) => s.size === 1).length;
                if (consistent / conflicts.size < 0.95) continue;
            }
            // El valor tiene que depender de la clave, no ser la misma columna escrita distinto.
            const depDistinct = new Set(byKey.values()).size;
            if (depDistinct >= d * 0.6) identifying = true;
            deps.push(c.index);
        }
        if (deps.length === 0 || (!identifying && deps.length < 2)) continue;
        candidates.push({ sheet: profile.index, key_column: k.index, columns: deps, distinct: d, score: deps.length + (identifying ? 2 : 0) });
    }

    // Una columna no puede ser parte de dos entidades; hasta 2 por hoja.
    candidates.sort((a, b) => b.score - a.score);
    const used = new Set<number>();
    const out: FileImportEntityCandidate[] = [];
    for (const c of candidates) {
        if (used.has(c.key_column)) continue;
        const columns = c.columns.filter((x) => !used.has(x) && x !== c.key_column);
        if (columns.length === 0) continue;
        out.push({ sheet: c.sheet, key_column: c.key_column, columns, distinct: c.distinct });
        used.add(c.key_column);
        columns.forEach((x) => used.add(x));
        if (out.length >= 2) break;
    }
    return out;
}

/** Qué parte de los valores de una columna nombra registros de la otra (por su título). */
export function linkMatch(values: readonly string[], titles: readonly string[]): number {
    const target = new Set(titles.map((t) => fold(t)).filter((t) => t !== ''));
    const own = new Set(values.map((v) => fold(v)).filter((v) => v !== ''));
    if (own.size < 2 || target.size === 0) return 0;
    let hit = 0;
    for (const v of own) if (target.has(v)) hit++;
    return hit / own.size;
}

// ── El resumen protegido que ve la IA ─────────────────────────────────────

/**
 * Un valor de ejemplo SIN datos personales: correos, teléfonos, documentos y
 * códigos se cambian por su forma («[correo]», «[número de 10 dígitos]»).
 * Los textos se recortan.
 */
export function maskSample(value: string, shape: FileImportColumnProfile['shape'] | undefined): string {
    const v = value.trim();
    if (shape === 'email' || EMAIL_RE.test(v)) return '[correo]';
    if (shape === 'id') return /^\d+$/.test(v) ? `[número de ${v.length} dígitos]` : `[código de ${v.length} caracteres]`;
    // Nombres de personas, empresas o productos: la IA ve la forma, no el dato.
    if (shape === 'name') return `[texto de ${Array.from(v).length} caracteres]`;
    if (shape === 'phone' || (looksPhone(v) && digitsOnly(v).length >= 9)) return `[teléfono de ${digitsOnly(v).length} dígitos]`;
    if (shape === 'url') {
        const host = /^(?:https?:\/\/)?([^/?#:\s]+)/i.exec(v)?.[1];
        return host ? `[web: ${host.toLowerCase().slice(0, 60)}]` : '[dirección web]';
    }
    // Correos o teléfonos dentro de un texto.
    const masked = v.replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, '[correo]').replace(/\+?\d[\d\s().-]{8,}\d/g, '[número]');
    return masked.slice(0, 40);
}
