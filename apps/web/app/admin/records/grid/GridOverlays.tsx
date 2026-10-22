import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, ClipboardPaste, Info, Loader2, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { CellIssue } from './gridPlan';
import { formatSelectionNumber, shortcutLabel, type GridController, type GridResult, type GridReview } from './useGridController';

/**
 * v0.1.294 — Lo que la tabla muestra ENCIMA de las celdas mientras se usa como
 * hoja de cálculo:
 *  - la revisión ANTES de pegar cuando algo no se puede (qué celdas, por qué),
 *    con la opción de crear las filas que no entran y las opciones que no
 *    existen;
 *  - el detalle de lo que no se pudo después de pegar / rellenar / borrar;
 *  - la barra de la selección (cuántas celdas, suma y promedio, y cómo
 *    copiar, cortar o pegar).
 */
export function GridOverlays({ grid }: { grid: GridController }): JSX.Element {
    return (
        <>
            {grid.review && <ReviewDialog review={grid.review} busy={grid.busy} onCancel={grid.cancelReview} onConfirm={grid.confirmReview} />}
            {grid.result && <ResultDialog result={grid.result} onClose={grid.closeResult} />}
            <SelectionBar grid={grid} />
        </>
    );
}

const MAX_ISSUE_ROWS = 60;

function IssueTable({ issues, rowLabel }: { issues: CellIssue[]; rowLabel: (i: CellIssue) => string }): JSX.Element {
    const shown = issues.slice(0, MAX_ISSUE_ROWS);
    return (
        <div className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border">
            <table className="imcrm-w-full imcrm-text-left imcrm-text-xs" data-testid="imcrm-grid-issues">
                <thead className="imcrm-bg-muted/60 imcrm-text-muted-foreground">
                    <tr>
                        <th className="imcrm-px-2.5 imcrm-py-1.5 imcrm-font-medium">{__('Fila')}</th>
                        <th className="imcrm-px-2.5 imcrm-py-1.5 imcrm-font-medium">{__('Columna')}</th>
                        <th className="imcrm-hidden imcrm-px-2.5 imcrm-py-1.5 imcrm-font-medium sm:imcrm-table-cell">{__('Valor')}</th>
                        <th className="imcrm-px-2.5 imcrm-py-1.5 imcrm-font-medium">{__('Motivo')}</th>
                    </tr>
                </thead>
                <tbody>
                    {shown.map((i, n) => (
                        <tr key={`${i.row}-${i.col}-${n}`} className="imcrm-border-t imcrm-border-border imcrm-align-top">
                            <td className="imcrm-max-w-[10rem] imcrm-truncate imcrm-px-2.5 imcrm-py-1.5 imcrm-font-medium" title={rowLabel(i)}>
                                {rowLabel(i)}
                            </td>
                            <td className="imcrm-px-2.5 imcrm-py-1.5">{i.label}</td>
                            <td className="imcrm-hidden imcrm-max-w-[8rem] imcrm-truncate imcrm-px-2.5 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground sm:imcrm-table-cell" title={i.text}>
                                {i.text ?? ''}
                            </td>
                            <td className="imcrm-px-2.5 imcrm-py-1.5">{i.reason}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {issues.length > MAX_ISSUE_ROWS && (
                <p className="imcrm-border-t imcrm-border-border imcrm-bg-muted/30 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(__('… y %d más'), issues.length - MAX_ISSUE_ROWS)}
                </p>
            )}
        </div>
    );
}

function DialogShell({
    title,
    description,
    icon,
    children,
    footer,
    onClose,
    testId,
    closable = true,
}: {
    title: string;
    description?: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    footer: React.ReactNode;
    onClose: () => void;
    testId: string;
    closable?: boolean;
}): JSX.Element {
    return (
        <Dialog.Root open onOpenChange={(o) => (!o && closable ? onClose() : undefined)}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid={testId}
                    onPointerDownOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => (!closable ? e.preventDefault() : undefined)}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                {icon}
                                {title}
                            </Dialog.Title>
                            {description && (
                                <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">{description}</Dialog.Description>
                            )}
                        </div>
                        {closable && (
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        )}
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-space-y-4 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">{children}</div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {footer}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function ReviewDialog({
    review,
    busy,
    onCancel,
    onConfirm,
}: {
    review: GridReview;
    busy: boolean;
    onCancel: () => void;
    onConfirm: (opts: { createRows: boolean; createOptions: boolean }) => Promise<void>;
}): JSX.Element {
    const { outcome } = review;
    const { plan } = outcome;
    const [createRows, setCreateRows] = useState(true);
    const [createOptions, setCreateOptions] = useState(true);
    const [running, setRunning] = useState(false);
    useEffect(() => setRunning(false), [review]);

    const changes = plan.changes.length + outcome.cutClears.length;
    const rowsTouched = new Set(plan.changes.map((c) => c.recordId)).size;
    const optionsToCreate = review.canCreateOptions && createOptions ? plan.unknownOptions.reduce((n, u) => n + u.labels.length, 0) : 0;
    // Filas nuevas que sólo fallaban por una opción que se va a crear: entran.
    const rescued = new Set<number>();
    if (optionsToCreate > 0) {
        const other = new Map<number, boolean>();
        for (const i of outcome.newRowIssues) {
            if (i.newRow === undefined) continue;
            other.set(i.newRow, (other.get(i.newRow) ?? false) || i.optionFieldId === undefined);
        }
        for (const [r, hasOther] of other) if (!hasOther) rescued.add(r);
    }
    const creatable = outcome.newRows.length + rescued.size;
    const newRows = review.canCreateRows && createRows ? creatable : 0;
    const issues = [
        ...plan.issues,
        ...outcome.cutIssues,
        ...(review.canCreateRows && createRows ? outcome.newRowIssues : []),
    ];
    // Lo que se resuelve creando las opciones no se cuenta como problema.
    const visibleIssues = optionsToCreate > 0 ? issues.filter((i) => i.optionFieldId === undefined) : issues;
    const overflowRows = plan.overflow.length;
    const nothing = changes === 0 && newRows === 0 && optionsToCreate === 0;

    const confirm = async (): Promise<void> => {
        setRunning(true);
        await onConfirm({ createRows, createOptions });
    };

    return (
        <DialogShell
            title={__('Revisa antes de pegar')}
            description={sprintf(
                __('Pegaste un bloque de %1$s × %2$s. Esto es lo que va a pasar:'),
                String(review.inputs.block.length),
                String(Math.max(0, ...review.inputs.block.map((r) => r.length))),
            )}
            icon={<ClipboardPaste className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />}
            onClose={onCancel}
            testId="imcrm-grid-paste-review"
            closable={!running}
            footer={
                <>
                    <Button variant="ghost" onClick={onCancel} disabled={running}>
                        {__('Cancelar')}
                    </Button>
                    <Button onClick={() => void confirm()} disabled={running || busy || nothing} data-testid="imcrm-grid-paste-confirm">
                        {running && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {nothing
                            ? __('No hay nada para pegar')
                            : newRows > 0 && changes > 0
                                ? sprintf(_n('Pegar y crear %d registro', 'Pegar y crear %d registros', newRows), newRows)
                                : newRows > 0
                                    ? sprintf(_n('Crear %d registro', 'Crear %d registros', newRows), newRows)
                                    : __('Pegar')}
                    </Button>
                </>
            }
        >
            <ul className="imcrm-space-y-2 imcrm-text-sm">
                {changes > 0 && (
                    <li className="imcrm-flex imcrm-items-start imcrm-gap-2">
                        <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-emerald-600" aria-hidden />
                        <span>
                            {sprintf(_n('Se va a cambiar %d celda', 'Se van a cambiar %d celdas', plan.changes.length), plan.changes.length)}
                            {rowsTouched > 0 && ` ${sprintf(_n('en %d fila', 'en %d filas', rowsTouched), rowsTouched)}`}
                            {outcome.cutClears.length > 0 && ` · ${sprintf(_n('se vacía %d celda de origen (cortar)', 'se vacían %d celdas de origen (cortar)', outcome.cutClears.length), outcome.cutClears.length)}`}
                            .
                        </span>
                    </li>
                )}
                {plan.unchanged > 0 && (
                    <li className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-muted-foreground">
                        <Info className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                        {sprintf(_n('%d celda ya tenía ese valor.', '%d celdas ya tenían ese valor.', plan.unchanged), plan.unchanged)}
                    </li>
                )}
                {overflowRows > 0 && (
                    <li className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                        {review.canCreateRows && creatable > 0 ? (
                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                                <input
                                    type="checkbox"
                                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                    checked={createRows}
                                    onChange={(e) => setCreateRows(e.target.checked)}
                                    data-testid="imcrm-grid-paste-create-rows"
                                />
                                <span>
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium">
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                        {sprintf(
                                            _n('Crear %d registro nuevo con la fila que no entra', 'Crear %d registros nuevos con las filas que no entran', creatable),
                                            creatable,
                                        )}
                                    </span>
                                    <span className="imcrm-mt-0.5 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                        {sprintf(_n('El bloque tiene %d fila más que las que hay debajo.', 'El bloque tiene %d filas más que las que hay debajo.', overflowRows), overflowRows)}
                                        {overflowRows - creatable > 0 && ` ${sprintf(_n('%d no se puede crear (ver abajo).', '%d no se pueden crear (ver abajo).', overflowRows - creatable), overflowRows - creatable)}`}
                                    </span>
                                </span>
                            </label>
                        ) : (
                            <span className="imcrm-flex imcrm-items-start imcrm-gap-2">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-amber-600" aria-hidden />
                                <span>
                                    {sprintf(_n('%d fila del bloque no entra', '%d filas del bloque no entran', overflowRows), overflowRows)}
                                    {': '}
                                    {review.canCreateRows ? __('y no se puede crear como registro nuevo (el motivo está abajo).') : review.noCreateReason}
                                </span>
                            </span>
                        )}
                    </li>
                )}
                {plan.unknownOptions.length > 0 && (
                    <li className="imcrm-rounded-md imcrm-border imcrm-border-amber-500/40 imcrm-bg-amber-500/5 imcrm-p-3">
                        {review.canCreateOptions ? (
                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                                <input
                                    type="checkbox"
                                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                    checked={createOptions}
                                    onChange={(e) => setCreateOptions(e.target.checked)}
                                    data-testid="imcrm-grid-paste-create-options"
                                />
                                <span>
                                    <span className="imcrm-font-medium">{__('Agregar las opciones que no existen')}</span>
                                    <UnknownList review={review} />
                                </span>
                            </label>
                        ) : (
                            <span>
                                <span className="imcrm-font-medium">{__('Hay valores que no son opciones del campo')}</span>
                                <UnknownList review={review} />
                                <span className="imcrm-mt-1 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Corrige el texto o pídele a un administrador que agregue esas opciones.')}
                                </span>
                            </span>
                        )}
                    </li>
                )}
            </ul>
            {visibleIssues.length > 0 && (
                <div className="imcrm-space-y-2">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                        <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-600" aria-hidden />
                        {sprintf(
                            _n('%d celda no se puede pegar y queda como está:', '%d celdas no se pueden pegar y quedan como están:', visibleIssues.length),
                            visibleIssues.length,
                        )}
                    </p>
                    <IssueTable issues={visibleIssues} rowLabel={review.rowLabel} />
                </div>
            )}
        </DialogShell>
    );
}

function UnknownList({ review }: { review: GridReview }): JSX.Element {
    return (
        <span className="imcrm-mt-1 imcrm-block imcrm-space-y-0.5 imcrm-text-xs">
            {review.outcome.plan.unknownOptions.map((u) => (
                <span key={u.field.id} className="imcrm-block">
                    <span className="imcrm-text-muted-foreground">«{u.field.label}»: </span>
                    {u.labels.slice(0, 12).join(', ')}
                    {u.labels.length > 12 && ` … +${u.labels.length - 12}`}
                </span>
            ))}
        </span>
    );
}

function ResultDialog({ result, onClose }: { result: GridResult; onClose: () => void }): JSX.Element {
    return (
        <DialogShell
            title={result.title}
            description={__('Estas celdas quedaron como estaban. Corrige el valor en la celda o vuelve a pegar.')}
            icon={<AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-600" aria-hidden />}
            onClose={onClose}
            testId="imcrm-grid-result"
            footer={
                <Button onClick={onClose} data-testid="imcrm-grid-result-close">
                    {__('Entendido')}
                </Button>
            }
        >
            <IssueTable issues={result.issues} rowLabel={result.rowLabel} />
        </DialogShell>
    );
}

/** Barra flotante con la selección: cuántas celdas, suma/promedio y los atajos. */
function SelectionBar({ grid }: { grid: GridController }): JSX.Element | null {
    const info = grid.selectionInfo;
    if (!info) return null;
    return (
        <div
            className="imcrm-pointer-events-none imcrm-fixed imcrm-bottom-4 imcrm-left-1/2 imcrm-z-30 imcrm--translate-x-1/2 imcrm-px-3"
            role="status"
            aria-live="polite"
            data-testid="imcrm-grid-selection-bar"
        >
            <div className="imcrm-flex imcrm-max-w-[calc(100vw-2rem)] imcrm-flex-wrap imcrm-items-center imcrm-justify-center imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-popover imcrm-px-4 imcrm-py-1.5 imcrm-text-xs imcrm-shadow-imcrm-md">
                <span className="imcrm-font-medium">{sprintf(_n('%d celda', '%d celdas', info.cells), info.cells)}</span>
                {info.numeric && (
                    <>
                        <span className="imcrm-tabular-nums">
                            {__('Suma')}: <strong>{formatSelectionNumber(info.numeric.sum)}</strong>
                        </span>
                        <span className="imcrm-hidden imcrm-tabular-nums sm:imcrm-inline">
                            {__('Promedio')}: <strong>{formatSelectionNumber(info.numeric.avg)}</strong>
                        </span>
                    </>
                )}
                <span className="imcrm-hidden imcrm-text-muted-foreground md:imcrm-inline">
                    {sprintf(__('%1$s copiar · %2$s cortar · %3$s pegar · clic derecho: más'), shortcutLabel('C'), shortcutLabel('X'), shortcutLabel('V'))}
                </span>
            </div>
        </div>
    );
}
