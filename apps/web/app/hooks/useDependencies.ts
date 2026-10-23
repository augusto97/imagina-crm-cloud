import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CreateDependencyInput,
    DependencySettings,
    RecordDependencies,
    UpdateDependencySettingsInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

import { dependencyKeys, fetchRecordDependencies } from './dependencyKeys';
import { listsKeys } from './useLists';
import { invalidateForList, markLocalRecordsChange, recordsKeys } from './useRecords';

export { dependencyKeys, fetchRecordDependencies };

/**
 * A8 — Dependencias entre registros («bloquea» / «bloqueado por»).
 *
 * Las keys cuelgan del namespace de los registros de la lista: cualquier
 * cambio (edición, realtime, otra pestaña) refresca los chips — p. ej. el
 * bloqueante que pasa a «Completado» deja de contar como abierto. La ficha
 * las trae sembradas en su bundle (`useRecordView`).
 */
export const EMPTY_DEPENDENCIES: RecordDependencies = { blocked_by: [], blocks: [] };

export function useRecordDependencies(listId: string | number | undefined, recordId: number | undefined) {
    return useQuery({
        queryKey: dependencyKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: () => fetchRecordDependencies(listId!, recordId!),
        enabled: listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        staleTime: 15_000,
    });
}

function useRefreshList(listId: string | number) {
    const qc = useQueryClient();
    return () => {
        markLocalRecordsChange(qc, listId);
        // Los chips, el icono «bloqueado» de la tabla/kanban y el Gantt.
        invalidateForList(qc, recordsKeys.all, listId);
    };
}

/** Agregar desde la ficha: «este registro está bloqueado por X» / «bloquea a X». */
export function useAddDependency(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    const refresh = useRefreshList(listId);
    return useMutation({
        mutationFn: async (input: CreateDependencyInput) =>
            (await api.post<RecordDependencies>(`/lists/${listId}/records/${recordId}/dependencies`, input)).data,
        onSuccess: (data) => {
            qc.setQueryData(dependencyKeys.forRecord(listId, recordId), data);
            refresh();
        },
    });
}

export function useRemoveDependency(listId: string | number, recordId: number) {
    const refresh = useRefreshList(listId);
    return useMutation({
        mutationFn: async (depId: number) => {
            await api.delete(`/lists/${listId}/records/${recordId}/dependencies/${depId}`);
        },
        onSuccess: refresh,
    });
}

/** Alta por las dos puntas (Gantt: arrastrar del borde de una barra a otra). */
export function useAddDependencyPair(listId: string | number) {
    const refresh = useRefreshList(listId);
    return useMutation({
        mutationFn: async (input: { blocker_id: number; blocked_id: number; lag_days?: number }) =>
            (await api.post<{ id: number; blocker_id: number; blocked_id: number; lag_days: number; created: boolean }>(`/lists/${listId}/dependencies`, input))
                .data,
        onSuccess: refresh,
    });
}

/** Quitar por id (la flecha del Gantt). */
export function useRemoveDependencyById(listId: string | number) {
    const refresh = useRefreshList(listId);
    return useMutation({
        mutationFn: async (depId: number) => {
            await api.delete(`/lists/${listId}/dependencies/${depId}`);
        },
        onSuccess: refresh,
    });
}

export function useDependencySettings(listId: string | number | undefined) {
    return useQuery({
        queryKey: dependencyKeys.settings(listId ?? ''),
        queryFn: async () => (await api.get<DependencySettings>(`/lists/${listId}/dependencies/settings`)).data,
        enabled: listId !== undefined && listId !== '',
    });
}

/** Reprogramación en cadena (ajuste de la LISTA, pide `manage_lists`). */
export function useUpdateDependencySettings(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: UpdateDependencySettingsInput) =>
            (await api.patch<DependencySettings>(`/lists/${listId}/dependencies/settings`, patch)).data,
        onSuccess: (data) => {
            qc.setQueryData(dependencyKeys.settings(listId), data);
            invalidateForList(qc, recordsKeys.all, listId);
            // Vive en `settings` de la lista (el detalle va por id o slug).
            void qc.invalidateQueries({ queryKey: listsKeys.all });
        },
    });
}
