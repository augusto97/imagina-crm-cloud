import { useEffect } from 'react';
import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AggregatesResponse } from '@/hooks/useAggregates';
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
    void qc.invalidateQueries({
        predicate: (q) => {
            const k = q.queryKey;
            if (! Array.isArray(k) || k.length < 2) return false;
            if (k[0] !== namespace[0]) return false;
            return typeof k[1] === 'string' && ids.has(k[1]);
        },
    });
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
    buckets: RecordGroupBucket[];
    meta: {
        group_by_field_id: number;
        group_by_slug: string;
        group_by_type: string;
        total_groups: number;
        total_records: number;
    };
    /**
     * Map keyed por valor crudo del bucket (string), o `__null__` para
     * el bucket "(sin valor)". Los buckets no expandidos no aparecen.
     */
    expanded: Record<string, {
        records: RecordListResponse;
        aggregates?: AggregatesResponse;
    }>;
}

interface UseGroupedBundleArgs {
    listId: string | number | undefined;
    groupBy: number | undefined;
    expanded: string[];
    filterTree?: unknown;
    search?: string;
    perPage?: number;
    aggregateFieldIds?: number[];
}

export function useRecordsGroupedBundle({
    listId,
    groupBy,
    expanded,
    filterTree,
    search,
    perPage = 50,
    aggregateFieldIds = [],
}: UseGroupedBundleArgs) {
    const params: Record<string, unknown> = {
        group_by: groupBy,
        per_page: perPage,
    };
    // Stable order in expanded → stable key (avoid useless refetch
    // cuando el user toggles otro bucket en otro orden).
    const sortedExpanded = [...expanded].sort();
    if (sortedExpanded.length > 0) {
        params.expanded = sortedExpanded;
    }
    if (filterTree) {
        params.filter_tree = JSON.stringify(filterTree);
    }
    if (search && search.trim() !== '') {
        params.search = search.trim();
    }
    if (aggregateFieldIds.length > 0) {
        params.aggregate_fields = aggregateFieldIds.join(',');
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
        placeholderData: keepPreviousData,
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
        placeholderData: keepPreviousData,
    });

    // Prefetch de la siguiente página: cuando recibimos data de la
    // página actual y todavía hay más, pre-disparamos el fetch de
    // page+1 en background. React Query lo cachea por queryKey
    // distinto, así que cuando el user scrollea o avanza de página,
    // los datos ya están listos. Cero pausa visible.
    //
    // 0.36.7: ahora dentro de useEffect — antes vivía en el cuerpo
    // del hook y se ejecutaba en cada render (efecto durante render
    // viola las reglas de React y hacía trabajo redundante en sesiones
    // largas con re-renders frecuentes). prefetchQuery sigue siendo
    // idempotente; sólo cambia que ahora corre cuando la fila/página
    // cambia, no en cada render.
    const meta = result.data?.meta;
    const currentPage = (query.page as number | undefined) ?? 1;
    const totalPages = (meta as { total_pages?: number } | undefined)?.total_pages ?? 1;
    const shouldPrefetch =
        listId !== undefined && listId !== '' &&
        result.isSuccess &&
        currentPage < totalPages;

    useEffect(() => {
        if (! shouldPrefetch) return;
        const nextQuery: RecordsQuery = { ...query, page: currentPage + 1 };
        void qc.prefetchQuery({
            queryKey: recordsKeys.list(keyId, nextQuery),
            queryFn: async () => {
                const res = await api.get<RecordEntity[]>(`/lists/${listId}/records`, {
                    query: nextQuery as Record<string, unknown>,
                });
                return { data: res.data, meta: res.meta } as unknown as RecordListResponse;
            },
        });
    }, [shouldPrefetch, listId, keyId, currentPage, totalPages]);

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
        placeholderData: keepPreviousData,
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

export function useCreateRecord(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (values: Record<string, unknown>) => {
            const res = await api.post<RecordEntity>(`/lists/${listId}/records`, { fields: values });
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — invalidamos sólo las queries de la lista
            // actual (id Y slug se resuelven vía el cache de
            // `useLists()`), no `recordsKeys.all`. Antes una mutación
            // en la lista A marcaba stale el cache de TODAS las listas,
            // disparando refetches en cascada al volver a la lista B.
            invalidateForList(qc, recordsKeys.all, listId);
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
            // 0.57.41 — scope al id+slug de la lista actual (vía el
            // cache de useLists) en vez de `recordsKeys.all`. Sigue
            // soportando que las queries activas usen el slug aunque
            // este hook reciba el id numérico, sin tocar otras listas.
            const ids = listIdentifiersFor(qc, listId);
            const matchesList = (k: readonly unknown[]): boolean =>
                Array.isArray(k) && k.length >= 2 && k[0] === 'records'
                && typeof k[1] === 'string' && ids.has(k[1]);

            await qc.cancelQueries({ predicate: (q) => matchesList(q.queryKey) });

            const queries = qc.getQueriesData<RecordListResponse>({
                predicate: (q) => matchesList(q.queryKey),
            });
            const snapshots: Array<[readonly unknown[], unknown]> = [];

            for (const [key, data] of queries) {
                if (! data || ! Array.isArray(data.data)) continue;
                // Solo touch queries que CONTIENEN el record. Evita
                // mutar caches de otras listas que tengan ids colisionantes
                // (raro pero posible).
                const hasRecord = data.data.some((r) => r.id === id);
                if (! hasRecord) continue;
                snapshots.push([key, data]);

                const next: RecordListResponse = {
                    ...data,
                    data: data.data.map((rec) =>
                        rec.id === id
                            ? { ...rec, fields: { ...rec.fields, ...values } }
                            : rec,
                    ),
                };
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
            invalidateForList(qc, recordsKeys.all, listId);
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
        onSuccess: () => {
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
        onSuccess: () => {
            invalidateForList(qc, recordsKeys.all, listId);
        },
    });
}
