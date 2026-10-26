import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { PushStatusDto } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { switchWorkspace } from '@/cloud/workspaceSwitch';
import { PUSH_CHANGED_EVENT, pushKeys } from '@/hooks/usePushDevice';
import { api } from '@/lib/api';
import { hasPushFlag, resyncPush } from '@/lib/pwa/push';
import { isOpenMessage, safeAppPath } from '@/lib/pwa/serviceWorker';

/**
 * H1 — Puente entre el service worker y la app abierta:
 *  - un clic en una notificación con la app ya abierta llega como mensaje:
 *    la app navega al registro y, si el aviso es de OTRA empresa (y la
 *    persona es miembro), cambia de empresa primero;
 *  - al entrar a una empresa donde la persona activó el push en este
 *    dispositivo, la suscripción se re-vincula a esta sesión.
 */
export function usePwaBridge(): void {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const onMessage = (e: MessageEvent): void => {
            if (!isOpenMessage(e.data)) return;
            const path = safeAppPath(e.data.url);
            const hashAt = path.indexOf('#');
            const route = hashAt >= 0 ? path.slice(hashAt + 1) || '/' : '/';
            const target = e.data.tenant_id;
            if (target !== null && target !== useSession.getState().activeTenantId) {
                if (switchWorkspace(target, qc)) {
                    // El cambio de empresa remonta el router: se fija la ruta en la URL.
                    window.location.hash = `#${route}`;
                    return;
                }
            }
            navigate(route);
        };
        navigator.serviceWorker.addEventListener('message', onMessage);
        return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    }, [navigate, qc]);

    useEffect(() => {
        if (tenantId === null || !hasPushFlag(tenantId)) return;
        let cancelled = false;
        void api
            .get<PushStatusDto>('/me/push')
            .then((res) => (cancelled ? false : resyncPush(tenantId, res.data.public_key)))
            .then((ok) => {
                if (!ok || cancelled) return;
                // La suscripción pudo renovarse (endpoint nuevo): la tarjeta de
                // Ajustes vuelve a leer el estado de este dispositivo.
                void qc.invalidateQueries({ queryKey: pushKeys.status });
                window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [tenantId, qc]);
}
