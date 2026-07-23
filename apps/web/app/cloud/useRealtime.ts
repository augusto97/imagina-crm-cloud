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
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
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
            // v0.1.105 — invalidar por ID *y* SLUG (`invalidateForList`): los
            // eventos traen el id numérico pero RecordsPage registra sus
            // queries bajo el slug → con la key directa los cambios de
            // ajustes/campos hechos en otra pestaña (u otro usuario) jamás
            // refrescaban la lista abierta hasta recargar.
            switch (ev.topic) {
                case 'lists':
                    void qc.invalidateQueries({ queryKey: listsKeys.all });
                    break;
                case 'fields':
                    if (ev.listId !== undefined) invalidateForList(qc, fieldsKeys.all, ev.listId);
                    else void qc.invalidateQueries({ queryKey: fieldsKeys.all });
                    break;
                case 'records':
                    if (ev.listId !== undefined) invalidateForList(qc, recordsKeys.all, ev.listId);
                    else void qc.invalidateQueries({ queryKey: recordsKeys.all });
                    break;
                case 'views':
                    if (ev.listId !== undefined) invalidateForList(qc, viewsKeys.all, ev.listId);
                    else void qc.invalidateQueries({ queryKey: viewsKeys.all });
                    break;
            }
        }

        return () => {
            socket.off('connect', join);
            socket.disconnect();
        };
    }, [tenantId, qc]);
}
