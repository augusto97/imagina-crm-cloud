import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * v0.1.107 — Favoritos del usuario en el workspace activo: listas y
 * dashboards ANCLADOS en el menú lateral. Per-usuario+tenant (viven en
 * `memberships.settings.favorites`); el PATCH reemplaza cada array presente.
 */
export interface Favorites {
    lists: number[];
    dashboards: number[];
    /** v0.1.260 — vistas guardadas ancladas. */
    views: number[];
}

/** Una vista anclada, resuelta por el servidor (nombre, icono y su lista). */
export interface FavoriteView {
    id: number;
    name: string;
    type: string;
    icon: string | null;
    color: string | null;
    list_id: number;
    list_slug: string;
    list_name: string;
}

export const EMPTY_FAVORITES: Favorites = { lists: [], dashboards: [], views: [] };

export const favoritesKeys = {
    all: ['me-favorites'] as const,
};

export function useFavorites() {
    return useQuery({
        queryKey: favoritesKeys.all,
        queryFn: async (): Promise<Favorites> => {
            const res = await api.get<Favorites>('/me/favorites');
            return { lists: res.data.lists ?? [], dashboards: res.data.dashboards ?? [], views: res.data.views ?? [] };
        },
        staleTime: 60_000,
    });
}

/**
 * v0.1.260 — las vistas ancladas en UN request. La key cuelga de
 * `favoritesKeys.all`, así que anclar/desanclar la invalida sola.
 */
export function useFavoriteViews(enabled = true) {
    return useQuery({
        queryKey: [...favoritesKeys.all, 'views'] as const,
        queryFn: async (): Promise<FavoriteView[]> => {
            const res = await api.get<FavoriteView[]>('/me/favorites/views');
            return Array.isArray(res.data) ? res.data : [];
        },
        enabled,
        staleTime: 60_000,
    });
}

/** Link que abre la lista directamente en esa vista. */
export function favoriteViewPath(v: Pick<FavoriteView, 'id' | 'list_slug'>): string {
    return `/lists/${v.list_slug}/records?view=${v.id}`;
}

export function useUpdateFavorites() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: Partial<Favorites>): Promise<Favorites> => {
            const res = await api.patch<Favorites>('/me/favorites', patch);
            return res.data;
        },
        // Optimista: el toggle de la estrella se siente instantáneo.
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey: favoritesKeys.all });
            const prev = qc.getQueryData<Favorites>(favoritesKeys.all);
            if (prev) qc.setQueryData<Favorites>(favoritesKeys.all, { ...prev, ...patch });
            return { prev };
        },
        onError: (_e, _p, ctx) => {
            if (ctx?.prev) qc.setQueryData(favoritesKeys.all, ctx.prev);
        },
        onSettled: () => {
            void qc.invalidateQueries({ queryKey: favoritesKeys.all });
        },
    });
}

/** Helper de toggle: agrega/quita `id` del array `kind` y devuelve el patch. */
export function toggledFavorites(
    current: Favorites,
    kind: keyof Favorites,
    id: number,
): Partial<Favorites> {
    const has = current[kind].includes(id);
    return { [kind]: has ? current[kind].filter((x) => x !== id) : [...current[kind], id] };
}
