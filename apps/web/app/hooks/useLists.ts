import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export function useList(idOrSlug: string | number | undefined) {
    return useQuery({
        queryKey: listsKeys.detail(idOrSlug ?? ''),
        queryFn: async () => {
            const res = await api.get<ListSummary>(`/lists/${idOrSlug}`);
            return res.data;
        },
        enabled: idOrSlug !== undefined && idOrSlug !== '',
        staleTime: META_STALE_TIME,
    });
}

export function useCreateList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateListInput) => {
            const res = await api.post<ListSummary>('/lists', input);
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
            const res = await api.patch<ListSummary>(`/lists/${idOrSlug}`, input);
            return res.data;
        },
        onSuccess: (data) => {
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
            void qc.invalidateQueries({ queryKey: listsKeys.detail(data.id) });
            void qc.invalidateQueries({ queryKey: listsKeys.detail(data.slug) });
        },
    });
}

export function useDeleteList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ idOrSlug, purge }: { idOrSlug: string | number; purge?: boolean }) => {
            await api.delete(`/lists/${idOrSlug}`, { query: { purge: purge ?? false } });
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
        },
    });
}
