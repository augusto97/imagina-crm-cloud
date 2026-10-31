import { useCallback, useRef } from 'react';
import type { BulkRevertPreview } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import { useBulkRevertApply } from '@/hooks/useBulkHistory';
import { useBulkStructureApply } from '@/hooks/useBulkStructure';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';

import { duplicateOutcome, undoDuplicateOutcome } from './quickDuplicate';

/** Si duplicar tarda más que esto, aparece «Duplicando…» mientras tanto. */
const SLOW_MS = 700;
/** El aviso con «Deshacer» se queda un poco más que uno común. */
const UNDO_TOAST_MS = 8000;

/**
 * v0.1.340 — Duplicar en UN clic (menú de la fila y barra de selección).
 *
 * Antes era un diálogo de tres pasos (opciones → vista previa → resultado
 * con «Listo»), aunque el registro no tuviera subtareas. Ahora se duplica
 * al instante con el mismo endpoint de las acciones de estructura (copia
 * todos los campos que se escriben a mano, deja la copia en el mismo nivel
 * y queda en el historial), y un aviso que se cierra solo dice cómo salió:
 * con «Deshacer» si salió, con el motivo si no.
 */
export function useQuickDuplicate(listId: number): (ids: number[], opts?: { includeSubtasks?: boolean; onDone?: () => void }) => Promise<void> {
    const toast = useToast();
    const apply = useBulkStructureApply(listId);
    const revert = useBulkRevertApply(listId);
    const running = useRef(false);

    const undo = useCallback(
        async (editId: number): Promise<void> => {
            try {
                const preview = (await api.post<BulkRevertPreview>(`/lists/${listId}/bulk-edits/${editId}/revert/preview`, {})).data;
                const ids = preview.item_ids;
                if (ids.length === 0) {
                    const out = undoDuplicateOutcome({ reverted: 0, conflicts: 0, failed: [] }, preview.conflict_ids.length);
                    toast.show({ ...out, duration: out.variant === 'error' ? 8000 : 6000 });
                    return;
                }
                const res = await revert.mutateAsync({ editId, itemIds: ids, force: false });
                const out = undoDuplicateOutcome(res, preview.conflict_ids.length);
                toast.show({ ...out, duration: out.variant === 'success' ? 4000 : 8000 });
            } catch (err) {
                toast.error(__('No se pudo deshacer'), err instanceof Error ? err.message : undefined);
            }
        },
        [listId, revert, toast],
    );

    return useCallback(
        async (ids, opts) => {
            if (ids.length === 0 || running.current) return;
            running.current = true;
            let slowToast: number | null = null;
            const timer = window.setTimeout(() => {
                slowToast = toast.show({
                    title: ids.length === 1 ? __('Duplicando…') : sprintf(__('Duplicando %s registros…'), formatNumber(ids.length)),
                    variant: 'info',
                    duration: 0,
                });
            }, SLOW_MS);
            try {
                const result = await apply.mutateAsync({ action: 'duplicate', ids, include_subtasks: opts?.includeSubtasks ?? true });
                const out = duplicateOutcome(ids.length, result);
                const editId = result.edit_id;
                toast.show({
                    title: out.title,
                    ...(out.description ? { description: out.description } : {}),
                    variant: out.variant,
                    duration: out.variant === 'error' || out.canUndo ? UNDO_TOAST_MS : 5000,
                    ...(out.canUndo && editId !== null ? { action: { label: __('Deshacer'), onClick: () => void undo(editId) } } : {}),
                });
                if (out.variant !== 'error') opts?.onDone?.();
            } catch (err) {
                toast.error(ids.length === 1 ? __('No se pudo duplicar el registro') : __('No se pudieron duplicar los registros'), err instanceof Error ? err.message : undefined);
            } finally {
                window.clearTimeout(timer);
                if (slowToast !== null) toast.dismiss(slowToast);
                running.current = false;
            }
        },
        [apply, toast, undo],
    );
}
