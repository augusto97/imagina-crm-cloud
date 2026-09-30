import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    BULK_REVERT_CHUNK,
    type BulkEditLog,
    type BulkRevertPreview,
    type BulkRevertResult,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

import type { BulkApplyProgress } from './useBulkEdit';
import { invalidateForList, recordsKeys } from './useRecords';

/**
 * Historial de ediciones masivas y DESHACER (v0.1.218). El id numérico de la
 * lista va en el índice 1 de la key (regla de oro nº 7).
 */
export const bulkHistoryKeys = {
    all: ['bulk-history'] as const,
    forList: (listId: number) => ['bulk-history', listId] as const,
};

export function useBulkHistory(listId: number, enabled: boolean) {
    return useQuery({
        queryKey: bulkHistoryKeys.forList(listId),
        queryFn: async () => (await api.get<BulkEditLog[]>(`/lists/${listId}/bulk-edits`)).data,
        enabled: enabled && listId > 0,
        staleTime: 10_000,
    });
}

export function useBulkRevertPreview(listId: number) {
    return useMutation<BulkRevertPreview, Error, { editId: number }>({
        mutationFn: async ({ editId }) =>
            (await api.post<BulkRevertPreview>(`/lists/${listId}/bulk-edits/${editId}/revert/preview`, {})).data,
    });
}

/** Revierte en tandas de 100 filas con avance (cada tanda puede tocar la tienda). */
export function useBulkRevertApply(listId: number) {
    const qc = useQueryClient();
    return useMutation<
        BulkRevertResult,
        Error,
        { editId: number; itemIds: number[]; force: boolean; onProgress?: (p: BulkApplyProgress) => void }
    >({
        mutationFn: async ({ editId, itemIds, force, onProgress }) => {
            const out: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
            onProgress?.({ done: 0, total: itemIds.length });
            for (let i = 0; i < itemIds.length; i += BULK_REVERT_CHUNK) {
                const chunk = itemIds.slice(i, i + BULK_REVERT_CHUNK);
                try {
                    const res = (
                        await api.post<BulkRevertResult>(`/lists/${listId}/bulk-edits/${editId}/revert`, { item_ids: chunk, force })
                    ).data;
                    out.reverted += res.reverted;
                    out.conflicts += res.conflicts;
                    out.failed.push(...res.failed);
                } catch (err) {
                    out.failed.push({ item_id: 0, title: `${chunk.length} filas`, message: err instanceof Error ? err.message : 'Error' });
                }
                onProgress?.({ done: Math.min(itemIds.length, i + chunk.length), total: itemIds.length });
            }
            return out;
        },
        onSettled: () => {
            invalidateForList(qc, recordsKeys.all, listId);
            void qc.invalidateQueries({ queryKey: bulkHistoryKeys.forList(listId) });
        },
    });
}
