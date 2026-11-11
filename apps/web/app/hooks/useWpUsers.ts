import { createContext, useContext } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface WpUserSummary {
    id: number;
    login: string;
    display_name: string;
    avatar_url: string;
    /** C3 — persona invitada de afuera (badge «Invitado»). */
    is_guest?: boolean;
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

// ── Carga por id AGRUPADA (estilo DataLoader, como la de archivos) ─────────
// Una tabla, un kanban o la actividad con 40 personas distintas pedían 40
// veces `GET /me/users/:id`. Cada celda sigue pidiendo de a una, y este
// cargador junta todas las del mismo tick en UN `GET /me/users?ids=`.
type UserWaiter = (user: WpUserSummary | null) => void;
let pendingUsers: Map<number, UserWaiter[]> | null = null;
const USERS_PER_REQUEST = 100;

/** Un miembro por id; `null` si no existe, no se puede ver o la carga falló. */
export function loadWpUser(id: number): Promise<WpUserSummary | null> {
    if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
        if (pendingUsers === null) {
            pendingUsers = new Map();
            setTimeout(() => void flushUsers(), 0);
        }
        const list = pendingUsers.get(id) ?? [];
        list.push(resolve);
        pendingUsers.set(id, list);
    });
}

async function flushUsers(): Promise<void> {
    const batch = pendingUsers;
    pendingUsers = null;
    if (batch === null) return;
    const ids = [...batch.keys()].sort((x, y) => x - y);
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += USERS_PER_REQUEST) chunks.push(ids.slice(i, i + USERS_PER_REQUEST));
    await Promise.all(chunks.map(async (chunk) => {
        let byId = new Map<number, WpUserSummary>();
        try {
            const res = await api.get<WpUserSummary[]>('/me/users', { query: { ids: chunk.join(',') } });
            byId = new Map(res.data.map((u) => [u.id, u]));
        } catch {
            // Sin permiso o sin red: la UI muestra «Usuario #X» (como antes).
        }
        for (const id of chunk) for (const resolve of batch.get(id) ?? []) resolve(byId.get(id) ?? null);
    }));
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
        // User que no existe (borrado) o sin permiso → null: el UserPicker
        // muestra "Usuario #X" como fallback.
        queryFn: () => (id ? loadWpUser(id) : null),
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
            queryFn: () => loadWpUser(id),
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
