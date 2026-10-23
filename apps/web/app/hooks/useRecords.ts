import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AggregatesResponse } from '@/hooks/useAggregates';
import { activityKeys } from '@/hooks/useActivity';
import { fieldHistoryKeys } from './fieldHistoryKeys';
import { listsKeys } from '@/hooks/useLists';
import type { ListSummary } from '@/types/list';
import type {
    RecordEntity,
    RecordGroupBucket,
    RecordGroupsResponse,
    RecordListResponse,
    RecordsQuery,
} from '@/types/record';

/**
 * 0.57.41 — set de identificadores (id numérico + slug) que pueden
 * estar en uso como segundo segmento de las queryKeys de records,
 * fields o views para UNA misma lista.
 *
 * Las queries se registran con el `listKey` que les pasó el caller —
 * algunas usan el id numérico (mutaciones, dialogs viejos), otras
 * usan el slug (RecordsPage desde 0.57.5). Para invalidar de forma
 * precisa miramos el cache de `useLists()` y mapeamos `idOrSlug` a
 * sus dos formas.
 *
 * Si no hay cache (raro: primer load sin lista cargada), devolvemos
 * sólo el identificador conocido — el peor caso es no invalidar una
 * key alternativa, pero la mutación ya aplicó su optimistic update.
 */
/**
 * v0.1.253 — cambios de registros hechos DESDE esta pestaña. Al editar una
 * celda, la mutación ya refresca la lista; segundos después llega por el
 * socket el aviso de ESE MISMO cambio y la refrescaba otra vez (dos GET de 200
 * filas por cada edición). El realtime saltea una lista que esta pestaña acaba
 * de refrescar.
 */
const recentLocalChanges = new Map<string, number>();
const LOCAL_ECHO_WINDOW_MS = 2500;

export function markLocalRecordsChange(qc: QueryClient, listId: string | number): void {
    const now = Date.now();
    for (const id of listIdentifiersFor(qc, listId)) recentLocalChanges.set(id, now);
}

export function isRecentLocalRecordsChange(listId: string | number): boolean {
    const t = recentLocalChanges.get(String(listId));
    return t !== undefined && Date.now() - t < LOCAL_ECHO_WINDOW_MS;
}

export function listIdentifiersFor(
    qc: QueryClient,
    idOrSlug: string | number,
): Set<string> {
    const out = new Set<string>([String(idOrSlug)]);
    const all = qc.getQueryData<ListSummary[]>(listsKeys.list());
    if (! Array.isArray(all)) return out;
    const asStr = String(idOrSlug);
    const match = all.find((l) => l.slug === asStr || String(l.id) === asStr);
    if (match) {
        out.add(String(match.id));
        out.add(match.slug);
    }
    return out;
}

/**
 * Resuelve `idOrSlug` al ID NUMÉRICO canónico vía el cache de listas (regla de
 * oro nº 7 / PERF-06). Todas las query keys deben usar el id numérico para que
 * la misma lista no se cachee dos veces (bajo su slug y bajo su id) → menos
 * fetches duplicados y cache misses al navegar. Si el cache de listas aún no
 * cargó (primer load raro), cae al identificador dado.
 */
export function canonicalListId(qc: QueryClient, idOrSlug: string | number): string {
    const asStr = String(idOrSlug);
    const all = qc.getQueryData<ListSummary[]>(listsKeys.list());
    if (Array.isArray(all)) {
        const match = all.find((l) => l.slug === asStr || String(l.id) === asStr);
        if (match) return String(match.id);
    }
    return asStr;
}

/**
 * v0.1.286 — `placeholderData` que conserva lo anterior SÓLO dentro de la
 * MISMA lista (paginar, filtrar, buscar). Con `keepPreviousData` a secas, al
 * pasar de una lista a otra la tabla mostraba un instante las filas de la
 * anterior con el id de la nueva, y las recurrencias se pedían como
 * `/lists/30/recurrences?ids=144,147` (ids de la lista de antes). El
 * identificador de la lista va en el índice 1 de la key (slug o id: se
 * comparan por el par id↔slug del índice de listas).
 */
export function keepPreviousForList<T>(qc: QueryClient, listKey: string | number) {
    return (prev: T | undefined, prevQuery: { queryKey: readonly unknown[] } | undefined): T | undefined => {
        if (prev === undefined || !prevQuery) return undefined;
        const prevList = prevQuery.queryKey[1];
        if (prevList === undefined) return undefined;
        return listIdentifiersFor(qc, listKey).has(String(prevList)) ? prev : undefined;
    };
}

/**
 * v0.1.286 — Regla de oro nº 7 en el arranque en frío: mientras el índice de
 * listas no llegó, la key se arma con el slug; cuando llega, pasa al id. Si la
 * query del slug seguía EN VUELO, la del id salía a pedir lo mismo otra vez
 * (2× `GET /lists/<slug>/fields`). Aquí la query canónica se ENGANCHA a la que
 * ya está en vuelo con el identificador crudo en vez de duplicarla.
 */
export function joinInflight<T>(
    qc: QueryClient,
    canonicalKey: readonly unknown[],
    rawKey: readonly unknown[],
    fetcher: () => Promise<T>,
): Promise<T> {
    const same = canonicalKey.length === rawKey.length && canonicalKey.every((k, i) => k === rawKey[i]);
    if (!same && qc.getQueryState(rawKey)?.fetchStatus === 'fetching') {
        // fetchQuery sobre una query en vuelo devuelve SU promesa (sin request nueva).
        return qc.fetchQuery({ queryKey: rawKey, queryFn: fetcher });
    }
    return fetcher();
}

/**
 * Predicate para invalidar SÓLO las queries de records/fields/views
 * de la lista indicada. Antes invalidábamos `keys.all` por miedo a
 * no matchear el slug — ahora mapeamos id↔slug vía el cache de lists.
 *
 * Resultado: una mutación en la lista A no marca stale las queries
 * cacheadas de la lista B, eliminando los refetches en cascada
 * cuando el usuario navega entre listas.
 */
export function invalidateForList(
    qc: QueryClient,
    namespace: readonly unknown[],
    listKey: string | number,
): void {
    const ids = listIdentifiersFor(qc, listKey);
    // v0.1.286 — los totales del pie (`['aggregates', id, …]`) dependen de los
    // registros: cualquier cambio de registros los refresca también. Antes no
    // se invalidaban nunca (alta, edición, borrado, import, realtime) y el pie
    // quedaba viejo hasta 30 s.
    const namespaces = namespace[0] === 'records' ? new Set<unknown>(['records', AGGREGATES_NS]) : new Set([namespace[0]]);
    void qc.invalidateQueries({
        predicate: (q) => {
            const k = q.queryKey;
            if (! Array.isArray(k) || k.length < 2) return false;
            if (! namespaces.has(k[0])) return false;
            return typeof k[1] === 'string' && ids.has(k[1]);
        },
    });
}

/** Primer segmento de las keys del pie de la tabla (ver `useAggregates`). */
export const AGGREGATES_NS = 'aggregates';

/**
 * v0.1.286 — aplica `patch` a un registro en TODAS las formas de cache de una
 * lista: el listado plano (`{data: [...]}`) y el bundle agrupado
 * (`{expanded: {k: {records: {data}}}}`). Devuelve el dato nuevo o `undefined`
 * si el registro no estaba ahí.
 */
export function patchRecordInCache(
    data: unknown,
    id: number,
    patch: (rec: RecordEntity) => RecordEntity,
): unknown {
    if (! data || typeof data !== 'object') return undefined;
    const list = data as RecordListResponse;
    if (Array.isArray(list.data)) {
        if (! list.data.some((r) => r.id === id)) return undefined;
        return { ...list, data: list.data.map((r) => (r.id === id ? patch(r) : r)) };
    }
    const bundle = data as Partial<GroupedBundleResponse>;
    if (bundle.expanded && typeof bundle.expanded === 'object') {
        let touched = false;
        const expanded: GroupedBundleResponse['expanded'] = {};
        for (const [k, entry] of Object.entries(bundle.expanded)) {
            const rows = entry.records?.data;
            if (Array.isArray(rows) && rows.some((r) => r.id === id)) {
                touched = true;
                expanded[k] = { ...entry, records: { ...entry.records, data: rows.map((r) => (r.id === id ? patch(r) : r)) } };
            } else {
                expanded[k] = entry;
            }
        }
        return touched ? { ...bundle, expanded } : undefined;
    }
    // B4 — bundle del calendario (`{records: [...]}`) y las páginas de la agenda
    // (`{pages: [{records}]}`): el evento arrastrado se ve en su lugar nuevo al
    // instante (se reubica solo al recalcular su fecha).
    const cal = data as { records?: RecordEntity[]; pages?: Array<{ records?: RecordEntity[] }> };
    if (Array.isArray(cal.records)) {
        if (! cal.records.some((r) => r.id === id)) return undefined;
        return { ...cal, records: cal.records.map((r) => (r.id === id ? patch(r) : r)) };
    }
    if (Array.isArray(cal.pages) && cal.pages.every((p) => p && Array.isArray(p.records))) {
        if (! cal.pages.some((p) => p.records!.some((r) => r.id === id))) return undefined;
        return { ...cal, pages: cal.pages.map((p) => ({ ...p, records: p.records!.map((r) => (r.id === id ? patch(r) : r)) })) };
    }
    // v0.1.297 — bundle del kanban (`{cells: {k: {records: [...]}}}`): el registro
    // movido cambia de valor al instante y el tablero lo reubica solo.
    const board = data as { cells?: Record<string, { records?: RecordEntity[] | null }> };
    if (board.cells && typeof board.cells === 'object') {
        let touched = false;
        const cells: Record<string, unknown> = {};
        for (const [k, cell] of Object.entries(board.cells)) {
            const rows = cell?.records;
            if (Array.isArray(rows) && rows.some((r) => r.id === id)) {
                touched = true;
                cells[k] = { ...cell, records: rows.map((r) => (r.id === id ? patch(r) : r)) };
            } else {
                cells[k] = cell;
            }
        }
        return touched ? { ...board, cells } : undefined;
    }
    return undefined;
}

interface GroupsKeyParams {
    groupBy: number;
    filter?: RecordsQuery['filter'];
    filterTree?: unknown;
    search?: string;
}

export const recordsKeys = {
    all: ['records'] as const,
    forList: (listId: string | number) => [...recordsKeys.all, String(listId)] as const,
    list: (listId: string | number, query: RecordsQuery) =>
        [...recordsKeys.forList(listId), 'list', query] as const,
    item: (listId: string | number, recordId: number) =>
        [...recordsKeys.forList(listId), 'item', recordId] as const,
    groups: (listId: string | number, params: GroupsKeyParams) =>
        [...recordsKeys.forList(listId), 'groups', params] as const,
    groupedBundle: (listId: string | number, params: Record<string, unknown>) =>
        [...recordsKeys.forList(listId), 'grouped-bundle', params] as const,
};

/**
 * Bundle endpoint para vista agrupada: una sola request retorna
 * (buckets + counts) + (records de cada bucket expandido) +
 * (aggregates de cada bucket expandido). Reemplaza el patrón de
 * 1 + N + N requests que tenía GroupedTableView.
 */
export interface GroupedBundleResponse {
    /** v0.1.287 — con segundo agrupado, cada grupo trae `sub_buckets`. */
    buckets: Array<RecordGroupBucket & { sub_buckets?: RecordGroupBucket[] }>;
    meta: {
        group_by_field_id: number;
        group_by_slug: string;
        group_by_type: string;
        total_groups: number;
        total_records: number;
        /** v0.1.252 — grupos que existen pero no se mandan (tope del servidor). */
        hidden_groups?: number;
        /** v0.1.287 — el segundo agrupado. */
        sub_group_by_field_id?: number;
        sub_group_by_slug?: string;
        sub_group_by_type?: string;
        /** v0.1.287 — combinaciones que no se mandan (tope del servidor). */
        hidden_sub_groups?: number;
    };
    /**
     * Map keyed por valor crudo del bucket (string), o `__null__` para
     * el bucket "(sin valor)". Los buckets no expandidos no aparecen.
     * v0.1.287 — con segundo agrupado la clave es la del PAR:
     * `JSON.stringify([grupo ?? '__null__', subgrupo ?? '__null__'])`.
     */
    expanded: Record<string, {
        records: RecordListResponse;
        aggregates?: AggregatesResponse;
    }>;
}

interface UseGroupedBundleArgs {
    listId: string | number | undefined;
    groupBy: number | undefined;
    /** Grupos a abrir. Se ignora con `collapsed` (modo "todos salvo…"). */
    expanded?: string[];
    /**
     * v0.1.224 — abrir TODOS los grupos de la consulta salvo éstos, en UNA
     * sola request (antes había que pedir los grupos y después sus filas).
     */
    collapsed?: string[];
    filterTree?: unknown;
    search?: string;
    /** v0.1.286 — orden de las filas dentro de cada grupo (`field_{id}:{dir},…`). */
    sort?: string;
    perPage?: number;
    aggregateFieldIds?: number[];
    /** v0.1.287 — segundo agrupado («Y luego por»). */
    subGroupBy?: number | null;
    /** v0.1.287 — subgrupos cerrados: pares `[grupo, subgrupo]` crudos. */
    collapsedSub?: Array<[string, string]>;
}

export function useRecordsGroupedBundle({
    listId,
    groupBy,
    expanded = [],
    collapsed,
    filterTree,
    search,
    sort,
    perPage = 50,
    aggregateFieldIds = [],
    subGroupBy = null,
    collapsedSub = [],
}: UseGroupedBundleArgs) {
    const qc = useQueryClient();
    const params: Record<string, unknown> = {
        group_by: groupBy,
        per_page: perPage,
    };
    // Orden estable → key estable (sin refetch inútil al abrir/cerrar en
    // otro orden). Las claves viajan como JSON: la de un grupo multi_select
    // es un JSON con comas y separada por comas se partía.
    if (collapsed !== undefined) {
        params.expand = 'all';
        const sortedCollapsed = [...collapsed].sort();
        if (sortedCollapsed.length > 0) params.collapsed = JSON.stringify(sortedCollapsed);
    } else {
        const sortedExpanded = [...expanded].sort();
        if (sortedExpanded.length > 0) params.expanded = JSON.stringify(sortedExpanded);
    }
    if (filterTree) {
        params.filter_tree = JSON.stringify(filterTree);
    }
    if (search && search.trim() !== '') {
        params.search = search.trim();
    }
    if (sort) params.sort = sort;
    if (aggregateFieldIds.length > 0) {
        params.aggregate_fields = aggregateFieldIds.join(',');
    }
    if (subGroupBy !== null && subGroupBy > 0 && subGroupBy !== groupBy) {
        params.sub_group_by = subGroupBy;
        const pairs = collapsedSub.map((p) => JSON.stringify(p)).sort();
        if (pairs.length > 0) params.collapsed_sub = `[${pairs.join(',')}]`;
    }

    return useQuery({
        queryKey: recordsKeys.groupedBundle(listId ?? '', params),
        queryFn: async () => {
            const res = await api.get<GroupedBundleResponse>(
                `/lists/${listId}/records/grouped-bundle`,
                { query: params },
            );
            return res.data;
        },
        enabled: listId !== undefined && listId !== '' && groupBy !== undefined && groupBy > 0,
        placeholderData: keepPreviousForList<GroupedBundleResponse>(qc, listId ?? ''),
    });
}

export function useRecords(listId: string | number | undefined, query: RecordsQuery) {
    const qc = useQueryClient();
    // Key por id numérico canónico (PERF-06); la URL usa el identificador
    // original (el backend acepta id o slug).
    const keyId = canonicalListId(qc, listId ?? '');
    const result = useQuery({
        queryKey: recordsKeys.list(keyId, query),
        queryFn: async () => {
            const res = await api.get<RecordEntity[]>(`/lists/${listId}/records`, {
                query: query as Record<string, unknown>,
            });
            // El endpoint devuelve { data, meta } sin envolver en .data extra.
            return { data: res.data, meta: res.meta } as unknown as RecordListResponse;
        },
        enabled: listId !== undefined && listId !== '',
        placeholderData: keepPreviousForList<RecordListResponse>(qc, keyId),
    });

    // v0.1.253 — se quitó la precarga automática de la página siguiente: se
    // pedía en CADA apertura de lista (también en kanban, calendario y
    // tarjetas, que no paginan) — 200 filas más por visita que casi nadie
    // usa. `keepPreviousData` ya evita el parpadeo al pasar de página.
    return result;
}

/**
 * Trae los buckets agrupados (count por valor) para alimentar la
 * vista de tabla con grouping estilo ClickUp/Airtable. La expansión
 * lazy de cada bucket reutiliza `useRecords` con un filtro extra.
 *
 * Cuando `groupBy` es null, la query queda disabled — el frontend
 * vuelve a la vista plana.
 */
export function useRecordGroups(
    listId: string | number | undefined,
    params: {
        groupBy: number | null;
        filter?: RecordsQuery['filter'];
        filterTree?: unknown;
        search?: string;
    },
) {
    const qc = useQueryClient();
    const enabled =
        listId !== undefined && listId !== '' && params.groupBy !== null && params.groupBy > 0;

    return useQuery({
        queryKey: recordsKeys.groups(listId ?? '', {
            groupBy: params.groupBy ?? 0,
            filter: params.filter,
            filterTree: params.filterTree,
            search: params.search,
        }),
        queryFn: async () => {
            const query: Record<string, unknown> = { group_by: params.groupBy };
            if (params.filter !== undefined) query.filter = params.filter;
            if (params.filterTree !== undefined) {
                query.filter_tree = JSON.stringify(params.filterTree);
            }
            if (params.search !== undefined && params.search !== '') query.search = params.search;
            const res = await api.get(`/lists/${listId}/records/groups`, { query });
            return res as unknown as RecordGroupsResponse;
        },
        enabled,
        placeholderData: keepPreviousForList<RecordGroupsResponse>(qc, listId ?? ''),
    });
}

/**
 * Trae un record individual por id. Útil para la página de Card
 * (ruta /lists/:slug/records/:id) — el drawer puede operar contra
 * la cache de la list query, pero la card abierta directo necesita
 * fetch propio.
 */
export function useRecord(listId: string | number | undefined, recordId: number | undefined) {
    return useQuery({
        queryKey: recordsKeys.item(listId ?? '', recordId ?? 0),
        queryFn: async () => {
            const res = await api.get<RecordEntity>(`/lists/${listId}/records/${recordId}`);
            return res.data;
        },
        enabled:
            listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        // El record individual abre en un drawer; entre opens del
        // mismo record (sin mutation) no hace falta refetchear.
        // Los mutations invalidan esta queryKey. (Fase 16.D)
        staleTime: 30_000,
    });
}

/** Valores sueltos, o `{ values, parentId }` para crear una subtarea. */
export type CreateRecordVars =
    | Record<string, unknown>
    | { values: Record<string, unknown>; parentId?: number | null };

function isWrappedCreate(
    input: CreateRecordVars,
): input is { values: Record<string, unknown>; parentId?: number | null } {
    return (
        typeof input === 'object'
        && input !== null
        && 'values' in input
        && typeof (input as { values: unknown }).values === 'object'
        && ('parentId' in input || Object.keys(input).length === 1)
    );
}

export function useCreateRecord(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateRecordVars) => {
            // Dos formas de llamarlo: los valores sueltos (lo de siempre) o
            // `{ values, parentId }` para crear una SUBTAREA (v0.1.132). El
            // padre va como clave propia del body, nunca mezclado con los
            // valores — un campo podría llamarse igual que la clave.
            const wrapped = isWrappedCreate(input);
            const values = wrapped ? input.values : input;
            const parentId = wrapped ? input.parentId ?? null : null;
            const body: Record<string, unknown> = { fields: values };
            if (parentId !== null) body.parent_id = parentId;
            const res = await api.post<RecordEntity>(`/lists/${listId}/records`, body);
            return res.data;
        },
        // v0.1.286 — se marca ANTES de mandar: el eco del realtime puede
        // llegar antes que la respuesta y disparaba un segundo refetch.
        onMutate: () => markLocalRecordsChange(qc, listId),
        onSuccess: () => {
            markLocalRecordsChange(qc, listId);
            // 0.57.41 — invalidamos sólo las queries de la lista
            // actual (id Y slug se resuelven vía el cache de
            // `useLists()`), no `recordsKeys.all`. Antes una mutación
            // en la lista A marcaba stale el cache de TODAS las listas,
            // disparando refetches en cascada al volver a la lista B.
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
        },
    });
}

interface UpdateRecordVars {
    id: number;
    values: Record<string, unknown>;
}

interface UpdateRecordContext {
    snapshots: Array<[readonly unknown[], unknown]>;
}

/**
 * Mutación con optimistic update. Recorremos todas las queries de records
 * para esta lista y mutamos en caché las filas que coincidan con el id —
 * así la celda editada se actualiza al instante. Si el server falla,
 * restauramos el snapshot.
 */
export function useUpdateRecord(listId: string | number) {
    const qc = useQueryClient();
    return useMutation<RecordEntity, Error, UpdateRecordVars, UpdateRecordContext>({
        mutationFn: async ({ id, values }) => {
            const res = await api.patch<RecordEntity>(`/lists/${listId}/records/${id}`, {
                fields: values,
            });
            return res.data;
        },
        onMutate: async ({ id, values }) => {
            // v0.1.286 — marcar ANTES: el eco del realtime de ESTE cambio llega
            // a veces antes que la respuesta (y que `onSettled`), y refrescaba
            // la lista una vez más.
            markLocalRecordsChange(qc, listId);
            // 0.57.41 — scope al id+slug de la lista actual (vía el
            // cache de useLists) en vez de `recordsKeys.all`. Sigue
            // soportando que las queries activas usen el slug aunque
            // este hook reciba el id numérico, sin tocar otras listas.
            const ids = listIdentifiersFor(qc, listId);
            const matchesList = (k: readonly unknown[]): boolean =>
                Array.isArray(k) && k.length >= 2 && k[0] === 'records'
                && typeof k[1] === 'string' && ids.has(k[1]);

            await qc.cancelQueries({ predicate: (q) => matchesList(q.queryKey) });

            const queries = qc.getQueriesData<unknown>({
                predicate: (q) => matchesList(q.queryKey),
            });
            const snapshots: Array<[readonly unknown[], unknown]> = [];

            // Solo se tocan las queries que CONTIENEN el record (listado plano
            // y, desde v0.1.286, también el bundle de la vista AGRUPADA: antes
            // la celda editada volvía a su valor viejo hasta el refetch).
            for (const [key, data] of queries) {
                const next = patchRecordInCache(data, id, (rec) => ({ ...rec, fields: { ...rec.fields, ...values } }));
                if (next === undefined) continue;
                snapshots.push([key, data]);
                qc.setQueryData(key, next);
            }

            return { snapshots };
        },
        onError: (_err, _vars, ctx) => {
            if (! ctx) return;
            for (const [key, snap] of ctx.snapshots) {
                qc.setQueryData(key, snap);
            }
        },
        onSettled: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            // v0.1.149 — cada edición escribe una entrada de actividad: el
            // feed de la ficha tiene que verla sin recargar.
            invalidateForList(qc, activityKeys.all, listId);
            // v0.1.291 — y el historial del campo, si está abierto.
            invalidateForList(qc, fieldHistoryKeys.all, listId);
        },
    });
}

export function useDeleteRecord(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, purge }: { id: number; purge?: boolean }) => {
            await api.delete(`/lists/${listId}/records/${id}`, {
                query: { purge: purge ?? false },
            });
        },
        onMutate: () => markLocalRecordsChange(qc, listId),
        onSuccess: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
        },
    });
}

interface BulkResponse {
    succeeded: number[];
    failed: Array<{ id: number; message: string }>;
}

interface BulkVars {
    action: 'delete' | 'update';
    ids: number[];
    values?: Record<string, unknown>;
}

export function useBulkRecords(listId: string | number) {
    const qc = useQueryClient();
    return useMutation<BulkResponse, Error, BulkVars>({
        mutationFn: async ({ action, ids, values }) => {
            const res = await api.post<BulkResponse>(`/lists/${listId}/records/bulk`, {
                action,
                ids,
                values: values ?? {},
            });
            return res.data;
        },
        onMutate: () => markLocalRecordsChange(qc, listId),
        onSuccess: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
        },
    });
}
