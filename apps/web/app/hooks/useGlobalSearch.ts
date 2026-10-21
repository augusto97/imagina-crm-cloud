import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GlobalSearchHit } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.286 — registros de todas las listas por título (`GET /search`), para
 * la paleta. Mínimo 2 letras; mientras llega la respuesta nueva se conserva
 * la anterior (sin parpadeo al tipear).
 */
export function useGlobalSearch(query: string, enabled: boolean) {
    const q = query.trim();
    return useQuery({
        queryKey: ['global-search', q],
        queryFn: async ({ signal }) =>
            (await api.get<GlobalSearchHit[]>('/search', { query: { q, limit: 20 }, signal })).data,
        enabled: enabled && q.length >= 2,
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    });
}
