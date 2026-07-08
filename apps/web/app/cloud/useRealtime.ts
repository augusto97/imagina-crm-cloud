import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    RT_EVENT_INVALIDATE,
    RT_EVENT_JOIN,
    rtInvalidateSchema,
    type RtInvalidate,
} from '@imagina-base/shared';
import { io, type Socket } from 'socket.io-client';
import { useSession } from '@/cloud/session';

/**
 * Realtime por invalidación push (STANDALONE §7). Conecta el socket (auth por
 * la cookie de sesión), se une a la room del workspace activo y, ante cada
 * evento, invalida la query de TanStack correspondiente → re-fetch → la UI se
 * actualiza sola cuando OTRO usuario (u otra pestaña) muta datos.
 */
export function useRealtime(): void {
    const tenantId = useSession((s) => s.activeTenantId);
    const qc = useQueryClient();

    useEffect(() => {
        if (tenantId === null) return;

        // Mismo origen que el HTTP (el dev server proxya /socket.io al backend).
        const socket: Socket = io({ withCredentials: true, path: '/socket.io' });

        const join = () => socket.emit(RT_EVENT_JOIN, { tenantId });
        socket.on('connect', join);

        socket.on(RT_EVENT_INVALIDATE, (raw: unknown) => {
            const parsed = rtInvalidateSchema.safeParse(raw);
            if (!parsed.success) return;
            invalidate(parsed.data);
        });

        function invalidate(ev: RtInvalidate): void {
            switch (ev.topic) {
                case 'lists':
                    void qc.invalidateQueries({ queryKey: ['lists', tenantId] });
                    break;
                case 'fields':
                    void qc.invalidateQueries({ queryKey: ['fields', tenantId, ev.listId] });
                    break;
                case 'records':
                    void qc.invalidateQueries({ queryKey: ['records', tenantId, ev.listId] });
                    break;
                case 'views':
                    void qc.invalidateQueries({ queryKey: ['views', tenantId, ev.listId] });
                    break;
            }
        }

        return () => {
            socket.off('connect', join);
            socket.disconnect();
        };
    }, [tenantId, qc]);
}
