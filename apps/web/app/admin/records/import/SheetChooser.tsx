import { useState } from 'react';
import { EyeOff, FileSpreadsheet, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import type { PendingBook, XlsxImportNotes } from './useSpreadsheetFile';

/**
 * v0.1.299 — El libro trae varias hojas: ¿cuál se importa? Arranca marcada la
 * que estaba abierta al guardar el archivo. Las ocultas se listan (a veces
 * los datos están ahí) con su aviso.
 */
export function SheetChooser({
    book,
    busy,
    onChoose,
    onCancel,
}: {
    book: PendingBook;
    busy: boolean;
    onChoose: (index: number) => void;
    onCancel: () => void;
}): JSX.Element {
    const [selected, setSelected] = useState(book.defaultSheet);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-sheet-chooser">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <FileSpreadsheet className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                <span className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium">{book.fileName}</span>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('El libro tiene %d hojas. Elige la que quieres importar:'), book.sheets.length)}
            </p>
            <div role="radiogroup" aria-label={__('Hojas del libro')} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {book.sheets.map((s) => (
                    <label
                        key={s.index}
                        className={cn(
                            'imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                            selected === s.index ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent',
                        )}
                    >
                        <input
                            type="radio"
                            name="imcrm-sheet"
                            checked={selected === s.index}
                            onChange={() => setSelected(s.index)}
                        />
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-font-medium">{s.name}</span>
                        {s.hidden && (
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                <EyeOff className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                {__('oculta')}
                            </span>
                        )}
                        {s.rowsHint !== null && s.rowsHint > 1 && (
                            <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(_n('~%s fila', '~%s filas', s.rowsHint - 1), formatNumber(s.rowsHint - 1))}
                            </span>
                        )}
                    </label>
                ))}
            </div>
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                    {__('Elegir otro archivo')}
                </Button>
                <Button type="button" onClick={() => onChoose(selected)} disabled={busy} className="imcrm-gap-2" data-testid="imcrm-sheet-use">
                    {busy && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                    {__('Usar esta hoja')}
                </Button>
            </div>
        </div>
    );
}

/** Lo que conviene saber de la hoja que se está importando. */
export function XlsxNotesBanner({ notes }: { notes: XlsxImportNotes }): JSX.Element {
    const items: string[] = [];
    if (notes.truncated) {
        items.push(
            sprintf(
                __('La hoja tiene %1$s filas y se importan las primeras %2$s. Para el resto, divide el archivo en partes.'),
                formatNumber(notes.totalRows),
                formatNumber(notes.importedRows),
            ),
        );
    }
    if (notes.skippedTopRows > 0) {
        items.push(
            sprintf(
                _n(
                    'Se saltó %d fila de arriba que no es parte de la tabla (un título): la cabecera es la primera fila completa.',
                    'Se saltaron %d filas de arriba que no son parte de la tabla (un título): la cabecera es la primera fila completa.',
                    notes.skippedTopRows,
                ),
                notes.skippedTopRows,
            ),
        );
    }
    if (notes.formulasWithoutValue > 0) {
        items.push(
            sprintf(
                _n(
                    '%d fórmula no tenía un resultado guardado y quedó vacía: abre el archivo en Excel, guárdalo y vuelve a subirlo.',
                    '%d fórmulas no tenían un resultado guardado y quedaron vacías: abre el archivo en Excel, guárdalo y vuelve a subirlo.',
                    notes.formulasWithoutValue,
                ),
                notes.formulasWithoutValue,
            ),
        );
    }
    if (notes.errorCells > 0) {
        items.push(
            sprintf(
                _n('%d celda con error (#N/A, #DIV/0!…) quedó vacía.', '%d celdas con error (#N/A, #DIV/0!…) quedaron vacías.', notes.errorCells),
                notes.errorCells,
            ),
        );
    }
    if (notes.colsTruncated) items.push(__('Se leyeron las primeras 500 columnas de la hoja.'));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="imcrm-xlsx-notes">
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-foreground">
                <FileSpreadsheet className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden />
                {notes.sheetCount > 1 ? sprintf(__('Hoja «%s»'), notes.sheetName) : notes.sheetName}
                <span className="imcrm-font-normal imcrm-text-muted-foreground">
                    · {sprintf(_n('%s fila', '%s filas', notes.importedRows), formatNumber(notes.importedRows))}
                </span>
            </span>
            {items.map((t) => (
                <span key={t} className="imcrm-text-muted-foreground">
                    {t}
                </span>
            ))}
        </div>
    );
}
