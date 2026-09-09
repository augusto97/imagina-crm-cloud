import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ApplyDashboardTemplateInput,
    CreateDashboardTemplateInput,
    DashboardTemplateSummary,
} from '@imagina-base/shared';

import { dashboardsKeys } from '@/hooks/useDashboards';
import { api } from '@/lib/api';
import type { DashboardEntity } from '@/types/dashboard';

/** Plantillas de dashboard (v0.1.167): galería + guardar + aplicar. */
export const dashboardTemplatesKeys = {
    all: ['dashboard-templates'] as const,
    list: () => [...dashboardTemplatesKeys.all, 'list'] as const,
};

export interface ApplyDashboardResult {
    dashboard: DashboardEntity;
    warnings: string[];
}

export function useDashboardTemplates(enabled = true) {
    return useQuery({
        queryKey: dashboardTemplatesKeys.list(),
        queryFn: async () => {
            const res = await api.get<DashboardTemplateSummary[]>('/dashboard-templates');
            return res.data;
        },
        enabled,
        staleTime: 60_000,
    });
}

export function useCreateDashboardTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateDashboardTemplateInput) => {
            const res = await api.post<DashboardTemplateSummary>('/dashboard-templates', input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardTemplatesKeys.all });
        },
    });
}

export function useDeleteDashboardTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/dashboard-templates/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardTemplatesKeys.all });
        },
    });
}

export function useApplyDashboardTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: string; input: ApplyDashboardTemplateInput }) => {
            const res = await api.post<ApplyDashboardResult>(`/dashboard-templates/${id}/apply`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}
