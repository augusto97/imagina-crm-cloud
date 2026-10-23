import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, Repeat } from 'lucide-react';
import { addDaysYmd } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { CalendarActions } from './calendarActions';
import { eventStyle } from './calendarColors';
import { CalendarEventMenu } from './CalendarEventMenu';
import {
    clockLabel,
    daysBetween,
    layoutDay,
    layoutWeek,
    moveTargetInGrid,
    nowInZone,
    snapMinutes,
    weekdayShort,
    type CalendarEvent,
} from './calendarModel';
import { eventTooltip } from './MonthView';
import { usePageStickyTop } from '../stickyTop';
import { dayUnderPointer, useCalendarDrag, type DragPreview } from './useCalendarDrag';

/** Alto de una hora en la grilla (px): 15 minutos = 12 px. */
export const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const GUTTER = 56;
const STRIP_LANE = 22;
const STRIP_LANES = 3;

/**
 * Semana y Día — grilla de horas en el reloj de la EMPRESA: los eventos con
 * hora son bloques con su duración (los que se pisan, lado a lado), y arriba
 * la franja «Todo el día» con las fechas sin hora y lo de varios días.
 *
 * Con el mouse: arrastrar un bloque cambia el día y la hora (encaje a 15
 * minutos), estirar su borde inferior cambia el fin (o la duración), y
 * arrastrar en un hueco crea con inicio y fin; un clic en un hueco crea en
 * esa hora. La línea roja es la hora actual de la empresa.
 */
export function TimeGridView({
    days,
    events,
    unloaded,
    dayStartHour,
    dayEndHour,
    defaultDuration,
    actions,
}: {
    days: string[];
    events: CalendarEvent[];
    unloaded: Map<string, number>;
    dayStartHour: number;
    dayEndHour: number;
    defaultDuration: number;
    actions: CalendarActions;
}): JSX.Element {
    const windowStart = dayStartHour * 60;
    const windowEnd = dayEndHour * 60;
    const height = (windowEnd - windowStart) * PX_PER_MIN;
    const cols = days.length;
    const bodyRef = useRef<HTMLDivElement>(null);
    const stickyTop = usePageStickyTop();

    // La línea roja: se mueve cada minuto.
    const [now, setNow] = useState(() => nowInZone(actions.timeZone));
    useEffect(() => {
        setNow(nowInZone(actions.timeZone));
        const t = window.setInterval(() => setNow(nowInZone(actions.timeZone)), 60_000);
        return () => window.clearInterval(t);
    }, [actions.timeZone]);

    const stripEvents = useMemo(() => events.filter((e) => e.span.inStrip), [events]);
    const strip = useMemo(() => layoutWeek(stripEvents, days, STRIP_LANES), [stripEvents, days]);
    const stripLanes = Math.max(1, Math.min(STRIP_LANES, strip.bars.reduce((m, b) => Math.max(m, b.lane + 1), 0)));
    const stripHasMore = strip.hiddenByCol.some((n) => n > 0);
    const columns = useMemo(() => days.map((d) => layoutDay(events, d, windowStart, windowEnd)), [days, events, windowStart, windowEnd]);

    // ── Arrastre en la grilla de horas ──
    const hitBody = (x: number, y: number): { day: string; minute: number } | null => {
        const el = bodyRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const colW = (r.width - GUTTER) / cols;
        if (colW <= 0) return null;
        const ci = Math.max(0, Math.min(cols - 1, Math.floor((x - r.left - GUTTER) / colW)));
        const minute = Math.max(windowStart, Math.min(windowEnd, windowStart + (y - r.top) / PX_PER_MIN));
        return { day: days[ci]!, minute };
    };
    const grid = useCalendarDrag({
        hitTest: hitBody,
        onCommit: (p) => commitGrid(p, actions, windowStart, windowEnd),
        onClick: (p) => {
            if (p.kind !== 'create' || !actions.canCreate) return;
            const minute = Math.min(windowEnd - 15, Math.floor((p.origin.minute ?? windowStart) / 15) * 15);
            const len = defaultDuration > 0 ? defaultDuration : 60;
            actions.create({ day: p.origin.day, minute, endMinute: Math.min(1440, minute + len) });
        },
    });
    // ── Arrastre en la franja «Todo el día» (por días) ──
    const stripDrag = useCalendarDrag({
        hitTest: (x, y) => {
            const day = dayUnderPointer(x, y, 'data-cal-strip-day');
            return day ? { day } : null;
        },
        onCommit: (p) => {
            if (!p.event) return;
            if (p.kind === 'move') {
                const delta = daysBetween(p.origin.day, p.target.day);
                if (delta !== 0) actions.commitMove(p.event, { day: addDaysYmd(p.event.span.startDay, delta) });
            } else if (p.kind === 'resize') {
                actions.commitResize(p.event, { day: p.target.day });
            }
        },
        onClick: () => undefined,
    });

    const ghost = ghostBlock(grid.preview, windowStart, windowEnd);
    const stripGhost = useMemo(() => stripGhostDays(stripDrag.preview), [stripDrag.preview]);
    const gridTemplate = `${GUTTER}px repeat(${cols}, minmax(0, 1fr))`;

    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm" data-testid="imcrm-cal-timegrid">
            {/* Cabecera: los días y la franja «Todo el día» quedan a la vista al bajar. */}
            <div className="imcrm-sticky imcrm-z-20 imcrm-rounded-t-xl imcrm-border-b imcrm-border-border imcrm-bg-card" style={{ top: stickyTop }}>
                <div className="imcrm-grid" style={{ gridTemplateColumns: gridTemplate }}>
                    <div />
                    {days.map((d) => {
                        const isToday = d === actions.today;
                        const more = unloaded.get(d) ?? 0;
                        return (
                            <div key={d} className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-0.5 imcrm-border-l imcrm-border-border/60 imcrm-py-1.5" data-cal-head={d}>
                                <span className="imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">{weekdayShort(d)}</span>
                                <span
                                    className={cn(
                                        'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-sm imcrm-font-semibold',
                                        isToday && 'imcrm-bg-primary imcrm-text-primary-foreground',
                                    )}
                                >
                                    {Number(d.slice(8, 10))}
                                </span>
                                {more > 0 && (
                                    <button
                                        type="button"
                                        data-testid="imcrm-cal-more"
                                        data-day={d}
                                        onClick={() => actions.showDay(d)}
                                        className="imcrm-rounded imcrm-px-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                    >
                                        {sprintf(__('+%d más'), more)}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="imcrm-relative imcrm-grid imcrm-border-t imcrm-border-border/60" style={{ gridTemplateColumns: gridTemplate }} data-testid="imcrm-cal-strip">
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-end imcrm-px-1.5 imcrm-pt-1 imcrm-text-[10px] imcrm-leading-tight imcrm-text-muted-foreground">
                        {__('Todo el día')}
                    </div>
                    {days.map((d, ci) => (
                        <div
                            key={d}
                            data-cal-strip-day={d}
                            onClick={actions.canCreate ? () => actions.create({ day: d }) : undefined}
                            className={cn(
                                'imcrm-relative imcrm-border-l imcrm-border-border/60',
                                actions.canCreate && 'imcrm-cursor-pointer hover:imcrm-bg-accent/40',
                                stripGhost.has(d) && 'imcrm-bg-primary/10',
                            )}
                            style={{ minHeight: stripLanes * STRIP_LANE + (stripHasMore ? 18 : 0) + 6 }}
                        >
                            {strip.hiddenByCol[ci]! > 0 && (
                                <button
                                    type="button"
                                    data-testid="imcrm-cal-more"
                                    data-day={d}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        actions.showDay(d);
                                    }}
                                    className="imcrm-absolute imcrm-left-1 imcrm-rounded imcrm-px-1 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground hover:imcrm-bg-accent"
                                    style={{ top: stripLanes * STRIP_LANE + 3 }}
                                >
                                    {sprintf(__('+%d más'), strip.hiddenByCol[ci]!)}
                                </button>
                            )}
                        </div>
                    ))}
                    <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-0 imcrm-right-0" style={{ left: GUTTER }}>
                        {strip.bars.map((b) => {
                            const ev = b.event;
                            const locked = actions.lockedReason(ev, 'move');
                            const draggable = actions.dragEnabled && locked === null;
                            const resizable = actions.dragEnabled && !b.continuesAfter && actions.canResize(ev) && actions.lockedReason(ev, 'resize') === null;
                            const dragging = stripDrag.preview?.moved && stripDrag.preview.event?.key === ev.key;
                            return (
                                <button
                                    key={`${ev.key}:${b.startCol}`}
                                    type="button"
                                    data-cal-event={ev.key}
                                    data-testid="imcrm-cal-event"
                                    onPointerDown={draggable ? (e) => stripDrag.start(e, 'move', ev) : undefined}
                                    onClick={() => actions.open(ev)}
                                    title={eventTooltip(ev, actions, locked)}
                                    className={cn(
                                        'imcrm-pointer-events-auto imcrm-absolute imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-overflow-hidden imcrm-border-l-[3px] imcrm-px-1.5 imcrm-text-left imcrm-text-[11px] imcrm-font-medium hover:imcrm-brightness-95',
                                        b.continuesBefore ? 'imcrm-rounded-l-none imcrm-border-l-0' : 'imcrm-rounded-l',
                                        b.continuesAfter ? 'imcrm-rounded-r-none' : 'imcrm-rounded-r',
                                        draggable && 'imcrm-cursor-grab',
                                        dragging && 'imcrm-opacity-40',
                                    )}
                                    style={{
                                        ...eventStyle(ev.color, { solid: true }),
                                        top: 3 + b.lane * STRIP_LANE,
                                        height: STRIP_LANE - 3,
                                        left: `calc(${(b.startCol * 100) / cols}% + 3px)`,
                                        width: `calc(${((b.endCol - b.startCol + 1) * 100) / cols}% - 6px)`,
                                    }}
                                >
                                    {actions.recurring(ev) && <Repeat className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-70" aria-label={__('Recurrente')} />}
                                    {locked && actions.dragEnabled && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-60" aria-hidden />}
                                    {ev.span.hasTime && !b.continuesBefore && (
                                        <span className="imcrm-shrink-0 imcrm-tabular-nums imcrm-font-semibold">{clockLabel(ev.span.startMinute, actions.h12)}</span>
                                    )}
                                    <span className="imcrm-truncate">{ev.title}</span>
                                    {resizable && (
                                        <span
                                            aria-hidden
                                            data-testid="imcrm-cal-resize"
                                            onPointerDown={(e) => stripDrag.start(e, 'resize', ev)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="imcrm-absolute imcrm-inset-y-0 imcrm-right-0 imcrm-w-2 imcrm-cursor-ew-resize"
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Cuerpo: horas. */}
            <div ref={bodyRef} className="imcrm-relative imcrm-grid" style={{ gridTemplateColumns: gridTemplate, height }} data-testid="imcrm-cal-body">
                <div className="imcrm-relative">
                    {Array.from({ length: dayEndHour - dayStartHour }, (_, i) => (
                        <span
                            key={i}
                            className="imcrm-absolute imcrm-right-1.5 imcrm-text-[10px] imcrm-tabular-nums imcrm-text-muted-foreground"
                            style={{ top: i * HOUR_PX - (i === 0 ? 0 : 6) }}
                        >
                            {clockLabel((dayStartHour + i) * 60, actions.h12)}
                        </span>
                    ))}
                </div>
                {days.map((d, ci) => {
                    const col = columns[ci]!;
                    const isToday = d === actions.today;
                    return (
                        <div
                            key={d}
                            data-cal-col={d}
                            onPointerDown={actions.canCreate ? (e) => grid.start(e, 'create', null) : undefined}
                            onClick={
                                actions.canCreate && actions.touch
                                    ? (e) => {
                                          // Táctil: no hay arrastre; un toque crea en esa hora.
                                          const hit = hitBody(e.clientX, e.clientY);
                                          if (!hit) return;
                                          const minute = Math.floor(hit.minute / 15) * 15;
                                          actions.create({ day: d, minute, endMinute: Math.min(1440, minute + (defaultDuration > 0 ? defaultDuration : 60)) });
                                      }
                                    : undefined
                            }
                            className={cn('imcrm-relative imcrm-border-l imcrm-border-border/60', isToday && 'imcrm-bg-primary/[0.03]', actions.canCreate && 'imcrm-cursor-cell')}
                        >
                            {Array.from({ length: dayEndHour - dayStartHour }, (_, i) => (
                                <div key={i} aria-hidden className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-0 imcrm-border-t imcrm-border-border/60" style={{ top: i * HOUR_PX }}>
                                    <div className="imcrm-border-t imcrm-border-dashed imcrm-border-border/30" style={{ marginTop: HOUR_PX / 2 - 1 }} />
                                </div>
                            ))}
                            {col.before.length > 0 && (
                                <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => actions.showDay(d)}
                                    className="imcrm-absolute imcrm-inset-x-1 imcrm-top-0.5 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                >
                                    <ChevronUp className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                    {sprintf(__('%1$d antes de las %2$s'), col.before.length, clockLabel(windowStart, actions.h12))}
                                </button>
                            )}
                            {col.after.length > 0 && (
                                <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => actions.showDay(d)}
                                    className="imcrm-absolute imcrm-inset-x-1 imcrm-bottom-0.5 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                >
                                    <ChevronDown className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                    {sprintf(__('%1$d después de las %2$s'), col.after.length, clockLabel(windowEnd, actions.h12))}
                                </button>
                            )}
                            {col.blocks.map((b) => {
                                const ev = b.event;
                                const locked = actions.lockedReason(ev, 'move');
                                const draggable = actions.dragEnabled && locked === null;
                                const resizable = actions.dragEnabled && !b.cutBottom && actions.canResize(ev) && actions.lockedReason(ev, 'resize') === null;
                                const dragging = grid.preview?.moved && grid.preview.event?.key === ev.key;
                                const px = b.height * PX_PER_MIN;
                                return (
                                    <div
                                        key={ev.key}
                                        role="button"
                                        tabIndex={0}
                                        data-cal-event={ev.key}
                                        data-testid="imcrm-cal-event"
                                        onPointerDown={draggable ? (e) => grid.start(e, 'move', ev) : (e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            actions.open(ev);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                actions.open(ev);
                                            }
                                        }}
                                        title={eventTooltip(ev, actions, locked)}
                                        className={cn(
                                            'imcrm-group imcrm-absolute imcrm-z-[1] imcrm-overflow-hidden imcrm-rounded imcrm-border-l-[3px] imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-leading-tight imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-card focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary',
                                            b.cutTop && 'imcrm-rounded-t-none',
                                            b.cutBottom && 'imcrm-rounded-b-none',
                                            draggable && 'imcrm-cursor-grab active:imcrm-cursor-grabbing',
                                            dragging && 'imcrm-opacity-40',
                                        )}
                                        style={{
                                            ...eventStyle(ev.color, { solid: true }),
                                            top: b.top * PX_PER_MIN,
                                            height: Math.max(14, px - 1),
                                            left: `calc(${(b.col * 100) / b.cols}% + 2px)`,
                                            width: `calc(${100 / b.cols}% - 4px)`,
                                        }}
                                    >
                                        <div className="imcrm-flex imcrm-items-start imcrm-gap-1">
                                            {actions.recurring(ev) && <Repeat className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-70" aria-label={__('Recurrente')} />}
                                            {locked && actions.dragEnabled && <Lock className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-60" aria-hidden />}
                                            <span className={cn('imcrm-min-w-0 imcrm-flex-1 imcrm-font-semibold', px < 34 ? 'imcrm-truncate' : 'imcrm-line-clamp-2')}>
                                                {px < 34 && <span className="imcrm-mr-1 imcrm-font-normal imcrm-tabular-nums">{clockLabel(ev.span.startDay === d ? ev.span.startMinute : 0, actions.h12)}</span>}
                                                {ev.title}
                                            </span>
                                            {actions.touch && (
                                                <CalendarEventMenu
                                                    event={ev}
                                                    onOpen={actions.open}
                                                    onMoveTo={actions.moveTo(ev)}
                                                    lockedReason={locked}
                                                    className="-imcrm-mr-1 -imcrm-mt-0.5 imcrm-h-5 imcrm-w-5"
                                                />
                                            )}
                                        </div>
                                        {px >= 34 && (
                                            <div className="imcrm-tabular-nums imcrm-opacity-75">
                                                {clockLabel(ev.span.startDay === d ? ev.span.startMinute : 0, actions.h12)} – {clockLabel(ev.span.endDay === d ? ev.span.endMinute : 1440, actions.h12)}
                                                {actions.showSource && ` · ${actions.sourceLabel(ev)}`}
                                            </div>
                                        )}
                                        {resizable && (
                                            <span
                                                aria-hidden
                                                data-testid="imcrm-cal-resize"
                                                onPointerDown={(e) => grid.start(e, 'resize', ev)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="imcrm-absolute imcrm-inset-x-0 imcrm-bottom-0 imcrm-h-1.5 imcrm-cursor-ns-resize"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                            {ghost && ghost.day === d && (
                                <div
                                    aria-hidden
                                    data-testid="imcrm-cal-ghost"
                                    className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-1 imcrm-z-[2] imcrm-rounded imcrm-border-2 imcrm-border-dashed imcrm-border-primary imcrm-bg-primary/15 imcrm-px-1.5 imcrm-text-[11px] imcrm-font-semibold imcrm-tabular-nums imcrm-text-primary"
                                    style={{ top: (ghost.start - windowStart) * PX_PER_MIN, height: Math.max(12, (ghost.end - ghost.start) * PX_PER_MIN) }}
                                >
                                    {clockLabel(ghost.start, actions.h12)} – {clockLabel(ghost.end, actions.h12)}
                                </div>
                            )}
                            {isToday && now.day === d && now.minute >= windowStart && now.minute <= windowEnd && (
                                <div
                                    aria-hidden
                                    data-testid="imcrm-cal-now"
                                    className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-0 imcrm-z-[3] imcrm-h-0.5 imcrm-bg-red-500"
                                    style={{ top: (now.minute - windowStart) * PX_PER_MIN }}
                                >
                                    <span className="imcrm-absolute -imcrm-left-1 -imcrm-top-[3px] imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-red-500" />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Lo que se dibuja mientras se arrastra en la grilla: el bloque en su lugar nuevo. */
function ghostBlock(p: DragPreview | null, windowStart: number, windowEnd: number): { day: string; start: number; end: number } | null {
    if (!p || !p.moved || p.origin.minute === undefined || p.target.minute === undefined) return null;
    if (p.kind === 'create') {
        const a = Math.min(p.origin.minute, p.target.minute);
        const b = Math.max(p.origin.minute, p.target.minute);
        const start = Math.max(windowStart, Math.floor(a / 15) * 15);
        return { day: p.origin.day, start, end: Math.max(start + 15, Math.min(windowEnd, Math.ceil(b / 15) * 15)) };
    }
    if (!p.event) return null;
    const { span } = p.event;
    if (p.kind === 'move') {
        const pos = gridMoveTarget(p);
        if (!pos) return null;
        const len = gridLength(p.event);
        return { day: pos.day, start: pos.minute, end: Math.min(1440, pos.minute + len) };
    }
    // Estirar: del inicio (en ese día) hasta el puntero.
    if (p.target.day !== span.startDay) return { day: p.target.day, start: windowStart, end: Math.max(windowStart + 15, snapMinutes(p.target.minute)) };
    return { day: span.startDay, start: span.startMinute, end: Math.max(span.startMinute + 15, snapMinutes(p.target.minute)) };
}

/** Minutos que dura un evento (lo que se conserva al moverlo). */
function gridLength(ev: CalendarEvent): number {
    const { span } = ev;
    if (span.start && span.end) return Math.max(15, Math.round((span.end.getTime() - span.start.getTime()) / 60_000));
    return Math.max(15, span.endMinute - span.startMinute);
}

function gridMoveTarget(p: DragPreview): { day: string; minute: number } | null {
    if (!p.event || p.origin.minute === undefined || p.target.minute === undefined) return null;
    return moveTargetInGrid(p.event.span, { day: p.origin.day, minute: p.origin.minute }, { day: p.target.day, minute: p.target.minute });
}

function commitGrid(p: DragPreview, actions: CalendarActions, windowStart: number, windowEnd: number): void {
    if (p.kind === 'create') {
        const g = ghostBlock(p, windowStart, windowEnd);
        if (g && actions.canCreate) actions.create({ day: g.day, minute: g.start, endMinute: g.end });
        return;
    }
    if (!p.event || p.target.minute === undefined) return;
    if (p.kind === 'move') {
        const pos = gridMoveTarget(p);
        if (pos) actions.commitMove(p.event, pos);
        return;
    }
    actions.commitResize(p.event, { day: p.target.day, minute: snapMinutes(p.target.minute) });
}

function stripGhostDays(p: DragPreview | null): Set<string> {
    const out = new Set<string>();
    if (!p || !p.moved || !p.event) return out;
    const { startDay, endDay } = p.event.span;
    if (p.kind === 'move') {
        const delta = daysBetween(p.origin.day, p.target.day);
        for (let i = 0; i <= Math.min(daysBetween(startDay, endDay), 60); i++) out.add(addDaysYmd(startDay, i + delta));
    } else if (p.kind === 'resize') {
        const to = p.target.day < startDay ? startDay : p.target.day;
        for (let i = 0; i <= Math.min(daysBetween(startDay, to), 60); i++) out.add(addDaysYmd(startDay, i));
    }
    return out;
}

