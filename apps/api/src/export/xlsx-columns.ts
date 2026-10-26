import {
    excelSerialFromCivil,
    formatDuration,
    jsonbKeyForField,
    zonedNowNaive,
    type Field,
    type RecordDto,
    type TenantFormat,
    type XlsxOutCell,
    type XlsxStreamWriter,
} from '@imagina-base/shared';

/**
 * v0.1.299 — Cómo sale cada campo en una planilla de Excel. A diferencia del
 * CSV (todo texto), en el .xlsx cada celda es del TIPO real: un monto es un
 * número con su moneda y sus decimales, una fecha es una fecha de Excel (que
 * se ordena y filtra como fecha), una duración es tiempo (`[h]:mm`, se suma).
 * Lo que una persona lee como texto —la etiqueta de una opción, el nombre de
 * quien está asignado, el título del registro vinculado— sale igual que en el
 * CSV de v0.1.252.
 */

export interface XlsxCellContext {
    format: TenantFormat;
    /** Zona en la que se muestran las fechas y horas (la de la empresa). */
    timeZone: string;
    /** select/multi_select/checkbox/user/file → texto legible (o null si el tipo no tiene). */
    readable(field: Field, value: unknown): string | null;
    /** Ids vinculados → títulos. */
    relationLabels(fieldId: number, value: unknown): string;
    /** Nombre de una persona del workspace (para los lookup hacia un campo persona). */
    userName(id: number): string | null;
}

export interface XlsxColumnPlan {
    header: string;
    field: Field | null;
    cell(r: RecordDto): XlsxOutCell;
    /** Ancho (en caracteres) que necesita una celda de esta columna. */
    width(cell: XlsxOutCell): number;
}

/** Locale de Intl con los separadores de la empresa (igual que la ficha). */
export function numberLocale(format: TenantFormat): string {
    if (format.number_format === 'dot_comma') return 'es-CO';
    if (format.number_format === 'space_comma') return 'fr-FR';
    return 'en-US';
}

function dateCode(format: TenantFormat): string {
    if (format.date_format === 'dmy') return 'dd/mm/yyyy';
    if (format.date_format === 'mdy') return 'mm/dd/yyyy';
    return 'yyyy-mm-dd';
}

function timeCode(format: TenantFormat): string {
    return format.time_format === 'h12' ? 'h:mm AM/PM' : 'hh:mm';
}

/** Código de formato de una moneda, con el símbolo y la posición que usa la ficha. */
export function currencyFormatCode(code: string, precision: number, format: TenantFormat): string {
    const body = `#,##0${precision > 0 ? `.${'0'.repeat(precision)}` : ''}`;
    const quote = (s: string): string => {
        const clean = s.replace(/[\u00a0\u202f]/g, ' ').replace(/"/g, '');
        return clean === '' ? '' : `"${clean}"`;
    };
    try {
        const parts = new Intl.NumberFormat(numberLocale(format), {
            style: 'currency',
            currency: code,
            minimumFractionDigits: precision,
            maximumFractionDigits: precision,
        }).formatToParts(1234.5);
        const isNum = (t: string): boolean => t === 'integer' || t === 'fraction' || t === 'decimal' || t === 'group';
        const first = parts.findIndex((p) => isNum(p.type));
        let last = -1;
        parts.forEach((p, i) => {
            if (isNum(p.type)) last = i;
        });
        if (first === -1) return `${body} ${quote(code)}`;
        const prefix = parts.slice(0, first).filter((p) => p.type !== 'minusSign' && p.type !== 'plusSign').map((p) => p.value).join('');
        const suffix = parts.slice(last + 1).map((p) => p.value).join('');
        return `${quote(prefix)}${body}${quote(suffix)}`;
    } catch {
        return `${body} ${quote(code)}`;
    }
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Arma el plan de columnas (registra sus estilos en el writer: antes de `begin`). */
export function planXlsxColumns(writer: XlsxStreamWriter, fields: Field[], ctx: XlsxCellContext): XlsxColumnPlan[] {
    const dateStyle = writer.style({ numFmt: dateCode(ctx.format) });
    const dateTimeStyle = writer.style({ numFmt: `${dateCode(ctx.format)} ${timeCode(ctx.format)}` });
    const intStyle = writer.style({ numFmt: '#,##0' });
    const durationStyle = writer.style({ numFmt: '[h]:mm' });
    const fracStyles = new Map<number, number>();
    const fracStyle = (p: number): number => {
        const hit = fracStyles.get(p);
        if (hit !== undefined) return hit;
        const s = writer.style({ numFmt: `#,##0.0${'#'.repeat(Math.max(0, p - 1))}` });
        fracStyles.set(p, s);
        return s;
    };
    const pctInt = writer.style({ numFmt: '0%' });
    const pctFrac = new Map<number, number>();
    const pctStyle = (p: number): number => {
        const hit = pctFrac.get(p);
        if (hit !== undefined) return hit;
        const s = writer.style({ numFmt: p > 0 ? `0.${'0'.repeat(p)}%` : '0.0#%' });
        pctFrac.set(p, s);
        return s;
    };
    const currencyStyles = new Map<string, number>();
    const currencyStyle = (code: string, p: number): number => {
        const key = `${code}|${p}`;
        const hit = currencyStyles.get(key);
        if (hit !== undefined) return hit;
        const s = writer.style({ numFmt: currencyFormatCode(code, p, ctx.format) });
        currencyStyles.set(key, s);
        return s;
    };

    // ── Celdas por tipo ─────────────────────────────────────────────────

    const dateCell = (v: unknown): XlsxOutCell => {
        if (typeof v !== 'string') return null;
        const m = YMD.exec(v.trim());
        if (!m) return v.trim() === '' ? null : v;
        const serial = excelSerialFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
        return serial === null ? v : { n: serial, s: dateStyle };
    };
    /** Un instante → reloj de pared de la empresa (Excel no tiene zonas). */
    const dateTimeCell = (v: unknown): XlsxOutCell => {
        if (typeof v !== 'string' || v.trim() === '') return null;
        const ms = Date.parse(v);
        if (Number.isNaN(ms)) return v;
        const wall = zonedNowNaive(ctx.timeZone, new Date(ms));
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(wall);
        if (!m) return v;
        const serial = excelSerialFromCivil(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
        return serial === null ? v : { n: serial, s: dateTimeStyle };
    };
    const numberCell = (v: unknown, precision: number): XlsxOutCell => {
        const n = toNumber(v);
        if (n === null) return textOf(v);
        return { n, s: Number.isInteger(n) || precision === 0 ? intStyle : fracStyle(precision) };
    };
    const looseNumberCell = (v: unknown): XlsxOutCell => {
        const n = toNumber(v);
        if (n === null) return textOf(v);
        return { n, s: Number.isInteger(n) ? intStyle : fracStyle(2) };
    };
    const currencyCell = (v: unknown, field: Pick<Field, 'config'>): XlsxOutCell => {
        const n = toNumber(v);
        if (n === null) return textOf(v);
        const cfg = field.config as { currency?: unknown; precision?: unknown };
        const code = typeof cfg.currency === 'string' && /^[A-Za-z]{3}$/.test(cfg.currency) ? cfg.currency.toUpperCase() : 'COP';
        return { n, s: currencyStyle(code, precisionOf(cfg.precision, 2)) };
    };
    /** Los porcentajes se guardan 0-100; Excel los quiere 0-1 con formato `%`. */
    const percentCell = (v: unknown, field: Pick<Field, 'config'>): XlsxOutCell => {
        const n = toNumber(v);
        if (n === null) return textOf(v);
        const p = precisionOf((field.config as { precision?: unknown }).precision, 0);
        return { n: n / 100, s: Number.isInteger(n) && p === 0 ? pctInt : pctStyle(p) };
    };
    /** Minutos → días de Excel (`[h]:mm` muestra 1:30 y se suma). */
    const durationCell = (v: unknown): XlsxOutCell => {
        const n = toNumber(v);
        if (n === null) return textOf(v);
        return { n: n / 1440, s: durationStyle };
    };
    /** Un tipo que no conoce este plan (uno nuevo): se escribe por la forma del valor. */
    const genericCell = (v: unknown): XlsxOutCell => {
        if (v === null || v === undefined || v === '') return null;
        if (typeof v === 'number') return Number.isFinite(v) ? { n: v } : null;
        if (typeof v === 'boolean') return v ? 'Sí' : 'No';
        if (typeof v === 'string') {
            const s = v.trim();
            if (YMD.test(s)) return dateCell(s);
            if (ISO_INSTANT.test(s)) return dateTimeCell(s);
            return v;
        }
        if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join(', ');
        return JSON.stringify(v);
    };

    /** El valor de UN ítem traído por un lookup, como se lee en la ficha. */
    const lookupItemText = (v: unknown, target: NonNullable<NonNullable<Field['through']>['target_field']> | null): string => {
        if (v === null || v === undefined || v === '') return '';
        switch (target?.type) {
            case 'select':
            case 'multi_select': {
                const opts = optionLabels(target.config);
                return Array.isArray(v) ? v.map((x) => opts.get(String(x)) ?? String(x)).join(', ') : (opts.get(String(v)) ?? String(v));
            }
            case 'checkbox':
                return v === true || v === 1 || v === '1' ? 'Sí' : 'No';
            case 'user': {
                const id = Number(v);
                return Number.isInteger(id) ? (ctx.userName(id) ?? String(v)) : String(v);
            }
            case 'duration':
                return formatDuration(v);
            default:
                return typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
    };

    // ── Plan por campo ──────────────────────────────────────────────────

    return fields.map((field): XlsxColumnPlan => {
        const key = jsonbKeyForField(field.id);
        const raw = (r: RecordDto): unknown => r.data[key];
        const numericWidth = numericWidthFor(field, ctx.format);
        const plan = (cell: (r: RecordDto) => XlsxOutCell): XlsxColumnPlan => ({
            header: field.label,
            field,
            // Fórmulas (A1): una fila donde la fórmula dio error dice «#ERROR».
            cell: (r) => (r.formula_errors?.[key] ? '#ERROR' : cell(r)),
            width: (c) => widthOf(c, numericWidth),
        });
        switch (field.type) {
            case 'number':
                return plan((r) => numberCell(raw(r), precisionOf((field.config as { precision?: unknown }).precision, 0)));
            case 'currency':
                return plan((r) => currencyCell(raw(r), field));
            case 'percent':
                return plan((r) => percentCell(raw(r), field));
            case 'rating':
                return plan((r) => looseNumberCell(raw(r)));
            case 'duration':
            case 'time_tracked':
                return plan((r) => durationCell(raw(r)));
            case 'date':
                return plan((r) => dateCell(raw(r)));
            case 'datetime':
            case 'created_at': // v0.1.300 — «Fecha de creación» / «Última modificación».
            case 'updated_at':
                return plan((r) => dateTimeCell(raw(r)));
            case 'select':
            case 'multi_select':
            case 'approval': // C5 — el estado con su etiqueta.
            case 'checkbox':
            case 'user':
            case 'created_by': // v0.1.300 — «Creado por» / «Modificado por»: el nombre (0 = Sistema).
            case 'updated_by':
            case 'file':
                return plan((r) => {
                    const v = raw(r);
                    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                    return ctx.readable(field, v) ?? genericCell(v);
                });
            case 'relation':
                return plan((r) => ctx.relationLabels(field.id, r.relations?.[key]) || null);
            case 'url':
                return plan((r) => {
                    const v = raw(r);
                    if (typeof v !== 'string' || v.trim() === '') return null;
                    return { text: v, link: v };
                });
            case 'email':
                return plan((r) => {
                    const v = raw(r);
                    if (typeof v !== 'string' || v.trim() === '') return null;
                    return { text: v, link: `mailto:${v.trim()}` };
                });
            case 'computed':
                return plan((r) => {
                    const v = raw(r);
                    const op = (field.config as { operation?: unknown }).operation;
                    if (typeof v === 'number' && (op === 'date_diff_days' || op === 'date_diff_months')) return { n: v, s: intStyle };
                    return typeof v === 'number' ? looseNumberCell(v) : genericCell(v);
                });
            case 'rollup': {
                const target = field.through?.target_field ?? null;
                const op = (field.config as { operation?: unknown }).operation;
                return plan((r) => {
                    const v = raw(r);
                    if (v === null || v === undefined || v === '') return null;
                    if (op === 'count') return { n: Number(v), s: intStyle };
                    switch (target?.type) {
                        case 'currency':
                            return currencyCell(v, target);
                        case 'number':
                            return numberCell(v, Math.max(2, precisionOf((target.config as { precision?: unknown }).precision, 0)));
                        case 'percent':
                            return percentCell(v, target);
                        case 'duration':
                            return durationCell(v);
                        case 'date':
                            return dateCell(v);
                        case 'datetime':
                            return dateTimeCell(v);
                        default:
                            return typeof v === 'number' ? looseNumberCell(v) : genericCell(v);
                    }
                });
            }
            case 'lookup': {
                const target = field.through?.target_field ?? null;
                return plan((r) => {
                    const v = raw(r);
                    const items = (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined && x !== '');
                    if (items.length === 0) return null;
                    // Un solo valor del otro lado conserva su tipo (un monto se
                    // sigue sumando); varios se listan como texto.
                    if (items.length === 1) {
                        const only = items[0];
                        switch (target?.type) {
                            case 'currency':
                                return currencyCell(only, target);
                            case 'number':
                                return numberCell(only, precisionOf((target.config as { precision?: unknown }).precision, 0));
                            case 'percent':
                                return percentCell(only, target);
                            case 'date':
                                return dateCell(only);
                            case 'datetime':
                                return dateTimeCell(only);
                            case 'duration':
                                return durationCell(only);
                        }
                    }
                    return items.map((x) => lookupItemText(x, target)).filter((s) => s !== '').join(', ') || null;
                });
            }
            case 'text':
            case 'long_text':
            case 'phone':
            case 'ai':
            case 'autonumber':
                return plan((r) => {
                    const v = raw(r);
                    return v === null || v === undefined || v === '' ? null : String(v);
                });
            default:
                return plan((r) => genericCell(raw(r)));
        }
    });
}

/** Columna de un id (el del registro o el de su padre): número sin separadores. */
export function idColumn(header: string, pick: (r: RecordDto) => number | null): XlsxColumnPlan {
    return {
        header,
        field: null,
        cell: (r) => {
            const v = pick(r);
            return v === null ? null : { n: v };
        },
        width: (c) => (c !== null && typeof c === 'object' && 'n' in c ? String(c.n).length : 2),
    };
}

/** Ancho aproximado de una celda tal como se VE (para ajustar la columna). */
function widthOf(c: XlsxOutCell, numericWidth: (n: number) => number): number {
    if (c === null) return 0;
    if (typeof c === 'string') return longestLine(c);
    if ('text' in c) return longestLine(c.text);
    return numericWidth(c.n);
}

/** Lo que ocupa un número de esta columna con su formato (fecha, moneda, %…). */
function numericWidthFor(field: Field, format: TenantFormat): (n: number) => number {
    const target = field.type === 'rollup' || field.type === 'lookup' ? (field.through?.target_field?.type ?? 'number') : field.type;
    switch (target) {
        case 'date':
            return () => 10;
        case 'datetime':
            return () => (format.time_format === 'h12' ? 19 : 16);
        case 'duration':
        case 'time_tracked':
            return (n) => formatDuration(n * 1440).length + 1;
        case 'percent':
            return (n) => plainWidth(n * 100, format) + 2;
        case 'currency':
            return (n) => plainWidth(n, format) + 6;
        default:
            return (n) => plainWidth(n, format) + 1;
    }
}

function plainWidth(n: number, format: TenantFormat): number {
    try {
        return new Intl.NumberFormat(numberLocale(format), { maximumFractionDigits: 2 }).format(n).length;
    } catch {
        return String(n).length;
    }
}

function longestLine(s: string): number {
    let max = 0;
    for (const line of s.split('\n')) max = Math.max(max, line.length);
    return max;
}

function toNumber(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

function textOf(v: unknown): XlsxOutCell {
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function precisionOf(raw: unknown, fallback: number): number {
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.min(10, Math.floor(raw)) : fallback;
}

function optionLabels(config: Record<string, unknown>): Map<string, string> {
    const out = new Map<string, string>();
    const opts = config.options;
    if (!Array.isArray(opts)) return out;
    for (const o of opts as Array<{ value?: unknown; label?: unknown }>) {
        if (typeof o?.value === 'string') out.set(o.value, typeof o.label === 'string' && o.label !== '' ? o.label : o.value);
    }
    return out;
}
