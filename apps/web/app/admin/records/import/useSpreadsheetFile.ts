import { useCallback, useRef, useState } from 'react';
import type { XlsxSheetInfo } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';

import type { OpenedBook } from './readSpreadsheet';

/**
 * v0.1.299 — El archivo que se sube para importar (o para «actualizar desde un
 * archivo»): un CSV, o una planilla de Excel de la que se elige la hoja.
 * Ambos terminan en lo mismo: el TEXTO que entiende el import, más lo que
 * hay que avisar de la planilla.
 */
export interface PreparedSpreadsheet {
    /** El contenido para el import (la hoja ya convertida, si era Excel). */
    csv: string;
    source: 'csv' | 'xlsx';
    fileName: string;
    /** Sólo Excel. */
    xlsx?: XlsxImportNotes;
}

export interface XlsxImportNotes {
    sheetName: string;
    sheetCount: number;
    /** Filas de datos de la hoja (aunque pasen del tope). */
    totalRows: number;
    /** Filas que entran en esta importación. */
    importedRows: number;
    truncated: boolean;
    skippedTopRows: number;
    formulasWithoutValue: number;
    errorCells: number;
    colsTruncated: boolean;
    /** Índice de columna → tipo de campo que sugieren los formatos de sus celdas. */
    typeHints: Record<number, string>;
}

/** Libro abierto esperando que se elija la hoja. */
export interface PendingBook {
    fileName: string;
    sheets: XlsxSheetInfo[];
    defaultSheet: number;
}

export function isExcelFile(file: File): boolean {
    return /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/** Un .xls (Excel 97-2003) o .xlsm/.xlsb: no se leen, y conviene decir qué hacer. */
export function isUnsupportedExcel(file: File): boolean {
    return /\.(xls|xlsm|xlsb|ods|numbers)$/i.test(file.name);
}

export const SPREADSHEET_ACCEPT = '.csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** El lector de Excel se baja a pedido (y una sola vez): quien importa un CSV no lo paga. */
let readerPromise: Promise<typeof import('./readSpreadsheet')> | null = null;
function loadReader(): Promise<typeof import('./readSpreadsheet')> {
    readerPromise ??= import('./readSpreadsheet').catch((err: unknown) => {
        readerPromise = null;
        throw err;
    });
    return readerPromise;
}

/**
 * Abre el archivo: un CSV va directo a `onReady`; una planilla con UNA hoja
 * también; con varias, queda en `pending` hasta que se elige la hoja.
 */
export function useSpreadsheetFile(onReady: (prepared: PreparedSpreadsheet) => void | Promise<void>) {
    const [pending, setPending] = useState<PendingBook | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const bookRef = useRef<OpenedBook | null>(null);

    const convert = useCallback(
        async (fileName: string, index: number): Promise<void> => {
            const book = bookRef.current;
            if (!book) return;
            setReading(true);
            try {
                const decimal = getTenantFormat().number_format === 'comma_dot' ? '.' : ',';
                const table = book.readTable(index, decimal);
                if (table.headers.length === 0) {
                    setError('La hoja elegida está vacía: elige otra o revisa el archivo.');
                    return;
                }
                setPending(null);
                await onReady({
                    csv: table.csv,
                    source: 'xlsx',
                    fileName,
                    xlsx: {
                        sheetName: table.sheetName,
                        sheetCount: book.sheets.length,
                        totalRows: table.totalRows,
                        importedRows: table.rows.length,
                        truncated: table.truncated,
                        skippedTopRows: table.skippedTopRows,
                        formulasWithoutValue: table.formulasWithoutValue,
                        errorCells: table.errorCells,
                        colsTruncated: table.colsTruncated,
                        typeHints: table.typeHints,
                    },
                });
            } catch (err) {
                setError(err instanceof Error ? err.message : 'No se pudo leer la hoja.');
            } finally {
                setReading(false);
            }
        },
        [onReady],
    );

    const openFile = useCallback(
        async (file: File): Promise<void> => {
            setError(null);
            setPending(null);
            bookRef.current = null;
            if (isUnsupportedExcel(file)) {
                setError('Ese formato no se puede importar. Ábrelo en Excel (o en Google Sheets) y guárdalo como «Libro de Excel (.xlsx)» o como CSV.');
                return;
            }
            if (!isExcelFile(file)) {
                const text = await file.text().catch(() => '');
                if (text === '') {
                    setError('El archivo está vacío o no se pudo leer como texto.');
                    return;
                }
                await onReady({ csv: text, source: 'csv', fileName: file.name });
                return;
            }
            setReading(true);
            try {
                const { openBook } = await loadReader();
                const book = await openBook(file);
                bookRef.current = book;
                // Una sola hoja: directo. Con varias (aunque haya ocultas) se elige.
                if (book.sheets.length === 1) {
                    setReading(false);
                    await convert(file.name, book.defaultSheet);
                    return;
                }
                setPending({ fileName: file.name, sheets: book.sheets, defaultSheet: book.defaultSheet });
            } catch (err) {
                setError(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
            } finally {
                setReading(false);
            }
        },
        [convert, onReady],
    );

    const chooseSheet = useCallback(
        (index: number): Promise<void> => (pending ? convert(pending.fileName, index) : Promise.resolve()),
        [convert, pending],
    );

    const reset = useCallback(() => {
        setPending(null);
        setError(null);
        bookRef.current = null;
    }, []);

    return { pending, error, setError, reading, openFile, chooseSheet, reset };
}

/** El tipo de campo a sugerir: lo que dicen los FORMATOS de la planilla gana a lo que adivina el texto. */
export function mergeTypeHints(suggested: Record<string, string>, notes: XlsxImportNotes | undefined): Record<string, string> {
    if (!notes) return suggested;
    const out = { ...suggested };
    for (const [col, type] of Object.entries(notes.typeHints)) out[col] = type;
    return out;
}

/** Mensaje claro para un archivo que el servidor no acepta por tamaño. */
export function tooLargeMessage(): string {
    return __('El contenido es demasiado grande para enviarlo de una vez. Divide el archivo en partes más pequeñas o quita las columnas que no necesitas.');
}
