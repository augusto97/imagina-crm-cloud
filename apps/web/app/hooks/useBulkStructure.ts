import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    BULK_STRUCTURE_CHUNK,
    type BulkEditTarget,
    type BulkStructureAction,
    type BulkStructurePreview,
    type BulkStructureResult,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

import type { BulkApplyProgress } from './useBulkEdit';
import { bulkHistoryKeys } from './useBulkHistory';
import { invalidateForList, recordsKeys } from './useRecords';

/**
 * Acciones de estructura en lote (v0.1.220): mover como subtareas, duplicar
 * y borrar. Mismo contrato que la edición masiva: la vista previa resuelve
 * todo lo abarcado y devuelve los ids a tocar; aplicar los manda en tandas
 * de 200, todas en UNA entrada del historial (deshacer de una vez).
 */
export function useBulkStructurePreview(listId: number) {
    return useMutation<
        BulkStructurePreview,
        Error,
        { action: BulkStructureAction; target: BulkEditTarget; parent_id?: number | null; include_subtasks?: boolean }
    >({
        mutationFn: async (body) => (await api.post<BulkStructurePreview>(`/lists/${listId}/records/bulk-structure/preview`, body)).data,
    });
}

export function useBulkStructureApply(listId: number) {
    const qc = useQueryClient();
    return useMutation<
        BulkStructureResult,
        Error,
        {
            action: BulkStructureAction;
            ids: number[];
            parent_id?: number | null;
            include_subtasks?: boolean;
            onProgress?: (p: BulkApplyProgress) => void;
        }
    >({
        mutationFn: async ({ action, ids, parent_id, include_subtasks, onProgress }) => {
            const out: BulkStructureResult = { succeeded: [], unchanged: [], failed: [], created: 0, edit_id: null };
            onProgress?.({ done: 0, total: ids.length });
            for (let i = 0; i < ids.length; i += BULK_STRUCTURE_CHUNK) {
                const chunk = ids.slice(i, i + BULK_STRUCTURE_CHUNK);
                try {
                    const res = await api.post<BulkStructureResult>(`/lists/${listId}/records/bulk-structure`, {
                        action,
                        ids: chunk,
                        ...(parent_id !== undefined ? { parent_id } : {}),
                        include_subtasks: include_subtasks ?? false,
                        ...(out.edit_id ? { edit_id: out.edit_id } : {}),
                    });
                    out.edit_id = res.data.edit_id ?? out.edit_id;
                    out.succeeded.push(...res.data.succeeded);
                    out.unchanged.push(...res.data.unchanged);
                    out.failed.push(...res.data.failed);
                    out.created += res.data.created;
                } catch (err) {
                    // Límite del plan en duplicar: rebota la tanda entera, con su motivo.
                    const message = err instanceof Error ? err.message : 'Error';
                    out.failed.push(...chunk.map((id) => ({ id, message })));
                }
                onProgress?.({ done: Math.min(ids.length, i + chunk.length), total: ids.length });
            }
            return out;
        },
        onSettled: () => {
            invalidateForList(qc, recordsKeys.all, listId);
            void qc.invalidateQueries({ queryKey: bulkHistoryKeys.forList(listId) });
        },
    });
}
