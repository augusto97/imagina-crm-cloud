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

/**
 * Publica eventos de invalidación al workspace (STANDALONE §7). El gateway le
 * inyecta el `Server` de socket.io tras inicializar; mientras no exista
 * (p.ej. en tests unitarios que construyen los services a mano) los emit son
 * no-op. Con el Redis adapter, `to(room).emit` se propaga entre nodos.
 */
@Injectable()
export class RealtimeService {
    private server: Server | null = null;

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
        this.invalidate(tenantId, 'records', listId, origin);
    }
    views(tenantId: number, listId: number, origin?: string): void {
        this.invalidate(tenantId, 'views', listId, origin);
    }
}
