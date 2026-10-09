import { Logger, type OnApplicationShutdown } from '@nestjs/common';
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
import { memberships, users } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { RealtimeService, tenantRoom, userRoom } from './realtime.service';

/**
 * Orígenes permitidos para CORS del WebSocket. Por defecto NO se habilita
 * CORS (el front se sirve same-origin, y en dev Vite proxya `/socket.io`),
 * así ningún sitio ajeno puede abrir un socket con la cookie del usuario.
 * Despliegues cross-origin legítimos: `WS_ALLOWED_ORIGINS=a.com,b.com`.
 * (Antes: `origin: true` — reflejaba cualquier Origin con credenciales.)
 */
/**
 * SEC-35 (v0.1.239): cada cuánto se re-valida un socket abierto. Antes la
 * sesión se miraba SÓLO al conectar: cerrar sesión, "cerrar las demás",
 * recuperar la contraseña, desactivar la cuenta o sacar a la persona de la
 * empresa no cortaban el socket, que seguía recibiendo los avisos del
 * workspace hasta que cerraba la pestaña.
 */
const REVALIDATE_MS = 60_000;

const wsAllowedOrigins = (process.env.WS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/**
 * Gateway de realtime. Autentica cada socket por la cookie de sesión (la
 * misma sesión opaca del HTTP), y sólo permite unirse a la room de un tenant
 * si el usuario tiene membership — así un socket jamás recibe eventos de un
 * workspace ajeno (defensa análoga a la RLS del lado HTTP).
 */
@WebSocketGateway(
    wsAllowedOrigins.length > 0
        ? { cors: { origin: wsAllowedOrigins, credentials: true } }
        : {},
)
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
    private readonly logger = new Logger(RealtimeGateway.name);
    private sweeper: NodeJS.Timeout | null = null;

    @WebSocketServer()
    private server!: Server;

    constructor(
        private readonly realtime: RealtimeService,
        private readonly sessions: SessionService,
        private readonly tenantDb: TenantDb,
    ) {}

    afterInit(server: Server): void {
        this.realtime.setServer(server);
        this.sweeper = setInterval(() => void this.revalidateAll(server), REVALIDATE_MS);
        this.sweeper.unref();
    }

    onApplicationShutdown(): void {
        if (this.sweeper) clearInterval(this.sweeper);
    }

    async handleConnection(client: Socket): Promise<void> {
        const auth = await this.authenticate(client);
        if (!auth) {
            client.disconnect(true);
            return;
        }
        client.data.userId = auth.userId;
        client.data.token = auth.token;
    }

    /** Sockets de ESTE nodo (cada nodo revisa los suyos). */
    async revalidateAll(server: Server): Promise<void> {
        const sockets = [...server.sockets.sockets.values()];
        for (const client of sockets) {
            const ok = await this.stillAllowed(client).catch(() => true); // Redis/DB caídos: no se corta a ciegas
            if (!ok) client.disconnect(true);
        }
    }

    /** ¿La sesión sigue viva, la cuenta activa y (si se unió) sigue siendo miembro? */
    async stillAllowed(client: Socket): Promise<boolean> {
        const token = client.data.token as string | undefined;
        const userId = client.data.userId as number | undefined;
        if (!token || !userId) return false;
        const session = await this.sessions.peek(token);
        if (!session || session.userId !== userId || session.portalTenantId !== undefined) return false;
        const tenantId = client.data.tenantId as number | undefined;
        return this.tenantDb.withUser(userId, async (tx) => {
            const [u] = await tx.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId)).limit(1);
            if (!u || u.disabledAt) return false;
            if (tenantId === undefined) return true;
            const [m] = await tx
                .select({ role: memberships.role })
                .from(memberships)
                .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
                .limit(1);
            return m !== undefined && m.role !== 'client';
        });
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
                .select({ tenantId: memberships.tenantId, role: memberships.role })
                .from(memberships)
                .where(
                    and(
                        eq(memberships.userId, userId),
                        eq(memberships.tenantId, parsed.data.tenantId),
                    ),
                )
                .limit(1);
            // SEC-25 (v0.1.226): el rol `client` es sólo portal — no recibe los
            // avisos de toda la empresa (qué listas cambian y cuándo).
            return row !== undefined && row.role !== 'client';
        });
        if (!isMember) {
            return { ok: false };
        }
        // Deja sólo la room del workspace activo (evita ecos de otros).
        for (const room of client.rooms) {
            if (room.startsWith('tenant:') || room.startsWith('user:')) await client.leave(room);
        }
        await client.join(tenantRoom(parsed.data.tenantId));
        // v0.1.276 — su bandeja de avisos en esta empresa.
        await client.join(userRoom(parsed.data.tenantId, userId));
        client.data.tenantId = parsed.data.tenantId;
        return { ok: true };
    }

    private async authenticate(client: Socket): Promise<{ userId: number; token: string } | null> {
        const raw = client.handshake.headers.cookie;
        if (!raw) return null;
        const token = readCookie(raw, SESSION_COOKIE);
        if (!token) return null;
        const session = await this.sessions.get(token).catch(() => null);
        // SEC-24/25: una sesión del portal no abre el socket de la app.
        if (!session || session.portalTenantId !== undefined) return null;
        return { userId: session.userId, token };
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
