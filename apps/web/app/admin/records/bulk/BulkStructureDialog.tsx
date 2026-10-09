import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Copy, CornerDownRight, Loader2, Trash2, Undo2, X } from 'lucide-react';
import type { BulkEditTarget, BulkStructureAction, BulkStructurePreview, BulkStructureResult } from '@imagina-base/shared';

import { RelationChip, RelationSearch } from '@/components/fields/RelationPicker';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { BulkApplyProgress } from '@/hooks/useBulkEdit';
import { useBulkStructureApply, useBulkStructurePreview } from '@/hooks/useBulkStructure';
import { useRelationTitles } from '@/hooks/useRelationTitles';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FilterTree } from '@/types/record';

import { isEmptyTree } from '../filterTree';

import { ScopeChip } from './BulkEditDialog';
import { BulkRevertDialog } from './BulkRevertDialog';

interface BulkStructureDialogProps {
    /** Qué acción abrió el diálogo (null = cerrado). */
    action: BulkStructureAction | null;
    onClose: () => void;
    listId: number;
    selectedIds: number[];
    filterTree: FilterTree;
    search: string;
    matchingCount: number | null;
    /** Puede actuar por filtro (capability `bulk_actions`). */
    canActMatching: boolean;
    /** Arranca sobre «todo lo que coincide» (abierto desde Personalizar vista). */
    preferMatching?: boolean;
    onDone?: () => void;
}

type Phase = 'edit' | 'preview' | 'applying' | 'done';

const META: Record<BulkStructureAction, { title: string; icon: typeof Copy }> = {
    move: { title: __('Mover como subtareas'), icon: CornerDownRight },
    duplicate: { title: __('Duplicar registros'), icon: Copy },
    delete: { title: __('Eliminar registros'), icon: Trash2 },
};

/**
 * Acciones de ESTRUCTURA en lote (v0.1.220): mover como subtareas de otro
 * registro (o sacarlas al primer nivel), duplicar (con o sin sus subtareas) y
 * eliminar — sobre la selección o todo lo que coincide con la vista. Vista
 * previa con lo que se toca y lo que no se puede, aplicación en tandas con
 * avance, y «Deshacer» al terminar (el borrado es suave: vuelve entero).
 */
export function BulkStructureDialog({
    action,
    onClose,
    listId,
    selectedIds,
    filterTree,
    search,
    matchingCount,
    canActMatching,
    preferMatching,
    onDone,
}: BulkStructureDialogProps): JSX.Element | null {
    const open = action !== null;
    const [scope, setScope] = useState<'selection' | 'matching'>('selection');
    const [phase, setPhase] = useState<Phase>('edit');
    const [parentId, setParentId] = useState<number | null>(null);
    const [includeSubtasks, setIncludeSubtasks] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<BulkStructurePreview | null>(null);
    const [progress, setProgress] = useState<BulkApplyProgress | null>(null);
    const [result, setResult] = useState<BulkStructureResult | null>(null);
    const [undoOpen, setUndoOpen] = useState(false);
    const previewM = useBulkStructurePreview(listId);
    const applyM = useBulkStructureApply(listId);

    useEffect(() => {
        if (!open) return;
        setScope(selectedIds.length > 0 && !preferMatching ? 'selection' : 'matching');
        setPhase('edit');
        setParentId(null);
        setIncludeSubtasks(true);
        setError(null);
        setPreview(null);
        setProgress(null);
        setResult(null);
        setUndoOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, action]);

    if (!action) return null;
    const meta = META[action];
    const Icon = meta.icon;

    const target: BulkEditTarget =
        scope === 'selection'
            ? { ids: selectedIds }
            : {
                  ...(isEmptyTree(filterTree) ? {} : { filter_tree: filterTree as never }),
                  ...(search.trim() !== '' ? { search: search.trim() } : {}),
                  include_subtasks: false,
              };
    const body = {
        ...(action === 'move' ? { parent_id: parentId } : {}),
        include_subtasks: action === 'duplicate' ? includeSubtasks : false,
    };

    const runPreview = async (): Promise<void> => {
        setError(null);
        try {
            setPreview(await previewM.mutateAsync({ action, target, ...body }));
            setPhase('preview');
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'));
        }
    };

    const runApply = async (): Promise<void> => {
        if (!preview) return;
        setPhase('applying');
        const res = await applyM.mutateAsync({ action, ids: preview.ids, ...body, onProgress: setProgress });
        setResult(res);
        setPhase('done');
        onDone?.();
    };

    const scopeCount = scope === 'selection' ? selectedIds.length : matchingCount;
    const applyLabel = (n: number): string =>
        action === 'delete'
            ? sprintf(_n('Eliminar %s registro', 'Eliminar %s registros', n), formatNumber(n))
            : action === 'duplicate'
              ? sprintf(_n('Duplicar %s registro', 'Duplicar %s registros', n), formatNumber(n))
              : sprintf(_n('Mover %s registro', 'Mover %s registros', n), formatNumber(n));

    return (
        <Dialog.Root open onOpenChange={(o) => (!o && phase !== 'applying' ? onClose() : undefined)}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-bulk-structure-dialog"
                    onEscapeKeyDown={(e) => phase === 'applying' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <Icon className={cn('imcrm-h-4 imcrm-w-4', action === 'delete' ? 'imcrm-text-destructive' : 'imcrm-text-primary')} aria-hidden />
                                {meta.title}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {scopeCount !== null
                                    ? sprintf(_n('%s registro', '%s registros', scopeCount), formatNumber(scopeCount))
                                    : __('Todos los registros de la vista')}
                            </Dialog.Description>
                        </div>
                        {phase !== 'applying' && (
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        )}
                    </div>

                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                        {phase === 'edit' && (
                            <div className="imcrm-space-y-4">
                                {(selectedIds.length > 0 || canActMatching) && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2" role="radiogroup" aria-label={__('A qué registros')}>
                                        {selectedIds.length > 0 && (
                                            <ScopeChip
                                                active={scope === 'selection'}
                                                onClick={() => setScope('selection')}
                                                label={sprintf(_n('Los %d seleccionados', 'Los %d seleccionados', selectedIds.length), selectedIds.length)}
                                                testId="imcrm-structure-scope-selection"
                                            />
                                        )}
                                        {canActMatching && (
                                            <ScopeChip
                                                active={scope === 'matching'}
                                                onClick={() => setScope('matching')}
                                                label={
                                                    matchingCount !== null
                                                        ? sprintf(__('Todos los que coinciden con la vista (%s)'), formatNumber(matchingCount))
                                                        : __('Todos los que coinciden con la vista')
                                                }
                                                testId="imcrm-structure-scope-matching"
                                            />
                                        )}
                                    </div>
                                )}

                                {action === 'move' && <ParentChooser listId={listId} parentId={parentId} onChange={setParentId} />}

                                {action === 'duplicate' && (
                                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                                        <input
                                            type="checkbox"
                                            className="imcrm-mt-0.5"
                                            checked={includeSubtasks}
                                            onChange={(e) => setIncludeSubtasks(e.target.checked)}
                                            data-testid="imcrm-structure-include-subtasks"
                                        />
                                        <span>
                                            {__('Duplicar también sus subtareas')}
                                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                                {__('Se copian los datos que se escriben a mano. Los calculados se recalculan solos; los archivos y los vínculos con otras listas no se copian.')}
                                            </span>
                                        </span>
                                    </label>
                                )}

                                {action === 'delete' && (
                                    <p className="imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Las subtareas se van con su registro. Puedes deshacerlo desde el historial de ediciones masivas: los registros vuelven enteros, con sus subtareas y vínculos.')}
                                    </p>
                                )}

                                {error && (
                                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                        {error}
                                    </p>
                                )}
                            </div>
                        )}

                        {phase === 'preview' && preview && <PreviewPanel action={action} preview={preview} />}

                        {phase === 'applying' && (
                            <div className="imcrm-py-8 imcrm-text-center" aria-live="polite">
                                <Loader2 className="imcrm-mx-auto imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-primary" />
                                <p className="imcrm-mt-3 imcrm-text-sm">
                                    {progress
                                        ? sprintf(__('Aplicando… %1$s de %2$s'), formatNumber(progress.done), formatNumber(progress.total))
                                        : __('Aplicando…')}
                                </p>
                                <div className="imcrm-mx-auto imcrm-mt-3 imcrm-h-2 imcrm-max-w-sm imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                    <div
                                        className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all"
                                        style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {phase === 'done' && result && <ResultPanel action={action} result={result} />}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {phase === 'edit' && (
                            <>
                                <Button variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                <Button
                                    onClick={() => void runPreview()}
                                    disabled={previewM.isPending || (scope === 'selection' && selectedIds.length === 0)}
                                    data-testid="imcrm-structure-preview-btn"
                                >
                                    {previewM.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : null}
                                    {__('Ver vista previa')}
                                </Button>
                            </>
                        )}
                        {phase === 'preview' && preview && (
                            <>
                                <Button variant="ghost" onClick={() => setPhase('edit')}>
                                    {__('Volver')}
                                </Button>
                                <Button
                                    variant={action === 'delete' ? 'destructive' : 'default'}
                                    onClick={() => void runApply()}
                                    disabled={preview.ids.length === 0}
                                    data-testid="imcrm-structure-apply-btn"
                                >
                                    {preview.ids.length === 0 ? __('No hay nada que hacer') : applyLabel(preview.ids.length)}
                                </Button>
                            </>
                        )}
                        {phase === 'done' && result?.edit_id && result.succeeded.length > 0 && (
                            <Button variant="outline" onClick={() => setUndoOpen(true)} data-testid="imcrm-structure-undo-btn">
                                <Undo2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Deshacer')}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={onClose} data-testid="imcrm-structure-close-btn">
                                {__('Listo')}
                            </Button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
            {undoOpen && result?.edit_id && (
                <BulkRevertDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) {
                            setUndoOpen(false);
                            onClose();
                        }
                    }}
                    listId={listId}
                    editId={result.edit_id}
                    summary={meta.title}
                />
            )}
        </Dialog.Root>
    );
}

/** Bajo qué registro (de primer nivel) quedan, o «al primer nivel». */
function ParentChooser({ listId, parentId, onChange }: { listId: number; parentId: number | null; onChange: (id: number | null) => void }): JSX.Element {
    const [open, setOpen] = useState(false);
    const titles = useRelationTitles(listId, parentId !== null ? [parentId] : []);
    const label = parentId !== null ? (titles.data?.[parentId] || `#${parentId}`) : null;
    return (
        <div className="imcrm-space-y-2">
            <p className="imcrm-text-sm imcrm-font-medium">{__('¿Debajo de qué registro?')}</p>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="imcrm-flex imcrm-min-h-8 imcrm-min-w-[14rem] imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent/40"
                            data-testid="imcrm-structure-parent"
                        >
                            {label ? <RelationChip label={label} /> : <span className="imcrm-text-muted-foreground">{__('Elegir un registro…')}</span>}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="imcrm-w-80 imcrm-p-0">
                        {open && (
                            <RelationSearch
                                target={listId}
                                selected={parentId !== null ? [parentId] : []}
                                onToggle={(id) => {
                                    onChange(id === parentId ? null : id);
                                    setOpen(false);
                                }}
                            />
                        )}
                    </PopoverContent>
                </Popover>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                    <input type="checkbox" checked={parentId === null} onChange={() => onChange(null)} data-testid="imcrm-structure-top-level" />
                    {__('Sacarlos al primer nivel')}
                </label>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Una subtarea no puede tener subtareas: el padre tiene que ser de primer nivel, y un registro que ya tiene subtareas no se puede mover debajo de otro.')}
            </p>
        </div>
    );
}

function PreviewPanel({ action, preview }: { action: BulkStructureAction; preview: BulkStructurePreview }): JSX.Element {
    return (
        <div className="imcrm-space-y-3" data-testid="imcrm-structure-preview">
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <Stat label={__('Abarcados')} value={preview.total} />
                <Stat label={action === 'delete' ? __('Se eliminan') : action === 'duplicate' ? __('Se duplican') : __('Se mueven')} value={preview.ids.length} tone="primary" testId="imcrm-structure-count" />
                <Stat label={__('No se pueden')} value={preview.error_count} tone={preview.error_count > 0 ? 'warn' : undefined} />
            </div>
            {action === 'move' && (
                <p className="imcrm-text-sm">
                    {preview.parent_title ? sprintf(__('Quedan como subtareas de «%s».'), preview.parent_title) : __('Quedan en el primer nivel.')}
                    {preview.unchanged > 0 && ' ' + sprintf(_n('%d ya estaba ahí.', '%d ya estaban ahí.', preview.unchanged), preview.unchanged)}
                </p>
            )}
            {preview.subtasks > 0 && (
                <p className="imcrm-text-sm">
                    {action === 'delete'
                        ? sprintf(_n('Se va también %s subtarea.', 'Se van también %s subtareas.', preview.subtasks), formatNumber(preview.subtasks))
                        : sprintf(_n('Se copia también %s subtarea.', 'Se copian también %s subtareas.', preview.subtasks), formatNumber(preview.subtasks))}
                </p>
            )}
            {preview.sample.length > 0 && (
                <ul className="imcrm-max-h-48 imcrm-space-y-1 imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2 imcrm-text-sm">
                    {preview.sample.map((s) => (
                        <li key={s.id} className="imcrm-truncate">
                            {s.title}
                        </li>
                    ))}
                    {preview.ids.length > preview.sample.length && (
                        <li className="imcrm-text-xs imcrm-text-muted-foreground">
                            {sprintf(__('… y %s más'), formatNumber(preview.ids.length - preview.sample.length))}
                        </li>
                    )}
                </ul>
            )}
            {preview.errors.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-amber-500/30 imcrm-bg-amber-500/5 imcrm-p-3">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        <AlertTriangle className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Estos quedan como están:')}
                    </p>
                    <ul className="imcrm-mt-1 imcrm-space-y-0.5 imcrm-text-xs">
                        {preview.errors.map((e) => (
                            <li key={e.id}>
                                <span className="imcrm-font-medium">{e.title}</span> — {e.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function ResultPanel({ action, result }: { action: BulkStructureAction; result: BulkStructureResult }): JSX.Element {
    const n = result.succeeded.length;
    const text =
        action === 'delete'
            ? sprintf(_n('Se eliminó %s registro.', 'Se eliminaron %s registros.', n), formatNumber(n))
            : action === 'duplicate'
              ? sprintf(_n('Se creó %s registro.', 'Se crearon %s registros.', result.created), formatNumber(result.created))
              : sprintf(_n('Se movió %s registro.', 'Se movieron %s registros.', n), formatNumber(n));
    return (
        <div className="imcrm-space-y-3" data-testid="imcrm-structure-result">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <CheckCircle2 className="imcrm-h-5 imcrm-w-5 imcrm-text-emerald-600" aria-hidden />
                {text}
            </p>
            {result.failed.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3">
                    <p className="imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                        {sprintf(_n('%d no se pudo:', '%d no se pudieron:', result.failed.length), result.failed.length)}
                    </p>
                    <ul className="imcrm-mt-1 imcrm-max-h-40 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs">
                        {result.failed.slice(0, 100).map((f) => (
                            <li key={f.id}>
                                #{f.id} — {f.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, tone, testId }: { label: string; value: number; tone?: 'primary' | 'warn'; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</p>
            <p
                className={cn(
                    'imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums',
                    tone === 'primary' && 'imcrm-text-primary',
                    tone === 'warn' && 'imcrm-text-amber-600',
                )}
                data-testid={testId}
            >
                {formatNumber(value)}
            </p>
        </div>
    );
}
