import { FILE_IMPORT_MAX_SHEETS, FILE_IMPORT_MAX_TOTAL_CHARS, type FileImportSheetInput } from '@imagina-base/shared';

import { getTenantFormat } from '@/lib/tenantFormat';

import { isExcelFile, isUnsupportedExcel } from '../records/import/useSpreadsheetFile';

/**
 * v0.1.339 (ADR-S88) — El archivo que se sube para crear listas, listo para
 * analizar: un CSV es una hoja; un Excel aporta TODAS sus hojas visibles con
 * datos (hasta 5) — así un libro con «Clientes» y «Pedidos» se convierte en
 * dos listas vinculadas. El .xlsx se lee en el navegador (no viaja al
 * servidor): lo que se manda es cada hoja como texto.
 */
export interface PreparedFile {
    fileName: string;
    source: 'csv' | 'xlsx';
    sheets: FileImportSheetInput[];
    /** Lo que conviene saber del archivo (hojas ocultas o de más, filas recortadas). */
    notes: string[];
}

export class PrepareFileError extends Error {}

export async function prepareFile(file: File): Promise<PreparedFile> {
    if (isUnsupportedExcel(file)) {
        throw new PrepareFileError('Ese formato no se puede leer. Ábrelo en Excel (o en Google Sheets) y guárdalo como «Libro de Excel (.xlsx)» o como CSV.');
    }
    if (!isExcelFile(file)) {
        const text = await file.text().catch(() => '');
        if (text.trim() === '') throw new PrepareFileError('El archivo está vacío o no se pudo leer como texto.');
        return checkSize({ fileName: file.name, source: 'csv', sheets: [{ name: '', csv: text }], notes: [] });
    }

    const { openBook } = await import('../records/import/readSpreadsheet');
    const book = await openBook(file);
    const decimal = getTenantFormat().number_format === 'comma_dot' ? '.' : ',';
    const notes: string[] = [];
    const hidden = book.sheets.filter((s) => s.hidden).length;
    if (hidden > 0) notes.push(hidden === 1 ? 'Una hoja oculta no se tuvo en cuenta.' : `${hidden} hojas ocultas no se tuvieron en cuenta.`);

    const sheets: FileImportSheetInput[] = [];
    let skipped = 0;
    for (const info of book.sheets) {
        if (info.hidden) continue;
        const table = book.readTable(info.index, decimal);
        if (table.headers.length === 0 || table.rows.length === 0) continue;
        if (sheets.length >= FILE_IMPORT_MAX_SHEETS) {
            skipped++;
            continue;
        }
        if (table.truncated) notes.push(`La hoja «${table.sheetName}» tiene ${table.totalRows} filas: se toman las primeras ${table.rows.length}.`);
        if (table.formulasWithoutValue > 0) notes.push(`La hoja «${table.sheetName}» tiene fórmulas sin el resultado guardado: ábrela en Excel y vuelve a guardarla para que se lean.`);
        const hints: Record<string, string> = {};
        for (const [col, type] of Object.entries(table.typeHints)) hints[String(col)] = type;
        sheets.push({ name: table.sheetName, csv: table.csv, type_hints: hints });
    }
    if (skipped > 0) notes.push(`Se toman las primeras ${FILE_IMPORT_MAX_SHEETS} hojas con datos; ${skipped === 1 ? 'una quedó afuera' : `${skipped} quedaron afuera`}.`);
    if (sheets.length === 0) throw new PrepareFileError('El archivo no tiene hojas con datos: revisa que la primera fila de la tabla tenga los nombres de las columnas.');
    return checkSize({ fileName: file.name, source: 'xlsx', sheets, notes });
}

function checkSize(p: PreparedFile): PreparedFile {
    const chars = p.sheets.reduce((n, s) => n + s.csv.length, 0);
    if (chars > FILE_IMPORT_MAX_TOTAL_CHARS) {
        throw new PrepareFileError('El archivo es demasiado grande para crear las listas de una vez: divídelo o quita las hojas y columnas que no necesitas.');
    }
    return p;
}
