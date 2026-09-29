import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    STORE_BULK_APPLY_CHUNK,
    type StoreBulkCatalog,
    type StoreBulkOperation,
    type StoreBulkPreview,
    type StoreBulkResult,
    type StoreBulkTarget,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

import type { BulkApplyProgress } from './useBulkEdit';
import { invalidateForList, recordsKeys } from './useRecords';

/**
 * Edición masiva de la tienda (v0.1.217): el catálogo de la tienda (categorías,
 * etiquetas, atributos, clases de envío e impuestos), la vista previa y la
 * aplicación en tandas de 25 registros con avance.
 */
export function useStoreBulkCatalog(listId: number, enabled: boolean) {
    return useQuery({
        queryKey: ['store-bulk', 'catalog', listId],
        queryFn: async () => (await api.get<StoreBulkCatalog>(`/lists/${listId}/store-bulk/catalog`)).data,
        enabled,
        staleTime: 60_000,
    });
}

export function useStoreAttributeTerms(listId: number, attributeId: number | null) {
    return useQuery({
        queryKey: ['store-bulk', 'terms', listId, attributeId],
        queryFn: async () => (await api.get<Array<{ slug: string; name: string }>>(`/lists/${listId}/store-bulk/attributes/${attributeId}/terms`)).data,
        enabled: attributeId !== null && attributeId > 0,
        staleTime: 60_000,
    });
}

export function useStoreBulkPreview(listId: number) {
    return useMutation<StoreBulkPreview, Error, { target: StoreBulkTarget; operations: StoreBulkOperation[]; include_variations: boolean }>({
        mutationFn: async (body) => (await api.post<StoreBulkPreview>(`/lists/${listId}/store-bulk/preview`, body)).data,
    });
}

export function useStoreBulkApply(listId: number) {
    const qc = useQueryClient();
    return useMutation<
        StoreBulkResult,
        Error,
        { ids: number[]; operations: StoreBulkOperation[]; include_variations: boolean; onProgress?: (p: BulkApplyProgress) => void }
    >({
        mutationFn: async ({ ids, operations, include_variations, onProgress }) => {
            const out: StoreBulkResult = { updated: 0, unchanged: 0, failed: [], skipped: [] };
            onProgress?.({ done: 0, total: ids.length });
            for (let i = 0; i < ids.length; i += STORE_BULK_APPLY_CHUNK) {
                const chunk = ids.slice(i, i + STORE_BULK_APPLY_CHUNK);
                try {
                    const res = (await api.post<StoreBulkResult>(`/lists/${listId}/store-bulk/apply`, { ids: chunk, operations, include_variations })).data;
                    out.updated += res.updated;
                    out.unchanged += res.unchanged;
                    out.failed.push(...res.failed);
                    out.skipped.push(...res.skipped);
                } catch (err) {
                    // Una tanda caída no tira las demás: se informa y se sigue.
                    out.failed.push({ title: `${chunk.length} registros`, message: err instanceof Error ? err.message : 'Error' });
                }
                onProgress?.({ done: Math.min(ids.length, i + chunk.length), total: ids.length });
            }
            return out;
        },
        onSettled: () => {
            invalidateForList(qc, recordsKeys.all, listId);
        },
    });
}
