import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** Un camino posible para un lookup/rollup de la lista (v0.1.170). */
export interface RelationPath {
    relation_field_id: number;
    relation_label: string;
    direction: 'forward' | 'reverse';
    /** Lista donde VIVE el campo relation. */
    list_id: number;
    list_name: string;
    /** Lista del otro lado (de donde se leen los campos). */
    other_list_id: number;
    other_list_name: string;
}

/**
 * Relaciones que tocan una lista: las propias (hacia afuera) y las de otras
 * listas que apuntan a ella (hacia adentro). Es lo que ofrece el editor de
 * config de un lookup/rollup.
 */
export function useRelationPaths(listId: string | number | undefined) {
    return useQuery({
        queryKey: ['relation-paths', String(listId ?? '')] as const,
        queryFn: async () => {
            const res = await api.get<RelationPath[]>(`/lists/${listId}/fields/relation-paths`);
            return res.data;
        },
        enabled: listId !== undefined && listId !== '',
        staleTime: 30_000,
    });
}
