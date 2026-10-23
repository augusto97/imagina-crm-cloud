import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { RecordFieldsForm } from '../../RecordFieldsForm';
import { missingRequired } from './kanbanModel';

export interface PendingMove {
    record: RecordEntity;
    title: string;
    /** El cambio de columna/carril que se va a escribir. */
    values: Record<string, unknown>;
    /** Lo que pide la columna destino. */
    required: FieldEntity[];
    targetLabel: string;
}

interface KanbanMoveDialogProps {
    listId: number;
    pending: PendingMove | null;
    saving: boolean;
    error: string | null;
    onCancel: () => void;
    /** Valores del cambio + los campos que completó la persona. */
    onConfirm: (values: Record<string, unknown>) => void;
}

/**
 * v0.1.297 — Regla al mover (B5): al soltar la tarjeta en una columna que pide
 * campos (p. ej. «Perdido» → «Motivo de pérdida»), este diálogo los pide
 * antes de mover. Cancelar no cambia nada: la tarjeta se queda donde estaba
 * (el movimiento recién se escribe al confirmar). Los valores se validan como
 * cualquier edición; aquí sólo se exige que no queden vacíos.
 */
export function KanbanMoveDialog({ listId, pending, saving, error, onCancel, onConfirm }: KanbanMoveDialogProps): JSX.Element {
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Deps: el registro y la columna destino (no el objeto entero, que cambia de identidad).
    const pendingKey = pending ? `${pending.record.id}:${pending.targetLabel}` : null;
    useEffect(() => {
        if (!pending) return;
        const init: Record<string, unknown> = {};
        for (const f of pending.required) init[f.slug] = pending.record.fields[f.slug];
        setValues(init);
        setErrors({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingKey]);

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (!pending) return;
        const missing = missingRequired(pending.required, values);
        if (missing.length > 0) {
            setErrors(Object.fromEntries(missing.map((slug) => [slug, __('Completa este campo para mover la tarjeta.')])));
            return;
        }
        const extra: Record<string, unknown> = {};
        for (const f of pending.required) extra[f.slug] = values[f.slug];
        onConfirm({ ...extra, ...pending.values });
    };

    return (
        <Dialog.Root open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-kanban-move-dialog"
                >
                    {pending && (
                        <>
                            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                                <div className="imcrm-min-w-0">
                                    <Dialog.Title className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-base imcrm-font-semibold">
                                        <span className="imcrm-truncate">{pending.title}</span>
                                        <ArrowRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                        <span className="imcrm-truncate">{pending.targetLabel}</span>
                                    </Dialog.Title>
                                    <Dialog.Description className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                                        {sprintf(
                                            /* translators: %s: column name */
                                            __('Para pasar a «%s» completa:'),
                                            pending.targetLabel,
                                        )}
                                    </Dialog.Description>
                                </div>
                                <Dialog.Close asChild>
                                    <Button variant="ghost" size="icon" aria-label={__('Cancelar')}>
                                        <X className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                </Dialog.Close>
                            </div>
                            <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                                <RecordFieldsForm
                                    listId={listId}
                                    recordId={pending.record.id}
                                    fields={pending.required.map((f) => ({ ...f, is_required: true }))}
                                    values={values}
                                    onChange={(next) => {
                                        setValues(next);
                                        setErrors({});
                                    }}
                                    fieldErrors={errors}
                                />
                                {error !== null && (
                                    <div role="alert" className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                        {error}
                                    </div>
                                )}
                                <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                    <Button type="button" variant="outline" onClick={onCancel}>
                                        {__('Cancelar')}
                                    </Button>
                                    <Button type="submit" disabled={saving} data-testid="imcrm-kanban-move-confirm">
                                        {saving ? __('Moviendo…') : __('Mover')}
                                    </Button>
                                </div>
                            </form>
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
