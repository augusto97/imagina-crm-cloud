import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DATA_BLOCK_TYPES, layoutBlocks, type RecordLayoutV3 } from '@imagina-base/shared';

import type { WidgetDataOverride } from '@/hooks/useDashboards';
import { widgetErrorOf } from '@/hooks/useDashboards';
import { api } from '@/lib/api';
import type { FieldEntity } from '@/types/field';
import type { WidgetData } from '@/types/dashboard';

export const layoutDataKeys = {
    all: ['record-layout-data'] as const,
    forRecord: (listId: number, recordId: number, sig: string) =>
        [...layoutDataKeys.all, String(listId), recordId, sig] as const,
};

/** Registros vinculados de un bloque `related` (shape del servidor). */
export interface RelatedBlockData {
    list: { id: number; slug: string; name: string; icon: string | null; color: string | null };
    fields: FieldEntity[];
    rows: Array<{
        id: number;
        data: Record<string, unknown>;
        relations?: Record<string, number[]>;
        created_at?: string;
        updated_at?: string;
    }>;
    total: number;
}

/**
 * v0.1.230 — Datos de TODOS los bloques de la ficha que los necesitan
 * (gráficos y vinculados) en UN request (regla de oro nº 8). La key incluye
 * la firma de la config de esos bloques: cambiarla (el editor) recalcula.
 */
export function useLayoutData(
    listId: number,
    listSlug: string,
    recordId: number,
    layout: RecordLayoutV3 | null,
    /** v0.1.233 — 'portal': el editor del portal calcula con el alcance del cliente. */
    scope: 'record' | 'portal' = 'record',
) {
    const blocks = useMemo(
        () =>
            layout
                ? layoutBlocks(layout)
                      .filter((b) => DATA_BLOCK_TYPES.includes(b.type))
                      .map((b) => ({ id: b.id, type: b.type as 'chart' | 'related', title: b.title, config: b.config }))
                : [],
        [layout],
    );
    const sig = useMemo(() => JSON.stringify(blocks), [blocks]);
    const query = useQuery({
        queryKey: [...layoutDataKeys.forRecord(listId, recordId, sig), scope],
        queryFn: async (): Promise<Record<string, unknown>> => {
            if (scope === 'portal') {
                const res = await api.post<{ data: Record<string, unknown>; block_lists: Record<string, number> }>(
                    `/lists/${listSlug}/portal/layout-data`,
                    { record_id: recordId, blocks },
                );
                return { ...res.data.data, [BLOCK_LISTS]: res.data.block_lists };
            }
            return (await api.post<Record<string, unknown>>(`/lists/${listSlug}/records/${recordId}/layout-data`, { blocks })).data;
        },
        enabled: blocks.length > 0 && recordId > 0,
        staleTime: 20_000,
        placeholderData: (prev) => prev,
    });

    const override = useMemo<WidgetDataOverride>(
        () => ({
            get(widgetId) {
                const raw = query.data?.[widgetId];
                const failed = widgetErrorOf(raw);
                return {
                    data: failed === null ? (raw as WidgetData | undefined) : undefined,
                    isLoading: query.isLoading,
                    error: failed !== null ? new Error(failed) : query.error ?? null,
                };
            },
        }),
        [query.data, query.isLoading, query.error],
    );
    const blockLists = scope === 'portal' ? (query.data?.[BLOCK_LISTS] as Record<string, number> | undefined) : undefined;
    return { query, override, blockLists };
}

/** Dónde viaja, dentro del mapa de datos, la lista de cada bloque (vista previa del portal). */
const BLOCK_LISTS = '__block_lists';

export function relatedOf(data: Record<string, unknown> | undefined, blockId: string): { data?: RelatedBlockData; error?: string } {
    const raw = data?.[blockId];
    const failed = widgetErrorOf(raw);
    if (failed !== null) return { error: failed };
    return { data: raw as RelatedBlockData | undefined };
}
