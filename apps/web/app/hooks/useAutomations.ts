import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { invalidateForList } from '@/hooks/useRecords';
import type {
    ActionMeta,
    AutomationEntity,
    AutomationRunEntity,
    CreateAutomationInput,
    TriggerMeta,
    UpdateAutomationInput,
} from '@/types/automation';

export const automationsKeys = {
    all: ['automations'] as const,
    // El identificador va en el índice 1 (igual que records/fields):
    // el segmento 'list' extra corría el id al índice 2 y
    // `invalidateForList` —que matchea el índice 1— NUNCA invalidaba →
    // la página de automatizaciones no mostraba altas/cambios sin
    // recargar (misma clase de bug que fieldsKeys, ya documentada ahí).
    forList: (listId: string | number) =>
        [...automationsKeys.all, String(listId)] as const,
    runs: (automationId: number) =>
        [...automationsKeys.all, 'runs', String(automationId)] as const,
    triggers: ['automations', 'triggers'] as const,
    actions: ['automations', 'actions'] as const,
};

export function useAutomations(listId: string | number | undefined) {
    return useQuery({
        queryKey: automationsKeys.forList(listId ?? ''),
        queryFn: async () => {
            const res = await api.get<AutomationEntity[]>(`/lists/${listId}/automations`);
            return res.data;
        },
        enabled: listId !== undefined && listId !== '',
        staleTime: 60_000, // Fase 16.D
    });
}

export function useCreateAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateAutomationInput) => {
            const res = await api.post<AutomationEntity>(
                `/lists/${listId}/automations`,
                input,
            );
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista.
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

export function useUpdateAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: UpdateAutomationInput }) => {
            const res = await api.patch<AutomationEntity>(
                `/lists/${listId}/automations/${id}`,
                input,
            );
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista.
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

export function useDeleteAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/automations/${id}`);
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista.
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

export function useTriggerCatalog() {
    return useQuery({
        queryKey: automationsKeys.triggers,
        queryFn: async () => {
            const res = await api.get<TriggerMeta[]>('/triggers');
            return res.data;
        },
        staleTime: 5 * 60 * 1000,
    });
}

export function useActionCatalog() {
    return useQuery({
        queryKey: automationsKeys.actions,
        queryFn: async () => {
            const res = await api.get<ActionMeta[]>('/actions');
            return res.data;
        },
        staleTime: 5 * 60 * 1000,
    });
}

export function useAutomationRuns(automationId: number | undefined) {
    return useQuery({
        queryKey: automationsKeys.runs(automationId ?? 0),
        queryFn: async () => {
            const res = await api.get<AutomationRunEntity[]>(
                `/automations/${automationId}/runs`,
            );
            return res.data;
        },
        enabled: automationId !== undefined && automationId > 0,
    });
}
