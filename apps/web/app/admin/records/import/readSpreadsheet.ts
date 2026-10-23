/**
 * v0.1.299 — Lectura de planillas de Excel EN EL NAVEGADOR (se carga a pedido:
 * quien importa un CSV no baja este código).
 *
 * El .xlsx nunca viaja al servidor: se abre aquí (con los topes de tamaño del
 * lector compartido), la persona elige la hoja y lo que se manda al import es
 * esa hoja convertida a texto — el mismo flujo del CSV, con `source: 'xlsx'`
 * para que el servidor lea los números y las fechas con el formato de la
 * empresa. Un archivo hostil (una bomba de compresión, XML con entidades)
 * sólo puede afectar a la pestaña de quien lo eligió, y aun así se corta.
 */
import {
    XLSX_READ_LIMITS,
    XlsxError,
    openXlsx,
    tableToCsv,
    xlsxSheetToImportTable,
    type XlsxImportTable,
    type XlsxSheetInfo,
    type XlsxWorkbook,
} from '@imagina-base/shared';

export interface OpenedBook {
    sheets: XlsxSheetInfo[];
    defaultSheet: number;
    /** Convierte una hoja a la tabla de texto del import (+ su CSV). */
    readTable(index: number, decimalSeparator: '.' | ','): XlsxImportTable & { csv: string };
}

export async function openBook(file: File): Promise<OpenedBook> {
    if (file.size > XLSX_READ_LIMITS.maxFileBytes) {
        throw new XlsxError(
            'too_large',
            `El archivo pesa ${mb(file.size)} y el máximo para importar es ${mb(XLSX_READ_LIMITS.maxFileBytes)}. Divídelo o quita las hojas que no necesitas.`,
        );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const book: XlsxWorkbook = openXlsx(bytes);
    return {
        sheets: book.sheets,
        defaultSheet: book.defaultSheet,
        readTable(index, decimalSeparator) {
            const table = xlsxSheetToImportTable(book.readSheet(index), {
                decimalSeparator,
                maxRows: XLSX_READ_LIMITS.maxRows,
            });
            return { ...table, csv: tableToCsv(table.headers, table.rows) };
        },
    };
}

function mb(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
