import { useCallback, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { checkRestoreValue, sameFieldValue, type FieldHistoryEntry } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatActivityValue } from '@/admin/activity/activityText';
import { isCloseCancelled } from '@/admin/records/dependencies/closeGuard';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { useUpdateRecord } from './useRecords';

import { fieldHistoryKeys } from './fieldHistoryKeys';

export { fieldHistoryKeys };

const PAGE = 20;

export function useFieldHistory(listId: string | number, recordId: number, fieldId: number, enabled = true) {
    return useInfiniteQuery({
        queryKey: fieldHistoryKeys.forField(listId, recordId, fieldId),
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => {
            const res = await api.get<FieldHistoryEntry[]>(`/lists/${listId}/records/${recordId}/fields/${fieldId}/history`, {
                query: { limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) },
            });
            return { data: res.data, next: (res.meta?.next_cursor as string | null | undefined) ?? null };
        },
        getNextPageParam: (last) => last.next,
        enabled: enabled && recordId > 0 && fieldId > 0,
        staleTime: 15_000,
    });
}

/** Lo que pasa al pedir «Restaurar»: se escribió, ya estaba o no se puede (con el motivo). */
export type RestoreOutcome = { ok: true; saved: RecordEntity | null } | { ok: false; reason: string };

/**
 * Vuelve a poner un valor del historial en un campo, por el PATCH normal (la
 * misma validación y el mismo ACL que editar a mano: el servidor tiene la
 * última palabra). Antes de intentarlo se revisa con el validador compartido
 * si el valor todavía sirve —la opción puede haberse borrado o el campo haber
 * cambiado de tipo— y, si no, se explica por qué en vez de mandarlo.
 */
export function useRestoreFieldValue(listId: string | number, recordId: number) {
    const update = useUpdateRecord(listId);
    const toast = useToast();
    const [pendingKey, setPendingKey] = useState<string | null>(null);

    const restore = useCallback(
        async (field: FieldEntity, value: unknown, currentValue: unknown, key = `${field.id}`): Promise<RestoreOutcome> => {
            const check = checkRestoreValue(field, value);
            if (!check.ok) {
                toast.info(__('No se puede restaurar ese valor'), check.reason);
                return { ok: false, reason: check.reason };
            }
            if (sameFieldValue(check.value, currentValue)) {
                toast.info(__('Ya es el valor actual'));
                return { ok: true, saved: null };
            }
            setPendingKey(key);
            try {
                const saved = await update.mutateAsync({ id: recordId, values: { [field.slug]: check.value } });
                const shown = formatActivityValue(field, check.value);
                toast.success(
                    shown === null
                        ? sprintf(/* translators: %s: field label */ __('Se vació «%s»'), field.label)
                        : sprintf(/* translators: 1: value, 2: field label */ __('Se restauró «%1$s» en «%2$s»'), shown, field.label),
                );
                return { ok: true, saved: saved ?? null };
            } catch (err) {
                // A8 — canceló el cierre de algo bloqueado (no es un error).
                if (isCloseCancelled(err)) return { ok: false, reason: __('Se canceló el cierre.') };
                const reason = err instanceof ApiError
                    ? (Object.values(err.errors ?? {})[0] ?? err.message)
                    : err instanceof Error
                      ? err.message
                      : __('Error desconocido');
                toast.error(__('No se pudo restaurar'), reason);
                return { ok: false, reason };
            } finally {
                setPendingKey(null);
            }
        },
        [recordId, toast, update],
    );

    return { restore, pendingKey };
}
