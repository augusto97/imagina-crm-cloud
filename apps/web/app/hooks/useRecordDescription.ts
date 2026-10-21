import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RichDoc } from '@imagina-base/shared';

import { api } from '@/lib/api';
import type { RecordEntity, RecordListResponse } from '@/types/record';

import { activityKeys } from './useActivity';
import { canonicalListId, listIdentifiersFor, markLocalRecordsChange } from './useRecords';

/**
 * Descripción rica de un registro (v0.1.133).
 *
 * Vive en su propia query porque el CONTENIDO no viaja en el listado (sólo el
 * booleano `has_description`): se pide al abrir la ficha y se guarda solo.
 *
 * Namespace PROPIO (no dentro de `records`): antes cada autoguardado
 * invalidaba TODOS los records de la lista para refrescar ese booleano — dos
 * GET de 200 filas y dos de la descripción por cada pausa al escribir. El id
 * canónico de la lista va en el índice 1 (regla de oro nº 7).
 */
export const descriptionKeys = {
    all: ['record-description'] as const,
    forRecord: (listId: string | number, recordId: number) =>
        [...descriptionKeys.all, String(listId), recordId] as const,
};

interface DescriptionResponse {
    description: RichDoc | null;
}

export function useRecordDescription(
    listKey: string | number,
    recordId: number | null,
): { data: RichDoc | null | undefined; isLoading: boolean } {
    const qc = useQueryClient();
    const query = useQuery({
        queryKey: descriptionKeys.forRecord(canonicalListId(qc, listKey), recordId ?? 0),
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

/**
 * Pone `has_description` del registro en los caches de la lista SIN pedir
 * nada: es el único dato del listado que cambia al guardar la descripción.
 */
export function setHasDescription(qc: QueryClient, listKey: string | number, recordId: number, has: boolean): void {
    const ids = listIdentifiersFor(qc, listKey);
    const matches = (k: readonly unknown[]): boolean =>
        Array.isArray(k) && k[0] === 'records' && typeof k[1] === 'string' && ids.has(k[1]);
    for (const [key, data] of qc.getQueriesData<unknown>({ predicate: (q) => matches(q.queryKey) })) {
        if (!data || typeof data !== 'object') continue;
        const list = data as RecordListResponse;
        if (Array.isArray(list.data)) {
            if (!list.data.some((r) => r.id === recordId && r.has_description !== has)) continue;
            qc.setQueryData(key, {
                ...list,
                data: list.data.map((r) => (r.id === recordId ? { ...r, has_description: has } : r)),
            });
            continue;
        }
        const one = data as RecordEntity;
        if (one.id === recordId && one.has_description !== has) {
            qc.setQueryData(key, { ...one, has_description: has });
        }
    }
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
            qc.setQueryData(descriptionKeys.forRecord(canonicalListId(qc, listKey), recordId), saved);
            setHasDescription(qc, listKey, recordId, saved !== null);
            // El aviso de realtime de ESTE guardado vuelve en un instante: es
            // nuestro, no hay que refrescar la lista por él.
            markLocalRecordsChange(qc, listKey);
            // La actividad suma "editó la descripción": queda vencida, se
            // refresca la próxima vez que se mire (no en cada pausa al escribir).
            const ids = listIdentifiersFor(qc, listKey);
            void qc.invalidateQueries({
                predicate: (q) => q.queryKey[0] === activityKeys.all[0] && typeof q.queryKey[1] === 'string' && ids.has(q.queryKey[1]),
                refetchType: 'none',
            });
        },
    });
}
