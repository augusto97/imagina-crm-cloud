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
import { fieldsKeys } from '@/hooks/useFields';
import { listsKeys } from '@/hooks/useLists';
import { recordsKeys } from '@/hooks/useRecords';
import { viewsKeys } from '@/hooks/useSavedViews';

/**
 * Realtime por invalidación push (STANDALONE §7). Conecta el socket (auth por
 * la cookie de sesión), se une a la room del workspace activo y, ante cada
 * evento, invalida la query de TanStack correspondiente → re-fetch → la UI se
 * actualiza sola cuando OTRO usuario (u otra pestaña) muta datos.
 *
 * Las claves invalidadas son las FACTORIES del fork (`recordsKeys`,
 * `fieldsKeys`, `listsKeys`, `viewsKeys`) — regla de oro nº 7: un solo
 * identificador canónico (el id numérico, como `String(id)` en el índice 1).
 * Se monta en `AdminCloudApp` (la versión anterior solo la usaba el shell
 * viejo, con claves que el fork no usa → el realtime quedaba desconectado).
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
                    void qc.invalidateQueries({ queryKey: listsKeys.all });
                    break;
                case 'fields':
                    void qc.invalidateQueries({
                        queryKey: ev.listId !== undefined ? fieldsKeys.forList(ev.listId) : fieldsKeys.all,
                    });
                    break;
                case 'records':
                    void qc.invalidateQueries({
                        queryKey: ev.listId !== undefined ? recordsKeys.forList(ev.listId) : recordsKeys.all,
                    });
                    break;
                case 'views':
                    void qc.invalidateQueries({
                        queryKey: ev.listId !== undefined ? viewsKeys.forList(ev.listId) : viewsKeys.all,
                    });
                    break;
            }
        }

        return () => {
            socket.off('connect', join);
            socket.disconnect();
        };
    }, [tenantId, qc]);
}
