import { useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { CALENDAR_MAX_PER_DAY, type CalendarSource } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useCalendarBundle } from '@/hooks/useCalendarBundle';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { RecordEntity } from '@/types/record';

import { AgendaDayList } from './AgendaView';
import type { CalendarActions } from './calendarActions';
import { eventsOfDay, longDate, unloadedByDay, type CalendarEvent } from './calendarModel';

/**
 * «+N más» — TODOS los eventos de un día. Pide ese día solo al servidor (con
 * el tope máximo por día): el mes trae unos pocos por día y lo demás se
 * cuenta; aquí se ven enteros, con el mismo filtro y búsqueda de la vista.
 */
export function CalendarDayDialog({
    day,
    onClose,
    listId,
    sources,
    filterTree,
    search,
    build,
    actions,
}: {
    day: string | null;
    onClose: () => void;
    listId: number;
    sources: readonly CalendarSource[];
    filterTree?: unknown;
    search?: string;
    build: (records: readonly RecordEntity[]) => CalendarEvent[];
    actions: CalendarActions;
}): JSX.Element {
    const q = useCalendarBundle({
        listId,
        sources,
        from: day ?? '',
        to: day ?? '',
        filterTree,
        search,
        perDay: CALENDAR_MAX_PER_DAY,
        enabled: day !== null,
    });
    const events = useMemo(() => (day && q.data && q.data.meta.from === day ? eventsOfDay(build(q.data.records), day) : []), [day, q.data, build]);
    const left = day && q.data && q.data.meta.from === day ? unloadedByDay(events, q.data.days, [day]).get(day) ?? 0 : 0;
    const loading = day !== null && (!q.data || q.data.meta.from !== day);
    // Dentro del diálogo «+N más» no abre otro diálogo (el resto se explica), y
    // abrir o mover un evento lo cierra primero: no quedan dos modales apilados.
    const inner: CalendarActions = useMemo(
        () => ({
            ...actions,
            showDay: () => undefined,
            open: (ev: CalendarEvent) => {
                onClose();
                actions.open(ev);
            },
            moveTo: (ev: CalendarEvent) => {
                const fn = actions.moveTo(ev);
                return fn
                    ? (e: CalendarEvent) => {
                          onClose();
                          fn(e);
                      }
                    : undefined;
            },
            create: (slot: Parameters<CalendarActions['create']>[0]) => {
                onClose();
                actions.create(slot);
            },
        }),
        [actions, onClose],
    );
    return (
        <Dialog.Root open={day !== null} onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-cal-day-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{day ? longDate(day, Number(actions.today.slice(0, 4))) : ''}</Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {q.data && day && q.data.meta.from === day
                                    ? sprintf(__('%d eventos este día.'), q.data.days[day]?.n ?? events.length)
                                    : __('Cargando…')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <div className="imcrm-mt-3">
                        {loading ? (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />
                                {__('Cargando…')}
                            </p>
                        ) : (
                            day && <AgendaDayList day={day} events={events} unloaded={0} actions={inner} />
                        )}
                        {left > 0 && (
                            <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-cal-day-left">
                                {sprintf(__('Y %d más que no entran aquí: usa filtros para acotar.'), left)}
                            </p>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
