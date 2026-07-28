import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ListGroup } from '@/types/list';

import { listsKeys } from './useLists';

/**
 * Carpetas del menú de listas (v0.1.130). El árbol del panel las dibuja
 * junto a `useLists()`; por eso cada mutación invalida TAMBIÉN las listas:
 * mover o borrar una carpeta cambia de dónde cuelga cada lista.
 */
export const listGroupsKeys = {
    all: ['list-groups'] as const,
    list: () => [...listGroupsKeys.all, 'list'] as const,
};

export function useListGroups() {
    return useQuery({
        queryKey: listGroupsKeys.list(),
        queryFn: async () => {
            const res = await api.get<ListGroup[]>('/list-groups');
            return res.data;
        },
        staleTime: 60_000,
    });
}

function useGroupMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listGroupsKeys.list() });
            void qc.invalidateQueries({ queryKey: listsKeys.list() });
        },
    });
}

export function useCreateListGroup() {
    return useGroupMutation(async (name: string) => {
        const res = await api.post<ListGroup>('/list-groups', { name });
        return res.data;
    });
}

export function useUpdateListGroup() {
    return useGroupMutation(async ({ id, name }: { id: number; name: string }) => {
        const res = await api.patch<ListGroup>(`/list-groups/${id}`, { name });
        return res.data;
    });
}

export function useDeleteListGroup() {
    return useGroupMutation(async (id: number) => {
        await api.delete(`/list-groups/${id}`);
    });
}

/** Mover una lista a una carpeta (o sacarla, con `null`). */
export function useMoveListToGroup() {
    return useGroupMutation(async ({ listId, groupId }: { listId: number; groupId: number | null }) => {
        await api.patch(`/lists/${listId}`, { group_id: groupId });
    });
}
