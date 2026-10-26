import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkloadBundle, WorkloadCapacity, WorkloadEstimateUnit, WorkloadMetric, WorkloadZoom } from '@imagina-base/shared';

import { api } from '@/lib/api';

import { keepPreviousForList, recordsKeys } from './useRecords';

/**
 * B2 — Vista «Carga de trabajo»: TODO lo que dibuja la vista en UNA request
 * (`GET /lists/:l/records/workload-bundle`, regla de oro nº 8): las personas,
 * la grilla persona × columna, los totales, los registros sin fecha y los
 * registros que viajan para el panel y el arrastre.
 *
 * La key cuelga de `recordsKeys.forList(listId)`: una edición, el realtime o
 * un alta la refrescan sin código propio. El cambio de capacidad avisa por
 * realtime con `records` (sin lista) y también la refresca.
 */
export interface WorkloadBundleArgs {
    listId: number | string | undefined;
    from: string;
    to: string;
    zoom: WorkloadZoom;
    metric: WorkloadMetric;
    personFieldId: number | null;
    startFieldId: number | null;
    endFieldId: number | null;
    estimateFieldId: number | null;
    estimateUnit: WorkloadEstimateUnit;
    hideDone: boolean;
    /** Personas visibles (`null` = todas). */
    userIds: number[] | null;
    /** C1 — sólo las personas de este equipo (lo resuelve el servidor). */
    teamId?: number | null;
    showUnassigned: boolean;
    filterTree?: unknown;
    search?: string;
}

/** Parámetros con orden estable (key estable → sin refetch inútil). */
export function workloadBundleParams(args: WorkloadBundleArgs): Record<string, unknown> {
    const params: Record<string, unknown> = {
        from: args.from,
        to: args.to,
        zoom: args.zoom,
        metric: args.metric,
        person_field_id: args.personFieldId,
        hide_done: args.hideDone ? 1 : 0,
    };
    if (args.startFieldId) params.start_field_id = args.startFieldId;
    if (args.endFieldId) params.end_field_id = args.endFieldId;
    if (args.metric === 'estimate' && args.estimateFieldId) {
        params.estimate_field_id = args.estimateFieldId;
        params.unit = args.estimateUnit;
    }
    if (args.userIds !== null) params.users = [...args.userIds].sort((a, b) => a - b).join(',');
    if (args.teamId) params.team = args.teamId;
    if (!args.showUnassigned) params.unassigned = 0;
    if (args.filterTree) params.filter_tree = JSON.stringify(args.filterTree);
    if (args.search && args.search.trim() !== '') params.search = args.search.trim();
    return params;
}

export const workloadKeys = {
    bundle: (listId: string | number, params: Record<string, unknown>) =>
        [...recordsKeys.forList(listId), 'workload-bundle', params] as const,
    people: (listId: string | number) => [...recordsKeys.forList(listId), 'workload-people'] as const,
};

/** El bundle de la carga (no se pide sin persona, ni sin fecha salvo en «Tiempo registrado»). */
export function useWorkloadBundle(args: WorkloadBundleArgs) {
    const qc = useQueryClient();
    const listId = args.listId ?? '';
    const params = workloadBundleParams(args);
    const ready =
        listId !== ''
        && args.personFieldId !== null
        && (args.metric === 'time' || args.startFieldId !== null || args.endFieldId !== null)
        && (args.metric !== 'estimate' || args.estimateFieldId !== null);
    return useQuery({
        queryKey: workloadKeys.bundle(listId, params),
        queryFn: async () => (await api.get<WorkloadBundle>(`/lists/${listId}/records/workload-bundle`, { query: params })).data,
        enabled: ready,
        // Navegar o cambiar el zoom deja la grilla anterior a la vista mientras
        // llega la nueva: no parpadea.
        placeholderData: keepPreviousForList<WorkloadBundle>(qc, listId),
    });
}

export interface WorkloadMember {
    user_id: number;
    name: string;
    email: string;
    capacity: WorkloadCapacity;
    capacity_custom: boolean;
}

/** Las personas que pueden ver la lista (el selector de «Personas visibles»). */
export function useWorkloadPeople(listId: number | string | undefined, enabled = true) {
    return useQuery({
        queryKey: workloadKeys.people(listId ?? ''),
        queryFn: async () => (await api.get<WorkloadMember[]>(`/lists/${listId}/workload-people`)).data,
        enabled: enabled && listId !== undefined && listId !== '',
        staleTime: 60_000,
    });
}

/**
 * Cambiar (o volver al valor por defecto, con `null`) la capacidad de una
 * persona. Refresca TODA vista de carga abierta: la capacidad es de la persona
 * en el workspace, no de una lista.
 */
export function useSetWorkloadCapacity() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { userId: number; capacity: WorkloadCapacity | null }) =>
            (await api.patch<WorkloadMember>(`/workload/capacity/${input.userId}`, { capacity: input.capacity })).data,
        onSuccess: () =>
            qc.invalidateQueries({
                predicate: (q) => q.queryKey[0] === recordsKeys.all[0] && (q.queryKey[2] === 'workload-bundle' || q.queryKey[2] === 'workload-people'),
            }),
    });
}
