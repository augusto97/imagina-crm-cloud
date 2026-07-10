import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CreatePlanInput,
    CreatePlatformUserInput,
    CreateTenantInput,
    ImpersonateResult,
    ImpersonationLogEntry,
    PlatformPlan,
    PlatformStats,
    PlatformTenant,
    PlatformTenantDetail,
    PlatformUser,
    UpdatePlanInput,
    UpdatePlatformUserInput,
    UpdateTenantInput,
} from '@imagina-base/shared';

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
    users: () => [...platformKeys.all, 'users'] as const,
    plans: () => [...platformKeys.all, 'plans'] as const,
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

export function usePlatformTenants(includeArchived = false) {
    return useQuery({
        queryKey: [...platformKeys.tenants(), { includeArchived }],
        queryFn: async () =>
            (await api.get<PlatformTenant[]>(`/platform/tenants${includeArchived ? '?include_archived=1' : ''}`)).data,
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

export function useDeleteTenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number): Promise<void> => {
            await api.delete(`/platform/tenants/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.stats() });
            void qc.invalidateQueries({ queryKey: platformKeys.tenants() });
            void qc.invalidateQueries({ queryKey: platformKeys.users() });
        },
    });
}

export function useCreateTenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateTenantInput): Promise<PlatformTenant> =>
            (await api.post<PlatformTenant>('/platform/tenants', input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.stats() });
            void qc.invalidateQueries({ queryKey: platformKeys.tenants() });
            void qc.invalidateQueries({ queryKey: platformKeys.users() });
        },
    });
}

export function useTenantDetail(id: number | null) {
    return useQuery({
        queryKey: [...platformKeys.all, 'tenant-detail', id],
        queryFn: async () => (await api.get<PlatformTenantDetail>(`/platform/tenants/${id}`)).data,
        enabled: id !== null,
    });
}

// ─────────────────────────── Usuarios (F2) ───────────────────────────

export function usePlatformUsers() {
    return useQuery({
        queryKey: platformKeys.users(),
        queryFn: async () => (await api.get<PlatformUser[]>('/platform/users')).data,
    });
}

export function useCreatePlatformUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreatePlatformUserInput): Promise<PlatformUser> =>
            (await api.post<PlatformUser>('/platform/users', input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.users() });
            void qc.invalidateQueries({ queryKey: platformKeys.stats() });
        },
    });
}

export function useSetUserDisabled() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, disabled }: { id: number; disabled: boolean }): Promise<PlatformUser> =>
            (await api.patch<PlatformUser>(`/platform/users/${id}`, { disabled })).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.users() });
        },
    });
}

export function useUpdatePlatformUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: UpdatePlatformUserInput }): Promise<PlatformUser> =>
            (await api.patch<PlatformUser>(`/platform/users/${id}`, input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.users() });
        },
    });
}

export function useDeletePlatformUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number): Promise<void> => {
            await api.delete(`/platform/users/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.users() });
            void qc.invalidateQueries({ queryKey: platformKeys.stats() });
        },
    });
}

export function useResetUserPassword() {
    return useMutation({
        mutationFn: async (id: number): Promise<void> => {
            await api.post(`/platform/users/${id}/reset-password`, {});
        },
    });
}

// ─────────────────────────── Planes (F3) ───────────────────────────

export function usePlatformPlans() {
    return useQuery({
        queryKey: platformKeys.plans(),
        queryFn: async () => (await api.get<PlatformPlan[]>('/platform/plans')).data,
    });
}

export function useCreatePlan() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreatePlanInput): Promise<PlatformPlan> =>
            (await api.post<PlatformPlan>('/platform/plans', input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.plans() });
        },
    });
}

export function useUpdatePlan() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ slug, input }: { slug: string; input: UpdatePlanInput }): Promise<PlatformPlan> =>
            (await api.patch<PlatformPlan>(`/platform/plans/${slug}`, input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.plans() });
        },
    });
}

export function useDeletePlan() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (slug: string): Promise<void> => {
            await api.delete(`/platform/plans/${slug}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: platformKeys.plans() });
        },
    });
}

// ─────────────── Impersonación de soporte (F5) ───────────────

/** Impersona a un usuario. Al terminar recarga la app (cambió la cookie). */
export function useImpersonate() {
    return useMutation({
        mutationFn: async (userId: number): Promise<ImpersonateResult> =>
            (await api.post<ImpersonateResult>('/platform/impersonate', { user_id: userId })).data,
        onSuccess: () => {
            // La cookie ahora es la de impersonación: vamos a /lists y recargamos
            // para que /auth/me devuelva la sesión del usuario objetivo + el banner.
            window.location.hash = '#/lists';
            window.location.reload();
        },
    });
}

export function useImpersonations() {
    return useQuery({
        queryKey: [...platformKeys.all, 'impersonations'],
        queryFn: async () => (await api.get<ImpersonationLogEntry[]>('/platform/impersonations')).data,
    });
}
