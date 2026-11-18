import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Check, FileText, GitMerge, Loader2, X } from 'lucide-react';
import { MERGE_CHOICE_UNION, type BulkRevertPreview, type MergeFieldPreview } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useBulkRevertApply } from '@/hooks/useBulkHistory';
import { useMergePreview, useMergeRecords } from '@/hooks/useDuplicates';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { FieldValueDisplay } from '../crm/FieldValueDisplay';

import { mergeValueOptions, type MergeChoice } from './mergeModel';

interface MergeDialogProps {
    listId: number;
    fields: FieldEntity[];
    /** Los registros a fusionar (2 a 10). */
    ids: number[];
    /** El que queda de entrada (si no, el más antiguo). */
    initialPrimaryId?: number;
    onClose: () => void;
    /** Se fusionaron (para limpiar la selección o cerrar la ficha del que se fue). */
    onMerged?: (primaryId: number, mergedIds: number[]) => void;
}

/**
 * A14 (v0.1.445, ADR-S106) — Fusionar registros duplicados: cuál queda, qué
 * valor gana en cada campo que difiere (o se juntan, en varias opciones y
 * archivos) y qué se le pasa. Los otros van a la papelera y «Deshacer» lo
 * devuelve todo.
 */
export function MergeDialog({ listId, fields, ids, initialPrimaryId, onClose, onMerged }: MergeDialogProps): JSX.Element {
    const toast = useToast();
    const unique = useMemo(() => [...new Set(ids)], [ids]);
    const [primaryId, setPrimaryId] = useState<number>(() => initialPrimaryId && unique.includes(initialPrimaryId) ? initialPrimaryId : Math.min(...unique));
    const dupIds = useMemo(() => unique.filter((id) => id !== primaryId), [unique, primaryId]);
    const preview = useMergePreview(listId, primaryId, dupIds, true);
    const merge = useMergeRecords(listId);
    const revert = useBulkRevertApply(listId);
    const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
    const [descriptionFrom, setDescriptionFrom] = useState<number | null>(null);
    const [showAll, setShowAll] = useState(false);

    // Cambiar cuál queda reordena las sugerencias: se empieza de nuevo.
    useEffect(() => {
        setChoices({});
        setDescriptionFrom(null);
    }, [primaryId]);

    const data = preview.data;
    const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const shownFields = useMemo(() => (data ? data.fields.filter((f) => showAll || f.differs) : []), [data, showAll]);
    const withDescription = data?.records.filter((r) => r.has_description) ?? [];
    const titleOf = (id: number): string => data?.records.find((r) => r.id === id)?.title ?? `#${id}`;
    const primaryTitle = titleOf(primaryId);

    const undo = useCallback(
        async (editId: number): Promise<void> => {
            try {
                const p = (await api.post<BulkRevertPreview>(`/lists/${listId}/bulk-edits/${editId}/revert/preview`, {})).data;
                if (p.item_ids.length === 0) {
                    toast.error(__('No se pudo deshacer'), p.conflicts[0]?.message ?? __('Alguien cambió los registros después de fusionarlos.'));
                    return;
                }
                const res = await revert.mutateAsync({ editId, itemIds: p.item_ids, force: false });
                if (res.failed.length > 0 || res.conflicts > 0 || p.conflict_ids.length > 0) {
                    toast.show({
                        title: __('Se deshizo en parte'),
                        description: res.failed[0]?.message ?? __('Alguien cambió el registro que quedó después de fusionar: sus valores no se tocaron.'),
                        variant: 'warning',
                        duration: 8000,
                    });
                } else {
                    toast.success(__('Fusión deshecha'), __('Los registros volvieron con todo lo suyo.'));
                }
            } catch (err) {
                toast.error(__('No se pudo deshacer'), err instanceof Error ? err.message : undefined);
            }
        },
        [listId, revert, toast],
    );

    const submit = async (): Promise<void> => {
        if (!data) return;
        try {
            const res = await merge.mutateAsync({
                primary_id: primaryId,
                duplicate_ids: dupIds,
                choices,
                ...(descriptionFrom !== null ? { description_from: descriptionFrom } : {}),
            });
            const n = res.merged_ids.length + 1;
            const editId = res.edit_id;
            toast.show({
                title: sprintf(_n('Se fusionaron %s registros en «%s»', 'Se fusionaron %s registros en «%s»', n), formatNumber(n), primaryTitle),
                description:
                    res.warnings[0] ??
                    (res.moved.length > 0
                        ? sprintf(__('Pasaron: %s.'), res.moved.map((m) => `${m.label.toLowerCase()} (${formatNumber(m.count)})`).join(', '))
                        : __('Los otros quedaron en la papelera.')),
                variant: res.warnings.length > 0 ? 'warning' : 'success',
                duration: 9000,
                ...(editId !== null ? { action: { label: __('Deshacer'), onClick: () => void undo(editId) } } : {}),
            });
            onMerged?.(res.primary_id, res.merged_ids);
            onClose();
        } catch (err) {
            toast.error(__('No se pudo fusionar'), err instanceof Error ? err.message : undefined);
        }
    };

    const busy = merge.isPending;
    const blocked = (data?.blockers.length ?? 0) > 0;

    return (
        <Dialog.Root open onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[92vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-merge-dialog"
                    data-tour="merge-dialog"
                    onEscapeKeyDown={(e) => busy && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <GitMerge className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {sprintf(_n('Fusionar %s registro', 'Fusionar %s registros', unique.length), formatNumber(unique.length))}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Quedan en uno solo. Lo de los otros (comentarios, vínculos, subtareas…) pasa al que elijas y ellos van a la papelera.')}
                            </Dialog.Description>
                        </div>
                        {!busy && (
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        )}
                    </div>

                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-space-y-5 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                        <section className="imcrm-space-y-2">
                            <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Cuál queda')}</h3>
                            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" role="radiogroup" aria-label={__('Cuál queda')}>
                                {(data?.records ?? unique.map((id) => ({ id, title: `#${id}`, updated_at: '', has_description: false, created_at: '' }))).map((r) => {
                                    const active = r.id === primaryId;
                                    return (
                                        <button
                                            key={r.id}
                                            type="button"
                                            role="radio"
                                            aria-checked={active}
                                            disabled={busy}
                                            onClick={() => setPrimaryId(r.id)}
                                            data-testid="imcrm-merge-primary"
                                            className={cn(
                                                'imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                                active ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'imcrm-mt-0.5 imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border',
                                                    active ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border',
                                                )}
                                            >
                                                {active && <Check className="imcrm-h-3 imcrm-w-3" />}
                                            </span>
                                            <span className="imcrm-min-w-0">
                                                <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{r.title}</span>
                                                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                                    {r.updated_at ? sprintf(__('Editado %s'), formatDateTimeStr(r.updated_at)) : `#${r.id}`}
                                                </span>
                                                {active && <span className="imcrm-mt-1 imcrm-block imcrm-text-xs imcrm-font-medium imcrm-text-primary">{__('Este queda')}</span>}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        {preview.isLoading && (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                {__('Comparando…')}
                            </p>
                        )}
                        {preview.isError && (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {preview.error instanceof Error ? preview.error.message : __('No se pudo comparar los registros.')}
                            </p>
                        )}

                        {data && data.blockers.length > 0 && (
                            <div className="imcrm-space-y-1 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/5 imcrm-p-3" data-testid="imcrm-merge-blockers">
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                                    <AlertTriangle className="imcrm-h-4 imcrm-w-4" />
                                    {__('No se pueden fusionar')}
                                </p>
                                <ul className="imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-5 imcrm-text-sm imcrm-text-destructive">
                                    {data.blockers.map((b) => (
                                        <li key={b}>{b}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {data && !blocked && (
                            <section className="imcrm-space-y-2">
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                    <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                        {showAll ? __('Todos los campos') : __('Lo que es distinto')}
                                    </h3>
                                    {data.fields.length > 0 && (
                                        <button type="button" className="imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline" onClick={() => setShowAll((v) => !v)}>
                                            {showAll ? __('Ver sólo lo distinto') : sprintf(__('Ver todos (%s)'), formatNumber(data.fields.length))}
                                        </button>
                                    )}
                                </div>
                                {shownFields.length === 0 ? (
                                    <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                                        {__('Tienen los mismos valores: no hay nada que elegir.')}
                                    </p>
                                ) : (
                                    <div className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                                        {shownFields.map((pf) => {
                                            const field = fieldById.get(pf.field_id);
                                            if (!field) return null;
                                            return (
                                                <FieldChoiceRow
                                                    key={pf.field_id}
                                                    preview={pf}
                                                    field={field}
                                                    ids={data.records.map((r) => r.id)}
                                                    titleOf={titleOf}
                                                    value={choices[String(pf.field_id)] ?? pf.suggested}
                                                    onChange={(c) => setChoices((prev) => ({ ...prev, [String(pf.field_id)]: c }))}
                                                    disabled={busy}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        )}

                        {data && !blocked && withDescription.length > 1 && (
                            <section className="imcrm-space-y-2">
                                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Descripción que queda')}</h3>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2" role="radiogroup" aria-label={__('Descripción que queda')}>
                                    {withDescription.map((r) => {
                                        const current = descriptionFrom ?? (data.records.find((x) => x.id === primaryId)?.has_description ? primaryId : withDescription[0]!.id);
                                        const active = current === r.id;
                                        return (
                                            <button
                                                key={r.id}
                                                type="button"
                                                role="radio"
                                                aria-checked={active}
                                                onClick={() => setDescriptionFrom(r.id)}
                                                className={cn(
                                                    'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-py-1 imcrm-text-xs',
                                                    active ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                                                )}
                                            >
                                                <FileText className="imcrm-h-3 imcrm-w-3" />
                                                {sprintf(__('La de «%s»'), r.title)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {data && !blocked && (
                            <section className="imcrm-space-y-1.5 imcrm-rounded-lg imcrm-bg-muted/50 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-merge-moves">
                                <p className="imcrm-font-medium">{sprintf(__('Pasa a «%s»'), primaryTitle)}</p>
                                {data.moves.length === 0 ? (
                                    <p className="imcrm-text-muted-foreground">{__('Los otros no tienen comentarios, vínculos ni nada más colgado.')}</p>
                                ) : (
                                    <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                        {data.moves.map((m) => (
                                            <li key={m.key} className="imcrm-rounded-full imcrm-bg-background imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-ring-1 imcrm-ring-border">
                                                {m.label} · {formatNumber(m.count)}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {sprintf(
                                        _n(
                                            'El otro va a la papelera con su historial. «Deshacer» lo devuelve todo.',
                                            'Los otros %s van a la papelera con su historial. «Deshacer» lo devuelve todo.',
                                            dupIds.length,
                                        ),
                                        formatNumber(dupIds.length),
                                    )}
                                </p>
                            </section>
                        )}

                        {data && data.warnings.length > 0 && (
                            <ul className="imcrm-space-y-1 imcrm-rounded-md imcrm-border imcrm-border-amber-300/60 imcrm-bg-amber-50 imcrm-p-3 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-border-amber-500/30 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-200">
                                {data.warnings.map((w) => (
                                    <li key={w} className="imcrm-flex imcrm-gap-1.5">
                                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                        {w}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        <Button variant="ghost" onClick={onClose} disabled={busy}>
                            {__('Cancelar')}
                        </Button>
                        <Button onClick={() => void submit()} disabled={!data || blocked || busy} data-testid="imcrm-merge-submit">
                            {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <GitMerge className="imcrm-h-4 imcrm-w-4" />}
                            {sprintf(_n('Fusionar en «%2$s»', 'Fusionar %1$s en «%2$s»', unique.length), formatNumber(unique.length), primaryTitle)}
                        </Button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

interface FieldChoiceRowProps {
    preview: MergeFieldPreview;
    field: FieldEntity;
    ids: number[];
    titleOf: (id: number) => string;
    value: MergeChoice;
    onChange: (c: MergeChoice) => void;
    disabled: boolean;
}

function FieldChoiceRow({ preview, field, ids, titleOf, value, onChange, disabled }: FieldChoiceRowProps): JSX.Element {
    const options = mergeValueOptions(preview, ids);
    return (
        <div className="imcrm-grid imcrm-gap-2 imcrm-p-3 sm:imcrm-grid-cols-[minmax(0,10rem)_minmax(0,1fr)]" data-testid="imcrm-merge-field" data-field={field.slug}>
            <p className="imcrm-truncate imcrm-pt-1 imcrm-text-sm imcrm-font-medium" title={field.label}>
                {field.label}
            </p>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" role="radiogroup" aria-label={field.label}>
                {options.map((o) => {
                    const active = value === o.choice || (typeof value === 'number' && o.ids.includes(value));
                    return (
                        <button
                            key={String(o.choice)}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={disabled}
                            onClick={() => onChange(o.choice)}
                            title={o.ids.map(titleOf).join(', ')}
                            className={cn(
                                'imcrm-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-left imcrm-text-sm',
                                active ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                            )}
                        >
                            {o.empty ? (
                                <span className="imcrm-italic imcrm-text-muted-foreground">{__('(vacío)')}</span>
                            ) : (
                                <span className="imcrm-min-w-0 imcrm-truncate">
                                    <FieldValueDisplay field={field} value={o.value} />
                                </span>
                            )}
                        </button>
                    );
                })}
                {preview.can_union && options.filter((o) => !o.empty).length > 1 && (
                    <button
                        type="button"
                        role="radio"
                        aria-checked={value === MERGE_CHOICE_UNION}
                        disabled={disabled}
                        onClick={() => onChange(MERGE_CHOICE_UNION)}
                        data-testid="imcrm-merge-union"
                        className={cn(
                            'imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-sm imcrm-font-medium',
                            value === MERGE_CHOICE_UNION ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-dashed imcrm-border-border hover:imcrm-bg-accent',
                        )}
                    >
                        {__('Juntar todos')}
                    </button>
                )}
            </div>
        </div>
    );
}
