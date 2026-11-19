import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    DashboardSubscription,
    DashboardSubscriptionInput,
    PublicDashboardAdmin,
    UpdatePublicDashboardInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.292 (ADR-S50) — Compartir un tablero hacia afuera: el enlace público y
 * los envíos programados por correo.
 */
export const dashboardSharingKeys = {
    public: (id: number) => ['dashboards', 'sharing', String(id), 'public'] as const,
    subscriptions: (id: number, base: SharingBase = 'dashboards') => [base, 'sharing', String(id), 'subscriptions'] as const,
};

/**
 * v0.1.464 (J1) — Los envíos programados son de un tablero o de un informe:
 * la misma API bajo `/dashboards/:id` o `/reports/:id`.
 */
export type SharingBase = 'dashboards' | 'reports';

export interface SubscriptionSendResult {
    status: 'sent' | 'failed' | 'skipped';
    sent_to: string[];
    error: string | null;
}

export function usePublicDashboard(id: number, enabled: boolean) {
    return useQuery({
        queryKey: dashboardSharingKeys.public(id),
        queryFn: async () => (await api.get<PublicDashboardAdmin>(`/dashboards/${id}/public`)).data,
        enabled,
        staleTime: 10_000,
    });
}

export function useUpdatePublicDashboard(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdatePublicDashboardInput) => (await api.patch<PublicDashboardAdmin>(`/dashboards/${id}/public`, input)).data,
        onSuccess: (data) => qc.setQueryData(dashboardSharingKeys.public(id), data),
    });
}

export function useRegeneratePublicDashboard(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<PublicDashboardAdmin>(`/dashboards/${id}/public/regenerate`)).data,
        onSuccess: (data) => qc.setQueryData(dashboardSharingKeys.public(id), data),
    });
}

export function useDashboardSubscriptions(id: number, enabled: boolean, base: SharingBase = 'dashboards') {
    return useQuery({
        queryKey: dashboardSharingKeys.subscriptions(id, base),
        queryFn: async () => (await api.get<DashboardSubscription[]>(`/${base}/${id}/subscriptions`)).data,
        enabled,
        staleTime: 10_000,
    });
}

export function useSaveDashboardSubscription(id: number, base: SharingBase = 'dashboards') {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ sid, input }: { sid: number | null; input: DashboardSubscriptionInput }) =>
            sid === null
                ? (await api.post<DashboardSubscription>(`/${base}/${id}/subscriptions`, input)).data
                : (await api.patch<DashboardSubscription>(`/${base}/${id}/subscriptions/${sid}`, input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardSharingKeys.subscriptions(id, base) }),
    });
}

export function useDeleteDashboardSubscription(id: number, base: SharingBase = 'dashboards') {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (sid: number) => {
            await api.delete(`/${base}/${id}/subscriptions/${sid}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardSharingKeys.subscriptions(id, base) }),
    });
}

/** «Enviarme una prueba ahora» (con lo que está en el formulario, sin guardar). */
export function useTestDashboardSubscription(id: number, base: SharingBase = 'dashboards') {
    return useMutation({
        mutationFn: async (input: DashboardSubscriptionInput) =>
            (await api.post<SubscriptionSendResult>(`/${base}/${id}/subscriptions/test`, input)).data,
    });
}

/** «Enviar ahora» un envío guardado. */
export function useSendDashboardSubscription(id: number, base: SharingBase = 'dashboards') {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (sid: number) => (await api.post<SubscriptionSendResult>(`/${base}/${id}/subscriptions/${sid}/send`)).data,
        onSettled: () => void qc.invalidateQueries({ queryKey: dashboardSharingKeys.subscriptions(id, base) }),
    });
}
