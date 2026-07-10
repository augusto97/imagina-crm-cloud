import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformStats, PlatformTenant, UpdateTenantInput } from '@imagina-base/shared';

import { api, ApiError } from '@/lib/api';

/**
 * Consola de PLATAFORMA (operador SaaS). Endpoints gateados por SuperadminGuard:
 *  GET   /platform/stats           → foto del negocio
 *  GET   /platform/tenants         → todas las empresas + uso/owner
 *  PATCH /platform/tenants/:id     → cambiar plan / suspender-reactivar
 *
 * La UI se muestra sólo si el usuario es superadmin — se detecta probando el
 * endpoint (403 → no superadmin), mismo patrón que el panel de auto-update.
 */
export const platformKeys = {
    all: ['platform'] as const,
    is: () => [...platformKeys.all, 'is-superadmin'] as const,
    stats: () => [...platformKeys.all, 'stats'] as const,
    tenants: () => [...platformKeys.all, 'tenants'] as const,
};

export function useIsSuperadmin() {
    return useQuery({
        queryKey: platformKeys.is(),
        queryFn: async (): Promise<boolean> => {
            try {
                await api.get<PlatformStats>('/platform/stats');
                return true;
            } catch (err) {
                if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false;
                throw err;
            }
        },
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
}

export function usePlatformStats() {
    return useQuery({
        queryKey: platformKeys.stats(),
        queryFn: async () => (await api.get<PlatformStats>('/platform/stats')).data,
    });
}

export function usePlatformTenants() {
    return useQuery({
        queryKey: platformKeys.tenants(),
        queryFn: async () => (await api.get<PlatformTenant[]>('/platform/tenants')).data,
    });
}

export function useUpdateTenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: UpdateTenantInput }): Promise<PlatformTenant> =>
            (await api.patch<PlatformTenant>(`/platform/tenants/${id}`, input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.stats() });
            void qc.invalidateQueries({ queryKey: platformKeys.tenants() });
        },
    });
}
