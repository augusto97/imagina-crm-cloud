import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { FilterTree } from '@/types/record';

/**
 * Resultado del endpoint `/records/aggregates`.
 *
 * `totals` agrupa los agregados por slug del field. Cada uno tiene
 * un objeto con las claves `sum`, `avg`, `count`, `min`, `max`,
 * `count_true`, `count_false`, `count_empty` — qué claves vienen
 * depende del tipo del field (number → sum/avg/count/min/max,
 * date → min/max/count, checkbox → count_true/count_false/count, etc.).
 *
 * `groups` solo viene cuando el caller pasó `groupByFieldId`. Cada
 * entry trae el `value` del bucket (o `null` para "(sin valor)") y
 * los agregados calculados solo dentro de ese bucket.
 */
export interface AggregateBag {
    sum?: number | null;
    avg?: number | null;
    count?: number;
    count_unique?: number;
    min?: number | string | null;
    max?: number | string | null;
    count_true?: number;
    count_false?: number;
    count_empty?: number;
}

export interface AggregatesResponse {
    totals: Record<string, AggregateBag>;
    groups: Array<{ value: string | null; aggregates: Record<string, AggregateBag> }>;
}

interface UseAggregatesArgs {
    listSlug: string | undefined;
    fieldIds: number[];
    filterTree?: FilterTree;
    groupByFieldId?: number | null;
}

/**
 * Pide los agregados de las columnas visibles. Solo dispara cuando
 * hay al menos un field con tipo numérico/fecha/etc — el caller
 * filtra por `field.type` antes de pasarnos los IDs.
 *
 * Cache key incluye filterTree (JSON-stringified) para que cambios
 * de filtro inviden el cache automáticamente.
 */
export function useAggregates({
    listSlug,
    fieldIds,
    filterTree,
    groupByFieldId,
}: UseAggregatesArgs) {
    const filterKey = filterTree && filterTree.children.length > 0
        ? JSON.stringify(filterTree)
        : null;

    return useQuery({
        queryKey: ['aggregates', listSlug, fieldIds.join(','), filterKey, groupByFieldId ?? 0] as const,
        queryFn: async () => {
            const params = new URLSearchParams();
            params.set('fields', fieldIds.join(','));
            if (filterKey !== null) {
                params.set('filter_tree', filterKey);
            }
            if (groupByFieldId !== null && groupByFieldId !== undefined) {
                params.set('group_by', String(groupByFieldId));
            }
            const res = await api.get<AggregatesResponse>(
                `/lists/${listSlug}/records/aggregates?${params.toString()}`,
            );
            return res.data;
        },
        enabled: listSlug !== undefined && fieldIds.length > 0,
        // 0.36.7: alineado con el resto de hooks (useRecords, useDashboards,
        // useFields → 30s). Antes estaba en 0 y refetcheaba el endpoint
        // pesado de aggregates cada vez que se invalidaba records — en
        // sesiones largas eso quemaba CPU del front (parsing JSON +
        // reconcile React) y golpeaba al backend con SUM/AVG repetidos.
        // 30s es suficiente para que ediciones inline reflejen en el
        // footer rápido sin thrashing.
        staleTime: 30_000,
    });
}
