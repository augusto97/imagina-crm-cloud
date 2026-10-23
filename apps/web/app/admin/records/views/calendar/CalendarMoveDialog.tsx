import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { timeZoneLabel } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { cellsFromMoveForm, moveFormFor, shiftMoveForm, sourceFields, type CalendarCell, type CalendarEvent, type MoveForm } from './calendarModel';

/**
 * «Mover a…» — reprogramar un evento sin arrastrar (el camino del celular, y
 * el de quien usa el teclado): el día y la hora de inicio y, si la fuente
 * tiene, el fin o la duración. Las horas son las de la EMPRESA.
 */
export function CalendarMoveDialog({
    event,
    fieldsById,
    timeZone,
    saving,
    error,
    onCancel,
    onConfirm,
}: {
    event: CalendarEvent | null;
    fieldsById: ReadonlyMap<number, FieldEntity>;
    timeZone: string;
    saving: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: (event: CalendarEvent, cells: CalendarCell[]) => void;
}): JSX.Element {
    const [form, setForm] = useState<MoveForm | null>(null);
    const [localError, setLocalError] = useState<string | null>(null);
    useEffect(() => {
        setForm(event ? moveFormFor(event, fieldsById, timeZone) : null);
        setLocalError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [event?.key]);

    const f = event ? sourceFields(event.source, fieldsById) : null;
    const hasTime = f?.start.type === 'datetime';
    const set = (patch: Partial<MoveForm>): void => setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    // Cambiar el inicio corre el fin lo mismo (se conserva la duración).
    const setStart = (patch: Partial<Pick<MoveForm, 'startDay' | 'startTime'>>): void =>
        setForm((prev) => (prev ? shiftMoveForm(prev, { startDay: patch.startDay ?? prev.startDay, startTime: patch.startTime ?? prev.startTime }, hasTime, timeZone) : prev));

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        if (!event || !form) return;
        const res = cellsFromMoveForm(event, fieldsById, form, timeZone);
        if ('error' in res) {
            setLocalError(res.error);
            return;
        }
        if (res.cells.length === 0) {
            onCancel();
            return;
        }
        onConfirm(event, res.cells);
    };

    return (
        <Dialog.Root open={event !== null} onOpenChange={(open) => !open && onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-cal-move-dialog"
                >
                    {event && form && f && (
                        <>
                            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                                <div className="imcrm-min-w-0">
                                    <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                        {sprintf(__('Mover «%s»'), event.title)}
                                    </Dialog.Title>
                                    <Dialog.Description className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                        {hasTime
                                            ? sprintf(__('Horas de %s (la zona de la empresa).'), timeZoneLabel(timeZone))
                                            : __('Fecha sin hora: es el mismo día en cualquier zona.')}
                                    </Dialog.Description>
                                </div>
                                <Dialog.Close asChild>
                                    <Button variant="ghost" size="icon" aria-label={__('Cancelar')}>
                                        <X className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                </Dialog.Close>
                            </div>
                            <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                    <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1', !hasTime && 'imcrm-col-span-2')}>
                                        <Label htmlFor="cal-move-start">{f.start.label}</Label>
                                        <Input id="cal-move-start" type="date" value={form.startDay} onChange={(e) => setStart({ startDay: e.target.value })} required />
                                    </div>
                                    {hasTime && (
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                            <Label htmlFor="cal-move-start-time">{__('Hora')}</Label>
                                            <Input id="cal-move-start-time" type="time" step={900} value={form.startTime} onChange={(e) => setStart({ startTime: e.target.value })} required />
                                        </div>
                                    )}
                                </div>
                                {f.end && (
                                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1', !hasTime && 'imcrm-col-span-2')}>
                                            <Label htmlFor="cal-move-end">{f.end.label}</Label>
                                            <Input id="cal-move-end" type="date" value={form.endDay} onChange={(e) => set({ endDay: e.target.value })} />
                                        </div>
                                        {hasTime && (
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                                <Label htmlFor="cal-move-end-time">{__('Hora')}</Label>
                                                <Input id="cal-move-end-time" type="time" step={900} value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} />
                                            </div>
                                        )}
                                    </div>
                                )}
                                {f.duration && (
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label htmlFor="cal-move-dur">{sprintf(__('%s (minutos)'), f.duration.label)}</Label>
                                        <Input id="cal-move-dur" type="number" min={1} step={15} value={form.duration} onChange={(e) => set({ duration: e.target.value })} />
                                    </div>
                                )}
                                {(localError ?? error) !== null && (
                                    <div role="alert" className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                        {localError ?? error}
                                    </div>
                                )}
                                <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                    <Button type="button" variant="outline" onClick={onCancel}>
                                        {__('Cancelar')}
                                    </Button>
                                    <Button type="submit" disabled={saving} data-testid="imcrm-cal-move-confirm">
                                        {saving ? __('Guardando…') : __('Mover')}
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
