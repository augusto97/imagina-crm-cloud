import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileUp, Loader2, Plus, Search, Settings, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { useRecord, useRecords } from '@/hooks/useRecords';
import { useSavedViews } from '@/hooks/useSavedViews';
import { clientSideSearch } from '@/lib/clientSearch';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';
import type { SavedViewEntity } from '@/types/view';

import { BulkActionsToolbar } from './BulkActionsToolbar';
import { ExportButton } from './ExportButton';
import { FiltersPanel } from './FiltersPanel';
import { ImportDialog } from './ImportDialog';
import { Pagination } from './Pagination';
import { RecordCreateDialog } from './RecordCreateDialog';
import { RecordDetailDrawer } from './RecordDetailDrawer';
import {
    INITIAL_STATE,
    buildRecordsQuery,
    toggleSort,
    type RecordsState,
} from './recordsState';
// Vistas alternativas — importadas EAGERLY (no lazy) desde 0.57.11.
//
// Historia: 0.57.5-0.57.10 intentaron arreglar varios síntomas del
// bug "Cargando vista..." infinito al cambiar de vista. Después de
// 5 fixes parciales (paralelización, Cloudflare Rocket Loader opt-out,
// cache de promesa, prefetch agresivo, single Suspense, N+1 de
// recurrences) el bug seguía apareciendo al tercer cambio de vista
// — el frontend quedaba 100+ segundos sin tocar la red, atascado en
// algún estado del Suspense + lazy + transition concurrent.
//
// La solución radical y simple: NO usar React.lazy para estas
// vistas. Las 4 vistas suman ~30KB raw — eran un trade-off cuando
// el main bundle pesaba menos. Hoy el main ya tiene 700KB y esos
// 30KB no mueven la aguja. Importarlas eager:
//  - Cero `<Suspense>` boundaries → cero transitions implícitas →
//    cero "Transition was skipped".
//  - Cero React.lazy → cero cache interno de promesas que pueda
//    desincronizarse del cache externo.
//  - Cero prefetch necesario → cero `.preload()`.
//  - El cold load no cambia: el bundle ya descargaba los 4 chunks
//    en paralelo gracias al prefetch agresivo del 0.57.9.
import { CalendarView } from './views/CalendarView';
import { CardsView } from './views/CardsView';
import { KanbanView } from './views/KanbanView';
import { GroupedTableView } from './views/GroupedTableView';

import { ColumnsMenu } from './views/ColumnsMenu';
import { GroupSelector } from './views/GroupSelector';
import { TableView } from './views/TableView';
import { SaveViewDialog } from './views/SaveViewDialog';
import { ViewsTabs } from './views/ViewsTabs';
import {
    hasChangesVsView,
    stateToViewConfig,
    viewConfigToState,
} from './views/savedViewMapping';

export function RecordsPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const navigate = useNavigate();
    const list = useList(listSlug);
    // 0.57.6 — paralelización del cold load.
    //
    // Antes `useFields` y `useSavedViews` recibían `list.data?.id`,
    // lo que los mantenía disabled hasta que `useList` resolvía.
    // Resultado: dos round-trips secuenciales (list → fields/views)
    // antes de poder pintar nada.
    //
    // El backend acepta `id_or_slug` en /lists/{x}/fields y /views,
    // así que pasamos el slug del URL directamente. Los tres
    // fetches (list, fields, views) arrancan en el mismo tick del
    // primer render — paralelos en la red.
    //
    // Nota sobre cache: el queryKey de cada hook usa el identificador
    // que recibió. Si una pantalla anterior hidrató con id numérico
    // y esta llega con slug, son cache entries separados. No es ideal
    // pero tampoco rompe nada — solo un fetch extra la primera vez
    // que se viene por slug.
    const fields = useFields(listSlug);
    const views = useSavedViews(listSlug);

    const [state, setState] = useState<RecordsState>(INITIAL_STATE);
    const [activeViewId, setActiveViewId] = useState<number | null>(null);
    const initialViewAppliedRef = useRef<number | null>(null);
    /**
     * 0.57.41 — flag para deferir el primer fetch de records hasta que
     * la vista default haya sido aplicada (o se confirmó que no hay).
     *
     * Sin esto, el cold load disparaba DOS fetches consecutivos:
     *   1. `state=INITIAL_STATE` apenas `views.data` resolvía.
     *   2. `state=defaultViewState` un tick después, cuando el
     *      useEffect aplicaba la vista default.
     *
     * Visualmente se sentía lento porque el segundo fetch era el que
     * tenía el `per_page=500` del Kanban/Cards.
     */
    const [viewApplied, setViewApplied] = useState(false);

    // Para Kanban y Calendar traemos hasta 500 registros (el back-end
    // limita el máximo per_page; 500 cubre la mayoría de tableros y
    // calendarios mensuales sin paginar).
    // Debounce del search input: state.search es responsivo (lo que
    // se ve en el Input), pero la query al server solo se rebuilda
    // 200ms después del último keystroke. Bajo para listas grandes;
    // listas chicas saltan el server entero (ver client-side abajo).
    const debouncedSearch = useDebouncedValue(state.search, 200);

    // Estrategia de búsqueda en dos modos según el tamaño de la lista:
    //
    //  - **Lista chica** (total <= per_page; ~30-50 registros): un
    //    solo fetch sin search trae TODO. Cualquier búsqueda se
    //    resuelve in-memory en <1ms — sin round-trip al server, sin
    //    overhead de WP bootstrap (~150ms) ni network RTT (~50ms).
    //    Para listas chicas el cuello de botella era el round-trip,
    //    no la query SQL — saltarlo lo elimina.
    //
    //  - **Lista grande** (total > per_page): mantenemos la búsqueda
    //    server-side con debounce — el filtrado in-memory cargaría
    //    miles de records al browser y filtrar por LIKE en JS no
    //    aprovecha índices.
    //
    // El "baseQuery" siempre fetchea SIN search para conocer el
    // total. Si total <= per_page, el dataset completo está en
    // baseRecords y filtramos client-side. Si no, disparamos un
    // searchQuery server-side aparte (solo cuando hay search activo).
    const baseQuery = useMemo(() => {
        const base = buildRecordsQuery({ ...state, search: '' });
        if (activeViewId !== null) {
            const v = views.data?.find((x) => x.id === activeViewId);
            if (v?.type === 'kanban' || v?.type === 'calendar' || v?.type === 'cards') {
                return { ...base, per_page: 500, page: 1 };
            }
        }
        return base;
    }, [state, activeViewId, views.data]);

    // 0.57.41 — un solo fetch de records en el cold load.
    //
    // Antes esperábamos sólo a `views.data` para arrancar el fetch,
    // pero el `state` seguía siendo INITIAL_STATE hasta que el effect
    // de aplicar la vista default corría → primer fetch con
    // per_page=50, segundo fetch con per_page=500 (Kanban/Cards) o con
    // los filtros de la vista. Ahora deferimos hasta `viewApplied`:
    // cuando el primer fetch sale, el `state` ya refleja la vista
    // default — un solo round-trip.
    const baseRecords = useRecords(
        viewApplied ? listSlug : undefined,
        baseQuery,
    );

    const isSmallList = baseRecords.data
        ? baseRecords.data.meta.total <= baseRecords.data.meta.per_page
        : false;

    const hasSearch = state.search.trim() !== '';
    const useServerSearch = hasSearch && ! isSmallList;

    const serverSearchQuery = useMemo(() => {
        const base = buildRecordsQuery({ ...state, search: debouncedSearch });
        if (activeViewId !== null) {
            const v = views.data?.find((x) => x.id === activeViewId);
            if (v?.type === 'kanban' || v?.type === 'calendar' || v?.type === 'cards') {
                return { ...base, per_page: 500, page: 1 };
            }
        }
        return base;
    }, [state, debouncedSearch, activeViewId, views.data]);

    const serverSearch = useRecords(
        useServerSearch ? listSlug : undefined,
        serverSearchQuery,
    );

    // Records efectivos que ven todos los consumidores (vistas, paginación, etc.).
    const records = useMemo(() => {
        if (! hasSearch) return baseRecords;
        if (isSmallList && baseRecords.data && fields.data) {
            const filtered = clientSideSearch(baseRecords.data.data, state.search, fields.data);
            return {
                ...baseRecords,
                data: {
                    ...baseRecords.data,
                    data: filtered,
                    meta: { ...baseRecords.data.meta, total: filtered.length },
                },
            };
        }
        return serverSearch;
    }, [hasSearch, isSmallList, baseRecords, serverSearch, state.search, fields.data]);
    const [createOpen, setCreateOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    // Capability gating (Fase 7 — 1.E). El backend ya rechaza acciones
    // sin cap; aquí solo ocultamos los botones para evitar UX de
    // 403-en-click. La edición/eliminación per-record (TableView,
    // bulk actions) se gatea via prop drilling en una iteración futura
    // — por ahora dejamos esos paths abiertos y confiamos en el 403
    // del backend si un viewer intenta editar.
    const canManageList = useCan(CAP.MANAGE_LISTS);
    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS);
    const canImportRecords = useCan(CAP.IMPORT_RECORDS);
    const canExportRecords = useCan(CAP.EXPORT_RECORDS);
    const canCreateRecords = useCan(CAP.CREATE_RECORDS);
    const [saveViewOpen, setSaveViewOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [drawerRecordId, setDrawerRecordId] = useState<number | null>(null);

    // Reset al cambiar de lista.
    useEffect(() => {
        setSelectedIds([]);
        setDrawerRecordId(null);
        setActiveViewId(null);
        setState(INITIAL_STATE);
        initialViewAppliedRef.current = null;
        setViewApplied(false);
    }, [list.data?.id]);

const applyView = (view: SavedViewEntity | null): void => {
        if (view === null) {
            setActiveViewId(null);
            setState(INITIAL_STATE);
            return;
        }
        setActiveViewId(view.id);
        setState(viewConfigToState(view.config, INITIAL_STATE.perPage));
    };

    // Auto-aplicar la vista default la primera vez que llegan las vistas
    // para esta lista. Usamos un ref para evitar re-aplicarla cuando el
    // usuario decida explícitamente ir a "Todos" o cambiar de tab.
    //
    // 0.57.41 — además del ref, seteamos `viewApplied=true` para que
    // `useRecords` pueda arrancar AHORA con el `state` correcto. El
    // primer fetch sale con la config de la vista default en vez de
    // INITIAL_STATE → un solo round-trip, sin el `per_page=50 → 500`
    // que antes pegaba dos veces al backend.
    useEffect(() => {
        if (!views.data || !list.data) return;
        if (initialViewAppliedRef.current === list.data.id) return;
        initialViewAppliedRef.current = list.data.id;

        const def = views.data.find((v) => v.is_default);
        if (def) {
            applyView(def);
        }
        setViewApplied(true);
    }, [views.data, list.data?.id]);

    const setFilterTree = (filterTree: import('@/types/record').FilterTree): void => {
        setState((s) => ({ ...s, filterTree, page: 1 }));
    };

    const setSearch = (search: string): void => {
        setState((s) => ({ ...s, search, page: 1 }));
    };

    const setPage = (page: number): void => {
        setState((s) => ({ ...s, page }));
    };

    const handleSortChange = (fieldId: number, multi: boolean): void => {
        setState((s) => ({
            ...s,
            sort: toggleSort(s.sort, fieldId, multi),
            page: 1,
        }));
    };

    // En vista plana el record vive en `records.data`. En vista agrupada
    // ese flat list está vacío (cada grupo tiene su propia query) — caemos
    // a un fetch directo por id como fallback.
    const flatDrawerRecord =
        drawerRecordId !== null
            ? records.data?.data.find((r) => r.id === drawerRecordId) ?? null
            : null;
    const fallbackRecord = useRecord(
        list.data?.id,
        flatDrawerRecord === null && drawerRecordId !== null ? drawerRecordId : undefined,
    );
    const drawerRecord: RecordEntity | null =
        flatDrawerRecord ?? (fallbackRecord.data ?? null);

    const activeView = activeViewId !== null
        ? views.data?.find((v) => v.id === activeViewId) ?? null
        : null;
    const isKanban = activeView?.type === 'kanban';
    const isCalendar = activeView?.type === 'calendar';
    const isCards = activeView?.type === 'cards';
    const isAlternativeView = isKanban || isCalendar || isCards;
    const isTableGrouped = !isAlternativeView && state.groupByFieldId !== null;
    const tableGroupByField =
        isTableGrouped && fields.data
            ? fields.data.find((f) => f.id === state.groupByFieldId)
            : undefined;
    // Para vistas no-tabla, "dirty" no se compara con filters/sort.
    const isDirty = isAlternativeView
        ? false
        : activeView !== null
          ? hasChangesVsView(state, activeView.config)
          : state.filterTree.children.length > 0 || state.sort.length > 0 || state.search.trim() !== '';

    // Resolver el campo de agrupación de la vista kanban activa.
    const groupByField = useMemo(() => {
        if (!isKanban || !fields.data) return undefined;
        const id = activeView?.config.group_by_field_id;
        if (!id) return undefined;
        return fields.data.find((f) => f.id === id);
    }, [isKanban, fields.data, activeView?.config.group_by_field_id]);

    const dateField = useMemo(() => {
        if (!isCalendar || !fields.data) return undefined;
        const id = activeView?.config.date_field_id;
        if (!id) return undefined;
        return fields.data.find((f) => f.id === id);
    }, [isCalendar, fields.data, activeView?.config.date_field_id]);

    // Cards view: extraFields + coverField resueltos desde activeView.config.
    const cardsExtraFields = useMemo(() => {
        if (! isCards || ! fields.data) return [];
        const ids = activeView?.config.card_field_ids ?? [];
        const byId = new Map(fields.data.map((f) => [f.id, f]));
        return ids
            .map((id) => byId.get(id))
            .filter((f): f is FieldEntity => f !== undefined);
    }, [isCards, fields.data, activeView?.config.card_field_ids]);

    const cardsCoverField = useMemo(() => {
        if (! isCards || ! fields.data) return null;
        const id = activeView?.config.card_cover_field_id;
        if (! id) return null;
        const f = fields.data.find((x) => x.id === id);
        return f && f.type === 'file' ? f : null;
    }, [isCards, fields.data, activeView?.config.card_cover_field_id]);

    if (list.isLoading || fields.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </div>
        );
    }

    if (!list.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button variant="ghost" size="sm" onClick={() => navigate('/lists')} className="imcrm-gap-2">
                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                    {__('Volver')}
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">{__('Lista no encontrada.')}</p>
            </div>
        );
    }

    const meta = records.data?.meta;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/lists')}
                        className="imcrm-gap-2 imcrm-self-start imcrm-text-muted-foreground"
                    >
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {__('Listas')}
                    </Button>
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                        {list.data.name}
                    </h1>
                </div>
                <div className="imcrm-flex imcrm-gap-2">
                    {canManageAutomations && (
                        <Button asChild variant="outline" className="imcrm-gap-2">
                            <Link to={`/lists/${list.data.slug}/automations`}>
                                <Zap className="imcrm-h-4 imcrm-w-4" />
                                {__('Automatizaciones')}
                            </Link>
                        </Button>
                    )}
                    {canManageList && (
                        <Button asChild variant="outline" className="imcrm-gap-2">
                            <Link to={`/lists/${list.data.slug}/edit`}>
                                <Settings className="imcrm-h-4 imcrm-w-4" />
                                {__('Configurar lista')}
                            </Link>
                        </Button>
                    )}
                    {canImportRecords && (
                        <Button
                            variant="outline"
                            onClick={() => setImportOpen(true)}
                            disabled={!fields.data || fields.data.length === 0}
                            className="imcrm-gap-2"
                        >
                            <FileUp className="imcrm-h-4 imcrm-w-4" />
                            {__('Importar')}
                        </Button>
                    )}
                    {canExportRecords && (
                        <ExportButton
                            listId={list.data.id}
                            listSlug={list.data.slug}
                            filterTree={state.filterTree}
                            totalRecords={records.data?.meta.total}
                            disabled={!fields.data || fields.data.length === 0}
                        />
                    )}
                    {canCreateRecords && (
                        <Button
                            onClick={() => setCreateOpen(true)}
                            disabled={!fields.data || fields.data.length === 0}
                            className="imcrm-gap-2"
                        >
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('Nuevo registro')}
                        </Button>
                    )}
                </div>
            </header>

            {fields.data && fields.data.length === 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-8 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Esta lista aún no tiene campos. Configúralos primero para poder crear registros.')}
                    </p>
                    <Button asChild variant="outline" className="imcrm-mt-3 imcrm-gap-2">
                        <Link to={`/lists/${list.data.slug}/edit`}>
                            <Settings className="imcrm-h-4 imcrm-w-4" />
                            {__('Configurar campos')}
                        </Link>
                    </Button>
                </div>
            )}

            {fields.data && fields.data.length > 0 && (
                <>
                    <ViewsTabs
                        listId={list.data.id}
                        views={views.data ?? []}
                        activeViewId={activeViewId}
                        onSelectView={applyView}
                        isDirty={isDirty}
                        currentConfig={stateToViewConfig(state)}
                        onAskCreateView={() => setSaveViewOpen(true)}
                    />

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                        <div className="imcrm-flex imcrm-flex-1 imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                            <div className="imcrm-relative imcrm-w-72">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                <Input
                                    value={state.search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={__('Buscar…')}
                                    className="imcrm-pl-8 imcrm-pr-8"
                                />
                                {/*
                                  Spinner in-input mientras la query
                                  está en vuelo (tras el debounce).
                                  isFetching también es true en otros
                                  fetches (paginación, sort), pero
                                  visualmente todos se ven igual de
                                  reactivos — no es problema.
                                */}
                                {(records.isFetching || state.search !== debouncedSearch) && (
                                    <Loader2 className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2.5 imcrm-top-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
                                )}
                            </div>
                            <FiltersPanel
                                listId={list.data?.id}
                                fields={fields.data}
                                tree={state.filterTree}
                                onChange={setFilterTree}
                            />
                            <ColumnsMenu
                                fields={fields.data}
                                visibility={state.columnVisibility}
                                onChange={(next) =>
                                    setState((s) => ({ ...s, columnVisibility: next }))
                                }
                                columnOrder={state.columnOrder}
                                onColumnOrderChange={(next) =>
                                    setState((s) => ({ ...s, columnOrder: next }))
                                }
                            />
                            {!isAlternativeView && (
                                <GroupSelector
                                    fields={fields.data}
                                    value={state.groupByFieldId}
                                    onChange={(next) =>
                                        setState((s) => ({
                                            ...s,
                                            groupByFieldId: next,
                                            page: 1,
                                        }))
                                    }
                                />
                            )}
                        </div>
                        {records.isFetching && !records.isLoading && (
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
                        )}
                    </div>

                    {records.isLoading ? (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando registros…')}
                        </div>
                    ) : records.isError ? (
                        <p className="imcrm-text-sm imcrm-text-destructive">
                            {sprintf(
                                /* translators: %s: error message */
                                __('Error: %s'),
                                (records.error as Error).message,
                            )}
                        </p>
                    ) : (
                        // Vistas importadas eagerly desde 0.57.11 — sin
                        // <Suspense> ni React.lazy. La complejidad de
                        // transitions concurrent + chunk caching causaba
                        // que cambiar de vista quedara colgado en
                        // "Cargando vista..." infinito al tercer
                        // cambio. Eliminar la abstracción lazy elimina
                        // toda esa familia de bugs.
                        <>
                            {isKanban && groupByField ? (
                                <KanbanView
                                    listId={list.data.id}
                                    fields={fields.data}
                                    records={records.data?.data ?? []}
                                    groupByField={groupByField}
                                    onCardClick={(record) => setDrawerRecordId(record.id)}
                                    titleFieldId={activeView?.config.kanban_title_field_id ?? null}
                                    metaFieldIds={activeView?.config.kanban_meta_field_ids ?? null}
                                />
                            ) : isCalendar && dateField ? (
                                <CalendarView
                                    fields={fields.data}
                                    records={records.data?.data ?? []}
                                    dateField={dateField}
                                    onCardClick={(record) => setDrawerRecordId(record.id)}
                                />
                            ) : isCards ? (
                                <CardsView
                                    fields={fields.data}
                                    records={records.data?.data ?? []}
                                    extraFields={cardsExtraFields}
                                    coverField={cardsCoverField}
                                    size={activeView?.config.card_size ?? 'comfortable'}
                                    onCardClick={(record) => setDrawerRecordId(record.id)}
                                />
                            ) : isTableGrouped && tableGroupByField ? (
                                <GroupedTableView
                                    listId={list.data.id}
                                    listSlug={list.data.slug}
                                    fields={fields.data}
                                    groupByField={tableGroupByField}
                                    filterTree={state.filterTree}
                                    search={debouncedSearch}
                                    selectedIds={selectedIds}
                                    onSelectionChange={setSelectedIds}
                                    onRowClick={(record) => setDrawerRecordId(record.id)}
                                    columnVisibility={state.columnVisibility}
                                    columnSizing={state.columnSizing}
                                    columnOrder={state.columnOrder}
                                    collapsedGroups={state.collapsedGroups}
                                    onCollapsedGroupsChange={(next) =>
                                        setState((s) => ({ ...s, collapsedGroups: next }))
                                    }
                                    onAddColumn={() => navigate(`/lists/${list.data!.slug}/edit?focus=fields`)}
                                    onAddRecord={() => setCreateOpen(true)}
                                    footerAggregates={state.footerAggregates}
                                    onFooterAggregatesChange={(next) =>
                                        setState((s) => ({ ...s, footerAggregates: next }))
                                    }
                                />
                            ) : (
                                <TableView
                                    listId={list.data.id}
                                    listSlug={list.data.slug}
                                    fields={fields.data}
                                    records={records.data?.data ?? []}
                                    sort={state.sort}
                                    onSortChange={handleSortChange}
                                    selectedIds={selectedIds}
                                    onSelectionChange={setSelectedIds}
                                    onRowClick={(record) => setDrawerRecordId(record.id)}
                                    columnVisibility={state.columnVisibility}
                                    onColumnVisibilityChange={(next) =>
                                        setState((s) => ({ ...s, columnVisibility: next }))
                                    }
                                    columnSizing={state.columnSizing}
                                    onColumnSizingChange={(next) =>
                                        setState((s) => ({ ...s, columnSizing: next }))
                                    }
                                    columnOrder={state.columnOrder}
                                    onColumnOrderChange={(next) =>
                                        setState((s) => ({ ...s, columnOrder: next }))
                                    }
                                    filterTree={state.filterTree}
                                    onAddRecord={() => setCreateOpen(true)}
                                    onAddColumn={() => navigate(`/lists/${list.data!.slug}/edit?focus=fields`)}
                                    footerAggregates={state.footerAggregates}
                                    onFooterAggregatesChange={(next) =>
                                        setState((s) => ({ ...s, footerAggregates: next }))
                                    }
                                    totalCount={records.data?.meta.total ?? 0}
                                />
                            )}
                        </>
                    )}

                    {meta && !isAlternativeView && !isTableGrouped && (
                        <Pagination meta={meta} onPageChange={setPage} />
                    )}

                    <BulkActionsToolbar
                        listId={list.data.id}
                        selectedIds={selectedIds}
                        onClear={() => setSelectedIds([])}
                    />

                    <RecordCreateDialog
                        listId={list.data.id}
                        fields={fields.data}
                        open={createOpen}
                        onOpenChange={setCreateOpen}
                    />

                    <ImportDialog
                        listId={list.data.id}
                        listSlug={list.data.slug}
                        open={importOpen}
                        onOpenChange={setImportOpen}
                    />

                    <RecordDetailDrawer
                        listId={list.data.id}
                        listSlug={list.data.slug}
                        fields={fields.data}
                        record={drawerRecord}
                        open={drawerRecordId !== null}
                        onOpenChange={(open) => !open && setDrawerRecordId(null)}
                    />

                    <SaveViewDialog
                        listId={list.data.id}
                        config={stateToViewConfig(state)}
                        open={saveViewOpen}
                        onOpenChange={setSaveViewOpen}
                        onCreated={(view) => {
                            setActiveViewId(view.id);
                        }}
                    />
                </>
            )}
        </div>
    );
}
