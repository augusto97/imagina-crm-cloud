import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DecideBookingInput, RecordBookingDto } from '@imagina-base/shared';

import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';

import { activityKeys } from './useActivity';

/**
 * v0.1.353 — La cita de un registro (agenda de citas) y aprobar o rechazar
 * una por confirmar. La clave vive bajo `records` con el id de la lista en el
 * índice 1 (regla de oro nº 7): el aviso realtime de la lista la refresca.
 */
export const recordBookingKeys = {
    forRecord: (listId: string | number, recordId: number) => ['records', String(listId), 'booking', recordId] as const,
};

export function useRecordBooking(listId: string | number | undefined, recordId: number | undefined, enabled = true) {
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: recordBookingKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<RecordBookingDto | null>(`/lists/${listId}/records/${recordId}/booking`)).data ?? null,
        enabled: enabled && !isGuest && listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        staleTime: 30_000,
        // El plan sin «Agenda de citas» o una lista sin agenda: no hay nada que mostrar.
        retry: false,
    });
}

export function useDecideBooking(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: DecideBookingInput) => (await api.post<RecordBookingDto>(`/lists/${listId}/records/${recordId}/booking/decide`, input)).data,
        onSuccess: (dto) => {
            qc.setQueryData(recordBookingKeys.forRecord(listId, recordId), dto);
            // El estado del registro cambió (Confirmada / Rechazada) y queda en la actividad.
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
        },
    });
}
