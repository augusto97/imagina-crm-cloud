import { Inject, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import {
    OnGatewayConnection,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { RT_EVENT_JOIN, rtJoinSchema } from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { DRIZZLE, type Db } from '../db/client';
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
/**
 * v0.1.392 — de a cuántos sockets se re-validan juntos. Antes era UNA
 * transacción por socket por minuto: con 10.000 pestañas abiertas, ~170
 * transacciones por segundo sólo para esto. Ahora, por tanda: las sesiones de
 * Redis en paralelo y DOS consultas (cuentas y membresías).
 */
const REVALIDATE_BATCH = 500;

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
        // v0.1.392 — la re-validación en lote lee cuentas y membresías de una vez.
        @Optional() @Inject(DRIZZLE) private readonly db?: Db,
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
        if (auth.boundTenantId !== undefined) client.data.boundTenantId = auth.boundTenantId;
    }

    /** Sockets de ESTE nodo (cada nodo revisa los suyos). */
    async revalidateAll(server: Server): Promise<void> {
        const sockets = [...server.sockets.sockets.values()];
        for (let i = 0; i < sockets.length; i += REVALIDATE_BATCH) {
            const chunk = sockets.slice(i, i + REVALIDATE_BATCH);
            // Redis/DB caídos: no se corta a ciegas.
            const allowed = await this.allowedOf(chunk).catch(() => null);
            if (!allowed) continue;
            for (const client of chunk) if (!allowed.has(client)) client.disconnect(true);
        }
    }

    /** ¿La sesión sigue viva, la cuenta activa y (si se unió) sigue siendo miembro? */
    async stillAllowed(client: Socket): Promise<boolean> {
        return (await this.allowedOf([client])).has(client);
    }

    /**
     * v0.1.392 — Los sockets de la tanda que siguen habilitados: sesión viva
     * (sin deslizar su TTL), cuenta activa y, si se unió a una empresa, sigue
     * siendo miembro (no cliente del portal).
     */
    async allowedOf(clients: readonly Socket[]): Promise<Set<Socket>> {
        const out = new Set<Socket>();
        const tokens = [...new Set(clients.map((c) => c.data.token as string | undefined).filter((t): t is string => typeof t === 'string' && t !== ''))];
        const sessions = new Map(await Promise.all(tokens.map(async (t) => [t, await this.sessions.peek(t)] as const)));
        const live = clients.filter((c) => {
            const token = c.data.token as string | undefined;
            const userId = c.data.userId as number | undefined;
            if (!token || !userId) return false;
            const session = sessions.get(token);
            return !!session && session.userId === userId && session.portalTenantId === undefined;
        });
        if (live.length === 0) return out;
        if (!this.db) {
            for (const c of live) if (await this.memberStill(c)) out.add(c);
            return out;
        }
        const userIds = [...new Set(live.map((c) => c.data.userId as number))];
        const accounts = await this.db.select({ id: users.id, disabledAt: users.disabledAt }).from(users).where(inArray(users.id, userIds));
        const active = new Set(accounts.filter((u) => !u.disabledAt).map((u) => u.id));
        const joinedUsers = [...new Set(live.filter((c) => c.data.tenantId !== undefined).map((c) => c.data.userId as number))].filter((u) => active.has(u));
        const roles = new Map<string, string>();
        if (joinedUsers.length > 0) {
            const rows = await this.db
                .select({ userId: memberships.userId, tenantId: memberships.tenantId, role: memberships.role })
                .from(memberships)
                .where(inArray(memberships.userId, joinedUsers));
            for (const r of rows) roles.set(`${r.userId}:${r.tenantId}`, r.role);
        }
        for (const c of live) {
            const userId = c.data.userId as number;
            if (!active.has(userId)) continue;
            const tenantId = c.data.tenantId as number | undefined;
            if (tenantId === undefined) {
                out.add(c);
                continue;
            }
            const role = roles.get(`${userId}:${tenantId}`);
            if (role !== undefined && role !== 'client') out.add(c);
        }
        return out;
    }

    /** Sin la base cruda (specs que arman el gateway a mano): de a uno, como antes. */
    private async memberStill(client: Socket): Promise<boolean> {
        const userId = client.data.userId as number;
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
        // Sesión abierta en la dirección de una empresa: sólo los avisos de esa.
        const bound = client.data.boundTenantId as number | undefined;
        if (bound !== undefined && bound !== parsed.data.tenantId) return { ok: false };
        const memberRole = await this.tenantDb.withUser(userId, async (tx) => {
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
            return row === undefined || row.role === 'client' ? null : row.role;
        });
        if (!memberRole) {
            return { ok: false };
        }
        // Deja sólo la room del workspace activo (evita ecos de otros).
        for (const room of client.rooms) {
            if (room.startsWith('tenant:') || room.startsWith('user:')) await client.leave(room);
        }
        // C3 — un invitado tampoco entra a la sala de la empresa (qué listas
        // cambian y cuándo); sólo a la suya (su bandeja de avisos).
        if (memberRole !== 'guest') await client.join(tenantRoom(parsed.data.tenantId));
        // v0.1.276 — su bandeja de avisos en esta empresa.
        await client.join(userRoom(parsed.data.tenantId, userId));
        client.data.tenantId = parsed.data.tenantId;
        return { ok: true };
    }

    private async authenticate(client: Socket): Promise<{ userId: number; token: string; boundTenantId?: number } | null> {
        const raw = client.handshake.headers.cookie;
        if (!raw) return null;
        const token = readCookie(raw, SESSION_COOKIE);
        if (!token) return null;
        const session = await this.sessions.get(token).catch(() => null);
        // SEC-24/25: una sesión del portal no abre el socket de la app.
        if (!session || session.portalTenantId !== undefined) return null;
        return { userId: session.userId, token, ...(session.boundTenantId !== undefined ? { boundTenantId: session.boundTenantId } : {}) };
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
