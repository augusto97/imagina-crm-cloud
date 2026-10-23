import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { RecordEntity } from '@/types/record';

import { keepPreviousForList, recordsKeys } from './useRecords';

/**
 * v0.1.297 — Kanban para ventas (B5): el tablero entero en UNA request
 * (`GET /lists/:l/records/kanban-bundle`). Los totales de cada columna,
 * carril y celda los calcula el servidor sobre TODO lo que coincide con la
 * vista; las tarjetas vienen de a tandas por celda («Mostrar más»).
 *
 * La key cuelga de `recordsKeys.forList(listId)`: cualquier cambio de
 * registros de la lista (mutaciones, realtime) la refresca, y el optimista de
 * `useUpdateRecord` la parcha con `patchRecordInCache` (rama `cells`).
 */
export interface KanbanCell {
    count: number;
    total: number | null;
    /** null = la celda no se cargó (columna o carril plegado). */
    records: RecordEntity[] | null;
    has_more: boolean;
}

export interface KanbanBundleResponse {
    meta: {
        group_by_field_id: number;
        group_by_slug: string;
        group_by_type: string;
        lane_field_id?: number;
        lane_slug?: string;
        lane_type?: string;
        value_field_id: number | null;
        value_metric: 'sum' | 'avg';
        total_records: number;
        total_value: number | null;
        per_cell: number;
        hidden_columns: number;
        hidden_lanes: number;
    };
    columns: Array<{ value: string | null; count: number; total: number | null }>;
    lanes?: Array<{ value: string | null; count: number; total: number | null }>;
    cells: Record<string, KanbanCell>;
}

export interface UseKanbanBundleArgs {
    listId: number | string | undefined;
    groupBy: number | undefined;
    laneBy?: number | null;
    valueFieldId?: number | null;
    valueMetric?: 'sum' | 'avg';
    filterTree?: unknown;
    search?: string;
    /** `field_{id}:{dir},…` (el orden de la vista); sin orden, lo actualizado hace poco primero. */
    sort?: string;
    /** Clave de celda → cuántas tarjetas traer («Mostrar más»). */
    limits?: Record<string, number>;
    /** Columnas (claves) que no traen tarjetas: plegadas u ocultas. */
    skip?: string[];
    /** Carriles plegados. */
    skipLanes?: string[];
    perCell?: number;
}

/** Parámetros del endpoint con orden estable (key estable → sin refetch inútil). */
export function kanbanBundleParams(args: UseKanbanBundleArgs): Record<string, unknown> {
    const params: Record<string, unknown> = { group_by: args.groupBy };
    if (args.laneBy) params.lane_by = args.laneBy;
    if (args.valueFieldId) {
        params.value_field = args.valueFieldId;
        if (args.valueMetric === 'avg') params.value_metric = 'avg';
    }
    if (args.filterTree) params.filter_tree = JSON.stringify(args.filterTree);
    if (args.search && args.search.trim() !== '') params.search = args.search.trim();
    if (args.sort) params.sort = args.sort;
    if (args.perCell) params.per_cell = args.perCell;
    const limits = Object.entries(args.limits ?? {})
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (limits.length > 0) params.limits = JSON.stringify(Object.fromEntries(limits));
    const skip = [...new Set(args.skip ?? [])].sort();
    if (skip.length > 0) params.skip = JSON.stringify(skip);
    const skipLanes = [...new Set(args.skipLanes ?? [])].sort();
    if (args.laneBy && skipLanes.length > 0) params.skip_lanes = JSON.stringify(skipLanes);
    return params;
}

export function useKanbanBundle(args: UseKanbanBundleArgs) {
    const qc = useQueryClient();
    const listId = args.listId ?? '';
    const params = kanbanBundleParams(args);
    return useQuery({
        queryKey: [...recordsKeys.forList(listId), 'kanban-bundle', params] as const,
        queryFn: async () => {
            const res = await api.get<KanbanBundleResponse>(`/lists/${listId}/records/kanban-bundle`, { query: params });
            return res.data;
        },
        enabled: listId !== '' && args.groupBy !== undefined && args.groupBy > 0,
        placeholderData: keepPreviousForList<KanbanBundleResponse>(qc, listId),
    });
}
