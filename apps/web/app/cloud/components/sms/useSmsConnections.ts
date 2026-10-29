import { useQuery } from '@tanstack/react-query';
import type { SmsConnectionSummary } from '@imagina-base/shared';

import { api } from '@/cloud/session';

/** Las conexiones de SMS que la persona puede usar (vacío si no hay o no aplica). */
export function useSmsConnections(enabled: boolean): SmsConnectionSummary[] {
    const q = useQuery({
        queryKey: ['sms-connections'],
        queryFn: () => api.smsConnections(),
        enabled,
        retry: false,
        staleTime: 60_000,
    });
    return enabled ? (q.data ?? []) : [];
}
