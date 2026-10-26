import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

/** Campos que se pueden pedir al mover (los que se escriben a mano). */
export function requirableFields(fields: FieldEntity[], exclude: number[]): FieldEntity[] {
    const NOT = ['lookup', 'rollup', 'computed', 'formula', 'ai', 'time_tracked', 'approval', 'checklist_progress', 'relation', 'file'];
    return fields.filter((f) => !NOT.includes(f.type) && !exclude.includes(f.id)).sort((a, b) => a.position - b.position);
}

interface FieldChecklistProps {
    candidates: FieldEntity[];
    value: number[];
    onChange: (next: number[]) => void;
    idPrefix: string;
}

/** Lista de casillas de campos (reglas al mover). */
export function FieldChecklist({ candidates, value, onChange, idPrefix }: FieldChecklistProps): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-max-h-56 imcrm-grid-cols-1 imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2 sm:imcrm-grid-cols-2">
            {candidates.map((f) => {
                const id = `${idPrefix}-${f.id}`;
                const checked = value.includes(f.id);
                return (
                    <label key={f.id} htmlFor={id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-sm hover:imcrm-bg-accent/50">
                        <input
                            id={id}
                            type="checkbox"
                            checked={checked}
                            onChange={() => onChange(checked ? value.filter((x) => x !== f.id) : [...value, f.id])}
                            className="imcrm-h-3.5 imcrm-w-3.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                        />
                        <span className="imcrm-truncate">{f.label}</span>
                    </label>
                );
            })}
        </div>
    );
}

interface KanbanColumnSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    columnLabel: string;
    fields: FieldEntity[];
    /** Campos que no tiene sentido pedir (el de las columnas y el de los carriles). */
    excludeFieldIds: number[];
    wip: number | null;
    required: number[];
    onSave: (next: { wip: number | null; required: number[] }) => void;
}

/**
 * v0.1.297 — Ajustes de UNA columna del kanban (B5): el límite de tarjetas (WIP:
 * avisa, no bloquea) y los campos que se piden al mover una tarjeta a esta
 * columna. Se abre desde el menú de la columna.
 */
export function KanbanColumnSettingsDialog({
    open,
    onOpenChange,
    columnLabel,
    fields,
    excludeFieldIds,
    wip,
    required,
    onSave,
}: KanbanColumnSettingsDialogProps): JSX.Element {
    const [limit, setLimit] = useState('');
    const [ids, setIds] = useState<number[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setLimit(wip !== null ? String(wip) : '');
        setIds(required);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        const trimmed = limit.trim();
        let parsed: number | null = null;
        if (trimmed !== '') {
            const n = Number(trimmed);
            if (!Number.isInteger(n) || n < 1 || n > 10_000) {
                setError(__('El límite tiene que ser un número entero entre 1 y 10.000 (vacío = sin límite).'));
                return;
            }
            parsed = n;
        }
        onSave({ wip: parsed, required: ids });
        onOpenChange(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-kanban-column-settings"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {sprintf(
                                    /* translators: %s: column name */
                                    __('Columna «%s»'),
                                    columnLabel,
                                )}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Límite de tarjetas y qué se pide al mover una tarjeta aquí.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="kanban-col-wip">{__('Límite de tarjetas')}</Label>
                            <Input
                                id="kanban-col-wip"
                                inputMode="numeric"
                                placeholder={__('Sin límite')}
                                value={limit}
                                onChange={(e) => {
                                    setLimit(e.target.value);
                                    setError(null);
                                }}
                                className="imcrm-w-40"
                                autoFocus
                            />
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Cuando la columna lo supera se marca en rojo. No impide mover tarjetas.')}
                            </p>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Al mover una tarjeta aquí, pedir')}</Label>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Si alguno está vacío, se abre un formulario antes de mover (p. ej. «Motivo de pérdida» al pasar a «Perdido»).')}
                            </p>
                            <FieldChecklist candidates={requirableFields(fields, excludeFieldIds)} value={ids} onChange={setIds} idPrefix="kanban-col-req" />
                        </div>
                        {error !== null && (
                            <div role="alert" className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" data-testid="imcrm-kanban-column-save">
                                {__('Guardar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
