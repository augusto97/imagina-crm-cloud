import { useQuery } from '@tanstack/react-query';

import { api, useSession } from '@/cloud/session';

/**
 * v0.1.467 (E8) — El horario laboral de la empresa (Ajustes → Horario
 * laboral). Lo leen Ajustes y el editor de automatizaciones («Esperar hasta un
 * día laborable / el horario laboral»): una sola clave de caché.
 */
export function companyHoursKey(tenantId: number | null): unknown[] {
    return ['business-hours', tenantId];
}

export function useCompanyHours(enabled = true) {
    const tenantId = useSession((s) => s.activeTenantId);
    return useQuery({
        queryKey: companyHoursKey(tenantId),
        queryFn: () => api.getBusinessHours(),
        enabled: enabled && tenantId !== null,
        staleTime: 60_000,
    });
}
