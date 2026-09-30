import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Store, Trash2, Undo2, X } from 'lucide-react';
import {
    storeEditableSlugs,
    type StoreBulkCatalog,
    type StoreBulkOperation,
    type StoreBulkPreview,
    type StoreBulkResult,
    type StoreBulkTarget,
    type StoreListMarker,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { BulkApplyProgress } from '@/hooks/useBulkEdit';
import { useFields } from '@/hooks/useFields';
import { useStoreAttributeTerms, useStoreBulkApply, useStoreBulkCatalog, useStoreBulkPreview } from '@/hooks/useStoreBulk';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FilterTree } from '@/types/record';

import { FilterOptionPicker } from '../FilterOptionPicker';
import { isEmptyTree } from '../filterTree';

import { ScopeChip, Segmented } from './BulkEditDialog';
import { BulkRevertDialog } from './BulkRevertDialog';
import { STORE_OPS, newStoreDraft, storeDraftDefaults, storeDraftToOperation, storeOpMeta, type StoreDraft } from './storeBulkMeta';

interface StoreBulkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    marker: StoreListMarker;
    selectedIds: number[];
    filterTree: FilterTree;
    search: string;
    matchingCount: number | null;
    onDone?: () => void;
}

type Phase = 'edit' | 'preview' | 'applying' | 'done';

/**
 * Edición masiva DE LA TIENDA (v0.1.217) — lo que en WooCommerce se hace con
 * la edición por lotes del panel de productos, pero completo: precios (con
 * porcentajes, redondeo y rebajas programadas), stock, publicación,
 * visibilidad, destacado, categorías, etiquetas, ATRIBUTOS, envío, impuestos y
 * campos de otros plugins. Escribe en la tienda por lotes y lo que la tienda
 * devuelve queda en la lista. Los productos con variaciones se editan en cada
 * variación (el precio de una camiseta está en cada talla).
 */
export function StoreBulkDialog({
    open,
    onOpenChange,
    listId,
    marker,
    selectedIds,
    filterTree,
    search,
    matchingCount,
    onDone,
}: StoreBulkDialogProps): JSX.Element {
    const [drafts, setDrafts] = useState<StoreDraft[]>([newStoreDraft()]);
    const [scope, setScope] = useState<'selection' | 'matching'>(selectedIds.length > 0 ? 'selection' : 'matching');
    const [includeVariations, setIncludeVariations] = useState(true);
    const [phase, setPhase] = useState<Phase>('edit');
    const [formError, setFormError] = useState<string | null>(null);
    const [operations, setOperations] = useState<StoreBulkOperation[]>([]);
    const [preview, setPreview] = useState<StoreBulkPreview | null>(null);
    const [progress, setProgress] = useState<BulkApplyProgress | null>(null);
    const [result, setResult] = useState<StoreBulkResult | null>(null);
    const [undoOpen, setUndoOpen] = useState(false);
    const catalog = useStoreBulkCatalog(listId, open);
    const previewM = useStoreBulkPreview(listId);
    const applyM = useStoreBulkApply(listId);
    const enabledColumns = useMemo(() => new Set(storeEditableSlugs(marker)), [marker]);

    useEffect(() => {
        if (!open) return;
        setDrafts([newStoreDraft()]);
        setScope(selectedIds.length > 0 ? 'selection' : 'matching');
        setIncludeVariations(true);
        setPhase('edit');
        setFormError(null);
        setPreview(null);
        setResult(null);
        setProgress(null);
        setUndoOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const target: StoreBulkTarget =
        scope === 'selection'
            ? { ids: selectedIds }
            : {
                  ...(isEmptyTree(filterTree) ? {} : { filter_tree: filterTree as never }),
                  ...(search.trim() !== '' ? { search: search.trim() } : {}),
              };

    const runPreview = async (): Promise<void> => {
        setFormError(null);
        const ops: StoreBulkOperation[] = [];
        for (const d of drafts) {
            const r = storeDraftToOperation(d);
            if (!r.ok) {
                setFormError(d.op ? `${__(storeOpMeta(d.op).label)}: ${r.error}` : r.error);
                return;
            }
            ops.push(r.operation);
        }
        try {
            const p = await previewM.mutateAsync({ target, operations: ops, include_variations: includeVariations });
            setOperations(ops);
            setPreview(p);
            setPhase('preview');
        } catch (err) {
            setFormError(err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'));
        }
    };

    const runApply = async (): Promise<void> => {
        if (!preview) return;
        setPhase('applying');
        const res = await applyM.mutateAsync({ ids: preview.record_ids, operations, include_variations: includeVariations, onProgress: setProgress });
        setResult(res);
        setPhase('done');
        onDone?.();
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => (phase === 'applying' ? undefined : onOpenChange(o))}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-3xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-store-bulk-dialog"
                    onEscapeKeyDown={(e) => phase === 'applying' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <Store className="imcrm-h-4 imcrm-w-4 imcrm-text-[#7F54B3]" aria-hidden />
                                {__('Editar en la tienda')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(__('Los cambios se hacen en WooCommerce (%s) y quedan en la lista.'), marker.store_name || __('tu tienda'))}
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
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2" role="radiogroup" aria-label={__('A qué productos')}>
                                    {selectedIds.length > 0 && (
                                        <ScopeChip
                                            active={scope === 'selection'}
                                            onClick={() => setScope('selection')}
                                            label={sprintf(_n('El %d seleccionado', 'Los %d seleccionados', selectedIds.length), selectedIds.length)}
                                            testId="imcrm-store-bulk-scope-selection"
                                        />
                                    )}
                                    <ScopeChip
                                        active={scope === 'matching'}
                                        onClick={() => setScope('matching')}
                                        label={
                                            matchingCount !== null
                                                ? sprintf(__('Todos los de la vista (%s)'), formatNumber(matchingCount))
                                                : __('Todos los de la vista')
                                        }
                                        testId="imcrm-store-bulk-scope-matching"
                                    />
                                    <label className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            checked={includeVariations}
                                            onChange={(e) => setIncludeVariations(e.target.checked)}
                                            data-testid="imcrm-store-bulk-variations"
                                        />
                                        {__('Incluir las variaciones de los productos con variaciones')}
                                    </label>
                                </div>
                                {catalog.isLoading && (
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                                        <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                        {__('Leyendo categorías, etiquetas y atributos de la tienda…')}
                                    </p>
                                )}
                                {catalog.isError && (
                                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                        {catalog.error instanceof Error ? catalog.error.message : __('No pudimos leer la tienda.')}
                                    </p>
                                )}
                                <ol className="imcrm-space-y-2.5">
                                    {drafts.map((d, i) => (
                                        <li key={d.key}>
                                            <StoreOpRow
                                                index={i}
                                                draft={d}
                                                listId={listId}
                                                catalog={catalog.data ?? null}
                                                enabledColumns={enabledColumns}
                                                onChange={(next) => setDrafts((all) => all.map((x) => (x.key === d.key ? next : x)))}
                                                onRemove={drafts.length > 1 ? () => setDrafts((all) => all.filter((x) => x.key !== d.key)) : undefined}
                                            />
                                        </li>
                                    ))}
                                </ol>
                                {drafts.length < 15 && (
                                    <button
                                        type="button"
                                        onClick={() => setDrafts((all) => [...all, newStoreDraft()])}
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                        data-testid="imcrm-store-bulk-add-op"
                                    >
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Agregar otro cambio')}
                                    </button>
                                )}
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Cada cambio parte de lo que la tienda tiene en ese momento (no de la copia de la lista). Los precios y el stock de un producto con variaciones se cambian en cada variación.')}
                                </p>
                                {formError && (
                                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                        {formError}
                                    </p>
                                )}
                            </div>
                        )}

                        {phase === 'preview' && preview && <StorePreviewPanel preview={preview} />}

                        {phase === 'applying' && (
                            <div className="imcrm-py-8 imcrm-text-center" aria-live="polite">
                                <Loader2 className="imcrm-mx-auto imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-primary" />
                                <p className="imcrm-mt-3 imcrm-text-sm">
                                    {progress
                                        ? sprintf(__('Escribiendo en la tienda… %1$s de %2$s'), formatNumber(progress.done), formatNumber(progress.total))
                                        : __('Escribiendo en la tienda…')}
                                </p>
                                <div className="imcrm-mx-auto imcrm-mt-3 imcrm-h-2 imcrm-max-w-sm imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                    <div
                                        className="imcrm-h-full imcrm-rounded-full imcrm-bg-[#7F54B3] imcrm-transition-all"
                                        style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                                        data-testid="imcrm-store-bulk-progress"
                                    />
                                </div>
                                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">{__('No cierres esta ventana hasta que termine.')}</p>
                            </div>
                        )}

                        {phase === 'done' && result && <StoreResultPanel result={result} />}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {phase === 'edit' && (
                            <>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                                    {__('Cancelar')}
                                </Button>
                                <Button onClick={() => void runPreview()} disabled={previewM.isPending} data-testid="imcrm-store-bulk-preview-btn">
                                    {previewM.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : null}
                                    {__('Ver vista previa')}
                                </Button>
                            </>
                        )}
                        {phase === 'preview' && preview && (
                            <>
                                <Button variant="ghost" onClick={() => setPhase('edit')}>
                                    {__('Volver a editar')}
                                </Button>
                                <Button onClick={() => void runApply()} disabled={preview.record_ids.length === 0} data-testid="imcrm-store-bulk-apply-btn">
                                    {__('Aplicar en la tienda')}
                                </Button>
                            </>
                        )}
                        {phase === 'done' && result?.edit_id && result.updated > 0 && (
                            <Button variant="outline" onClick={() => setUndoOpen(true)} data-testid="imcrm-store-bulk-undo-btn">
                                <Undo2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Deshacer')}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={() => onOpenChange(false)} data-testid="imcrm-store-bulk-close-btn">
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
                            onOpenChange(false);
                        }
                    }}
                    listId={listId}
                    editId={result.edit_id}
                    summary={__('La edición de la tienda que acabás de aplicar')}
                />
            )}
        </Dialog.Root>
    );
}

// ── Una operación ─────────────────────────────────────────────────────────

function StoreOpRow({
    index,
    draft,
    listId,
    catalog,
    enabledColumns,
    onChange,
    onRemove,
}: {
    index: number;
    draft: StoreDraft;
    listId: number;
    catalog: StoreBulkCatalog | null;
    enabledColumns: Set<string>;
    onChange: (next: StoreDraft) => void;
    onRemove?: () => void;
}): JSX.Element {
    const set = (patch: Partial<StoreDraft>) => onChange({ ...draft, ...patch });
    const groups = [...new Set(STORE_OPS.map((o) => o.group))];
    const meta = draft.op ? storeOpMeta(draft.op) : null;
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid={`imcrm-store-bulk-op-${index}`}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground">
                    {index + 1}
                </span>
                <Select
                    className="imcrm-flex-1"
                    value={draft.op ?? ''}
                    aria-label={__('Qué cambiar')}
                    data-testid={`imcrm-store-bulk-kind-${index}`}
                    onChange={(e) => {
                        const op = (e.target.value || null) as StoreDraft['op'];
                        onChange({ key: draft.key, op, ...(op ? storeDraftDefaults(op) : {}) });
                    }}
                >
                    <option value="">{__('— Qué cambiar —')}</option>
                    {groups.map((g) => (
                        <optgroup key={g} label={__(g)}>
                            {STORE_OPS.filter((o) => o.group === g).map((o) => {
                                const off = !!o.column && !enabledColumns.has(o.column);
                                return (
                                    <option key={o.op} value={o.op} disabled={off}>
                                        {__(o.label)}
                                        {off ? ` — ${__('no habilitada para editar desde la app')}` : ''}
                                    </option>
                                );
                            })}
                        </optgroup>
                    ))}
                </Select>
                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={__('Quitar este cambio')}
                        className="imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </button>
                )}
            </div>
            {meta && (
                <div className="imcrm-mt-2.5 imcrm-space-y-2 imcrm-pl-7">
                    <StoreOpInputs draft={draft} set={set} listId={listId} catalog={catalog} index={index} />
                    {meta.hint && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__(meta.hint)}</p>}
                </div>
            )}
        </div>
    );
}

function StoreOpInputs({
    draft,
    set,
    listId,
    catalog,
    index,
}: {
    draft: StoreDraft;
    set: (patch: Partial<StoreDraft>) => void;
    listId: number;
    catalog: StoreBulkCatalog | null;
    index: number;
}): JSX.Element | null {
    const row = (children: ReactNode) => <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">{children}</div>;
    const num = (key: keyof StoreDraft, placeholder: string, suffix?: string, width = 'imcrm-w-32') => (
        <div className={cn('imcrm-relative', width)}>
            <Input
                inputMode="decimal"
                value={(draft[key] as string | undefined) ?? ''}
                placeholder={placeholder}
                onChange={(e) => set({ [key]: e.target.value })}
                data-testid={`imcrm-store-bulk-${String(key)}-${index}`}
                className={suffix ? 'imcrm-pr-9' : undefined}
            />
            {suffix && (
                <span className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2.5 imcrm-top-1/2 imcrm--translate-y-1/2 imcrm-text-xs imcrm-text-muted-foreground">
                    {suffix}
                </span>
            )}
        </div>
    );
    const pick = (options: Array<{ value: string; label: string }>, testId: string) => (
        <Select value={draft.value ?? ''} onChange={(e) => set({ value: e.target.value })} className="imcrm-w-64" data-testid={testId}>
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </Select>
    );
    const cur = catalog?.currency || '$';

    switch (draft.op) {
        case 'regular_price':
        case 'sale_price': {
            const kinds =
                draft.op === 'sale_price'
                    ? [
                          { value: 'percent_off', label: __('Descuento sobre el precio normal') },
                          { value: 'set', label: __('Poner un precio') },
                          { value: 'percent', label: __('Subir o bajar un %') },
                          { value: 'add', label: __('Sumar') },
                          { value: 'subtract', label: __('Restar') },
                          { value: 'clear', label: __('Quitar la rebaja') },
                      ]
                    : [
                          { value: 'percent', label: __('Subir o bajar un %') },
                          { value: 'set', label: __('Poner un precio') },
                          { value: 'add', label: __('Sumar') },
                          { value: 'subtract', label: __('Restar') },
                      ];
            const kind = draft.kind ?? kinds[0]!.value;
            return (
                <div className="imcrm-space-y-2">
                    {row(
                        <>
                            <Select value={kind} onChange={(e) => set({ kind: e.target.value })} className="imcrm-w-64" data-testid={`imcrm-store-bulk-pricekind-${index}`}>
                                {kinds.map((k) => (
                                    <option key={k.value} value={k.value}>
                                        {k.label}
                                    </option>
                                ))}
                            </Select>
                            {kind === 'percent' && (
                                <Segmented
                                    value={draft.direction === 'down' ? 'down' : 'up'}
                                    onChange={(v) => set({ direction: v as 'up' | 'down' })}
                                    options={[
                                        { value: 'up', label: __('Subir') },
                                        { value: 'down', label: __('Bajar') },
                                    ]}
                                />
                            )}
                            {kind !== 'clear' && num('amount', kind === 'percent' || kind === 'percent_off' ? '10' : '0', kind === 'percent' || kind === 'percent_off' ? '%' : cur)}
                        </>,
                    )}
                    {kind !== 'clear' && (
                        <div className="imcrm-space-y-2">
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                <input type="checkbox" checked={draft.round === true} onChange={(e) => set({ round: e.target.checked })} data-testid={`imcrm-store-bulk-round-${index}`} />
                                {__('Redondear el resultado')}
                            </label>
                            {draft.round &&
                                row(
                                    <>
                                        <Select value={draft.roundMode ?? 'up'} onChange={(e) => set({ roundMode: e.target.value })} className="imcrm-w-40" aria-label={__('Hacia dónde')}>
                                            <option value="up">{__('Hacia arriba')}</option>
                                            <option value="nearest">{__('Al más cercano')}</option>
                                            <option value="down">{__('Hacia abajo')}</option>
                                        </Select>
                                        <span className="imcrm-text-sm">{__('a múltiplos de')}</span>
                                        {num('roundMultiple', '1000', undefined, 'imcrm-w-28')}
                                        <span className="imcrm-text-sm">{__('más')}</span>
                                        {num('roundAdjust', '-100', undefined, 'imcrm-w-28')}
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('(1.000 más −100 = terminados en 900)')}</span>
                                    </>,
                                )}
                        </div>
                    )}
                </div>
            );
        }
        case 'price_from_field':
            return <PriceFromFieldInputs draft={draft} set={set} listId={listId} index={index} num={num} row={row} cur={cur} />;
        case 'sale_dates':
            return row(
                <>
                    <span className="imcrm-text-sm">{__('Desde')}</span>
                    <Input type="date" className="imcrm-w-44" value={draft.from ?? ''} onChange={(e) => set({ from: e.target.value })} />
                    <span className="imcrm-text-sm">{__('hasta')}</span>
                    <Input type="date" className="imcrm-w-44" value={draft.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
                </>,
            );
        case 'stock':
            return row(
                <>
                    <Select value={draft.kind ?? 'add'} onChange={(e) => set({ kind: e.target.value })} className="imcrm-w-48" data-testid={`imcrm-store-bulk-stockkind-${index}`}>
                        <option value="add">{__('Sumar unidades')}</option>
                        <option value="subtract">{__('Restar unidades')}</option>
                        <option value="set">{__('Poner la cantidad')}</option>
                    </Select>
                    {num('amount', '10')}
                </>,
            );
        case 'manage_stock':
        case 'featured':
            return (
                <Segmented
                    value={draft.bool === false ? 'no' : 'yes'}
                    onChange={(v) => set({ bool: v === 'yes' })}
                    options={[
                        { value: 'yes', label: draft.op === 'featured' ? __('Destacar') : __('Sí') },
                        { value: 'no', label: draft.op === 'featured' ? __('Quitar el destacado') : __('No') },
                    ]}
                />
            );
        case 'stock_status':
            return pick(
                [
                    { value: 'instock', label: __('Hay existencias') },
                    { value: 'outofstock', label: __('Agotado') },
                    { value: 'onbackorder', label: __('Se puede reservar') },
                ],
                `imcrm-store-bulk-value-${index}`,
            );
        case 'backorders':
            return pick(
                [
                    { value: 'no', label: __('No permitir') },
                    { value: 'notify', label: __('Permitir, avisando al cliente') },
                    { value: 'yes', label: __('Permitir') },
                ],
                `imcrm-store-bulk-value-${index}`,
            );
        case 'status':
            return pick(
                [
                    { value: 'publish', label: __('Publicado') },
                    { value: 'draft', label: __('Borrador') },
                    { value: 'pending', label: __('Pendiente de revisión') },
                    { value: 'private', label: __('Privado') },
                ],
                `imcrm-store-bulk-value-${index}`,
            );
        case 'catalog_visibility':
            return pick(
                [
                    { value: 'visible', label: __('Tienda y resultados de búsqueda') },
                    { value: 'catalog', label: __('Sólo en la tienda') },
                    { value: 'search', label: __('Sólo en la búsqueda') },
                    { value: 'hidden', label: __('Oculto') },
                ],
                `imcrm-store-bulk-value-${index}`,
            );
        case 'tax_status':
            return pick(
                [
                    { value: 'taxable', label: __('Con impuesto') },
                    { value: 'shipping', label: __('Sólo el envío') },
                    { value: 'none', label: __('Sin impuesto') },
                ],
                `imcrm-store-bulk-value-${index}`,
            );
        case 'tax_class':
            return pick([{ value: '', label: __('Estándar') }, ...(catalog?.tax_classes ?? []).map((t) => ({ value: t.slug, label: t.name }))], `imcrm-store-bulk-value-${index}`);
        case 'shipping_class':
            return pick([{ value: '', label: __('Sin clase de envío') }, ...(catalog?.shipping_classes ?? []).map((t) => ({ value: t.slug, label: t.name }))], `imcrm-store-bulk-value-${index}`);
        case 'low_stock':
            return row(
                <>
                    {num('value', __('vacío = el de la tienda'), undefined, 'imcrm-w-48')}
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('unidades')}</span>
                </>,
            );
        case 'weight':
            return num('value', __('vacío = sin peso'), undefined, 'imcrm-w-48');
        case 'dimensions':
            return row(
                <>
                    {num('length', __('Largo'), undefined, 'imcrm-w-24')}
                    <span className="imcrm-text-muted-foreground">×</span>
                    {num('width', __('Ancho'), undefined, 'imcrm-w-24')}
                    <span className="imcrm-text-muted-foreground">×</span>
                    {num('height', __('Alto'), undefined, 'imcrm-w-24')}
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Lo que dejes vacío no cambia.')}</span>
                </>,
            );
        case 'categories':
        case 'tags': {
            const list = draft.op === 'categories' ? (catalog?.categories ?? []) : (catalog?.tags ?? []);
            return (
                <div className="imcrm-space-y-2">
                    <Segmented
                        value={draft.mode ?? 'add'}
                        onChange={(v) => set({ mode: v as StoreDraft['mode'] })}
                        options={[
                            { value: 'add', label: __('Agregar') },
                            { value: 'remove', label: __('Quitar') },
                            { value: 'replace', label: __('Reemplazar todas') },
                        ]}
                    />
                    <TermPicker
                        options={list.map((t) => ({ value: t.slug, label: t.name }))}
                        values={draft.values ?? []}
                        onChange={(values) => set({ values })}
                        allowNew={draft.mode !== 'remove'}
                        newLabel={draft.op === 'categories' ? __('Nueva categoría…') : __('Nueva etiqueta…')}
                        testId={`imcrm-store-bulk-terms-${index}`}
                    />
                </div>
            );
        }
        case 'attribute':
            return <AttributeInputs draft={draft} set={set} listId={listId} catalog={catalog} index={index} />;
        case 'name':
            return (
                <div className="imcrm-space-y-2">
                    <Segmented
                        value={draft.kind ?? 'append'}
                        onChange={(v) => set({ kind: v })}
                        options={[
                            { value: 'prepend', label: __('Agregar al inicio') },
                            { value: 'append', label: __('Agregar al final') },
                            { value: 'replace', label: __('Buscar y reemplazar') },
                        ]}
                    />
                    {draft.kind === 'replace' ? (
                        row(
                            <>
                                <Input className="imcrm-flex-1" value={draft.find ?? ''} onChange={(e) => set({ find: e.target.value })} placeholder={__('Buscar…')} />
                                <Input className="imcrm-flex-1" value={draft.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder={__('Reemplazar por')} />
                            </>,
                        )
                    ) : (
                        <Input value={draft.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder={__('Texto')} data-testid={`imcrm-store-bulk-text-${index}`} />
                    )}
                </div>
            );
        case 'meta':
            return row(
                <>
                    <Input className="imcrm-w-56" value={draft.metaKey ?? ''} onChange={(e) => set({ metaKey: e.target.value })} placeholder={__('Clave (p. ej. garantia_meses)')} />
                    <Input className="imcrm-flex-1" value={draft.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder={__('Valor (vacío = vaciar)')} />
                </>,
            );
        default:
            return null;
    }
}

/** Tipos de columna de los que se puede sacar un precio (los mismos que acepta el backend). */
const PRICE_SOURCE_TYPES = new Set(['number', 'currency', 'percent', 'computed', 'rollup', 'lookup']);

/**
 * v0.1.223 — «Precio = columna × margen + suma», con redondeo: el costo de
 * cada producto (o de cada variación) sale de una columna de la lista.
 */
function PriceFromFieldInputs({
    draft,
    set,
    listId,
    index,
    num,
    row,
    cur,
}: {
    draft: StoreDraft;
    set: (patch: Partial<StoreDraft>) => void;
    listId: number;
    index: number;
    num: (key: keyof StoreDraft, placeholder: string, suffix?: string, width?: string) => JSX.Element;
    row: (children: ReactNode) => JSX.Element;
    cur: string;
}): JSX.Element {
    const fields = useFields(listId);
    const sources = (fields.data ?? []).filter((f) => PRICE_SOURCE_TYPES.has(f.type));
    return (
        <div className="imcrm-space-y-2">
            {row(
                <>
                    <Select
                        value={draft.price ?? 'regular'}
                        onChange={(e) => set({ price: e.target.value as 'regular' | 'sale' })}
                        className="imcrm-w-44"
                        aria-label={__('Qué precio')}
                    >
                        <option value="regular">{__('Precio normal')}</option>
                        <option value="sale">{__('Precio rebajado')}</option>
                    </Select>
                    <span className="imcrm-text-sm">=</span>
                    <Select
                        value={draft.sourceFieldId ? String(draft.sourceFieldId) : ''}
                        onChange={(e) => set({ sourceFieldId: e.target.value === '' ? null : Number(e.target.value) })}
                        className="imcrm-w-48"
                        aria-label={__('Columna')}
                        data-testid={`imcrm-store-bulk-source-${index}`}
                    >
                        <option value="">{__('— Columna —')}</option>
                        {sources.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                    <span className="imcrm-text-sm">×</span>
                    {num('factor', '1,3', undefined, 'imcrm-w-24')}
                    <span className="imcrm-text-sm">+</span>
                    {num('amount', '0', cur, 'imcrm-w-32')}
                </>,
            )}
            {sources.length === 0 && (
                <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                    {__('La lista no tiene columnas numéricas. Agregá una columna propia (p. ej. «Costo», de moneda) y cargala en cada producto o variación.')}
                </p>
            )}
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                <input type="checkbox" checked={draft.round === true} onChange={(e) => set({ round: e.target.checked })} data-testid={`imcrm-store-bulk-round-${index}`} />
                {__('Redondear el resultado')}
            </label>
            {draft.round &&
                row(
                    <>
                        <Select value={draft.roundMode ?? 'up'} onChange={(e) => set({ roundMode: e.target.value })} className="imcrm-w-40" aria-label={__('Hacia dónde')}>
                            <option value="up">{__('Hacia arriba')}</option>
                            <option value="nearest">{__('Al más cercano')}</option>
                            <option value="down">{__('Hacia abajo')}</option>
                        </Select>
                        <span className="imcrm-text-sm">{__('a múltiplos de')}</span>
                        {num('roundMultiple', '1000', undefined, 'imcrm-w-28')}
                        <span className="imcrm-text-sm">{__('más')}</span>
                        {num('roundAdjust', '-100', undefined, 'imcrm-w-28')}
                    </>,
                )}
        </div>
    );
}

function AttributeInputs({
    draft,
    set,
    listId,
    catalog,
    index,
}: {
    draft: StoreDraft;
    set: (patch: Partial<StoreDraft>) => void;
    listId: number;
    catalog: StoreBulkCatalog | null;
    index: number;
}): JSX.Element {
    const attrs = catalog?.attributes ?? [];
    const global = (draft.attributeId ?? 0) > 0;
    const terms = useStoreAttributeTerms(listId, global ? draft.attributeId! : null);
    const choice = global ? String(draft.attributeId) : draft.attributeCustom ? '__custom' : '';
    return (
        <div className="imcrm-space-y-2">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Segmented
                    value={draft.mode ?? 'add'}
                    onChange={(v) => set({ mode: v as StoreDraft['mode'] })}
                    options={[
                        { value: 'add', label: __('Agregar valores') },
                        { value: 'replace', label: __('Reemplazar valores') },
                        { value: 'remove', label: __('Quitar el atributo') },
                    ]}
                />
                <Select
                    className="imcrm-w-56"
                    value={choice}
                    aria-label={__('Atributo')}
                    data-testid={`imcrm-store-bulk-attr-${index}`}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__custom') set({ attributeId: 0, attributeName: '', attributeCustom: true, values: [] });
                        else if (v === '') set({ attributeId: 0, attributeName: '', attributeCustom: false, values: [] });
                        else {
                            const a = attrs.find((x) => String(x.id) === v);
                            set({ attributeId: a?.id ?? 0, attributeName: a?.name ?? '', attributeCustom: false, values: [] });
                        }
                    }}
                >
                    <option value="">{__('— Atributo —')}</option>
                    {attrs.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                        </option>
                    ))}
                    <option value="__custom">{__('Otro (propio del producto)…')}</option>
                </Select>
                {choice === '__custom' && (
                    <Input className="imcrm-w-48" value={draft.attributeName ?? ''} onChange={(e) => set({ attributeName: e.target.value })} placeholder={__('Nombre (p. ej. Material)')} />
                )}
            </div>
            {draft.mode !== 'remove' && (draft.attributeName ?? '') !== '' && (
                <TermPicker
                    options={(terms.data ?? []).map((t) => ({ value: t.name, label: t.name }))}
                    values={draft.values ?? []}
                    onChange={(values) => set({ values })}
                    allowNew
                    newLabel={__('Otro valor…')}
                    testId={`imcrm-store-bulk-attr-values-${index}`}
                />
            )}
            {draft.mode !== 'remove' && (
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <input type="checkbox" checked={draft.visible !== false} onChange={(e) => set({ visible: e.target.checked })} />
                    {__('Mostrarlo en la página del producto')}
                </label>
            )}
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Un atributo que ya usan las variaciones (la talla de una camiseta) sólo admite agregar valores: reemplazarlo o quitarlo rompería las variaciones.')}
            </p>
        </div>
    );
}

/** Elegir de la tienda (con sus nombres) o escribir uno nuevo. */
export function TermPicker({
    options,
    values,
    onChange,
    allowNew,
    newLabel,
    testId,
}: {
    options: Array<{ value: string; label: string }>;
    values: string[];
    onChange: (next: string[]) => void;
    allowNew: boolean;
    newLabel: string;
    testId: string;
}): JSX.Element {
    const [text, setText] = useState('');
    const known = new Set(options.map((o) => o.value));
    const extra = values.filter((v) => !known.has(v)).map((v) => ({ value: v, label: `${v} (${__('nueva')})` }));
    const add = () => {
        const v = text.trim();
        if (v === '') return;
        onChange([...new Set([...values, v])]);
        setText('');
    };
    return (
        <div className="imcrm-space-y-1.5">
            <FilterOptionPicker
                mode="multi"
                options={[...options, ...extra]}
                value={values}
                onChange={(next) => onChange(Array.isArray(next) ? next : [])}
                data-testid={testId}
            />
            {allowNew && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Input
                        className="imcrm-flex-1"
                        value={text}
                        placeholder={newLabel}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                add();
                            }
                        }}
                        data-testid={`${testId}-new`}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={add} disabled={text.trim() === ''}>
                        {__('Agregar')}
                    </Button>
                </div>
            )}
        </div>
    );
}

// ── Vista previa y resultado ─────────────────────────────────────────────

function StorePreviewPanel({ preview }: { preview: StoreBulkPreview }): JSX.Element {
    return (
        <div className="imcrm-space-y-4" data-testid="imcrm-store-bulk-preview">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Productos')}</p>
                    <p className="imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums" data-testid="imcrm-store-bulk-stat-products">{formatNumber(preview.products)}</p>
                </div>
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Variaciones')}</p>
                    <p className="imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums" data-testid="imcrm-store-bulk-stat-variations">{formatNumber(preview.variations)}</p>
                </div>
            </div>
            {preview.warnings.map((w) => (
                <p key={w} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-amber-50 imcrm-px-3 imcrm-py-2 imcrm-text-xs dark:imcrm-bg-amber-500/10">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-amber-600" aria-hidden />
                    {w}
                </p>
            ))}
            <div>
                <h4 className="imcrm-mb-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Así quedan (leído de la tienda ahora)')}
                </h4>
                {preview.sample.length === 0 ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('En la muestra no cambia nada: ya estaban así.')}</p>
                ) : (
                    <div className="imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border">
                        <table className="imcrm-w-full imcrm-text-sm">
                            <thead className="imcrm-bg-muted/50 imcrm-text-xs imcrm-text-muted-foreground">
                                <tr>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Producto')}</th>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Qué')}</th>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Antes')}</th>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Después')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.sample.map((row, ri) => (
                                    <SampleRows key={`${row.title}-${ri}`} row={row} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {preview.products + preview.variations > preview.sample.length && (
                    <p className="imcrm-mt-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('La muestra lee de la tienda sólo los primeros; al aplicar, cada uno se calcula con lo que tenga en ese momento.')}
                    </p>
                )}
            </div>
        </div>
    );
}

function SampleRows({ row }: { row: StoreBulkPreview['sample'][number] }): JSX.Element {
    const lines = row.changes.length > 0 ? row.changes : [null];
    return (
        <>
            {lines.map((c, i) => (
                <tr key={i} className="imcrm-border-t imcrm-border-border">
                    <td className="imcrm-max-w-[14rem] imcrm-truncate imcrm-px-3 imcrm-py-1.5 imcrm-font-medium" title={i === 0 ? row.title : undefined}>
                        {i === 0 && (
                            <>
                                {row.kind === 'variation' && <span className="imcrm-mr-1 imcrm-text-muted-foreground">↳</span>}
                                {row.title}
                            </>
                        )}
                    </td>
                    {c ? (
                        <>
                            <td className="imcrm-px-3 imcrm-py-1.5 imcrm-text-muted-foreground">{c.label}</td>
                            <td className="imcrm-px-3 imcrm-py-1.5 imcrm-opacity-70">{c.before}</td>
                            <td className="imcrm-px-3 imcrm-py-1.5" data-testid="imcrm-store-bulk-after">{c.after}</td>
                        </>
                    ) : (
                        <td colSpan={3} className="imcrm-px-3 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            {row.notes.join(' ')}
                        </td>
                    )}
                </tr>
            ))}
            {row.changes.length > 0 && row.notes.length > 0 && (
                <tr>
                    <td />
                    <td colSpan={3} className="imcrm-px-3 imcrm-pb-1.5 imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {row.notes.join(' ')}
                    </td>
                </tr>
            )}
        </>
    );
}

function StoreResultPanel({ result }: { result: StoreBulkResult }): JSX.Element {
    return (
        <div className="imcrm-space-y-3" data-testid="imcrm-store-bulk-result">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <CheckCircle2 className="imcrm-h-5 imcrm-w-5 imcrm-text-emerald-600" aria-hidden />
                {sprintf(_n('Se actualizó %s producto o variación en la tienda.', 'Se actualizaron %s productos y variaciones en la tienda.', result.updated), formatNumber(result.updated))}
            </p>
            {result.unchanged > 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(_n('%d ya estaba así.', '%d ya estaban así.', result.unchanged), result.unchanged)}
                </p>
            )}
            {result.skipped.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-amber-300/60 imcrm-bg-amber-50 imcrm-p-3 dark:imcrm-border-amber-500/30 dark:imcrm-bg-amber-500/10">
                    <p className="imcrm-text-sm imcrm-font-medium">{sprintf(__('%d no aplican:'), result.skipped.length)}</p>
                    <ul className="imcrm-mt-1 imcrm-max-h-32 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs">
                        {result.skipped.slice(0, 100).map((s, i) => (
                            <li key={i}>
                                <span className="imcrm-font-medium">{s.title}</span> — {s.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {result.failed.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3">
                    <p className="imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                        {sprintf(_n('La tienda rechazó %d:', 'La tienda rechazó %d:', result.failed.length), result.failed.length)}
                    </p>
                    <ul className="imcrm-mt-1 imcrm-max-h-32 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs" data-testid="imcrm-store-bulk-failed">
                        {result.failed.slice(0, 100).map((f, i) => (
                            <li key={i}>
                                <span className="imcrm-font-medium">{f.title}</span> — {f.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
