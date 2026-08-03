import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ActivityEntity } from '@/types/activity';

/**
 * v0.1.149 — el identificador de la lista va en el ÍNDICE 1 de la key, como
 * todas las demás familias: `invalidateForList` matchea ahí (regla de oro
 * nº 7). Con el segmento 'list' de más que había antes, la actividad no se
 * refrescaba nunca al editar el registro — la misma clase de bug de v0.1.85.
 */
export const activityKeys = {
    all: ['activity'] as const,
    forList: (listId: string | number) => [...activityKeys.all, String(listId)] as const,
    forRecord: (listId: string | number, recordId: string | number) =>
        [...activityKeys.forList(listId), 'record', String(recordId)] as const,
};

/** Lo que devuelve el backend; el front lo consume como `changes`. */
interface ActivityDtoWire {
    id: number;
    list_id: number;
    record_id: number | null;
    user_id: number | null;
    user_name?: string | null;
    action: string;
    diff?: Record<string, unknown>;
    changes?: Record<string, unknown>;
    created_at: string;
}

function toEntity(row: ActivityDtoWire): ActivityEntity {
    return {
        id: row.id,
        list_id: row.list_id,
        record_id: row.record_id,
        user_id: row.user_id,
        user_name: row.user_name ?? null,
        action: row.action,
        // El backend cloud manda `diff`; `changes` es el nombre histórico.
        changes: row.diff ?? row.changes ?? {},
        created_at: row.created_at,
    };
}

export function useRecordActivity(
    listId: string | number | undefined,
    recordId: number | undefined,
    limit = 50,
) {
    return useQuery({
        queryKey: [...activityKeys.forRecord(listId ?? '', recordId ?? 0), limit],
        queryFn: async () => {
            const res = await api.get<ActivityDtoWire[]>(
                `/lists/${listId}/records/${recordId}/activity`,
                { query: { limit } },
            );
            return res.data.map(toEntity);
        },
        enabled: listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        // Append-only: entre eventos el log es estable. Las mutaciones del
        // registro lo invalidan por `invalidateForList`.
        staleTime: 30_000,
    });
}
