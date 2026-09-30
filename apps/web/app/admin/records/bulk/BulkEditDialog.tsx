import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Plus, Trash2, Undo2, Wand2, X } from 'lucide-react';
import {
    bulkOpsFor,
    type BulkEditPreview,
    type BulkEditResult,
    type BulkEditTarget,
    type BulkOperation,
    type BulkOpKind,
} from '@imagina-base/shared';

import { RelationPicker } from '@/components/fields/RelationPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useBulkEditApply, useBulkEditPreview, type BulkApplyProgress } from '@/hooks/useBulkEdit';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';

import { extractFieldOptions } from '../fieldOptions';
import { FilterOptionPicker } from '../FilterOptionPicker';
import { isEmptyTree } from '../filterTree';
import { renderCellValue } from '../renderCellValue';

import {
    bulkEditableFields,
    draftDefaults,
    draftToOperation,
    newDraft,
    numericSourceFields,
    opLabel,
    type BulkDraft,
} from './bulkOpMeta';
import { BulkRevertDialog } from './BulkRevertDialog';
import { BulkValueInput } from './BulkValueInput';

interface BulkEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    fields: FieldEntity[];
    /** Filas seleccionadas en la tabla (puede estar vacío si se abre desde «Personalizar»). */
    selectedIds: number[];
    /** Filtros y búsqueda de la vista: «todos los que coinciden». */
    filterTree: FilterTree;
    search: string;
    /** Cuántos registros ve la vista con esos filtros (para ofrecer la opción). */
    matchingCount: number | null;
    /** Puede editar por filtro (capability `bulk_actions`). */
    canEditMatching: boolean;
    /** Columnas que no se pueden escribir (p. ej. las de la tienda que no viajan). */
    isLocked?: (field: FieldEntity) => boolean;
    /** v0.1.220 — cambios con los que arranca (p. ej. «Asignar»: el campo de persona ya elegido). */
    initialDrafts?: BulkDraft[];
    /** v0.1.220 — título del diálogo (default «Edición masiva»). */
    title?: string;
    onDone?: () => void;
}

type Phase = 'edit' | 'preview' | 'applying' | 'done';

/**
 * Edición masiva (v0.1.216) — el cambio en lote de verdad: una lista de
 * operaciones («subir 10 % el precio», «agregar la etiqueta VIP», «correr la
 * fecha 7 días»), una VISTA PREVIA con el antes → después de cada registro
 * calculada por el backend con la misma función que escribe, y la aplicación
 * en tandas con barra de avance. Sirve para la selección o para todo lo que
 * coincide con los filtros de la vista.
 */
export function BulkEditDialog({
    open,
    onOpenChange,
    listId,
    fields,
    selectedIds,
    filterTree,
    search,
    matchingCount,
    canEditMatching,
    isLocked,
    initialDrafts,
    title,
    onDone,
}: BulkEditDialogProps): JSX.Element {
    const [drafts, setDrafts] = useState<BulkDraft[]>([newDraft()]);
    const [scope, setScope] = useState<'selection' | 'matching'>(selectedIds.length > 0 ? 'selection' : 'matching');
    const [phase, setPhase] = useState<Phase>('edit');
    const [formError, setFormError] = useState<string | null>(null);
    const [operations, setOperations] = useState<BulkOperation[]>([]);
    const [preview, setPreview] = useState<BulkEditPreview | null>(null);
    const [progress, setProgress] = useState<BulkApplyProgress | null>(null);
    const [result, setResult] = useState<BulkEditResult | null>(null);
    const [undoOpen, setUndoOpen] = useState(false);
    const previewM = useBulkEditPreview(listId);
    const applyM = useBulkEditApply(listId);

    // Cada vez que se abre arranca limpio (y con la selección de ese momento).
    useEffect(() => {
        if (!open) return;
        setDrafts(initialDrafts && initialDrafts.length > 0 ? initialDrafts : [newDraft()]);
        setScope(selectedIds.length > 0 ? 'selection' : 'matching');
        setPhase('edit');
        setFormError(null);
        setPreview(null);
        setResult(null);
        setProgress(null);
        setUndoOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const editable = useMemo(() => bulkEditableFields(fields, isLocked), [fields, isLocked]);
    const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

    const target: BulkEditTarget =
        scope === 'selection'
            ? { ids: selectedIds }
            : {
                  ...(isEmptyTree(filterTree) ? {} : { filter_tree: filterTree as never }),
                  ...(search.trim() !== '' ? { search: search.trim() } : {}),
                  include_subtasks: false,
              };

    const runPreview = async (): Promise<void> => {
        setFormError(null);
        const ops: BulkOperation[] = [];
        for (const d of drafts) {
            const r = draftToOperation(d, undefined, d.field_id ? byId.get(d.field_id)?.type : undefined);
            if (!r.ok) {
                const label = d.field_id ? byId.get(d.field_id)?.label : null;
                setFormError(label ? `${label}: ${r.error}` : r.error);
                return;
            }
            ops.push(r.operation);
        }
        try {
            const p = await previewM.mutateAsync({ target, operations: ops });
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
        const res = await applyM.mutateAsync({ ids: preview.ids, operations, onProgress: setProgress });
        setResult(res);
        setPhase('done');
        onDone?.();
    };

    const targetLabel =
        scope === 'selection'
            ? sprintf(_n('%d registro seleccionado', '%d registros seleccionados', selectedIds.length), selectedIds.length)
            : matchingCount !== null
              ? sprintf(_n('%d registro de la vista', '%d registros de la vista', matchingCount), formatNumber(matchingCount))
              : __('Todos los registros de la vista');

    return (
        <Dialog.Root open={open} onOpenChange={(o) => (phase === 'applying' ? undefined : onOpenChange(o))}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-3xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-bulk-edit-dialog"
                    onEscapeKeyDown={(e) => phase === 'applying' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <Wand2 className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {title ?? __('Edición masiva')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {targetLabel}
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
                                {(selectedIds.length > 0 || canEditMatching) && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2" role="radiogroup" aria-label={__('A qué registros')}>
                                        {selectedIds.length > 0 && (
                                            <ScopeChip
                                                active={scope === 'selection'}
                                                onClick={() => setScope('selection')}
                                                label={sprintf(_n('Los %d seleccionados', 'Los %d seleccionados', selectedIds.length), selectedIds.length)}
                                                testId="imcrm-bulk-scope-selection"
                                            />
                                        )}
                                        {canEditMatching && (
                                            <ScopeChip
                                                active={scope === 'matching'}
                                                onClick={() => setScope('matching')}
                                                label={
                                                    matchingCount !== null
                                                        ? sprintf(__('Todos los que coinciden con la vista (%s)'), formatNumber(matchingCount))
                                                        : __('Todos los que coinciden con la vista')
                                                }
                                                testId="imcrm-bulk-scope-matching"
                                            />
                                        )}
                                    </div>
                                )}

                                <ol className="imcrm-space-y-2.5">
                                    {drafts.map((d, i) => (
                                        <li key={d.key}>
                                            <OperationRow
                                                index={i}
                                                draft={d}
                                                fields={fields}
                                                editable={editable}
                                                onChange={(next) => setDrafts((all) => all.map((x) => (x.key === d.key ? next : x)))}
                                                onRemove={
                                                    drafts.length > 1 ? () => setDrafts((all) => all.filter((x) => x.key !== d.key)) : undefined
                                                }
                                            />
                                        </li>
                                    ))}
                                </ol>
                                {drafts.length < 12 && (
                                    <button
                                        type="button"
                                        onClick={() => setDrafts((all) => [...all, newDraft()])}
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                        data-testid="imcrm-bulk-add-op"
                                    >
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Agregar otro cambio')}
                                    </button>
                                )}
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Los cambios se aplican en orden y cada uno parte del valor de cada registro: «subir 10 %» sube el precio de cada uno, no pone el mismo número a todos.')}
                                </p>
                                {formError && (
                                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                        {formError}
                                    </p>
                                )}
                            </div>
                        )}

                        {phase === 'preview' && preview && <PreviewPanel preview={preview} byId={byId} />}

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
                                        data-testid="imcrm-bulk-progress"
                                    />
                                </div>
                                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">{__('No cierres esta ventana hasta que termine.')}</p>
                            </div>
                        )}

                        {phase === 'done' && result && <ResultPanel result={result} />}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {phase === 'edit' && (
                            <>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                                    {__('Cancelar')}
                                </Button>
                                <Button onClick={() => void runPreview()} disabled={previewM.isPending} data-testid="imcrm-bulk-preview-btn">
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
                                <Button onClick={() => void runApply()} disabled={preview.ids.length === 0} data-testid="imcrm-bulk-apply-btn">
                                    {preview.ids.length === 0
                                        ? __('No hay nada que cambiar')
                                        : sprintf(_n('Aplicar a %s registro', 'Aplicar a %s registros', preview.ids.length), formatNumber(preview.ids.length))}
                                </Button>
                            </>
                        )}
                        {phase === 'done' && result?.edit_id && result.succeeded.length > 0 && (
                            <Button variant="outline" onClick={() => setUndoOpen(true)} data-testid="imcrm-bulk-undo-btn">
                                <Undo2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Deshacer')}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={() => onOpenChange(false)} data-testid="imcrm-bulk-close-btn">
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
                    summary={__('La edición que acabás de aplicar')}
                />
            )}
        </Dialog.Root>
    );
}

export function ScopeChip({ active, onClick, label, testId }: { active: boolean; onClick: () => void; label: string; testId: string }): JSX.Element {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onClick}
            data-testid={testId}
            className={cn(
                'imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                    : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
            )}
        >
            {label}
        </button>
    );
}

// ── Una operación ─────────────────────────────────────────────────────────

function OperationRow({
    index,
    draft,
    fields,
    editable,
    onChange,
    onRemove,
}: {
    index: number;
    draft: BulkDraft;
    fields: FieldEntity[];
    editable: FieldEntity[];
    onChange: (next: BulkDraft) => void;
    onRemove?: () => void;
}): JSX.Element {
    const field = editable.find((f) => f.id === draft.field_id) ?? null;
    const ops: readonly BulkOpKind[] = field ? bulkOpsFor(field.type as never) : [];
    const set = (patch: Partial<BulkDraft>) => onChange({ ...draft, ...patch });

    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid={`imcrm-bulk-op-${index}`}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground">
                    {index + 1}
                </span>
                <Select
                    className="imcrm-min-w-[10rem] imcrm-flex-1"
                    value={draft.field_id ?? ''}
                    aria-label={__('Columna')}
                    data-testid={`imcrm-bulk-field-${index}`}
                    onChange={(e) => {
                        const id = e.target.value === '' ? null : Number(e.target.value);
                        const f = editable.find((x) => x.id === id);
                        const first = f ? (bulkOpsFor(f.type as never)[0] ?? null) : null;
                        onChange({ key: draft.key, field_id: id, op: first, ...(first ? draftDefaults(first) : {}) });
                    }}
                >
                    <option value="">{__('— Columna —')}</option>
                    {editable.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                <Select
                    className="imcrm-min-w-[12rem] imcrm-flex-1"
                    value={draft.op ?? ''}
                    disabled={!field}
                    aria-label={__('Qué hacer')}
                    data-testid={`imcrm-bulk-kind-${index}`}
                    onChange={(e) => {
                        const op = (e.target.value || null) as BulkOpKind | null;
                        onChange({ key: draft.key, field_id: draft.field_id, op, ...(op ? draftDefaults(op) : {}) });
                    }}
                >
                    {!field && <option value="">{__('— Qué hacer —')}</option>}
                    {field &&
                        ops.map((op) => (
                            <option key={op} value={op}>
                                {opLabel(op, field.type)}
                            </option>
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
            {field && draft.op && (
                <div className="imcrm-mt-2.5 imcrm-pl-7">
                    <OperationInputs field={field} draft={draft} fields={fields} set={set} index={index} />
                </div>
            )}
        </div>
    );
}

function OperationInputs({
    field,
    draft,
    fields,
    set,
    index,
}: {
    field: FieldEntity;
    draft: BulkDraft;
    fields: FieldEntity[];
    set: (patch: Partial<BulkDraft>) => void;
    index: number;
}): JSX.Element | null {
    const numberInput = (key: 'amount' | 'adjust', placeholder: string, suffix?: string) => (
        <div className="imcrm-relative imcrm-w-36">
            <Input
                inputMode="decimal"
                value={draft[key] ?? ''}
                placeholder={placeholder}
                onChange={(e) => set({ [key]: e.target.value })}
                data-testid={`imcrm-bulk-${key}-${index}`}
                className={suffix ? 'imcrm-pr-7' : undefined}
            />
            {suffix && <span className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2.5 imcrm-top-1/2 imcrm--translate-y-1/2 imcrm-text-xs imcrm-text-muted-foreground">{suffix}</span>}
        </div>
    );
    const row = (children: ReactNode) => <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">{children}</div>;
    const others = fields.filter((f) => f.id !== field.id);

    switch (draft.op) {
        case 'set':
            return <BulkValueInput field={field} value={draft.value} onChange={(v) => set({ value: v })} />;
        case 'add':
        case 'subtract':
        case 'multiply':
        case 'divide':
            return numberInput('amount', draft.op === 'multiply' || draft.op === 'divide' ? '2' : '10');
        case 'percent':
            return row(
                <>
                    <Segmented
                        value={draft.mode === 'down' ? 'down' : 'up'}
                        onChange={(v) => set({ mode: v })}
                        options={[
                            { value: 'up', label: __('Subir') },
                            { value: 'down', label: __('Bajar') },
                        ]}
                    />
                    {numberInput('amount', '10', '%')}
                </>,
            );
        case 'round':
            return (
                <div className="imcrm-space-y-2">
                    {row(
                        <>
                            <Select value={draft.mode ?? 'nearest'} onChange={(e) => set({ mode: e.target.value })} className="imcrm-w-44" aria-label={__('Hacia dónde')}>
                                <option value="nearest">{__('Al más cercano')}</option>
                                <option value="up">{__('Hacia arriba')}</option>
                                <option value="down">{__('Hacia abajo')}</option>
                            </Select>
                            <span className="imcrm-text-sm">{__('a múltiplos de')}</span>
                            {numberInput('amount', '1000')}
                            <span className="imcrm-text-sm">{__('más')}</span>
                            {numberInput('adjust', '0')}
                        </>,
                    )}
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Ej.: hacia arriba a múltiplos de 1.000 más −100 lleva cada precio al próximo terminado en 900 (24.320 → 24.900).')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                        {[
                            { label: __('Terminar en 900'), amount: '1000', mode: 'up', adjust: '-100' },
                            { label: __('A miles'), amount: '1000', mode: 'nearest', adjust: '0' },
                            { label: __('A cientos'), amount: '100', mode: 'nearest', adjust: '0' },
                            { label: __('Terminar en ,99'), amount: '1', mode: 'up', adjust: '0.99' },
                            { label: __('Sin decimales'), amount: '1', mode: 'nearest', adjust: '0' },
                        ].map((p) => (
                            <button
                                key={p.label}
                                type="button"
                                onClick={() => set({ amount: p.amount, mode: p.mode, adjust: p.adjust })}
                                className="imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
            );
        case 'calc': {
            const sources = numericSourceFields(fields);
            const operand = (side: 'left' | 'right') => {
                const o = draft[side] ?? {};
                return (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                        <Select
                            className="imcrm-w-44"
                            value={o.field_id ? String(o.field_id) : '__value'}
                            aria-label={side === 'left' ? __('Primer valor') : __('Segundo valor')}
                            data-testid={`imcrm-bulk-calc-${side}-${index}`}
                            onChange={(e) =>
                                set({ [side]: e.target.value === '__value' ? { value: o.value ?? '' } : { field_id: Number(e.target.value) } })
                            }
                        >
                            <option value="__value">{__('Un número…')}</option>
                            {sources.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                        {!o.field_id && (
                            <Input
                                className="imcrm-w-24"
                                inputMode="decimal"
                                value={o.value ?? ''}
                                placeholder="0"
                                onChange={(e) => set({ [side]: { value: e.target.value } })}
                                data-testid={`imcrm-bulk-calc-${side}-value-${index}`}
                            />
                        )}
                    </div>
                );
            };
            return row(
                <>
                    <span className="imcrm-text-sm imcrm-font-medium">{field.label} =</span>
                    {operand('left')}
                    <Select
                        className="imcrm-w-16"
                        value={draft.operator ?? '*'}
                        onChange={(e) => set({ operator: e.target.value as BulkDraft['operator'] })}
                        aria-label={__('Operación')}
                    >
                        <option value="+">+</option>
                        <option value="-">−</option>
                        <option value="*">×</option>
                        <option value="/">÷</option>
                    </Select>
                    {operand('right')}
                </>,
            );
        }
        case 'copy':
            return row(
                <>
                    <span className="imcrm-text-sm">{__('Copiar el valor de')}</span>
                    <Select
                        className="imcrm-w-56"
                        value={draft.source_field_id ?? ''}
                        onChange={(e) => set({ source_field_id: e.target.value === '' ? null : Number(e.target.value) })}
                        aria-label={__('Columna de origen')}
                    >
                        <option value="">{__('— Columna —')}</option>
                        {others.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                </>,
            );
        case 'prepend':
        case 'append':
            return <Input value={draft.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder={draft.op === 'prepend' ? __('Texto al inicio') : __('Texto al final')} />;
        case 'replace':
            return (
                <div className="imcrm-space-y-2">
                    {row(
                        <>
                            <Input className="imcrm-flex-1" value={draft.find ?? ''} onChange={(e) => set({ find: e.target.value })} placeholder={__('Buscar…')} />
                            <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                            <Input className="imcrm-flex-1" value={draft.replace ?? ''} onChange={(e) => set({ replace: e.target.value })} placeholder={__('Reemplazar por (vacío = borrar)')} />
                        </>,
                    )}
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <input type="checkbox" checked={draft.case_sensitive === true} onChange={(e) => set({ case_sensitive: e.target.checked })} />
                        {__('Distinguir mayúsculas y minúsculas')}
                    </label>
                </div>
            );
        case 'text_case':
            return (
                <Select value={draft.mode ?? 'title'} onChange={(e) => set({ mode: e.target.value })} className="imcrm-w-64" aria-label={__('Formato')}>
                    <option value="title">{__('Cada Palabra Con Mayúscula')}</option>
                    <option value="sentence">{__('Sólo la primera letra')}</option>
                    <option value="upper">{__('TODO EN MAYÚSCULAS')}</option>
                    <option value="lower">{__('todo en minúsculas')}</option>
                </Select>
            );
        case 'add_options':
        case 'remove_options':
            return (
                <FilterOptionPicker
                    mode="multi"
                    options={extractFieldOptions(field)}
                    value={draft.values ?? []}
                    onChange={(next) => set({ values: Array.isArray(next) ? next : [] })}
                    aria-label={__('Opciones')}
                    data-testid={`imcrm-bulk-options-${index}`}
                />
            );
        case 'shift_date':
            return row(
                <>
                    <Segmented
                        value={draft.mode === 'back' ? 'back' : 'forward'}
                        onChange={(v) => set({ mode: v })}
                        options={[
                            { value: 'forward', label: __('Adelante') },
                            { value: 'back', label: __('Atrás') },
                        ]}
                    />
                    {numberInput('amount', '7')}
                    <Select value={draft.unit ?? 'days'} onChange={(e) => set({ unit: e.target.value })} className="imcrm-w-32" aria-label={__('Unidad')}>
                        {field.type === 'datetime' && <option value="minutes">{__('minutos')}</option>}
                        {field.type === 'datetime' && <option value="hours">{__('horas')}</option>}
                        <option value="days">{__('días')}</option>
                        <option value="weeks">{__('semanas')}</option>
                        <option value="months">{__('meses')}</option>
                        <option value="years">{__('años')}</option>
                    </Select>
                </>,
            );
        case 'add_links':
        case 'remove_links':
            return <RelationPicker field={field} value={draft.ids ?? []} onChange={(ids) => set({ ids })} />;
        default:
            return null;
    }
}

export function Segmented({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
}): JSX.Element {
    return (
        <div className="imcrm-inline-flex imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5" role="radiogroup">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'imcrm-rounded imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                        value === o.value ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// ── Vista previa y resultado ─────────────────────────────────────────────

function PreviewPanel({ preview, byId }: { preview: BulkEditPreview; byId: Map<number, FieldEntity> }): JSX.Element {
    const show = (fieldId: number, v: unknown) => {
        const f = byId.get(fieldId);
        if (!f) return String(v ?? '—');
        if (f.type === 'relation') {
            const n = Array.isArray(v) ? v.length : 0;
            return <span className="imcrm-text-xs">{sprintf(_n('%d vinculado', '%d vinculados', n), n)}</span>;
        }
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
            return <span className="imcrm-text-muted-foreground">{__('(vacío)')}</span>;
        }
        return renderCellValue(f, v);
    };
    return (
        <div className="imcrm-space-y-4" data-testid="imcrm-bulk-preview">
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <Stat label={__('Van a cambiar')} value={preview.ids.length} tone="primary" testId="imcrm-bulk-stat-change" />
                <Stat label={__('Ya estaban así')} value={preview.unchanged} />
                <Stat label={__('No se pueden cambiar')} value={preview.error_count} tone={preview.error_count > 0 ? 'warn' : undefined} testId="imcrm-bulk-stat-errors" />
            </div>
            {preview.sample.length > 0 && (
                <div>
                    <h4 className="imcrm-mb-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {preview.ids.length > preview.sample.length
                            ? sprintf(__('Así quedan (primeros %d)'), preview.sample.length)
                            : __('Así quedan')}
                    </h4>
                    <div className="imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border">
                        <table className="imcrm-w-full imcrm-text-sm">
                            <thead className="imcrm-bg-muted/50 imcrm-text-xs imcrm-text-muted-foreground">
                                <tr>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Registro')}</th>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Columna')}</th>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Antes')}</th>
                                    <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{__('Después')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.sample.flatMap((row) =>
                                    row.changes.map((c, i) => (
                                        <tr key={`${row.id}-${c.field_id}`} className="imcrm-border-t imcrm-border-border">
                                            <td className="imcrm-max-w-[12rem] imcrm-truncate imcrm-px-3 imcrm-py-1.5 imcrm-font-medium">{i === 0 ? row.title : ''}</td>
                                            <td className="imcrm-px-3 imcrm-py-1.5 imcrm-text-muted-foreground">{byId.get(c.field_id)?.label ?? c.field_id}</td>
                                            <td className="imcrm-px-3 imcrm-py-1.5 imcrm-opacity-70">{show(c.field_id, c.before)}</td>
                                            <td className="imcrm-px-3 imcrm-py-1.5" data-testid="imcrm-bulk-after">{show(c.field_id, c.after)}</td>
                                        </tr>
                                    )),
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {preview.errors.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-amber-300/60 imcrm-bg-amber-50 imcrm-p-3 dark:imcrm-border-amber-500/30 dark:imcrm-bg-amber-500/10">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-600" aria-hidden />
                        {__('Estos no se van a tocar:')}
                    </p>
                    <ul className="imcrm-mt-1.5 imcrm-max-h-40 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs" data-testid="imcrm-bulk-errors">
                        {preview.errors.map((e) => (
                            <li key={e.id}>
                                <span className="imcrm-font-medium">{e.title}</span> — {e.message}
                            </li>
                        ))}
                        {preview.error_count > preview.errors.length && (
                            <li className="imcrm-text-muted-foreground">{sprintf(__('…y %d más.'), preview.error_count - preview.errors.length)}</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

function ResultPanel({ result }: { result: BulkEditResult }): JSX.Element {
    return (
        <div className="imcrm-space-y-3" data-testid="imcrm-bulk-result">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <CheckCircle2 className="imcrm-h-5 imcrm-w-5 imcrm-text-emerald-600" aria-hidden />
                {sprintf(_n('Se actualizó %s registro.', 'Se actualizaron %s registros.', result.succeeded.length), formatNumber(result.succeeded.length))}
            </p>
            {result.unchanged.length > 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(_n('%d ya había cambiado y quedó igual.', '%d ya habían cambiado y quedaron igual.', result.unchanged.length), result.unchanged.length)}
                </p>
            )}
            {result.failed.length > 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3">
                    <p className="imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                        {sprintf(_n('%d no se pudo actualizar:', '%d no se pudieron actualizar:', result.failed.length), result.failed.length)}
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
            <Label className="imcrm-text-[11px] imcrm-font-normal imcrm-text-muted-foreground">{label}</Label>
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
