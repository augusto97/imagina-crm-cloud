import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';

/** v0.1.277 (ADR-S41) — Campos con IA: recalcular, llenar la columna y su estado. */
export interface AiFieldStatus {
    last_error: { message: string; record_id: number; at: string } | null;
    pending_estimate: number;
}

export function useRunAiField(listId: number | string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { recordId: number; fieldId: number }) =>
            (await api.post<{ value: string | null }>(`/lists/${listId}/records/${input.recordId}/ai-fields/${input.fieldId}/run`)).data,
        onSuccess: () => invalidateForList(qc, recordsKeys.all, listId),
    });
}

export function useFillAiField(listId: number, fieldId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (onlyEmpty: boolean) =>
            (await api.post<{ queued: number; capped: boolean; reason?: string }>(`/lists/${listId}/fields/${fieldId}/ai-fill`, { only_empty: onlyEmpty })).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-field-status', fieldId] }),
    });
}

export function useAiFieldStatus(listId: number | undefined, fieldId: number | undefined) {
    return useQuery({
        queryKey: ['ai-field-status', fieldId],
        queryFn: async () => (await api.get<AiFieldStatus>(`/lists/${listId}/fields/${fieldId}/ai-status`)).data,
        enabled: !!listId && !!fieldId,
        staleTime: 10_000,
    });
}
