import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, Gauge, Loader2, Settings2, UserX } from 'lucide-react';
import {
    addDaysYmd,
    reassignWorkloadItem,
    workloadBuckets,
    workloadLevel,
    workloadShiftWindow,
    workloadWeekStart,
    workloadWindow,
    zonedToday,
    WORKLOAD_UNASSIGNED,
    type WorkloadBucket,
    type WorkloadBundle,
    type WorkloadItem,
    type WorkloadMetric,
    type WorkloadPerson,
    type WorkloadSettings,
    type WorkloadZoom,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { useWorkloadBundle, workloadBundleParams, workloadKeys, type WorkloadBundleArgs } from '@/hooks/useWorkload';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan, useCanAny } from '@/lib/permissions';
import { browserTimeZone, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';
import type { SavedViewConfig, SavedViewEntity } from '@/types/view';

import { useBatchUpdateRecords } from '../../grid/useBatchUpdate';
import { storeAccessFor, useStoreRules } from '../../storeRules';
import { viewConfigToWorkload, workloadToViewConfig } from '../savedViewMapping';
import { WorkloadCapacityDialog } from './WorkloadCapacityDialog';
import { WorkloadPanel } from './WorkloadPanel';
import { WorkloadSettingsDialog, WORKLOAD_METRIC_LABEL, WORKLOAD_ZOOM_LABEL } from './WorkloadSettingsDialog';
import {
    bucketHas,
    bucketLabel,
    cellState,
    formatUsage,
    formatWorkloadValue,
    initials,
    isWeekendYmd,
    LEVEL_CLASSES,
    LEVEL_LABEL,
    rangeLabel,
    shortDate,
    usagePercent,
} from './workloadModel';

interface WorkloadViewProps {
    listId: number;
    fields: FieldEntity[];
    view: SavedViewEntity;
    filterTree: FilterTree;
    search: string;
    onOpenRecord: (id: number) => void;
    /** Si los cambios de la vista (métrica, zoom) se guardan en la vista. */
    canEditView: boolean;
    settingsOpen?: boolean;
    onSettingsOpenChange?: (open: boolean) => void;
    /** Total, si está cargando y el orden de los registros (anterior/siguiente del modal). */
    onStatusChange?: (s: { total: number | null; fetching: boolean; ids: number[] }) => void;
}

interface Selection {
    personKey: string;
    /** `null` = todo el período visible (los registros de la fila). */
    bucketKey: string | null;
}

interface UndoEntry {
    item: WorkloadItem;
    /** Fila a la que vuelve y valor del campo que tenía. */
    backKey: string;
    title: string;
}

const COLUMN_MIN: Record<WorkloadZoom, number> = { day: 52, week: 92, month: 104 };
const PERSON_COL = 248;

/**
 * B2 — Vista «Carga de trabajo»: una fila por persona (el equipo que ve la
 * lista, más «Sin asignar») y una columna por día, semana o mes, con lo que
 * cada persona tiene en cada período frente a su capacidad — en verde si
 * tiene espacio, ámbar cerca del límite y rojo pasada. Mide cantidad de
 * registros, esfuerzo estimado (repartido en días hábiles) o tiempo
 * registrado; todo lo calcula el servidor en UNA request (`workload-bundle`).
 *
 * Un clic en una celda abre sus registros; se reasignan ARRASTRÁNDOLOS a la
 * fila de otra persona (o con «Reasignar a…»), optimista con «Deshacer» y
 * Ctrl/⌘+Z, sin pisar un cambio ajeno (`expect`). En el teléfono es una lista
 * por persona con su uso de la semana.
 */
export function WorkloadView({
    listId,
    fields,
    view,
    filterTree,
    search,
    onOpenRecord,
    canEditView,
    settingsOpen: settingsOpenProp,
    onSettingsOpenChange,
    onStatusChange,
}: WorkloadViewProps): JSX.Element {
    const toast = useToast();
    const qc = useQueryClient();
    const updateView = useUpdateSavedView(listId);
    const batch = useBatchUpdateRecords(listId);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const canEditCapacity = useCan(CAP.EDIT_RECORDS);
    const storeRules = useStoreRules();
    const narrow = useMediaQuery('(max-width: 639px)');
    const touch = useMediaQuery('(hover: none) and (pointer: coarse)');
    const tz = getTenantTimeZone() ?? browserTimeZone() ?? 'UTC';
    const today = useMemo(() => zonedToday(tz), [tz]);

    // ── Config de la vista (override local optimista, como el Gantt) ──
    const [localConfig, setLocalConfig] = useState<SavedViewConfig | null>(null);
    const pendingSaves = useRef(0);
    useEffect(() => {
        if (pendingSaves.current === 0) setLocalConfig(null);
    }, [view.config]);
    const config = localConfig ?? view.config;
    const settings = useMemo(() => viewConfigToWorkload(config), [config]);
    const saveSettings = useEventCallback((next: WorkloadSettings): void => {
        const nextConfig = workloadToViewConfig(config, next);
        setLocalConfig(nextConfig);
        // Sin permiso, el ajuste vale sólo en esta pantalla.
        if (!canEditView) return;
        pendingSaves.current += 1;
        updateView.mutate(
            { id: view.id, config: nextConfig },
            {
                onError: (err) => {
                    toast.error(__('No se pudo guardar el ajuste de la carga'), err instanceof Error ? err.message : undefined);
                    setLocalConfig(null);
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

    const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const personField = settings.personFieldId !== null ? fieldById.get(settings.personFieldId) ?? null : null;
    const estimateReady = settings.estimateFieldId !== null && fieldById.has(settings.estimateFieldId);
    const metric: WorkloadMetric = settings.metric === 'estimate' && !estimateReady ? 'count' : settings.metric;
    const configured =
        personField !== null && personField.type === 'user' && (metric === 'time' || settings.startFieldId !== null || settings.endFieldId !== null);

    // ── Ventana de tiempo ──
    const [anchor, setAnchor] = useState(today);
    const zoom: WorkloadZoom = narrow ? 'week' : settings.zoom;
    const range = useMemo(() => {
        if (narrow) {
            const from = workloadWeekStart(anchor);
            return { from, to: addDaysYmd(from, 6) };
        }
        return workloadWindow(anchor, zoom);
    }, [anchor, zoom, narrow]);
    const shift = (dir: -1 | 1): void => {
        if (narrow) setAnchor((a) => addDaysYmd(workloadWeekStart(a), dir * 7));
        else setAnchor(workloadShiftWindow(range.from, zoom, dir).from);
    };
    const buckets = useMemo(() => workloadBuckets(range.from, range.to, zoom), [range.from, range.to, zoom]);

    // ── Datos ──
    const args: WorkloadBundleArgs = {
        listId,
        from: range.from,
        to: range.to,
        zoom,
        metric,
        personFieldId: configured ? settings.personFieldId : null,
        startFieldId: settings.startFieldId,
        endFieldId: settings.endFieldId,
        estimateFieldId: metric === 'estimate' ? settings.estimateFieldId : null,
        estimateUnit: settings.estimateUnit,
        hideDone: settings.hideDone,
        userIds: settings.userIds,
        showUnassigned: settings.showUnassigned,
        filterTree: filterTree.children.length > 0 ? filterTree : undefined,
        search,
    };
    const query = useWorkloadBundle(args);
    const bundleKey = workloadKeys.bundle(listId, workloadBundleParams(args));
    const bundle = query.data;
    const fetching = query.isFetching;

    // Estado hacia la página (anterior/siguiente del modal: por fecha).
    const orderedIds = useMemo(() => {
        const items = [...(bundle?.items ?? [])].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.id - b.id);
        return [...new Set(items.map((i) => i.id))];
    }, [bundle?.items]);
    const statusKey = `${fetching}|${bundle?.meta.total_records ?? ''}|${orderedIds.join(',')}`;
    useEffect(() => {
        onStatusChange?.({ total: bundle?.meta.total_records ?? null, fetching, ids: orderedIds });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusKey]);

    // ── Reasignar (optimista + deshacer) ──
    const storeAccess = personField ? storeAccessFor(storeRules, personField, null) : null;
    const storeReason = storeAccess?.access === 'locked' ? storeAccess.reason : null;
    const lockReason = (item: WorkloadItem): string | null => {
        if (metric === 'time') return __('En «Tiempo registrado» la fila es de quien cargó el tiempo: no se reasigna desde aquí.');
        if (!canEdit || !item.editable) return __('No puedes editar este registro.');
        return storeReason;
    };
    const targets = useMemo(() => (bundle?.people ?? []).filter((p) => p.member || p.key === WORKLOAD_UNASSIGNED), [bundle?.people]);
    const dragEnabled = !touch && !narrow && canEdit && storeReason === null && metric !== 'time';
    const undoStack = useRef<UndoEntry[]>([]);

    const reassign = useEventCallback(async (item: WorkloadItem, toKey: string, opts: { undo?: UndoEntry } = {}): Promise<void> => {
        if (!personField || !bundle || item.person === toKey) return;
        const target = bundle.people.find((p) => p.key === toKey);
        if (!target) return;
        const toValue = target.user_id;
        const fromValue = item.person_value;
        const fromKey = item.person;
        const title = item.title ?? sprintf(__('Registro #%d'), item.id);
        await qc.cancelQueries({ queryKey: bundleKey });
        const prev = qc.getQueryData<WorkloadBundle>(bundleKey);
        if (prev) qc.setQueryData(bundleKey, reassignWorkloadItem(prev, item.id, toKey, toValue));
        const rollback = (): void => {
            if (prev) qc.setQueryData(bundleKey, prev);
        };
        batch.mutate(
            {
                cells: [{ recordId: item.id, field: personField, value: toValue }],
                expect: [{ recordId: item.id, field: personField, value: fromValue }],
            },
            {
                onSuccess: (out) => {
                    const failed = out.failed[0] ?? out.cell_errors[0];
                    if (failed) {
                        rollback();
                        const changed = 'code' in failed && failed.code === 'record_changed';
                        toast.error(
                            changed ? __('No se reasignó: alguien cambió el registro mientras tanto.') : __('No se pudo reasignar'),
                            changed ? undefined : failed.message,
                        );
                        return;
                    }
                    if (opts.undo) {
                        undoStack.current = undoStack.current.filter((e) => e !== opts.undo);
                        toast.success(sprintf(__('Se deshizo la reasignación de «%s»'), title));
                        return;
                    }
                    const entry: UndoEntry = { item: { ...item, person: toKey, person_value: toValue }, backKey: fromKey, title };
                    undoStack.current = [...undoStack.current.slice(-19), entry];
                    toast.show({
                        title: sprintf(__('«%1$s» → %2$s'), title, target.name),
                        variant: 'success',
                        duration: 7000,
                        action: { label: __('Deshacer'), onClick: () => undo(entry) },
                    });
                },
                onError: (err) => {
                    rollback();
                    toast.error(__('No se pudo reasignar'), err.message);
                },
            },
        );
    });
    const undo = useEventCallback((entry: UndoEntry): void => {
        // El registro como está AHORA en la carga (si sigue a la vista).
        const now = (qc.getQueryData<WorkloadBundle>(bundleKey)?.items ?? []).find((i) => i.id === entry.item.id) ?? entry.item;
        void reassign(now, entry.backKey, { undo: entry });
    });
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
            const t = e.target as HTMLElement | null;
            if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
            if (document.querySelector('[role="dialog"]')) return;
            const last = undoStack.current[undoStack.current.length - 1];
            if (!last) return;
            e.preventDefault();
            undo(last);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo]);

    // ── Arrastre ──
    const [dragItem, setDragItem] = useState<WorkloadItem | null>(null);
    const [dropKey, setDropKey] = useState<string | null>(null);
    const startDrag = (item: WorkloadItem, e: React.DragEvent): void => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(item.id));
        setDragItem(item);
    };
    const endDrag = (): void => {
        setDragItem(null);
        setDropKey(null);
    };
    const canDropOn = (person: WorkloadPerson): boolean =>
        dragItem !== null && dragItem.person !== person.key && (person.member || person.key === WORKLOAD_UNASSIGNED);
    const rowDropProps = (person: WorkloadPerson) => ({
        onDragOver: (e: React.DragEvent) => {
            if (!canDropOn(person)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropKey !== person.key) setDropKey(person.key);
        },
        onDragLeave: (e: React.DragEvent) => {
            const next = e.relatedTarget as Node | null;
            if (!next || !(e.currentTarget as HTMLElement).contains(next)) setDropKey((k) => (k === person.key ? null : k));
        },
        onDrop: (e: React.DragEvent) => {
            if (!canDropOn(person) || !dragItem) return;
            e.preventDefault();
            const item = dragItem;
            endDrag();
            void reassign(item, person.key);
        },
    });

    // ── Panel / capacidad ──
    const [selection, setSelection] = useState<Selection | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [capacityFor, setCapacityFor] = useState<WorkloadPerson | null>(null);
    useEffect(() => {
        setSelection(null);
    }, [range.from, range.to, zoom, metric]);

    const people = useMemo(() => bundle?.people ?? [], [bundle?.people]);
    const personByKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
    const itemsOf = (key: string, bucketKey: string | null): WorkloadItem[] =>
        (bundle?.items ?? [])
            .filter((i) => i.person === key && (bucketKey === null || i.load[bucketKey] !== undefined))
            .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.id - b.id);

    const selectedPerson = selection ? personByKey.get(selection.personKey) ?? null : null;
    const selectedBucket = selection?.bucketKey ? buckets.find((b) => b.key === selection.bucketKey) ?? null : null;
    const panel = selectedPerson && bundle ? renderPanel(selectedPerson, selectedBucket) : null;

    function periodLabel(bucket: WorkloadBucket | null): string {
        if (!bucket) return rangeLabel(range.from, range.to);
        if (zoom === 'day') return shortDate(bucket.start);
        return bucket.start === bucket.end ? shortDate(bucket.start) : `${shortDate(bucket.start)} – ${shortDate(bucket.end)}`;
    }

    function personUsage(person: WorkloadPerson): { value: number; capacity: number; level: ReturnType<typeof workloadLevel> } {
        const t = bundle?.totals[person.key] ?? { value: 0, capacity: 0, records: 0 };
        if (person.key === WORKLOAD_UNASSIGNED) return { value: t.value, capacity: 0, level: t.value > 0 ? 'ok' : 'empty' };
        return { value: t.value, capacity: t.capacity, level: workloadLevel(t.value, t.capacity) };
    }

    function renderPanel(person: WorkloadPerson, bucket: WorkloadBucket | null): JSX.Element {
        const items = itemsOf(person.key, bucket?.key ?? null);
        const usage = bucket && bundle ? cellState(bundle, person, bucket, WORKLOAD_UNASSIGNED) : personUsage(person);
        const totals = bundle?.totals[person.key];
        const missing = bucket
            ? metric === 'count'
                ? Math.max(0, Math.round(usage.value) - items.length)
                : 0
            : Math.max(0, (totals?.records ?? 0) - items.length);
        return (
            <WorkloadPanel
                person={person}
                bucket={bucket}
                periodLabel={periodLabel(bucket)}
                metric={metric}
                usage={usage}
                items={items}
                missing={missing}
                targets={targets}
                lockReason={lockReason}
                dragEnabled={dragEnabled}
                onReassign={(item, toKey) => void reassign(item, toKey)}
                onOpenRecord={onOpenRecord}
                onDragStart={startDrag}
                onDragEnd={endDrag}
                onClose={() => setSelection(null)}
                // En el teléfono el panel lateral pone su X (36 px de objetivo
                // táctil) en esta esquina: se le reserva el lugar.
                closeControl={narrow ? <span className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0" aria-hidden /> : undefined}
                className="imcrm-h-full"
            />
        );
    }

    // ── Render ──
    const settingsDialog = (
        <WorkloadSettingsDialog listId={listId} view={view} fields={fields} open={settingsOpen} onOpenChange={setSettingsOpen} />
    );
    const capacityDialog = (
        <WorkloadCapacityDialog
            person={capacityFor && capacityFor.user_id !== null ? { ...capacityFor, user_id: capacityFor.user_id } : null}
            onOpenChange={(open) => {
                if (!open) setCapacityFor(null);
            }}
            onSaved={() => toast.success(sprintf(__('Se guardó la capacidad de %s'), capacityFor?.name ?? ''))}
        />
    );

    if (!configured) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-8 imcrm-text-center" data-testid="workload-unconfigured">
                <Gauge className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" aria-hidden />
                <p className="imcrm-max-w-md imcrm-text-sm imcrm-text-muted-foreground">
                    {fields.some((f) => f.type === 'user')
                        ? __('Elige el campo Persona y las fechas de los registros para ver cuánto trabajo tiene cada persona.')
                        : __('La carga de trabajo necesita un campo Persona (a quién está asignado cada registro). Créalo y vuelve aquí.')}
                </p>
                {canEditView && (
                    <Button onClick={() => setSettingsOpen(true)} className="imcrm-gap-2">
                        <Settings2 className="imcrm-h-4 imcrm-w-4" />
                        {__('Configurar carga')}
                    </Button>
                )}
                {settingsDialog}
            </div>
        );
    }

    const toolbar = (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2" data-testid="workload-toolbar">
            <Segmented
                label={__('Qué se mide')}
                value={metric}
                options={(['count', 'estimate', 'time'] as WorkloadMetric[]).map((m) => ({
                    value: m,
                    label: WORKLOAD_METRIC_LABEL[m],
                    disabled: m === 'estimate' && !estimateReady,
                    title: m === 'estimate' && !estimateReady ? __('Elige el campo de estimación en «Configurar carga».') : undefined,
                }))}
                onChange={(m) => saveSettings({ ...settings, metric: m, hideDone: settings.metric === m ? settings.hideDone : m !== 'time' })}
                testId="workload-metric"
            />
            {!narrow && (
                <Segmented
                    label={__('Zoom')}
                    value={zoom}
                    options={(['day', 'week', 'month'] as WorkloadZoom[]).map((z) => ({ value: z, label: WORKLOAD_ZOOM_LABEL[z] }))}
                    onChange={(z) => saveSettings({ ...settings, zoom: z })}
                    testId="workload-zoom"
                />
            )}
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Button variant="outline" size="icon" className="imcrm-h-8 imcrm-w-8" onClick={() => shift(-1)} aria-label={__('Anterior')} data-testid="workload-prev">
                    <ChevronLeft className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button variant="outline" size="sm" className="imcrm-h-8" onClick={() => setAnchor(today)} data-testid="workload-today">
                    {__('Hoy')}
                </Button>
                <Button variant="outline" size="icon" className="imcrm-h-8 imcrm-w-8" onClick={() => shift(1)} aria-label={__('Siguiente')} data-testid="workload-next">
                    <ChevronRight className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <span className="imcrm-ml-1 imcrm-text-sm imcrm-font-medium" data-testid="workload-range">
                    {narrow ? sprintf(__('Semana del %s'), shortDate(range.from)) : rangeLabel(range.from, range.to)}
                </span>
                {fetching && <Loader2 className="imcrm-ml-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Cargando…')} />}
            </div>
            <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2">
                {canEditView && (
                    <Button variant="ghost" size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => setSettingsOpen(true)} data-testid="workload-configure">
                        <Settings2 className="imcrm-h-4 imcrm-w-4" />
                        <span className="imcrm-hidden sm:imcrm-inline">{__('Configurar carga')}</span>
                    </Button>
                )}
            </div>
        </div>
    );

    const team = bundle?.team;
    const teamLevel = team ? workloadLevel(team.value, team.capacity) : 'empty';
    const summary = team ? (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-4 imcrm-gap-y-1 imcrm-text-sm" data-testid="workload-team">
            <span>
                <span className="imcrm-text-muted-foreground">{__('Equipo')}: </span>
                <span className={cn('imcrm-font-semibold', LEVEL_CLASSES[teamLevel].text)} data-testid="workload-team-usage">
                    {formatUsage(team.value, team.capacity, metric)}
                </span>
                {team.capacity > 0 && <span className="imcrm-text-muted-foreground"> · {usagePercent(team.value, team.capacity)} %</span>}
            </span>
            {team.unassigned > 0 && (
                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-muted-foreground" data-testid="workload-team-unassigned">
                    <UserX className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {sprintf(__('Sin asignar: %s'), formatWorkloadValue(team.unassigned, metric))}
                </span>
            )}
            <Legend />
            {bundle?.meta.truncated && (
                <span className="imcrm-text-xs imcrm-text-warning">{__('Hay más registros de los que se pueden sumar de una vez: acota la vista con filtros.')}</span>
            )}
            {bundle?.meta.done_reason === 'hidden' && settings.hideDone && (
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('El estado está oculto para tu rol: los terminados también cuentan.')}</span>
            )}
        </div>
    ) : null;

    if (query.isError && !bundle) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                {toolbar}
                <p className="imcrm-text-sm imcrm-text-destructive">{(query.error as Error).message}</p>
                {settingsDialog}
            </div>
        );
    }

    // ── Teléfono: una lista por persona con su uso de la semana ──
    if (narrow) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="workload-mobile">
                {toolbar}
                {summary}
                {!bundle ? (
                    <Loading />
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        {people.map((p) => {
                            const usage = personUsage(p);
                            const pct = usage.capacity > 0 ? Math.min(100, (usage.value / usage.capacity) * 100) : usage.value > 0 ? 100 : 0;
                            return (
                                <li key={p.key}>
                                    <button
                                        type="button"
                                        className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5 imcrm-text-left"
                                        onClick={() => setSelection({ personKey: p.key, bucketKey: null })}
                                        data-testid={`workload-mobile-${p.key}`}
                                    >
                                        <Avatar person={p} />
                                        <span className="imcrm-min-w-0 imcrm-flex-1">
                                            <span className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                                <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{p.name}</span>
                                                <span className={cn('imcrm-shrink-0 imcrm-text-xs imcrm-font-semibold', LEVEL_CLASSES[usage.level].text)}>
                                                    {p.key === WORKLOAD_UNASSIGNED
                                                        ? formatWorkloadValue(usage.value, metric)
                                                        : formatUsage(usage.value, usage.capacity, metric)}
                                                </span>
                                            </span>
                                            {p.key !== WORKLOAD_UNASSIGNED && (
                                                <span className="imcrm-mt-1.5 imcrm-block imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                                    <span className={cn('imcrm-block imcrm-h-full imcrm-rounded-full', LEVEL_CLASSES[usage.level].bar || 'imcrm-bg-transparent')} style={{ width: `${pct}%` }} />
                                                </span>
                                            )}
                                            <span className="imcrm-mt-1 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                                {usage.level === 'empty' ? LEVEL_LABEL.empty : sprintf(__('%d registro(s)'), bundle.totals[p.key]?.records ?? 0)}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <Sheet open={panel !== null} onOpenChange={(open) => !open && setSelection(null)}>
                    <SheetContent className="imcrm-w-full imcrm-max-w-full imcrm-p-0" aria-describedby={undefined}>
                        <SheetTitle className="imcrm-sr-only">{selectedPerson?.name ?? ''}</SheetTitle>
                        {panel}
                    </SheetContent>
                </Sheet>
                {settingsDialog}
            </div>
        );
    }

    // ── Escritorio: grilla persona × columna ──
    const colMin = COLUMN_MIN[zoom];
    const minWidth = PERSON_COL + buckets.length * colMin;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="workload-view">
            {toolbar}
            {summary}
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" role="grid" aria-label={__('Carga de trabajo')}>
                    {!bundle ? (
                        <Loading />
                    ) : (
                        <div style={{ minWidth }}>
                            {/* Encabezado de columnas */}
                            <div className="imcrm-flex imcrm-border-b imcrm-border-border imcrm-bg-muted/40" role="row">
                                <div
                                    className="imcrm-sticky imcrm-left-0 imcrm-z-10 imcrm-flex imcrm-shrink-0 imcrm-items-end imcrm-border-r imcrm-border-border imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-font-semibold imcrm-text-muted-foreground"
                                    style={{ width: PERSON_COL }}
                                    role="columnheader"
                                >
                                    {__('Persona')}
                                </div>
                                {buckets.map((b) => {
                                    const label = bucketLabel(b, zoom);
                                    const isToday = bucketHas(b, today);
                                    const weekend = zoom === 'day' && isWeekendYmd(b.start);
                                    return (
                                        <div
                                            key={b.key}
                                            role="columnheader"
                                            className={cn(
                                                'imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-items-center imcrm-justify-end imcrm-px-1 imcrm-py-1.5 imcrm-text-center',
                                                weekend && 'imcrm-bg-muted',
                                            )}
                                            style={{ minWidth: colMin }}
                                            data-testid={`workload-col-${b.key}`}
                                            data-today={isToday ? 'true' : undefined}
                                        >
                                            <span className={cn('imcrm-text-[10px] imcrm-uppercase imcrm-tracking-wide', isToday ? 'imcrm-font-semibold imcrm-text-primary' : 'imcrm-text-muted-foreground')}>
                                                {isToday && zoom !== 'day' ? __('Hoy') : label.top}
                                            </span>
                                            <span
                                                className={cn(
                                                    'imcrm-mt-0.5 imcrm-text-xs imcrm-font-semibold',
                                                    isToday && zoom === 'day' && 'imcrm-flex imcrm-h-5 imcrm-min-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-px-1 imcrm-text-primary-foreground',
                                                    isToday && zoom !== 'day' && 'imcrm-text-primary',
                                                )}
                                            >
                                                {label.bottom}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Filas */}
                            {people.map((p) => {
                                const usage = personUsage(p);
                                const open = expanded.has(p.key);
                                const rowItems = open ? itemsOf(p.key, null) : [];
                                const unscheduled = bundle.unscheduled[p.key] ?? 0;
                                const isDrop = dropKey === p.key;
                                return (
                                    <div key={p.key} className="imcrm-border-b imcrm-border-border last:imcrm-border-b-0" {...rowDropProps(p)} data-testid={`workload-row-${p.key}`}>
                                        <div className={cn('imcrm-flex', isDrop && 'imcrm-bg-primary/10 imcrm-outline imcrm-outline-2 imcrm-outline-primary/60')} role="row">
                                            <div
                                                className="imcrm-sticky imcrm-left-0 imcrm-z-10 imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-r imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1.5"
                                                style={{ width: PERSON_COL }}
                                                role="rowheader"
                                            >
                                                <button
                                                    type="button"
                                                    className="imcrm-flex imcrm-h-6 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent"
                                                    onClick={() =>
                                                        setExpanded((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(p.key)) next.delete(p.key);
                                                            else next.add(p.key);
                                                            return next;
                                                        })
                                                    }
                                                    aria-expanded={open}
                                                    aria-label={open ? __('Ocultar registros') : __('Ver registros')}
                                                    data-testid={`workload-expand-${p.key}`}
                                                >
                                                    {open ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                                                </button>
                                                <Avatar person={p} />
                                                <div className="imcrm-min-w-0 imcrm-flex-1">
                                                    <button
                                                        type="button"
                                                        className="imcrm-block imcrm-w-full imcrm-truncate imcrm-text-left imcrm-text-sm imcrm-font-medium hover:imcrm-underline"
                                                        onClick={() => setSelection({ personKey: p.key, bucketKey: null })}
                                                        title={p.email ?? undefined}
                                                    >
                                                        {p.name}
                                                    </button>
                                                    <p
                                                        className={cn(
                                                            'imcrm-truncate imcrm-text-[11px]',
                                                            p.key === WORKLOAD_UNASSIGNED ? 'imcrm-text-muted-foreground' : LEVEL_CLASSES[usage.level].text,
                                                        )}
                                                        data-testid={`workload-total-${p.key}`}
                                                        title={[
                                                            p.key === WORKLOAD_UNASSIGNED ? formatWorkloadValue(usage.value, metric) : formatUsage(usage.value, usage.capacity, metric),
                                                            unscheduled > 0 ? sprintf(__('%d sin fecha'), unscheduled) : null,
                                                            !p.member && p.key !== WORKLOAD_UNASSIGNED ? __('sin acceso a la lista') : null,
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    >
                                                        {p.key === WORKLOAD_UNASSIGNED
                                                            ? formatWorkloadValue(usage.value, metric)
                                                            : formatUsage(usage.value, usage.capacity, metric)}
                                                        {unscheduled > 0 && (
                                                            <span className="imcrm-text-muted-foreground"> · {sprintf(__('%d sin fecha'), unscheduled)}</span>
                                                        )}
                                                        {!p.member && p.key !== WORKLOAD_UNASSIGNED && <span className="imcrm-text-muted-foreground"> · {__('sin acceso a la lista')}</span>}
                                                    </p>
                                                </div>
                                                {canEditCapacity && p.member && p.user_id !== null && (
                                                    <button
                                                        type="button"
                                                        className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                                        onClick={() => setCapacityFor(p)}
                                                        title={sprintf(__('Capacidad de %s'), p.name)}
                                                        aria-label={sprintf(__('Capacidad de %s'), p.name)}
                                                        data-testid={`workload-capacity-${p.key}`}
                                                    >
                                                        <Gauge className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                    </button>
                                                )}
                                            </div>
                                            {buckets.map((b) => {
                                                const st = cellState(bundle, p, b, WORKLOAD_UNASSIGNED);
                                                // «Sin asignar» no tiene capacidad: se ve neutro (sin verde ni barra).
                                                const neutral = p.key === WORKLOAD_UNASSIGNED;
                                                const tone = neutral
                                                    ? st.level === 'empty'
                                                        ? LEVEL_CLASSES.empty
                                                        : { cell: 'imcrm-bg-muted', bar: '', text: 'imcrm-text-foreground' }
                                                    : LEVEL_CLASSES[st.level];
                                                const weekend = zoom === 'day' && isWeekendYmd(b.start);
                                                const isToday = bucketHas(b, today);
                                                const fill = st.capacity > 0 ? Math.min(100, (st.value / st.capacity) * 100) : st.value > 0 ? 100 : 0;
                                                const selected = selection?.personKey === p.key && selection.bucketKey === b.key;
                                                return (
                                                    <div
                                                        key={b.key}
                                                        role="gridcell"
                                                        className={cn('imcrm-flex imcrm-flex-1 imcrm-p-1', weekend && 'imcrm-bg-muted/60', isToday && 'imcrm-bg-primary/5')}
                                                        style={{ minWidth: colMin }}
                                                    >
                                                        <button
                                                            type="button"
                                                            className={cn(
                                                                'imcrm-relative imcrm-flex imcrm-h-9 imcrm-w-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-md imcrm-text-xs imcrm-transition-colors',
                                                                tone.cell,
                                                                st.level === 'empty' ? 'hover:imcrm-bg-accent/60' : 'hover:imcrm-brightness-95',
                                                                selected && 'imcrm-ring-2 imcrm-ring-primary',
                                                            )}
                                                            onClick={() => setSelection({ personKey: p.key, bucketKey: b.key })}
                                                            title={cellTitle(p, b, st, metric, zoom)}
                                                            data-testid={`workload-cell-${p.key}-${b.key}`}
                                                            data-level={st.level}
                                                            data-value={st.value > 0 ? String(Math.round(st.value * 100) / 100) : undefined}
                                                        >
                                                            {st.level !== 'empty' && tone.bar !== '' && (
                                                                <span className={cn('imcrm-absolute imcrm-bottom-0 imcrm-left-0 imcrm-h-1', tone.bar)} style={{ width: `${fill}%` }} aria-hidden />
                                                            )}
                                                            {st.value > 0 && (
                                                                <span className={cn('imcrm-relative imcrm-font-semibold imcrm-leading-tight', tone.text)}>
                                                                    {formatWorkloadValue(st.value, metric)}
                                                                </span>
                                                            )}
                                                            {st.value > 0 && st.capacity > 0 && zoom !== 'day' && (
                                                                <span className="imcrm-relative imcrm-text-[10px] imcrm-leading-tight imcrm-text-muted-foreground">
                                                                    {sprintf(__('de %s'), formatWorkloadValue(st.capacity, metric))}
                                                                </span>
                                                            )}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {open && (
                                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5 imcrm-border-t imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-px-3 imcrm-py-2" style={{ paddingLeft: 40 }}>
                                                {rowItems.length === 0 ? (
                                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('No hay registros en este período.')}</span>
                                                ) : (
                                                    rowItems.map((item) => {
                                                        const reason = lockReason(item);
                                                        const draggable = dragEnabled && reason === null;
                                                        const total = Object.values(item.load).reduce((a, b) => a + b, 0);
                                                        return (
                                                            <button
                                                                key={`${item.id}:${item.person}`}
                                                                type="button"
                                                                draggable={draggable}
                                                                onDragStart={draggable ? (e) => startDrag(item, e) : undefined}
                                                                onDragEnd={endDrag}
                                                                onClick={() => onOpenRecord(item.id)}
                                                                className={cn(
                                                                    'imcrm-inline-flex imcrm-max-w-[260px] imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-py-1 imcrm-text-xs hover:imcrm-bg-accent',
                                                                    draggable && 'imcrm-cursor-grab',
                                                                    item.done && 'imcrm-opacity-70',
                                                                )}
                                                                title={reason ?? (draggable ? __('Arrastra a la fila de otra persona para reasignar') : undefined)}
                                                                data-testid={`workload-chip-${item.id}`}
                                                            >
                                                                <span className="imcrm-truncate imcrm-font-medium">{item.title ?? sprintf(__('Registro #%d'), item.id)}</span>
                                                                {metric !== 'count' && <span className="imcrm-shrink-0 imcrm-text-muted-foreground">{formatWorkloadValue(total, metric)}</span>}
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                {panel && (
                    <div className="imcrm-sticky imcrm-top-2 imcrm-w-80 imcrm-shrink-0 imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                        {panel}
                    </div>
                )}
            </div>
            {(dragEnabled || canEditCapacity) && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {dragEnabled && __('Abre una celda o una fila y arrastra un registro a la fila de otra persona para reasignarlo. Ctrl/⌘+Z deshace.')}
                    {dragEnabled && canEditCapacity && ' '}
                    {canEditCapacity && __('El medidor junto a cada persona ajusta su capacidad.')}
                </p>
            )}
            {settingsDialog}
            {capacityDialog}
        </div>
    );
}

function cellTitle(person: WorkloadPerson, bucket: WorkloadBucket, st: { value: number; capacity: number; level: ReturnType<typeof workloadLevel> }, metric: WorkloadMetric, zoom: WorkloadZoom): string {
    const when = zoom === 'day' ? shortDate(bucket.start) : `${shortDate(bucket.start)} – ${shortDate(bucket.end)}`;
    if (person.key === WORKLOAD_UNASSIGNED) return `${person.name} · ${when}: ${formatWorkloadValue(st.value, metric)}`;
    const pct = st.capacity > 0 ? ` (${usagePercent(st.value, st.capacity)} %)` : '';
    return `${person.name} · ${when}: ${formatUsage(st.value, st.capacity, metric)}${pct} — ${LEVEL_LABEL[st.level]}`;
}

function Avatar({ person }: { person: WorkloadPerson }): JSX.Element {
    if (person.key === WORKLOAD_UNASSIGNED) {
        return (
            <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-dashed imcrm-border-border imcrm-text-muted-foreground" aria-hidden>
                <UserX className="imcrm-h-3.5 imcrm-w-3.5" />
            </span>
        );
    }
    return (
        <span
            className={cn(
                'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-[11px] imcrm-font-semibold',
                person.member ? 'imcrm-bg-primary/15 imcrm-text-primary' : 'imcrm-bg-muted imcrm-text-muted-foreground',
            )}
            aria-hidden
        >
            {initials(person.name)}
        </span>
    );
}

function Legend(): JSX.Element {
    return (
        <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[11px] imcrm-text-muted-foreground" aria-label={__('Leyenda')}>
            {(['ok', 'near', 'over'] as const).map((l) => (
                <span key={l} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                    <span className={cn('imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm', LEVEL_CLASSES[l].bar)} aria-hidden />
                    {LEVEL_LABEL[l]}
                </span>
            ))}
        </span>
    );
}

function Loading(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">
            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
            {__('Calculando la carga…')}
        </div>
    );
}

interface SegmentedOption<T extends string> {
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
}

function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
    testId,
}: {
    label: string;
    value: T;
    options: Array<SegmentedOption<T>>;
    onChange: (v: T) => void;
    testId?: string;
}): JSX.Element {
    return (
        <div className="imcrm-inline-flex imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-0.5" role="radiogroup" aria-label={label} data-testid={testId}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={o.value === value}
                    disabled={o.disabled}
                    title={o.title}
                    onClick={() => o.value !== value && onChange(o.value)}
                    className={cn(
                        'imcrm-h-7 imcrm-rounded imcrm-px-2.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors disabled:imcrm-cursor-not-allowed disabled:imcrm-opacity-50',
                        o.value === value ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                    )}
                    data-testid={testId ? `${testId}-${o.value}` : undefined}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
