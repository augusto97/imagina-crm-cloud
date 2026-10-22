import type { ReportFormat, WidgetReport } from './report';

/**
 * v0.1.292 — Los datos de un widget como CSV para abrir en Excel o Google
 * Sheets.
 *
 * Decisión de formato: las ETIQUETAS van legibles (la opción, la persona, el
 * mes) y los NÚMEROS van crudos — sin separador de miles ni símbolo de
 * moneda — para que la planilla los reconozca como números y se puedan sumar
 * u ordenar. Lo que sí sigue al formato regional de la empresa es el
 * separador DECIMAL y, con él, el de columnas: con «1,234.56» se usa coma
 * entre columnas y punto decimal; con «1.234,56» o «1 234,56», punto y coma
 * entre columnas y coma decimal (lo que espera Excel en esos idiomas, si no
 * abre todo en una sola columna). Una duración viaja en minutos y un
 * porcentaje como su número (25 = 25 %); un mínimo/máximo de fecha, en ISO.
 *
 * Lleva BOM UTF-8 (sin él Excel muestra mal los acentos) y neutraliza las
 * celdas que empiezan con `=`, `+`, `-`, `@` (SEC-25): una etiqueta viene de
 * los datos y no puede convertirse en una fórmula al abrir el archivo.
 */

export interface CsvDialect {
    delimiter: ',' | ';';
    decimal: '.' | ',';
}

export function csvDialect(format: Pick<ReportFormat, 'number_format'>): CsvDialect {
    return format.number_format === 'comma_dot' ? { delimiter: ',', decimal: '.' } : { delimiter: ';', decimal: ',' };
}

/** Celda de texto sin riesgo de fórmula (un número con signo no es fórmula). */
export function csvSafeText(cell: string): string {
    if (!/^[=+\-@\t\r]/.test(cell)) return cell;
    if (/^[+-][\d\s().,-]*$/.test(cell)) return cell;
    return `'${cell}`;
}

type Cell = string | number | null | undefined;

function numberCell(n: number, d: CsvDialect): string {
    if (!Number.isFinite(n)) return '';
    // Hasta 6 decimales, sin ceros de relleno ni notación científica.
    const fixed = (Math.round(n * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, '');
    return d.decimal === ',' ? fixed.replace('.', ',') : fixed;
}

function encodeCell(cell: Cell, d: CsvDialect): string {
    if (cell === null || cell === undefined) return '';
    const raw = typeof cell === 'number' ? numberCell(cell, d) : csvSafeText(cell);
    if (raw.includes(d.delimiter) || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
}

function csv(rows: Cell[][], d: CsvDialect): string {
    return `\uFEFF${rows.map((r) => r.map((c) => encodeCell(c, d)).join(d.delimiter)).join('\r\n')}\r\n`;
}

/** Un valor del reporte: el número si lo es; si no, su texto (fechas ISO). */
const valueCell = (value: number | string | null, text: string): Cell => (typeof value === 'number' ? value : value ?? (text === '—' ? '' : text));

export function widgetReportCsv(report: WidgetReport, format: Pick<ReportFormat, 'number_format'>): string {
    const d = csvDialect(format);
    switch (report.kind) {
        case 'kpi': {
            const rows: Cell[][] = [['Indicador', 'Valor'], [report.title, valueCell(report.value, report.valueText)]];
            if (report.goal) {
                rows.push(['Meta', report.goal.value]);
                rows.push(['Avance (%)', Math.round(report.goal.pct * 10) / 10]);
            }
            if (report.delta) {
                rows.push([`Período anterior (${report.delta.periodDays} días)`, valueCell(report.delta.previous, report.delta.previousText)]);
                if (report.delta.pct !== null) rows.push(['Variación (%)', Math.round(report.delta.pct * 10) / 10]);
            }
            return csv(rows, d);
        }
        case 'categories':
            return csv([[report.dimension, report.metricName], ...report.rows.map((r) => [r.label, valueCell(r.raw, r.text)])], d);
        case 'stacked': {
            const header: Cell[] = [report.dimension, ...report.series.map((s) => s.label), 'Total'];
            const body = report.groups.map((g) => [g.label, ...g.values, g.total]);
            return csv([header, ...body], d);
        }
        case 'table':
            return csv([report.columns, ...report.rawRows], d);
        case 'pivot': {
            const corner = [report.rowHeader, report.colHeader].filter(Boolean).join(' \\ ');
            const header: Cell[] = [corner || report.metricName, ...report.cols.map((c) => c.label), 'Total'];
            const body: Cell[][] = report.rows.map((r) => [r.label, ...r.cells.map((c) => valueCell(c.value, c.text)), valueCell(r.total, r.totalText)]);
            const footer: Cell[] = ['Total', ...report.cols.map((c) => valueCell(c.total, c.totalText)), valueCell(report.total, report.totalText)];
            return csv([header, ...body, footer], d);
        }
    }
}
