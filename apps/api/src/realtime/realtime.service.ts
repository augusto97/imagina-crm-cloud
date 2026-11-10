import { Injectable } from '@nestjs/common';
import {
    RT_EVENT_INVALIDATE,
    type RtInvalidate,
    type RtTopic,
} from '@imagina-base/shared';
import type { Server } from 'socket.io';

export function tenantRoom(tenantId: number): string {
    return `tenant:${tenantId}`;
}

/** v0.1.276 — sala de UNA persona en UNA empresa (su bandeja de avisos). */
export function userRoom(tenantId: number, userId: number): string {
    return `user:${tenantId}:${userId}`;
}

/**
 * Publica eventos de invalidación al workspace (STANDALONE §7). El gateway le
 * inyecta el `Server` de socket.io tras inicializar; mientras no exista
 * (p.ej. en tests unitarios que construyen los services a mano) los emit son
 * no-op. Con el Redis adapter, `to(room).emit` se propaga entre nodos.
 */
/**
 * v0.1.392 — Como mucho UN aviso de «cambiaron los registros» por lista cada
 * este tiempo. Antes cada escritura avisaba a la empresa entera (y, con varios
 * servidores, a todos por Redis): una automatización que tocaba 1.000
 * registros mandaba 1.000 avisos y cada pestaña abierta recargaba 1.000 veces.
 * El primero sale en el acto (una edición a mano se ve al instante); los que
 * llegan dentro de la ventana se juntan en uno solo al final.
 */
export const RECORDS_EMIT_WINDOW_MS = 1000;

interface PendingEmit {
    /** Cuándo salió el último aviso de esta lista. */
    lastAt: number;
    /** Hay un aviso esperando el final de la ventana. */
    timer: ReturnType<typeof setTimeout> | null;
    /** La pestaña que originó los cambios juntados (null = varias: nadie lo ignora). */
    origin: string | undefined | null;
}

@Injectable()
export class RealtimeService {
    private server: Server | null = null;
    private readonly pendingRecords = new Map<string, PendingEmit>();

    setServer(server: Server): void {
        this.server = server;
    }

    private emit(tenantId: number, payload: RtInvalidate): void {
        this.server?.to(tenantRoom(tenantId)).emit(RT_EVENT_INVALIDATE, payload);
    }

    invalidate(tenantId: number, topic: RtTopic, listId?: number, origin?: string): void {
        this.emit(tenantId, { topic, listId, origin });
    }

    lists(tenantId: number, origin?: string): void {
        this.invalidate(tenantId, 'lists', undefined, origin);
    }
    fields(tenantId: number, listId: number, origin?: string): void {
        this.invalidate(tenantId, 'fields', listId, origin);
    }
    records(tenantId: number, listId: number, origin?: string): void {
        if (!this.server) return;
        const key = `${tenantId}:${listId}`;
        const now = Date.now();
        const st = this.pendingRecords.get(key);
        if (!st || (st.timer === null && now - st.lastAt >= RECORDS_EMIT_WINDOW_MS)) {
            this.invalidate(tenantId, 'records', listId, origin);
            this.pendingRecords.set(key, { lastAt: now, timer: null, origin: undefined });
            this.sweepPending(now);
            return;
        }
        // Dentro de la ventana: se junta con lo que ya espera.
        if (st.timer === null) {
            st.origin = origin;
            st.timer = setTimeout(() => {
                const cur = this.pendingRecords.get(key);
                if (!cur) return;
                this.invalidate(tenantId, 'records', listId, cur.origin ?? undefined);
                cur.lastAt = Date.now();
                cur.timer = null;
                cur.origin = undefined;
            }, Math.max(0, RECORDS_EMIT_WINDOW_MS - (now - st.lastAt)));
            st.timer.unref?.();
        } else if (st.origin !== origin) {
            st.origin = null;
        }
    }

    /** Que el mapa no crezca sin fin: las listas sin movimiento hace rato se olvidan. */
    private sweepPending(now: number): void {
        if (this.pendingRecords.size < 5000) return;
        for (const [k, v] of this.pendingRecords) if (v.timer === null && now - v.lastAt > 60_000) this.pendingRecords.delete(k);
    }
    views(tenantId: number, listId: number, origin?: string): void {
        this.invalidate(tenantId, 'views', listId, origin);
    }
    /** v0.1.276 — la bandeja de avisos de una persona cambió (sólo a ella). */
    notifications(tenantId: number, userId: number): void {
        this.server?.to(userRoom(tenantId, userId)).emit(RT_EVENT_INVALIDATE, { topic: 'notifications' } satisfies RtInvalidate);
    }
    /** v0.1.291 — el cronómetro de una persona cambió (sus otras pestañas y equipos). */
    timer(tenantId: number, userId: number): void {
        this.server?.to(userRoom(tenantId, userId)).emit(RT_EVENT_INVALIDATE, { topic: 'timer' } satisfies RtInvalidate);
    }
}
