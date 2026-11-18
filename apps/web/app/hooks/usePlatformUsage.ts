import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformTenantUsage, PlatformUsage, PlatformUsageModuleDetail, UsageModuleKey } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.437 — Plataforma → Uso: qué empresa usa qué y cuánto. El servidor lo
 * calcula de una vez y lo guarda unos minutos; «Actualizar» lo recalcula.
 */
export const usageKeys = {
    all: ['platform', 'usage'] as const,
    summary: () => [...usageKeys.all, 'summary'] as const,
    module: (key: UsageModuleKey) => [...usageKeys.all, 'module', key] as const,
    tenant: (id: number) => [...usageKeys.all, 'tenant', id] as const,
};

export function usePlatformUsage() {
    return useQuery({
        queryKey: usageKeys.summary(),
        queryFn: async () => (await api.get<PlatformUsage>('/platform/usage')).data,
        staleTime: 60_000,
    });
}

export function useRefreshPlatformUsage() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.get<PlatformUsage>('/platform/usage?refresh=1')).data,
        onSuccess: (data) => {
            qc.setQueryData(usageKeys.summary(), data);
            // El detalle de un módulo y el de una empresa salen del mismo cálculo.
            void qc.invalidateQueries({ queryKey: [...usageKeys.all, 'module'] });
            void qc.invalidateQueries({ queryKey: [...usageKeys.all, 'tenant'] });
        },
    });
}

export function usePlatformUsageModule(key: UsageModuleKey | null) {
    return useQuery({
        queryKey: usageKeys.module(key ?? 'automations'),
        queryFn: async () => (await api.get<PlatformUsageModuleDetail>(`/platform/usage/modules/${key}`)).data,
        enabled: key !== null,
        staleTime: 60_000,
    });
}

export function usePlatformTenantUsage(id: number | null) {
    return useQuery({
        queryKey: usageKeys.tenant(id ?? 0),
        queryFn: async () => (await api.get<PlatformTenantUsage>(`/platform/usage/tenants/${id}`)).data,
        enabled: id !== null,
        staleTime: 60_000,
    });
}
