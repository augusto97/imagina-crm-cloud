import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Layers, Loader2, Plus, Trash2, Undo2, X } from 'lucide-react';
import {
    STORE_VARIATIONS_MAX_PER_PRODUCT,
    type StoreBulkTarget,
    type StoreVariationsPreview,
    type StoreVariationsResult,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { BulkApplyProgress } from '@/hooks/useBulkEdit';
import { useStoreAttributeTerms, useStoreBulkCatalog, useStoreVariationsApply, useStoreVariationsPreview } from '@/hooks/useStoreBulk';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FilterTree } from '@/types/record';

import { isEmptyTree } from '../filterTree';

import { ScopeChip } from './BulkEditDialog';
import { BulkRevertDialog } from './BulkRevertDialog';
import { parseNumberInput } from './bulkOpMeta';
import { TermPicker } from './StoreBulkDialog';

interface StoreVariationsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    selectedIds: number[];
    filterTree: FilterTree;
    search: string;
    matchingCount: number | null;
    onDone?: () => void;
}

interface AttrDraft {
    key: string;
    /** id del atributo global, o 0 = propio del producto (por nombre). */
    id: number;
    name: string;
    custom: boolean;
    options: string[];
}

type Phase = 'edit' | 'preview' | 'applying' | 'done';

let seq = 0;
const newAttr = (): AttrDraft => ({ key: `va-${Date.now()}-${++seq}`, id: 0, name: '', custom: false, options: [] });

/**
 * Crear variaciones EN LOTE (v0.1.223) — lo que en WooCommerce es «Generar
 * variaciones» producto por producto, para muchos a la vez: se eligen los
 * atributos y sus valores (Color: Rojo, Azul × Talla: S, M, L), el precio y el
 * stock inicial, y cada producto variable recibe las combinaciones que le
 * faltan (las que ya tiene se saltean). Se deshace desde el historial:
 * las variaciones creadas se borran si nadie las tocó.
 */
export function StoreVariationsDialog({ open, onOpenChange, listId, selectedIds, filterTree, search, matchingCount, onDone }: StoreVariationsDialogProps): JSX.Element {
    const [attrs, setAttrs] = useState<AttrDraft[]>([newAttr()]);
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('');
    const [status, setStatus] = useState<'publish' | 'private'>('publish');
    const [scope, setScope] = useState<'selection' | 'matching'>(selectedIds.length > 0 ? 'selection' : 'matching');
    const [phase, setPhase] = useState<Phase>('edit');
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<StoreVariationsPreview | null>(null);
    const [progress, setProgress] = useState<BulkApplyProgress | null>(null);
    const [result, setResult] = useState<StoreVariationsResult | null>(null);
    const [undoOpen, setUndoOpen] = useState(false);
    const catalog = useStoreBulkCatalog(listId, open);
    const previewM = useStoreVariationsPreview(listId);
    const applyM = useStoreVariationsApply(listId);

    useEffect(() => {
        if (!open) return;
        setAttrs([newAttr()]);
        setPrice('');
        setStock('');
        setStatus('publish');
        setScope(selectedIds.length > 0 ? 'selection' : 'matching');
        setPhase('edit');
        setError(null);
        setPreview(null);
        setProgress(null);
        setResult(null);
        setUndoOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const target: StoreBulkTarget =
        scope === 'selection'
            ? { ids: selectedIds }
            : { ...(isEmptyTree(filterTree) ? {} : { filter_tree: filterTree as never }), ...(search.trim() !== '' ? { search: search.trim() } : {}) };
    const combos = attrs.reduce((n, a) => n * Math.max(1, new Set(a.options).size), 1);

    const buildSpec = () => {
        const ready = attrs.filter((a) => a.name.trim() !== '' && a.options.length > 0);
        if (ready.length === 0) return { error: __('Elegí al menos un atributo con sus valores.') };
        if (ready.length !== attrs.length) return { error: __('Hay un atributo sin nombre o sin valores: completalo o quitalo.') };
        const p = price.trim() === '' ? null : parseNumberInput(price);
        if (p === null && price.trim() !== '') return { error: __('El precio no es un número.') };
        const s = stock.trim() === '' ? null : parseNumberInput(stock);
        if (s !== null && (!Number.isInteger(s) || s < 0)) return { error: __('El stock tiene que ser un número entero.') };
        if (stock.trim() !== '' && s === null) return { error: __('El stock tiene que ser un número entero.') };
        return {
            spec: {
                attributes: ready.map((a) => ({ id: a.id, name: a.name.trim(), options: a.options })),
                regular_price: p,
                stock: s,
                status,
            },
        };
    };

    const runPreview = async (): Promise<void> => {
        setError(null);
        const b = buildSpec();
        if ('error' in b) {
            setError(b.error ?? null);
            return;
        }
        try {
            setPreview(await previewM.mutateAsync({ target, ...b.spec }));
            setPhase('preview');
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'));
        }
    };

    const runApply = async (): Promise<void> => {
        const b = buildSpec();
        if (!preview || 'error' in b) return;
        setPhase('applying');
        setResult(await applyM.mutateAsync({ ids: preview.record_ids, spec: b.spec, onProgress: setProgress }));
        setPhase('done');
        onDone?.();
    };

    const scopeCount = scope === 'selection' ? selectedIds.length : matchingCount;

    return (
        <Dialog.Root open={open} onOpenChange={(o) => (phase === 'applying' ? undefined : onOpenChange(o))}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-store-variations-dialog"
                    onEscapeKeyDown={(e) => phase === 'applying' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <Layers className="imcrm-h-4 imcrm-w-4 imcrm-text-[#7F54B3]" aria-hidden />
                                {__('Crear variaciones en la tienda')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {scopeCount !== null ? sprintf(_n('%s producto', '%s productos', scopeCount), formatNumber(scopeCount)) : __('Todos los productos de la vista')}
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
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2" role="radiogroup" aria-label={__('A qué productos')}>
                                    {selectedIds.length > 0 && (
                                        <ScopeChip
                                            active={scope === 'selection'}
                                            onClick={() => setScope('selection')}
                                            label={sprintf(_n('Los %d seleccionados', 'Los %d seleccionados', selectedIds.length), selectedIds.length)}
                                            testId="imcrm-variations-scope-selection"
                                        />
                                    )}
                                    <ScopeChip
                                        active={scope === 'matching'}
                                        onClick={() => setScope('matching')}
                                        label={matchingCount !== null ? sprintf(__('Todos los que coinciden con la vista (%s)'), formatNumber(matchingCount)) : __('Todos los que coinciden con la vista')}
                                        testId="imcrm-variations-scope-matching"
                                    />
                                </div>

                                <div className="imcrm-space-y-2.5">
                                    <p className="imcrm-text-sm imcrm-font-medium">{__('Atributos y valores a combinar')}</p>
                                    {attrs.map((a, i) => (
                                        <AttributeRow
                                            key={a.key}
                                            index={i}
                                            draft={a}
                                            listId={listId}
                                            globals={catalog.data?.attributes ?? []}
                                            onChange={(next) => setAttrs((all) => all.map((x) => (x.key === a.key ? next : x)))}
                                            onRemove={attrs.length > 1 ? () => setAttrs((all) => all.filter((x) => x.key !== a.key)) : undefined}
                                        />
                                    ))}
                                    {attrs.length < 3 && (
                                        <button
                                            type="button"
                                            onClick={() => setAttrs((all) => [...all, newAttr()])}
                                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                            data-testid="imcrm-variations-add-attr"
                                        >
                                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Otro atributo')}
                                        </button>
                                    )}
                                    <p className={cn('imcrm-text-xs', combos > STORE_VARIATIONS_MAX_PER_PRODUCT ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>
                                        {sprintf(__('%d combinaciones por producto (máximo %d). Las que un producto ya tenga se saltean.'), combos, STORE_VARIATIONS_MAX_PER_PRODUCT)}
                                    </p>
                                </div>

                                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                                    <label className="imcrm-space-y-1 imcrm-text-sm">
                                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Precio normal')}</span>
                                        <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={__('Opcional')} data-testid="imcrm-variations-price" />
                                    </label>
                                    <label className="imcrm-space-y-1 imcrm-text-sm">
                                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Stock inicial')}</span>
                                        <Input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} placeholder={__('Sin controlar')} data-testid="imcrm-variations-stock" />
                                    </label>
                                    <label className="imcrm-space-y-1 imcrm-text-sm">
                                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Estado')}</span>
                                        <Select value={status} onChange={(e) => setStatus(e.target.value as 'publish' | 'private')}>
                                            <option value="publish">{__('Activa')}</option>
                                            <option value="private">{__('Inactiva')}</option>
                                        </Select>
                                    </label>
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Sólo los productos variables reciben variaciones. Los valores nuevos se agregan a los atributos de cada producto sin quitar los que ya tiene.')}
                                </p>
                                {error && (
                                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                        {error}
                                    </p>
                                )}
                            </div>
                        )}

                        {phase === 'preview' && preview && <PreviewPanel preview={preview} />}

                        {phase === 'applying' && (
                            <div className="imcrm-py-8 imcrm-text-center" aria-live="polite">
                                <Loader2 className="imcrm-mx-auto imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-primary" />
                                <p className="imcrm-mt-3 imcrm-text-sm">
                                    {progress ? sprintf(__('Creando… %1$s de %2$s productos'), formatNumber(progress.done), formatNumber(progress.total)) : __('Creando…')}
                                </p>
                            </div>
                        )}

                        {phase === 'done' && result && (
                            <div className="imcrm-space-y-3" data-testid="imcrm-variations-result">
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                    <CheckCircle2 className="imcrm-h-5 imcrm-w-5 imcrm-text-emerald-600" aria-hidden />
                                    {sprintf(_n('Se creó %s variación.', 'Se crearon %s variaciones.', result.created), formatNumber(result.created))}
                                </p>
                                {result.skipped.length > 0 && (
                                    <ul className="imcrm-space-y-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                        {result.skipped.slice(0, 20).map((s, i) => (
                                            <li key={i}>
                                                <span className="imcrm-font-medium">{s.title}</span> — {s.reason}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {result.failed.length > 0 && (
                                    <div className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-xs">
                                        {result.failed.slice(0, 30).map((f, i) => (
                                            <p key={i}>
                                                <span className="imcrm-font-medium">{f.title}</span> — {f.message}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {phase === 'edit' && (
                            <>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                                    {__('Cancelar')}
                                </Button>
                                <Button onClick={() => void runPreview()} disabled={previewM.isPending || combos > STORE_VARIATIONS_MAX_PER_PRODUCT} data-testid="imcrm-variations-preview-btn">
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
                                <Button onClick={() => void runApply()} disabled={preview.to_create === 0} data-testid="imcrm-variations-apply-btn">
                                    {preview.to_create === 0
                                        ? __('No hay variaciones que crear')
                                        : sprintf(_n('Crear %s variación', 'Crear %s variaciones', preview.to_create), formatNumber(preview.to_create))}
                                </Button>
                            </>
                        )}
                        {phase === 'done' && result?.edit_id && result.created > 0 && (
                            <Button variant="outline" onClick={() => setUndoOpen(true)} data-testid="imcrm-variations-undo-btn">
                                <Undo2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Deshacer')}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={() => onOpenChange(false)} data-testid="imcrm-variations-close-btn">
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
                    summary={__('Las variaciones que acabás de crear')}
                />
            )}
        </Dialog.Root>
    );
}

function AttributeRow({
    index,
    draft,
    listId,
    globals,
    onChange,
    onRemove,
}: {
    index: number;
    draft: AttrDraft;
    listId: number;
    globals: Array<{ id: number; name: string }>;
    onChange: (next: AttrDraft) => void;
    onRemove?: () => void;
}): JSX.Element {
    const terms = useStoreAttributeTerms(listId, draft.id > 0 ? draft.id : null);
    const choice = draft.id > 0 ? String(draft.id) : draft.custom ? '__custom' : '';
    return (
        <div className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid={`imcrm-variations-attr-${index}`}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Select
                    className="imcrm-w-56"
                    value={choice}
                    aria-label={__('Atributo')}
                    data-testid={`imcrm-variations-attr-select-${index}`}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__custom') onChange({ ...draft, id: 0, name: '', custom: true, options: [] });
                        else if (v === '') onChange({ ...draft, id: 0, name: '', custom: false, options: [] });
                        else {
                            const g = globals.find((x) => String(x.id) === v);
                            onChange({ ...draft, id: g?.id ?? 0, name: g?.name ?? '', custom: false, options: [] });
                        }
                    }}
                >
                    <option value="">{__('— Atributo —')}</option>
                    {globals.map((g) => (
                        <option key={g.id} value={g.id}>
                            {g.name}
                        </option>
                    ))}
                    <option value="__custom">{__('Otro (propio del producto)…')}</option>
                </Select>
                {draft.custom && (
                    <Input
                        className="imcrm-w-48"
                        value={draft.name}
                        onChange={(e) => onChange({ ...draft, name: e.target.value })}
                        placeholder={__('Nombre (p. ej. Talla)')}
                        data-testid={`imcrm-variations-attr-name-${index}`}
                    />
                )}
                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={__('Quitar este atributo')}
                        className="imcrm-ml-auto imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </button>
                )}
            </div>
            {draft.name.trim() !== '' && (
                <TermPicker
                    // Un atributo propio del producto no tiene catálogo en la tienda: sus valores
                    // son los que se escriben (no se marcan «(nueva)»).
                    options={draft.id > 0 ? (terms.data ?? []).map((t) => ({ value: t.name, label: t.name })) : draft.options.map((v) => ({ value: v, label: v }))}
                    values={draft.options}
                    onChange={(options) => onChange({ ...draft, options })}
                    allowNew
                    newLabel={__('Otro valor…')}
                    testId={`imcrm-variations-values-${index}`}
                />
            )}
        </div>
    );
}

function PreviewPanel({ preview }: { preview: StoreVariationsPreview }): JSX.Element {
    return (
        <div className="imcrm-space-y-3" data-testid="imcrm-variations-preview">
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <Stat label={__('Productos variables')} value={preview.products} />
                <Stat label={__('Se crean')} value={preview.to_create} tone="primary" testId="imcrm-variations-count" />
                <Stat label={__('Ya existían')} value={preview.existing} />
            </div>
            {preview.warnings.map((w, i) => (
                <p key={i} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    {w}
                </p>
            ))}
            <ul className="imcrm-space-y-2">
                {preview.sample.map((s, i) => (
                    <li key={i} className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2.5 imcrm-text-sm">
                        <p className="imcrm-font-medium">{s.title}</p>
                        {s.create.length > 0 && (
                            <p className="imcrm-mt-1 imcrm-text-xs">
                                {sprintf(__('Nuevas: %s'), s.create.map((c) => c.split(' — ').slice(-1)[0]).join(' · '))}
                            </p>
                        )}
                        {s.existing > 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(_n('%d ya existía', '%d ya existían', s.existing), s.existing)}</p>}
                        {s.notes.map((n, j) => (
                            <p key={j} className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                {n}
                            </p>
                        ))}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Stat({ label, value, tone, testId }: { label: string; value: number; tone?: 'primary'; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</p>
            <p className={cn('imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums', tone === 'primary' && 'imcrm-text-primary')} data-testid={testId}>
                {formatNumber(value)}
            </p>
        </div>
    );
}
