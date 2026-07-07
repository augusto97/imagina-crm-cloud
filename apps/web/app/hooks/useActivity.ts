import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ActivityEntity } from '@/types/activity';

export const activityKeys = {
    all: ['activity'] as const,
    forRecord: (listId: string | number, recordId: string | number) =>
        [...activityKeys.all, 'list', String(listId), 'record', String(recordId)] as const,
    forList: (listId: string | number) =>
        [...activityKeys.all, 'list', String(listId)] as const,
};

export function useRecordActivity(
    listId: string | number | undefined,
    recordId: number | undefined,
    limit = 50,
) {
    return useQuery({
        queryKey: [...activityKeys.forRecord(listId ?? '', recordId ?? 0), limit],
        queryFn: async () => {
            const res = await api.get<ActivityEntity[]>(
                `/lists/${listId}/records/${recordId}/activity`,
                { query: { limit } },
            );
            return res.data;
        },
        enabled: listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        // Activity es append-only en el backend; entre eventos el
        // log es estable. (Fase 16.D)
        staleTime: 30_000,
    });
}
