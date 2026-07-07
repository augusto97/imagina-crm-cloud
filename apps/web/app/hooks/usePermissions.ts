/**
 * Hooks para gestionar el ACL por lista (Fase 7 — 1.E).
 * Endpoints: `/lists/{id_or_slug}/permissions` (GET/PATCH) y `/roles` (GET).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
    ListPermissionsDoc,
    PluginRole,
    RolePermissions,
} from '@/types/permissions';

export const permissionsKeys = {
    all: ['permissions'] as const,
    forList: (idOrSlug: string | number) =>
        [...permissionsKeys.all, 'list', String(idOrSlug)] as const,
    roles: () => [...permissionsKeys.all, 'roles'] as const,
};

export function useListPermissions(idOrSlug: string | number | undefined) {
    return useQuery({
        queryKey: permissionsKeys.forList(idOrSlug ?? ''),
        queryFn: async () => {
            const res = await api.get<ListPermissionsDoc>(`/lists/${idOrSlug}/permissions`);
            return res.data;
        },
        enabled: idOrSlug !== undefined && idOrSlug !== '',
    });
}

export interface UpdateListPermissionsInput {
    permissions?: Record<string, Partial<RolePermissions>>;
    assignment_field_id?: number | null;
}

export function useUpdateListPermissions(idOrSlug: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateListPermissionsInput) => {
            const res = await api.patch<ListPermissionsDoc>(
                `/lists/${idOrSlug}/permissions`,
                input,
            );
            return res.data;
        },
        onSuccess: (data) => {
            void qc.invalidateQueries({ queryKey: permissionsKeys.forList(idOrSlug) });
            // El sidebar consume GET /lists y depende de la visibilidad
            // por user; un cambio de permisos puede afectar qué listas
            // ve OTRO usuario, pero para el admin actual no cambia el
            // listado. Aún así invalidamos por defensa.
            void qc.invalidateQueries({ queryKey: ['lists'] });
            return data;
        },
    });
}

/**
 * Hook para el catálogo `GET /roles`. Devuelve el shape completo
 * que el endpoint emite dentro de `data`: lista de roles built-in
 * + roles custom + capabilities (estas últimas las usa el
 * CustomRolesCard para renderizar el form de creación).
 *
 * El shape del endpoint cambió en 0.40.3 al añadir custom_roles +
 * capabilities — antes era `data: PluginRole[]` directamente. Ahora
 * `data: { roles, custom_roles, capabilities }`.
 */
export interface RolesCatalog {
    roles: PluginRole[];
    custom_roles: Array<{ slug: string; label: string; capabilities: string[] }>;
    capabilities: string[];
}

export function useRoles() {
    return useQuery({
        queryKey: permissionsKeys.roles(),
        queryFn: async (): Promise<RolesCatalog> => {
            const res = await api.get<RolesCatalog>('/roles');
            return res.data;
        },
        // Catálogo estático en la sesión.
        staleTime: 5 * 60 * 1000,
    });
}
