import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { invalidateForList } from '@/hooks/useRecords';
import type { SavedViewConfig, SavedViewEntity, SavedViewType } from '@/types/view';

export const viewsKeys = {
    all: ['views'] as const,
    forList: (listId: string | number) => [...viewsKeys.all, String(listId)] as const,
};

export function useSavedViews(listId: string | number | undefined) {
    return useQuery({
        queryKey: viewsKeys.forList(listId ?? ''),
        queryFn: async () => {
            const res = await api.get<SavedViewEntity[]>(`/lists/${listId}/views`);
            return res.data;
        },
        enabled: listId !== undefined && listId !== '',
        // Vistas guardadas rara vez cambian en una sesión. (Fase 16.D)
        staleTime: 60_000,
    });
}

interface CreateViewVars {
    name: string;
    type?: SavedViewType;
    config: SavedViewConfig;
    is_default?: boolean;
}

export function useCreateSavedView(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateViewVars) => {
            const res = await api.post<SavedViewEntity>(`/lists/${listId}/views`, input);
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista actual (ver
            // `invalidateForList` en useRecords.ts).
            invalidateForList(qc, viewsKeys.all, listId);
        },
    });
}

interface UpdateViewVars {
    id: number;
    name?: string;
    config?: SavedViewConfig;
    is_default?: boolean;
    /** v0.1.259 — icono/color de la pestaña (`null` = el del tipo de vista). */
    icon?: string | null;
    color?: string | null;
}

export function useUpdateSavedView(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...patch }: UpdateViewVars) => {
            const res = await api.patch<SavedViewEntity>(`/lists/${listId}/views/${id}`, patch);
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista actual (ver
            // `invalidateForList` en useRecords.ts).
            invalidateForList(qc, viewsKeys.all, listId);
        },
    });
}

export function useDeleteSavedView(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/views/${id}`);
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista actual (ver
            // `invalidateForList` en useRecords.ts).
            invalidateForList(qc, viewsKeys.all, listId);
        },
    });
}

/**
 * v0.1.259 — orden de las pestañas (arrastrar en la barra). Optimista: se
 * reordena el cache de la lista al instante (por id Y por slug, regla de oro
 * nº 7) y se vuelve atrás si el servidor rechaza.
 */
export function useReorderSavedViews(listId: number) {
    const qc = useQueryClient();
    const matches = (data: unknown): data is SavedViewEntity[] =>
        Array.isArray(data) && data.length > 0 && (data[0] as SavedViewEntity).list_id === listId;
    return useMutation({
        mutationFn: async (viewIds: number[]) => {
            const res = await api.patch<SavedViewEntity[]>(`/lists/${listId}/views/reorder`, { view_ids: viewIds });
            return res.data;
        },
        onMutate: (viewIds: number[]) => {
            const snapshots = qc.getQueriesData<SavedViewEntity[]>({ queryKey: viewsKeys.all });
            for (const [key, data] of snapshots) {
                if (!matches(data)) continue;
                const pos = new Map(viewIds.map((id, i) => [id, i]));
                qc.setQueryData(key, data.map((v) => ({ ...v, position: pos.get(v.id) ?? viewIds.length + v.position })));
            }
            return { snapshots };
        },
        onError: (_err, _vars, ctx) => {
            for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
        },
        onSettled: () => {
            invalidateForList(qc, viewsKeys.all, listId);
        },
    });
}
