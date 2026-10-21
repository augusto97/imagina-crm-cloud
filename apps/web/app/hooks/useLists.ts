import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CreateListInput, ListSummary, UpdateListInput } from '@/types/list';

export const listsKeys = {
    all: ['lists'] as const,
    list: () => [...listsKeys.all, 'list'] as const,
    detail: (idOrSlug: string | number) => [...listsKeys.all, 'detail', String(idOrSlug)] as const,
};

// staleTime default para queries que rara vez cambian dentro de
// una sesión (listas, fields, dashboards, automations). Cuando un
// mutation invalida la queryKey, igual se refetchea — el staleTime
// solo evita el refetch automático en cada mount del componente.
// 60s es el sweet spot: la mayoría de las navegaciones encuentran
// data fresca, los cambios reales del backend se reflejan al
// siguiente refetch natural. (Fase 16.D)
const META_STALE_TIME = 60_000;

/**
 * v0.1.286 — cambios de LISTAS hechos desde esta pestaña. Al aplicar una
 * plantilla (2-3 listas con campos y vistas) llegaban varios avisos realtime
 * de "listas" que volvían a pedir `/lists` lo que la propia mutación ya
 * refrescó (`GET /lists` ×4). Mismo criterio que el eco de registros
 * (v0.1.253): mientras corre una mutación local y 2,5 s después, el eco se
 * ignora; la mutación invalida por su cuenta.
 */
let pendingLocalListsChanges = 0;
let lastLocalListsChange = 0;

export function trackLocalListsChange<T>(work: Promise<T>): Promise<T> {
    pendingLocalListsChanges++;
    return work.finally(() => {
        pendingLocalListsChanges--;
        lastLocalListsChange = Date.now();
    });
}

export function isRecentLocalListsChange(now: number = Date.now()): boolean {
    return pendingLocalListsChanges > 0 || now - lastLocalListsChange < 2500;
}

export function useLists() {
    return useQuery({
        queryKey: listsKeys.list(),
        queryFn: async () => {
            const res = await api.get<ListSummary[]>('/lists');
            return res.data;
        },
        staleTime: META_STALE_TIME,
    });
}

/**
 * Una lista por id o slug. v0.1.286 — abrir una lista pedía `/lists/<slug>` Y
 * `/lists/<id>` (la página resuelve por slug; sus hijos por id). Ahora:
 *  - si el índice `/lists` (que el panel ya cargó) está fresco, la lista sale
 *    de ahí sin request (mismo DTO);
 *  - lo que se trae por un identificador se siembra bajo el otro.
 */
export function useList(idOrSlug: string | number | undefined) {
    const qc = useQueryClient();
    const key = idOrSlug === undefined ? '' : String(idOrSlug);
    // Regla de oro nº 7: si el índice ya sabe el id, la key es el ID (así la
    // misma lista abierta por slug y por id es UNA query y una invalidación
    // la refetchea una sola vez). Sin índice todavía, el identificador dado.
    const canonical = key === '' ? '' : (findInIndex(qc, key)?.id.toString() ?? key);
    return useQuery({
        queryKey: listsKeys.detail(canonical),
        queryFn: async () => {
            const res = await api.get<ListSummary>(`/lists/${key}`);
            seedListDetail(qc, res.data);
            return res.data;
        },
        initialData: () => findInIndex(qc, key),
        initialDataUpdatedAt: () => qc.getQueryState(listsKeys.list())?.dataUpdatedAt,
        enabled: key !== '',
        staleTime: META_STALE_TIME,
    });
}

function findInIndex(qc: QueryClient, key: string): ListSummary | undefined {
    if (key === '') return undefined;
    const all = qc.getQueryData<ListSummary[]>(listsKeys.list());
    return Array.isArray(all) ? all.find((l) => l.slug === key || String(l.id) === key) : undefined;
}

/** Guarda la lista bajo su id y su slug (regla de oro nº 7: id↔slug). */
export function seedListDetail(qc: QueryClient, list: ListSummary | undefined): void {
    if (!list) return;
    for (const k of [String(list.id), list.slug]) {
        const cur = qc.getQueryData<ListSummary>(listsKeys.detail(k));
        if (cur !== list) qc.setQueryData(listsKeys.detail(k), list);
    }
}

export function useCreateList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateListInput) => {
            const res = await trackLocalListsChange(api.post<ListSummary>('/lists', input));
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
        },
    });
}

export function useUpdateList(idOrSlug: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateListInput) => {
            const res = await trackLocalListsChange(api.patch<ListSummary>(`/lists/${idOrSlug}`, input));
            return res.data;
        },
        onSuccess: (data) => {
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
            void qc.invalidateQueries({ queryKey: listsKeys.detail(data.id) });
            void qc.invalidateQueries({ queryKey: listsKeys.detail(data.slug) });
        },
    });
}

/**
 * v0.1.107 — Reordenar el menú de listas (orden compartido del workspace,
 * `lists.position`). Recibe TODOS los ids en el orden deseado.
 */
export function useReorderLists() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (listIds: number[]) => {
            const res = await trackLocalListsChange(api.patch<ListSummary[]>('/lists/reorder', { list_ids: listIds }));
            return res.data;
        },
        // Optimista: el drop se refleja al instante en el árbol.
        onMutate: async (listIds) => {
            await qc.cancelQueries({ queryKey: listsKeys.list() });
            const prev = qc.getQueryData<ListSummary[]>(listsKeys.list());
            if (prev) {
                const byId = new Map(prev.map((l) => [l.id, l]));
                const next = listIds.map((id) => byId.get(id)).filter((l): l is ListSummary => l !== undefined);
                if (next.length === prev.length) qc.setQueryData(listsKeys.list(), next);
            }
            return { prev };
        },
        onError: (_e, _ids, ctx) => {
            if (ctx?.prev) qc.setQueryData(listsKeys.list(), ctx.prev);
        },
        onSettled: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
        },
    });
}

export function useDeleteList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ idOrSlug, purge }: { idOrSlug: string | number; purge?: boolean }) => {
            await trackLocalListsChange(api.delete(`/lists/${idOrSlug}`, { query: { purge: purge ?? false } }));
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
        },
    });
}
