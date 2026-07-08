import { Logger } from '@nestjs/common';
import {
    OnGatewayConnection,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { RT_EVENT_JOIN, rtJoinSchema } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { memberships } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { RealtimeService, tenantRoom } from './realtime.service';

/**
 * Gateway de realtime. Autentica cada socket por la cookie de sesión (la
 * misma sesión opaca del HTTP), y sólo permite unirse a la room de un tenant
 * si el usuario tiene membership — así un socket jamás recibe eventos de un
 * workspace ajeno (defensa análoga a la RLS del lado HTTP).
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
    private readonly logger = new Logger(RealtimeGateway.name);

    @WebSocketServer()
    private server!: Server;

    constructor(
        private readonly realtime: RealtimeService,
        private readonly sessions: SessionService,
        private readonly tenantDb: TenantDb,
    ) {}

    afterInit(server: Server): void {
        this.realtime.setServer(server);
    }

    async handleConnection(client: Socket): Promise<void> {
        const userId = await this.authenticate(client);
        if (!userId) {
            client.disconnect(true);
            return;
        }
        client.data.userId = userId;
    }

    /** El cliente pide unirse a un workspace; validamos membership. */
    @SubscribeMessage(RT_EVENT_JOIN)
    async onJoin(client: Socket, payload: unknown): Promise<{ ok: boolean }> {
        const parsed = rtJoinSchema.safeParse(payload);
        const userId = client.data.userId as number | undefined;
        if (!parsed.success || !userId) {
            return { ok: false };
        }
        const isMember = await this.tenantDb.withUser(userId, async (tx) => {
            const [row] = await tx
                .select({ tenantId: memberships.tenantId })
                .from(memberships)
                .where(
                    and(
                        eq(memberships.userId, userId),
                        eq(memberships.tenantId, parsed.data.tenantId),
                    ),
                )
                .limit(1);
            return row !== undefined;
        });
        if (!isMember) {
            return { ok: false };
        }
        // Deja sólo la room del workspace activo (evita ecos de otros).
        for (const room of client.rooms) {
            if (room.startsWith('tenant:')) await client.leave(room);
        }
        await client.join(tenantRoom(parsed.data.tenantId));
        return { ok: true };
    }

    private async authenticate(client: Socket): Promise<number | null> {
        const raw = client.handshake.headers.cookie;
        if (!raw) return null;
        const token = readCookie(raw, SESSION_COOKIE);
        if (!token) return null;
        const session = await this.sessions.get(token).catch(() => null);
        return session?.userId ?? null;
    }
}

/** Lee una cookie por nombre del header `Cookie` (sin dependencias). */
function readCookie(header: string, name: string): string | null {
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) {
            return decodeURIComponent(part.slice(eq + 1).trim());
        }
    }
    return null;
}
