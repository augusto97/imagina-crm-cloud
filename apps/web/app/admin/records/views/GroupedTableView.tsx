import { createContext, forwardRef, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDuration, parseTeamGroupKey } from '@imagina-base/shared';
import { ChevronDown, ChevronRight, Inbox, KeyRound, Loader2, Plus } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { useAggregates, type AggregatesResponse } from '@/hooks/useAggregates';
import { useRecords, useRecordsGroupedBundle } from '@/hooks/useRecords';
import { RecurrencesBatchProvider } from '@/hooks/useRecurrences';

import { CAP, useCan, useCanAny } from '@/lib/permissions';

import { RecordRowMenu, type RowMenuTarget } from '../RecordRowMenu';
import { SubtaskFetcher } from '../SubtaskFetcher';
import { RecordNameCell } from './RecordNameCell';
import type { RowDensity, RowFontSize } from '../recordsState';
import { RecordUpdaterProvider } from '../EditableCell';
import { useWrapText, WrapTextContext } from '../wrapText';
import { RelationTitlesContext } from '../relationTitlesContext';
import { useRelationTitlesForRows } from '@/hooks/useRelationTitles';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateStr, formatDateTimeStr } from '@/lib/tenantFormat';
import { lookupDisplayField, rollupDisplayField } from '@/lib/throughFields';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type {
    FilterCondition,
    FilterOperator,
    FilterTree,
    RecordEntity,
    RecordGroupBucket,
    RecordListResponse,
    RecordsQuery,
} from '@/types/record';

import { EditableCell } from '@/admin/records/EditableCell';
import { StoreColumnBadge } from '@/admin/records/StoreColumnBadge';
import { storeAccessFor, useStoreRules, type StoreRules } from '@/admin/records/storeRules';
import { FieldHeaderMenu } from '@/admin/records/FieldHeaderMenu';
import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { orderByCatalog, parseMultiBucket } from '@/lib/multiBucket';
import { OptionChip, renderCellValue } from '@/admin/records/renderCellValue';
import { addNode } from '@/admin/records/filterTree';
import { FooterAggregateCell, footerIsAggregatable, type AggregateKind } from './FooterAggregateCell';
import { StickyHScrollbar } from './StickyHScrollbar';
import { createHScrollGroup, type HScrollGroup } from './hscrollGroup';
import { useElementHeight, usePageStickyTop, useStuckSentinel } from './stickyTop';
import { isImageUrlField } from '@/lib/imageProxy';
import { useMainVirtualRows } from './useMainVirtualRows';
import { SortIndicator } from './SortIndicator';
import type { ActiveSort } from '../recordsState';
import { FloatingAddColumn, tableMinWidth, RightEdgeFade, useOverflowsRight } from './FloatingAddColumn';
import type { ViewColorRule } from '@imagina-base/shared';
import { activeColorRules, cellTintStyle, evaluateRowColors, rowTintStyle, type RowColors } from '../grid/colorRules';
import { computeFrozen, FROZEN_EDGE_SHADOW, type FrozenLayout } from '../grid/frozen';
import type { GridColumnRef } from '../grid/gridPlan';
import { useGridController } from '../grid/useGridController';
import { CellMarkOverlay, ERROR_CELL_SHADOW } from '../grid/CellMarkOverlay';
import { GridEditContext } from '../grid/editStore';
import { GridOverlays } from '../grid/GridOverlays';
import { titleFieldOf } from '@/lib/recordTitle';
import { asDisplayField, displayTypeOf } from '@/lib/fieldTypeCatalog';
import { useWpUser } from '@/hooks/useWpUsers';
import { useTeamDirectory } from '@/hooks/useTeams';
import { TeamChips } from '@/components/fields/TeamChip';
import { useWidth } from '../grid/useWidth';
import { getTenantTimeZone } from '@/lib/tenantFormat';

/**
 * v0.1.193 — scroll horizontal SINCRONIZADO entre grupos. Antes había un
 * único scroller que envolvía todos los grupos, pero eso dejaba los
 * encabezados de grupo y las cabeceras de columnas ADENTRO de un scroll
 * container, donde `position: sticky` no puede pegarse al scroll vertical
 * de la página. Ahora cada grupo tiene su scroller (cuerpo) y su wrapper
 * de cabecera, y un `HScrollGroup` (v0.1.194, con supresión de eco — ver
 * hscrollGroup.ts) copia el `scrollLeft` de cualquiera al resto — las
 * columnas siguen alineadas entre grupos. `registerBody` además mantiene
 * al día el scroller que MIDE la barra espejo (el del primer grupo).
 */
interface HScrollSync {
    group: HScrollGroup;
    registerBody: (el: HTMLDivElement) => () => void;
}
const HScrollSyncContext = createContext<HScrollSync | null>(null);

interface GroupedTableViewProps {
    listId: number;
    /** Slug — usado para queries de aggregates por bucket. */
    listSlug?: string;
    fields: FieldEntity[];
    groupByField: FieldEntity;
    /** Árbol de filtros activos (sin contar el de agrupación). Se
     * reusa en la query de groups y en la expansión de cada bucket. */
    filterTree: FilterTree;
    search: string;
    selectedIds: number[];
    onSelectionChange: (ids: number[]) => void;
    onRowClick?: (record: RecordEntity) => void;
    /** Visibilidad por column id. `false` = oculta. Compartida con
     * `TableView` para que el ColumnsMenu funcione igual en ambos
     * modos. */
    columnVisibility: Record<string, boolean>;
    /**
     * Anchos persistidos del flat view (px). Si está vacío, usamos
     * `defaultSizeForType`. Sin esto el user perdía sus ajustes de
     * width al agrupar.
     */
    /** Setter de visibilidad — habilita "Ocultar columna" en el menú. */
    onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
    columnSizing?: Record<string, number>;
    /** Callback de resize por columna (drag del borde derecho del th).
     * Sin él, los handles no se renderizan. */
    onColumnSizingChange?: (next: Record<string, number>) => void;
    /**
     * Orden custom del flat view (column ids). Si está vacío, usamos
     * `field.position`. Sin esto el user perdía su reordenamiento al
     * agrupar.
     */
    columnOrder?: string[];
    /**
     * Set de bucket keys colapsadas (persistido en el saved view).
     * Si un bucket NO está aquí, está expandido. Por defecto array
     * vacío = todos expandidos.
     */
    collapsedGroups?: string[];
    onCollapsedGroupsChange?: (next: string[]) => void;
    /** Click "+ Agregar columna" en el header del primer bucket. */
    onAddColumn?: () => void;
    /**
     * Abre el editor del campo — habilita el menú contextual "⌄" en
     * los headers de columna de cada bucket (mismo menú que TableView).
     */
    onEditField?: (field: FieldEntity) => void;
    /**
     * Click "+ Agregar tarea" al pie de un bucket. Recibe el field
     * de agrupación y el `value` del bucket para que el caller pueda
     * pre-rellenar el form de creación.
     */
    onAddRecord?: (groupByField: FieldEntity, bucketValue: string | null, sub?: SubBucketRef) => void;
    /** Alta de subtarea desde el menú contextual de la fila (v0.1.137). */
    onCreateSubtask?: (record: RecordEntity) => void;
    /**
     * Cálculos opt-in del footer por columna (compartidos entre
     * todos los buckets, igual que ClickUp). Si está vacío o sin
     * `onFooterAggregatesChange`, no se renderea el footer.
     */
    /** v0.1.224 — total que coincide + si está cargando (para la página). */
    onStatusChange?: (status: { total: number | null; fetching: boolean }) => void;
    footerAggregates?: Record<string, string>;
    onFooterAggregatesChange?: (next: Record<string, string>) => void;
    /** "Ajustar texto" — ver `WrapTextContext`. */
    wrapText?: boolean;
    /** Densidad de las filas (v0.1.140). */
    density?: RowDensity | null;
    /** Tamaño de letra (v0.1.141). */
    fontSize?: RowFontSize | null;
    /** v0.1.295 — un click edita la celda en vez de elegirla. */
    singleClickEdit?: boolean;
    /**
     * v0.1.286 — orden de las filas DENTRO de cada grupo (el mismo de la vista
     * plana): click en la cabecera cicla, el menú fija la dirección.
     */
    sort?: ActiveSort[];
    onSortChange?: (fieldId: number, multi: boolean) => void;
    onSortSet?: (fieldId: number, dir: 'asc' | 'desc') => void;
    /**
     * v0.1.287 — Segundo nivel («Y luego por»): cada grupo se parte en
     * subgrupos por este campo, con su encabezado, su conteo y su pie.
     */
    subGroupByField?: FieldEntity | null;
    /** v0.1.287 — Columnas fijas a la izquierda (`null` = sólo la primera). */
    frozenColumns?: number | null;
    onFrozenColumnsChange?: (next: number | null) => void;
    /** v0.1.287 — Colores condicionales de filas/celdas. */
    colorRules?: ViewColorRule[];
    onColorColumn?: (field: FieldEntity) => void;
}

/** v0.1.287 — Un subgrupo dentro de su grupo (para precargar el alta con los dos valores). */
export interface SubBucketRef {
    field: FieldEntity;
    value: string | null;
}

/**
 * Tabla con grouping ClickUp/Airtable-style. Una sola llamada al
 * backend (`/records/grouped-bundle`) trae:
 *
 *   - Buckets meta (count por valor) — siempre.
 *   - Records de cada bucket EXPANDIDO — primera página.
 *   - Aggregates de cada bucket EXPANDIDO — para el footer.
 *
 * Antes (≤ 0.28) eran 1 + N + N requests (groups + 1 records por bucket
 * abierto + 1 aggregates por bucket abierto). Ahora es 1. Cuando el
 * user expande/colapsa, la query se invalida con la nueva lista de
 * `expanded` y vuelve a una sola request.
 *
 * Para "Cargar siguiente página" dentro de un bucket caemos al hook
 * clásico `useRecords` (sólo se dispara cuando page > 1, raro en la
 * práctica con per_page=50).
 *
 * Por simplicidad no usamos TanStack Table aquí (sí en `TableView`).
 */
function GroupedTableViewImpl({
    listId,
    listSlug,
    fields,
    groupByField,
    filterTree,
    search,
    selectedIds,
    onSelectionChange,
    onRowClick,
    columnVisibility,
    onColumnVisibilityChange,
    columnSizing,
    onColumnSizingChange,
    columnOrder,
    collapsedGroups,
    onCollapsedGroupsChange,
    onAddColumn,
    onEditField,
    onAddRecord,
    onCreateSubtask,
    footerAggregates,
    onFooterAggregatesChange,
    onStatusChange,
    wrapText = false,
    density = null,
    fontSize = null,
    singleClickEdit = false,
    sort = EMPTY_SORT,
    onSortChange,
    onSortSet,
    subGroupByField = null,
    frozenColumns = null,
    onFrozenColumnsChange,
    colorRules,
    onColorColumn,
}: GroupedTableViewProps): JSX.Element {
    const sortParam = sort.length > 0 ? sort.map((x) => `field_${x.field_id}:${x.dir}`).join(',') : undefined;
    const filterTreeParam = useMemo(
        () => (filterTree.children.length === 0 ? undefined : filterTree),
        [filterTree],
    );

    // `collapsedGroups` (del saved view) lista keys CERRADOS. Un bucket
    // que NO está aquí se considera abierto por default. `openLocally`
    // overridea por sesión (sin re-guardar el saved view).
    const collapsedSet = useMemo(
        () => new Set(collapsedGroups ?? []),
        [collapsedGroups],
    );
    const [openLocally, setOpenLocally] = useState<Set<string>>(new Set());
    // Target de la StickyHScrollbar: el scroller del PRIMER grupo montado
    // (el registro de sincronía lo mantiene al día; `retargetKey` avisa).
    const hScrollRef = useRef<HTMLDivElement | null>(null);
    const [retargetKey, setRetargetKey] = useState(0);
    const bodiesRef = useRef(new Set<HTMLDivElement>());
    const hScrollSync = useMemo<HScrollSync>(() => {
        const group = createHScrollGroup();
        const retarget = (): void => {
            const next = Array.from(bodiesRef.current)[0] ?? null;
            if (hScrollRef.current !== next) {
                hScrollRef.current = next;
                setRetargetKey((k) => k + 1);
            }
        };
        return {
            group,
            registerBody: (el) => {
                const off = group.add(el);
                bodiesRef.current.add(el);
                retarget();
                return () => {
                    off();
                    bodiesRef.current.delete(el);
                    retarget();
                };
            },
        };
    }, []);

    const isOpen = (key: string): boolean => {
        if (openLocally.has(key)) return true;
        return ! collapsedSet.has(key);
    };

    // Field ids que tienen sentido para aggregates (el resto los
    // omite el backend). Se calcula una vez para toda la vista —
    // todos los buckets agregan las mismas columnas.
    const aggregateFieldIds = useMemo(
        () => fields
            .filter(footerIsAggregatable)
            .map((f) => f.id),
        [fields],
    );

    // Bundle endpoint: UNA request trae los grupos, las filas de los
    // abiertos y sus agregados. v0.1.224 — se piden "todos abiertos salvo
    // los cerrados" en vez de la lista de abiertos: antes esa lista salía de
    // la respuesta anterior, así que cada búsqueda eran DOS vueltas y los
    // grupos que traía la búsqueda nueva se veían vacíos entre medio.
    // v0.1.287 — las claves de los SUBGRUPOS cerrados viven en la misma
    // lista guardada como `["v:grupo","v:subgrupo"]` (empiezan con `[`, no
    // chocan con las de primer nivel) y viajan al backend como pares crudos.
    const collapsedRaw = useMemo(
        () => [...collapsedSet].filter((k) => ! openLocally.has(k) && ! isPairKey(k)).map(localToRawKey),
        [collapsedSet, openLocally],
    );
    const subField = subGroupByField && subGroupByField.id !== groupByField.id ? subGroupByField : null;
    const collapsedSubRaw = useMemo(
        () =>
            subField === null
                ? []
                : [...collapsedSet]
                      .filter((k) => ! openLocally.has(k) && isPairKey(k))
                      .flatMap((k): Array<[string, string]> => {
                          const pair = parsePairKey(k);
                          return pair ? [[localToRawKey(pair[0]), localToRawKey(pair[1])]] : [];
                      }),
        [collapsedSet, openLocally, subField],
    );
    const bundle = useRecordsGroupedBundle({
        listId,
        groupBy: groupByField.id,
        collapsed: collapsedRaw,
        filterTree: filterTreeParam,
        search,
        sort: sortParam,
        aggregateFieldIds,
        subGroupBy: subField?.id ?? null,
        collapsedSub: collapsedSubRaw,
    });

    const buckets = bundle.data?.buckets ?? [];
    const expandedMap = bundle.data?.expanded ?? {};
    // Mientras llega la respuesta de OTRA consulta (búsqueda o filtro
    // nuevos) se sigue mostrando la anterior, atenuada.
    const showingStale = bundle.isPlaceholderData;
    const matchingTotal = showingStale ? null : bundle.data?.meta.total_records ?? null;
    useEffect(() => {
        onStatusChange?.({ total: matchingTotal, fetching: bundle.isFetching });
    }, [onStatusChange, matchingTotal, bundle.isFetching]);

    const toggleGroup = (key: string): void => {
        const willBeOpen = ! isOpen(key);
        // Update local override.
        setOpenLocally((prev) => {
            const next = new Set(prev);
            if (willBeOpen) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
        // Update persistido del saved view (si el caller lo soporta).
        if (onCollapsedGroupsChange) {
            const next = new Set(collapsedSet);
            if (willBeOpen) {
                next.delete(key);
            } else {
                next.add(key);
            }
            onCollapsedGroupsChange([...next]);
        }
    };

    const visibleColumns = useMemo(
        () => sortByOrder(buildColumns(fields), columnOrder ?? [])
            .filter((c) => columnVisibility[c.id] !== false),
        [fields, columnVisibility, columnOrder],
    );

    // Ancho total de la tabla = checkbox + columnas dinámicas + add-col.
    // Lo usamos para que TODOS los bucket cards compartan el mismo
    // ancho mínimo, así un solo scroll horizontal en el wrapper exterior
    // alinea las columnas verticalmente entre buckets (estilo ClickUp).
    //
    // OJO: este `useMemo` tiene que ir ANTES de los early returns
    // (loading/error/empty) — sino React tira "more hooks rendered
    // than previous render" cuando el estado pasa de loading a ready.
    const tableWidth = useMemo(() => {
        const sizing = columnSizing ?? {};
        let total = 40; // checkbox
        for (const c of visibleColumns) {
            total += sizing[c.id] ?? defaultSizeForColumn(c);
        }
        return total;
    }, [visibleColumns, columnSizing]);

    // v0.1.287 — columnas fijas (las mismas en todos los grupos) y reglas de
    // color. Van ANTES de los early returns (regla de hooks).
    const rootRef = useRef<HTMLDivElement>(null);
    const rootWidth = useWidth(rootRef, ! bundle.isLoading);
    const frozen = useMemo(
        () =>
            computeFrozen(
                visibleColumns.map((c) => ({ id: c.id, width: (columnSizing ?? {})[c.id] ?? defaultSizeForColumn(c) })),
                frozenColumns ?? 1,
                rootWidth,
            ),
        [visibleColumns, columnSizing, frozenColumns, rootWidth],
    );
    const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const rulesInUse = useMemo(() => activeColorRules(colorRules, fieldsById), [colorRules, fieldsById]);
    const viewDecor = useMemo<ViewDecor>(
        () => ({
            frozen,
            showFrozenEdge: frozenColumns !== null && frozen.count > 0,
            rules: rulesInUse,
            fieldsById,
            onFreeze: onFrozenColumnsChange
                ? (f: FieldEntity) => onFrozenColumnsChange(Math.max(1, visibleColumns.findIndex((c) => c.field?.id === f.id) + 1))
                : undefined,
            onUnfreeze: onFrozenColumnsChange && frozenColumns !== null ? () => onFrozenColumnsChange(null) : undefined,
            onColor: onColorColumn,
        }),
        [frozen, frozenColumns, rulesInUse, fieldsById, onFrozenColumnsChange, onColorColumn, visibleColumns],
    );

    // OJO: este `useMemo` TIENE que estar ANTES de los early returns de
    // loading/error/empty (fix 0.57.32). Antes vivía después y violaba
    // las reglas de hooks: cuando bundle pasaba de loading a ready,
    // React renderea N+1 hooks (en vez de N) → "more hooks rendered
    // than during the previous render" (#310) → pantalla en blanco al
    // agrupar.
    const allVisibleRecordIds = useMemo(() => {
        const ids: number[] = [];
        const exp = bundle.data?.expanded ?? {};
        for (const key of Object.keys(exp)) {
            const recs = exp[key]?.records.data ?? [];
            for (const r of recs) ids.push(r.id);
        }
        return ids;
    }, [bundle.data]);

    if (bundle.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando grupos…')}
            </div>
        );
    }

    if (bundle.isError) {
        return (
            <p className="imcrm-text-sm imcrm-text-destructive">
                {sprintf(__('Error: %s'), (bundle.error as Error).message)}
            </p>
        );
    }

    if (buckets.length === 0) {
        return (
            <div className="imcrm-px-4 imcrm-py-8">
                <EmptyState
                    icon={Inbox}
                    title={__('No hay registros')}
                    description={__('Esta lista no tiene registros que coincidan con los filtros actuales.')}
                    variant="bare"
                />
            </div>
        );
    }

    // `allVisibleRecordIds` se computa arriba (antes de los early
    // returns) por la regla de hooks. Aquí solo lo usamos.

    return (
        <RecurrencesBatchProvider listId={listId} recordIds={allVisibleRecordIds}>
        <RecordUpdaterProvider listId={listId}>
       <WrapTextContext.Provider value={wrapText}>
        <div ref={rootRef} className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {/* Scroll horizontal único compartido entre todos los
                buckets — sin esto cada bucket tenía su propio
                overflow-x-auto y las columnas no quedaban alineadas
                verticalmente entre grupos al scrollear. Ahora el outer
                div es el contenedor de scroll; cada `<section>` adentro
                tiene `min-width: tableWidth` para que todos midan
                igual. Sticky-left funciona contra este outer div.

                Solo scroll HORIZONTAL aquí: el vertical es el de la
                página (pedido del usuario, v0.1.70) — los buckets crecen
                a su alto natural. */}
            <HScrollSyncContext.Provider value={hScrollSync}>
                <div
                    className={cn(
                        'imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pb-2 imcrm-transition-opacity',
                        showingStale && 'imcrm-opacity-60',
                    )}
                    aria-busy={showingStale}
                >
                    {buckets.map((bucket) => {
                        const key = bucketKey(bucket);
                        const rawKey = bucketRawKey(bucket);
                        const shared = {
                            listId,
                            listSlug,
                            columns: visibleColumns,
                            columnSizing: columnSizing ?? {},
                            onColumnSizingChange,
                            tableWidth,
                            baseTree: filterTree,
                            search,
                            selectedIds,
                            onSelectionChange,
                            onRowClick,
                            bundleFetching: bundle.isFetching,
                            aggregateFieldIds,
                            // El "+" de agregar columna flota sobre la cabecera
                            // de cada grupo (un solo trigger por tabla visible).
                            onAddColumn,
                            onEditField,
                            allFields: fields,
                            onHideColumn:
                                onColumnVisibilityChange
                                    ? (f: FieldEntity) =>
                                          onColumnVisibilityChange({
                                              ...columnVisibility,
                                              // El id de columna es el SLUG del campo.
                                              [f.slug]: false,
                                          })
                                    : undefined,
                            onCreateSubtask,
                            density,
                            fontSize,
                            singleClickEdit,
                            footerAggregates,
                            onFooterAggregatesChange,
                            sort,
                            sortParam,
                            onSortChange,
                            onSortSet,
                            decor: viewDecor,
                        };
                        // v0.1.287 — dos niveles: el grupo es un encabezado fijo
                        // y adentro van sus subgrupos, cada uno con su tabla.
                        if (subField !== null) {
                            return (
                                <ParentGroupSection
                                    key={key}
                                    groupByField={groupByField}
                                    bucket={bucket}
                                    isOpen={isOpen(key)}
                                    onToggle={() => toggleGroup(key)}
                                >
                                    {(parentHeaderHeight) =>
                                        (bucket.sub_buckets ?? []).map((sub) => {
                                            const subKey = pairLocalKey(key, bucketKey(sub));
                                            const pairRaw = subGroupPairRawKey(bucket.value, sub.value);
                                            const prefetched = expandedMap[pairRaw];
                                            return (
                                                <GroupBucketSection
                                                    key={subKey}
                                                    {...shared}
                                                    groupByField={subField}
                                                    bucket={sub}
                                                    parentCondition={{ field: groupByField, value: bucket.value }}
                                                    headerOffset={parentHeaderHeight}
                                                    level={1}
                                                    isOpen={isOpen(subKey)}
                                                    onToggle={() => toggleGroup(subKey)}
                                                    prefetchedRecords={prefetched?.records}
                                                    prefetchedAggregates={prefetched?.aggregates}
                                                    onAddRecord={
                                                        onAddRecord
                                                            ? () => onAddRecord(groupByField, bucket.value, { field: subField, value: sub.value })
                                                            : undefined
                                                    }
                                                />
                                            );
                                        })
                                    }
                                </ParentGroupSection>
                            );
                        }
                        const prefetched = expandedMap[rawKey];
                        return (
                            <GroupBucketSection
                                key={key}
                                {...shared}
                                groupByField={groupByField}
                                bucket={bucket}
                                isOpen={isOpen(key)}
                                onToggle={() => toggleGroup(key)}
                                prefetchedRecords={prefetched?.records}
                                prefetchedAggregates={prefetched?.aggregates}
                                onAddRecord={
                                    onAddRecord
                                        ? () => onAddRecord(groupByField, bucket.value)
                                        : undefined
                                }
                            />
                        );
                    })}
                </div>
            </HScrollSyncContext.Provider>
            {/* Scrollbar horizontal fija al fondo del viewport (estilo
                ClickUp) — la nativa del wrapper queda al fondo de la
                lista de grupos. */}
            <StickyHScrollbar targetRef={hScrollRef} group={hScrollSync.group} retargetKey={retargetKey} />

            {/* v0.1.125 — el resumen va al FINAL: arriba le comía altura a la
                tabla sin aportar nada al escanear los grupos. */}
            <div className="imcrm-pt-1 imcrm-text-xs imcrm-text-muted-foreground">
                {/* v0.1.189 — plural de verdad ("1 grupo · 1 registro"). */}
                {sprintf(
                    /* translators: %d total groups */
                    _n('%d grupo', '%d grupos', bundle.data?.meta.total_groups ?? 0),
                    bundle.data?.meta.total_groups ?? 0,
                )}
                {' · '}
                {sprintf(
                    /* translators: %d total records */
                    _n('%d registro', '%d registros', bundle.data?.meta.total_records ?? 0),
                    bundle.data?.meta.total_records ?? 0,
                )}
                {(bundle.data?.meta.hidden_groups ?? 0) > 0 && (
                    <span className="imcrm-ml-1 imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {' · '}
                        {sprintf(
                            /* translators: %1$d shown groups, %2$d hidden groups */
                            __('Se muestran los primeros %1$d grupos; %2$d más quedan afuera. Agrupa por un campo con menos valores distintos o filtra.'),
                            (bundle.data?.meta.total_groups ?? 0) - (bundle.data?.meta.hidden_groups ?? 0),
                            bundle.data?.meta.hidden_groups ?? 0,
                        )}
                    </span>
                )}
                {(bundle.data?.meta.hidden_sub_groups ?? 0) > 0 && (
                    <span className="imcrm-ml-1 imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {' · '}
                        {sprintf(
                            /* translators: %d hidden sub groups */
                            __('%d combinaciones de grupo y subgrupo quedan afuera. Agrupa por campos con menos valores distintos o filtra.'),
                            bundle.data?.meta.hidden_sub_groups ?? 0,
                        )}
                    </span>
                )}
            </div>
        </div>
        </WrapTextContext.Provider>
       </RecordUpdaterProvider>
        </RecurrencesBatchProvider>
    );
}

const EMPTY_SORT: ActiveSort[] = [];

/** Tipos que el backend no ordena (ver `NON_SORTABLE` en records.service). */
function isSortableField(field: FieldEntity): boolean {
    // Fórmulas (A1): sólo las que el servidor compila a SQL.
    if (field.type === 'formula') return field.formula?.sql === true;
    return field.type !== 'relation' && field.type !== 'file' && field.type !== 'button';
}

interface ColumnDef {
    id: string;
    label: string;
    field: FieldEntity | null;
    isPrimary: boolean;
}

/**
 * Aplica el `columnOrder` persistido (mismo formato que TanStack:
 * array de column ids) sobre un set de columnas. Las columnas no
 * incluidas en `order` quedan al final en su orden original — esto
 * cubre el caso "el user reordenó algunas pero no todas, después
 * agregó un campo nuevo, y queremos que el campo nuevo aparezca al
 * final sin romper el orden custom".
 */
function sortByOrder(columns: ColumnDef[], order: string[]): ColumnDef[] {
    if (order.length === 0) return columns;
    const byId = new Map(columns.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: ColumnDef[] = [];
    for (const id of order) {
        const c = byId.get(id);
        if (c && ! seen.has(id)) {
            out.push(c);
            seen.add(id);
        }
    }
    for (const c of columns) {
        if (! seen.has(c.id)) out.push(c);
    }
    return out;
}

/**
 * Default si el user no ha resizeado todavía. Mismos valores que
 * `TableView.defaultSizeForType` para que el visual sea consistente
 * entre flat y grouped.
 */
function defaultSizeForColumn(c: ColumnDef): number {
    if (c.id === 'id') return 70;
    if (c.id === 'updated_at') return 170;
    const t = c.field?.type ?? 'text';
    // v0.1.210 — un enlace que se ve como miniatura no necesita ancho de URL.
    if (t === 'url' && isImageUrlField(c.field?.config)) return 90;
    switch (t) {
        case 'checkbox':     return 90;
        case 'number':
        case 'currency':     return 120;
        case 'date':         return 130;
        case 'datetime':     return 170;
        case 'select':       return 140;
        case 'multi_select': return 200;
        case 'email':
        case 'url':          return 220;
        case 'long_text':    return 280;
        default:             return 180;
    }
}

const EMPTY_ROWS: RecordEntity[] = [];

function buildColumns(fields: FieldEntity[]): ColumnDef[] {
    const dynamic = [...fields]
        .sort((a, b) => a.position - b.position)
        .map<ColumnDef>((f) => ({
            id: f.slug,
            label: f.label,
            field: f,
            isPrimary: f.is_primary,
        }));
    return [
        ...dynamic,
        { id: 'id', label: __('ID'), field: null, isPrimary: false },
        { id: 'updated_at', label: __('Actualizado'), field: null, isPrimary: false },
    ];
}

/**
 * v0.1.287 — Lo que comparten todos los grupos de la vista: columnas fijas,
 * reglas de color y los atajos del menú de la columna.
 */
interface ViewDecor {
    frozen: FrozenLayout;
    showFrozenEdge: boolean;
    rules: ViewColorRule[];
    fieldsById: ReadonlyMap<number, FieldEntity>;
    onFreeze?: (field: FieldEntity) => void;
    onUnfreeze?: () => void;
    onColor?: (field: FieldEntity) => void;
}

interface GroupBucketSectionProps {
    listId: number;
    listSlug?: string;
    /** El campo del ENCABEZADO de esta sección (el del subgrupo, en dos niveles). */
    groupByField: FieldEntity;
    bucket: RecordGroupBucket;
    /** v0.1.287 — En un subgrupo: el grupo al que pertenece (filtra también por él). */
    parentCondition?: { field: FieldEntity; value: string | null };
    /** v0.1.287 — Alto del encabezado del grupo padre (los fijos se apilan debajo). */
    headerOffset?: number;
    /** v0.1.287 — 0 = grupo, 1 = subgrupo. */
    level?: 0 | 1;
    decor: ViewDecor;
    isOpen: boolean;
    onToggle: () => void;
    columns: ColumnDef[];
    columnSizing: Record<string, number>;
    onColumnSizingChange?: (next: Record<string, number>) => void;
    /**
     * Ancho total compartido por todos los buckets. La tabla se
     * estira a este ancho con `tableLayout: 'fixed'` para que las
     * columnas queden alineadas entre buckets cuando el outer scroll
     * mueve la posición.
     */
    tableWidth: number;
    baseTree: FilterTree;
    search: string;
    selectedIds: number[];
    onSelectionChange: (ids: number[]) => void;
    onRowClick?: (record: RecordEntity) => void;
    /** Records de la 1ra página venidos del bundle. Si está definido,
     *  no disparamos `useRecords` para page 1 — pure prop drilling. */
    prefetchedRecords?: RecordListResponse;
    /** Aggregates del bucket venidos del bundle. */
    prefetchedAggregates?: AggregatesResponse;
    /** Bundle re-fetching (usado para mostrar spinner mientras la 2da
     *  pasada está en vuelo después de toggle). */
    bundleFetching: boolean;
    /** Field ids agregados — se pasan al bundle, pero también los
     *  necesitamos por si caemos al fallback `useAggregates`. */
    aggregateFieldIds: number[];
    onAddColumn?: () => void;
    /** Menú contextual "⌄" por columna de campo (ver GroupedTableViewProps). */
    onEditField?: (field: FieldEntity) => void;
    /** Todos los campos de la lista — para "Mover al inicio/final". */
    allFields?: FieldEntity[];
    /** Ocultar la columna en la vista actual. */
    onHideColumn?: (field: FieldEntity) => void;
    onAddRecord?: () => void;
    onCreateSubtask?: (record: RecordEntity) => void;
    density?: RowDensity | null;
    fontSize?: RowFontSize | null;
    singleClickEdit?: boolean;
    footerAggregates?: Record<string, string>;
    onFooterAggregatesChange?: (next: Record<string, string>) => void;
    sort: ActiveSort[];
    /** `field_{id}:{dir},…` — lo que viaja al backend (también en "Ver más"). */
    sortParam?: string;
    onSortChange?: (fieldId: number, multi: boolean) => void;
    onSortSet?: (fieldId: number, dir: 'asc' | 'desc') => void;
}

/**
 * Una sección por bucket: header siempre visible + tabla colapsable.
 * Cuando se expande dispara el fetch de los registros filtrados a
 * `value`. La paginación dentro del grupo está limitada a la primera
 * página (50 registros) — si el grupo es más grande aparece un "Ver
 * más" abajo. Suficiente para MVP; iteraremos.
 */
function GroupBucketSection({
    listId,
    listSlug,
    groupByField,
    bucket,
    parentCondition,
    headerOffset = 0,
    level = 0,
    decor,
    isOpen,
    onToggle,
    columns,
    columnSizing,
    onColumnSizingChange,
    tableWidth,
    baseTree,
    search,
    selectedIds,
    onSelectionChange,
    onRowClick,
    prefetchedRecords,
    prefetchedAggregates,
    bundleFetching,
    aggregateFieldIds,
    onAddColumn,
    onEditField,
    allFields,
    onHideColumn,
    onAddRecord,
    onCreateSubtask,
    density = null,
    fontSize = null,
    singleClickEdit = false,
    footerAggregates,
    onFooterAggregatesChange,
    sort,
    sortParam,
    onSortChange,
    onSortSet,
}: GroupBucketSectionProps): JSX.Element {
    const [page, setPage] = useState(1);
    const perPage = 50;
    // El bucket es un componente aparte: el flag viaja por contexto
    // (lo provee GroupedTableView), no por prop.
    const wrapText = useWrapText();
    // Menú contextual de fila (click derecho) — v0.1.129.
    const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null);
    // Subtareas abiertas dentro de este bucket (v0.1.137). La vista
    // agrupada no las tenía: el usuario reportó que sólo salían en la
    // vista plana. Los hijos se piden por padre abierto (el listado
    // devuelve sólo el primer nivel).
    const [expandedIds, setExpandedIds] = useState<number[]>([]);
    const [subtasksByParent, setSubtasksByParent] = useState<Record<number, RecordEntity[]>>({});
    const toggleSubtasks = (id: number): void => {
        setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };
    // v0.1.213 — lista de una tienda: sin altas ni borrados (se hacen allá).
    const storeRules = useStoreRules();
    const canCreateRecords = useCan(CAP.CREATE_RECORDS) && storeRules === null;
    const canDeleteRecords = useCanAny(CAP.DELETE_RECORDS, CAP.DELETE_OWN_RECORDS) && storeRules === null;

    // Filter tree del bucket: árbol base + condición `groupByField op
    // value`. Solo se usa para fallback (page > 1 o cuando el bundle
    // no incluyó este bucket por algún motivo).
    const parentField = parentCondition?.field ?? null;
    const parentValue = parentCondition?.value ?? null;
    const bucketTree: FilterTree = useMemo(() => {
        const condFor = (field: FieldEntity, value: string | null): FilterCondition => {
            const op = filterOpForBucket(field.type, value);
            return { type: 'condition', field_id: field.id, op: op.op, value: op.value };
        };
        const withParent = parentField ? addNode(baseTree, [], condFor(parentField, parentValue)) : baseTree;
        return addNode(withParent, [], condFor(groupByField, bucket.value));
    }, [baseTree, groupByField, bucket.value, parentField, parentValue]);

    // Page 1 viene del bundle; page > 1 cae al `useRecords` clásico.
    // Esto evita que el componente reviente cuando el user paginea
    // dentro de un bucket grande, sin perder el beneficio del bundle
    // para el caso común.
    const usePrefetched = isOpen && page === 1 && prefetchedRecords !== undefined;
    const useAggregatesPrefetched = isOpen && prefetchedAggregates !== undefined;

    const fallbackQuery: RecordsQuery = useMemo(() => {
        const q: RecordsQuery = { page, per_page: perPage };
        // Siempre filter_tree JSON: la forma plana WP-style era ignorada
        // por el backend cloud (ver buildRecordsQuery en recordsState.ts).
        if (bucketTree.children.length > 0) {
            q.filter_tree = JSON.stringify(bucketTree);
        }
        if (search.trim() !== '') q.search = search.trim();
        if (sortParam !== undefined) q.sort = sortParam;
        return q;
    }, [bucketTree, page, search, sortParam]);

    // Mientras el bundle está en vuelo NO se pide grupo por grupo: la
    // respuesta ya trae las filas de todos los abiertos (v0.1.224 — antes,
    // al cambiar la búsqueda, cada grupo nuevo disparaba su propia request
    // de filas y de agregados además del bundle).
    const fallbackEnabled = isOpen && ! usePrefetched && (page > 1 || ! bundleFetching);
    const fallbackRecords = useRecords(fallbackEnabled ? listId : undefined, fallbackQuery);

    const fallbackAggregates = useAggregates({
        listSlug: useAggregatesPrefetched || bundleFetching ? undefined : (isOpen ? listSlug : undefined),
        fieldIds: aggregateFieldIds,
        filterTree: bucketTree,
    });

    const records: { isLoading: boolean; isError: boolean; error: unknown; data: RecordListResponse | undefined } =
        usePrefetched
            ? {
                  isLoading: false,
                  isError: false,
                  error: null,
                  data: prefetchedRecords,
              }
            : {
                  isLoading: fallbackRecords.isLoading || (isOpen && bundleFetching && ! fallbackEnabled),
                  isError: fallbackRecords.isError,
                  error: fallbackRecords.error,
                  data: fallbackRecords.data,
              };

    // v0.1.209 — títulos de los vinculados del grupo: una query por columna relation.
    const relationTitles = useRelationTitlesForRows(
        useMemo(() => columns.map((c) => c.field).filter((f): f is FieldEntity => f !== null), [columns]),
        records.data?.data ?? EMPTY_ROWS,
    );

    const aggregates: { data: AggregatesResponse | undefined } = useAggregatesPrefetched
        ? { data: prefetchedAggregates }
        : { data: fallbackAggregates.data };

    const labelText = formatBucketLabel(groupByField, bucket.value);

    // v0.1.189 — con cero filas `every` da true y la casilla del grupo
    // aparecía MARCADA en un grupo vacío.
    const allRecordsSelected =
        (records.data?.data.length ?? 0) > 0
        && (records.data?.data.every((r) => selectedIds.includes(r.id)) ?? false);
    const selectedSet = new Set(selectedIds);

    const toggleAllInGroup = (): void => {
        const ids = records.data?.data.map((r) => r.id) ?? [];
        if (allRecordsSelected) {
            onSelectionChange(selectedIds.filter((id) => !ids.includes(id)));
        } else {
            const next = new Set(selectedIds);
            ids.forEach((id) => next.add(id));
            onSelectionChange([...next]);
        }
    };

    const toggleOne = (id: number): void => {
        if (selectedSet.has(id)) {
            onSelectionChange(selectedIds.filter((x) => x !== id));
        } else {
            onSelectionChange([...selectedIds, id]);
        }
    };

    const total = records.data?.meta.total ?? 0;
    const hasMore = isOpen && total > page * perPage;

    // v0.1.193 — el encabezado del grupo y la cabecera de columnas quedan
    // FIJOS mientras se recorre ESE grupo y los reemplaza el del siguiente
    // (como ClickUp), con `position: sticky` NATIVO: el encabezado se pega
    // bajo la cabecera de la página y su recorrido lo limita la sección
    // (al terminar, se va con ella); la cabecera de columnas —en su propia
    // tabla, fuera del scroller horizontal— se pega DEBAJO del encabezado.
    // v0.1.287 — en un subgrupo, los fijos se apilan DEBAJO del encabezado
    // del grupo padre (que sigue pegado mientras se recorren sus subgrupos).
    const stickyTop = usePageStickyTop() + headerOffset;
    const [headerEl, setHeaderEl] = useState<HTMLButtonElement | null>(null);
    const headerHeight = useElementHeight(headerEl);
    const [groupSentinelEl, setGroupSentinelEl] = useState<HTMLDivElement | null>(null);
    const headerStuck = useStuckSentinel(groupSentinelEl, stickyTop);
    const hScrollSync = useContext(HScrollSyncContext);
    const bodyScrollRef = useRef<HTMLDivElement>(null);
    const headScrollRef = useRef<HTMLDivElement>(null);
    const tableMounted = isOpen && !records.isLoading && !records.isError;
    // Filas del bucket aplanadas (con las subtareas abiertas debajo de su
    // padre) y la ventana de las que se ven (v0.1.256): con muchos grupos
    // abiertos ya no se dibujan miles de filas fuera de pantalla.
    const flatRows = useMemo(
        () => (records.data?.data ?? []).flatMap((r) => [
            { record: r, depth: 0 },
            ...(expandedIds.includes(r.id)
                ? (subtasksByParent[r.id] ?? []).map((c) => ({ record: c, depth: 1 }))
                : []),
        ]),
        [records.data, expandedIds, subtasksByParent],
    );
    const windowed = useMainVirtualRows(bodyScrollRef, tableMounted ? flatRows.length : 0, { density, measure: wrapText });
    // v0.1.261 — desvanecido del borde derecho mientras haya columnas por ver.
    const overflowRight = useOverflowsRight(bodyScrollRef, [tableMounted]);
    const visibleRows = windowed.active
        ? windowed.items.flatMap((it) => {
            const row = flatRows[it.index];
            return row ? [{ ...row, index: it.index }] : [];
        })
        : flatRows.map((row, index) => ({ ...row, index }));
    // v0.1.287 — la tabla del grupo como hoja de cálculo (rango, copiar,
    // pegar, rellenar, deshacer): mismo controlador que la tabla plana.
    const gridColumns = useMemo<GridColumnRef[]>(() => columns.map((c) => ({ id: c.id, field: c.field })), [columns]);
    const gridRows = useMemo(() => flatRows.map((r) => r.record), [flatRows]);
    const canEditRecords = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const canManageFields = useCan(CAP.MANAGE_FIELDS);
    const titleField = useMemo(() => titleFieldOf(allFields), [allFields]);
    const grid = useGridController({
        containerRef: bodyScrollRef,
        rows: gridRows,
        columns: gridColumns,
        listId,
        canEdit: canEditRecords,
        // En la vista agrupada no se crean filas al pegar: no tendrían el
        // valor del grupo y aparecerían en otro.
        canCreate: false,
        hasMoreRows: hasMore,
        noCreateReason: __('en la vista agrupada no se crean filas al pegar (quedarían en otro grupo). Pégalas en la vista sin agrupar.'),
        allFields,
        canManageFields,
        recordTitle: (r) => {
            const v = titleField ? r.fields[titleField.slug] : null;
            return typeof v === 'string' && v.trim() !== '' ? v : `#${r.id}`;
        },
        locked: storeRules ? (field, record) => lockedReasonOf(storeRules, field, record) : undefined,
        relationTitles,
        onOpenRow: onRowClick,
        scrollToIndex: windowed.scrollToIndex,
        headBottom: () => headScrollRef.current?.getBoundingClientRect().bottom ?? null,
        frozenCount: decor.frozen.count,
        singleClickEdit,
    });
    const rowColors = useMemo(() => {
        const out = new Map<number, RowColors>();
        if (decor.rules.length === 0) return out;
        const opts = { timeZone: getTenantTimeZone() };
        for (const r of gridRows) out.set(r.id, evaluateRowColors(decor.rules, r, decor.fieldsById, opts));
        return out;
    }, [decor.rules, decor.fieldsById, gridRows]);
    const stickyFor = (columnId: string): React.CSSProperties | undefined => {
        const left = decor.frozen.left.get(columnId);
        return left === undefined ? undefined : { position: 'sticky' as const, left, zIndex: 1 };
    };
    const edgeFor = (columnId: string): string | null =>
        decor.showFrozenEdge && decor.frozen.lastId === columnId ? FROZEN_EDGE_SHADOW : null;
    const firstDynamicIndex = columns.findIndex((cc) => cc.field !== null);

    useEffect(() => {
        if (!hScrollSync || !tableMounted) return;
        const body = bodyScrollRef.current;
        const head = headScrollRef.current;
        const offs = [body ? hScrollSync.registerBody(body) : null, head ? hScrollSync.group.add(head) : null];
        return () => offs.forEach((off) => off?.());
    }, [hScrollSync, tableMounted]);

    const tableClassName = cn(
        'imcrm-records-table imcrm-w-full imcrm-text-sm',
        wrapText && 'imcrm-wrap-cells',
        `imcrm-density-${density ?? 'normal'}`,
        `imcrm-fontsize-${fontSize ?? 'md'}`,
    );
    // `width: 100%` + `minWidth: tableWidth`: la tabla llena el contenedor
    // (sin vacío a la derecha) y todos los buckets comparten el mismo
    // min-width para que las columnas queden alineadas.
    const tableStyle: React.CSSProperties = {
        tableLayout: 'fixed',
        width: '100%',
        minWidth: tableMinWidth(tableWidth, columns.length + 1, Boolean(onAddColumn)),
    };
    // Ver TableView: sin `<colgroup>` la columna de la casilla se estira
    // con el sobrante. Se rinde en las DOS tablas (cabecera y cuerpo).
    const colGroup = (
        <colgroup>
            <col style={{ width: 28 }} />
            {columns.map((c) => (
                <col
                    key={c.id}
                    style={{ width: columnSizing[c.id] ?? defaultSizeForColumn(c) }}
                />
            ))}
            {onAddColumn && <col />}
        </colgroup>
    );

    return (
        <RelationTitlesContext.Provider value={relationTitles}>
        <section
            // Grupo PLANO (estilo ClickUp): sin card (border/rounded/
            // shadow/bg-card) alrededor — header del grupo (chip +
            // contador) directo sobre el canvas, filas debajo separadas
            // por hairlines. OJO: tampoco usar `overflow-hidden` aquí —
            // rompe `position: sticky` de las celdas internas (crea un
            // containing block para el sticky que NO scrollea).
            aria-expanded={isOpen}
        >
            <div ref={setGroupSentinelEl} aria-hidden className="imcrm-h-px imcrm--mb-px" />
            <GroupHeaderButton
                ref={setHeaderEl}
                field={groupByField}
                bucket={bucket}
                isOpen={isOpen}
                onToggle={onToggle}
                top={stickyTop}
                stuck={headerStuck}
                level={level}
            />

            {isOpen && (
                // Sin `overflow-x-auto` aquí — el scroll horizontal es
                // del wrapper exterior compartido entre todos los
                // buckets (single-scroll ClickUp-style).
                <div>
                    {records.isLoading ? (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando…')}
                        </div>
                    ) : records.isError ? (
                        <p className="imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-text-destructive">
                            {(records.error as Error).message}
                        </p>
                    ) : (
                        <div className="imcrm-relative">
                        <RightEdgeFade show={overflowRight} />
                        <div
                            data-testid="imcrm-table-head"
                            className="imcrm-sticky imcrm-z-20 imcrm-bg-background"
                            style={{ top: stickyTop + headerHeight }}
                        >
                        {/* Scrollable a propósito (barra nativa oculta): en
                            táctil la cabecera pegada también se arrastra. */}
                        <div
                            ref={headScrollRef}
                            className="imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-native-hscroll-hidden"
                            // Capa compuesta para la cabecera (ver TableView).
                            style={{ willChange: 'scroll-position' }}
                        >
                        <table className={tableClassName} style={tableStyle}>
                            {colGroup}
                            <thead>
                                <tr className="imcrm-group/head">
                                    <th
                                        scope="col"
                                        className="imcrm-w-7 imcrm-px-1.5 imcrm-py-2"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={allRecordsSelected}
                                            onChange={toggleAllInGroup}
                                            className={cn(
                                                'imcrm-h-3.5 imcrm-w-3.5 imcrm-cursor-pointer imcrm-rounded-[3px] imcrm-border-input imcrm-accent-primary imcrm-transition-opacity',
                                                allRecordsSelected || selectedIds.length > 0
                                                    ? 'imcrm-opacity-100'
                                                    : 'imcrm-opacity-0 group-hover/head:imcrm-opacity-100 focus-visible:imcrm-opacity-100',
                                            )}
                                            aria-label={__('Seleccionar todos en grupo')}
                                        />
                                    </th>
                                    {columns.map((c) => {
                                        const w = columnSizing[c.id] ?? defaultSizeForColumn(c);
                                        // Sticky-left: las columnas fijas (v0.1.287;
                                        // por defecto sólo la primera). UX igual a
                                        // ClickUp — el "Nombre" se queda fijo,
                                        // checkbox no.
                                        const sticky = stickyFor(c.id);
                                        const edge = edgeFor(c.id);
                                        return (
                                            <th
                                                key={c.id}
                                                scope="col"
                                                style={{ width: w, minWidth: w, ...(sticky ?? {}), ...(edge ? { boxShadow: edge } : {}) }}
                                                onContextMenu={
                                                    c.field !== null
                                                        ? (e) => {
                                                    const btn = e.currentTarget.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement | null;
                                                    if (!btn) return;
                                                    e.preventDefault();
                                                    // Radix DropdownMenu abre en pointerdown (no en click).
                                                    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
                                                }
                                                        : undefined
                                                }
                                                className={cn(
                                                    // `group/th` habilita el reveal on-hover del
                                                    // menú contextual de la columna (FieldHeaderMenu).
                                                    // `relative` ancla el handle de resize;
                                                    // `overflow-hidden` evita que el contenido de
                                                    // columnas angostas desborde al th vecino (el
                                                    // chevron quedaba solapado con el botón "+").
                                                    'imcrm-group/th imcrm-relative imcrm-overflow-hidden imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[12px] imcrm-font-medium imcrm-text-muted-foreground',
                                                    // Sticky cell necesita bg sólido para
                                                    // tapar las celdas al scrollear
                                                    // horizontal — canvas, no card.
                                                    sticky && 'imcrm-bg-background',
                                                )}
                                            >
                                                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5">
                                                    {c.field !== null && onSortChange !== undefined && isSortableField(c.field) ? (
                                                        // v0.1.286 — ordenar también en la vista
                                                        // agrupada: el orden aplica DENTRO de cada grupo.
                                                        <button
                                                            type="button"
                                                            onClick={(e) => onSortChange(c.field!.id, e.shiftKey)}
                                                            className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded hover:imcrm-text-foreground"
                                                            aria-label={sprintf(__('Ordenar por %s'), c.label)}
                                                        >
                                                            {c.isPrimary && (
                                                                <KeyRound className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-primary" aria-hidden="true" />
                                                            )}
                                                            <span className="imcrm-truncate">{c.label}</span>
                                                            <StoreColumnBadge fieldId={c.field.id} />
                                                            <SortIndicator
                                                                dir={sort.find((x) => x.field_id === c.field!.id)?.dir ?? null}
                                                                index={sort.findIndex((x) => x.field_id === c.field!.id)}
                                                                multiCount={sort.length}
                                                            />
                                                        </button>
                                                    ) : (
                                                        <>
                                                            {c.isPrimary && (
                                                                <KeyRound
                                                                    className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-primary"
                                                                    aria-hidden="true"
                                                                />
                                                            )}
                                                            <span className="imcrm-truncate">{c.label}</span>
                                                            {c.field && <StoreColumnBadge fieldId={c.field.id} />}
                                                        </>
                                                    )}
                                                    {c.field !== null && (
                                                        <FieldHeaderMenu
                                                            listId={listId}
                                                            listSlug={listSlug}
                                                            field={c.field}
                                                            fields={allFields}
                                                            onEdit={onEditField}
                                                            onHide={onHideColumn}
                                                            onSort={onSortSet && isSortableField(c.field) ? (f, dir) => onSortSet(f.id, dir) : undefined}
                                                            onFreeze={decor.onFreeze}
                                                            onUnfreeze={decor.onUnfreeze}
                                                            onColor={decor.onColor}
                                                        />
                                                    )}
                                                </span>
                                                {onColumnSizingChange !== undefined && (
                                                    // Resize estilo Excel (paridad con el flat
                                                    // view): drag del borde derecho. El ancho es
                                                    // compartido — todos los buckets se alinean.
                                                    <div
                                                        onPointerDown={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            const startX = e.clientX;
                                                            const startW = w;
                                                            const move = (ev: PointerEvent): void => {
                                                                onColumnSizingChange({
                                                                    ...columnSizing,
                                                                    [c.id]: Math.min(800, Math.max(80, Math.round(startW + ev.clientX - startX))),
                                                                });
                                                            };
                                                            const up = (): void => {
                                                                window.removeEventListener('pointermove', move);
                                                                window.removeEventListener('pointerup', up);
                                                            };
                                                            window.addEventListener('pointermove', move);
                                                            window.addEventListener('pointerup', up);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="imcrm-absolute imcrm-right-0 imcrm-top-0 imcrm-z-20 imcrm-h-full imcrm-w-1 imcrm-cursor-col-resize imcrm-select-none imcrm-touch-none imcrm-bg-transparent group-hover/th:imcrm-bg-border hover:imcrm-bg-primary/60"
                                                        aria-hidden
                                                    />
                                                )}
                                            </th>
                                        );
                                    })}
                                    {/* v0.1.261 — relleno invisible; el "+" flota encima. */}
                                    {onAddColumn && <th aria-hidden className="imcrm-p-0" />}
                                </tr>
                            </thead>
                        </table>
                        </div>
                        {onAddColumn && <FloatingAddColumn onClick={onAddColumn} />}
                        </div>
                        <div
                            ref={bodyScrollRef}
                            className="imcrm-overflow-x-auto imcrm-native-hscroll-hidden focus-visible:imcrm-outline-none"
                            aria-label={__('Registros del grupo: usa las flechas para moverte, Mayús para elegir un rango y Ctrl+C o Ctrl+V para copiar y pegar')}
                            {...grid.containerProps}
                        >
                        <GridEditContext.Provider value={grid.editStore}>
                        <table className={tableClassName} style={tableStyle} aria-label={labelText}>
                            {colGroup}
                            <tbody>
                                {windowed.paddingTop > 0 && (
                                    <tr aria-hidden style={{ height: `${windowed.paddingTop}px` }}>
                                        <td colSpan={columns.length + (onAddColumn ? 2 : 1)} />
                                    </tr>
                                )}
                                {visibleRows.map(({ record, depth, index }) => {
                                    const isSelected = selectedSet.has(record.id);
                                    const colors = rowColors.get(record.id);
                                    return (
                                        <tr
                                            key={record.id}
                                            data-index={index}
                                            ref={windowed.active ? windowed.measureElement : undefined}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                const cell = grid.openContextMenu(e);
                                                setRowMenu({ record, x: e.clientX, y: e.clientY, cell });
                                            }}
                                            style={rowTintStyle(colors?.row ?? null)}
                                            className={cn(
                                                'imcrm-group/row',
                                                colors?.row && 'imcrm-tinted-row',
                                                isSelected
                                                    ? 'imcrm-bg-primary/5'
                                                    : 'hover:imcrm-bg-muted/40',
                                            )}
                                        >
                                            <td
                                                className="imcrm-w-7 imcrm-px-1.5 imcrm-py-2.5 imcrm-align-middle"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                              <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-items-center imcrm-justify-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleOne(record.id)}
                                                    className={cn(
                                                        'imcrm-h-3.5 imcrm-w-3.5 imcrm-cursor-pointer imcrm-rounded-[3px] imcrm-border-input imcrm-accent-primary imcrm-transition-opacity',
                                                        isSelected || selectedIds.length > 0
                                                            ? 'imcrm-opacity-100'
                                                            : 'imcrm-opacity-0 group-hover/row:imcrm-opacity-100 focus-visible:imcrm-opacity-100',
                                                    )}
                                                    aria-label={sprintf(
                                                        /* translators: %d id */
                                                        __('Seleccionar registro %d'),
                                                        record.id,
                                                    )}
                                                />
                                              </span>
                                            </td>
                                            {columns.map((c, ci) => {
                                                const w = columnSizing[c.id] ?? defaultSizeForColumn(c);
                                                const sticky = stickyFor(c.id);
                                                const shadows = grid.cellShadows(index, ci);
                                                const mark = grid.cellMark(index, ci);
                                                if (mark?.error) shadows.unshift(ERROR_CELL_SHADOW);
                                                const edge = edgeFor(c.id);
                                                if (edge) shadows.push(edge);
                                                const cellColor = c.field ? colors?.cells.get(c.field.id) : undefined;
                                                const hasHandle = grid.hasFillHandle(index, ci);
                                                return (
                                                    <td
                                                        key={c.id}
                                                        data-cell={`${index}:${ci}`}
                                                        data-active={grid.active?.row === index && grid.active.col === ci ? 'true' : undefined}
                                                        style={{
                                                            width: w,
                                                            maxWidth: w,
                                                            ...(sticky ?? {}),
                                                            ...(shadows.length > 0 ? { boxShadow: shadows.join(', ') } : {}),
                                                            ...cellTintStyle(cellColor),
                                                        }}
                                                        className={cn(
                                                            'imcrm-overflow-hidden imcrm-px-2 imcrm-py-2.5',
                                                            wrapText ? 'imcrm-align-top' : 'imcrm-align-middle',
                                                            sticky && (isSelected ? 'imcrm-sticky-cell imcrm-sticky-cell-selected' : 'imcrm-sticky-cell'),
                                                            (hasHandle || mark?.cut) && !sticky && 'imcrm-relative',
                                                            cellColor && 'imcrm-tinted-cell',
                                                            ci === 0 &&
                                                                onRowClick &&
                                                                'imcrm-cursor-pointer imcrm-font-medium',
                                                        )}
                                                        onClick={
                                                            ci === 0 && onRowClick
                                                                ? () => onRowClick(record)
                                                                : undefined
                                                        }
                                                        title={mark?.error}
                                                    >
                                                        {ci === 0 ? (
                                                            <RecordNameCell
                                                                record={record}
                                                                depth={depth}
                                                                expanded={expandedIds.includes(record.id)}
                                                                onToggle={() => toggleSubtasks(record.id)}
                                                            >
                                                                {renderColumnCell(c, record, listId, storeRules)}
                                                            </RecordNameCell>
                                                        ) : (
                                                            renderColumnCell(c, record, listId, storeRules)
                                                        )}
                                                        <CellMarkOverlay mark={mark} />
                                                        {hasHandle && (
                                                            <span
                                                                data-fill-handle
                                                                className="imcrm-fill-handle"
                                                                title={__('Arrastra para rellenar hacia abajo')}
                                                                onMouseDown={grid.onFillHandleMouseDown}
                                                            />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            {onAddColumn && (
                                        <td aria-hidden className="imcrm-p-0" />
                                    )}
                                        </tr>
                                    );
                                })}
                                {windowed.paddingBottom > 0 && (
                                    <tr aria-hidden style={{ height: `${windowed.paddingBottom}px` }}>
                                        <td colSpan={columns.length + (onAddColumn ? 2 : 1)} />
                                    </tr>
                                )}
                            </tbody>
                            {/* Footer unificado: "+ Agregar tarea" en la
                                primera columna dinámica + Calcular en
                                las demás (oculto hasta hover de la
                                fila). Igual que TableView flat. */}
                            {(onAddRecord || onFooterAggregatesChange) && (
                                <tfoot className="imcrm-group/footer">
                                    <tr>
                                        <td className="imcrm-w-7" />
                                        {columns.map((c, ci) => {
                                            const w = columnSizing[c.id] ?? defaultSizeForColumn(c);
                                            const isFirstDynamic = c.field !== null && firstDynamicIndex === ci;
                                            const sticky = stickyFor(c.id);

                                            // Primera columna dinámica → "+ Agregar tarea"
                                            if (isFirstDynamic && onAddRecord) {
                                                return (
                                                    <td
                                                        key={c.id}
                                                        style={{ width: w, maxWidth: w, ...(sticky ?? {}) }}
                                                        className={cn(
                                                            'imcrm-overflow-hidden imcrm-px-1 imcrm-py-1 imcrm-align-middle',
                                                            sticky && 'imcrm-bg-background',
                                                        )}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={onAddRecord}
                                                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted/40 hover:imcrm-text-foreground"
                                                        >
                                                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                                            {__('Agregar registro')}
                                                        </button>
                                                    </td>
                                                );
                                            }

                                            // Resto: Calcular dropdown si aplica.
                                            if (! onFooterAggregatesChange) {
                                                return (
                                                    <td
                                                        key={c.id}
                                                        style={{ width: w, maxWidth: w, ...(sticky ?? {}) }}
                                                        className={cn(sticky && 'imcrm-bg-background')}
                                                    />
                                                );
                                            }
                                            const agg = c.field !== null && aggregates.data
                                                ? aggregates.data.totals[c.field.slug]
                                                : undefined;
                                            const kind = (footerAggregates ?? {})[c.id] as AggregateKind | undefined;
                                            return (
                                                <td
                                                    key={c.id}
                                                    style={{ width: w, maxWidth: w, ...(sticky ?? {}) }}
                                                    className={cn(
                                                        'imcrm-overflow-hidden imcrm-px-1 imcrm-py-1 imcrm-align-middle',
                                                        sticky && 'imcrm-bg-background',
                                                    )}
                                                >
                                                    <FooterAggregateCell
                                                        field={c.field}
                                                        totalCount={total}
                                                        agg={agg}
                                                        kind={kind}
                                                        onChange={(nextKind) => {
                                                            const next = { ...(footerAggregates ?? {}) };
                                                            if (nextKind === undefined) {
                                                                delete next[c.id];
                                                            } else {
                                                                next[c.id] = nextKind;
                                                            }
                                                            onFooterAggregatesChange(next);
                                                        }}
                                                    />
                                                </td>
                                            );
                                        })}
                                        {onAddColumn && (
                                        <td aria-hidden className="imcrm-p-0" />
                                    )}
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                        </GridEditContext.Provider>
                        </div>
                        </div>
                    )}

                    {hasMore && (
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2">
                            <button
                                type="button"
                                onClick={() => setPage((p) => p + 1)}
                                className="imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                            >
                                {__('Cargar siguiente página')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Un fetcher por padre abierto: `useRecords` no puede
                llamarse dentro del map de filas. */}
            {expandedIds.map((pid) => (
                <SubtaskFetcher
                    key={pid}
                    listId={listId}
                    parentId={pid}
                    onLoaded={(rows) => setSubtasksByParent((prev) => ({ ...prev, [pid]: rows }))}
                />
            ))}

            <RecordRowMenu
                target={rowMenu}
                onClose={() => setRowMenu(null)}
                listId={listId}
                listSlug={listSlug ?? ''}
                fields={columns.map((c) => c.field).filter((f): f is FieldEntity => f !== null)}
                onOpen={(r) => {
                    setRowMenu(null);
                    onRowClick?.(r);
                }}
                onAddColumn={onAddColumn}
                onCreateSubtask={onCreateSubtask}
                canCreate={canCreateRecords}
                canDelete={canDeleteRecords}
                cellActions={grid.menu}
            />
            <GridOverlays grid={grid} />
        </section>
        </RelationTitlesContext.Provider>
    );
}

/**
 * El encabezado de un grupo (o subgrupo): chevron + chip con el valor (el
 * COLOR real de la opción en select/multi_select — un multi_select agrupa
 * por COMBINACIÓN, así que lleva un chip por opción) + el conteo. Queda fijo
 * bajo la cabecera de la página mientras se recorre su sección.
 */
const GroupHeaderButton = forwardRef<
    HTMLButtonElement,
    {
        field: FieldEntity;
        bucket: RecordGroupBucket;
        isOpen: boolean;
        onToggle: () => void;
        top: number;
        stuck: boolean;
        level: 0 | 1;
    }
>(function GroupHeaderButton({ field: rawField, bucket, isOpen, onToggle, top, stuck, level }, ref) {
    // C5 — el estado de la aprobación agrupa como una selección (chip con color).
    const field = rawField.type === 'approval' ? asDisplayField(rawField) : rawField;
    const labelText = formatBucketLabel(field, bucket.value);
    const fieldOptions = field.type === 'select' || field.type === 'multi_select' ? extractFieldOptions(field) : [];
    const multiValues = field.type === 'multi_select' ? parseMultiBucket(bucket.value) : null;
    const chipValues = multiValues !== null
        ? orderByCatalog(multiValues, fieldOptions)
        : bucket.value !== null ? [bucket.value] : [];
    const useOptionChip = field.type === 'select' || field.type === 'multi_select';
    const colorAccent = bucket.value === null ? 'imcrm-bg-muted' : 'imcrm-bg-primary/10';
    return (
        <button
            ref={ref}
            type="button"
            onClick={onToggle}
            data-testid={level === 1 ? 'imcrm-subgroup-header' : 'imcrm-group-header'}
            data-group-label={labelText}
            aria-expanded={isOpen}
            style={{ top }}
            className={cn(
                'imcrm-sticky imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-bg-background imcrm-text-left imcrm-transition-colors hover:imcrm-bg-muted/40',
                // El del subgrupo va por DEBAJO del de su grupo (que lo tapa
                // cuando la sección termina y se va).
                level === 1 ? 'imcrm-z-[29] imcrm-py-1.5 imcrm-pl-7 imcrm-pr-2' : 'imcrm-z-30 imcrm-px-2 imcrm-py-2',
                stuck && 'imcrm-rounded-none imcrm-shadow-[0_1px_0_hsl(var(--imcrm-border))]',
            )}
        >
            {isOpen ? (
                <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
            ) : (
                <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
            )}
            {level === 1 && (
                <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{field.label}</span>
            )}
            {field.type === 'team' && bucket.value !== null ? (
                <GroupTeamChips value={bucket.value} />
            ) : useOptionChip && bucket.value !== null ? (
                <span className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                    {chipValues.map((v) => (
                        <OptionChip
                            key={v}
                            opt={fieldOptions.find((o) => o.value === v)}
                            fallback={fieldOptions.find((o) => o.value === v)?.label ?? v}
                        />
                    ))}
                </span>
            ) : (
                <span
                    className={cn(
                        'imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold',
                        colorAccent,
                    )}
                >
                    {displayTypeOf(field.type) === 'user' && bucket.value !== null && /^[1-9]\d*$/.test(bucket.value) ? (
                        <GroupPersonName id={Number(bucket.value)} fallback={labelText} />
                    ) : (
                        labelText
                    )}
                </span>
            )}
            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(
                    /* translators: %d count */
                    _n('%d registro', '%d registros', bucket.count),
                    bucket.count,
                )}
            </span>
        </button>
    );
});

/**
 * v0.1.287 — Un grupo de primer nivel con subgrupos («Y luego por»): su
 * encabezado queda fijo mientras se recorren TODOS sus subgrupos, y cada
 * subgrupo (con su tabla, su conteo y su pie) se pega debajo.
 */
function ParentGroupSection({
    groupByField,
    bucket,
    isOpen,
    onToggle,
    children,
}: {
    groupByField: FieldEntity;
    bucket: RecordGroupBucket & { sub_buckets?: RecordGroupBucket[] };
    isOpen: boolean;
    onToggle: () => void;
    children: (headerHeight: number) => ReactNode;
}): JSX.Element {
    const stickyTop = usePageStickyTop();
    const [headerEl, setHeaderEl] = useState<HTMLButtonElement | null>(null);
    const headerHeight = useElementHeight(headerEl);
    const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
    const stuck = useStuckSentinel(sentinelEl, stickyTop);
    return (
        <section aria-expanded={isOpen} data-testid="imcrm-parent-group">
            <div ref={setSentinelEl} aria-hidden className="imcrm-h-px imcrm--mb-px" />
            <GroupHeaderButton
                ref={setHeaderEl}
                field={groupByField}
                bucket={bucket}
                isOpen={isOpen}
                onToggle={onToggle}
                top={stickyTop}
                stuck={stuck}
                level={0}
            />
            {isOpen && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pt-1">
                    {children(headerHeight)}
                </div>
            )}
        </section>
    );
}

/** v0.1.287 — ¿Es la clave local de un SUBGRUPO (`["v:a","v:b"]`)? */
function isPairKey(key: string): boolean {
    return key.startsWith('[');
}

function parsePairKey(key: string): [string, string] | null {
    try {
        const v: unknown = JSON.parse(key);
        return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string'
            ? [v[0], v[1]]
            : null;
    } catch {
        return null;
    }
}

/** Clave local de un subgrupo: el par de claves locales (grupo, subgrupo). */
function pairLocalKey(groupKey: string, subKey: string): string {
    return JSON.stringify([groupKey, subKey]);
}

/** Clave del par en `expanded` del bundle (la misma `subGroupPairKey` del backend). */
function subGroupPairRawKey(group: string | null, sub: string | null): string {
    return JSON.stringify([group ?? '__null__', sub ?? '__null__']);
}

function renderColumnCell(
    column: ColumnDef,
    record: RecordEntity,
    listId: number,
    storeRules: StoreRules | null,
): JSX.Element | null {
    if (column.id === 'id') {
        return (
            <span className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">
                #{record.id}
            </span>
        );
    }
    if (column.id === 'updated_at') {
        if (!record.updated_at) return null;
        return (
            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                {formatDateTimeStr(record.updated_at)}
            </span>
        );
    }
    if (column.field === null) {
        return null;
    }
    return (
        <EditableCell
            listId={listId}
            recordId={record.id}
            field={column.field}
            value={column.field.type === 'relation' ? record.relations?.[column.field.slug] : record.fields[column.field.slug]}
            lockedReason={lockedReasonOf(storeRules, column.field, record)}
            record={record}
        />
    );
}

function lockedReasonOf(rules: StoreRules | null, field: FieldEntity, record: RecordEntity): string | null {
    const access = storeAccessFor(rules, field, record);
    return access?.access === 'locked' ? access.reason : null;
}

function bucketKey(bucket: RecordGroupBucket): string {
    return bucket.value === null ? '__null__' : `v:${bucket.value}`;
}

/**
 * Key crudo del bucket para hablar con el backend (bundle endpoint).
 * Diferencia con `bucketKey`: este NO usa el prefijo `v:` — el backend
 * espera el valor crudo o `__null__` para null. La key local
 * (`bucketKey`) se sigue usando para `collapsedGroups`/`openLocally`
 * para preservar compat con saved views existentes.
 */
function bucketRawKey(bucket: RecordGroupBucket): string {
    return bucket.value === null ? '__null__' : bucket.value;
}

/** Key local (`v:valor` / `__null__`) → key cruda del backend. */
function localToRawKey(key: string): string {
    return key.startsWith('v:') ? key.slice(2) : key;
}

/**
 * Para reportar correctamente el filtro al backend cuando el usuario
 * expande un bucket: `multi_select` necesita `contains` (la columna es
 * un JSON array y `eq` nunca matchearía un valor individual). Los demás
 * tipos van con `eq`. Un bucket con `value=null` se traduce a
 * `is_null`.
 */
function filterOpForBucket(
    type: string,
    value: string | null,
): { op: FilterOperator; value: unknown } {
    if (value === null) {
        return { op: 'is_null', value: true };
    }
    if (type === 'team') {
        // C1 — el grupo es el conjunto de equipos (`[3, 7]`): igualdad de
        // conjunto, como la combinación del multi_select.
        const ids = parseTeamGroupKey(value);
        return ids.length > 0 ? { op: 'eq', value: ids } : { op: 'is_null', value: true };
    }
    if (type === 'multi_select') {
        // v0.1.190 — el grupo es la combinación exacta: `eq` con el array
        // compila a igualdad de conjunto en el backend.
        const set = parseMultiBucket(value);
        return set !== null ? { op: 'eq', value: set } : { op: 'contains', value };
    }
    return { op: 'eq', value };
}

/**
 * Etiqueta visible del bucket. Para `user` resolvería el display name
 * idealmente, pero aún no tenemos hook de users — mostramos el id por
 * ahora. Iteraremos.
 */
function formatBucketLabel(field: FieldEntity, value: string | null): string {
    if (value === null) return __('(Sin valor)');
    // v0.1.200 — un derivado se agrupa por su valor como texto; la etiqueta
    // se formatea con el campo del OTRO lado (moneda con sus decimales, la
    // etiqueta de la opción, la fecha en el formato de la empresa), que es
    // exactamente lo que muestra la celda.
    if (field.type === 'rollup') return formatBucketLabel(rollupDisplayField(field), value);
    // Fórmulas (A1): como el tipo de su resultado (sí/no, fecha…).
    // C5 — la aprobación como selección; A9 — el progreso del checklist como porcentaje.
    if (field.type === 'formula' || field.type === 'approval' || field.type === 'checklist_progress') {
        return formatBucketLabel(asDisplayField(field), value);
    }
    // v0.1.291 — el tiempo registrado agrupa por minutos: se lee como duración.
    if (field.type === 'time_tracked') {
        const n = Number(value);
        return Number.isFinite(n) ? formatDuration(n) || '0m' : value;
    }
    if (field.type === 'lookup') {
        const display = lookupDisplayField(field);
        if (!display) return value;
        // El backend une los vinculados con ", " — se formatea cada uno.
        return value
            .split(', ')
            .map((v) => formatBucketLabel(display, v))
            .join(', ');
    }
    if (field.type === 'checkbox') {
        return value === '1' || value === 'true' ? __('Sí') : __('No');
    }
    // C1 — el nombre de cada equipo lo pone el encabezado (`GroupTeamChips`);
    // esto es el texto accesible de respaldo.
    if (field.type === 'team') {
        const ids = parseTeamGroupKey(value);
        return ids.length === 0 ? __('(Sin valor)') : ids.map((id) => sprintf(__('Equipo %d'), id)).join(' + ');
    }
    // v0.1.300 — «Creado/Modificado por»: el 0 es un cambio del sistema
    // (automatización, sincronización); el resto, la persona (ver GroupPersonName).
    if ((field.type === 'created_by' || field.type === 'updated_by') && value === '0') return __('Sistema');
    if (field.type === 'select' || field.type === 'multi_select') {
        // Buscar label en field.config.options
        const options = (field.config as { options?: Array<{ value: string; label: string }> })
            .options;
        const labelOf = (v: string): string =>
            (Array.isArray(options) ? options.find((o) => o.value === v)?.label : undefined) ?? v;
        // v0.1.190 — multi_select: la combinación, etiquetas unidas.
        const set = field.type === 'multi_select' ? parseMultiBucket(value) : null;
        if (set !== null) return orderByCatalog(set, Array.isArray(options) ? options : []).map(labelOf).join(' + ');
        return labelOf(value);
    }
    // v0.1.300 — las fechas de sistema agrupan por día (en la zona de la empresa).
    if (displayTypeOf(field.type) === 'date' || displayTypeOf(field.type) === 'datetime') {
        // Etiqueta del grupo: solo la fecha, en el orden del workspace.
        return formatDateStr(value);
    }
    return value;
}

/** C1 — Los chips de los equipos de un grupo (`[3, 7]`), con su icono y color. */
function GroupTeamChips({ value }: { value: string }): JSX.Element {
    const { map: teams, loaded } = useTeamDirectory();
    const ids = parseTeamGroupKey(value);
    return <TeamChips ids={ids} teams={teams} known={loaded} wrap />;
}

/** v0.1.300 — Nombre de la persona del grupo (campo persona o «Creado/Modificado por»). */
function GroupPersonName({ id, fallback }: { id: number; fallback: string }): JSX.Element {
    const user = useWpUser(id > 0 ? id : null);
    return <>{user.data?.display_name || fallback}</>;
}

export { renderCellValue };

/**
 * v0.1.224 — memoizada: la página se re-dibuja con cada letra del buscador
 * (el input vive ahí), y sin esto cada letra re-dibujaba todas las filas de
 * todos los grupos. Los callbacks que recibe son de identidad estable
 * (`useEventCallback` en RecordsPage), así que sólo se re-dibuja cuando
 * cambian sus datos.
 */
export const GroupedTableView = memo(GroupedTableViewImpl);
