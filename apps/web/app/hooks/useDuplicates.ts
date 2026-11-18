import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    DuplicateGroupsPage,
    DuplicateMatch,
    DuplicateSettings,
    DuplicateSettingsInput,
    MergePreview,
    MergeRecordsInput,
    MergeResult,
} from '@imagina-base/shared';

import { api } from '@/lib/api';
import { invalidateWorkspaceData } from '@/lib/workspaceInvalidate';

import { bulkHistoryKeys } from './useBulkHistory';
import { invalidateForList, recordsKeys } from './useRecords';

/**
 * A14 (v0.1.445, ADR-S106) — Duplicados de una lista. El id numérico de la
 * lista va en el índice 1 de la key (regla de oro nº 7): así un cambio de
 * registros por tiempo real (`invalidateForList`) también refresca los grupos.
 */
export const duplicatesKeys = {
    all: ['duplicates'] as const,
    forList: (listId: number) => ['duplicates', listId] as const,
    settings: (listId: number) => ['duplicates', listId, 'settings'] as const,
    groups: (listId: number, limit: number) => ['duplicates', listId, 'groups', limit] as const,
    record: (listId: number, recordId: number) => ['duplicates', listId, 'record', recordId] as const,
    check: (listId: number, signature: string) => ['duplicates', listId, 'check', signature] as const,
    merge: (listId: number, primaryId: number, ids: readonly number[]) => ['duplicates', listId, 'merge', primaryId, ids.join(',')] as const,
};

export function useDuplicateSettings(listId: number, enabled = true) {
    return useQuery({
        queryKey: duplicatesKeys.settings(listId),
        queryFn: async () => (await api.get<DuplicateSettings>(`/lists/${listId}/duplicates/settings`)).data,
        enabled: enabled && listId > 0,
        staleTime: 60_000,
    });
}

export function useUpdateDuplicateSettings(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: DuplicateSettingsInput) => (await api.put<DuplicateSettings>(`/lists/${listId}/duplicates/settings`, input)).data,
        onMutate: async (input) => {
            await qc.cancelQueries({ queryKey: duplicatesKeys.settings(listId) });
            const prev = qc.getQueryData<DuplicateSettings>(duplicatesKeys.settings(listId));
            if (prev) {
                qc.setQueryData<DuplicateSettings>(duplicatesKeys.settings(listId), {
                    ...prev,
                    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
                    ...(input.warn_on_create !== undefined ? { warn_on_create: input.warn_on_create } : {}),
                });
            }
            return { prev };
        },
        onError: (_err, _input, ctx) => {
            if (ctx?.prev) qc.setQueryData(duplicatesKeys.settings(listId), ctx.prev);
        },
        onSettled: () => void qc.invalidateQueries({ queryKey: duplicatesKeys.forList(listId) }),
    });
}

/** Los grupos del panel «Duplicados» (se piden sólo con el panel abierto). */
export function useDuplicateGroups(listId: number, enabled: boolean, limit = 20) {
    return useQuery({
        queryKey: duplicatesKeys.groups(listId, limit),
        queryFn: async () => (await api.get<DuplicateGroupsPage>(`/lists/${listId}/duplicates?limit=${limit}`)).data,
        enabled: enabled && listId > 0,
        staleTime: 0,
    });
}

/** Los posibles duplicados de un registro (banner de la ficha). */
export function useRecordDuplicates(listId: number, recordId: number, enabled = true) {
    return useQuery({
        queryKey: duplicatesKeys.record(listId, recordId),
        queryFn: async () => (await api.get<DuplicateMatch[]>(`/lists/${listId}/duplicates/record/${recordId}`)).data,
        enabled: enabled && listId > 0 && recordId > 0,
        staleTime: 30_000,
        retry: false,
    });
}

/**
 * Lo que se está escribiendo en el alta ¿ya existe? La firma son los valores
 * que sirven para reconocer duplicados (el componente la arma con debounce).
 */
export function useDuplicateCheck(listId: number, values: Record<string, unknown> | null, signature: string) {
    return useQuery({
        queryKey: duplicatesKeys.check(listId, signature),
        queryFn: async () => (await api.post<DuplicateMatch[]>(`/lists/${listId}/duplicates/check`, { values: values ?? {} })).data,
        enabled: listId > 0 && values !== null && signature !== '',
        staleTime: 30_000,
        retry: false,
    });
}

export function useDismissDuplicates(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (ids: number[]) => (await api.post<{ pairs: number }>(`/lists/${listId}/duplicates/dismiss`, { ids })).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: duplicatesKeys.forList(listId) }),
    });
}

export function useMergePreview(listId: number, primaryId: number, duplicateIds: readonly number[], enabled: boolean) {
    return useQuery({
        queryKey: duplicatesKeys.merge(listId, primaryId, duplicateIds),
        queryFn: async () =>
            (await api.post<MergePreview>(`/lists/${listId}/duplicates/merge/preview`, { primary_id: primaryId, duplicate_ids: [...duplicateIds] })).data,
        enabled: enabled && listId > 0 && primaryId > 0 && duplicateIds.length > 0,
        staleTime: 0,
        retry: false,
    });
}

export function useMergeRecords(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: MergeRecordsInput) => (await api.post<MergeResult>(`/lists/${listId}/duplicates/merge`, input)).data,
        // Fusionar mueve comentarios, vínculos (también de OTRAS listas),
        // subtareas y más: se refresca todo lo que puede haber cambiado.
        onSuccess: async () => {
            invalidateForList(qc, recordsKeys.all, listId);
            void qc.invalidateQueries({ queryKey: bulkHistoryKeys.forList(listId) });
            await invalidateWorkspaceData(qc);
        },
    });
}
