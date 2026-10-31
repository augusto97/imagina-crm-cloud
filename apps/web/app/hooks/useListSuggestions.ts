import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ApplyListSuggestionResult,
    ListSuggestionsResponse,
    ListSuggestionsSettings,
    RunListSuggestionsAiInput,
    UpdateListSuggestionsSettingsInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.341 (ADR-S89) — Sugerencias por lista. La clave lleva el ID numérico
 * de la lista (regla de oro nº 7). El resumen (para el aviso de la cabecera)
 * no consulta a la IA; el panel completo sí, y pregunta cada 2 s mientras un
 * análisis está en curso.
 */
export const listSuggestionsKeys = {
    all: ['list-suggestions'] as const,
    forList: (listId: number) => ['list-suggestions', listId] as const,
    summary: (listId: number) => ['list-suggestions', listId, 'summary'] as const,
    full: (listId: number) => ['list-suggestions', listId, 'full'] as const,
    settings: ['list-suggestions', 'settings'] as const,
};

export function useListSuggestionsSummary(listId: number | undefined, enabled: boolean) {
    return useQuery({
        queryKey: listSuggestionsKeys.summary(listId ?? 0),
        queryFn: async () => (await api.get<ListSuggestionsResponse>(`/lists/${listId}/suggestions?summary=1`)).data,
        enabled: enabled && listId !== undefined && listId > 0,
        staleTime: 5 * 60_000,
    });
}

export function useListSuggestions(listId: number | undefined, enabled: boolean) {
    return useQuery({
        queryKey: listSuggestionsKeys.full(listId ?? 0),
        queryFn: async () => (await api.get<ListSuggestionsResponse>(`/lists/${listId}/suggestions`)).data,
        enabled: enabled && listId !== undefined && listId > 0,
        staleTime: 0,
        refetchInterval: (q) => (q.state.data?.ai.state === 'running' ? 2000 : false),
    });
}

export function useRunListSuggestionsAi(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: RunListSuggestionsAiInput) => (await api.post<ListSuggestionsResponse>(`/lists/${listId}/suggestions/ai`, input)).data,
        onSuccess: (res) => qc.setQueryData(listSuggestionsKeys.full(listId), res),
    });
}

export function useApplyListSuggestion(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (key: string) => (await api.post<ApplyListSuggestionResult>(`/lists/${listId}/suggestions/${encodeURIComponent(key)}/apply`, {})).data,
        // Una sugerencia puede crear una vista, un tablero, una automatización o
        // convertir un campo: es más barato refrescar todo que adivinar.
        onSuccess: async () => {
            await qc.invalidateQueries();
        },
    });
}

export function useDismissListSuggestion(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (v: { key: string; title: string; restore?: boolean }) =>
            v.restore
                ? api.post(`/lists/${listId}/suggestions/${encodeURIComponent(v.key)}/restore`, {})
                : api.post(`/lists/${listId}/suggestions/${encodeURIComponent(v.key)}/dismiss`, { title: v.title.slice(0, 190) }),
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: listSuggestionsKeys.forList(listId) });
        },
    });
}

export function useListSuggestionsSettings(enabled = true) {
    return useQuery({
        queryKey: listSuggestionsKeys.settings,
        queryFn: async () => (await api.get<ListSuggestionsSettings>('/suggestions/settings')).data,
        enabled,
        staleTime: 60_000,
    });
}

export function useUpdateListSuggestionsSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: UpdateListSuggestionsSettingsInput) => (await api.patch<ListSuggestionsSettings>('/suggestions/settings', patch)).data,
        onSuccess: async (res) => {
            qc.setQueryData(listSuggestionsKeys.settings, res);
            await qc.invalidateQueries({ queryKey: listSuggestionsKeys.all });
        },
    });
}
