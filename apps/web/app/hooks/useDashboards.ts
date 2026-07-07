import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
    CreateDashboardInput,
    DashboardEntity,
    UpdateDashboardInput,
    WidgetData,
} from '@/types/dashboard';

export const dashboardsKeys = {
    all: ['dashboards'] as const,
    one: (id: string | number) => [...dashboardsKeys.all, 'one', String(id)] as const,
    widgetData: (dashboardId: string | number, widgetId: string) =>
        [...dashboardsKeys.all, 'widget-data', String(dashboardId), widgetId] as const,
};

export function useDashboards() {
    return useQuery({
        queryKey: dashboardsKeys.all,
        queryFn: async () => {
            const res = await api.get<DashboardEntity[]>('/dashboards');
            return res.data;
        },
        staleTime: 60_000, // Fase 16.D
    });
}

export function useDashboard(id: number | undefined) {
    return useQuery({
        queryKey: dashboardsKeys.one(id ?? 0),
        queryFn: async () => {
            const res = await api.get<DashboardEntity>(`/dashboards/${id}`);
            return res.data;
        },
        enabled: id !== undefined && id > 0,
        staleTime: 60_000, // Fase 16.D
    });
}

export function useCreateDashboard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateDashboardInput) => {
            const res = await api.post<DashboardEntity>('/dashboards', input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}

export function useUpdateDashboard(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateDashboardInput) => {
            const res = await api.patch<DashboardEntity>(`/dashboards/${id}`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.one(id) });
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}

export function useDeleteDashboard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/dashboards/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}

export function useWidgetData(dashboardId: number | undefined, widgetId: string | undefined) {
    return useQuery({
        queryKey: dashboardsKeys.widgetData(dashboardId ?? 0, widgetId ?? ''),
        queryFn: async () => {
            const res = await api.get<WidgetData>(
                `/dashboards/${dashboardId}/widgets/${widgetId}/data`,
            );
            return res.data;
        },
        enabled:
            dashboardId !== undefined &&
            dashboardId > 0 &&
            widgetId !== undefined &&
            widgetId !== '',
        // Recargas frecuentes son OK aquí — el evaluator es un par de
        // queries agregadas. 30s de stale para no martillar el back en
        // navegaciones rápidas.
        staleTime: 30 * 1000,
    });
}
