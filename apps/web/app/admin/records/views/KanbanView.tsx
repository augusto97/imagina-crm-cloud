import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    ChevronsLeftRight,
    EyeOff,
    Eye,
    Gauge,
    MoreHorizontal,
    Plus,
    Settings2,
} from 'lucide-react';
import {
    KANBAN_PAGE_SIZE,
    readKanbanSettings,
    withKanbanSettings,
    type KanbanSettings,
} from '@imagina-base/shared';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { chipSoftStyle, colorVar, type OptionColor } from '@/components/ui/color-picker';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useAttachments } from '@/hooks/useAttachments';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useKanbanBundle } from '@/hooks/useKanbanBundle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CAP, useCanAny } from '@/lib/permissions';
import { useUpdateRecord } from '@/hooks/useRecords';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { useMemberNames } from '@/hooks/useWpUsers';
import { __, sprintf } from '@/lib/i18n';
import { proxiedImageUrl } from '@/lib/imageProxy';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree, RecordEntity } from '@/types/record';
import type { SavedViewEntity } from '@/types/view';

import { isCloseCancelled } from '../dependencies/closeGuard';
import { storeAccessFor, useStoreRules } from '../storeRules';
import { EditKanbanViewDialog } from './EditKanbanViewDialog';
import { createHScrollGroup } from './hscrollGroup';
import { KanbanCard, type MoveTarget } from './kanban/KanbanCard';
import { KanbanColumnSettingsDialog } from './kanban/KanbanColumnSettingsDialog';
import { KanbanMoveDialog, type PendingMove } from './kanban/KanbanMoveDialog';
import {
    buildBoard,
    cellAt,
    formatKanbanValue,
    isValueCandidate,
    planMove,
    prefillFor,
    sortParam,
    type BoardCell,
    type BoardColumn,
    type BoardLane,
} from './kanban/kanbanModel';
import { StickyHScrollbar } from './StickyHScrollbar';
import { usePageStickyTop } from './stickyTop';

/**
 * Vista Kanban — v0.1.297 «Kanban para ventas» (B5).
 *
 * Todo el tablero sale de UN pedido (`kanban-bundle`): columnas en el orden
 * del campo, carriles opcionales por un segundo campo, y por cada columna,
 * carril y celda la cantidad de tarjetas y la suma (o el promedio) del campo
 * de valor — calculados por el servidor sobre TODO lo que coincide con la
 * vista, no sobre lo cargado. Las tarjetas llegan de a tandas por celda
 * («Mostrar más»).
 *
 * Arrastrar una tarjeta (o «Mover a…» en el teléfono) cambia el campo de las
 * columnas y, entre carriles, también el de los carriles. Si la columna
 * destino pide campos («Motivo de pérdida» al pasar a «Perdido») y están
 * vacíos, se abre un diálogo antes de mover; cancelar no toca nada.
 *
 * Los ajustes que se cambian desde el tablero (plegar, ocultar, límites,
 * carriles, totales) se guardan en la vista si la persona puede editarla; si
 * no, quedan sólo en su pantalla.
 */
interface KanbanViewProps {
    listId: number;
    fields: FieldEntity[];
    view: SavedViewEntity;
    groupByField: FieldEntity;
    onCardClick: (record: RecordEntity) => void;
    filterTree?: FilterTree;
    search?: string;
    /** Crear una tarjeta dentro de una columna (y carril): valores pre-cargados. */
    onAddRecord?: (prefill: Record<string, unknown>) => void;
    /** Total de lo que coincide, si está cargando y el orden de las tarjetas (anterior/siguiente). */
    onStatusChange?: (s: { total: number | null; fetching: boolean; ids: number[] }) => void;
    /** Si los cambios del tablero se guardan en la vista (permiso + vista no protegida). */
    canEditView: boolean;
    /** Diálogo «Configurar tablero» controlado desde afuera (panel Personalizar). */
    settingsOpen?: boolean;
    onSettingsOpenChange?: (open: boolean) => void;
}

const COL_W = 288;
const COLLAPSED_W = 44;
const GAP = 12;

export function KanbanView({
    listId,
    fields,
    view,
    groupByField,
    onCardClick,
    filterTree,
    search,
    onAddRecord,
    onStatusChange,
    canEditView,
    settingsOpen: settingsOpenProp,
    onSettingsOpenChange,
}: KanbanViewProps): JSX.Element {
    const toast = useToast();
    const update = useUpdateRecord(listId);
    const updateView = useUpdateSavedView(listId);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const storeRules = useStoreRules();
    const touchOnly = useMediaQuery('(hover: none) and (pointer: coarse)');
    const stickyTop = usePageStickyTop();

    // ── Ajustes del tablero (de la vista, con override local optimista) ──
    const serverSettings = useMemo(() => readKanbanSettings(view.config), [view.config]);
    const [override, setOverride] = useState<KanbanSettings | null>(null);
    const pendingSaves = useRef(0);
    useEffect(() => {
        if (pendingSaves.current === 0) setOverride(null);
    }, [view.config]);
    const settings = override ?? serverSettings;
    const saveSettings = useEventCallback((next: KanbanSettings): void => {
        setOverride(next);
        if (!canEditView) return;
        pendingSaves.current += 1;
        updateView.mutate(
            { id: view.id, config: withKanbanSettings(view.config as Record<string, unknown>, next) },
            {
                onError: (err) => {
                    toast.error(__('No se pudo guardar el ajuste del tablero'), err instanceof Error ? err.message : undefined);
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

    // ── Campos ──
    const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const laneField =
        settings.laneFieldId !== null && settings.laneFieldId !== groupByField.id ? fieldById.get(settings.laneFieldId) ?? null : null;
    const valueField = settings.valueFieldId !== null ? fieldById.get(settings.valueFieldId) ?? null : null;
    const titleField = useMemo(() => {
        if (settings.titleFieldId !== null) {
            const explicit = fieldById.get(settings.titleFieldId);
            if (explicit) return explicit;
        }
        return pickTitleField(fields, groupByField.id);
    }, [fields, fieldById, groupByField.id, settings.titleFieldId]);
    const metaFields = useMemo(() => {
        if (settings.metaFieldIds.length > 0) {
            return settings.metaFieldIds.map((id) => fieldById.get(id)).filter((f): f is FieldEntity => f !== undefined);
        }
        return pickMetaFields(fields, [groupByField.id, laneField?.id ?? 0, titleField?.id ?? 0]);
    }, [fields, fieldById, groupByField.id, laneField?.id, titleField?.id, settings.metaFieldIds]);
    const coverField = settings.coverFieldId !== null ? fieldById.get(settings.coverFieldId) ?? null : null;

    // ── Datos ──
    const [limits, setLimits] = useState<Record<string, number>>({});
    const hasFilter = filterTree !== undefined && filterTree.children.length > 0;
    const bundle = useKanbanBundle({
        listId,
        groupBy: groupByField.id,
        laneBy: laneField?.id ?? null,
        valueFieldId: valueField?.id ?? null,
        valueMetric: settings.valueMetric,
        filterTree: hasFilter ? filterTree : undefined,
        search: search !== undefined && search.trim() !== '' ? search.trim() : undefined,
        sort: sortParam((view.config as { sort?: Array<{ field_id: number; dir: 'asc' | 'desc' }> }).sort),
        limits,
        skip: [...settings.collapsedColumns, ...settings.hiddenColumns],
        skipLanes: settings.collapsedLanes,
        perCell: KANBAN_PAGE_SIZE,
    });

    // Nombres de personas para columnas/carriles por un campo persona.
    const userIds = useMemo(() => {
        const out: number[] = [];
        const take = (field: FieldEntity | null, values: Array<{ value: string | null }> | undefined): void => {
            if (field?.type !== 'user') return;
            for (const v of values ?? []) if (v.value !== null && Number.isFinite(Number(v.value))) out.push(Number(v.value));
        };
        take(groupByField, bundle.data?.columns);
        take(laneField, bundle.data?.lanes);
        return out;
    }, [bundle.data, groupByField, laneField]);
    const names = useMemberNames(userIds);

    const board = useMemo(
        () => buildBoard({ groupField: groupByField, laneField, valueField, settings, bundle: bundle.data, userNames: names.data }),
        [groupByField, laneField, valueField, settings, bundle.data, names.data],
    );
    const lanesOn = board.lanes !== null;

    // Portadas: los adjuntos de las tarjetas cargadas, en UN pedido.
    const coverIds = useMemo(() => {
        if (!coverField || coverField.type !== 'file') return [];
        const ids: number[] = [];
        for (const cell of board.cells.values()) {
            for (const r of cell.records ?? []) {
                const id = attachmentId(r.fields[coverField.slug]);
                if (id !== null) ids.push(id);
            }
        }
        return ids;
    }, [board, coverField]);
    const attachments = useAttachments(coverIds);
    const coverOf = (record: RecordEntity): string | null => {
        if (!coverField) return null;
        if (coverField.type === 'url') return proxiedImageUrl(record.fields[coverField.slug]);
        const id = attachmentId(record.fields[coverField.slug]);
        const a = id !== null ? attachments.data?.get(id) : undefined;
        return a?.thumbUrl ?? null;
    };

    // Dónde está cada tarjeta (para el arrastre y el «Mover a…»).
    const location = useMemo(() => {
        const m = new Map<number, { column: string; lane: string | null }>();
        for (const cell of board.cells.values()) for (const r of cell.records ?? []) m.set(r.id, { column: cell.columnKey, lane: cell.laneKey });
        return m;
    }, [board]);

    // Total, estado y orden de las tarjetas visibles (anterior/siguiente del modal).
    const orderedIds = useMemo(() => {
        const ids: number[] = [];
        for (const lane of board.lanes ?? [null]) {
            if (lane?.collapsed) continue;
            for (const col of board.columns) {
                if (col.collapsed) continue;
                for (const r of cellAt(board, lane?.key ?? null, col.key).records ?? []) ids.push(r.id);
            }
        }
        return ids;
    }, [board]);
    const statusKey = `${bundle.data?.meta.total_records ?? 'x'}|${bundle.isFetching}|${orderedIds.join(',')}`;
    useEffect(() => {
        onStatusChange?.({ total: bundle.data?.meta.total_records ?? null, fetching: bundle.isFetching, ids: orderedIds });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusKey]);

    // ── Mover ──
    const [drag, setDrag] = useState<{ id: number } | null>(null);
    // El id de la tarjeta que se arrastra también en un ref: `dragover` puede
    // llegar antes de que React vuelva a dibujar con el estado nuevo.
    const dragRef = useRef<number | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingMove | null>(null);
    const [pendingError, setPendingError] = useState<string | null>(null);
    const [pendingSaving, setPendingSaving] = useState(false);

    const lockedReason = useEventCallback((field: FieldEntity, record: RecordEntity): string | null => {
        const access = storeAccessFor(storeRules, field, record);
        return access?.access === 'locked' ? access.reason : null;
    });
    const titleOf = (record: RecordEntity): string => {
        const v = titleField ? record.fields[titleField.slug] : undefined;
        return v !== undefined && v !== null && v !== '' ? String(v) : sprintf(__('Registro #%d'), record.id);
    };
    const columnLabel = (key: string): string => board.columns.find((c) => c.key === key)?.label ?? key;
    const laneLabel = (key: string | null): string => board.lanes?.find((l) => l.key === key)?.label ?? '';

    const commit = async (record: RecordEntity, values: Record<string, unknown>): Promise<boolean> => {
        setMoveError(null);
        try {
            await update.mutateAsync({ id: record.id, values });
            return true;
        } catch (err) {
            // A8 — canceló el cierre de algo bloqueado: la tarjeta vuelve sola.
            if (isCloseCancelled(err)) return false;
            // El optimista se revierte solo (la tarjeta vuelve); la persona
            // tiene que saber por qué (permiso, validación, red).
            setMoveError(err instanceof Error ? err.message : __('No se pudo mover el registro.'));
            return false;
        }
    };

    const tryMove = useEventCallback((record: RecordEntity, toColumn: string, toLane: string | null, via: 'drag' | 'menu'): void => {
        const from = location.get(record.id);
        if (!from) return;
        const plan = planMove({
            record,
            fromColumn: from.column,
            fromLane: from.lane,
            toColumn,
            toLane: lanesOn ? toLane ?? from.lane : null,
            groupField: groupByField,
            laneField: lanesOn ? laneField : null,
            fields,
            settings,
            lockedReason,
        });
        const target = toColumn !== from.column ? columnLabel(toColumn) : laneLabel(toLane);
        if (plan.kind === 'noop') return;
        if (plan.kind === 'blocked') {
            setMoveError(plan.reason);
            return;
        }
        if (plan.kind === 'ask') {
            setPendingError(null);
            setPending({ record, title: titleOf(record), values: plan.values, required: plan.required, targetLabel: target });
            return;
        }
        void commit(record, plan.values).then((ok) => {
            // En el teléfono la columna destino puede quedar fuera de pantalla.
            if (ok && via === 'menu') toast.success(sprintf(__('«%1$s» pasó a «%2$s»'), titleOf(record), target));
        });
    });

    const onConfirmPending = async (values: Record<string, unknown>): Promise<void> => {
        if (!pending) return;
        setPendingSaving(true);
        setPendingError(null);
        try {
            await update.mutateAsync({ id: pending.record.id, values });
            setPending(null);
        } catch (err) {
            if (isCloseCancelled(err)) {
                setPending(null);
                return;
            }
            setPendingError(err instanceof Error ? err.message : __('No se pudo mover el registro.'));
        } finally {
            setPendingSaving(false);
        }
    };

    const onCardDragStart = useEventCallback((record: RecordEntity, e: React.DragEvent): void => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(record.id));
        dragRef.current = record.id;
        setDrag({ id: record.id });
    });
    const onCardDragEnd = useEventCallback((): void => {
        dragRef.current = null;
        setDrag(null);
        setDropTarget(null);
    });
    const onCardOpen = useEventCallback((record: RecordEntity) => onCardClick(record));
    const onMoveColumn = useEventCallback((record: RecordEntity, key: string) => tryMove(record, key, null, 'menu'));
    const onMoveLane = useEventCallback((record: RecordEntity, key: string) => {
        const from = location.get(record.id);
        if (from) tryMove(record, from.column, key, 'menu');
    });
    const dropOn = (cell: BoardCell): void => {
        setDropTarget(null);
        const id = dragRef.current ?? undefined;
        dragRef.current = null;
        setDrag(null);
        if (id === undefined) return;
        const record = findRecord(board, id);
        if (record) tryMove(record, cell.columnKey, cell.laneKey, 'drag');
    };
    const dragHandlers = (cell: BoardCell) => ({
        onDragOver: (e: React.DragEvent) => {
            if (dragRef.current === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropTarget !== cell.key) setDropTarget(cell.key);
        },
        onDragLeave: (e: React.DragEvent) => {
            if (dropTarget === cell.key && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropTarget(null);
        },
        onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            dropOn(cell);
        },
    });

    // ── Ajustes desde el tablero ──
    const toggleIn = (list: string[], key: string): string[] => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
    const toggleColumnCollapsed = (key: string): void => saveSettings({ ...settings, collapsedColumns: toggleIn(settings.collapsedColumns, key) });
    const hideColumn = (key: string): void => saveSettings({ ...settings, hiddenColumns: [...settings.hiddenColumns.filter((k) => k !== key), key] });
    const showColumn = (key: string): void => saveSettings({ ...settings, hiddenColumns: settings.hiddenColumns.filter((k) => k !== key) });
    const toggleLane = (key: string): void => saveSettings({ ...settings, collapsedLanes: toggleIn(settings.collapsedLanes, key) });
    const showMore = (cell: BoardCell): void => {
        const current = cell.records?.length ?? KANBAN_PAGE_SIZE;
        setLimits((prev) => ({ ...prev, [cell.key]: Math.max(prev[cell.key] ?? KANBAN_PAGE_SIZE, current) + KANBAN_PAGE_SIZE }));
    };
    const [columnSettings, setColumnSettings] = useState<BoardColumn | null>(null);

    // Las tandas cargadas se olvidan al cambiar de vista, de agrupación o de carriles.
    const shapeKey = `${view.id}|${groupByField.id}|${laneField?.id ?? 0}`;
    useEffect(() => setLimits({}), [shapeKey]);

    // ── Scroll horizontal compartido (cabecera fija + cuerpo + barra) ──
    const group = useMemo(() => createHScrollGroup(), []);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
    useEffect(() => (headerEl ? group.add(headerEl) : undefined), [headerEl, group]);
    useEffect(() => (bodyEl ? group.add(bodyEl) : undefined), [bodyEl, group]);
    const setBody = (el: HTMLDivElement | null): void => {
        (bodyRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        setBodyEl(el);
    };

    const widthOf = (col: BoardColumn): number => (col.collapsed ? COLLAPSED_W : COL_W);
    const boardWidth = board.columns.reduce((s, c) => s + widthOf(c), 0) + GAP * Math.max(0, board.columns.length - 1);
    const template = board.columns.map((c) => `${widthOf(c)}px`).join(' ');

    const columnTargets: MoveTarget[] = useMemo(
        () => board.columns.map((c) => ({ key: c.key, label: c.label, color: c.color })),
        [board.columns],
    );
    const laneTargets: MoveTarget[] | null = useMemo(
        () => (board.lanes ? board.lanes.map((l) => ({ key: l.key, label: l.label, color: l.color })) : null),
        [board.lanes],
    );
    const groupWritable = !['lookup', 'rollup', 'computed', 'formula', 'ai', 'time_tracked'].includes(groupByField.type);
    const canDrag = canEdit && groupWritable && !touchOnly;

    const laneCandidates = fields.filter((f) => f.id !== groupByField.id && ['select', 'user', 'checkbox'].includes(f.type));
    const valueCandidates = fields.filter(isValueCandidate);

    const renderCards = (cell: BoardCell, column: BoardColumn): React.ReactNode => (
        <>
            {(cell.records ?? []).map((record) => {
                const lock = canEdit ? lockedReason(groupByField, record) : null;
                return (
                    <KanbanCard
                        key={record.id}
                        record={record}
                        titleField={titleField}
                        metaFields={metaFields}
                        valueField={valueField}
                        coverUrl={coverOf(record)}
                        size={settings.cardSize}
                        columnColor={column.color}
                        isDragging={drag?.id === record.id}
                        draggable={canDrag && lock === null}
                        lockReason={lock}
                        onDragStart={onCardDragStart}
                        onDragEnd={onCardDragEnd}
                        onOpen={onCardOpen}
                        columnTargets={canEdit && groupWritable ? columnTargets : []}
                        currentColumn={cell.columnKey}
                        laneTargets={canEdit ? laneTargets : null}
                        currentLane={cell.laneKey}
                        onMoveColumn={onMoveColumn}
                        onMoveLane={onMoveLane}
                    />
                );
            })}
            {cell.hasMore && (
                <button
                    type="button"
                    onClick={() => showMore(cell)}
                    className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card/60 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-border-primary/50 hover:imcrm-text-foreground"
                    data-testid="imcrm-kanban-show-more"
                >
                    {sprintf(
                        /* translators: %d: remaining cards */
                        __('Mostrar más (%d)'),
                        Math.max(0, cell.count - (cell.records?.length ?? 0)),
                    )}
                </button>
            )}
        </>
    );

    const addButton = (column: BoardColumn, laneKey: string | null): React.ReactNode =>
        onAddRecord && groupWritable ? (
            <button
                type="button"
                onClick={() => onAddRecord(prefillFor(groupByField, column.key, lanesOn ? laneField : null, laneKey))}
                className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-foreground/[0.05] hover:imcrm-text-foreground"
                data-testid="imcrm-kanban-add"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar')}
            </button>
        ) : null;

    const loadingFirst = bundle.isLoading && !bundle.data;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-kanban">
            {/* Barra del tablero: totales y atajos (carriles / totales / configurar). */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-text-sm" data-testid="imcrm-kanban-summary">
                    <span className="imcrm-text-muted-foreground">
                        <span className="imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">{formatNumber(board.totalCount, { maxFrac: 0 })}</span>{' '}
                        {board.totalCount === 1 ? __('registro') : __('registros')}
                    </span>
                    {valueField && board.totalValue !== null && (
                        <span className="imcrm-text-muted-foreground" data-testid="imcrm-kanban-total-value">
                            {settings.valueMetric === 'avg'
                                ? sprintf(__('Promedio de «%s»:'), valueField.label)
                                : sprintf(__('Total de «%s»:'), valueField.label)}{' '}
                            <span className="imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">{formatKanbanValue(valueField, board.totalValue)}</span>
                        </span>
                    )}
                    {board.hiddenColumns.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button type="button" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-foreground/[0.05] hover:imcrm-text-foreground">
                                    <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {sprintf(
                                        board.hiddenColumns.length === 1 ? __('%d columna oculta') : __('%d columnas ocultas'),
                                        board.hiddenColumns.length,
                                    )}
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuLabel>{__('Mostrar de nuevo')}</DropdownMenuLabel>
                                {board.hiddenColumns.map((c) => (
                                    <DropdownMenuItem key={c.key} onSelect={() => showColumn(c.key)}>
                                        <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {c.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Carriles')}
                        <Select
                            value={laneField?.id ?? ''}
                            onChange={(e) => {
                                const id = e.target.value === '' ? null : Number(e.target.value);
                                saveSettings({ ...settings, laneFieldId: id, collapsedLanes: [] });
                            }}
                            className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[8rem] imcrm-text-xs"
                            data-testid="imcrm-kanban-lane-select"
                        >
                            <option value="">{__('Sin carriles')}</option>
                            {laneCandidates.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </label>
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Totales')}
                        <Select
                            value={valueField?.id ?? ''}
                            onChange={(e) => {
                                const id = e.target.value === '' ? null : Number(e.target.value);
                                saveSettings({ ...settings, valueFieldId: id });
                            }}
                            className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[8rem] imcrm-text-xs"
                            data-testid="imcrm-kanban-value-select"
                        >
                            <option value="">{__('Sólo cantidad')}</option>
                            {valueCandidates.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {sprintf(settings.valueMetric === 'avg' ? __('Promedio de %s') : __('Suma de %s'), f.label)}
                                </option>
                            ))}
                        </Select>
                    </label>
                    {canEditView && (
                        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} data-testid="imcrm-kanban-configure">
                            <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Configurar tablero')}
                        </Button>
                    )}
                </div>
            </div>

            {moveError !== null && (
                <div
                    role="alert"
                    className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive"
                    data-testid="imcrm-kanban-error"
                >
                    <span>{moveError}</span>
                    <button type="button" onClick={() => setMoveError(null)} className="imcrm-text-xs imcrm-underline">
                        {__('Cerrar')}
                    </button>
                </div>
            )}

            {bundle.isError && !bundle.data ? (
                <div role="alert" className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-text-destructive">
                    {sprintf(
                        /* translators: %s: error message */
                        __('No se pudo cargar el tablero: %s'),
                        bundle.error instanceof Error ? bundle.error.message : '',
                    )}
                </div>
            ) : loadingFirst ? (
                <div className="imcrm-flex imcrm-gap-3 imcrm-overflow-hidden">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="imcrm-h-64 imcrm-w-72 imcrm-shrink-0 imcrm-animate-pulse imcrm-rounded-xl imcrm-bg-muted/50" />
                    ))}
                </div>
            ) : board.columns.length === 0 ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-12 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('No hay registros para mostrar.')}
                </div>
            ) : (
                <div className={cn('imcrm-flex imcrm-flex-col', bundle.isFetching && bundle.isPlaceholderData && 'imcrm-opacity-70')}>
                    {/* Cabecera de columnas FIJA al scrollear (sticky nativo, fuera del scroller horizontal). */}
                    <div className="imcrm-sticky imcrm-z-20 imcrm-bg-background" style={{ top: stickyTop }}>
                        <div ref={setHeaderEl} className="imcrm-native-hscroll-hidden imcrm-overflow-x-auto" style={{ willChange: 'scroll-position' }}>
                            <div className="imcrm-grid" style={{ gridTemplateColumns: template, columnGap: GAP, width: boardWidth }}>
                                {board.columns.map((col) => (
                                    <ColumnHeader
                                        key={col.key}
                                        column={col}
                                        field={groupByField}
                                        valueField={valueField}
                                        metric={settings.valueMetric}
                                        lanesOn={lanesOn}
                                        canEditView={canEditView}
                                        onToggleCollapse={() => toggleColumnCollapsed(col.key)}
                                        onHide={() => hideColumn(col.key)}
                                        onSettings={() => setColumnSettings(col)}
                                        onAdd={
                                            onAddRecord && groupWritable
                                                ? () => onAddRecord(prefillFor(groupByField, col.key, null, null))
                                                : undefined
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <div ref={setBody} className="imcrm-native-hscroll-hidden imcrm-overflow-x-auto imcrm-pb-2" data-testid="imcrm-kanban-body">
                        {!lanesOn ? (
                            <div className="imcrm-grid imcrm-items-stretch" style={{ gridTemplateColumns: template, columnGap: GAP, width: boardWidth }}>
                                {board.columns.map((col) => {
                                    const cell = cellAt(board, null, col.key);
                                    return (
                                        <ColumnBody
                                            key={col.key}
                                            column={col}
                                            standalone
                                            isTarget={dropTarget === cell.key}
                                            dragHandlers={dragHandlers(cell)}
                                            onExpand={() => toggleColumnCollapsed(col.key)}
                                        >
                                            {renderCards(cell, col)}
                                            {(cell.records?.length ?? 0) === 0 && !cell.hasMore && <EmptyHint dragging={drag !== null} />}
                                            {addButton(col, null)}
                                        </ColumnBody>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" style={{ width: boardWidth }}>
                                {board.lanes!.map((lane) => (
                                    <section key={lane.key} data-testid="imcrm-kanban-lane" data-lane={lane.key}>
                                        <LaneHeader
                                            lane={lane}
                                            field={laneField!}
                                            valueField={valueField}
                                            onToggle={() => toggleLane(lane.key)}
                                        />
                                        {!lane.collapsed && (
                                            <div className="imcrm-grid imcrm-items-stretch" style={{ gridTemplateColumns: template, columnGap: GAP }}>
                                                {board.columns.map((col) => {
                                                    const cell = cellAt(board, lane.key, col.key);
                                                    return (
                                                        <ColumnBody
                                                            key={col.key}
                                                            column={col}
                                                            standalone={false}
                                                            isTarget={dropTarget === cell.key}
                                                            dragHandlers={dragHandlers(cell)}
                                                            onExpand={() => toggleColumnCollapsed(col.key)}
                                                            cellTotal={valueField && cell.count > 0 ? cell : null}
                                                            valueField={valueField}
                                                        >
                                                            {renderCards(cell, col)}
                                                            {(cell.records?.length ?? 0) === 0 && !cell.hasMore && <EmptyHint dragging={drag !== null} small />}
                                                            {addButton(col, lane.key)}
                                                        </ColumnBody>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>
                    <StickyHScrollbar targetRef={bodyRef} group={group} retargetKey={board.columns.length} />
                </div>
            )}

            <KanbanMoveDialog
                listId={listId}
                pending={pending}
                saving={pendingSaving}
                error={pendingError}
                onCancel={() => setPending(null)}
                onConfirm={(values) => void onConfirmPending(values)}
            />

            {columnSettings && (
                <KanbanColumnSettingsDialog
                    open
                    onOpenChange={(open) => !open && setColumnSettings(null)}
                    columnLabel={columnSettings.label}
                    fields={fields}
                    excludeFieldIds={[groupByField.id, laneField?.id ?? 0]}
                    wip={columnSettings.wip}
                    required={columnSettings.requiredFieldIds}
                    onSave={({ wip, required }) => {
                        const wipLimits = { ...settings.wipLimits };
                        if (wip === null) delete wipLimits[columnSettings.key];
                        else wipLimits[columnSettings.key] = wip;
                        const moveRules = { ...settings.moveRules };
                        if (required.length === 0) delete moveRules[columnSettings.key];
                        else moveRules[columnSettings.key] = required;
                        saveSettings({ ...settings, wipLimits, moveRules });
                    }}
                />
            )}

            {settingsOpen && (
                <EditKanbanViewDialog listId={listId} view={view} open={settingsOpen} onOpenChange={setSettingsOpen} />
            )}
        </div>
    );
}

// ─── Piezas ───────────────────────────────────────────────────────────

function columnTint(color: string | undefined): { solid?: string; tint?: string } {
    const solid = colorVar(color as OptionColor | undefined);
    return { solid, tint: solid !== undefined ? `color-mix(in srgb, ${solid} 8%, hsl(var(--imcrm-card)))` : undefined };
}

/** Etiqueta de un grupo: chip con el color de la opción, persona con avatar, o chip neutro. */
function GroupLabel({ field, raw, label, color }: { field: FieldEntity; raw: string | null; label: string; color?: string }): JSX.Element {
    if (field.type === 'user' && raw !== null) {
        return (
            <span className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5">
                <Avatar name={label} size="sm" className="imcrm-h-5 imcrm-w-5 imcrm-text-[9px]" />
                <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-semibold imcrm-text-foreground">{label}</span>
            </span>
        );
    }
    return (
        <span
            className={cn(
                'imcrm-truncate imcrm-rounded imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wider',
                color === undefined && 'imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border',
            )}
            style={chipSoftStyle(color as OptionColor | undefined)}
        >
            {label}
        </span>
    );
}

interface ColumnHeaderProps {
    column: BoardColumn;
    field: FieldEntity;
    valueField: FieldEntity | null;
    metric: 'sum' | 'avg';
    lanesOn: boolean;
    canEditView: boolean;
    onToggleCollapse: () => void;
    onHide: () => void;
    onSettings: () => void;
    onAdd?: () => void;
}

function ColumnHeader({ column, field, valueField, metric, lanesOn, canEditView, onToggleCollapse, onHide, onSettings, onAdd }: ColumnHeaderProps): JSX.Element {
    // Sin carriles la cabecera y el cuerpo forman UN recuadro; con carriles,
    // la cabecera es su propia tarjeta (las celdas van debajo, por carril).
    const shape = lanesOn ? 'imcrm-rounded-xl imcrm-border' : 'imcrm-rounded-t-xl imcrm-border imcrm-border-b-0';
    const { solid, tint } = columnTint(column.color);
    const over = column.wip !== null && column.count > column.wip;
    const atLimit = column.wip !== null && column.count === column.wip;
    if (column.collapsed) {
        return (
            <button
                type="button"
                onClick={onToggleCollapse}
                title={sprintf(__('Desplegar «%s»'), column.label)}
                className={cn(
                    'imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-py-2 imcrm-text-[11px] imcrm-font-semibold imcrm-tabular-nums',
                    shape,
                    over ? 'imcrm-border-destructive/70 imcrm-text-destructive' : 'imcrm-border-border/60 imcrm-text-muted-foreground',
                    tint === undefined && 'imcrm-bg-muted/40',
                )}
                style={tint ? { backgroundColor: tint, borderTopColor: solid, borderTopWidth: 3 } : undefined}
                data-testid="imcrm-kanban-column-header"
                data-column={column.key}
                data-collapsed="true"
            >
                <ChevronsLeftRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {column.count}
            </button>
        );
    }
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-0.5 imcrm-px-3 imcrm-pb-1.5 imcrm-pt-2',
                shape,
                over ? 'imcrm-border-destructive/70' : 'imcrm-border-border/60',
                tint === undefined && 'imcrm-bg-muted/30',
            )}
            style={tint ? { backgroundColor: tint, borderTopColor: over ? undefined : solid, borderTopWidth: 3 } : undefined}
            data-testid="imcrm-kanban-column-header"
            data-column={column.key}
            data-over-wip={over ? 'true' : undefined}
        >
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                    <GroupLabel field={field} raw={column.raw} label={column.label} color={column.color} />
                    <span
                        className={cn(
                            'imcrm-shrink-0 imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-tabular-nums',
                            over
                                ? 'imcrm-bg-destructive imcrm-text-destructive-foreground'
                                : atLimit
                                    ? 'imcrm-bg-warning/20 imcrm-text-foreground'
                                    : 'imcrm-bg-card imcrm-text-muted-foreground imcrm-shadow-imcrm-sm',
                        )}
                        title={column.wip !== null ? sprintf(__('Límite: %d tarjetas'), column.wip) : undefined}
                        data-testid="imcrm-kanban-column-count"
                    >
                        {column.wip !== null ? `${column.count}/${column.wip}` : column.count}
                    </span>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={sprintf(__('Opciones de la columna «%s»'), column.label)}
                            className="imcrm--mr-1 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-foreground/[0.06] hover:imcrm-text-foreground"
                            data-testid="imcrm-kanban-column-menu"
                        >
                            <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {onAdd && (
                            <DropdownMenuItem onSelect={onAdd}>
                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Agregar tarjeta')}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={onToggleCollapse}>
                            <ChevronsLeftRight className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Plegar columna')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onHide}>
                            <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Ocultar columna')}
                        </DropdownMenuItem>
                        {canEditView && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={onSettings} data-testid="imcrm-kanban-column-settings-item">
                                    <Gauge className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Límite y campos a pedir…')}
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {valueField && (
                <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground" data-testid="imcrm-kanban-column-total">
                    {column.total !== null ? formatKanbanValue(valueField, column.total) : '—'}
                    <span className="imcrm-ml-1 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {metric === 'avg' ? __('prom.') : __('total')}
                    </span>
                </span>
            )}
            {over && (
                <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-destructive" data-testid="imcrm-kanban-wip-warning">
                    {sprintf(__('Supera el límite de %d'), column.wip!)}
                </span>
            )}
        </div>
    );
}

interface ColumnBodyProps {
    column: BoardColumn;
    /** Sin carriles: el cuerpo continúa la cabecera (mismo recuadro). */
    standalone: boolean;
    isTarget: boolean;
    dragHandlers: Pick<React.HTMLAttributes<HTMLDivElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
    onExpand: () => void;
    cellTotal?: BoardCell | null;
    valueField?: FieldEntity | null;
    children: React.ReactNode;
}

function ColumnBody({ column, standalone, isTarget, dragHandlers, onExpand, cellTotal, valueField, children }: ColumnBodyProps): JSX.Element {
    const { tint } = columnTint(column.color);
    const over = column.wip !== null && column.count > column.wip;
    if (column.collapsed) {
        return (
            <div
                {...dragHandlers}
                onClick={onExpand}
                className={cn(
                    'imcrm-flex imcrm-min-h-[80px] imcrm-cursor-pointer imcrm-items-start imcrm-justify-center imcrm-border imcrm-py-3',
                    standalone ? 'imcrm-rounded-b-xl imcrm-border-t-0' : 'imcrm-rounded-lg',
                    isTarget ? 'imcrm-border-primary/60 imcrm-ring-2 imcrm-ring-primary/20' : over ? 'imcrm-border-destructive/70' : 'imcrm-border-border/60',
                    tint === undefined && 'imcrm-bg-muted/30',
                )}
                style={tint ? { backgroundColor: tint } : undefined}
                data-testid="imcrm-kanban-cell"
                data-column={column.key}
            >
                {standalone && (
                    <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground [writing-mode:vertical-rl]">{column.label}</span>
                )}
            </div>
        );
    }
    return (
        <div
            {...dragHandlers}
            className={cn(
                'imcrm-flex imcrm-min-h-[96px] imcrm-flex-col imcrm-gap-2 imcrm-border imcrm-p-2 imcrm-transition-[border-color,box-shadow] imcrm-duration-150',
                standalone ? 'imcrm-rounded-b-xl imcrm-border-t-0' : 'imcrm-rounded-lg',
                isTarget ? 'imcrm-border-primary/60 imcrm-ring-2 imcrm-ring-primary/20' : over ? 'imcrm-border-destructive/70' : 'imcrm-border-border/60',
                tint === undefined && 'imcrm-bg-muted/30',
            )}
            style={tint ? { backgroundColor: tint } : undefined}
            data-testid="imcrm-kanban-cell"
            data-column={column.key}
        >
            {cellTotal && valueField && cellTotal.total !== null && (
                <span className="imcrm-px-0.5 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground" data-testid="imcrm-kanban-cell-total">
                    {sprintf(__('%1$d · %2$s'), cellTotal.count, formatKanbanValue(valueField, cellTotal.total))}
                </span>
            )}
            {children}
        </div>
    );
}

function LaneHeader({ lane, field, valueField, onToggle }: { lane: BoardLane; field: FieldEntity; valueField: FieldEntity | null; onToggle: () => void }): JSX.Element {
    return (
        <div className="imcrm-sticky imcrm-left-0 imcrm-z-[1] imcrm-flex imcrm-w-max imcrm-max-w-[min(100%,90vw)] imcrm-items-center imcrm-gap-2 imcrm-py-2">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!lane.collapsed}
                aria-label={lane.collapsed ? sprintf(__('Desplegar el carril «%s»'), lane.label) : sprintf(__('Plegar el carril «%s»'), lane.label)}
                className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-foreground/[0.06] hover:imcrm-text-foreground"
                data-testid="imcrm-kanban-lane-toggle"
            >
                {lane.collapsed ? <ChevronRight className="imcrm-h-4 imcrm-w-4" /> : <ChevronDown className="imcrm-h-4 imcrm-w-4" />}
            </button>
            <GroupLabel field={field} raw={lane.raw} label={lane.label} color={lane.color} />
            <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-tabular-nums imcrm-text-muted-foreground" data-testid="imcrm-kanban-lane-count">
                {lane.count}
            </span>
            {valueField && lane.total !== null && (
                <span className="imcrm-text-xs imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground" data-testid="imcrm-kanban-lane-total">
                    {formatKanbanValue(valueField, lane.total)}
                </span>
            )}
        </div>
    );
}

function EmptyHint({ dragging, small = false }: { dragging: boolean; small?: boolean }): JSX.Element {
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border-2 imcrm-border-dashed imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground/70',
                dragging ? 'imcrm-border-primary/40' : 'imcrm-border-border/50',
                small ? 'imcrm-py-3' : 'imcrm-py-8',
            )}
        >
            {__('Arrastra una tarjeta aquí')}
        </div>
    );
}

function findRecord(board: ReturnType<typeof buildBoard>, id: number): RecordEntity | undefined {
    for (const cell of board.cells.values()) {
        const hit = cell.records?.find((r) => r.id === id);
        if (hit) return hit;
    }
    return undefined;
}

function attachmentId(value: unknown): number | null {
    if (value == null || value === '' || value === 0) return null;
    if (typeof value === 'number') return value > 0 ? value : null;
    if (typeof value === 'string') {
        const n = parseInt(value, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (Array.isArray(value) && value.length > 0) return attachmentId(value[0]);
    return null;
}

function pickTitleField(fields: FieldEntity[], excludeId: number): FieldEntity | undefined {
    const primary = fields.find((f) => f.is_primary);
    if (primary) return primary;
    return fields.find((f) => f.id !== excludeId && (f.type === 'text' || f.type === 'email'));
}

function pickMetaFields(fields: FieldEntity[], exclude: number[]): FieldEntity[] {
    return fields
        .filter((f) => !exclude.includes(f.id) && f.type !== 'long_text' && f.type !== 'file' && f.type !== 'relation' && f.type !== 'button')
        .slice(0, 3);
}

