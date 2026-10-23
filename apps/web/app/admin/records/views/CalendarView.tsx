import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CalendarDays,
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    Globe2,
    List,
    Loader2,
    CalendarCog,
    Square,
    TriangleAlert,
} from 'lucide-react';
import {
    addDaysYmd,
    timeZoneLabel,
    zonedNowNaive,
    zonedToday,
    type CalendarMode,
    type CalendarSettings,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ViewSwitch } from '@/components/ui/view-switch';
import { useCalendarAgenda, useCalendarBundle, type CalendarBundleResponse } from '@/hooks/useCalendarBundle';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRecurrencesBatch } from '@/hooks/useRecurrences';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { titleFieldOf, untitledLabel } from '@/lib/recordTitle';
import { isTypingTarget } from '@/lib/shortcuts';
import { browserTimeZone, getTenantFormat, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree, RecordEntity } from '@/types/record';
import type { SavedViewEntity } from '@/types/view';

import { ROW_COLOR_HEX } from '../grid/colorRules';
import { useBatchUpdateRecords, type BatchCell } from '../grid/useBatchUpdate';
import { useStoreRules } from '../storeRules';
import { AgendaView } from './calendar/AgendaView';
import type { CalendarActions } from './calendar/calendarActions';
import { calendarColorResolver } from './calendar/calendarColors';
import { CalendarDayDialog } from './calendar/CalendarDayDialog';
import { calendarLockReason } from './calendar/calendarLocks';
import {
    AGENDA_PAGE_DAYS,
    activeSources,
    buildEvents,
    clockLabel,
    createPrefill,
    isResizable,
    isWeekend,
    monthWeeks,
    moveCells,
    rangeFor,
    resizeCells,
    shiftCursor,
    shortDate,
    sourceFields,
    titleFor,
    unloadedByDay,
    weekDays,
    type CalendarCell,
    type CalendarEvent,
    type DropTarget,
} from './calendar/calendarModel';
import { CalendarMoveDialog } from './calendar/CalendarMoveDialog';
import { CALENDAR_MODE_LABEL, CalendarSettingsDialog } from './calendar/CalendarSettingsDialog';
import { MonthView } from './calendar/MonthView';
import { TimeGridView } from './calendar/TimeGridView';
import { viewConfigToCalendar, calendarToViewConfig } from './savedViewMapping';

/**
 * Vista Calendario — B4 «Calendario completo».
 *
 * Mes, Semana, Día y Agenda sobre el RANGO visible (`calendar-bundle`: una
 * request por rango, con los eventos que empiezan antes y los de varios días,
 * y un tope por día con el conteo exacto — «+N más» —). Varias fuentes de
 * fecha a la vez («Vencimiento» y «Próximo contacto»), cada una con su color,
 * prendibles desde la barra. Arrastrar reprograma (en el mes, de día
 * conservando la hora; en semana y día, de día y hora con encaje a 15
 * minutos), estirar cambia el fin o la duración, y un clic (o un arrastre)
 * en un hueco abre el alta con la fecha ya puesta. El guardado es optimista y
 * tiene deshacer.
 *
 * Todo en el reloj de la EMPRESA (ADR-S33): las horas se muestran y se
 * arrastran en su zona aunque el navegador esté en otra (la barra lo avisa) y
 * una fecha sin hora nunca se corre de día.
 */
interface CalendarViewProps {
    listId: number;
    fields: FieldEntity[];
    view: SavedViewEntity;
    filterTree?: FilterTree;
    search?: string;
    onCardClick: (record: RecordEntity) => void;
    /** Crear con valores pre-cargados (undefined = sin permiso de alta). */
    onAddRecord?: (prefill: Record<string, unknown>) => void;
    /** Si los cambios del calendario (fuentes prendidas) se guardan en la vista. */
    canEditView: boolean;
    /** «Configurar calendario» controlado desde afuera (panel Personalizar). */
    settingsOpen?: boolean;
    onSettingsOpenChange?: (open: boolean) => void;
    /** Si está cargando y el orden de los registros visibles (anterior/siguiente del modal). */
    onStatusChange?: (s: { fetching: boolean; ids: number[] }) => void;
}

/** Eventos por día que se piden según la vista. */
const PER_DAY: Record<CalendarMode, number> = { month: 4, week: 40, day: 120, agenda: 40 };

interface UndoEntry {
    title: string;
    before: BatchCell[];
    after: BatchCell[];
}

export function CalendarView({
    listId,
    fields,
    view,
    filterTree,
    search,
    onCardClick,
    onAddRecord,
    canEditView,
    settingsOpen: settingsOpenProp,
    onSettingsOpenChange,
    onStatusChange,
}: CalendarViewProps): JSX.Element {
    const toast = useToast();
    const batch = useBatchUpdateRecords(listId);
    const updateView = useUpdateSavedView(listId);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const storeRules = useStoreRules();
    const touch = useMediaQuery('(hover: none) and (pointer: coarse)');
    const phone = useMediaQuery('(max-width: 639px)');
    const h12 = getTenantFormat().time_format === 'h12';

    // ── Ajustes (de la vista, con override local para las fuentes prendidas) ──
    const server = useMemo(() => viewConfigToCalendar(view.config), [view.config]);
    const [override, setOverride] = useState<CalendarSettings | null>(null);
    const pendingSaves = useRef(0);
    useEffect(() => {
        if (pendingSaves.current === 0) setOverride(null);
    }, [view.config]);
    const settings = override ?? server.settings;
    const saveSettings = useEventCallback((next: CalendarSettings): void => {
        setOverride(next);
        if (!canEditView) return;
        pendingSaves.current += 1;
        updateView.mutate(
            { id: view.id, config: calendarToViewConfig(view.config, next) },
            {
                onError: (err) => {
                    toast.error(__('No se pudo guardar el ajuste del calendario'), err instanceof Error ? err.message : undefined);
                    setOverride(null);
                },
                onSettled: () => {
                    pendingSaves.current = Math.max(0, pendingSaves.current - 1);
                },
            },
        );
    });
    const [innerSettingsOpen, setInnerSettingsOpen] = useState(false);
    const settingsOpen = settingsOpenProp ?? innerSettingsOpen;
    const setSettingsOpen = onSettingsOpenChange ?? setInnerSettingsOpen;

    const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const validSources = useMemo(() => settings.sources.filter((s) => sourceFields(s, fieldsById) !== null), [settings.sources, fieldsById]);
    const sources = useMemo(() => activeSources(settings, fieldsById), [settings, fieldsById]);

    // ── Zona y "hoy" (los de la empresa) ──
    const guessTz = getTenantTimeZone() ?? browserTimeZone() ?? 'UTC';
    const [serverTz, setServerTz] = useState<string | null>(null);
    const timeZone = serverTz ?? guessTz;
    const [today, setToday] = useState(() => zonedToday(timeZone));
    useEffect(() => {
        setToday(zonedToday(timeZone));
        const t = window.setInterval(() => setToday(zonedToday(timeZone)), 60_000);
        return () => window.clearInterval(t);
    }, [timeZone]);
    const browserTz = browserTimeZone();
    const tzDiffers = browserTz !== null && browserTz !== timeZone && zonedNowNaive(browserTz).slice(0, 16) !== zonedNowNaive(timeZone).slice(0, 16);

    // ── Vista (mes/semana/día/agenda) y cursor ──
    const adapt = useCallback(
        (m: CalendarMode): CalendarMode => (phone ? (m === 'week' || m === 'day' ? 'day' : 'agenda') : m),
        [phone],
    );
    const [mode, setModeState] = useState<CalendarMode>(() => adapt(settings.defaultMode));
    useEffect(() => {
        setModeState(adapt(server.settings.defaultMode));
    }, [server.settings.defaultMode, adapt]);
    // En el teléfono no hay semana (7 columnas no entran): se ve el día.
    const shownMode: CalendarMode = phone && mode === 'week' ? 'day' : mode;
    const [cursor, setCursor] = useState(() => zonedToday(timeZone));
    const setMode = (m: CalendarMode): void => setModeState(m);
    const goToday = (): void => setCursor(today);
    const shift = (dir: -1 | 1): void => setCursor((c) => shiftCursor(shownMode, c, dir));

    // ── Datos ──
    const hasFilter = filterTree !== undefined && filterTree.children.length > 0;
    const searchTerm = search !== undefined && search.trim() !== '' ? search.trim() : undefined;
    const range = rangeFor(shownMode, cursor, settings.weekStart);
    const bundle = useCalendarBundle({
        listId,
        sources,
        from: range.from,
        to: range.to,
        filterTree: hasFilter ? filterTree : undefined,
        search: searchTerm,
        perDay: PER_DAY[shownMode],
        enabled: shownMode !== 'agenda',
    });
    const agenda = useCalendarAgenda({
        listId,
        sources,
        from: cursor,
        pageDays: AGENDA_PAGE_DAYS,
        filterTree: hasFilter ? filterTree : undefined,
        search: searchTerm,
        perDay: PER_DAY.agenda,
        enabled: shownMode === 'agenda',
    });
    const pages: CalendarBundleResponse[] = useMemo(
        () => (shownMode === 'agenda' ? agenda.data?.pages ?? [] : bundle.data ? [bundle.data] : []),
        [shownMode, agenda.data, bundle.data],
    );
    const zoneFromServer = pages[0]?.meta.time_zone ?? null;
    useEffect(() => {
        if (zoneFromServer && zoneFromServer !== serverTz) setServerTz(zoneFromServer);
    }, [zoneFromServer, serverTz]);
    const records = useMemo(() => {
        const seen = new Map<number, RecordEntity>();
        for (const p of pages) for (const r of p.records) seen.set(r.id, r);
        return [...seen.values()];
    }, [pages]);
    const dayCounts = useMemo(() => {
        const out: Record<string, { n: number; more: number }> = {};
        for (const p of pages) Object.assign(out, p.days);
        return out;
    }, [pages]);
    const fetching = shownMode === 'agenda' ? agenda.isFetching : bundle.isFetching;
    const truncated = pages.some((p) => p.meta.truncated);
    const brokenSources = (pages[0]?.meta.sources ?? []).filter((s) => !s.ok);

    // ── Eventos ──
    const titleField = useMemo(() => titleFieldOf(fields), [fields]);
    const titleOf = useCallback(
        (r: RecordEntity): string => {
            const v = titleField ? r.fields[titleField.slug] : undefined;
            return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : untitledLabel();
        },
        [titleField],
    );
    const colorOf = useMemo(
        () =>
            calendarColorResolver({
                settings,
                fields,
                fieldsById,
                colorRules: server.colorRules,
                timeZone,
                enabledSources: sources.length,
            }),
        [settings, fields, fieldsById, server.colorRules, timeZone, sources.length],
    );
    const build = useCallback(
        (rows: readonly RecordEntity[]): CalendarEvent[] =>
            buildEvents(rows, { sources, fieldsById, timeZone, defaultDuration: settings.defaultDuration, titleOf, colorOf }),
        [sources, fieldsById, timeZone, settings.defaultDuration, titleOf, colorOf],
    );
    const events = useMemo(() => build(records), [build, records]);

    const visibleDays = useMemo(() => {
        if (shownMode === 'month') return monthWeeks(cursor, settings.weekStart).flat();
        if (shownMode === 'week') return weekDays(cursor, settings.weekStart).filter((d) => settings.showWeekends || !isWeekend(d));
        if (shownMode === 'day') return [cursor];
        const n = (agenda.data?.pages.length ?? 1) * AGENDA_PAGE_DAYS;
        return Array.from({ length: n }, (_, i) => addDaysYmd(cursor, i));
    }, [shownMode, cursor, settings.weekStart, settings.showWeekends, agenda.data?.pages.length]);
    const unloaded = useMemo(() => unloadedByDay(events, dayCounts, visibleDays), [events, dayCounts, visibleDays]);

    // Recurrencias: el icono en el evento de la fuente que se repite.
    const recordIds = useMemo(() => records.map((r) => r.id).sort((a, b) => a - b), [records]);
    const recurrences = useRecurrencesBatch(listId, recordIds);
    const recurring = useMemo(() => {
        const s = new Set<string>();
        for (const list of Object.values(recurrences.data ?? {})) for (const r of list) s.add(`${r.record_id}:${r.date_field_id}`);
        return s;
    }, [recurrences.data]);

    // Estado hacia la página (anterior/siguiente del modal: en orden de fecha).
    const orderedIds = useMemo(() => {
        const sorted = [...events].sort((a, b) => (a.span.startDay < b.span.startDay ? -1 : a.span.startDay > b.span.startDay ? 1 : a.span.startMinute - b.span.startMinute));
        return [...new Set(sorted.map((e) => e.record.id))];
    }, [events]);
    const statusKey = `${fetching}|${orderedIds.join(',')}`;
    useEffect(() => {
        onStatusChange?.({ fetching, ids: orderedIds });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusKey]);

    // ── Escribir (optimista + deshacer) ──
    const undoStack = useRef<UndoEntry[]>([]);
    const undo = useEventCallback((entry: UndoEntry): void => {
        undoStack.current = undoStack.current.filter((e) => e !== entry);
        batch.mutate(
            { cells: entry.before, expect: entry.after },
            {
                onSuccess: (out) => {
                    const failed = out.failed[0];
                    if (failed) {
                        toast.error(
                            failed.code === 'record_changed' ? __('No se deshizo: alguien cambió el registro después.') : __('No se pudo deshacer'),
                            failed.code === 'record_changed' ? undefined : failed.message,
                        );
                        return;
                    }
                    toast.success(sprintf(__('Se deshizo el cambio de «%s»'), entry.title));
                },
                onError: (err) => toast.error(__('No se pudo deshacer'), err.message),
            },
        );
    });
    const commit = useEventCallback((ev: CalendarEvent, cells: CalendarCell[], done?: () => void): void => {
        if (cells.length === 0) return;
        const before: BatchCell[] = cells.map((c) => ({ recordId: ev.record.id, field: c.field, value: ev.record.fields[c.field.slug] ?? null }));
        const after: BatchCell[] = cells.map((c) => ({ recordId: ev.record.id, field: c.field, value: c.value }));
        batch.mutate(
            { cells: after },
            {
                onSuccess: (out) => {
                    const failed = out.failed[0] ?? out.cell_errors[0];
                    if (failed) {
                        setMoveError(failed.message);
                        toast.error(__('No se pudo mover el evento'), failed.message);
                        return;
                    }
                    done?.();
                    // Lo que quedó escrito (el servidor puede normalizar la fecha) es la base del deshacer.
                    const written = after.map((c) => ({ ...c, value: out.written.get(`${c.recordId}:${c.field.id}`) ?? c.value }));
                    const entry: UndoEntry = { title: ev.title, before, after: written };
                    undoStack.current = [...undoStack.current.slice(-19), entry];
                    toast.show({
                        title: sprintf(__('«%1$s» → %2$s'), ev.title, whenLabel(cells, ev, timeZone, h12)),
                        variant: 'success',
                        duration: 7000,
                        action: { label: __('Deshacer'), onClick: () => undo(entry) },
                    });
                },
                onError: (err) => {
                    setMoveError(err.message);
                    toast.error(__('No se pudo mover el evento'), err.message);
                },
            },
        );
    });

    // Ctrl/⌘+Z deshace el último movimiento del calendario.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
            if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
            const last = undoStack.current[undoStack.current.length - 1];
            if (!last) return;
            e.preventDefault();
            undo(last);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo]);

    // ── Acciones para las vistas ──
    const [dayOpen, setDayOpen] = useState<string | null>(null);
    const [moving, setMoving] = useState<CalendarEvent | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const lockedReason = useEventCallback((ev: CalendarEvent, what: 'move' | 'resize'): string | null =>
        calendarLockReason(ev, what, { canEdit, fieldsById, storeRules }),
    );
    const canCreate = onAddRecord !== undefined && sources.length > 0;
    const actions: CalendarActions = useMemo(
        () => ({
            timeZone,
            h12,
            today,
            canCreate,
            dragEnabled: canEdit && !touch,
            touch,
            showSource: sources.length > 1,
            open: (ev) => onCardClick(ev.record),
            moveTo: (ev) => (lockedReason(ev, 'move') === null ? (e) => {
                setMoveError(null);
                setMoving(e);
            } : undefined),
            lockedReason,
            canResize: (ev) => isResizable(ev, fieldsById),
            commitMove: (ev, target: DropTarget) => {
                const cells = moveCells(ev, fieldsById, target, timeZone);
                if (cells) commit(ev, cells);
            },
            commitResize: (ev, target: DropTarget) => {
                const cells = resizeCells(ev, fieldsById, target, timeZone);
                if (cells) commit(ev, cells);
            },
            create: (slot) => {
                const source = sources[0];
                if (!onAddRecord || !source) return;
                // Un clic en el mes (sin hora) en una fuente con hora: a las 9:00, o
                // al empezar el horario visible si es más tarde.
                const minute = slot.minute ?? Math.max(settings.dayStartHour * 60, Math.min(9 * 60, (settings.dayEndHour - 1) * 60));
                onAddRecord(createPrefill(source, fieldsById, { ...slot, minute }, timeZone, settings.defaultDuration));
            },
            showDay: setDayOpen,
            recurring: (ev) => recurring.has(`${ev.record.id}:${ev.source.startFieldId}`),
            sourceLabel: (ev) => ev.source.label ?? fieldsById.get(ev.source.startFieldId)?.label ?? '',
        }),
        [timeZone, h12, today, canCreate, canEdit, touch, sources, onCardClick, lockedReason, fieldsById, commit, onAddRecord, settings.dayStartHour, settings.dayEndHour, settings.defaultDuration, recurring],
    );

    // ── Atajos: M/S/D/A cambian la vista, H vuelve a hoy, ←/→ navegan ──
    const lastKey = useRef<{ key: string; at: number } | null>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
            if (document.querySelector('[role="dialog"], [role="menu"]')) return;
            const prev = lastKey.current;
            lastKey.current = { key: e.key.toLowerCase(), at: Date.now() };
            // `g` + letra es un atajo global (ir a…): no lo pisa.
            if (prev && prev.key === 'g' && Date.now() - prev.at < 1200) return;
            const k = e.key.toLowerCase();
            const modes: Record<string, CalendarMode> = { m: 'month', s: 'week', d: 'day', a: 'agenda' };
            if (modes[k]) {
                e.preventDefault();
                setModeState(modes[k]!);
            } else if (k === 'h') {
                e.preventDefault();
                setCursor(today);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                setCursor((c) => shiftCursor(shownMode, c, e.key === 'ArrowLeft' ? -1 : 1));
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [today, shownMode]);

    // ── Deslizar en el teléfono: día (o mes) anterior/siguiente ──
    const swipe = useRef<{ x: number; y: number } | null>(null);
    const onTouchStart = (e: React.TouchEvent): void => {
        const t = e.touches[0];
        swipe.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: React.TouchEvent): void => {
        const s = swipe.current;
        swipe.current = null;
        const t = e.changedTouches[0];
        if (!s || !t || (shownMode !== 'day' && shownMode !== 'month')) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dy) < 45) shift(dx < 0 ? 1 : -1);
    };

    const toggleSource = (id: string): void => {
        saveSettings({ ...settings, sources: settings.sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)) });
    };
    const countFor = (id: string): number | null => {
        const meta = pages[0]?.meta.sources.find((s) => s.key === id);
        if (!meta || shownMode === 'agenda') return meta ? pages.reduce((n, p) => n + (p.meta.sources.find((s) => s.key === id)?.count ?? 0), 0) : null;
        return meta.count;
    };

    const modeOptions = (phone ? (['day', 'agenda', 'month'] as CalendarMode[]) : (['month', 'week', 'day', 'agenda'] as CalendarMode[])).map((m) => ({
        value: m,
        label: CALENDAR_MODE_LABEL[m],
        icon: m === 'month' ? CalendarDays : m === 'week' ? CalendarRange : m === 'day' ? Square : List,
    }));
    const weekShown = shownMode === 'week' ? visibleDays : [];
    const loadedRangeEnd = shownMode === 'agenda' ? visibleDays[visibleDays.length - 1] ?? null : null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-calendar" data-mode={shownMode} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button variant="outline" size="sm" onClick={goToday} className="imcrm-h-8" title={__('Hoy (H)')}>
                        {__('Hoy')}
                    </Button>
                    <div className="imcrm-flex imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border">
                        <button
                            type="button"
                            onClick={() => shift(-1)}
                            aria-label={__('Anterior')}
                            title={__('Anterior (←)')}
                            className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <ChevronLeft className="imcrm-h-4 imcrm-w-4" />
                        </button>
                        <span className="imcrm-w-px imcrm-bg-border" aria-hidden />
                        <button
                            type="button"
                            onClick={() => shift(1)}
                            aria-label={__('Siguiente')}
                            title={__('Siguiente (→)')}
                            className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <ChevronRight className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </div>
                    <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight" data-testid="imcrm-cal-title">
                        {titleFor(shownMode, cursor, settings.weekStart, today)}
                    </h2>
                    {fetching && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Cargando…')} />}
                    {tzDiffers && (
                        <span
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground"
                            title={sprintf(
                                __('Tu equipo está en %1$s. El calendario muestra y mueve las horas en la zona de la empresa (%2$s).'),
                                timeZoneLabel(browserTz),
                                timeZoneLabel(timeZone),
                            )}
                            data-testid="imcrm-cal-tz"
                        >
                            <Globe2 className="imcrm-h-3 imcrm-w-3" aria-hidden />
                            {sprintf(__('Horas de %s'), timeZoneLabel(timeZone))}
                        </span>
                    )}
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <ViewSwitch label={__('Vista del calendario')} value={shownMode} options={modeOptions} onChange={setMode} testId="imcrm-cal-modes" />
                    {canEditView && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="imcrm-h-8 imcrm-w-8"
                            onClick={() => setSettingsOpen(true)}
                            aria-label={__('Configurar calendario')}
                            title={__('Configurar calendario')}
                            data-testid="imcrm-cal-settings"
                        >
                            <CalendarCog className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    )}
                </div>
            </header>

            {validSources.length > 1 && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5" role="group" aria-label={__('Fechas que se muestran')} data-testid="imcrm-cal-source-chips">
                    {validSources.map((s) => {
                        const label = s.label ?? fieldsById.get(s.startFieldId)?.label ?? '';
                        const n = s.enabled ? countFor(s.id) : null;
                        return (
                            <button
                                key={s.id}
                                type="button"
                                aria-pressed={s.enabled}
                                onClick={() => toggleSource(s.id)}
                                data-source={s.id}
                                title={s.enabled ? sprintf(__('Ocultar «%s»'), label) : sprintf(__('Mostrar «%s»'), label)}
                                className={cn(
                                    'imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                    s.enabled ? 'imcrm-border-border imcrm-bg-card imcrm-text-foreground' : 'imcrm-border-dashed imcrm-border-border imcrm-text-muted-foreground imcrm-opacity-70',
                                )}
                            >
                                <span
                                    aria-hidden
                                    className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full"
                                    style={{ backgroundColor: s.enabled ? ROW_COLOR_HEX[s.color] : 'transparent', boxShadow: `inset 0 0 0 2px ${ROW_COLOR_HEX[s.color]}` }}
                                />
                                {label}
                                {n !== null && <span className="imcrm-tabular-nums imcrm-text-muted-foreground">{n}</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            {brokenSources.length > 0 && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-amber-600 dark:imcrm-text-amber-400" data-testid="imcrm-cal-broken">
                    <TriangleAlert className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {sprintf(
                        __('%d fuente(s) de fecha no se pueden mostrar (el campo no existe, cambió de tipo o no lo puedes ver).'),
                        brokenSources.length,
                    )}
                </p>
            )}

            {sources.length === 0 ? (
                <p className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-py-10 imcrm-text-sm imcrm-text-muted-foreground">
                    <CalendarDays className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {validSources.length === 0 ? __('Este calendario no tiene un campo de fecha válido. Elígelo en «Configurar calendario».') : __('Todas las fechas están ocultas: activa al menos una arriba.')}
                </p>
            ) : shownMode === 'month' ? (
                <MonthView
                    weeks={monthWeeks(cursor, settings.weekStart)}
                    month={cursor.slice(0, 7)}
                    showWeekends={settings.showWeekends}
                    events={events}
                    unloaded={unloaded}
                    compact={phone}
                    actions={actions}
                />
            ) : shownMode === 'agenda' ? (
                <AgendaView
                    days={visibleDays}
                    events={events}
                    unloaded={unloaded}
                    loading={agenda.isLoading}
                    hasMore={agenda.hasNextPage ?? false}
                    loadingMore={agenda.isFetchingNextPage}
                    onLoadMore={() => {
                        if (agenda.hasNextPage && !agenda.isFetchingNextPage) void agenda.fetchNextPage();
                    }}
                    rangeEnd={loadedRangeEnd}
                    actions={actions}
                />
            ) : (
                <TimeGridView
                    days={shownMode === 'week' ? weekShown : [cursor]}
                    events={events}
                    unloaded={unloaded}
                    dayStartHour={settings.dayStartHour}
                    dayEndHour={settings.dayEndHour}
                    defaultDuration={settings.defaultDuration}
                    actions={actions}
                />
            )}

            {truncated && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-view-partial-notice">
                    {__('Hay más eventos de los que entran en este rango: usa filtros para acotar la vista.')}
                </p>
            )}
            {shownMode === 'agenda' && loadedRangeEnd && (
                <p className="imcrm-sr-only">{sprintf(__('Hasta el %s'), shortDate(loadedRangeEnd))}</p>
            )}

            <CalendarDayDialog
                day={dayOpen}
                onClose={() => setDayOpen(null)}
                listId={listId}
                sources={sources}
                filterTree={hasFilter ? filterTree : undefined}
                search={searchTerm}
                build={build}
                actions={actions}
            />
            <CalendarMoveDialog
                event={moving}
                fieldsById={fieldsById}
                timeZone={timeZone}
                saving={batch.isPending}
                error={moveError}
                onCancel={() => setMoving(null)}
                onConfirm={(ev, cells) => commit(ev, cells, () => setMoving(null))}
            />
            {canEditView && (
                <CalendarSettingsDialog listId={listId} view={view} open={settingsOpen} onOpenChange={setSettingsOpen} />
            )}
        </div>
    );
}

/** «12 oct 14:30» del nuevo inicio, para el aviso con «Deshacer». */
function whenLabel(cells: CalendarCell[], ev: CalendarEvent, timeZone: string, h12: boolean): string {
    const start = cells.find((c) => c.field.id === ev.source.startFieldId);
    if (start && typeof start.value === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(start.value)) return shortDate(start.value);
        const d = new Date(start.value);
        if (!Number.isNaN(d.getTime())) {
            const day = zonedToday(timeZone, d);
            const naive = zonedNowNaive(timeZone, d);
            const [h = '0', m = '0'] = naive.slice(11, 16).split(':');
            return `${shortDate(day)} ${clockLabel(Number(h) * 60 + Number(m), h12)}`;
        }
    }
    const other = cells[0];
    if (other && other.field.type === 'duration' && typeof other.value === 'number') return sprintf(__('%d min'), other.value);
    if (other && typeof other.value === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(other.value)) return sprintf(__('hasta el %s'), shortDate(other.value));
        const d = new Date(other.value);
        if (!Number.isNaN(d.getTime())) {
            const naive = zonedNowNaive(timeZone, d);
            const [h = '0', m = '0'] = naive.slice(11, 16).split(':');
            return sprintf(__('hasta las %s'), clockLabel(Number(h) * 60 + Number(m), h12));
        }
    }
    return __('guardado');
}
