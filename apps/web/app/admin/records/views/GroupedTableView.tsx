import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Inbox, KeyRound, Loader2, Plus } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { useAggregates, type AggregatesResponse } from '@/hooks/useAggregates';
import { useRecords, useRecordsGroupedBundle } from '@/hooks/useRecords';
import { RecurrencesBatchProvider } from '@/hooks/useRecurrences';
import { __, sprintf } from '@/lib/i18n';
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
import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { OptionChip, renderCellValue } from '@/admin/records/renderCellValue';
import { addNode, isFlatAndTree } from '@/admin/records/filterTree';
import { FooterAggregateCell, type AggregateKind } from './FooterAggregateCell';

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
    columnSizing?: Record<string, number>;
    /**
     * Orden custom del flat view (column ids). Si está vacío, usamos
     * `field.position`. Sin esto el user perdía su reordenamiento al
     * agrupar.
     */
    columnOrder?: string[];
    /**
     * Set de bucket keys colapsadas (persistido en el saved view).
     * Si un bucket NO está acá, está expandido. Por defecto array
     * vacío = todos expandidos.
     */
    collapsedGroups?: string[];
    onCollapsedGroupsChange?: (next: string[]) => void;
    /** Click "+ Agregar columna" en el header del primer bucket. */
    onAddColumn?: () => void;
    /**
     * Click "+ Agregar tarea" al pie de un bucket. Recibe el field
     * de agrupación y el `value` del bucket para que el caller pueda
     * pre-rellenar el form de creación.
     */
    onAddRecord?: (groupByField: FieldEntity, bucketValue: string | null) => void;
    /**
     * Cálculos opt-in del footer por columna (compartidos entre
     * todos los buckets, igual que ClickUp). Si está vacío o sin
     * `onFooterAggregatesChange`, no se renderea el footer.
     */
    footerAggregates?: Record<string, string>;
    onFooterAggregatesChange?: (next: Record<string, string>) => void;
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
export function GroupedTableView({
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
    columnSizing,
    columnOrder,
    collapsedGroups,
    onCollapsedGroupsChange,
    onAddColumn,
    onAddRecord,
    footerAggregates,
    onFooterAggregatesChange,
}: GroupedTableViewProps): JSX.Element {
    const filterTreeParam = useMemo(
        () => (filterTree.children.length === 0 ? undefined : filterTree),
        [filterTree],
    );

    // `collapsedGroups` (del saved view) lista keys CERRADOS. Un bucket
    // que NO está acá se considera abierto por default. `openLocally`
    // overridea por sesión (sin re-guardar el saved view).
    const collapsedSet = useMemo(
        () => new Set(collapsedGroups ?? []),
        [collapsedGroups],
    );
    const [openLocally, setOpenLocally] = useState<Set<string>>(new Set());

    const isOpen = (key: string): boolean => {
        if (openLocally.has(key)) return true;
        return ! collapsedSet.has(key);
    };

    // Field ids que tienen sentido para aggregates (el resto los
    // omite el backend). Se calcula una vez para toda la vista —
    // todos los buckets agregan las mismas columnas.
    const aggregateFieldIds = useMemo(
        () => fields
            .filter((f) => f.type !== 'relation' && f.type !== 'computed')
            .map((f) => f.id),
        [fields],
    );

    // Bundle endpoint: una sola request reemplaza el patrón antiguo
    // (1 + N + N) de groups + records-por-bucket + aggregates-por-
    // bucket. La lista `expanded` se deriva en dos fases:
    //   1) Primer render: empty → bundle solo trae buckets meta.
    //   2) useEffect ve los buckets, calcula los abiertos, setea
    //      `pendingExpanded` → bundle refetcha con expanded completo.
    // `keepPreviousData` mantiene UI estable mientras la 2da pasada
    // está en vuelo.
    const [pendingExpanded, setPendingExpanded] = useState<string[]>([]);
    const bundle = useRecordsGroupedBundle({
        listId,
        groupBy: groupByField.id,
        expanded: pendingExpanded,
        filterTree: filterTreeParam,
        search,
        aggregateFieldIds,
    });

    const buckets = bundle.data?.buckets ?? [];
    const expandedMap = bundle.data?.expanded ?? {};

    useEffect(() => {
        if (! bundle.data) return;
        const next = buckets
            .filter((b) => isOpen(bucketKey(b)))
            .map((b) => bucketRawKey(b));
        // Cambia → setPending. Comparación shallow ordenada (el hook
        // ordena `expanded` antes del fetch, así que el orden no
        // afecta el cache; pero igual evitamos setState innecesario).
        let changed = next.length !== pendingExpanded.length;
        if (! changed) {
            for (let i = 0; i < next.length; i++) {
                if (next[i] !== pendingExpanded[i]) {
                    changed = true;
                    break;
                }
            }
        }
        if (changed) setPendingExpanded(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bundle.data, openLocally, collapsedSet]);

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
        if (onAddColumn !== undefined) total += 48; // add-col
        return total;
    }, [visibleColumns, columnSizing, onAddColumn]);

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
    // returns) por la regla de hooks. Acá solo lo usamos.

    return (
        <RecurrencesBatchProvider listId={listId} recordIds={allVisibleRecordIds}>
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-text-xs imcrm-text-muted-foreground">
                <span>
                    {sprintf(
                        /* translators: %1$d total groups, %2$d total records */
                        __('%1$d grupos · %2$d registros'),
                        bundle.data?.meta.total_groups ?? 0,
                        bundle.data?.meta.total_records ?? 0,
                    )}
                </span>
            </div>

            {/* Scroll horizontal único compartido entre todos los
                buckets — sin esto cada bucket tenía su propio
                overflow-x-auto y las columnas no quedaban alineadas
                verticalmente entre grupos al scrollear. Ahora el outer
                div es el contenedor de scroll; cada `<section>` adentro
                tiene `min-width: tableWidth` para que todos midan
                igual. Sticky-left funciona contra este outer div.

                `max-h: calc(100vh - 220px)` mantiene el scroll DENTRO
                de este wrapper, así la barra horizontal queda al fondo
                del viewport en lugar de al fondo de la página. */}
            <div className="imcrm-overflow-auto imcrm-max-h-[calc(100vh-220px)] imcrm-pb-2">
                <div
                    className="imcrm-flex imcrm-flex-col imcrm-gap-3"
                    style={{ minWidth: tableWidth }}
                >
                    {buckets.map((bucket, idx) => {
                        const key = bucketKey(bucket);
                        const rawKey = bucketRawKey(bucket);
                        const prefetched = expandedMap[rawKey];
                        return (
                            <GroupBucketSection
                                key={key}
                                listId={listId}
                                listSlug={listSlug}
                                groupByField={groupByField}
                                bucket={bucket}
                                isOpen={isOpen(key)}
                                onToggle={() => toggleGroup(key)}
                                columns={visibleColumns}
                                columnSizing={columnSizing ?? {}}
                                tableWidth={tableWidth}
                                baseTree={filterTree}
                                search={search}
                                selectedIds={selectedIds}
                                onSelectionChange={onSelectionChange}
                                onRowClick={onRowClick}
                                prefetchedRecords={prefetched?.records}
                                prefetchedAggregates={prefetched?.aggregates}
                                bundleFetching={bundle.isFetching}
                                aggregateFieldIds={aggregateFieldIds}
                                // El "+" de agregar columna solo se muestra
                                // en el header del PRIMER bucket — sino sale
                                // duplicado en cada grupo. UX consistent con
                                // el flat view (un solo trigger).
                                onAddColumn={idx === 0 ? onAddColumn : undefined}
                                onAddRecord={
                                    onAddRecord
                                        ? () => onAddRecord(groupByField, bucket.value)
                                        : undefined
                                }
                                footerAggregates={footerAggregates}
                                onFooterAggregatesChange={onFooterAggregatesChange}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
        </RecurrencesBatchProvider>
    );
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

function buildColumns(fields: FieldEntity[]): ColumnDef[] {
    const dynamic = fields
        .filter((f) => f.type !== 'relation')
        .sort((a, b) => a.position - b.position)
        .map<ColumnDef>((f) => ({
            id: f.slug,
            label: f.label,
            field: f,
            isPrimary: f.is_primary,
        }));
    return [
        { id: 'id', label: __('ID'), field: null, isPrimary: false },
        ...dynamic,
        { id: 'updated_at', label: __('Actualizado'), field: null, isPrimary: false },
    ];
}

interface GroupBucketSectionProps {
    listId: number;
    listSlug?: string;
    groupByField: FieldEntity;
    bucket: RecordGroupBucket;
    isOpen: boolean;
    onToggle: () => void;
    columns: ColumnDef[];
    columnSizing: Record<string, number>;
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
    onAddRecord?: () => void;
    footerAggregates?: Record<string, string>;
    onFooterAggregatesChange?: (next: Record<string, string>) => void;
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
    isOpen,
    onToggle,
    columns,
    columnSizing,
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
    onAddRecord,
    footerAggregates,
    onFooterAggregatesChange,
}: GroupBucketSectionProps): JSX.Element {
    const [page, setPage] = useState(1);
    const perPage = 50;

    // Filter tree del bucket: árbol base + condición `groupByField op
    // value`. Solo se usa para fallback (page > 1 o cuando el bundle
    // no incluyó este bucket por algún motivo).
    const bucketTree: FilterTree = useMemo(() => {
        const op = filterOpForBucket(groupByField.type, bucket.value);
        const cond: FilterCondition = {
            type: 'condition',
            field_id: groupByField.id,
            op: op.op,
            value: op.value,
        };
        return addNode(baseTree, [], cond);
    }, [baseTree, groupByField.id, groupByField.type, bucket.value]);

    // Page 1 viene del bundle; page > 1 cae al `useRecords` clásico.
    // Esto evita que el componente reviente cuando el user paginea
    // dentro de un bucket grande, sin perder el beneficio del bundle
    // para el caso común.
    const usePrefetched = isOpen && page === 1 && prefetchedRecords !== undefined;
    const useAggregatesPrefetched = isOpen && prefetchedAggregates !== undefined;

    const fallbackQuery: RecordsQuery = useMemo(() => {
        const q: RecordsQuery = { page, per_page: perPage };
        if (isFlatAndTree(bucketTree)) {
            const filter: NonNullable<RecordsQuery['filter']> = {};
            for (const c of bucketTree.children) {
                if (c.type !== 'condition') continue;
                const key = `field_${c.field_id}`;
                const existing = (filter[key] as Partial<Record<FilterOperator, unknown>> | undefined) ?? {};
                existing[c.op] = c.value;
                filter[key] = existing;
            }
            q.filter = filter;
        } else {
            q.filter_tree = JSON.stringify(bucketTree);
        }
        if (search.trim() !== '') q.search = search.trim();
        return q;
    }, [bucketTree, page, search]);

    const fallbackEnabled = isOpen && ! usePrefetched;
    const fallbackRecords = useRecords(fallbackEnabled ? listId : undefined, fallbackQuery);

    const fallbackAggregates = useAggregates({
        listSlug: useAggregatesPrefetched ? undefined : (isOpen ? listSlug : undefined),
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

    const aggregates: { data: AggregatesResponse | undefined } = useAggregatesPrefetched
        ? { data: prefetchedAggregates }
        : { data: fallbackAggregates.data };

    const labelText = formatBucketLabel(groupByField, bucket.value);
    // Header chip: cuando el campo agrupado es select/multi_select y el
    // bucket matchea una opción declarada, el chip usa el COLOR real de
    // la opción (mismo render que las celdas — estilo ClickUp). Para el
    // resto de tipos (texto, fecha, etc.) cae al chip genérico.
    const bucketOption = bucket.value !== null
        && (groupByField.type === 'select' || groupByField.type === 'multi_select')
        ? extractFieldOptions(groupByField).find((o) => o.value === bucket.value)
        : undefined;
    const useOptionChip = groupByField.type === 'select' || groupByField.type === 'multi_select';
    const colorAccent = bucket.value === null ? 'imcrm-bg-muted' : 'imcrm-bg-primary/10';

    const allRecordsSelected =
        records.data?.data.every((r) => selectedIds.includes(r.id)) ?? false;
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

    return (
        <section
            // Grupo PLANO (estilo ClickUp): sin card (border/rounded/
            // shadow/bg-card) alrededor — header del grupo (chip +
            // contador) directo sobre el canvas, filas debajo separadas
            // por hairlines. OJO: tampoco usar `overflow-hidden` acá —
            // rompe `position: sticky` de las celdas internas (crea un
            // containing block para el sticky que NO scrollea).
            aria-expanded={isOpen}
        >
            <button
                type="button"
                onClick={onToggle}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-px-2 imcrm-py-2 imcrm-text-left imcrm-transition-colors hover:imcrm-bg-muted/40"
            >
                {isOpen ? (
                    <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                ) : (
                    <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                )}
                {useOptionChip && bucket.value !== null ? (
                    <OptionChip opt={bucketOption} fallback={labelText} />
                ) : (
                    <span
                        className={cn(
                            'imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold',
                            colorAccent,
                        )}
                    >
                        {labelText}
                    </span>
                )}
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {bucket.count === 1
                        ? __('1 registro')
                        : sprintf(
                              /* translators: %d count */
                              __('%d registros'),
                              bucket.count,
                          )}
                </span>
            </button>

            {isOpen && (
                // Sin `overflow-x-auto` aquí — el scroll horizontal es
                // del wrapper exterior compartido entre todos los
                // buckets (single-scroll ClickUp-style).
                <div className="imcrm-border-t imcrm-border-border">
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
                        <table
                            className="imcrm-w-full imcrm-text-sm"
                            // `width: 100%` + `minWidth: tableWidth`: la tabla
                            // llena el contenedor (sin vacío a la derecha) y
                            // todos los buckets comparten el mismo min-width
                            // para que las columnas queden alineadas.
                            style={{ tableLayout: 'fixed', width: '100%', minWidth: tableWidth }}
                            aria-label={labelText}
                        >
                            <thead>
                                <tr className="imcrm-border-b imcrm-border-border">
                                    <th
                                        scope="col"
                                        className="imcrm-w-10 imcrm-px-3 imcrm-py-2"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={allRecordsSelected}
                                            onChange={toggleAllInGroup}
                                            aria-label={__('Seleccionar todos en grupo')}
                                        />
                                    </th>
                                    {columns.map((c, ci) => {
                                        const w = columnSizing[c.id] ?? defaultSizeForColumn(c);
                                        // Sticky-left: primera columna dinámica (la
                                        // que tiene `field !== null`). UX igual a
                                        // ClickUp — el "Nombre" se queda fijo,
                                        // checkbox no.
                                        const isFirstDynamic = c.field !== null
                                            && columns.findIndex((cc) => cc.field !== null) === ci;
                                        const sticky = isFirstDynamic
                                            ? { position: 'sticky' as const, left: 0, zIndex: 1 }
                                            : undefined;
                                        return (
                                            <th
                                                key={c.id}
                                                scope="col"
                                                style={{ width: w, minWidth: w, ...(sticky ?? {}) }}
                                                className={cn(
                                                    'imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground imcrm-uppercase imcrm-tracking-[0.06em]',
                                                    // Sticky cell necesita bg sólido para
                                                    // tapar las celdas al scrollear
                                                    // horizontal — canvas, no card.
                                                    sticky && 'imcrm-bg-canvas',
                                                )}
                                            >
                                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                                    {c.isPrimary && (
                                                        <KeyRound
                                                            className="imcrm-h-3 imcrm-w-3 imcrm-text-primary"
                                                            aria-hidden="true"
                                                        />
                                                    )}
                                                    {c.label}
                                                </span>
                                            </th>
                                        );
                                    })}
                                    {onAddColumn && (
                                        <th
                                            scope="col"
                                            className="imcrm-w-12 imcrm-px-2 imcrm-py-2"
                                        >
                                            <button
                                                type="button"
                                                onClick={onAddColumn}
                                                className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-text-muted-foreground hover:imcrm-border-primary hover:imcrm-bg-primary/10 hover:imcrm-text-primary"
                                                title={__('Agregar columna')}
                                                aria-label={__('Agregar columna')}
                                            >
                                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </button>
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {(records.data?.data ?? []).map((record) => {
                                    const isSelected = selectedSet.has(record.id);
                                    return (
                                        <tr
                                            key={record.id}
                                            className={cn(
                                                'imcrm-group/row imcrm-border-t imcrm-border-border/50',
                                                isSelected
                                                    ? 'imcrm-bg-primary/5'
                                                    : 'hover:imcrm-bg-muted/40',
                                            )}
                                        >
                                            <td
                                                className="imcrm-w-10 imcrm-px-3 imcrm-py-2.5 imcrm-align-middle"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleOne(record.id)}
                                                    aria-label={sprintf(
                                                        /* translators: %d id */
                                                        __('Seleccionar registro %d'),
                                                        record.id,
                                                    )}
                                                />
                                            </td>
                                            {columns.map((c, ci) => {
                                                const w = columnSizing[c.id] ?? defaultSizeForColumn(c);
                                                const isFirstDynamic = c.field !== null
                                                    && columns.findIndex((cc) => cc.field !== null) === ci;
                                                const sticky = isFirstDynamic
                                                    ? { position: 'sticky' as const, left: 0, zIndex: 1 }
                                                    : undefined;
                                                return (
                                                    <td
                                                        key={c.id}
                                                        style={{ width: w, maxWidth: w, ...(sticky ?? {}) }}
                                                        className={cn(
                                                            'imcrm-overflow-hidden imcrm-px-3 imcrm-py-2.5 imcrm-align-middle',
                                                            sticky && (isSelected
                                                                ? 'imcrm-bg-primary/5'
                                                                : 'imcrm-bg-canvas group-hover/row:imcrm-bg-muted/40'),
                                                            ci === 0 &&
                                                                onRowClick &&
                                                                'imcrm-cursor-pointer imcrm-font-medium',
                                                        )}
                                                        onClick={
                                                            ci === 0 && onRowClick
                                                                ? () => onRowClick(record)
                                                                : undefined
                                                        }
                                                    >
                                                        {renderColumnCell(c, record, listId)}
                                                    </td>
                                                );
                                            })}
                                            {onAddColumn && <td className="imcrm-w-12" />}
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {/* Footer unificado: "+ Agregar tarea" en la
                                primera columna dinámica + Calcular en
                                las demás (oculto hasta hover de la
                                fila). Igual que TableView flat. */}
                            {(onAddRecord || onFooterAggregatesChange) && (
                                <tfoot className="imcrm-group/footer">
                                    <tr className="imcrm-border-t imcrm-border-border/50">
                                        <td className="imcrm-w-10" />
                                        {columns.map((c, ci) => {
                                            const w = columnSizing[c.id] ?? defaultSizeForColumn(c);
                                            const isFirstDynamic = c.field !== null
                                                && columns.findIndex((cc) => cc.field !== null) === ci;
                                            const sticky = isFirstDynamic
                                                ? { position: 'sticky' as const, left: 0, zIndex: 1 }
                                                : undefined;

                                            // Primera columna dinámica → "+ Agregar tarea"
                                            if (isFirstDynamic && onAddRecord) {
                                                return (
                                                    <td
                                                        key={c.id}
                                                        style={{ width: w, maxWidth: w, ...(sticky ?? {}) }}
                                                        className={cn(
                                                            'imcrm-overflow-hidden imcrm-px-1 imcrm-py-1 imcrm-align-middle',
                                                            sticky && 'imcrm-bg-canvas',
                                                        )}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={onAddRecord}
                                                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted/40 hover:imcrm-text-foreground"
                                                        >
                                                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                                            {__('Agregar tarea')}
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
                                                        className={cn(sticky && 'imcrm-bg-canvas')}
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
                                                        sticky && 'imcrm-bg-canvas',
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
                                        {onAddColumn && <td className="imcrm-w-12" />}
                                    </tr>
                                </tfoot>
                            )}
                        </table>
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
        </section>
    );
}

function renderColumnCell(
    column: ColumnDef,
    record: RecordEntity,
    listId: number,
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
        const d = new Date(record.updated_at + 'Z');
        return (
            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                {d.toLocaleString()}
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
            value={record.fields[column.field.slug]}
        />
    );
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
    if (type === 'multi_select') {
        return { op: 'contains', value };
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
    if (field.type === 'checkbox') {
        return value === '1' || value === 'true' ? __('Sí') : __('No');
    }
    if (field.type === 'select' || field.type === 'multi_select') {
        // Buscar label en field.config.options
        const options = (field.config as { options?: Array<{ value: string; label: string }> })
            .options;
        if (Array.isArray(options)) {
            const match = options.find((o) => o.value === value);
            if (match) return match.label;
        }
        return value;
    }
    if (field.type === 'date' || field.type === 'datetime') {
        const d = new Date(field.type === 'date' ? value : value + 'Z');
        if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
        return value;
    }
    return value;
}

export { renderCellValue };
