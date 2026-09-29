import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    BULK_EDIT_APPLY_CHUNK,
    type BulkEditPreview,
    type BulkEditResult,
    type BulkEditTarget,
    type BulkOperation,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

import { invalidateForList, recordsKeys } from './useRecords';

/**
 * Edición masiva (v0.1.216). La vista previa resuelve TODOS los registros
 * abarcados (seleccionados o por filtro) y devuelve los ids que cambian; la
 * aplicación los manda en tandas de 200 con avance. Cada tanda recalcula
 * sobre el valor del momento, así que lo que se escribe nunca parte de un
 * dato viejo.
 */
export function useBulkEditPreview(listId: number) {
    return useMutation<BulkEditPreview, Error, { target: BulkEditTarget; operations: BulkOperation[] }>({
        mutationFn: async (body) => {
            const res = await api.post<BulkEditPreview>(`/lists/${listId}/records/bulk-edit/preview`, body);
            return res.data;
        },
    });
}

export interface BulkApplyProgress {
    done: number;
    total: number;
}

export function useBulkEditApply(listId: number) {
    const qc = useQueryClient();
    return useMutation<
        BulkEditResult,
        Error,
        { ids: number[]; operations: BulkOperation[]; onProgress?: (p: BulkApplyProgress) => void }
    >({
        mutationFn: async ({ ids, operations, onProgress }) => {
            const out: BulkEditResult = { succeeded: [], unchanged: [], failed: [] };
            onProgress?.({ done: 0, total: ids.length });
            for (let i = 0; i < ids.length; i += BULK_EDIT_APPLY_CHUNK) {
                const chunk = ids.slice(i, i + BULK_EDIT_APPLY_CHUNK);
                try {
                    const res = await api.post<BulkEditResult>(`/lists/${listId}/records/bulk-edit`, { ids: chunk, operations });
                    out.succeeded.push(...res.data.succeeded);
                    out.unchanged.push(...res.data.unchanged);
                    out.failed.push(...res.data.failed);
                } catch (err) {
                    // Una tanda caída no tira las anteriores: se informa y se sigue.
                    const message = err instanceof Error ? err.message : 'Error';
                    out.failed.push(...chunk.map((id) => ({ id, message })));
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
