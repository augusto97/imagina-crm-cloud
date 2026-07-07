import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface WpUserSummary {
    id: number;
    login: string;
    display_name: string;
    avatar_url: string;
}

/**
 * Busca usuarios de WP por nombre o login. Devuelve hasta `limit`
 * resultados ordenados por display_name. Sin query (string vacío)
 * devuelve `[]` — el endpoint no soporta "todos los users" para
 * proteger contra dumps masivos.
 */
export function useWpUsersSearch(query: string, limit = 8) {
    return useQuery<WpUserSummary[]>({
        queryKey: ['wp-users-search', query, limit],
        queryFn: async () => {
            if (query.trim() === '') return [];
            const res = await api.get<WpUserSummary[]>('/me/users-search', {
                query: { q: query, limit },
            });
            return res.data;
        },
        // Cache 30s — los users no cambian frecuente y el mismo query
        // se dispara repetidamente desde varios pickers.
        staleTime: 30_000,
        // No queremos refetch on focus aquí — los pickers se abren/cierran
        // constantemente.
        refetchOnWindowFocus: false,
    });
}

/**
 * Lookup de un user específico por ID. Devuelve `null` si el endpoint
 * 404 (user borrado) o si el ID es inválido. La query se queda
 * disabled cuando `id` es 0/null para no spamear con lookups de
 * "no value".
 */
export function useWpUser(id: number | null | undefined) {
    return useQuery<WpUserSummary | null>({
        queryKey: ['wp-user', id],
        queryFn: async () => {
            if (!id || id <= 0) return null;
            try {
                const res = await api.get<WpUserSummary>(`/me/users/${id}`);
                return res.data;
            } catch {
                // User no existe (borrado) o sin permiso. El UserPicker
                // muestra "Usuario #X" como fallback.
                return null;
            }
        },
        enabled: typeof id === 'number' && id > 0,
        // Los users no cambian frecuente; cacheamos generoso.
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
}

/**
 * Prefetch de un user — útil cuando el caller sabe que el next render
 * va a necesitar el user y quiere evitar el flash de "Cargando".
 */
export function usePrefetchWpUser(): (id: number) => void {
    const qc = useQueryClient();
    return (id: number) => {
        if (id <= 0) return;
        void qc.prefetchQuery({
            queryKey: ['wp-user', id],
            queryFn: async () => {
                const res = await api.get<WpUserSummary>(`/me/users/${id}`);
                return res.data;
            },
            staleTime: 5 * 60_000,
        });
    };
}
