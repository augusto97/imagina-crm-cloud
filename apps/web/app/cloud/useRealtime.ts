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
import { isRecentLocalListsChange, listsKeys } from '@/hooks/useLists';
import { activityKeys } from '@/hooks/useActivity';
import { fieldHistoryKeys } from '@/hooks/fieldHistoryKeys';
import { commentsKeys } from '@/hooks/useComments';
import { descriptionKeys } from '@/hooks/useRecordDescription';
import {
    AGGREGATES_NS,
    invalidateForList,
    isRecentLocalRecordsChange,
    listIdentifiersFor,
    recordsKeys,
} from '@/hooks/useRecords';
import { layoutDataKeys } from '@/admin/records/layout/useLayoutData';
import { viewsKeys } from '@/hooks/useSavedViews';
import { notificationKeys } from '@/hooks/useNotifications';
import { invalidateDashboardsForList } from '@/hooks/useDashboards';

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

        // v0.1.286 — los eventos llegan en RÁFAGAS (aplicar una plantilla crea
        // 2-3 listas con sus campos y vistas: un evento por cada cosa) y cada
        // uno re-pedía lo mismo — `GET /lists` ×5 tras crear una lista desde
        // una plantilla. Se juntan los iguales durante 150 ms y se invalida
        // UNA vez por tema/lista.
        const pending = new Map<string, RtInvalidate>();
        let flushTimer: number | null = null;
        const flush = (): void => {
            flushTimer = null;
            const batch = [...pending.values()];
            pending.clear();
            for (const ev of batch) invalidate(ev);
        };
        socket.on(RT_EVENT_INVALIDATE, (raw: unknown) => {
            const parsed = rtInvalidateSchema.safeParse(raw);
            if (!parsed.success) return;
            const ev = parsed.data;
            pending.set(`${ev.topic}:${ev.listId ?? '*'}`, ev);
            if (flushTimer === null) flushTimer = window.setTimeout(flush, 150);
        });

        function invalidate(ev: RtInvalidate): void {
            // v0.1.105 — invalidar por ID *y* SLUG (`invalidateForList`): los
            // eventos traen el id numérico pero RecordsPage registra sus
            // queries bajo el slug → con la key directa los cambios de
            // ajustes/campos hechos en otra pestaña (u otro usuario) jamás
            // refrescaban la lista abierta hasta recargar.
            switch (ev.topic) {
                case 'lists':
                    // El eco de un cambio hecho en ESTA pestaña: la mutación ya
                    // refrescó las listas (v0.1.286). `cancelRefetch: false`: si
                    // ya se están trayendo, no se corta para pedirlas otra vez.
                    if (!isRecentLocalListsChange()) {
                        void qc.invalidateQueries({ queryKey: listsKeys.all }, { cancelRefetch: false });
                    }
                    break;
                case 'fields':
                    if (ev.listId !== undefined) invalidateForList(qc, fieldsKeys.all, ev.listId);
                    else void qc.invalidateQueries({ queryKey: fieldsKeys.all });
                    // Un campo convertido o borrado cambia lo que calculan.
                    invalidateDashboardsForList(qc, ev.listId);
                    break;
                case 'records':
                    // El eco de una edición hecha en ESTA pestaña: la mutación
                    // ya refrescó la lista (v0.1.253).
                    if (ev.listId !== undefined) {
                        if (!isRecentLocalRecordsChange(ev.listId)) {
                            invalidateForList(qc, recordsKeys.all, ev.listId);
                            // La ficha abierta: descripción, actividad y
                            // comentarios viven fuera de `records` (sólo se
                            // refrescan las queries montadas).
                            invalidateForList(qc, descriptionKeys.all, ev.listId);
                            invalidateForList(qc, activityKeys.all, ev.listId);
                            // v0.1.288 — historial por campo y registro de tiempo.
                            invalidateForList(qc, fieldHistoryKeys.all, ev.listId);
                            const ids = listIdentifiersFor(qc, ev.listId);
                            void qc.invalidateQueries({
                                predicate: (q) =>
                                    q.queryKey[0] === commentsKeys.all[0]
                                    && typeof q.queryKey[2] === 'string'
                                    && ids.has(q.queryKey[2]),
                            });
                        }
                    } else {
                        void qc.invalidateQueries({ queryKey: recordsKeys.all });
                        // v0.1.286 — y los totales del pie de la tabla (con
                        // lista, `invalidateForList` de records ya los incluye).
                        void qc.invalidateQueries({ queryKey: [AGGREGATES_NS] });
                    }
                    // v0.1.230 — los gráficos y vinculados de una ficha abierta
                    // leen OTRAS listas: un cambio en cualquiera puede moverlos.
                    void qc.invalidateQueries({ queryKey: layoutDataKeys.all });
                    // v0.1.286 — los tableros con algún widget sobre esa lista
                    // (antes quedaban viejos hasta recargar). También el eco
                    // local: la mutación de la tabla no toca los tableros.
                    invalidateDashboardsForList(qc, ev.listId);
                    break;
                case 'views':
                    if (ev.listId !== undefined) invalidateForList(qc, viewsKeys.all, ev.listId);
                    else void qc.invalidateQueries({ queryKey: viewsKeys.all });
                    break;
                case 'notifications':
                    // v0.1.276 — llega sólo a la sala de esta persona.
                    void qc.invalidateQueries({ queryKey: notificationKeys.all });
                    break;
            }
        }

        return () => {
            if (flushTimer !== null) window.clearTimeout(flushTimer);
            socket.off('connect', join);
            socket.disconnect();
        };
    }, [tenantId, qc]);
}
