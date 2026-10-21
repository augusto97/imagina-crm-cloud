import { useState } from 'react';
import { History, Info, Loader2, RotateCcw } from 'lucide-react';
import { checkRestoreValue, isDataField, sameFieldValue, type FieldHistoryEntry } from '@imagina-base/shared';

import { ActivityValue } from '@/admin/activity/ActivityPanel';
import { changeSentence, formatActivityValue, relativeTime } from '@/admin/activity/activityText';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { storeAccessFor, useStoreRules } from '@/admin/records/storeRules';
import { useFieldHistory, useRestoreFieldValue } from '@/hooks/useFieldHistory';
import { useRecord } from '@/hooks/useRecords';
import { CAP, useCanAny } from '@/lib/permissions';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

export interface FieldHistoryProps {
    listId: string | number;
    recordId: number;
    field: FieldEntity;
    /** El valor que tiene el campo ahora (para marcar «Valor actual»). */
    currentValue: unknown;
    /** Quien mira puede escribir este campo (si no, sólo lee el historial). */
    canRestore: boolean;
    /** Tras restaurar: la ficha con borrador marca el valor como guardado. */
    onRestored?: (value: unknown, saved: RecordEntity | null) => void;
}

/**
 * v0.1.288 — «Ver historial» de un campo: un botón chico junto a la etiqueta
 * que aparece al pasar el mouse (en un táctil queda visible, tenue — ahí no
 * hay hover). Abre el panel con cada cambio de ESE campo.
 */
export function FieldHistoryButton({ className, ...props }: FieldHistoryProps & { className?: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    // La fila del campo entra en modo edición con un click: éste no.
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(true);
                }}
                aria-label={sprintf(/* translators: %s: field label */ __('Ver historial de «%s»'), props.field.label)}
                title={__('Ver historial')}
                data-testid="imcrm-field-history-btn"
                className={cn(
                    'imcrm-inline-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground imcrm-transition-opacity hover:imcrm-bg-accent hover:imcrm-text-foreground',
                    'imcrm-opacity-60 [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 focus-visible:imcrm-opacity-100',
                    className,
                )}
            >
                <History className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            </button>
            {open && <FieldHistorySheet {...props} open onOpenChange={setOpen} />}
        </>
    );
}

/**
 * El panel del historial: de lo más nuevo a lo más viejo, quién, cuándo y de
 * qué a qué (formateado como en la ficha), paginado. Cada versión ofrece
 * «Restaurar este valor»: lo escribe por el PATCH normal. Si el valor ya no
 * es válido (opción borrada, el campo cambió de tipo) se dice por qué y no se
 * intenta.
 */
export function FieldHistorySheet({
    listId,
    recordId,
    field,
    currentValue,
    canRestore,
    onRestored,
    open,
    onOpenChange,
}: FieldHistoryProps & { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
    const history = useFieldHistory(listId, recordId, field.id, open);
    const { restore, pendingKey } = useRestoreFieldValue(listId, recordId);
    const entries = history.data?.pages.flatMap((p) => p.data) ?? [];
    const current = formatActivityValue(field, currentValue);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:imcrm-w-[460px]" data-testid="imcrm-field-history">
                <SheetHeader>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <History className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <span className="imcrm-truncate">
                                {sprintf(/* translators: %s: field label */ __('Historial de «%s»'), field.label)}
                            </span>
                        </SheetTitle>
                        <SheetDescription>
                            {canRestore
                                ? __('Cada cambio de este campo, de lo más nuevo a lo más viejo. «Restaurar» vuelve a poner ese valor.')
                                : __('Cada cambio de este campo, de lo más nuevo a lo más viejo.')}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton />
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-[13px]">
                        <span className="imcrm-text-muted-foreground">{__('Valor actual:')}</span>
                        {current === null ? (
                            <span className="imcrm-italic imcrm-text-muted-foreground">{__('vacío')}</span>
                        ) : (
                            <ActivityValue field={field} raw={currentValue} text={current} />
                        )}
                    </div>

                    {history.isLoading ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden /> {__('Cargando historial…')}
                        </p>
                    ) : history.isError ? (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                            {(history.error as Error).message}
                        </p>
                    ) : entries.length === 0 ? (
                        <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Este campo todavía no tiene cambios registrados.')}
                        </p>
                    ) : (
                        <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2" aria-label={__('Cambios del campo')}>
                            {entries.map((entry, i) => (
                                <HistoryRow
                                    key={entry.id}
                                    entry={entry}
                                    field={field}
                                    isCurrent={i === 0 && sameFieldValue(entry.to, currentValue)}
                                    currentValue={currentValue}
                                    canRestore={canRestore}
                                    busy={pendingKey === `h-${entry.id}`}
                                    onRestore={async () => {
                                        const out = await restore(field, entry.to, currentValue, `h-${entry.id}`);
                                        if (out.ok) onRestored?.(entry.to, out.saved);
                                    }}
                                />
                            ))}
                        </ol>
                    )}

                    {history.hasNextPage && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="imcrm-self-center"
                            onClick={() => void history.fetchNextPage()}
                            disabled={history.isFetchingNextPage}
                        >
                            {history.isFetchingNextPage ? __('Cargando…') : __('Ver cambios anteriores')}
                        </Button>
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function HistoryRow({
    entry,
    field,
    isCurrent,
    currentValue,
    canRestore,
    busy,
    onRestore,
}: {
    entry: FieldHistoryEntry;
    field: FieldEntity;
    isCurrent: boolean;
    currentValue: unknown;
    canRestore: boolean;
    busy: boolean;
    onRestore: () => Promise<void>;
}): JSX.Element {
    const created = entry.action === 'record_created';
    const s = changeSentence({ label: field.label, field, from: entry.from, to: entry.to });
    const actor = entry.user_name?.trim() || (entry.user_id ? sprintf(__('Usuario #%d'), entry.user_id) : __('El sistema'));
    const check = checkRestoreValue(field, entry.to);
    const equalsCurrent = sameFieldValue(entry.to, currentValue);
    return (
        <li
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2.5',
                isCurrent ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'imcrm-border-border',
            )}
            data-testid="imcrm-field-history-entry"
        >
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2 imcrm-text-[13px]">
                <p className="imcrm-min-w-0 imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">{actor}</span>{' '}
                    {created ? __('lo estableció al crear el registro') : s.verb}
                </p>
                <time
                    dateTime={entry.created_at}
                    title={formatDateTimeStr(entry.created_at)}
                    className="imcrm-shrink-0 imcrm-whitespace-nowrap imcrm-text-[11px] imcrm-text-muted-foreground"
                >
                    {relativeTime(entry.created_at)}
                </time>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1 imcrm-text-[12.5px] imcrm-text-muted-foreground">
                {s.from !== null && <ActivityValue field={field} raw={entry.from} text={s.from} old />}
                {s.from !== null && <span aria-hidden>→</span>}
                {s.to !== null ? (
                    <ActivityValue field={field} raw={entry.to} text={s.to} />
                ) : (
                    <span className="imcrm-italic">{__('vacío')}</span>
                )}
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                {equalsCurrent ? (
                    <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-primary">{__('Es el valor actual')}</span>
                ) : !canRestore ? null : check.ok ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="imcrm-h-7 imcrm-gap-1.5 imcrm-text-xs"
                        disabled={busy}
                        onClick={() => void onRestore()}
                        data-testid="imcrm-field-history-restore"
                    >
                        {busy ? <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" aria-hidden /> : <RotateCcw className="imcrm-h-3 imcrm-w-3" aria-hidden />}
                        {__('Restaurar este valor')}
                    </Button>
                ) : (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11.5px] imcrm-text-muted-foreground" data-testid="imcrm-field-history-blocked">
                        <Info className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                        <span>{check.reason}</span>
                    </p>
                )}
            </div>
        </li>
    );
}

/**
 * «Restaurar» desde el feed de actividad: vuelve a poner el valor ANTERIOR
 * de ese cambio (deshace el cambio de ese campo). Si ya no se puede, el click
 * dice por qué (en un táctil no hay tooltip). No aparece si quien mira no
 * puede editar el registro, si el campo lo maneja la tienda o si ya tiene ese
 * valor.
 */
export function RestorePreviousButton({
    listId,
    recordId,
    field,
    value,
}: {
    listId: string | number;
    recordId: number;
    field: FieldEntity;
    value: unknown;
}): JSX.Element | null {
    const record = useRecord(listId, recordId);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const storeRules = useStoreRules();
    const { restore, pendingKey } = useRestoreFieldValue(listId, recordId);
    if (!canEdit || !record.data || !isDataField(field.type)) return null;
    if (storeAccessFor(storeRules, field, record.data)?.access === 'locked') return null;
    const currentValue = record.data.fields[field.slug];
    if (sameFieldValue(value, currentValue)) return null;
    const shown = formatActivityValue(field, value);
    const title = shown === null
        ? sprintf(/* translators: %s: field label */ __('Volver a dejar «%s» vacío, como estaba antes'), field.label)
        : sprintf(/* translators: 1: value, 2: field label */ __('Volver a poner «%1$s» en «%2$s»'), shown, field.label);
    const blocked = checkRestoreValue(field, value);
    return (
        <button
            type="button"
            onClick={() => void restore(field, value, currentValue, 'feed')}
            disabled={pendingKey !== null}
            title={blocked.ok ? title : blocked.reason}
            aria-label={blocked.ok ? title : `${__('No se puede restaurar')}: ${blocked.reason}`}
            data-testid="imcrm-activity-restore"
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-transition-colors',
                blocked.ok ? 'imcrm-text-primary hover:imcrm-bg-primary/10' : 'imcrm-text-muted-foreground/70 hover:imcrm-bg-accent',
            )}
        >
            {pendingKey !== null ? <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" aria-hidden /> : <RotateCcw className="imcrm-h-3 imcrm-w-3" aria-hidden />}
            {__('Restaurar')}
        </button>
    );
}
