import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Recurrence, RecurrenceUpsertInput } from '@/types/recurrence';

const keys = {
    forRecord: (listId: number, recordId: number) =>
        ['recurrences', listId, recordId] as const,
    batch: (listId: number, ids: number[]) =>
        ['recurrences', listId, 'batch', ids.slice().sort((a, b) => a - b).join(',')] as const,
};

export function useRecurrences(listId: number | undefined, recordId: number | undefined) {
    return useQuery({
        queryKey: keys.forRecord(listId ?? 0, recordId ?? 0),
        queryFn: async () => {
            const res = await api.get<Recurrence[]>(
                `/lists/${listId}/records/${recordId}/recurrences`,
            );
            return res.data;
        },
        enabled: listId !== undefined && listId > 0 && recordId !== undefined && recordId > 0,
    });
}

/**
 * Trae las recurrencias de N records en una sola query (`/lists/X/
 * recurrences?ids=1,2,3,...`). Reemplaza el N+1 que existía cuando
 * cada celda de fecha pegaba al endpoint individual. La respuesta es
 * `{record_id: Recurrence[]}` y los consumers la indexan por id para
 * decidir si pintar el icono de recurrencia.
 */
export function useRecurrencesBatch(
    listId: number | undefined,
    recordIds: number[],
) {
    return useQuery({
        queryKey: keys.batch(listId ?? 0, recordIds),
        queryFn: async () => {
            const res = await api.get<Record<string, Recurrence[]>>(
                `/lists/${listId}/recurrences?ids=${recordIds.join(',')}`,
            );
            return res.data;
        },
        enabled:
            listId !== undefined && listId > 0 && recordIds.length > 0,
    });
}

export function useUpsertRecurrence(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation<Recurrence, Error, RecurrenceUpsertInput>({
        mutationFn: async (input) => {
            const res = await api.post<Recurrence>(
                `/lists/${listId}/records/${recordId}/recurrences`,
                input,
            );
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: keys.forRecord(listId, recordId) });
        },
    });
}

/**
 * Context que expone un map `record_id → Recurrence[]` precargado
 * con UNA sola query batch. El proveedor (TableView/GroupedTableView)
 * sabe qué records están visibles; los consumers
 * (`useRecurrencesForRecord`) leen del map sin disparar queries
 * propias. Sin esto, cada celda de fecha hacía un fetch individual
 * (N+1 problem).
 */
interface RecurrencesBatchContextValue {
    /** Map record_id (string) → recurrencias. Vacío si no hay batch activo. */
    byRecord: Record<string, Recurrence[]>;
    /** True si la query del provider está cargando. */
    isLoading: boolean;
}

const RecurrencesBatchContext = createContext<RecurrencesBatchContextValue | null>(null);

export interface RecurrencesBatchProviderProps {
    listId: number | undefined;
    recordIds: number[];
    children: ReactNode;
}

/**
 * Wrap a una sección de UI que muestra varios records con cells de
 * fecha. Hace UN solo fetch al batch endpoint; las celdas leen vía
 * `useRecurrencesForRecord` sin queries individuales.
 */
export function RecurrencesBatchProvider({
    listId,
    recordIds,
    children,
}: RecurrencesBatchProviderProps): JSX.Element {
    const query = useRecurrencesBatch(listId, recordIds);
    const value = useMemo<RecurrencesBatchContextValue>(
        () => ({
            byRecord: query.data ?? {},
            isLoading: query.isLoading,
        }),
        [query.data, query.isLoading],
    );
    return createElement(RecurrencesBatchContext.Provider, { value }, children);
}

/**
 * Lee las recurrencias de un record. Si está dentro de un
 * `RecurrencesBatchProvider`, lee del context (cero queries).
 * Si no, fallback al fetch individual (`useRecurrences`).
 *
 * Devuelve `{data, isLoading}` con el shape mínimo que
 * `EditableCell` usa.
 */
export function useRecurrencesForRecord(
    listId: number | undefined,
    recordId: number | undefined,
): { data: Recurrence[] | undefined; isLoading: boolean } {
    const ctx = useContext(RecurrencesBatchContext);
    // Hooks rules: ambos hooks (context + useRecurrences) deben
    // llamarse siempre, no condicionalmente. El individual queda
    // disabled si hay context (recordId pasa undefined).
    const individual = useRecurrences(
        ctx === null ? listId : undefined,
        ctx === null ? recordId : undefined,
    );
    if (ctx !== null) {
        return {
            data: recordId !== undefined ? ctx.byRecord[String(recordId)] : undefined,
            isLoading: ctx.isLoading,
        };
    }
    return { data: individual.data, isLoading: individual.isLoading };
}

export function useDeleteRecurrence(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation<void, Error, number>({
        mutationFn: async (id) => {
            await api.delete(
                `/lists/${listId}/records/${recordId}/recurrences/${id}`,
            );
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: keys.forRecord(listId, recordId) });
        },
    });
}
