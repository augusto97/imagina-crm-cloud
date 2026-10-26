import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCustomRoleInput, CustomRole, CustomRoleBase, UpdateCustomRoleInput } from '@imagina-base/shared';

import { api } from '@/lib/api';

import { listsKeys } from './useLists';

/** C2 — Personas por rol base fijo (admin / manager / agente / lector). */
export interface BaseRoleCount {
    role: 'admin' | CustomRoleBase;
    member_count: number;
}

export const customRolesKeys = {
    all: ['custom-roles'] as const,
    list: () => [...customRolesKeys.all, 'list'] as const,
};

/** Ajustes → Roles: los fijos (con cuántas personas) y los propios. */
export function useCustomRoles(enabled = true) {
    return useQuery({
        queryKey: customRolesKeys.list(),
        queryFn: async () => {
            const res = await api.get<{ base: BaseRoleCount[]; custom: CustomRole[] }>('/workspaces/current/roles');
            return res.data ?? { base: [], custom: [] };
        },
        // Los contadores de personas cambian desde Miembros: se relee al volver.
        staleTime: 0,
        enabled,
    });
}

function useRoleMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: customRolesKeys.all });
            // Miembros muestra el rol de cada persona y los permisos por lista
            // tienen una fila por rol propio.
            void qc.invalidateQueries({ queryKey: ['members'] });
            void qc.invalidateQueries({ queryKey: listsKeys.all });
        },
    });
}

export function useCreateCustomRole() {
    return useRoleMutation(async (input: CreateCustomRoleInput) => (await api.post<CustomRole>('/workspaces/current/roles', input)).data);
}

export function useUpdateCustomRole() {
    return useRoleMutation(
        async ({ id, ...patch }: UpdateCustomRoleInput & { id: number }) =>
            (await api.patch<CustomRole>(`/workspaces/current/roles/${id}`, patch)).data,
    );
}

export function useDeleteCustomRole() {
    return useRoleMutation(async (id: number) => (await api.delete<{ moved: number }>(`/workspaces/current/roles/${id}`)).data);
}
