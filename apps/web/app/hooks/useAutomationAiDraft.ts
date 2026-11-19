import { useMutation, useQuery } from '@tanstack/react-query';
import type { AutomationAiDraftJob, AutomationAiDraftRequest, AutomationAiDraftStatus } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.463 — «Describir con IA» / «Pedir un cambio con IA» del editor de
 * automatizaciones. La IA trabaja en segundo plano: se arranca el pedido y
 * se pregunta cada poco hasta que termina (como la bienvenida con IA). El
 * resultado NO se guarda: vuelve al editor.
 *
 * Claves por el id NUMÉRICO de la lista (regla de oro nº 7).
 */
export const automationAiDraftKeys = {
    all: ['automation-ai-draft'] as const,
    status: (listId: number) => ['automation-ai-draft', listId, 'status'] as const,
    job: (listId: number, id: string) => ['automation-ai-draft', listId, 'job', id] as const,
};

/** Si el botón se puede usar ahora y, si no, por qué (no gasta nada). */
export function useAutomationAiDraftStatus(listId: number | undefined) {
    return useQuery({
        queryKey: automationAiDraftKeys.status(listId ?? 0),
        queryFn: async () => (await api.get<AutomationAiDraftStatus>(`/lists/${listId}/automations/ai-draft/status`)).data,
        enabled: listId !== undefined,
        staleTime: 30_000,
    });
}

export function useStartAutomationAiDraft(listId: number) {
    return useMutation({
        mutationFn: async (input: AutomationAiDraftRequest) =>
            (await api.post<{ id: string }>(`/lists/${listId}/automations/ai-draft`, input)).data,
    });
}

/** Pregunta cada poco mientras la IA trabaja; se detiene sola al terminar. */
export function useAutomationAiDraftJob(listId: number, id: string | null) {
    return useQuery({
        queryKey: automationAiDraftKeys.job(listId, id ?? ''),
        queryFn: async () => (await api.get<AutomationAiDraftJob>(`/lists/${listId}/automations/ai-draft/${id}`)).data,
        enabled: id !== null,
        refetchInterval: (q) =>
            q.state.status === 'error' ? false : q.state.data?.state === 'running' || q.state.data === undefined ? 1500 : false,
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 0,
        gcTime: 0,
    });
}
