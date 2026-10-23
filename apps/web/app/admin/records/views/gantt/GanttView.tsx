import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    CalendarClock,
    ChevronDown,
    ChevronRight,
    FileDown,
    History,
    Loader2,
    LocateFixed,
    Lock,
    Settings2,
    Undo2,
    X,
} from 'lucide-react';
import {
    buildGanttRows,
    dayOfDateValue,
    dayToYmd,
    ganttBarOf,
    ganttDayLabel,
    ganttDraggedBar,
    ganttDurationLabel,
    ganttGroupKey,
    ganttGroupOrder,
    ganttGrowWindow,
    ganttMovePatch,
    ganttSchedulePatch,
    ganttTicks,
    ganttWindowAround,
    GANTT_COLOR_TYPES,
    GANTT_DATE_TYPES,
    GANTT_GROUP_TYPES,
    GANTT_MAX_RANGE_DAYS,
    GANTT_MAX_ROWS,
    GANTT_ZOOMS,
    type GanttBar,
    type GanttDragMode,
    type GanttRowItem,
    type GanttSettings,
    type GanttZoom,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { chipSoftStyle } from '@/components/ui/color-picker';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useAddDependencyPair, useRemoveDependencyById } from '@/hooks/useDependencies';
import { useEventCallback } from '@/hooks/useEventCallback';
import { downloadGanttPdf, useDeleteGanttBaseline, useGanttBundle, useSaveGanttBaseline } from '@/hooks/useGanttBundle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUpdateRecord } from '@/hooks/useRecords';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { useMemberNames } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { titleFieldOf, untitledLabel } from '@/lib/recordTitle';
import { getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree, RecordEntity } from '@/types/record';
import type { SavedViewConfig, SavedViewEntity } from '@/types/view';

import { isCloseCancelled } from '../../dependencies/closeGuard';
import { extractFieldOptions } from '../../fieldOptions';
import { isEmptyTree } from '../../filterTree';
import { activeColorRules, evaluateRowColors, ROW_COLOR_HEX } from '../../grid/colorRules';
import { renderCellValue } from '../../renderCellValue';
import { storeAccessFor, useStoreRules } from '../../storeRules';
import { sortParam } from '../kanban/kanbanModel';
import { ganttToViewConfig, viewConfigToGantt } from '../savedViewMapping';
import { MAIN_SCROLLER_ID } from '../stickyTop';
import { GanttBarItem } from './GanttBarItem';
import { GanttMoveDatesDialog } from './GanttMoveDatesDialog';
import { GanttSettingsDialog, GANTT_ZOOM_LABEL } from './GanttSettingsDialog';
import {
    barBox,
    dayAtX,
    dependencyPath,
    ganttCanvas,
    GANTT_BAR_H,
    GANTT_BAR_TOP,
    GANTT_HEADER_BOTTOM_H,
    GANTT_HEADER_H,
    GANTT_HEADER_TOP_H,
    GANTT_NULL_GROUP,
    GANTT_ROW_H,
    GANTT_SCHEDULE_DAYS,
    panelWidths,
    resizePanelColumn,
    scrollLeftFor,
    snapDays,
    undoPatchFor,
    visibleDayRange,
    xOfDay,
} from './ganttModel';

interface GanttViewProps {
    listId: number;
    fields: FieldEntity[];
    view: SavedViewEntity;
    filterTree: FilterTree;
    search: string;
    onOpenRecord: (id: number) => void;
    /** Si los cambios del Gantt (zoom, grupos, anchos) se guardan en la vista. */
    canEditView: boolean;
    /** La reprogramación en cadena es una regla de la LISTA. */
    canManageList: boolean;
    settingsOpen?: boolean;
    onSettingsOpenChange?: (open: boolean) => void;
    /** Total, si está cargando y el orden de las filas (anterior/siguiente del modal). */
    onStatusChange?: (s: { total: number | null; fetching: boolean; ids: number[] }) => void;
}

interface DragState {
    id: number;
    mode: GanttDragMode;
    delta: number;
}

interface LinkState {
    fromId: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

interface UndoEntry {
    id: number;
    patch: Record<string, unknown>;
}

const UNDO_DEPTH = 30;

/**
 * B1 — Vista Gantt / línea de tiempo. Un solo contenedor con scroll en los
 * dos ejes: el encabezado del tiempo queda pegado arriba y el panel de la
 * izquierda (título + columnas) pegado a la izquierda, así el scroll
 * horizontal y el vertical quedan sincronizados por construcción. Las filas
 * se virtualizan y los datos se piden por la ventana de tiempo que se ve (más
 * un margen) en UNA request (`gantt-bundle`).
 *
 * Arrastrar una barra la mueve; estirar un borde cambia la duración; el
 * punto de la derecha tira una flecha hacia otro registro (dependencia). Todo
 * se guarda optimista con «Deshacer» (y Ctrl/Cmd+Z). En el teléfono es de
 * sólo lectura con scroll: se toca la barra y se eligen las fechas.
 */
export function GanttView({
    listId,
    fields,
    view,
    filterTree,
    search,
    onOpenRecord,
    canEditView,
    canManageList,
    settingsOpen: settingsOpenProp,
    onSettingsOpenChange,
    onStatusChange,
}: GanttViewProps): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const update = useUpdateRecord(listId);
    const updateView = useUpdateSavedView(listId);
    const addPair = useAddDependencyPair(listId);
    const removeDep = useRemoveDependencyById(listId);
    const saveBaseline = useSaveGanttBaseline(listId, view.id);
    const deleteBaseline = useDeleteGanttBaseline(listId, view.id);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const storeRules = useStoreRules();
    const touchOnly = useMediaQuery('(hover: none) and (pointer: coarse)');
    const narrow = useMediaQuery('(max-width: 639px)');
    const tz = getTenantTimeZone() ?? undefined;
    const [today] = useState(() => dayOfDateValue('datetime', new Date().toISOString(), tz) ?? Math.floor(Date.now() / 86_400_000));

    // ── Config de la vista (override local optimista, como el kanban) ──
    const [localConfig, setLocalConfig] = useState<SavedViewConfig | null>(null);
    const pendingSaves = useRef(0);
    useEffect(() => {
        if (pendingSaves.current === 0) setLocalConfig(null);
    }, [view.config]);
    const config = localConfig ?? view.config;
    const settings = useMemo(() => viewConfigToGantt(config), [config]);
    const saveConfig = useEventCallback((next: SavedViewConfig): void => {
        setLocalConfig(next);
        // Sin permiso, el ajuste vale sólo en esta pantalla.
        if (!canEditView) return;
        pendingSaves.current += 1;
        updateView.mutate(
            { id: view.id, config: next },
            {
                onError: (err) => {
                    toast.error(__('No se pudo guardar el ajuste del Gantt'), err instanceof Error ? err.message : undefined);
                    setLocalConfig(null);
                },
                onSettled: () => {
                    pendingSaves.current = Math.max(0, pendingSaves.current - 1);
                },
            },
        );
    });
    const saveSettings = (next: GanttSettings): void => saveConfig(ganttToViewConfig(config, next));

    const [innerSettingsOpen, setInnerSettingsOpen] = useState(false);
    const settingsOpen = settingsOpenProp ?? innerSettingsOpen;
    const setSettingsOpen = onSettingsOpenChange ?? setInnerSettingsOpen;

    // ── Campos ──
    const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const pick = (id: number | null, types: readonly string[]): FieldEntity | null => {
        if (id === null) return null;
        const f = fieldById.get(id);
        return f && types.includes(f.type) ? f : null;
    };
    const startField = pick(settings.startFieldId, GANTT_DATE_TYPES);
    const endField = pick(settings.endFieldId, GANTT_DATE_TYPES);
    const groupField = pick(settings.groupByFieldId, GANTT_GROUP_TYPES);
    const colorField = settings.colorBy === 'field' ? pick(settings.colorFieldId, GANTT_COLOR_TYPES) : null;
    const titleField = titleFieldOf(fields);
    const columns = useMemo(() => settings.columns.filter((c) => fieldById.has(c.field_id)), [settings.columns, fieldById]);
    const columnFields = columns.map((c) => fieldById.get(c.field_id)!);
    const startRef = useMemo(() => (startField ? { key: startField.slug, type: startField.type } : null), [startField]);
    const endRef = useMemo(() => (endField ? { key: endField.slug, type: endField.type } : null), [endField]);

    // ── Panel izquierdo (anchos; en el teléfono sólo el título) ──
    const [resizing, setResizing] = useState<{ index: number; width: number } | null>(null);
    const widths = useMemo(() => {
        const base = panelWidths({ titleWidth: settings.titleWidth, columns });
        if (!resizing) return base;
        const cols = base.columns.map((w, i) => (i === resizing.index ? resizing.width : w));
        const title = resizing.index < 0 ? resizing.width : base.title;
        return { title, columns: cols, total: title + cols.reduce((a, b) => a + b, 0) };
    }, [settings.titleWidth, columns, resizing]);
    const panelW = narrow ? 150 : widths.total;

    // ── Lienzo, scroll y ventana de datos ──
    const canvas = useMemo(() => ganttCanvas(today, settings.zoom), [today, settings.zoom]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [win, setWin] = useState(() => ganttWindowAround(settings.zoom, today));
    const [hView, setHView] = useState({ left: 0, width: 1200 });
    const anchor = useRef<{ day: number; at: number }>({ day: today, at: 1 / 3 });
    const timelineWidth = (): number => Math.max(1, (scrollRef.current?.clientWidth ?? 1200) - panelW);

    const syncScroll = useEventCallback((): void => {
        const el = scrollRef.current;
        if (!el) return;
        const tw = timelineWidth();
        const q = Math.floor(el.scrollLeft / 256) * 256;
        setHView((prev) => (prev.left === q && prev.width === tw ? prev : { left: q, width: tw }));
        const vis = visibleDayRange(canvas, el.scrollLeft, tw);
        setWin((prev) => ganttGrowWindow(prev, vis, settings.zoom) ?? prev);
    });
    const rafRef = useRef(0);
    const onScroll = (): void => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            syncScroll();
        });
    };
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    // Al abrir y al cambiar de zoom: el día ancla queda en su lugar.
    const hasStart = startField !== null;
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollLeft = scrollLeftFor(canvas, anchor.current.day, timelineWidth(), anchor.current.at);
        syncScroll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvas, hasStart]);

    // El Gantt ocupa el alto que queda en la pantalla (un solo scroll, el suyo).
    const rootRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(520);
    useLayoutEffect(() => {
        const measure = (): void => {
            const el = scrollRef.current;
            const main = document.getElementById(MAIN_SCROLLER_ID);
            if (!el) return;
            const top = el.getBoundingClientRect().top;
            if (main) {
                const mr = main.getBoundingClientRect();
                const rel = top - mr.top + main.scrollTop;
                setHeight(Math.max(320, Math.round(main.clientHeight - rel - 12)));
            } else {
                setHeight(Math.max(320, Math.round(window.innerHeight - top - 12)));
            }
            syncScroll();
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasStart]);

    // ── Datos ──
    const bundle = useGanttBundle({
        listId,
        viewId: view.id,
        startFieldId: startField?.id ?? null,
        endFieldId: endField?.id ?? null,
        from: win.from,
        to: win.to,
        filterTree: isEmptyTree(filterTree) ? undefined : filterTree,
        search,
        sort: sortParam(config.sort),
        subtasks: settings.showSubtasks,
    });
    const data = bundle.data;

    const barOf = useCallback(
        (r: RecordEntity): GanttBar | null => (startRef ? ganttBarOf(r.fields, startRef, endRef, tz) : null),
        [startRef, endRef, tz],
    );
    // Un «Sin programar» al que se le dieron fechas (optimista) pasa al Gantt al instante.
    const { rowRecords, unscheduled } = useMemo(() => {
        const recs = data?.records ?? [];
        const uns = data?.unscheduled ?? [];
        const ids = new Set(recs.map((r) => r.id));
        const scheduled = uns.filter((r) => !ids.has(r.id) && barOf(r) !== null);
        return { rowRecords: [...recs, ...scheduled], unscheduled: uns.filter((r) => barOf(r) === null) };
    }, [data, barOf]);
    const recordById = useMemo(() => {
        const m = new Map<number, RecordEntity>();
        for (const r of rowRecords) m.set(r.id, r);
        for (const r of unscheduled) m.set(r.id, r);
        return m;
    }, [rowRecords, unscheduled]);
    const bars = useMemo(() => new Map(rowRecords.map((r) => [r.id, barOf(r)])), [rowRecords, barOf]);

    // ── Grupos ──
    const userIds = useMemo(() => {
        if (groupField?.type !== 'user') return [];
        const s = new Set<number>();
        for (const r of rowRecords) {
            const v = Number(r.fields[groupField.slug]);
            if (Number.isInteger(v) && v > 0) s.add(v);
        }
        return [...s];
    }, [groupField, rowRecords]);
    const names = useMemberNames(userIds).data;
    const groupOptions = useMemo(() => (groupField?.type === 'select' ? extractFieldOptions(groupField) : []), [groupField]);
    const groupLabel = useCallback(
        (key: string): string => {
            if (key === GANTT_NULL_GROUP) return __('Sin valor');
            if (!groupField) return key;
            if (groupField.type === 'checkbox') return key === 'true' ? __('Sí') : __('No');
            if (groupField.type === 'user') return names?.get(Number(key)) ?? sprintf(__('Persona #%s'), key);
            return groupOptions.find((o) => o.value === key)?.label ?? key;
        },
        [groupField, names, groupOptions],
    );
    const groupKeyOf = useCallback((r: RecordEntity): string | null => (groupField ? ganttGroupKey(r.fields[groupField.slug]) : null), [groupField]);
    const collapsedGroups = useMemo(() => new Set(config.collapsed_groups ?? []), [config.collapsed_groups]);
    const [collapsedParents, setCollapsedParents] = useState<Set<number>>(() => new Set());
    const rows = useMemo(() => {
        const keys = groupField ? rowRecords.map((r) => groupKeyOf(r) ?? GANTT_NULL_GROUP) : [];
        return buildRows(rowRecords, {
            groupField,
            groupKeyOf,
            groupOrder: groupField ? ganttGroupOrder(groupField, keys, groupLabel) : [],
            collapsedGroups,
            collapsedParents,
            showSubtasks: settings.showSubtasks,
        });
    }, [rowRecords, groupField, groupKeyOf, groupLabel, collapsedGroups, collapsedParents, settings.showSubtasks]);
    const rowIndexById = useMemo(() => {
        const m = new Map<number, number>();
        rows.forEach((r, i) => {
            if (r.kind === 'record') m.set(r.id, i);
        });
        return m;
    }, [rows]);

    // Total y orden para la página (anterior/siguiente del modal).
    useEffect(() => {
        onStatusChange?.({
            total: data ? data.meta.total + data.meta.unscheduled_total : null,
            fetching: bundle.isFetching,
            ids: rows.flatMap((r) => (r.kind === 'record' ? [r.id] : [])),
        });
    }, [data, bundle.isFetching, rows, onStatusChange]);

    const toggleGroup = (key: string): void => {
        const next = new Set(collapsedGroups);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        saveConfig({ ...config, collapsed_groups: [...next] });
    };
    const toggleParent = (id: number): void =>
        setCollapsedParents((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    // ── Colores ──
    const colorOptions = useMemo(() => (colorField ? extractFieldOptions(colorField) : []), [colorField]);
    const rules = useMemo(
        () => (settings.colorBy === 'rules' ? activeColorRules(config.color_rules, fieldById) : []),
        [settings.colorBy, config.color_rules, fieldById],
    );
    const colorStyleOf = useCallback(
        (r: RecordEntity): React.CSSProperties | undefined => {
            if (colorField) {
                const v = r.fields[colorField.slug];
                const opt = colorOptions.find((o) => o.value === String(v ?? ''));
                return opt?.color ? chipSoftStyle(opt.color) : undefined;
            }
            if (rules.length > 0) {
                const c = evaluateRowColors(rules, r, fieldById, { timeZone: tz }).row;
                return c ? chipSoftStyle(ROW_COLOR_HEX[c]) : undefined;
            }
            return undefined;
        },
        [colorField, colorOptions, rules, fieldById, tz],
    );

    const titleOf = useCallback(
        (r: RecordEntity): string => {
            const v = titleField ? r.fields[titleField.slug] : null;
            return typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : untitledLabel();
        },
        [titleField],
    );

    // ── Permisos de una barra ──
    const lockReasonOf = useCallback(
        (r: RecordEntity): string | null => {
            if (!canEdit) return __('No tienes permiso para cambiar las fechas.');
            for (const f of [startField, endField]) {
                if (!f) continue;
                const access = storeAccessFor(storeRules, f, r);
                if (access?.access === 'locked') return access.reason;
            }
            return null;
        },
        [canEdit, startField, endField, storeRules],
    );

    // ── Editar fechas (optimista + deshacer) ──
    const undoStack = useRef<UndoEntry[]>([]);
    const undo = useEventCallback((entry?: UndoEntry): void => {
        const e = entry ?? undoStack.current.pop();
        if (!e) return;
        if (entry) undoStack.current = undoStack.current.filter((x) => x !== entry);
        update.mutate(
            { id: e.id, values: e.patch },
            {
                onSuccess: () => toast.info(__('Cambio deshecho')),
                onError: (err) => toast.error(__('No se pudo deshacer'), err instanceof Error ? err.message : undefined),
            },
        );
    });
    const applyEdit = useEventCallback((record: RecordEntity, patch: Record<string, unknown>): void => {
        if (Object.keys(patch).length === 0) return;
        const entry: UndoEntry = { id: record.id, patch: undoPatchFor(record.fields, patch) };
        update.mutate(
            { id: record.id, values: patch },
            {
                onSuccess: (res) => {
                    undoStack.current = [...undoStack.current, entry].slice(-UNDO_DEPTH);
                    const shifted = res.rescheduled?.length ?? 0;
                    toast.show({
                        title: __('Fechas guardadas'),
                        description:
                            shifted > 0
                                ? sprintf(
                                      /* translators: %d: dependent records moved */
                                      __('También se corrieron %d registro(s) que dependen de este.'),
                                      shifted,
                                  )
                                : undefined,
                        variant: 'success',
                        action: { label: __('Deshacer'), onClick: () => undo(entry) },
                    });
                },
                onError: (err) => {
                    if (isCloseCancelled(err)) return;
                    toast.error(__('No se pudieron guardar las fechas'), err instanceof ApiError || err instanceof Error ? err.message : undefined);
                },
            },
        );
    });

    // Ctrl/Cmd+Z dentro del Gantt (fuera de un campo de texto).
    const onKeyDown = (e: React.KeyboardEvent): void => {
        if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, [contenteditable="true"]')) return;
        if (undoStack.current.length === 0) return;
        e.preventDefault();
        undo();
    };

    // ── Arrastrar barras ──
    const [drag, setDrag] = useState<DragState | null>(null);
    const dragRef = useRef<{ id: number; mode: GanttDragMode; startX: number; scroll0: number; bar: GanttBar; moved: boolean; delta: number } | null>(null);
    const suppressClick = useRef(false);
    const onDragStart = useEventCallback((e: React.PointerEvent, id: number, mode: GanttDragMode): void => {
        if (e.button !== 0 || touchOnly) return;
        const record = recordById.get(id);
        const bar = bars.get(id);
        if (!record || !bar || lockReasonOf(record) !== null) return;
        e.preventDefault();
        dragRef.current = { id, mode, startX: e.clientX, scroll0: scrollRef.current?.scrollLeft ?? 0, bar, moved: false, delta: 0 };
        const move = (ev: PointerEvent): void => {
            const d = dragRef.current;
            const el = scrollRef.current;
            if (!d || !el) return;
            // Cerca del borde, el lienzo se corre solo.
            const rect = el.getBoundingClientRect();
            if (ev.clientX > rect.right - 36) el.scrollLeft += 14;
            else if (ev.clientX < rect.left + panelW + 36) el.scrollLeft -= 14;
            const dx = ev.clientX - d.startX + (el.scrollLeft - d.scroll0);
            if (!d.moved && Math.abs(dx) < 4) return;
            d.moved = true;
            const delta = snapDays(dx, canvas.ppd);
            if (delta !== d.delta) {
                d.delta = delta;
                setDrag({ id: d.id, mode: d.mode, delta });
            } else if (!drag) {
                setDrag({ id: d.id, mode: d.mode, delta });
            }
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            const d = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            if (!d || !d.moved) return;
            suppressClick.current = true;
            window.setTimeout(() => (suppressClick.current = false), 0);
            if (d.delta === 0 || !startRef) return;
            const rec = recordById.get(d.id);
            if (!rec) return;
            const after = ganttDraggedBar(d.bar, d.mode, d.delta);
            const patch = ganttMovePatch(
                rec.fields,
                { slug: startRef.key, type: startRef.type },
                endRef ? { slug: endRef.key, type: endRef.type } : null,
                d.bar,
                after,
            );
            applyEdit(rec, patch);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    });

    // ── Crear dependencias tirando una flecha ──
    const [link, setLink] = useState<LinkState | null>(null);
    const onLinkStart = useEventCallback((e: React.PointerEvent, id: number): void => {
        if (e.button !== 0) return;
        const idx = rowIndexById.get(id);
        const bar = bars.get(id);
        const body = bodyRef.current;
        if (idx === undefined || !bar || !body) return;
        e.preventDefault();
        const box = barBox(canvas, bar);
        const y = idx * GANTT_ROW_H + GANTT_BAR_TOP + GANTT_BAR_H / 2;
        const x = panelW + box.left + box.width;
        setLink({ fromId: id, x1: x, y1: y, x2: x, y2: y });
        const move = (ev: PointerEvent): void => {
            const r = body.getBoundingClientRect();
            setLink((l) => (l ? { ...l, x2: ev.clientX - r.left, y2: ev.clientY - r.top } : l));
        };
        const up = (ev: PointerEvent): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setLink(null);
            const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-gantt-record-id]');
            const toId = target ? Number(target.dataset.ganttRecordId) : NaN;
            if (!Number.isInteger(toId) || toId === id) return;
            const from = recordById.get(id);
            const to = recordById.get(toId);
            addPair.mutate(
                { blocker_id: id, blocked_id: toId },
                {
                    onSuccess: () =>
                        toast.success(
                            __('Dependencia creada'),
                            sprintf(__('«%1$s» bloquea a «%2$s».'), from ? titleOf(from) : '', to ? titleOf(to) : ''),
                        ),
                    onError: (err) => toast.error(__('No se pudo crear la dependencia'), err instanceof Error ? err.message : undefined),
                },
            );
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });

    const onArrowClick = async (depId: number, blockerId: number, blockedId: number): Promise<void> => {
        if (!canEdit) return;
        const a = recordById.get(blockerId);
        const b = recordById.get(blockedId);
        const ok = await confirm({
            title: __('¿Quitar esta dependencia?'),
            description: sprintf(__('«%1$s» dejará de bloquear a «%2$s».'), a ? titleOf(a) : '', b ? titleOf(b) : ''),
            confirmLabel: __('Quitar'),
            destructive: true,
        });
        if (!ok) return;
        removeDep.mutate(depId, {
            onSuccess: () => toast.success(__('Dependencia quitada')),
            onError: (err) => toast.error(__('No se pudo quitar la dependencia'), err instanceof Error ? err.message : undefined),
        });
    };

    // ── Menú de una barra (tocar en el teléfono; click derecho en escritorio) ──
    const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
    const [moving, setMoving] = useState<RecordEntity | null>(null);
    const onTap = useEventCallback((e: React.MouseEvent, id: number): void => {
        if (suppressClick.current) return;
        if (touchOnly) {
            setMenu({ id, x: e.clientX, y: e.clientY });
            return;
        }
        onOpenRecord(id);
    });
    const onMenu = useEventCallback((e: React.MouseEvent, id: number): void => {
        e.preventDefault();
        setMenu({ id, x: e.clientX, y: e.clientY });
    });

    // ── «Sin programar»: soltar en el lienzo le da fechas ──
    const [unscheduledOpen, setUnscheduledOpen] = useState(false);
    const DRAG_MIME = 'application/x-imcrm-gantt-record';
    const onBodyDragOver = (e: React.DragEvent): void => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    };
    const onBodyDrop = (e: React.DragEvent): void => {
        const raw = e.dataTransfer.getData(DRAG_MIME);
        const body = bodyRef.current;
        const el = scrollRef.current;
        if (!raw || !body || !el || !startRef) return;
        e.preventDefault();
        if (e.clientX < el.getBoundingClientRect().left + panelW) return;
        const record = recordById.get(Number(raw));
        if (!record) return;
        const reason = lockReasonOf(record);
        if (reason) {
            toast.error(__('No se puede programar'), reason);
            return;
        }
        const x = e.clientX - body.getBoundingClientRect().left - panelW;
        const day = dayAtX(canvas, x);
        applyEdit(
            record,
            ganttSchedulePatch({ slug: startRef.key, type: startRef.type }, endRef ? { slug: endRef.key, type: endRef.type } : null, day, GANTT_SCHEDULE_DAYS[settings.zoom]),
        );
    };

    // ── Zoom e «Ir a hoy» ──
    const setZoom = (z: GanttZoom): void => {
        const el = scrollRef.current;
        if (el) anchor.current = { day: dayAtX(canvas, el.scrollLeft + timelineWidth() / 2), at: 0.5 };
        saveSettings({ ...settings, zoom: z });
    };
    const goToday = (): void => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ left: scrollLeftFor(canvas, today, timelineWidth(), 1 / 3), behavior: 'smooth' });
    };

    // ── Ajustar anchos del panel ──
    const onResizeStart = (e: React.PointerEvent, index: number): void => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = index < 0 ? widths.title : widths.columns[index] ?? 120;
        let last = startW;
        setResizing({ index, width: startW });
        const move = (ev: PointerEvent): void => {
            last = Math.max(index < 0 ? 80 : 60, Math.min(600, startW + ev.clientX - startX));
            setResizing({ index, width: last });
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setResizing(null);
            if (Math.round(last) === Math.round(startW)) return;
            const next = resizePanelColumn({ titleWidth: settings.titleWidth, columns }, index, last);
            saveSettings({ ...settings, titleWidth: next.titleWidth, columns: next.columns });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    // ── PDF ──
    const [pdfBusy, setPdfBusy] = useState(false);
    const exportPdf = async (): Promise<void> => {
        const el = scrollRef.current;
        if (!el || !startField) return;
        const vis = visibleDayRange(canvas, el.scrollLeft, timelineWidth());
        const to = Math.min(vis.to, vis.from + GANTT_MAX_RANGE_DAYS - 1);
        setPdfBusy(true);
        try {
            await downloadGanttPdf(listId, {
                view_id: view.id,
                title: view.name,
                start_field_id: startField.id,
                end_field_id: endField?.id ?? null,
                group_by_field_id: groupField?.id ?? null,
                color_field_id: colorField?.id ?? null,
                color_by: settings.colorBy,
                column_field_ids: columns.map((c) => c.field_id).slice(0, 6),
                zoom: settings.zoom,
                from: dayToYmd(vis.from),
                to: dayToYmd(to),
                ...(isEmptyTree(filterTree) ? {} : { filter_tree: filterTree as never }),
                ...(search.trim() !== '' ? { search: search.trim() } : {}),
                ...(sortParam(config.sort) ? { sort: sortParam(config.sort) } : {}),
                show_subtasks: settings.showSubtasks,
                show_dependencies: settings.showDependencies,
                show_baseline: settings.showBaseline,
                collapsed_groups: [...collapsedGroups],
            });
        } catch (err) {
            toast.error(__('No se pudo exportar el PDF'), err instanceof Error ? err.message : undefined);
        } finally {
            setPdfBusy(false);
        }
    };

    // ── Línea base ──
    const baseline = settings.showBaseline ? data?.baseline ?? null : null;
    const onSaveBaseline = async (): Promise<void> => {
        if (data?.baseline) {
            const ok = await confirm({
                title: __('¿Reemplazar la línea base?'),
                description: __('Se guardan las fechas de hoy y la línea base anterior se pierde.'),
                confirmLabel: __('Reemplazar'),
            });
            if (!ok) return;
        }
        saveBaseline.mutate(
            {},
            {
                onSuccess: (b) => {
                    toast.success(
                        __('Línea base guardada'),
                        sprintf(
                            /* translators: %d: records frozen */
                            __('Se guardaron las fechas de %d registro(s). Debajo de cada barra se verá dónde estaba.'),
                            b.item_count,
                        ),
                    );
                    if (!settings.showBaseline) saveSettings({ ...settings, showBaseline: true });
                },
                onError: (err) => toast.error(__('No se pudo guardar la línea base'), err instanceof Error ? err.message : undefined),
            },
        );
    };
    const onDeleteBaseline = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Quitar la línea base?'),
            description: __('Se borran las fechas guardadas. Los registros no cambian.'),
            confirmLabel: __('Quitar'),
            destructive: true,
        });
        if (!ok) return;
        deleteBaseline.mutate(undefined, {
            onSuccess: () => toast.success(__('Línea base quitada')),
            onError: (err) => toast.error(__('No se pudo quitar la línea base'), err instanceof Error ? err.message : undefined),
        });
    };

    // ── Virtualización de filas ──
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => GANTT_ROW_H,
        overscan: 12,
        scrollMargin: GANTT_HEADER_H,
    });
    const items = virtualizer.getVirtualItems();
    const firstRow = items[0]?.index ?? 0;
    const lastRow = items[items.length - 1]?.index ?? -1;

    // Encabezado: sólo las marcas cerca de lo que se ve.
    const ticks = useMemo(() => {
        const r = visibleDayRange(canvas, Math.max(0, hView.left - hView.width), hView.width * 3 + 256);
        return ganttTicks(settings.zoom, Math.max(canvas.origin, r.from), Math.min(canvas.origin + canvas.days - 1, r.to));
    }, [canvas, hView, settings.zoom]);

    // Geometría (con la barra que se arrastra ya corrida).
    const barGeom = useCallback(
        (id: number): GanttBar | null => {
            const b = bars.get(id) ?? null;
            if (!b) return null;
            return drag && drag.id === id ? ganttDraggedBar(b, drag.mode, drag.delta) : b;
        },
        [bars, drag],
    );

    const arrows = useMemo(() => {
        if (!settings.showDependencies || !data) return [];
        const out: Array<{ id: number; from: number; to: number; d: string; conflict: boolean }> = [];
        for (const dep of data.dependencies) {
            const ia = rowIndexById.get(dep.blocker_id);
            const ib = rowIndexById.get(dep.blocked_id);
            if (ia === undefined || ib === undefined) continue;
            if (Math.max(ia, ib) < firstRow - 30 || Math.min(ia, ib) > lastRow + 30) continue;
            const a = barGeom(dep.blocker_id);
            const b = barGeom(dep.blocked_id);
            if (!a || !b) continue;
            const ba = barBox(canvas, a);
            const bb = barBox(canvas, b);
            const from = { x: ba.left + ba.width, y: ia * GANTT_ROW_H + GANTT_BAR_TOP + GANTT_BAR_H / 2 };
            const to = { x: bb.left - 2, y: ib * GANTT_ROW_H + GANTT_BAR_TOP + GANTT_BAR_H / 2 };
            out.push({ id: dep.id, from: dep.blocker_id, to: dep.blocked_id, d: dependencyPath(from, to), conflict: b.start <= a.end });
        }
        return out;
    }, [settings.showDependencies, data, rowIndexById, firstRow, lastRow, barGeom, canvas]);

    const menuRecord = menu ? recordById.get(menu.id) ?? null : null;
    const dragTip = useMemo(() => {
        if (!drag) return null;
        const b = barGeom(drag.id);
        if (!b) return null;
        return `${ganttDayLabel(b.start)}${b.milestone ? '' : ` → ${ganttDayLabel(b.end)} · ${ganttDurationLabel(b)}`}`;
    }, [drag, barGeom]);

    // ── Sin fecha de inicio: no hay Gantt ──
    if (!startField) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-6" data-testid="gantt-needs-config">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Este Gantt necesita una fecha de inicio')}</p>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Elige qué campo de fecha marca el comienzo de cada barra (y, si quieres, cuál marca el fin).')}</p>
                {canEditView && (
                    <Button size="sm" onClick={() => setSettingsOpen(true)} className="imcrm-gap-1.5">
                        <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Configurar Gantt')}
                    </Button>
                )}
                {settingsOpen && (
                    <GanttSettingsDialog listId={listId} view={view} fields={fields} open={settingsOpen} onOpenChange={setSettingsOpen} canManageList={canManageList} />
                )}
            </div>
        );
    }

    const contentW = panelW + canvas.width;
    const bodyH = rows.length * GANTT_ROW_H;
    const todayX = xOfDay(canvas, today) + canvas.ppd / 2;
    const showWeekends = settings.zoom === 'day';
    const canLink = canEdit && settings.showDependencies && !touchOnly;

    const unscheduledList = (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="gantt-unscheduled-list">
            <p className="imcrm-px-1 imcrm-pb-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                {touchOnly
                    ? __('Toca un registro para darle fechas.')
                    : __('Arrastra un registro hasta el día en que empieza.')}
            </p>
            {unscheduled.length === 0 && <p className="imcrm-px-1 imcrm-text-sm imcrm-text-muted-foreground">{__('Todo tiene fechas.')}</p>}
            {unscheduled.map((r) => {
                const reason = lockReasonOf(r);
                return (
                    <div
                        key={r.id}
                        draggable={!touchOnly && reason === null}
                        onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_MIME, String(r.id));
                            e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => (touchOnly ? setMoving(r) : onOpenRecord(r.id))}
                        title={reason ?? undefined}
                        className={cn(
                            'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1.5 imcrm-text-sm',
                            reason === null && !touchOnly ? 'imcrm-cursor-grab hover:imcrm-border-primary/50' : 'imcrm-cursor-pointer',
                        )}
                        data-testid="gantt-unscheduled-item"
                        data-record-id={r.id}
                    >
                        {reason !== null && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />}
                        <span className="imcrm-truncate">{titleOf(r)}</span>
                    </div>
                );
            })}
            {data && data.meta.unscheduled_total > unscheduled.length && (
                <p className="imcrm-px-1 imcrm-pt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {sprintf(
                        /* translators: %d: hidden unscheduled records */
                        __('Y %d más: usa los filtros para encontrarlos.'),
                        data.meta.unscheduled_total - unscheduled.length,
                    )}
                </p>
            )}
        </div>
    );

    return (
        <div ref={rootRef} className="imcrm-flex imcrm-flex-col imcrm-gap-2" onKeyDown={onKeyDown} data-testid="gantt-view">
            {/* Barra de herramientas */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                <div className="imcrm-flex imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-0.5" role="group" aria-label={__('Zoom')}>
                    {GANTT_ZOOMS.map((z) => (
                        <button
                            key={z}
                            type="button"
                            onClick={() => setZoom(z)}
                            aria-pressed={settings.zoom === z}
                            data-testid={`gantt-zoom-${z}`}
                            className={cn(
                                'imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                settings.zoom === z ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            {GANTT_ZOOM_LABEL[z]}
                        </button>
                    ))}
                </div>
                <Button variant="outline" size="sm" onClick={goToday} className="imcrm-gap-1.5" data-testid="gantt-today">
                    <LocateFixed className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Ir a hoy')}
                </Button>
                {undoStack.current.length > 0 && !narrow && (
                    <Button variant="ghost" size="sm" onClick={() => undo()} className="imcrm-gap-1.5" title={__('Deshacer (Ctrl+Z)')}>
                        <Undo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Deshacer')}
                    </Button>
                )}
                {bundle.isFetching && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Cargando…')} />}
                <div className="imcrm-flex-1" />
                {data?.meta.truncated && (
                    <span className="imcrm-rounded-md imcrm-bg-amber-500/15 imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {sprintf(__('Se muestran los primeros %d: filtra para ver el resto.'), GANTT_MAX_ROWS)}
                    </span>
                )}
                <Button
                    variant={unscheduledOpen ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setUnscheduledOpen((v) => !v)}
                    className="imcrm-gap-1.5"
                    data-testid="gantt-unscheduled-toggle"
                >
                    <CalendarClock className="imcrm-h-3.5 imcrm-w-3.5" />
                    {narrow ? (data?.meta.unscheduled_total ?? 0) : sprintf(__('Sin programar (%d)'), data?.meta.unscheduled_total ?? 0)}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="imcrm-gap-1.5" data-testid="gantt-baseline-menu" aria-label={__('Línea base')}>
                            <History className="imcrm-h-3.5 imcrm-w-3.5" />
                            {!narrow && __('Línea base')}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="imcrm-w-64">
                        {data?.baseline ? (
                            <p className="imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                                {sprintf(
                                    /* translators: 1: date, 2: person */
                                    __('Guardada el %1$s%2$s.'),
                                    ganttDayLabel(dayOfDateValue('datetime', data.baseline.created_at, tz) ?? today),
                                    data.baseline.created_by_name ? sprintf(__(' por %s'), data.baseline.created_by_name) : '',
                                )}
                            </p>
                        ) : (
                            <p className="imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Congela las fechas de hoy para comparar después cuánto se movió cada barra.')}
                            </p>
                        )}
                        {canEditView && (
                            <DropdownMenuItem onSelect={() => void onSaveBaseline()} data-testid="gantt-baseline-save">
                                {data?.baseline ? __('Guardar de nuevo (reemplaza la anterior)') : __('Guardar línea base')}
                            </DropdownMenuItem>
                        )}
                        {data?.baseline && (
                            <DropdownMenuItem onSelect={() => saveSettings({ ...settings, showBaseline: !settings.showBaseline })} data-testid="gantt-baseline-toggle">
                                {settings.showBaseline ? __('Ocultar la línea base') : __('Mostrar la línea base')}
                            </DropdownMenuItem>
                        )}
                        {data?.baseline && canEditView && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => void onDeleteBaseline()} className="imcrm-text-destructive" data-testid="gantt-baseline-delete">
                                    {__('Quitar la línea base')}
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={pdfBusy} className="imcrm-gap-1.5" data-testid="gantt-pdf" aria-label={__('Exportar a PDF')}>
                    {pdfBusy ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <FileDown className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {!narrow && 'PDF'}
                </Button>
                {canEditView && (
                    <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="imcrm-gap-1.5" data-testid="gantt-configure" aria-label={__('Configurar Gantt')}>
                        <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {!narrow && __('Configurar')}
                    </Button>
                )}
            </div>

            <div className="imcrm-flex imcrm-min-w-0 imcrm-gap-2">
                {/* El Gantt: un solo scroll en los dos ejes */}
                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    tabIndex={0}
                    className="imcrm-relative imcrm-min-w-0 imcrm-flex-1 imcrm-overflow-auto imcrm-overscroll-contain imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card focus-visible:imcrm-outline-none"
                    style={{ height }}
                    data-testid="gantt-scroller"
                >
                    <div className="imcrm-relative" style={{ width: contentW, height: GANTT_HEADER_H + bodyH }}>
                        {/* Encabezado del tiempo (pegado arriba) */}
                        <div className="imcrm-sticky imcrm-top-0 imcrm-z-30 imcrm-flex" style={{ width: contentW, height: GANTT_HEADER_H }}>
                            <div
                                className="imcrm-sticky imcrm-left-0 imcrm-z-10 imcrm-flex imcrm-items-end imcrm-border-b imcrm-border-r imcrm-border-border imcrm-bg-card imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground"
                                style={{ width: panelW, minWidth: panelW }}
                            >
                                <div className="imcrm-relative imcrm-flex imcrm-h-6 imcrm-shrink-0 imcrm-items-center imcrm-overflow-hidden imcrm-px-2" style={{ width: narrow ? panelW : widths.title }}>
                                    {titleField?.label ?? __('Nombre')}
                                    {!narrow && <ResizeHandle onPointerDown={(e) => onResizeStart(e, -1)} />}
                                </div>
                                {!narrow &&
                                    columnFields.map((f, i) => (
                                        <div key={f.id} className="imcrm-relative imcrm-flex imcrm-h-6 imcrm-shrink-0 imcrm-items-center imcrm-overflow-hidden imcrm-border-l imcrm-border-border/60 imcrm-px-2" style={{ width: widths.columns[i] }}>
                                            <span className="imcrm-truncate">{f.label}</span>
                                            <ResizeHandle onPointerDown={(e) => onResizeStart(e, i)} />
                                        </div>
                                    ))}
                            </div>
                            <div className="imcrm-relative imcrm-shrink-0 imcrm-border-b imcrm-border-border imcrm-bg-card" style={{ width: canvas.width, height: GANTT_HEADER_H }}>
                                {ticks.top.map((t) => (
                                    <div
                                        key={`t${t.day}`}
                                        className="imcrm-absolute imcrm-top-0 imcrm-flex imcrm-items-center imcrm-border-l imcrm-border-border/70 imcrm-text-[11px] imcrm-font-semibold imcrm-capitalize imcrm-text-foreground/80"
                                        style={{ left: xOfDay(canvas, t.day), width: t.days * canvas.ppd, height: GANTT_HEADER_TOP_H }}
                                    >
                                        <span className="imcrm-sticky imcrm-truncate imcrm-px-1.5" style={{ left: panelW }}>
                                            {t.label}
                                        </span>
                                    </div>
                                ))}
                                {ticks.bottom.map((t) => (
                                    <div
                                        key={`b${t.day}`}
                                        className={cn(
                                            'imcrm-absolute imcrm-flex imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-border-l imcrm-border-t imcrm-border-border/60 imcrm-text-[10.5px] imcrm-text-muted-foreground',
                                            t.weekend && 'imcrm-bg-muted/60',
                                            t.day <= today && today < t.day + t.days && 'imcrm-font-semibold imcrm-text-primary',
                                        )}
                                        style={{ left: xOfDay(canvas, t.day), width: t.days * canvas.ppd, top: GANTT_HEADER_TOP_H, height: GANTT_HEADER_BOTTOM_H }}
                                    >
                                        {t.days * canvas.ppd >= 22 ? t.label : ''}
                                    </div>
                                ))}
                                <div
                                    className="imcrm-absolute imcrm-z-[1] imcrm-rounded-full imcrm-bg-primary imcrm-px-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-leading-4 imcrm-text-primary-foreground"
                                    style={{ left: todayX, top: 3, transform: 'translateX(-50%)' }}
                                    data-testid="gantt-today-label"
                                >
                                    {__('Hoy')}
                                </div>
                                <div className="imcrm-absolute imcrm-w-px imcrm-bg-primary/70" style={{ left: todayX, top: 19, bottom: 0 }} aria-hidden />
                            </div>
                        </div>

                        {/* Cuerpo */}
                        <div
                            ref={bodyRef}
                            className="imcrm-absolute imcrm-left-0"
                            style={{ top: GANTT_HEADER_H, width: contentW, height: Math.max(bodyH, 1) }}
                            onDragOver={onBodyDragOver}
                            onDrop={onBodyDrop}
                        >
                            {/* Cuadrícula, fines de semana y la línea de hoy */}
                            <div className="imcrm-pointer-events-none imcrm-absolute imcrm-top-0" style={{ left: panelW, width: canvas.width, height: Math.max(bodyH, height - GANTT_HEADER_H) }} aria-hidden>
                                {ticks.bottom.map((t) => (
                                    <div
                                        key={`g${t.day}`}
                                        className={cn('imcrm-absolute imcrm-inset-y-0 imcrm-border-l imcrm-border-border/40', t.weekend && showWeekends && 'imcrm-bg-muted/40')}
                                        style={{ left: xOfDay(canvas, t.day), width: t.days * canvas.ppd }}
                                    />
                                ))}
                                <div className="imcrm-absolute imcrm-inset-y-0 imcrm-w-px imcrm-bg-primary/70" style={{ left: todayX }} data-testid="gantt-today-line" />
                            </div>

                            {/* Flechas de las dependencias */}
                            {arrows.length > 0 && (
                                <svg className="imcrm-absolute imcrm-top-0 imcrm-z-[1] imcrm-overflow-visible" style={{ left: panelW, width: 1, height: 1, pointerEvents: 'none' }} aria-hidden>
                                    <defs>
                                        <marker id={`gantt-arrow-${view.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                                            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                                        </marker>
                                    </defs>
                                    {arrows.map((a) => (
                                        <g
                                            key={a.id}
                                            className={cn(a.conflict ? 'imcrm-text-amber-500' : 'imcrm-text-muted-foreground', canEdit && 'hover:imcrm-text-destructive')}
                                            data-testid="gantt-arrow"
                                            data-from={a.from}
                                            data-to={a.to}
                                        >
                                            <path d={a.d} fill="none" stroke="currentColor" strokeWidth={1.4} markerEnd={`url(#gantt-arrow-${view.id})`} />
                                            <path
                                                d={a.d}
                                                fill="none"
                                                stroke="transparent"
                                                strokeWidth={10}
                                                style={{ pointerEvents: canEdit ? 'stroke' : 'none', cursor: canEdit ? 'pointer' : undefined }}
                                                onClick={() => void onArrowClick(a.id, a.from, a.to)}
                                            >
                                                <title>{a.conflict ? __('Empieza antes de que termine lo que lo bloquea. Click para quitar.') : __('Click para quitar la dependencia.')}</title>
                                            </path>
                                        </g>
                                    ))}
                                </svg>
                            )}

                            {/* Filas (virtualizadas) */}
                            {items.map((vi) => {
                                const row = rows[vi.index];
                                if (!row) return null;
                                const top = vi.index * GANTT_ROW_H;
                                if (row.kind === 'group') {
                                    const opt = groupField?.type === 'select' ? groupOptions.find((o) => o.value === row.key) : undefined;
                                    return (
                                        <div
                                            key={`g:${row.key}`}
                                            className="imcrm-absolute imcrm-left-0 imcrm-z-[2] imcrm-flex imcrm-border-b imcrm-border-border/70 imcrm-bg-muted/50"
                                            style={{ top, width: contentW, height: GANTT_ROW_H }}
                                            data-testid="gantt-group"
                                            data-group-key={row.key}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => toggleGroup(row.key)}
                                                className="imcrm-sticky imcrm-left-0 imcrm-z-[3] imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-border-r imcrm-border-border imcrm-bg-muted imcrm-px-2 imcrm-text-left imcrm-text-xs imcrm-font-semibold"
                                                style={{ width: panelW, minWidth: panelW }}
                                                aria-expanded={!row.collapsed}
                                            >
                                                {row.collapsed ? <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" /> : <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />}
                                                <span
                                                    className="imcrm-truncate imcrm-rounded imcrm-border imcrm-border-transparent imcrm-px-1.5 imcrm-py-px"
                                                    style={opt?.color ? chipSoftStyle(opt.color) : undefined}
                                                >
                                                    {groupLabel(row.key)}
                                                </span>
                                                <span className="imcrm-shrink-0 imcrm-font-normal imcrm-text-muted-foreground">{row.count}</span>
                                            </button>
                                        </div>
                                    );
                                }
                                const record = recordById.get(row.id);
                                if (!record) return null;
                                const geom = barGeom(row.id);
                                const box = geom ? barBox(canvas, geom) : null;
                                const base = baseline?.items[String(row.id)];
                                const baseBar = base
                                    ? ganttBarOf({ s: base.start, e: base.end }, { key: 's', type: startField.type }, endField ? { key: 'e', type: endField.type } : null, tz)
                                    : null;
                                const baseBox = baseBar ? { ...barBox(canvas, baseBar), milestone: baseBar.milestone } : null;
                                const reason = lockReasonOf(record);
                                const title = titleOf(record);
                                const blocked = (record.blocked_by_open ?? 0) > 0;
                                const tooltip = [
                                    title,
                                    geom ? `${ganttDayLabel(geom.start)}${geom.milestone ? '' : ` → ${ganttDayLabel(geom.end)} · ${ganttDurationLabel(geom)}`}` : '',
                                    blocked ? sprintf(__('Bloqueado por %d registro(s) abierto(s).'), record.blocked_by_open ?? 0) : '',
                                    reason && !touchOnly ? reason : '',
                                ]
                                    .filter(Boolean)
                                    .join('\n');
                                return (
                                    <div
                                        key={row.id}
                                        className="imcrm-group/row imcrm-pointer-events-none imcrm-absolute imcrm-left-0 imcrm-z-[2] imcrm-flex imcrm-border-b imcrm-border-border/40 hover:imcrm-bg-foreground/[0.03]"
                                        style={{ top, width: contentW, height: GANTT_ROW_H }}
                                        data-testid="gantt-row"
                                        data-record-id={row.id}
                                    >
                                        <div
                                            className="imcrm-pointer-events-auto imcrm-sticky imcrm-left-0 imcrm-z-[3] imcrm-flex imcrm-border-r imcrm-border-border imcrm-bg-card group-hover/row:imcrm-bg-muted"
                                            style={{ width: panelW, minWidth: panelW }}
                                            data-gantt-record-id={row.id}
                                        >
                                            <div
                                                className="imcrm-flex imcrm-min-w-0 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-px-2 imcrm-text-[13px]"
                                                style={{ width: narrow ? panelW : widths.title, paddingLeft: 8 + row.depth * 16 }}
                                            >
                                                {row.hasChildren ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleParent(row.id)}
                                                        className="imcrm-shrink-0 imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                                        aria-label={row.collapsed ? __('Mostrar subtareas') : __('Ocultar subtareas')}
                                                        aria-expanded={!row.collapsed}
                                                    >
                                                        {row.collapsed ? <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />}
                                                    </button>
                                                ) : (
                                                    <span className="imcrm-w-[18px] imcrm-shrink-0" />
                                                )}
                                                {blocked && (
                                                    <Lock
                                                        className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400"
                                                        aria-label={sprintf(__('Bloqueado por %d'), record.blocked_by_open ?? 0)}
                                                        data-testid="gantt-row-blocked"
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenRecord(row.id)}
                                                    className={cn('imcrm-min-w-0 imcrm-truncate imcrm-text-left hover:imcrm-underline', !geom && 'imcrm-text-muted-foreground')}
                                                    title={title}
                                                >
                                                    {title}
                                                </button>
                                            </div>
                                            {!narrow &&
                                                columnFields.map((f, i) => (
                                                    <div
                                                        key={f.id}
                                                        className="imcrm-flex imcrm-min-w-0 imcrm-shrink-0 imcrm-items-center imcrm-overflow-hidden imcrm-whitespace-nowrap imcrm-border-l imcrm-border-border/40 imcrm-px-2 imcrm-text-xs"
                                                        style={{ width: widths.columns[i] }}
                                                    >
                                                        <span className="imcrm-min-w-0 imcrm-truncate">{renderCellValue(f, record.fields[f.slug])}</span>
                                                    </div>
                                                ))}
                                        </div>
                                        {geom && box && (
                                            <GanttBarItem
                                                recordId={row.id}
                                                left={box.left}
                                                width={box.width}
                                                bar={geom}
                                                offset={panelW}
                                                label={title}
                                                tooltip={tooltip}
                                                colorStyle={colorStyleOf(record)}
                                                blocked={blocked}
                                                baseline={baseBox}
                                                draggable={!touchOnly && reason === null}
                                                linkable={canLink}
                                                dragging={drag?.id === row.id}
                                                onDragStart={onDragStart}
                                                onLinkStart={onLinkStart}
                                                onTap={onTap}
                                                onMenu={onMenu}
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {/* La flecha que se está tirando */}
                            {link && (
                                <svg className="imcrm-pointer-events-none imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-z-[4] imcrm-overflow-visible" style={{ width: 1, height: 1 }} aria-hidden>
                                    <line x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} stroke="hsl(var(--imcrm-primary))" strokeWidth={1.6} strokeDasharray="4 3" />
                                    <circle cx={link.x2} cy={link.y2} r={3.5} fill="hsl(var(--imcrm-primary))" />
                                </svg>
                            )}
                        </div>

                        {rows.length === 0 && !bundle.isLoading && (
                            <div
                                className="imcrm-sticky imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground"
                                style={{ left: 0, width: Math.min(contentW, 640), top: GANTT_HEADER_H }}
                                data-testid="gantt-empty"
                            >
                                {__('No hay registros con fechas en este período.')}
                                <Button variant="outline" size="sm" onClick={goToday}>
                                    {__('Ir a hoy')}
                                </Button>
                            </div>
                        )}
                    </div>
                    {bundle.isLoading && (
                        <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-justify-center">
                            <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                        </div>
                    )}
                    {dragTip && (
                        <div className="imcrm-pointer-events-none imcrm-sticky imcrm-bottom-2 imcrm-left-2 imcrm-z-40 imcrm-ml-2 imcrm-inline-block imcrm-rounded-md imcrm-bg-foreground imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-background imcrm-shadow-imcrm-md" data-testid="gantt-drag-tip">
                            {dragTip}
                        </div>
                    )}
                </div>

                {/* «Sin programar» al costado (escritorio) */}
                {unscheduledOpen && !narrow && (
                    <aside className="imcrm-flex imcrm-w-64 imcrm-shrink-0 imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" style={{ height }} data-testid="gantt-unscheduled">
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                            <span className="imcrm-text-sm imcrm-font-semibold">{sprintf(__('Sin programar · %d'), data?.meta.unscheduled_total ?? 0)}</span>
                            <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={() => setUnscheduledOpen(false)} aria-label={__('Cerrar')}>
                                <X className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                        </div>
                        <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-2">{unscheduledList}</div>
                    </aside>
                )}
            </div>

            {narrow && (
                <Sheet open={unscheduledOpen} onOpenChange={setUnscheduledOpen}>
                    <SheetContent side="right" className="imcrm-w-[88vw] imcrm-max-w-sm">
                        <SheetHeader>
                            <SheetTitle>{sprintf(__('Sin programar · %d'), data?.meta.unscheduled_total ?? 0)}</SheetTitle>
                        </SheetHeader>
                        <SheetBody>{unscheduledList}</SheetBody>
                    </SheetContent>
                </Sheet>
            )}

            {/* Menú de una barra */}
            <DropdownMenu open={menu !== null} onOpenChange={(o) => !o && setMenu(null)}>
                <DropdownMenuTrigger asChild>
                    <span aria-hidden className="imcrm-fixed imcrm-h-0 imcrm-w-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="imcrm-w-56" data-testid="gantt-bar-menu">
                    {menuRecord && (
                        <>
                            <p className="imcrm-truncate imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-font-semibold">{titleOf(menuRecord)}</p>
                            <DropdownMenuItem onSelect={() => onOpenRecord(menuRecord.id)}>{__('Abrir')}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setMoving(menuRecord)} data-testid="gantt-move-dates">
                                {__('Mover fechas…')}
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <GanttMoveDatesDialog
                record={moving}
                title={moving ? titleOf(moving) : ''}
                startField={startField}
                endField={endField}
                lockedReason={moving ? lockReasonOf(moving) : null}
                onOpenChange={(o) => !o && setMoving(null)}
                onSave={applyEdit}
            />

            {settingsOpen && (
                <GanttSettingsDialog listId={listId} view={view} fields={fields} open={settingsOpen} onOpenChange={setSettingsOpen} canManageList={canManageList} />
            )}
        </div>
    );
}

function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }): JSX.Element {
    return (
        <span
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onPointerDown}
            className="imcrm-absolute imcrm-inset-y-0 imcrm-right-0 imcrm-w-1.5 imcrm-cursor-col-resize hover:imcrm-bg-primary/40"
            data-testid="gantt-col-resize"
        />
    );
}

/** Las filas del Gantt con los accesores del registro (lo mismo que arma el PDF). */
function buildRows(
    records: RecordEntity[],
    opts: {
        groupField: FieldEntity | null;
        groupKeyOf: (r: RecordEntity) => string | null;
        groupOrder: string[];
        collapsedGroups: Set<string>;
        collapsedParents: Set<number>;
        showSubtasks: boolean;
    },
): GanttRowItem[] {
    return buildGanttRows(
        records,
        { id: (r) => r.id, parent: (r) => r.parent_id ?? null, group: opts.groupField ? opts.groupKeyOf : undefined },
        {
            grouped: opts.groupField !== null,
            groupOrder: opts.groupOrder,
            collapsedGroups: opts.collapsedGroups,
            collapsedParents: opts.collapsedParents,
            showSubtasks: opts.showSubtasks,
        },
    );
}
