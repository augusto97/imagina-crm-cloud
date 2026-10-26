import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PushStatusDto, PushTestResult } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { api } from '@/lib/api';
import { pushSupport, type PushSupport } from '@/lib/pwa/platform';
import { currentSubscription, disablePush, enablePush, endpointHash, notificationPermission, type EnableResult } from '@/lib/pwa/push';

export const pushKeys = {
    status: ['me', 'push'] as const,
};

/** La suscripción de este navegador cambió fuera de la tarjeta (re-vinculación al entrar). */
export const PUSH_CHANGED_EVENT = 'imcrm:push-changed';

/** Dispositivos de la persona en la empresa activa + la clave pública. */
export function usePushStatus(enabled = true) {
    const tenantId = useSession((s) => s.activeTenantId);
    return useQuery({
        queryKey: [...pushKeys.status, tenantId],
        queryFn: async () => (await api.get<PushStatusDto>('/me/push')).data,
        enabled,
        staleTime: 30_000,
    });
}

export interface ThisDevice {
    support: PushSupport;
    permission: NotificationPermission | 'unsupported';
    /** Huella del endpoint de ESTE navegador (si tiene suscripción). */
    hash: string | null;
    /** Se volvió a leer el estado del navegador. */
    refresh: () => void;
}

/** El estado de ESTE navegador: soporte, permiso y su suscripción. */
export function useThisDevice(): ThisDevice {
    const [support] = useState<PushSupport>(() => pushSupport());
    const [permission, setPermission] = useState(() => notificationPermission());
    const [hash, setHash] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let alive = true;
        setPermission(notificationPermission());
        if (support !== 'ok') return;
        void currentSubscription()
            .then(async (sub) => (sub ? endpointHash(sub.endpoint) : null))
            .then((h) => {
                if (alive) setHash(h);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [support, tick]);

    // El permiso puede cambiar desde los ajustes del navegador, y la
    // suscripción desde la re-vinculación al entrar a la empresa.
    useEffect(() => {
        const onFocus = (): void => setPermission(notificationPermission());
        window.addEventListener('focus', onFocus);
        window.addEventListener(PUSH_CHANGED_EVENT, refresh);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener(PUSH_CHANGED_EVENT, refresh);
        };
    }, [refresh]);

    return { support, permission, hash, refresh };
}

export function useEnablePush() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ tenantId, publicKey }: { tenantId: number; publicKey: string }): Promise<EnableResult> => enablePush(tenantId, publicKey),
        onSettled: () => void qc.invalidateQueries({ queryKey: pushKeys.status }),
    });
}

export function useDisablePush() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (tenantId: number) => disablePush(tenantId),
        onSettled: () => void qc.invalidateQueries({ queryKey: pushKeys.status }),
    });
}

export function useRemovePushDevice() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.delete(`/me/push/subscriptions/${id}`)).data,
        onSettled: () => void qc.invalidateQueries({ queryKey: pushKeys.status }),
    });
}

export function useSendTestPush() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<PushTestResult>('/me/push/test', {})).data,
        onSettled: () => void qc.invalidateQueries({ queryKey: pushKeys.status }),
    });
}
