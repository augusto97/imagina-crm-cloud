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
    subscriptions: (id: number) => ['dashboards', 'sharing', String(id), 'subscriptions'] as const,
};

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

export function useDashboardSubscriptions(id: number, enabled: boolean) {
    return useQuery({
        queryKey: dashboardSharingKeys.subscriptions(id),
        queryFn: async () => (await api.get<DashboardSubscription[]>(`/dashboards/${id}/subscriptions`)).data,
        enabled,
        staleTime: 10_000,
    });
}

export function useSaveDashboardSubscription(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ sid, input }: { sid: number | null; input: DashboardSubscriptionInput }) =>
            sid === null
                ? (await api.post<DashboardSubscription>(`/dashboards/${id}/subscriptions`, input)).data
                : (await api.patch<DashboardSubscription>(`/dashboards/${id}/subscriptions/${sid}`, input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardSharingKeys.subscriptions(id) }),
    });
}

export function useDeleteDashboardSubscription(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (sid: number) => {
            await api.delete(`/dashboards/${id}/subscriptions/${sid}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardSharingKeys.subscriptions(id) }),
    });
}

/** «Enviarme una prueba ahora» (con lo que está en el formulario, sin guardar). */
export function useTestDashboardSubscription(id: number) {
    return useMutation({
        mutationFn: async (input: DashboardSubscriptionInput) =>
            (await api.post<SubscriptionSendResult>(`/dashboards/${id}/subscriptions/test`, input)).data,
    });
}

/** «Enviar ahora» un envío guardado. */
export function useSendDashboardSubscription(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (sid: number) => (await api.post<SubscriptionSendResult>(`/dashboards/${id}/subscriptions/${sid}/send`)).data,
        onSettled: () => void qc.invalidateQueries({ queryKey: dashboardSharingKeys.subscriptions(id) }),
    });
}
