import type { WidgetReport } from './report';
import { widgetReportRows } from './report-csv';
import { uniqueSheetNames, type XlsxBookCell, type XlsxBookSheet } from '../xlsx/workbook';

/**
 * v0.1.464 (J1) — Las hojas del Excel de un informe: una portada («Informe»)
 * con el nombre, el período, la fecha y el índice de bloques, y UNA HOJA POR
 * BLOQUE DE DATOS con las mismas filas que el CSV de un widget (las tablas
 * con sus filas; los gráficos con sus grupos o series y, si comparan, las
 * columnas «Antes» y «Variación (%)»). Un bloque que no se pudo calcular deja
 * su hoja con el motivo.
 */

export interface ReportXlsxEntry {
    title: string;
    /** «Suma · Ventas» (la métrica y la lista). */
    subtitle?: string;
    report: WidgetReport | null;
    /** Motivo si el bloque no se pudo calcular. */
    error?: string | null;
}

export interface ReportXlsxInput {
    name: string;
    /** «Este mes» / «Lo de cada bloque». */
    periodText: string;
    /** «Comparado con el período anterior» o vacío. */
    compareText?: string;
    /** «21/10/2026 08:00». */
    dateText: string;
    entries: ReportXlsxEntry[];
}

export function reportWorkbookSheets(input: ReportXlsxInput): XlsxBookSheet[] {
    const used = input.entries.map((e, i) => e.title.trim() || `Bloque ${i + 1}`);
    // La portada se llama «Informe»: los bloques no pueden repetirla.
    const names = uniqueSheetNames(['Informe', ...used]).slice(1);
    const cover: XlsxBookCell[][] = [
        [input.name],
        ['Período', input.periodText],
        ...(input.compareText ? [['Comparación', input.compareText]] : []),
        ['Generado', input.dateText],
        [],
        ['Hoja', 'Bloque', 'Detalle'],
        ...input.entries.map((e, i) => [names[i] ?? '', e.title, e.error ? `No se pudo calcular: ${e.error}` : e.subtitle ?? '']),
    ];
    const coverHeader = cover.findIndex((r) => r[0] === 'Hoja' && r[1] === 'Bloque');
    const sheets: XlsxBookSheet[] = [{ name: 'Informe', rows: cover, titleRows: [0], headerRows: coverHeader >= 0 ? [coverHeader] : [] }];
    input.entries.forEach((e, i) => {
        const rows: XlsxBookCell[][] = [[e.title || `Bloque ${i + 1}`]];
        if (e.subtitle) rows.push([e.subtitle]);
        rows.push([]);
        if (e.error || !e.report) {
            rows.push([e.error ? `No se pudo calcular: ${e.error}` : 'Sin datos en este período.']);
            sheets.push({ name: names[i] ?? `Bloque ${i + 1}`, rows, titleRows: [0] });
            return;
        }
        const start = rows.length;
        const data = widgetReportRows(e.report);
        rows.push(...data);
        // Encabezados: la primera fila de datos y las que siguen a una fila vacía
        // (los «Totales del período» de una tabla, las etapas del pronóstico).
        const headerRows = [start];
        data.forEach((r, j) => {
            if (j > 0 && data[j - 1]!.length === 0 && r.length > 0) headerRows.push(start + j);
        });
        sheets.push({ name: names[i] ?? `Bloque ${i + 1}`, rows, titleRows: [0], headerRows });
    });
    return sheets;
}
