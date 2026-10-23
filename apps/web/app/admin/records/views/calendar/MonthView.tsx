import { useMemo, useState } from 'react';
import { Lock, Repeat } from 'lucide-react';
import { addDaysYmd } from '@imagina-base/shared';

import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { CalendarActions } from './calendarActions';
import { eventStyle } from './calendarColors';
import {
    clockLabel,
    daysBetween,
    eventsOfDay,
    isWeekend,
    layoutWeek,
    weekdayShortByIndex,
    weekdayOf,
    type CalendarEvent,
} from './calendarModel';
import { AgendaDayList } from './AgendaView';
import { dayUnderPointer, useCalendarDrag, type DragPreview } from './useCalendarDrag';

/** Alto del número del día, de cada carril y del «+N más» (px). */
const HEADER_H = 26;
const LANE_H = 22;
const MORE_H = 20;
const MAX_LANES = 3;

/**
 * Vista Mes — se conserva el diseño de v0.1.125 (tarjeta, hoy en disco,
 * fines de semana y otros meses atenuados) y gana: eventos de VARIOS días
 * como barras que cruzan los días (acomodadas en carriles por semana),
 * arrastrar para cambiar el día conservando la hora, estirar el borde final
 * si la fuente tiene fin, clic en un hueco para crear ese día y «+N más»
 * que abre el día completo (también lo que el servidor no mandó).
 */
export function MonthView({
    weeks,
    month,
    showWeekends,
    events,
    unloaded,
    compact,
    actions,
}: {
    weeks: string[][];
    /** YYYY-MM del mes que se ve (los demás días van atenuados). */
    month: string;
    showWeekends: boolean;
    events: CalendarEvent[];
    unloaded: Map<string, number>;
    /** Teléfono: puntos por día y la lista del día elegido debajo. */
    compact: boolean;
    actions: CalendarActions;
}): JSX.Element {
    const visibleWeeks = useMemo(
        () => weeks.map((w) => (showWeekends ? w : w.filter((d) => !isWeekend(d)))),
        [weeks, showWeekends],
    );
    const cols = visibleWeeks[0]?.length ?? 7;

    const drag = useCalendarDrag({
        hitTest: (x, y) => {
            const day = dayUnderPointer(x, y);
            return day ? { day } : null;
        },
        onCommit: (p) => commitDrag(p, actions),
        onClick: () => undefined,
    });
    const ghost = useMemo(() => ghostDays(drag.preview), [drag.preview]);

    if (compact) return <CompactMonth weeks={visibleWeeks} month={month} events={events} unloaded={unloaded} actions={actions} />;

    return (
        <div
            className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm"
            data-testid="imcrm-cal-month"
        >
            <div className="imcrm-grid imcrm-border-b imcrm-border-border imcrm-bg-muted/40" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {(visibleWeeks[0] ?? []).map((d) => (
                    <div
                        key={d}
                        className={cn(
                            'imcrm-px-2 imcrm-py-2 imcrm-text-center imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground',
                            isWeekend(d) && 'imcrm-text-muted-foreground/70',
                        )}
                    >
                        {weekdayShortByIndex(weekdayOf(d))}
                    </div>
                ))}
            </div>
            {visibleWeeks.map((days, wi) => {
                const { bars, hiddenByCol } = layoutWeek(events, days, MAX_LANES);
                return (
                    <div
                        key={days[0] ?? wi}
                        className={cn('imcrm-relative imcrm-grid', wi < visibleWeeks.length - 1 && 'imcrm-border-b imcrm-border-border/70')}
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                        data-cal-week={days[0]}
                    >
                        {days.map((day, ci) => {
                            const inMonth = day.startsWith(month);
                            const isToday = day === actions.today;
                            const more = hiddenByCol[ci]! + (unloaded.get(day) ?? 0);
                            return (
                                <div
                                    key={day}
                                    data-cal-day={day}
                                    onClick={actions.canCreate ? () => actions.create({ day }) : undefined}
                                    title={actions.canCreate ? __('Clic para crear un registro este día') : undefined}
                                    className={cn(
                                        'imcrm-relative imcrm-flex imcrm-flex-col imcrm-border-r imcrm-border-border/70 imcrm-transition-colors',
                                        ci === days.length - 1 && 'imcrm-border-r-0',
                                        inMonth ? (isWeekend(day) ? 'imcrm-bg-muted/20' : 'imcrm-bg-card') : 'imcrm-bg-muted/40',
                                        actions.canCreate && 'imcrm-cursor-pointer hover:imcrm-bg-accent/40',
                                        ghost.has(day) && 'imcrm-bg-primary/10 imcrm-ring-2 imcrm-ring-inset imcrm-ring-primary/50',
                                    )}
                                    style={{ minHeight: HEADER_H + MAX_LANES * LANE_H + MORE_H + 8 }}
                                >
                                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-px-1.5 imcrm-pt-1" style={{ height: HEADER_H }}>
                                        <span
                                            className={cn(
                                                'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-[12px] imcrm-font-semibold',
                                                isToday
                                                    ? 'imcrm-bg-primary imcrm-text-primary-foreground'
                                                    : inMonth
                                                      ? 'imcrm-text-foreground'
                                                      : 'imcrm-text-muted-foreground/70',
                                            )}
                                        >
                                            {Number(day.slice(8, 10))}
                                        </span>
                                    </div>
                                    {more > 0 && (
                                        <button
                                            type="button"
                                            data-testid="imcrm-cal-more"
                                            data-day={day}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                actions.showDay(day);
                                            }}
                                            className="imcrm-absolute imcrm-left-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                            style={{ top: HEADER_H + MAX_LANES * LANE_H + 2 }}
                                        >
                                            {sprintf(__('+%d más'), more)}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                        {/* Las barras van en una capa encima: los clics en los huecos pasan a la celda. */}
                        <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0">
                            {bars.map((b) => {
                                const ev = b.event;
                                const locked = actions.lockedReason(ev, 'move');
                                const draggable = actions.dragEnabled && locked === null;
                                const resizable = actions.dragEnabled && !b.continuesAfter && actions.canResize(ev) && actions.lockedReason(ev, 'resize') === null;
                                const dragging = drag.preview?.moved && drag.preview.event?.key === ev.key;
                                const time = ev.span.hasTime && !(ev.span.inStrip && ev.span.endMinute === 1440 && ev.span.startMinute === 0) && !b.continuesBefore ? clockLabel(ev.span.startMinute, actions.h12) : null;
                                return (
                                    <button
                                        key={`${ev.key}:${b.startCol}`}
                                        type="button"
                                        data-cal-event={ev.key}
                                        data-testid="imcrm-cal-event"
                                        onPointerDown={draggable ? (e) => drag.start(e, 'move', ev) : undefined}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            actions.open(ev);
                                        }}
                                        title={eventTooltip(ev, actions, locked)}
                                        className={cn(
                                            'imcrm-pointer-events-auto imcrm-absolute imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-overflow-hidden imcrm-border-l-[3px] imcrm-px-1.5 imcrm-text-left imcrm-text-[11px] imcrm-font-medium imcrm-leading-tight hover:imcrm-brightness-95',
                                            b.continuesBefore ? 'imcrm-rounded-l-none imcrm-border-l-0 imcrm-pl-2' : 'imcrm-rounded-l',
                                            b.continuesAfter ? 'imcrm-rounded-r-none' : 'imcrm-rounded-r',
                                            draggable && 'imcrm-cursor-grab active:imcrm-cursor-grabbing',
                                            dragging && 'imcrm-opacity-40',
                                        )}
                                        style={{
                                            ...eventStyle(ev.color, { solid: ev.span.endDay > ev.span.startDay }),
                                            top: HEADER_H + b.lane * LANE_H,
                                            height: LANE_H - 3,
                                            left: `calc(${(b.startCol * 100) / cols}% + 3px)`,
                                            width: `calc(${((b.endCol - b.startCol + 1) * 100) / cols}% - 6px)`,
                                        }}
                                    >
                                        {actions.recurring(ev) && <Repeat className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-70" aria-label={__('Recurrente')} />}
                                        {locked && actions.dragEnabled && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-60" aria-hidden />}
                                        {time && <span className="imcrm-shrink-0 imcrm-tabular-nums imcrm-font-semibold">{time}</span>}
                                        <span className="imcrm-truncate">{ev.title}</span>
                                        {resizable && (
                                            <span
                                                aria-hidden
                                                data-testid="imcrm-cal-resize"
                                                onPointerDown={(e) => drag.start(e, 'resize', ev)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="imcrm-absolute imcrm-inset-y-0 imcrm-right-0 imcrm-w-2 imcrm-cursor-ew-resize"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Los días que ocuparía el evento si se suelta aquí (el resaltado del arrastre). */
function ghostDays(p: DragPreview | null): Set<string> {
    const out = new Set<string>();
    if (!p || !p.moved || !p.event) return out;
    const { startDay, endDay } = p.event.span;
    if (p.kind === 'move') {
        const delta = daysBetween(p.origin.day, p.target.day);
        const len = daysBetween(startDay, endDay);
        const from = addDaysYmd(startDay, delta);
        for (let i = 0; i <= Math.min(len, 60); i++) out.add(addDaysYmd(from, i));
    } else if (p.kind === 'resize') {
        const to = p.target.day < startDay ? startDay : p.target.day;
        for (let i = 0; i <= Math.min(daysBetween(startDay, to), 60); i++) out.add(addDaysYmd(startDay, i));
    }
    return out;
}

/** Soltar en el mes: mover conserva la hora; estirar llega hasta ese día. */
function commitDrag(p: DragPreview, actions: CalendarActions): void {
    if (!p.event) return;
    if (p.kind === 'move') {
        const delta = daysBetween(p.origin.day, p.target.day);
        if (delta === 0) return;
        actions.commitMove(p.event, { day: addDaysYmd(p.event.span.startDay, delta) });
    } else if (p.kind === 'resize') {
        actions.commitResize(p.event, { day: p.target.day });
    }
}

export function eventTooltip(ev: CalendarEvent, actions: Pick<CalendarActions, 'h12' | 'showSource' | 'sourceLabel'>, locked?: string | null): string {
    const parts = [ev.title];
    if (ev.span.hasTime && !ev.span.inStrip) {
        parts.push(`${clockLabel(ev.span.startMinute, actions.h12)} – ${clockLabel(ev.span.endMinute, actions.h12)}`);
    } else if (ev.span.hasTime) {
        parts.push(clockLabel(ev.span.startMinute, actions.h12));
    }
    if (actions.showSource) parts.push(actions.sourceLabel(ev));
    if (locked) parts.push(locked);
    return parts.join(' · ');
}

/**
 * El mes en el teléfono (v0.1.286): cada celda mide ~50 px, así que muestra
 * puntos y la lista del día elegido va debajo.
 */
function CompactMonth({
    weeks,
    month,
    events,
    unloaded,
    actions,
}: {
    weeks: string[][];
    month: string;
    events: CalendarEvent[];
    unloaded: Map<string, number>;
    actions: CalendarActions;
}): JSX.Element {
    const flat = weeks.flat();
    const [selected, setSelected] = useState<string | null>(null);
    const day = selected ?? (flat.includes(actions.today) ? actions.today : flat.find((d) => d.startsWith(month)) ?? flat[0] ?? actions.today);
    const cols = weeks[0]?.length ?? 7;
    const dayEvents = eventsOfDay(events, day);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-cal-month">
            <div className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">
                <div className="imcrm-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                    {flat.map((d, idx) => {
                        const list = eventsOfDay(events, d);
                        const n = list.length + (unloaded.get(d) ?? 0);
                        return (
                            <button
                                type="button"
                                key={d}
                                onClick={() => setSelected(d)}
                                aria-pressed={d === day}
                                aria-label={sprintf(_n('Día %1$d, %2$d evento', 'Día %1$d, %2$d eventos', n), Number(d.slice(8, 10)), n)}
                                className={cn(
                                    'imcrm-flex imcrm-min-h-[52px] imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-border-b imcrm-border-r imcrm-border-border/70 imcrm-py-1.5',
                                    idx % cols === cols - 1 && 'imcrm-border-r-0',
                                    d.startsWith(month) ? 'imcrm-bg-card' : 'imcrm-bg-muted/40 imcrm-text-muted-foreground',
                                    d === day && 'imcrm-bg-accent',
                                )}
                            >
                                <span
                                    className={cn(
                                        'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-[12px] imcrm-font-semibold',
                                        d === actions.today && 'imcrm-bg-primary imcrm-text-primary-foreground',
                                    )}
                                >
                                    {Number(d.slice(8, 10))}
                                </span>
                                {n > 0 && (
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-0.5" aria-hidden>
                                        {list.slice(0, 3).map((e) => (
                                            <span key={e.key} className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full" style={{ backgroundColor: e.color }} />
                                        ))}
                                        {n > 3 && <span className="imcrm-text-[9px] imcrm-font-semibold imcrm-text-muted-foreground">+</span>}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
            <AgendaDayList day={day} events={dayEvents} unloaded={unloaded.get(day) ?? 0} actions={actions} />
        </div>
    );
}
