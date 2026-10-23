import { useEffect, useRef } from 'react';
import { CalendarDays, Loader2, Repeat } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { CalendarActions } from './calendarActions';
import { CalendarEventMenu } from './CalendarEventMenu';
import { clockLabel, daysBetween, eventsOfDay, longDate, shortDate, type CalendarEvent } from './calendarModel';
import { ROW_COLOR_HEX } from '../../grid/colorRules';
import { MAIN_SCROLLER_ID } from '../stickyTop';

/**
 * Agenda — la lista por día de lo que viene, desde el día elegido. Se pide
 * por rangos de 30 días a medida que se baja (scroll infinito); los días sin
 * nada no se muestran. Cada evento trae su «…» con «Mover a…».
 */
export function AgendaView({
    days,
    events,
    unloaded,
    loading,
    hasMore,
    loadingMore,
    onLoadMore,
    rangeEnd,
    actions,
}: {
    /** Días cargados, en orden. */
    days: string[];
    events: CalendarEvent[];
    unloaded: Map<string, number>;
    loading: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    /** Último día cargado (para decir hasta dónde se miró). */
    rangeEnd: string | null;
    actions: CalendarActions;
}): JSX.Element {
    const withEvents = days.filter((d) => (unloaded.get(d) ?? 0) > 0 || events.some((e) => e.span.startDay <= d && e.span.endDay >= d));
    const sentinel = useRef<HTMLDivElement>(null);
    const loadMore = useRef(onLoadMore);
    loadMore.current = onLoadMore;
    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) loadMore.current();
            },
            { root: document.getElementById(MAIN_SCROLLER_ID), rootMargin: '0px 0px 400px 0px' },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, withEvents.length]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-cal-agenda">
            {withEvents.map((d) => (
                <AgendaDayList key={d} day={d} events={eventsOfDay(events, d)} unloaded={unloaded.get(d) ?? 0} actions={actions} withHeader />
            ))}
            {!loading && withEvents.length === 0 && (
                <p className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-8 imcrm-text-sm imcrm-text-muted-foreground">
                    <CalendarDays className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {rangeEnd ? sprintf(__('Nada programado hasta el %s.'), shortDate(rangeEnd)) : __('Nada programado.')}
                </p>
            )}
            <div ref={sentinel} aria-hidden className="imcrm-h-px" />
            {(loading || loadingMore) && (
                <p className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />
                    {__('Cargando…')}
                </p>
            )}
            {hasMore && !loading && !loadingMore && (
                <div className="imcrm-flex imcrm-justify-center">
                    <Button variant="outline" size="sm" onClick={onLoadMore} data-testid="imcrm-cal-agenda-more">
                        {rangeEnd ? sprintf(__('Ver después del %s'), shortDate(rangeEnd)) : __('Ver más')}
                    </Button>
                </div>
            )}
        </div>
    );
}

/** Los eventos de UN día, como renglones (la agenda y el día elegido del mes en el teléfono). */
export function AgendaDayList({
    day,
    events,
    unloaded,
    actions,
    withHeader = false,
}: {
    day: string;
    events: CalendarEvent[];
    unloaded: number;
    actions: CalendarActions;
    withHeader?: boolean;
}): JSX.Element {
    const isToday = day === actions.today;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" aria-label={longDate(day)} data-cal-agenda-day={day}>
            <h3 className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold', !withHeader && 'imcrm-text-[13px]')}>
                <span className={cn(isToday && 'imcrm-text-primary')}>{longDate(day, Number(actions.today.slice(0, 4)))}</span>
                {isToday && (
                    <span className="imcrm-rounded-full imcrm-bg-primary imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary-foreground">{__('Hoy')}</span>
                )}
                {actions.canCreate && (
                    <button
                        type="button"
                        onClick={() => actions.create({ day })}
                        className="imcrm-ml-auto imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-normal imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    >
                        {__('+ Agregar')}
                    </button>
                )}
            </h3>
            {events.length === 0 && unloaded === 0 ? (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin eventos este día.')}</p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    {events.map((ev) => (
                        <li key={ev.key}>
                            <AgendaRow ev={ev} day={day} actions={actions} />
                        </li>
                    ))}
                </ul>
            )}
            {unloaded > 0 && (
                <button
                    type="button"
                    onClick={() => actions.showDay(day)}
                    data-testid="imcrm-cal-more"
                    data-day={day}
                    className="imcrm-self-start imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                >
                    {sprintf(__('+%d más'), unloaded)}
                </button>
            )}
        </section>
    );
}

/** «09:00 – 10:30», «Todo el día» o «Día 2 de 3». */
export function agendaTimeLabel(ev: CalendarEvent, day: string, h12: boolean): string {
    const { span } = ev;
    const total = daysBetween(span.startDay, span.endDay) + 1;
    if (total > 1) {
        const n = daysBetween(span.startDay, day) + 1;
        const base = sprintf(__('Día %1$d de %2$d'), n, total);
        if (span.hasTime && day === span.startDay) return `${base} · ${sprintf(__('desde las %s'), clockLabel(span.startMinute, h12))}`;
        if (span.hasTime && day === span.endDay && span.endMinute < 1440) return `${base} · ${sprintf(__('hasta las %s'), clockLabel(span.endMinute, h12))}`;
        return base;
    }
    if (!span.hasTime) return __('Todo el día');
    if (span.inStrip) return clockLabel(span.startMinute, h12);
    return `${clockLabel(span.startMinute, h12)} – ${clockLabel(span.endMinute, h12)}`;
}

function AgendaRow({ ev, day, actions }: { ev: CalendarEvent; day: string; actions: CalendarActions }): JSX.Element {
    const locked = actions.lockedReason(ev, 'move');
    return (
        <div
            className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-pr-1 hover:imcrm-bg-accent/40"
            data-cal-event={ev.key}
        >
            <span aria-hidden className="imcrm-w-1 imcrm-self-stretch imcrm-rounded-l-md" style={{ backgroundColor: ev.color }} />
            <button
                type="button"
                data-testid="imcrm-cal-event"
                onClick={() => actions.open(ev)}
                className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-items-start imcrm-gap-0.5 imcrm-py-2 imcrm-text-left sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-gap-3"
            >
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground sm:imcrm-w-40">{agendaTimeLabel(ev, day, actions.h12)}</span>
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                    {actions.recurring(ev) && <Repeat className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-label={__('Recurrente')} />}
                    <span className="imcrm-break-words">{ev.title}</span>
                </span>
                {actions.showSource && (
                    <span
                        className="imcrm-shrink-0 imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium"
                        style={{ backgroundColor: `color-mix(in srgb, ${ROW_COLOR_HEX[ev.source.color]} 16%, transparent)` }}
                    >
                        {actions.sourceLabel(ev)}
                    </span>
                )}
            </button>
            <CalendarEventMenu event={ev} onOpen={actions.open} onMoveTo={actions.moveTo(ev)} lockedReason={locked} />
        </div>
    );
}
