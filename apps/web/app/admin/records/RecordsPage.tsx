import { Suspense, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ListFolderCrumb } from '@/admin/lists/ListFolderCrumb';
import { parseTeamGroupKey, readStoreListMarker, SCAN_SEARCH_FIELD_TYPES, type BulkStructureAction } from '@imagina-base/shared';
import {
    ArrowLeft,
    BookmarkPlus,
    ChevronDown,
    Download,
    FileUp,
    Filter,
    Loader2,
    MoreHorizontal,
    Plus,
    Search,
    Settings,
    Share2,
    ScanLine,
    SlidersHorizontal,
    Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { useRecord, useRecords } from '@/hooks/useRecords';
import { useSavedViews, useUpdateSavedView } from '@/hooks/useSavedViews';
import { useRecordTemplates } from '@/hooks/useRecordTemplates';
import { canSearchClientSide, clientSideSearch } from '@/lib/clientSearch';
import { isImageUrlField } from '@/lib/imageProxy';
import { parseMultiBucket } from '@/lib/multiBucket';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { CAP, useCan } from '@/lib/permissions';
import { useGuestAccess } from '@/hooks/useGuests';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';
import type { SavedViewEntity } from '@/types/view';

import { BulkActionsToolbar } from './BulkActionsToolbar';
import { useBulkButtons } from './buttons/ButtonFieldControl';
import { useSmsConnections } from '@/cloud/components/sms/useSmsConnections';
import { newDraft, type BulkDraft } from './bulk/bulkOpMeta';
import { StoreListBanner } from './StoreListBanner';
import { SampleDataBanner } from '@/admin/onboarding/SampleDataBanner';
import { StoreRulesContext, storeColumnKind, type StoreRules } from './storeRules';
import { ExportButton } from './ExportButton';
import { visibleExportFieldIds } from './exportFields';
import { FieldCreateDialog } from './FieldCreateDialog';
import { FieldsPanel } from './FieldsPanel';
import { FiltersPanel } from './FiltersPanel';
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
import { pickPrimaryField } from '@/lib/recordCategorize';
import { KanbanView } from './views/KanbanView';
import { GanttView } from './views/gantt/GanttView';
import { WorkloadView } from './views/workload/WorkloadView';
import { GroupedTableView } from './views/GroupedTableView';
import { useEventCallback } from '@/hooks/useEventCallback';

import { TableView } from './views/TableView';
import { SaveViewDialog } from './views/SaveViewDialog';
import { ViewSettingsSheet } from './views/ViewSettingsSheet';
import { GridHistoryProvider } from './grid/history';
import { newColorRuleId } from './grid/colorRules';
import { operatorsForType } from './operators';
import type { SubBucketRef } from './views/GroupedTableView';
import { ViewsTabs } from './views/ViewsTabs';
import { canWriteView } from './views/viewAccess';
import { MAIN_SCROLLER_ID, PageStickyTopContext, useElementHeight, useStuckSentinel } from './views/stickyTop';
import {
    hasChangesVsView,
    stateToViewConfig,
    viewConfigToState,
} from './views/savedViewMapping';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { HelpdeskManagedContext, useHelpdeskManagedIds } from '@/admin/helpdesk/managedFields';

// v0.1.256 — los diálogos que se abren a pedido viajan en su propio chunk
// (antes ~250 KB sin minificar iban en la carga inicial de la tabla). Cada
// uno tiene su propio <Suspense> local y se monta sólo abierto, así que no
// toca el cambio de vistas (ver la nota de arriba sobre lazy + vistas).
const BulkEditDialog = lazyWithReload(() => import('./bulk/BulkEditDialog').then((m) => ({ default: m.BulkEditDialog })));
const BulkHistorySheet = lazyWithReload(() => import('./bulk/BulkHistorySheet').then((m) => ({ default: m.BulkHistorySheet })));
const BulkStructureDialog = lazyWithReload(() => import('./bulk/BulkStructureDialog').then((m) => ({ default: m.BulkStructureDialog })));
const CsvUpdateDialog = lazyWithReload(() => import('./bulk/CsvUpdateDialog').then((m) => ({ default: m.CsvUpdateDialog })));
const StoreBulkDialog = lazyWithReload(() => import('./bulk/StoreBulkDialog').then((m) => ({ default: m.StoreBulkDialog })));
const ButtonBulkDialog = lazyWithReload(() => import('./buttons/ButtonBulkDialog').then((m) => ({ default: m.ButtonBulkDialog })));
const BulkSmsDialog = lazyWithReload(() => import('./bulk/BulkSmsDialog').then((m) => ({ default: m.BulkSmsDialog })));
const StoreVariationsDialog = lazyWithReload(() => import('./bulk/StoreVariationsDialog').then((m) => ({ default: m.StoreVariationsDialog })));
const ImportDialog = lazyWithReload(() => import('./ImportDialog').then((m) => ({ default: m.ImportDialog })));
const ShareDialog = lazyWithReload(() => import('./ShareDialog').then((m) => ({ default: m.ShareDialog })));
// H3 — escáner de códigos de la lista (cámara + lector): sólo se baja al abrirlo.
const ListScanDialog = lazyWithReload(() => import('@/admin/scan/ListScanDialog'));



/** Tipos que no aportan en el cuerpo de una tarjeta (texto largo, archivos, vínculos). */
const CARD_SKIP_TYPES = new Set<string>(['long_text', 'file', 'relation', 'lookup', 'computed']);
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
    // v0.1.192 — cabecera fija: centinela que avisa cuando está pegada.
    // (Callback refs con estado: el bloque se monta cuando carga la lista.)
    const [stickySentinelEl, setStickySentinelEl] = useState<HTMLDivElement | null>(null);
    const headerStuck = useStuckSentinel(stickySentinelEl);
    // v0.1.193 — la línea bajo la que se pegan las cabeceras de columnas y
    // los encabezados de grupo (sticky nativo): el alto del bloque menos el
    // padding superior del <main>, porque el bloque va con `-top-2` para
    // pegarse al borde del área de trabajo.
    const [stickyBlockEl, setStickyBlockEl] = useState<HTMLDivElement | null>(null);
    const stickyBlockHeight = useElementHeight(stickyBlockEl);
    const [mainPadTop, setMainPadTop] = useState(8);
    useEffect(() => {
        const main = document.getElementById(MAIN_SCROLLER_ID);
        if (main) setMainPadTop(parseFloat(getComputedStyle(main).paddingTop) || 0);
    }, []);
    const pageStickyTop = Math.max(0, stickyBlockHeight - mainPadTop);
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
    // v0.1.224 — en la tabla AGRUPADA las filas las trae el bundle agrupado
    // (una request con grupos + filas + agregados). El listado plano no se usa
    // ahí, pero se pedía igual —con y sin búsqueda— y encima la vista esperaba
    // a que llegara antes de montarse: cada búsqueda costaba requests de más
    // y la primera carga iba en serie.
    const activeViewType = activeViewId !== null
        ? views.data?.find((x) => x.id === activeViewId)?.type
        : undefined;
    const groupedMode = activeViewType !== 'kanban'
        && activeViewType !== 'calendar'
        && activeViewType !== 'cards'
        && activeViewType !== 'gantt'
        && activeViewType !== 'workload'
        && state.groupByFieldId !== null
        && !state.spreadsheet;
    // v0.1.286 — el calendario pide los registros de SU rango (el mes visible):
    // el listado plano no se usa ahí.
    const calendarMode = activeViewType === 'calendar'
        && Boolean(views.data?.find((x) => x.id === activeViewId)?.config.date_field_id);
    // v0.1.297 — el kanban pide su propio bundle (columnas, totales y tarjetas por
    // celda): el listado plano tampoco se usa ahí.
    const kanbanMode = activeViewType === 'kanban'
        && Boolean(views.data?.find((x) => x.id === activeViewId)?.config.group_by_field_id);
    const [kanbanStatus, setKanbanStatus] = useState<{ total: number | null; fetching: boolean; ids: number[] }>({
        total: null,
        fetching: false,
        ids: [],
    });
    // B4 — el calendario: si está cargando y el orden de sus registros (anterior/siguiente del modal).
    const [calendarStatus, setCalendarStatus] = useState<{ fetching: boolean; ids: number[] }>({ fetching: false, ids: [] });
    // B1 — el Gantt pide su propio bundle (la ventana de tiempo que se ve): el
    // listado plano no se usa ahí.
    const ganttMode = activeViewType === 'gantt';
    const [ganttStatus, setGanttStatus] = useState<{ total: number | null; fetching: boolean; ids: number[] }>({
        total: null,
        fetching: false,
        ids: [],
    });
    // B2 — la carga de trabajo pide su propio bundle (personas × períodos).
    const workloadMode = activeViewType === 'workload';
    const [workloadStatus, setWorkloadStatus] = useState<{ total: number | null; fetching: boolean; ids: number[] }>({
        total: null,
        fetching: false,
        ids: [],
    });
    const [groupedStatus, setGroupedStatus] = useState<{ total: number | null; fetching: boolean }>({
        total: null,
        fetching: false,
    });

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
        viewApplied && !groupedMode && !calendarMode && !kanbanMode && !ganttMode && !workloadMode ? listSlug : undefined,
        baseQuery,
    );

    const isSmallList = baseRecords.data
        ? baseRecords.data.meta.total <= baseRecords.data.meta.per_page
        : false;

    // v0.1.188 — la búsqueda in-memory no ve la DESCRIPCIÓN del registro (el
    // documento no viaja en el listado): si alguna fila la tiene, se busca en
    // el servidor aunque la lista sea chica.
    const clientSearchable = isSmallList && canSearchClientSide(baseRecords.data?.data ?? []);

    const hasSearch = state.search.trim() !== '';
    const useServerSearch = hasSearch && ! clientSearchable;

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
        useServerSearch && !groupedMode && !calendarMode && !kanbanMode && !ganttMode && !workloadMode ? listSlug : undefined,
        serverSearchQuery,
    );

    // Records efectivos que ven todos los consumidores (vistas, paginación, etc.).
    const records = useMemo(() => {
        if (! hasSearch) return baseRecords;
        if (clientSearchable && baseRecords.data && fields.data) {
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
    }, [hasSearch, clientSearchable, baseRecords, serverSearch, state.search, fields.data]);
    // Lo que abarca "todos los que coinciden" (acciones masivas) y el spinner
    // del buscador: en modo agrupado lo informa el bundle.
    const matchingCount = groupedMode
        ? groupedStatus.total
        : kanbanMode
          ? kanbanStatus.total
          : ganttMode
            ? ganttStatus.total
            : workloadMode
              ? workloadStatus.total
              : records.data?.meta?.total ?? null;
    const listFetching = groupedMode
        ? groupedStatus.fetching
        : kanbanMode
          ? kanbanStatus.fetching
          : calendarMode
            ? calendarStatus.fetching
            : ganttMode
              ? ganttStatus.fetching
              : workloadMode
                ? workloadStatus.fetching
                : records.isFetching;
    const [createOpen, setCreateOpen] = useState(false);
    // Prefill del diálogo de creación (modo agrupado: "+ Agregar tarea"
    // dentro del grupo "Hecho" abre el form con estado=hecho seteado).
    // Vive en state para que su identidad sea estable mientras el
    // diálogo está abierto (el efecto del diálogo depende de ella).
    const [createDefaults, setCreateDefaults] = useState<Record<string, unknown> | undefined>(undefined);
    // Padre del alta en curso: si viene, el registro nace como subtarea suya.
    const [createParentId, setCreateParentId] = useState<number | null>(null);
    // C6 — «Nuevo registro ▾ → Desde una plantilla».
    const [createTemplateId, setCreateTemplateId] = useState<number | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    // v0.1.216 — edición masiva (selección o todo lo que coincide con la vista).
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    // v0.1.217 — edición masiva EN la tienda (lista de productos de WooCommerce).
    const [storeBulkOpen, setStoreBulkOpen] = useState(false);
    // v0.1.223 — crear variaciones en lote en la tienda.
    const [variationsOpen, setVariationsOpen] = useState(false);
    // v0.1.218 — historial de ediciones masivas (con deshacer).
    const [bulkHistoryOpen, setBulkHistoryOpen] = useState(false);
    // v0.1.219 — actualizar registros existentes desde un archivo.
    const [csvUpdateOpen, setCsvUpdateOpen] = useState(false);
    // v0.1.220 — mover como subtareas / duplicar / borrar en lote, y el
    // atajo «Asignar» (la edición masiva ya apuntada al campo de persona).
    const [structure, setStructure] = useState<{ action: BulkStructureAction; matching: boolean } | null>(null);
    const [bulkEditPreset, setBulkEditPreset] = useState<{ title: string; drafts: BulkDraft[] } | null>(null);
    // El dialog de export es controlado desde aquí: lo abren tanto el
    // botón compacto del breadcrumb (desktop) como el menú "···" (mobile).
    const [exportOpen, setExportOpen] = useState(false);
    // Panel "Personalizar vista" (engranaje de la toolbar) — v0.1.127.
    const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
    // v0.1.287 — "Colorear filas según esta columna…" abre el panel justo en
    // la sección de colores, con una regla nueva sobre esa columna.
    const [viewSettingsFocus, setViewSettingsFocus] = useState<{ section: 'colors'; n: number } | null>(null);
    // Diálogo "Compartir" (v0.1.128) — enlace del equipo + página pública.
    const [shareOpen, setShareOpen] = useState(false);

    // Capability gating (Fase 7 — 1.E). El backend ya rechaza acciones
    // sin cap; aquí solo ocultamos los botones para evitar UX de
    // 403-en-click. La edición/eliminación per-record (TableView,
    // bulk actions) se gatea via prop drilling en una iteración futura
    // — por ahora dejamos esos paths abiertos y confiamos en el 403
    // del backend si un viewer intenta editar.
    const canManageList = useCan(CAP.MANAGE_LISTS);
    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS) && moduleEnabled('automations');
    // C3 — un invitado sólo crea en una lista compartida entera en «Puede
    // editar»; no comparte, no personaliza ni agrega columnas.
    const guest = useGuestAccess(list.data?.id);
    // v0.1.213 — lista sincronizada con una tienda: los registros se crean,
    // se borran y se importan en WooCommerce; las celdas siguen las reglas
    // de `store-rules` (las mismas que aplica el backend).
    const storeMarker = readStoreListMarker(list.data?.settings);
    const storeRules = useMemo<StoreRules | null>(
        () => (storeMarker && fields.data ? { marker: storeMarker, fields: fields.data } : null),
        // El marcador se re-lee en cada render: se compara por su contenido.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(storeMarker), fields.data],
    );
    // E5 — las columnas que mantiene el SLA de la mesa de ayuda (candado en la celda).
    const helpdeskManaged = useHelpdeskManagedIds(list.data?.settings);
    const canImportRecords = useCan(CAP.IMPORT_RECORDS) && !storeMarker;
    const canExportRecords = useCan(CAP.EXPORT_RECORDS);
    const canBulkEdit = useCan(CAP.BULK_ACTIONS);
    const canEditAny = useCan(CAP.EDIT_RECORDS);
    const canEditOwn = useCan(CAP.EDIT_OWN_RECORDS);
    const canSeeBulkHistory = canEditAny || canEditOwn;
    // En una lista de la tienda, actualizar desde archivo exige «Editar desde la app».
    const canCsvUpdate = useCan(CAP.IMPORT_RECORDS) && (canEditAny || canEditOwn) && (!storeMarker || storeMarker.write_back === true);
    const canStoreBulk = canBulkEdit && storeMarker?.role === 'products' && storeMarker.write_back === true;
    const canCreateRecords = useCan(CAP.CREATE_RECORDS) && !storeMarker && (!guest.isGuest || guest.list === 'edit');
    // C6 — plantillas de registro de la lista (el «▾» junto a «Nuevo registro»; no para un invitado).
    const recordTemplates = useRecordTemplates(canCreateRecords && !guest.isGuest ? list.data?.id : undefined, 'record').data ?? [];
    const canDeleteAny = useCan(CAP.DELETE_RECORDS);
    const canDeleteOwn = useCan(CAP.DELETE_OWN_RECORDS);
    // Reestructurar (mover/duplicar/borrar) no aplica a las listas de la tienda:
    // eso se hace en WooCommerce.
    const structureActions: Partial<Record<BulkStructureAction, () => void>> | undefined = storeMarker
        ? undefined
        : {
              ...(canEditAny || canEditOwn ? { move: () => setStructure({ action: 'move', matching: false }) } : {}),
              ...(canCreateRecords ? { duplicate: () => setStructure({ action: 'duplicate', matching: false }) } : {}),
              ...(canDeleteAny || canDeleteOwn ? { delete: () => setStructure({ action: 'delete', matching: false }) } : {}),
          };
    // «Asignar»: el primer campo de persona que se pueda escribir.
    const assignField =
        canEditAny || canEditOwn
            ? (fields.data ?? []).find((f) => f.type === 'user' && storeColumnKind(storeRules, f.id) !== 'store_locked') ?? null
            : null;
    const [saveViewOpen, setSaveViewOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    // Campo «Botón»: presionarlo sobre la selección (en tandas, fila por fila).
    const bulkButtons = useBulkButtons(fields.data);
    const [bulkButtonId, setBulkButtonId] = useState<number | null>(null);
    // SMS (ADR-S82): mandar a la selección (sólo con una conexión de SMS y poder editar).
    const smsConnections = useSmsConnections((canEditAny || canEditOwn) && !guest.isGuest);
    const [bulkSmsOpen, setBulkSmsOpen] = useState(false);
    // El registro abierto en el modal vive en la URL (`?record=<id>`): la
    // lista queda debajo, atrás (o el gesto de Android) cierra el modal,
    // recargar lo vuelve a abrir y el enlace se puede compartir.
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const recordParam = Number(searchParams.get('record'));
    const urlRecordId = Number.isInteger(recordParam) && recordParam > 0 ? recordParam : null;
    // El cambio de URL es una transición (react-router) y puede tardar en
    // pintarse: el modal se cierra AL INSTANTE con este estado local, así
    // nada de la ficha (ni el registro de respaldo) se sigue pidiendo — tras
    // borrarlo, eso eran 404.
    const [closingRecordId, setClosingRecordId] = useState<number | null>(null);
    useEffect(() => {
        if (closingRecordId !== null && urlRecordId !== closingRecordId) setClosingRecordId(null);
    }, [urlRecordId, closingRecordId]);
    const drawerRecordId = urlRecordId !== null && urlRecordId !== closingRecordId ? urlRecordId : null;
    const openedByUsRef = useRef(false);
    const setDrawerRecordId = useEventCallback((id: number | null): void => {
        const pushedHere = (location.state as { imcrmRecordModal?: boolean } | null)?.imcrmRecordModal === true;
        if (id === null) {
            if (drawerRecordId === null) return;
            setClosingRecordId(drawerRecordId);
            // Lo abrimos nosotros con un paso en el historial: cerrar = atrás
            // (así el botón atrás después no vuelve a abrirlo).
            if (pushedHere && openedByUsRef.current) {
                openedByUsRef.current = false;
                navigate(-1);
                return;
            }
            const next = new URLSearchParams(searchParams);
            next.delete('record');
            setSearchParams(next, { replace: true });
            return;
        }
        if (id === drawerRecordId) return;
        setClosingRecordId(null);
        const next = new URLSearchParams(searchParams);
        next.set('record', String(id));
        if (drawerRecordId === null) {
            openedByUsRef.current = true;
            setSearchParams(next, { state: { imcrmRecordModal: true } });
        } else {
            // Otro registro dentro del modal (anterior/siguiente, subtarea):
            // reemplaza, no apila un paso por cada uno.
            setSearchParams(next, { replace: true, state: location.state });
        }
    });

    // Modal de campos (v0.1.74): crear una columna nueva o editar una
    // existente SIN salir de la tabla. `editingField === null` = modo
    // creación (catálogo de tipos); con field = modo edición.
    const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<FieldEntity | null>(null);
    // v0.1.160 — el ALTA pasó al panel lateral (catálogo con vista previa,
    // estilo ClickUp); el modal queda para EDITAR un campo existente.
    const [fieldsPanelOpen, setFieldsPanelOpen] = useState(false);

    const openFieldCreate = (): void => {
        setEditingField(null);
        setFieldsPanelOpen(true);
    };
    const openFieldEdit = (field: FieldEntity): void => {
        setEditingField(field);
        setFieldDialogOpen(true);
    };

    // v0.1.224 — callbacks de IDENTIDAD ESTABLE para la tabla agrupada (que va
    // memoizada): con funciones inline cada letra del buscador re-dibujaba
    // todas las filas de todos los grupos.
    type GroupedProps = ComponentProps<typeof GroupedTableView>;
    const onGroupedRowClick = useEventCallback((record: RecordEntity) => setDrawerRecordId(record.id));
    const onGroupedColumnVisibility = useEventCallback((next: GroupedProps['columnVisibility']) =>
        setState((s) => ({ ...s, columnVisibility: next })),
    );
    const onGroupedColumnSizing = useEventCallback((next: NonNullable<GroupedProps['columnSizing']>) =>
        setState((s) => ({ ...s, columnSizing: next })),
    );
    const onGroupedCollapsed = useEventCallback((next: string[]) =>
        setState((s) => ({ ...s, collapsedGroups: next })),
    );
    const onGroupedFooterAggregates = useEventCallback((next: Record<string, string>) =>
        setState((s) => ({ ...s, footerAggregates: next })),
    );
    const onGroupedAddColumn = useEventCallback(openFieldCreate);
    const onGroupedEditField = useEventCallback(openFieldEdit);
    const onGroupedAddRecord = useEventCallback((groupField: FieldEntity, bucketValue: string | null, sub?: SubBucketRef) => {
        // Prefill: crear desde el grupo "Hecho" → el form abre con estado=hecho.
        // v0.1.287 — desde un subgrupo, con los DOS valores.
        const first = prefillForGroup(groupField, bucketValue);
        const second = sub ? prefillForGroup(sub.field, sub.value) : undefined;
        setCreateDefaults(first || second ? { ...(first ?? {}), ...(second ?? {}) } : undefined);
        setCreateOpen(true);
    });
    // v0.1.297 — kanban: crear una tarjeta dentro de una columna (y carril).
    const onKanbanAddRecord = useEventCallback((prefill: Record<string, unknown>) => {
        setCreateDefaults(Object.keys(prefill).length > 0 ? prefill : undefined);
        setCreateParentId(null);
        setCreateOpen(true);
    });
    const [kanbanSettingsOpen, setKanbanSettingsOpen] = useState(false);
    // H3 — escáner de códigos de la lista (barra).
    const [scanOpen, setScanOpen] = useState(false);
    const hasScannableField = useMemo(
        () => (fields.data ?? []).some((f) => (SCAN_SEARCH_FIELD_TYPES as readonly string[]).includes(f.type)),
        [fields.data],
    );
    const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);
    const [ganttSettingsOpen, setGanttSettingsOpen] = useState(false);
    const [workloadSettingsOpen, setWorkloadSettingsOpen] = useState(false);
    const onFrozenColumnsChange = useEventCallback((next: number | null) =>
        setState((s) => ({ ...s, frozenColumns: next })),
    );
    const onColorColumn = useEventCallback((field: FieldEntity) => {
        const op = operatorsForType(field.type, field)[0]?.op ?? 'eq';
        setState((s) => ({
            ...s,
            colorRules: [
                ...s.colorRules,
                {
                    id: newColorRuleId(),
                    enabled: true,
                    condition: { type: 'condition', field_id: field.id, op, value: '' },
                    color: 'yellow',
                    target: 'row',
                },
            ],
        }));
        setViewSettingsFocus({ section: 'colors', n: Date.now() });
        setViewSettingsOpen(true);
    });
    const onGroupedSortChange = useEventCallback((fieldId: number, multi: boolean) => handleSortChange(fieldId, multi));
    const onGroupedSortSet = useEventCallback((fieldId: number, dir: 'asc' | 'desc') => handleSortSet(fieldId, dir));
    const onGroupedCreateSubtask = useEventCallback((record: RecordEntity) => {
        setCreateDefaults(undefined);
        setCreateParentId(record.id);
        setCreateOpen(true);
    });

    // Reset al cambiar de lista. (El modal no: vive en la URL, que cambia
    // sola al ir a otra lista — y al recargar con `?record=` tiene que
    // quedar abierto.)
    useEffect(() => {
        setSelectedIds([]);
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

        // v0.1.260 — `?view=<id>` (el vínculo copiado del menú de la pestaña o
        // un favorito) gana sobre la vista por defecto.
        const linked = Number(searchParams.get('view'));
        const target = (Number.isInteger(linked) && linked > 0 ? views.data.find((v) => v.id === linked) : undefined)
            ?? views.data.find((v) => v.is_default);
        if (target) {
            applyView(target);
        }
        setViewApplied(true);
    }, [views.data, list.data?.id]);

    // v0.1.100 — deep-link de filtro (click-through desde dashboards):
    // `?gf=<field_id>&gv=<valor>` aplica un filtro eq (gv vacío → is_null)
    // POR ENCIMA de la vista default, y limpia los params para no
    // re-aplicarse al navegar dentro de la página.
    useEffect(() => {
        if (! viewApplied || ! list.data) return;
        // v0.1.286 — `?ft=<filter_tree JSON>`: el segmento de un gráfico con
        // TODO lo que contó (filtro del widget, período, filtros del tablero
        // y el valor del segmento). Un JSON roto se ignora.
        const ftRaw = searchParams.get('ft');
        if (ftRaw !== null) {
            try {
                const parsed = JSON.parse(ftRaw) as import('@/types/record').FilterTree;
                if (parsed && parsed.type === 'group' && Array.isArray(parsed.children)) {
                    setState((s2) => ({ ...s2, filterTree: parsed, page: 1 }));
                }
            } catch {
                // parámetro inválido: se descarta
            }
            const next = new URLSearchParams(searchParams);
            next.delete('ft');
            setSearchParams(next, { replace: true });
            return;
        }
        const gf = Number(searchParams.get('gf'));
        if (! Number.isInteger(gf) || gf <= 0) return;
        const gv = searchParams.get('gv') ?? '';
        const gvsRaw = searchParams.get('gvs');
        // v0.1.103 — `gvs` (multi_select): AND de `contains` por valor —
        // un eq con el JSON crudo del set jamás matchea.
        let children: import('@/types/record').FilterTree['children'];
        if (gvsRaw !== null) {
            let vals: string[] = [];
            try {
                const parsed: unknown = JSON.parse(gvsRaw);
                if (Array.isArray(parsed)) vals = parsed.map((v) => String(v));
            } catch {
                vals = [];
            }
            if (vals.length === 0) return;
            children = vals.map((v) => ({
                type: 'condition' as const, field_id: gf, op: 'contains' as const, value: v,
            }));
        } else {
            children = [
                gv === ''
                    ? { type: 'condition' as const, field_id: gf, op: 'is_null' as const, value: null }
                    : { type: 'condition' as const, field_id: gf, op: 'eq' as const, value: gv },
            ];
        }
        setState((s2) => ({
            ...s2,
            filterTree: { type: 'group', logic: 'and', children },
            page: 1,
        }));
        const next = new URLSearchParams(searchParams);
        next.delete('gf');
        next.delete('gv');
        next.delete('gvs');
        setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewApplied, list.data?.id, searchParams]);

    // v0.1.260 — la URL refleja la vista abierta (`?view=<id>`), así copiar
    // el vínculo, recargar o volver atrás abren la misma pestaña.
    // `lastViewParamRef` es lo último que ESTA página escribió: un `?view=`
    // distinto llegó de afuera (un vínculo pegado, un favorito, atrás/adelante)
    // y se aplica aunque la lista ya esté abierta.
    const lastViewParamRef = useRef<string | null>(null);
    // v0.1.294 — una vista creada después de abrir la lista (en otra pestaña,
    // por otra persona o por la API) no está en la caché: antes de descartar
    // el `?view=` se piden las vistas UNA vez.
    const refetchedForViewRef = useRef<string | null>(null);
    useEffect(() => {
        if (!viewApplied || !views.data) return;
        const param = searchParams.get('view');
        if (param !== null && param !== lastViewParamRef.current && param !== String(activeViewId)) {
            const linked = views.data.find((v) => String(v.id) === param);
            if (linked) {
                lastViewParamRef.current = param;
                applyView(linked);
                return;
            }
            if (refetchedForViewRef.current !== param) {
                refetchedForViewRef.current = param;
                void views.refetch();
                return;
            }
        }
        const wanted = activeViewId !== null ? String(activeViewId) : null;
        lastViewParamRef.current = wanted;
        if (param === wanted) return;
        const next = new URLSearchParams(searchParams);
        if (wanted === null) next.delete('view');
        else next.set('view', wanted);
        setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewApplied, activeViewId, searchParams, views.data]);

    // v0.1.172 — deep links del menú contextual del panel: `?new=1` abre el
    // alta y `?import=1` el importador, y el param se limpia para que no se
    // re-abra al navegar dentro de la página.
    useEffect(() => {
        if (!list.data) return;
        const wantsNew = searchParams.get('new') === '1';
        const wantsImport = searchParams.get('import') === '1';
        if (!wantsNew && !wantsImport) return;
        if (wantsNew && canCreateRecords) {
            setCreateDefaults(undefined);
            setCreateParentId(null);
            setCreateOpen(true);
        }
        if (wantsImport && canImportRecords) setImportOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete('new');
        next.delete('import');
        setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.data?.id, searchParams]);

    // v0.1.286 — la selección es de lo que se VE: al cambiar el filtro, la
    // búsqueda, la vista o la agrupación se vacía. Antes sobrevivía y una
    // acción masiva («Eliminar», «Editar en lote») caía sobre registros que
    // ya no estaban en pantalla.
    const selectionScope = `${activeViewId ?? ''}|${JSON.stringify(state.filterTree)}|${debouncedSearch.trim()}|${state.groupByFieldId ?? ''}`;
    const selectionScopeRef = useRef(selectionScope);
    useEffect(() => {
        if (selectionScopeRef.current === selectionScope) return;
        selectionScopeRef.current = selectionScope;
        setSelectedIds((prev) => (prev.length === 0 ? prev : []));
    }, [selectionScope]);

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

    /** Menú de la columna: fija la dirección pedida (no cicla). */
    const handleSortSet = (fieldId: number, dir: 'asc' | 'desc'): void => {
        setState((s) => ({ ...s, sort: [{ field_id: fieldId, dir }], page: 1 }));
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
    // v0.1.299 — «Exportar» trae las columnas que la vista muestra, en su orden.
    const exportFieldIds = useMemo(
        () => visibleExportFieldIds(fields.data ?? [], state.columnVisibility, state.columnOrder),
        [fields.data, state.columnVisibility, state.columnOrder],
    );
    const isCalendar = activeView?.type === 'calendar';
    const isCards = activeView?.type === 'cards';
    const isGantt = activeView?.type === 'gantt';
    const isWorkload = activeView?.type === 'workload';
    const isAlternativeView = isKanban || isCalendar || isCards || isGantt || isWorkload;
    // v0.1.137 — el modo hoja de cálculo ignora la agrupación a propósito:
    // una hoja de Excel no tiene bloques, tiene filas numeradas.
    const isTableGrouped = !isAlternativeView
        && state.groupByFieldId !== null
        && !state.spreadsheet;
    // Anterior / siguiente del modal: el orden de la tabla plana (o de las
    // tarjetas, el kanban y el calendario, que leen la misma página). En la
    // vista agrupada cada grupo pagina aparte: ahí no hay un orden único.
    const navIds = isTableGrouped
        ? []
        : kanbanMode
          ? kanbanStatus.ids
          : calendarMode
            ? calendarStatus.ids
            : ganttMode
              ? ganttStatus.ids
              : workloadMode
                ? workloadStatus.ids
                : (records.data?.data ?? []).map((r) => r.id);
    const navIndex = drawerRecordId !== null ? navIds.indexOf(drawerRecordId) : -1;
    const drawerNav = {
        prev: navIndex > 0 ? navIds[navIndex - 1]! : null,
        next: navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1]! : null,
        go: navIndex < 0 ? undefined : (dir: -1 | 1): void => {
            const target = dir === -1 ? (navIndex > 0 ? navIds[navIndex - 1] : undefined) : navIds[navIndex + 1];
            if (target !== undefined) setDrawerRecordId(target);
        },
    };
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

    // v0.1.260 — guardado automático: si la vista lo tiene activado y la
    // persona puede escribirla (protegida = sólo autor/admin), los cambios de
    // filtros/columnas/orden se guardan solos a los ~0,8 s.
    const canManageViews = useCan(CAP.MANAGE_VIEWS);
    const autosaveView = useUpdateSavedView(list.data?.id ?? '');
    const autosaving = activeView !== null && activeView.autosave === true && canManageViews && canWriteView(activeView);
    const autosaveConfigKey = autosaving && isDirty ? JSON.stringify(stateToViewConfig(state)) : null;
    useEffect(() => {
        if (autosaveConfigKey === null || activeView === null) return;
        const id = activeView.id;
        const config = JSON.parse(autosaveConfigKey) as ReturnType<typeof stateToViewConfig>;
        const t = setTimeout(() => autosaveView.mutate({ id, config }), 800);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autosaveConfigKey]);

    // Resolver el campo de agrupación de la vista kanban activa.
    const groupByField = useMemo(() => {
        if (!isKanban || !fields.data) return undefined;
        const id = activeView?.config.group_by_field_id;
        if (!id) return undefined;
        return fields.data.find((f) => f.id === id);
    }, [isKanban, fields.data, activeView?.config.group_by_field_id]);

    // Cards view: extraFields + coverField resueltos desde activeView.config.
    const cardsExtraFields = useMemo(() => {
        if (! isCards || ! fields.data) return [];
        const ids = activeView?.config.card_field_ids ?? [];
        const byId = new Map(fields.data.map((f) => [f.id, f]));
        const picked = ids
            .map((id) => byId.get(id))
            .filter((f): f is FieldEntity => f !== undefined);
        if (picked.length > 0) return picked;
        // v0.1.252 — sin campos elegidos, la tarjeta mostraba SÓLO el título
        // (debajo de un bloque de color con iniciales). Ahora trae los
        // primeros datos útiles de la lista; la vista los puede cambiar.
        const primaryId = pickPrimaryField(fields.data)?.id;
        return fields.data
            .filter((f) => f.id !== primaryId && !CARD_SKIP_TYPES.has(f.type))
            .slice(0, 4);
    }, [isCards, fields.data, activeView?.config.card_field_ids]);

    const cardsCoverField = useMemo(() => {
        if (! isCards || ! fields.data) return null;
        const id = activeView?.config.card_cover_field_id;
        if (! id) return null;
        const f = fields.data.find((x) => x.id === id);
        // v0.1.210 — también un enlace que se muestra como imagen.
        return f && (f.type === 'file' || (f.type === 'url' && isImageUrlField(f.config))) ? f : null;
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
        // Alto NATURAL: el único scroll vertical es el de la página (el
        // <main> del shell, barra al borde derecho de la ventana) — la
        // tabla nunca scrollea verticalmente por su cuenta (pedido
        // explícito del usuario en v0.1.70; el capado tipo ClickUp de
        // v0.1.68 generaba una barra interna que no quería).
        <StoreRulesContext.Provider value={storeRules}>
        <HelpdeskManagedContext.Provider value={helpdeskManaged}>
        <PageStickyTopContext.Provider value={pageStickyTop}>
        <GridHistoryProvider listId={list.data.id}>
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-[0.3rem]">
            {/* Centinela del bloque fijo: cuando sale por arriba, el bloque
                está pegado y dibuja su línea inferior. */}
            <div ref={setStickySentinelEl} aria-hidden className="imcrm-h-px imcrm--mb-px" />
            {/*
              v0.1.192 — las TRES filas de cabecera (breadcrumb, pestañas de
              vistas y toolbar) quedan FIJAS arriba al scrollear la página,
              como en ClickUp: el atributo marca la línea bajo la que se
              pegan las cabeceras de columnas y los encabezados de grupo
              (ver stickyTop.ts). El único scroll sigue siendo el del <main>.
            */}
            <div
                ref={setStickyBlockEl}
                data-imcrm-sticky-top
                className={cn(
                    // `-top-2` = el `py-2` del <main>: el bloque se pega al
                    // BORDE del área de trabajo, no 8px más abajo (sticky
                    // respeta el padding del scroller). z por ENCIMA de los
                    // encabezados de grupo (z-30) y las cabeceras (z-20):
                    // un encabezado que se va con su sección pasa por
                    // debajo, no por encima (el reporte del usuario).
                    'imcrm-sticky imcrm--top-2 imcrm-z-[35] imcrm-flex imcrm-flex-col imcrm-gap-[0.3rem] imcrm-bg-background',
                    headerStuck && 'imcrm-shadow-[0_1px_0_hsl(var(--imcrm-border))]',
                )}
            >
            {/*
              Fila 1 — breadcrumb (patrón ClickUp): fila DELGADA (~36px)
              con "Listas / {nombre}" a 13-14px. A la derecha, las
              acciones secundarias de la lista como botones ghost h-7
              muy discretos (>= md) o un menú "···" (mobile). La acción
              primaria "+ Nuevo registro" vive en la toolbar (fila 3),
              junto a la búsqueda.
            */}
            <header className="imcrm-flex imcrm-min-h-7 imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <nav
                    aria-label={__('Ruta de navegación')}
                    className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-[13px]"
                >
                    <Link
                        to={guest.isGuest ? '/shared' : '/lists'}
                        className="imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                    >
                        {guest.isGuest ? __('Compartido conmigo') : __('Listas')}
                    </Link>
                    <span aria-hidden className="imcrm-shrink-0 imcrm-text-muted-foreground">
                        /
                    </span>
                    <ListFolderCrumb groupId={list.data.group_id} />
                    <h1 className="imcrm-truncate imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight">
                        {list.data.name}
                    </h1>
                </nav>

                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                    {/* "Compartir" lo ve cualquiera que pueda abrir la lista: el
                        enlace del equipo sirve a todos y publicar hacia afuera
                        se gatea DENTRO del diálogo. */}
                    {!guest.isGuest && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShareOpen(true)}
                            className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs imcrm-text-muted-foreground"
                            data-tour="records-share"
                        >
                            <Share2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Compartir')}
                        </Button>
                    )}

                {(canManageAutomations || canManageList || canImportRecords || canExportRecords) && (
                    <>
                        {/* Desktop: iconos + label extra discretos (h-7, 12px). */}
                        <div className="imcrm-hidden imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5 md:imcrm-flex">
                            {canManageAutomations && (
                                <Button
                                    asChild
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs imcrm-text-muted-foreground"
                                >
                                    <Link to={`/lists/${list.data.slug}/automations`} data-tour="records-automations">
                                        <Zap className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Automatizaciones')}
                                    </Link>
                                </Button>
                            )}
                            {canManageList && (
                                <Button
                                    asChild
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs imcrm-text-muted-foreground"
                                >
                                    <Link to={`/lists/${list.data.slug}/edit`} data-tour="records-settings">
                                        <Settings className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Configurar lista')}
                                    </Link>
                                </Button>
                            )}
                            {/* Importar y Exportar viven en el panel del
                                engranaje desde v0.1.127 — el breadcrumb queda
                                con lo que se abre a diario. */}
                        </div>

                        {/* Mobile: colapsa a "···". */}
                        <div className="imcrm-shrink-0 md:imcrm-hidden">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={__('Más acciones')}
                                        className="imcrm-h-7 imcrm-w-7 imcrm-rounded-md"
                                        data-tour="records-more"
                                    >
                                        <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {canManageAutomations && (
                                        <DropdownMenuItem
                                            onSelect={() => navigate(`/lists/${list.data!.slug}/automations`)}
                                        >
                                            <Zap className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Automatizaciones')}
                                        </DropdownMenuItem>
                                    )}
                                    {canManageList && (
                                        <DropdownMenuItem
                                            onSelect={() => navigate(`/lists/${list.data!.slug}/edit`)}
                                        >
                                            <Settings className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Configurar lista')}
                                        </DropdownMenuItem>
                                    )}
                                    {canImportRecords && (
                                        <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                                            <FileUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Importar')}
                                        </DropdownMenuItem>
                                    )}
                                    {canExportRecords && (
                                        <DropdownMenuItem
                                            disabled={!fields.data || fields.data.length === 0}
                                            onSelect={() => setExportOpen(true)}
                                        >
                                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Exportar')}
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </>
                )}
                </div>
            </header>

            {fields.data && fields.data.length > 0 && (
                <>
                    <ViewsTabs
                        listId={list.data.id}
                        views={views.data ?? []}
                        activeViewId={activeViewId}
                        onSelectView={applyView}
                        isDirty={isDirty && !autosaving}
                        currentConfig={stateToViewConfig(state)}
                        onAskCreateView={() => setSaveViewOpen(true)}
                        onCustomize={(v) => {
                            if (v.id !== activeViewId) applyView(v);
                            setViewSettingsOpen(true);
                        }}
                        onExport={
                            canExportRecords
                                ? (v) => {
                                      if (v.id !== activeViewId) applyView(v);
                                      setExportOpen(true);
                                  }
                                : undefined
                        }
                        onShare={() => setShareOpen(true)}
                    />

                    {/*
                      Fila 3 — toolbar compacta (~40px): a la izquierda el
                      chip de la vista/filtro guardado activo ("Todos" si
                      no hay) + los controles de Filtrar/Columnas/Agrupar
                      (sm, h-8); a la derecha la búsqueda angosta y la
                      acción primaria "+ Nuevo registro" (sm).
                    */}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-pb-1">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                            <span className="imcrm-inline-flex imcrm-h-6 imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                                <Filter aria-hidden className="imcrm-h-3 imcrm-w-3" />
                                {activeView?.name ?? __('Todos')}
                            </span>
                            <FiltersPanel
                                listId={list.data?.id}
                                fields={fields.data}
                                tree={state.filterTree}
                                onChange={setFilterTree}
                            />
                        </div>
                        {/* v0.1.252 — en el celular ocupa la fila entera: el buscador
                            se estira y «Nuevo registro» queda en ícono (antes se
                            salía de la pantalla). */}
                        <div className="imcrm-flex imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-2 sm:imcrm-w-auto">
                            {listFetching && !records.isLoading && (
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
                            )}
                            {/* Búsqueda angosta (200px) que crece al enfocar. */}
                            <div
                                className="imcrm-relative imcrm-min-w-0 imcrm-flex-1 imcrm-transition-[width] imcrm-duration-150 sm:imcrm-w-[200px] sm:imcrm-flex-none sm:focus-within:imcrm-w-[240px]"
                                data-tour="records-search"
                            >
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                <Input
                                    value={state.search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={__('Buscar…')}
                                    className="imcrm-h-8 imcrm-rounded-md imcrm-pl-8 imcrm-pr-8 imcrm-text-[13px]"
                                />
                                {/*
                                  Spinner in-input mientras la query
                                  está en vuelo (tras el debounce).
                                  isFetching también es true en otros
                                  fetches (paginación, sort), pero
                                  visualmente todos se ven igual de
                                  reactivos — no es problema.
                                */}
                                {(listFetching || state.search !== debouncedSearch) && (
                                    <Loader2 className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2.5 imcrm-top-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
                                )}
                            </div>
                            {/*
                              Engranaje "Personalizar vista" (v0.1.127,
                              patrón ClickUp): columnas, agrupación, ajustar
                              texto y las acciones de la vista y de la lista
                              viven en UN panel. v0.1.145 — sólo el icono y
                              a la DERECHA, después del buscador (pedido del
                              usuario): es un ajuste ocasional, no compite
                              con Filtrar, que sí se usa a diario.
                            */}
                            {/* H3 — escanear un código (QR o de barras) en esta lista. */}
                            {hasScannableField && !guest.isGuest && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setScanOpen(true)}
                                    className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0"
                                    aria-label={__('Escanear un código')}
                                    title={__('Escanear un código QR o de barras')}
                                    data-testid="records-scan"
                                >
                                    <ScanLine className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            )}
                            {!guest.isGuest && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setViewSettingsOpen(true)}
                                    className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0"
                                    aria-label={__('Personalizar vista')}
                                    title={__('Personalizar vista')}
                                    data-tour="records-customize"
                                >
                                    <SlidersHorizontal className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            )}
                            {canCreateRecords && (
                                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center">
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            setCreateDefaults(undefined);
                                            setCreateParentId(null);
                                            setCreateTemplateId(null);
                                            setCreateOpen(true);
                                        }}
                                        disabled={!fields.data || fields.data.length === 0}
                                        className={cn('imcrm-shrink-0 imcrm-gap-1.5', recordTemplates.length > 0 && 'imcrm-rounded-r-none')}
                                        aria-label={__('Nuevo registro')}
                                        data-tour="records-new"
                                    >
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                        <span className="imcrm-hidden sm:imcrm-inline">{__('Nuevo registro')}</span>
                                    </Button>
                                    {recordTemplates.length > 0 && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    size="sm"
                                                    className="imcrm-shrink-0 imcrm-rounded-l-none imcrm-border-l imcrm-border-primary-foreground/25 imcrm-px-1.5"
                                                    aria-label={__('Nuevo registro desde una plantilla')}
                                                    title={__('Desde una plantilla')}
                                                    data-testid="imcrm-new-from-template"
                                                >
                                                    <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            {/* Al cerrar, el foco NO vuelve al «▾»: el alta se abre en
                                                ese mismo click y el diálogo se cerraría por «foco afuera». */}
                                            <DropdownMenuContent align="end" className="imcrm-w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
                                                <DropdownMenuLabel>{__('Desde una plantilla')}</DropdownMenuLabel>
                                                {recordTemplates.map((t) => (
                                                    <DropdownMenuItem
                                                        key={t.id}
                                                        onSelect={() => {
                                                            setCreateDefaults(undefined);
                                                            setCreateParentId(null);
                                                            setCreateTemplateId(t.id);
                                                            // El alta se abre cuando el menú ya soltó el foco:
                                                            // abierto en el mismo tick, la trampa de foco del
                                                            // menú le roba el cursor al título y queda en «Cerrar»
                                                            // (un espacio al escribir el nombre cerraba el alta).
                                                            window.setTimeout(() => setCreateOpen(true), 0);
                                                        }}
                                                        data-testid="imcrm-new-from-template-item"
                                                    >
                                                        <BookmarkPlus className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                                        <span className="imcrm-truncate">{t.name}</span>
                                                    </DropdownMenuItem>
                                                ))}
                                                {canManageList && (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem asChild>
                                                            <Link to={`/lists/${list.data.slug}/edit?s=plantillas`}>{__('Administrar plantillas…')}</Link>
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
            </div>

            {storeMarker && <StoreListBanner marker={storeMarker} />}
            {/* F7 — datos de ejemplo de la bienvenida, con su botón para borrarlos. */}
            {!storeMarker && <SampleDataBanner listId={list.data?.id} />}

            {/*
              Dialog de export sin trigger propio — lo abren los botones
              del breadcrumb / menú "···" via `exportOpen`.
            */}
            {canExportRecords && (
                <ExportButton
                    listId={list.data.id}
                    listSlug={list.data.slug}
                    filterTree={state.filterTree}
                    search={debouncedSearch}
                    sort={state.sort.map((x) => `field_${x.field_id}:${x.dir}`).join(',')}
                    fieldIds={exportFieldIds}
                    viewName={activeView?.name ?? list.data.name}
                    frozenColumns={state.frozenColumns}
                    open={exportOpen}
                    onOpenChange={setExportOpen}
                    hideTrigger
                />
            )}

            {/* El ImportDialog vive FUERA de la rama "hay campos": importar un
                CSV/Excel a una lista recién creada (sin campos) es el caso
                típico — el diálogo crea los campos on-the-fly. */}
            {importOpen && (
                <Suspense fallback={null}>
                    <ImportDialog
                        listId={list.data.id}
                        listSlug={list.data.slug}
                        open={importOpen}
                        onOpenChange={setImportOpen}
                        onUpdateInstead={canCsvUpdate ? () => setCsvUpdateOpen(true) : undefined}
                    />
                </Suspense>
            )}

            {/* v0.1.253 — montado SÓLO abierto: cerrado igual pedía la
                publicación, los campos y las vistas de la lista en cada visita. */}
            {shareOpen && (
                <Suspense fallback={null}>
                    <ShareDialog
                        open={shareOpen}
                        onOpenChange={setShareOpen}
                        listId={list.data.id}
                        listName={list.data.name}
                        canPublish={canManageList}
                    />
                </Suspense>
            )}

            {scanOpen && fields.data && (
                <Suspense fallback={null}>
                    <ListScanDialog
                        open={scanOpen}
                        onOpenChange={setScanOpen}
                        list={list.data}
                        fields={fields.data}
                        canCreate={canCreateRecords}
                        canManageList={canManageList}
                        onOpenRecord={(id) => setDrawerRecordId(id)}
                        onCreate={(prefill) => {
                            setCreateDefaults(prefill);
                            setCreateParentId(null);
                            setCreateTemplateId(null);
                            // Cuando el escáner ya soltó el foco (si no, la trampa de
                            // foco del diálogo que se cierra se lleva el del alta).
                            window.setTimeout(() => setCreateOpen(true), 0);
                        }}
                    />
                </Suspense>
            )}

            {fields.data && fields.data.length > 0 && (
                <ViewSettingsSheet
                    open={viewSettingsOpen}
                    onOpenChange={setViewSettingsOpen}
                    listId={list.data.id}
                    listSlug={list.data.slug}
                    fields={fields.data}
                    activeView={activeView}
                    onSelectView={applyView}
                    filterTree={state.filterTree}
                    onFilterTreeChange={setFilterTree}
                    columnVisibility={state.columnVisibility}
                    onColumnVisibilityChange={(next) =>
                        setState((s) => ({ ...s, columnVisibility: next }))
                    }
                    columnOrder={state.columnOrder}
                    onColumnOrderChange={(next) => setState((s) => ({ ...s, columnOrder: next }))}
                    groupByFieldId={state.groupByFieldId}
                    onGroupByFieldIdChange={(next) =>
                        setState((s) => ({
                            ...s,
                            groupByFieldId: next,
                            // El segundo nivel sin el primero (o igual a él) no existe.
                            subGroupByFieldId: next === null || next === s.subGroupByFieldId ? null : s.subGroupByFieldId,
                            page: 1,
                        }))
                    }
                    subGroupByFieldId={state.subGroupByFieldId}
                    onSubGroupByFieldIdChange={(next) => setState((s) => ({ ...s, subGroupByFieldId: next }))}
                    colorRules={state.colorRules}
                    onColorRulesChange={(next) => setState((s) => ({ ...s, colorRules: next }))}
                    frozenColumns={state.frozenColumns}
                    onFrozenColumnsChange={onFrozenColumnsChange}
                    focusSection={viewSettingsFocus}
                    canGroup={!isAlternativeView}
                    viewType={isKanban ? 'kanban' : isCalendar ? 'calendar' : isCards ? 'cards' : isGantt ? 'gantt' : isWorkload ? 'workload' : 'table'}
                    wrapText={state.wrapText}
                    onWrapTextChange={(next) => setState((s) => ({ ...s, wrapText: next }))}
                    spreadsheet={state.spreadsheet}
                    onSpreadsheetChange={(next) => setState((s) => ({ ...s, spreadsheet: next }))}
                    density={state.density}
                    onDensityChange={(next) => setState((s) => ({ ...s, density: next }))}
                    fontSize={state.fontSize}
                    onFontSizeChange={(next) => setState((s) => ({ ...s, fontSize: next }))}
                    singleClickEdit={state.singleClickEdit}
                    onSingleClickEditChange={(next) => setState((s) => ({ ...s, singleClickEdit: next }))}
                    canManageList={canManageList}
                    canManageAutomations={canManageAutomations}
                    canImport={canImportRecords}
                    canExport={canExportRecords}
                    onImport={() => setImportOpen(true)}
                    onExport={() => setExportOpen(true)}
                    canBulkEdit={canBulkEdit}
                    onBulkEdit={() => {
                        setBulkEditPreset(null);
                        setBulkEditOpen(true);
                    }}
                    onDeleteMatching={
                        canBulkEdit && structureActions?.delete ? () => setStructure({ action: 'delete', matching: true }) : undefined
                    }
                    onStoreBulk={canStoreBulk ? () => setStoreBulkOpen(true) : undefined}
                    onStoreVariations={canStoreBulk ? () => setVariationsOpen(true) : undefined}
                    onBulkHistory={canSeeBulkHistory ? () => setBulkHistoryOpen(true) : undefined}
                    onCsvUpdate={canCsvUpdate ? () => setCsvUpdateOpen(true) : undefined}
                    onConfigureBoard={
                        isKanban && activeView && canManageViews && canWriteView(activeView)
                            ? () => {
                                  setViewSettingsOpen(false);
                                  setKanbanSettingsOpen(true);
                              }
                            : isGantt && activeView && canManageViews && canWriteView(activeView)
                              ? () => {
                                    setViewSettingsOpen(false);
                                    setGanttSettingsOpen(true);
                                }
                              : isWorkload && activeView && canManageViews && canWriteView(activeView)
                                ? () => {
                                      setViewSettingsOpen(false);
                                      setWorkloadSettingsOpen(true);
                                  }
                                : undefined
                    }
                    onConfigureCalendar={
                        isCalendar && activeView && canManageViews && canWriteView(activeView)
                            ? () => {
                                  setViewSettingsOpen(false);
                                  setCalendarSettingsOpen(true);
                              }
                            : undefined
                    }
                />
            )}

            {canCsvUpdate && list.data && csvUpdateOpen && (
                <Suspense fallback={null}>
                    <CsvUpdateDialog
                        open={csvUpdateOpen}
                        onOpenChange={setCsvUpdateOpen}
                        listId={list.data.id}
                        storeManaged={!!storeMarker}
                        isLocked={(id) => storeColumnKind(storeRules, id) === 'store_locked'}
                    />
                </Suspense>
            )}

            {canSeeBulkHistory && list.data && bulkHistoryOpen && (
                <Suspense fallback={null}>
                    <BulkHistorySheet open={bulkHistoryOpen} onOpenChange={setBulkHistoryOpen} listId={list.data.id} />
                </Suspense>
            )}

            {storeMarker && canStoreBulk && storeBulkOpen && (
                <Suspense fallback={null}>
                    <StoreBulkDialog
                        open={storeBulkOpen}
                        onOpenChange={setStoreBulkOpen}
                        listId={list.data.id}
                        marker={storeMarker}
                        selectedIds={selectedIds}
                        filterTree={state.filterTree}
                        search={debouncedSearch}
                        matchingCount={matchingCount}
                        onDone={() => setSelectedIds([])}
                    />
                </Suspense>
            )}

            {storeMarker && canStoreBulk && variationsOpen && (
                <Suspense fallback={null}>
                    <StoreVariationsDialog
                        open={variationsOpen}
                        onOpenChange={setVariationsOpen}
                        listId={list.data.id}
                        selectedIds={selectedIds}
                        filterTree={state.filterTree}
                        search={debouncedSearch}
                        matchingCount={matchingCount}
                        onDone={() => setSelectedIds([])}
                    />
                </Suspense>
            )}

            {fields.data && fields.data.length > 0 && bulkEditOpen && (
                <Suspense fallback={null}>
                    <BulkEditDialog
                        open={bulkEditOpen}
                        onOpenChange={setBulkEditOpen}
                        listId={list.data.id}
                        fields={fields.data}
                        selectedIds={selectedIds}
                        filterTree={state.filterTree}
                        search={debouncedSearch}
                        matchingCount={matchingCount}
                        canEditMatching={canBulkEdit}
                        isLocked={(f) => storeColumnKind(storeRules, f.id) === 'store_locked'}
                        initialDrafts={bulkEditPreset?.drafts}
                        title={bulkEditPreset?.title}
                        onDone={() => setSelectedIds([])}
                    />
                </Suspense>
            )}

            {list.data && bulkSmsOpen && smsConnections.length > 0 && selectedIds.length > 0 && (
                <Suspense fallback={null}>
                    <BulkSmsDialog
                        listId={list.data.id}
                        ids={selectedIds}
                        connections={smsConnections}
                        onClose={() => setBulkSmsOpen(false)}
                        onDone={() => setSelectedIds([])}
                    />
                </Suspense>
            )}

            {list.data && bulkButtonId !== null && fields.data?.some((f) => f.id === bulkButtonId) && (
                <Suspense fallback={null}>
                    <ButtonBulkDialog
                        listId={list.data.id}
                        field={fields.data.find((f) => f.id === bulkButtonId)!}
                        ids={selectedIds}
                        recordTitle={(id) => {
                            const primary = pickPrimaryField(fields.data ?? []);
                            const rec = records.data?.data.find((r) => r.id === id);
                            const v = primary && rec ? rec.fields[primary.slug] : null;
                            return typeof v === 'string' && v.trim() !== '' ? v : sprintf(__('Registro #%d'), id);
                        }}
                        onClose={() => setBulkButtonId(null)}
                    />
                </Suspense>
            )}

            {list.data && structure !== null && (
                <Suspense fallback={null}>
                    <BulkStructureDialog
                        action={structure?.action ?? null}
                        preferMatching={structure?.matching}
                        onClose={() => setStructure(null)}
                        listId={list.data.id}
                        selectedIds={selectedIds}
                        filterTree={state.filterTree}
                        search={debouncedSearch}
                        matchingCount={matchingCount}
                        canActMatching={canBulkEdit}
                        onDone={() => setSelectedIds([])}
                    />
                </Suspense>
            )}

            {fields.data && fields.data.length === 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-8 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Esta lista aún no tiene campos. Créalos a mano, o importa un archivo CSV/Excel y se crearán solos desde las columnas.')}
                    </p>
                    <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-center imcrm-gap-2">
                        {canImportRecords && (
                            <Button onClick={() => setImportOpen(true)} className="imcrm-gap-2">
                                <FileUp className="imcrm-h-4 imcrm-w-4" />
                                {__('Importar CSV / Excel')}
                            </Button>
                        )}
                        <Button asChild variant="outline" className="imcrm-gap-2">
                            <Link to={`/lists/${list.data.slug}/edit`}>
                                <Settings className="imcrm-h-4 imcrm-w-4" />
                                {__('Configurar campos')}
                            </Link>
                        </Button>
                    </div>
                </div>
            )}

            {fields.data && fields.data.length > 0 && (
                <>
                    {/* Hasta aplicar la vista guardada no se sabe qué vista va (en
                        modo agrupado el listado plano ni se pide): montar la
                        tabla plana un instante disparaba sus agregados de más. */}
                    {!viewApplied || records.isLoading ? (
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
                            {isWorkload && activeView ? (
                                // B2 — la carga de trabajo pide su propio bundle (`workload-bundle`).
                                <WorkloadView
                                    key={activeView.id}
                                    listId={list.data.id}
                                    fields={fields.data}
                                    view={activeView}
                                    filterTree={state.filterTree}
                                    search={debouncedSearch}
                                    onOpenRecord={setDrawerRecordId}
                                    canEditView={canManageViews && canWriteView(activeView)}
                                    settingsOpen={workloadSettingsOpen}
                                    onSettingsOpenChange={setWorkloadSettingsOpen}
                                    onStatusChange={setWorkloadStatus}
                                />
                            ) : isGantt && activeView ? (
                                <GanttView
                                    key={activeView.id}
                                    listId={list.data.id}
                                    fields={fields.data}
                                    view={activeView}
                                    filterTree={state.filterTree}
                                    search={debouncedSearch}
                                    onOpenRecord={setDrawerRecordId}
                                    canEditView={canManageViews && canWriteView(activeView)}
                                    canManageList={canManageList}
                                    settingsOpen={ganttSettingsOpen}
                                    onSettingsOpenChange={setGanttSettingsOpen}
                                    onStatusChange={setGanttStatus}
                                />
                            ) : isKanban && groupByField && activeView ? (
                                <KanbanView
                                    key={activeView.id}
                                    listId={list.data.id}
                                    fields={fields.data}
                                    view={activeView}
                                    groupByField={groupByField}
                                    onCardClick={(record) => setDrawerRecordId(record.id)}
                                    filterTree={state.filterTree}
                                    search={debouncedSearch}
                                    onAddRecord={canCreateRecords ? onKanbanAddRecord : undefined}
                                    onStatusChange={setKanbanStatus}
                                    canEditView={canManageViews && canWriteView(activeView)}
                                    settingsOpen={kanbanSettingsOpen}
                                    onSettingsOpenChange={setKanbanSettingsOpen}
                                />
                            ) : isCalendar && activeView ? (
                                // B4 — el calendario pide su propio rango (`calendar-bundle`).
                                <CalendarView
                                    key={activeView.id}
                                    listId={list.data.id}
                                    fields={fields.data}
                                    view={activeView}
                                    filterTree={state.filterTree}
                                    search={debouncedSearch}
                                    onCardClick={(record) => setDrawerRecordId(record.id)}
                                    onAddRecord={canCreateRecords ? onKanbanAddRecord : undefined}
                                    canEditView={canManageViews && canWriteView(activeView)}
                                    settingsOpen={calendarSettingsOpen}
                                    onSettingsOpenChange={setCalendarSettingsOpen}
                                    onStatusChange={setCalendarStatus}
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
                                    onRowClick={onGroupedRowClick}
                                    columnVisibility={state.columnVisibility}
                                    onColumnVisibilityChange={onGroupedColumnVisibility}
                                    columnSizing={state.columnSizing}
                                    onColumnSizingChange={onGroupedColumnSizing}
                                    columnOrder={state.columnOrder}
                                    collapsedGroups={state.collapsedGroups}
                                    onCollapsedGroupsChange={onGroupedCollapsed}
                                    onAddColumn={guest.isGuest ? undefined : onGroupedAddColumn}
                                    onEditField={canManageList ? onGroupedEditField : undefined}
                                    onAddRecord={canCreateRecords ? onGroupedAddRecord : undefined}
                                    wrapText={state.wrapText}
                                    density={state.density}
                                    fontSize={state.fontSize}
                                    singleClickEdit={state.singleClickEdit}
                                    onCreateSubtask={canCreateRecords ? onGroupedCreateSubtask : undefined}
                                    footerAggregates={state.footerAggregates}
                                    onFooterAggregatesChange={onGroupedFooterAggregates}
                                    onStatusChange={setGroupedStatus}
                                    sort={state.sort}
                                    onSortChange={onGroupedSortChange}
                                    onSortSet={onGroupedSortSet}
                                    subGroupByField={
                                        state.subGroupByFieldId !== null
                                            ? fields.data.find((f) => f.id === state.subGroupByFieldId) ?? null
                                            : null
                                    }
                                    frozenColumns={state.frozenColumns}
                                    onFrozenColumnsChange={onFrozenColumnsChange}
                                    colorRules={state.colorRules}
                                    onColorColumn={onColorColumn}
                                />
                            ) : (
                                <TableView
                                    listId={list.data.id}
                                    listSlug={list.data.slug}
                                    fields={fields.data}
                                    records={records.data?.data ?? []}
                                    sort={state.sort}
                                    onSortChange={handleSortChange}
                                    onSortSet={handleSortSet}
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
                                    search={debouncedSearch}
                                    onAddRecord={!canCreateRecords ? undefined : () => {
                                        setCreateDefaults(undefined);
                                        setCreateOpen(true);
                                    }}
                                    onAddColumn={guest.isGuest ? undefined : openFieldCreate}
                                    onEditField={canManageList ? openFieldEdit : undefined}
                                    wrapText={state.wrapText}
                                    spreadsheet={state.spreadsheet}
                                    density={state.density}
                                    fontSize={state.fontSize}
                                    singleClickEdit={state.singleClickEdit}
                                    rowNumberOffset={(state.page - 1) * state.perPage}
                                    onCreateSubtask={!canCreateRecords ? undefined : (record) => {
                                        setCreateDefaults(undefined);
                                        setCreateParentId(record.id);
                                        setCreateOpen(true);
                                    }}
                                    footerAggregates={state.footerAggregates}
                                    onFooterAggregatesChange={(next) =>
                                        setState((s) => ({ ...s, footerAggregates: next }))
                                    }
                                    totalCount={records.data?.meta.total ?? 0}
                                    frozenColumns={state.frozenColumns}
                                    onFrozenColumnsChange={onFrozenColumnsChange}
                                    colorRules={state.colorRules}
                                    onColorColumn={onColorColumn}
                                />
                            )}
                        </>
                    )}

                    {meta && !isAlternativeView && !isTableGrouped && (
                        <Pagination meta={meta} onPageChange={setPage} />
                    )}
                    {/* v0.1.187 — kanban/tarjetas/calendario traen UNA tanda
                        (máx 200): si la lista es más grande, decirlo en vez
                        de dejar que parezca que faltan registros. */}
                    {meta && isAlternativeView && !isKanban && meta.total > (records.data?.data.length ?? 0) && (
                        <p
                            className="imcrm-text-xs imcrm-text-muted-foreground"
                            data-testid="imcrm-view-partial-notice"
                        >
                            {sprintf(
                                /* translators: 1: records shown, 2: total records */
                                __('Mostrando %1$d de %2$d registros — usa filtros para acotar la vista.'),
                                records.data?.data.length ?? 0,
                                meta.total,
                            )}
                        </p>
                    )}

                    <BulkActionsToolbar
                        selectedIds={selectedIds}
                        onClear={() => setSelectedIds([])}
                        onBulkEdit={() => {
                            setBulkEditPreset(null);
                            setBulkEditOpen(true);
                        }}
                        onStoreBulk={canStoreBulk ? () => setStoreBulkOpen(true) : undefined}
                        onStoreVariations={canStoreBulk ? () => setVariationsOpen(true) : undefined}
                        onStructure={structureActions}
                        pressButtons={bulkButtons.map((b) => ({ id: b.field.id, label: b.label, reason: b.reason }))}
                        onPressButton={setBulkButtonId}
                        onSendSms={smsConnections.length > 0 ? () => setBulkSmsOpen(true) : undefined}
                        onAssign={
                            assignField
                                ? () => {
                                      setBulkEditPreset({
                                          title: sprintf(__('Asignar «%s»'), assignField.label),
                                          drafts: [{ ...newDraft(), field_id: assignField.id, op: 'set' }],
                                      });
                                      setBulkEditOpen(true);
                                  }
                                : undefined
                        }
                    />

                    <FieldCreateDialog
                        listId={list.data.id}
                        listSlug={list.data.slug}
                        field={editingField}
                        open={fieldDialogOpen}
                        onOpenChange={setFieldDialogOpen}
                    />

                    <FieldsPanel
                        listId={list.data.id}
                        listSlug={list.data.slug}
                        open={fieldsPanelOpen}
                        onOpenChange={setFieldsPanelOpen}
                    />

                    <RecordCreateDialog
                        listId={list.data.id}
                        listName={list.data.name}
                        fields={fields.data}
                        open={createOpen}
                        onOpenChange={setCreateOpen}
                        initialValues={createDefaults}
                        parentId={createParentId}
                        templateId={createTemplateId}
                    />

                    <RecordDetailDrawer
                        listId={list.data.id}
                        listSlug={list.data.slug}
                        listName={list.data.name}
                        fields={fields.data}
                        record={drawerRecord}
                        open={drawerRecordId !== null}
                        onOpenChange={(open) => !open && setDrawerRecordId(null)}
                        onNavigate={drawerNav.go}
                        canPrev={drawerNav.prev !== null}
                        canNext={drawerNav.next !== null}
                        onOpenRecord={setDrawerRecordId}
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
        </GridHistoryProvider>
        </PageStickyTopContext.Provider>
        </HelpdeskManagedContext.Provider>
        </StoreRulesContext.Provider>
    );
}

/**
 * Valores iniciales del diálogo de creación cuando el user agrega un
 * registro DESDE un grupo (modo agrupado): el campo agrupado se
 * pre-carga con el valor del bucket, así "+ Agregar tarea" dentro de
 * "Hecho" crea con estado=hecho. El bucket "(Sin valor)" no pre-carga
 * nada. El valor del bucket llega como string del server — lo
 * convertimos al tipo que espera el form según el tipo del campo.
 */
function prefillForGroup(
    field: FieldEntity,
    bucketValue: string | null,
): Record<string, unknown> | undefined {
    if (bucketValue === null) return undefined;
    switch (field.type) {
        case 'multi_select':
            // v0.1.190 — el grupo es la COMBINACIÓN de opciones (JSON del
            // set normalizado): el alta dentro del grupo nace con todas.
            return { [field.slug]: parseMultiBucket(bucketValue) ?? [bucketValue] };
        case 'checkbox':
            return { [field.slug]: bucketValue === '1' || bucketValue === 'true' };
        case 'team': {
            // C1 — el grupo es el conjunto de equipos (`[3, 7]`).
            const ids = parseTeamGroupKey(bucketValue);
            return ids.length > 0 ? { [field.slug]: ids } : undefined;
        }
        case 'number':
        case 'currency':
        case 'user':
        case 'rating':
        case 'percent':
        case 'duration': {
            const n = Number(bucketValue);
            return Number.isFinite(n) ? { [field.slug]: n } : undefined;
        }
        default:
            return { [field.slug]: bucketValue };
    }
}
