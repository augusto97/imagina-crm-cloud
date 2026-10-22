import { createContext, useContext } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface WpUserSummary {
    id: number;
    login: string;
    display_name: string;
    avatar_url: string;
}

/**
 * v0.1.292 — Directorio de nombres ya resueltos (id → nombre). La página
 * pública de un tablero no tiene sesión: los nombres de las personas por las
 * que agrupa un gráfico llegan en su propio paquete y se proveen aquí; con el
 * directorio presente, `useMemberNames`/`useWpUser` no le piden nada a la API.
 */
export const MemberDirectoryContext = createContext<ReadonlyMap<number, string> | null>(null);

const memberNamesKey = (clean: number[]) => ['member-names', clean.join(',')] as const;

function cleanIds(ids: readonly number[]): number[] {
    return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, 100);
}

async function fetchNames(clean: number[]): Promise<Map<number, string>> {
    const res = await api.get<WpUserSummary[]>('/me/users', { query: { ids: clean.join(',') } });
    return new Map(res.data.map((u) => [u.id, u.display_name || u.login]));
}

/**
 * Nombres de varios miembros FUERA de un render (descargar un CSV): usa el
 * directorio si lo hay y, si no, el mismo cache que `useMemberNames`.
 */
export async function memberNamesFor(
    qc: QueryClient,
    ids: readonly number[],
    directory: ReadonlyMap<number, string> | null,
): Promise<ReadonlyMap<number, string>> {
    if (directory) return directory;
    const clean = cleanIds(ids);
    if (clean.length === 0) return new Map();
    return qc.fetchQuery({ queryKey: memberNamesKey(clean), queryFn: () => fetchNames(clean), staleTime: 5 * 60_000 });
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
    const directory = useContext(MemberDirectoryContext);
    const query = useQuery<WpUserSummary | null>({
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
        enabled: directory === null && typeof id === 'number' && id > 0,
        // Los users no cambian frecuente; cacheamos generoso.
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    if (directory !== null) {
        const name = typeof id === 'number' ? directory.get(id) : undefined;
        const data = name !== undefined && typeof id === 'number' ? { id, login: '', display_name: name, avatar_url: '' } : null;
        return { ...query, data, isLoading: false, isPending: false, isSuccess: true } as typeof query;
    }
    return query;
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

/**
 * v0.1.252 — Nombres de varios miembros en UNA request (`GET /me/users?ids=`).
 * Lo usan los gráficos agrupados por un campo persona: antes la barra decía
 * «1» (el id) en vez de «Ana». Devuelve id → nombre visible.
 */
export function useMemberNames(ids: number[]) {
    const directory = useContext(MemberDirectoryContext);
    const clean = cleanIds(ids);
    const query = useQuery<Map<number, string>>({
        queryKey: memberNamesKey(clean),
        queryFn: () => fetchNames(clean),
        enabled: directory === null && clean.length > 0,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    if (directory !== null) {
        return { ...query, data: directory as Map<number, string>, isLoading: false, isPending: false, isSuccess: true } as typeof query;
    }
    return query;
}
