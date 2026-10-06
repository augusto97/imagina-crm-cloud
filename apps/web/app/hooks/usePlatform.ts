import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    AddMemberInput,
    AddMemberResult,
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
    PlatformUserWorkspace,
    UpdateMemberRoleInput,
    UpdatePlanInput,
    UpdatePlatformUserInput,
    UpdateTenantInput,
} from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
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
    // v0.1.254 — mientras el operador impersona, la app es la de OTRA persona:
    // no hay consola que mostrar, así que ni se pregunta. Antes el sondeo
    // recibía `reauth_required`, cerraba la sesión y la impersonación terminaba
    // en el login apenas empezaba.
    const impersonating = useSession((s) => s.impersonating !== null && s.impersonating !== undefined);
    return useQuery({
        queryKey: [...platformKeys.is(), impersonating],
        enabled: !impersonating,
        queryFn: async (): Promise<boolean> => {
            try {
                await api.get<PlatformStats>('/platform/stats');
                return true;
            } catch (err) {
                // SEC-24 (v0.1.225): la consola exige una sesión abierta con
                // contraseña. Una sesión anterior al fix no trae esa marca: se
                // cierra y se vuelve al login UNA vez (si no, el operador
                // simplemente dejaría de ver "Plataforma" sin saber por qué).
                if (err instanceof ApiError && err.code === 'reauth_required') {
                    await api.post('/auth/logout', {}).catch(() => undefined);
                    window.location.reload();
                    return false;
                }
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

/**
 * Empresas del operador. v0.1.115: el endpoint PAGINA (antes traía todas y
 * corría cuatro GROUP BY de tabla completa por carga). `total` viene en la
 * respuesta para mostrar el conteo y avanzar de página.
 */
export function usePlatformTenants(
    opts: { includeArchived?: boolean; limit?: number; offset?: number; search?: string } = {},
) {
    const { includeArchived = false, limit = 50, offset = 0, search = '' } = opts;
    return useQuery({
        queryKey: [...platformKeys.tenants(), { includeArchived, limit, offset, search }],
        queryFn: async () => {
            const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
            if (includeArchived) params.set('include_archived', '1');
            if (search.trim() !== '') params.set('q', search.trim());
            const res = await api.get<PlatformTenant[]>(`/platform/tenants?${params.toString()}`);
            const meta = (res as { meta?: { total: number } }).meta;
            return { data: res.data, total: meta?.total ?? res.data.length };
        },
        placeholderData: (prev) => prev,
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

// ─────────── Miembros de una empresa (v0.1.240) ───────────

/** Tras tocar los miembros: detalle de empresas, grilla (nº de usuarios) y Usuarios. */
function invalidateMembership(qc: ReturnType<typeof useQueryClient>): void {
    void qc.invalidateQueries({ queryKey: [...platformKeys.all, 'tenant-detail'] });
    void qc.invalidateQueries({ queryKey: platformKeys.tenants() });
    void qc.invalidateQueries({ queryKey: platformKeys.users() });
    void qc.invalidateQueries({ queryKey: [...platformKeys.all, 'user-workspaces'] });
    void qc.invalidateQueries({ queryKey: platformKeys.stats() });
}

export function useAddTenantMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ tenantId, input }: { tenantId: number; input: AddMemberInput }): Promise<AddMemberResult> =>
            (await api.post<AddMemberResult>(`/platform/tenants/${tenantId}/members`, input)).data,
        onSuccess: () => invalidateMembership(qc),
    });
}

export function useUpdateTenantMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ tenantId, userId, input }: { tenantId: number; userId: number; input: UpdateMemberRoleInput }) =>
            (await api.patch(`/platform/tenants/${tenantId}/members/${userId}`, input)).data,
        onSuccess: () => invalidateMembership(qc),
    });
}

export function useRemoveTenantMember() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ tenantId, userId }: { tenantId: number; userId: number }): Promise<void> => {
            await api.delete(`/platform/tenants/${tenantId}/members/${userId}`);
        },
        onSuccess: () => invalidateMembership(qc),
    });
}

export function useResendTenantInvite() {
    return useMutation({
        mutationFn: async ({ tenantId, userId }: { tenantId: number; userId: number }): Promise<void> => {
            await api.post(`/platform/tenants/${tenantId}/members/${userId}/resend-invite`, {});
        },
    });
}

export function useUserWorkspaces(userId: number | null) {
    return useQuery({
        queryKey: [...platformKeys.all, 'user-workspaces', userId],
        queryFn: async () => (await api.get<PlatformUserWorkspace[]>(`/platform/users/${userId}/workspaces`)).data,
        enabled: userId !== null,
    });
}

export function useResendUserInvite() {
    return useMutation({
        mutationFn: async (userId: number): Promise<void> => {
            await api.post(`/platform/users/${userId}/resend-invite`, {});
        },
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
