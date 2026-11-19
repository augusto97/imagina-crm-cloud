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
import { createRealtimeInvalidator, mergeRtEvents } from '@/cloud/realtimeInvalidate';

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

        // Qué se vuelve a pedir con cada aviso (y cuándo NO): `realtimeInvalidate`.
        const invalidator = createRealtimeInvalidator(qc);
        const invalidate = (ev: RtInvalidate): void => invalidator.handle(ev);
        const onVisibility = (): void => {
            if (!document.hidden) invalidator.onVisible();
        };
        document.addEventListener('visibilitychange', onVisibility);

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
            // v0.1.461 — si en la ráfaga vienen el eco propio y el cambio de una
            // automatización, el aviso juntado no es eco (no se pierde ninguno).
            const key = `${ev.topic}:${ev.listId ?? '*'}`;
            pending.set(key, mergeRtEvents(pending.get(key), ev));
            if (flushTimer === null) flushTimer = window.setTimeout(flush, 150);
        });

        return () => {
            if (flushTimer !== null) window.clearTimeout(flushTimer);
            document.removeEventListener('visibilitychange', onVisibility);
            invalidator.dispose();
            socket.off('connect', join);
            socket.disconnect();
        };
    }, [tenantId, qc]);
}
