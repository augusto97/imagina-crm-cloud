import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RichDoc } from '@imagina-base/shared';

import { api } from '@/lib/api';

import { invalidateForList, recordsKeys } from './useRecords';

/**
 * Descripción rica de un registro (v0.1.133).
 *
 * Vive en su propia query porque el CONTENIDO no viaja en el listado (sólo el
 * booleano `has_description`): se pide al abrir la ficha y se guarda solo.
 */
export const descriptionKeys = {
    forRecord: (listKey: string | number, recordId: number) =>
        [...recordsKeys.forList(listKey), 'description', recordId] as const,
};

interface DescriptionResponse {
    description: RichDoc | null;
}

export function useRecordDescription(
    listKey: string | number,
    recordId: number | null,
): { data: RichDoc | null | undefined; isLoading: boolean } {
    const query = useQuery({
        queryKey: descriptionKeys.forRecord(listKey, recordId ?? 0),
        queryFn: async () => {
            const res = await api.get<DescriptionResponse>(
                `/lists/${listKey}/records/${recordId}/description`,
            );
            return res.data?.description ?? null;
        },
        enabled: recordId !== null,
        // El documento cambia poco y lo reescribe quien lo edita: no hace
        // falta refetch al enfocar la ventana.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
    return { data: query.data, isLoading: query.isLoading };
}

export function useUpdateRecordDescription(listKey: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (description: RichDoc | null) => {
            const res = await api.patch<DescriptionResponse>(
                `/lists/${listKey}/records/${recordId}/description`,
                { description },
            );
            return res.data?.description ?? null;
        },
        onSuccess: (saved) => {
            qc.setQueryData(descriptionKeys.forRecord(listKey, recordId), saved);
            // El listado muestra un icono si el registro TIENE descripción:
            // al crear/borrar la primera, esa fila cambia. Se invalida por
            // id↔slug (regla de oro nº 7 — el par de identificadores).
            invalidateForList(qc, recordsKeys.all, listKey);
        },
    });
}
