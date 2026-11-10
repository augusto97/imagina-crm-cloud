import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import type { Socket } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { loadEnv } from '../src/config/env';
import { memberships, users } from '../src/db/schema';
import { MailService } from '../src/mail/mail.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * SEC-35 (v0.1.239) — un socket abierto se re-valida: si la sesión muere, la
 * cuenta se desactiva o la persona sale de la empresa, deja de recibir avisos.
 */
describe('RealtimeGateway — re-validación de sockets', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let sessions: SessionService;
    let auth: AuthService;
    let gateway: RealtimeGateway;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, DATABASE_URL: pg.container.getConnectionUri() });
        sessions = new SessionService(redis, env);
        auth = new AuthService(pg.db, redis, env, new MailService(env, { name: 'test', send: async () => undefined }), sessions);
        gateway = new RealtimeGateway(new RealtimeService(), sessions, new TenantDb(pg.db), pg.db);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    const socketOf = (data: Record<string, unknown>): Socket => ({ data }) as unknown as Socket;

    async function seed(prefix: string): Promise<{ userId: number; tenantId: number; token: string }> {
        const s = await auth.register({
            email: `${prefix}-${Date.now()}@rt.test`,
            password: 'password123',
            name: prefix,
            workspace_name: `WS ${prefix} ${Date.now()}`,
        });
        const token = await sessions.create(s.user.id, { via: 'password' });
        return { userId: s.user.id, tenantId: s.memberships[0]!.tenant_id, token };
    }

    it('sesión viva y miembro → sigue; sesión cerrada → se corta', async () => {
        const { userId, tenantId, token } = await seed('vivo');
        const client = socketOf({ userId, token, tenantId });
        expect(await gateway.stillAllowed(client)).toBe(true);
        await sessions.destroy(token);
        expect(await gateway.stillAllowed(client)).toBe(false);
    });

    it('cuenta desactivada o fuera de la empresa → se corta', async () => {
        const a = await seed('desact');
        const client = socketOf({ userId: a.userId, token: a.token, tenantId: a.tenantId });
        await pg.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, a.userId));
        expect(await gateway.stillAllowed(client)).toBe(false);

        const b = await seed('baja');
        const clientB = socketOf({ userId: b.userId, token: b.token, tenantId: b.tenantId });
        expect(await gateway.stillAllowed(clientB)).toBe(true);
        await pg.db
            .delete(memberships)
            .where(and(eq(memberships.userId, b.userId), eq(memberships.tenantId, b.tenantId)));
        expect(await gateway.stillAllowed(clientB)).toBe(false);
    });

    it('re-validar NO desliza el TTL de la sesión (una pestaña olvidada no la mantiene viva)', async () => {
        const { userId, tenantId, token } = await seed('ttl');
        await redis.expire(`sess:${token}`, 100);
        await gateway.stillAllowed(socketOf({ userId, token, tenantId }));
        expect(await redis.ttl(`sess:${token}`)).toBeLessThanOrEqual(100);
    });

    // v0.1.392 — la re-validación periódica va en lote: las sesiones de Redis
    // en paralelo y dos consultas (cuentas y membresías) por tanda, en vez de
    // una transacción por socket.
    it('en lote: corta sólo los sockets que ya no corresponden', async () => {
        const ok = await seed('lote-ok');
        const sinSesion = await seed('lote-sesion');
        const baja = await seed('lote-baja');
        const sinUnirse = await seed('lote-libre');
        const vivo = socketOf({ userId: ok.userId, token: ok.token, tenantId: ok.tenantId });
        const otraPestana = socketOf({ userId: ok.userId, token: ok.token, tenantId: ok.tenantId });
        const muerto = socketOf({ userId: sinSesion.userId, token: sinSesion.token, tenantId: sinSesion.tenantId });
        const fuera = socketOf({ userId: baja.userId, token: baja.token, tenantId: baja.tenantId });
        const libre = socketOf({ userId: sinUnirse.userId, token: sinUnirse.token });
        const ajena = socketOf({ userId: ok.userId, token: ok.token, tenantId: baja.tenantId });
        await sessions.destroy(sinSesion.token);
        await pg.db.delete(memberships).where(and(eq(memberships.userId, baja.userId), eq(memberships.tenantId, baja.tenantId)));

        const all = [vivo, otraPestana, muerto, fuera, libre, ajena];
        const allowed = await gateway.allowedOf(all);
        expect(all.map((c) => allowed.has(c))).toEqual([true, true, false, false, true, false]);

        // revalidateAll desconecta exactamente a los que no quedaron.
        const disconnected: Socket[] = [];
        for (const c of all) (c as unknown as { disconnect: () => void }).disconnect = () => disconnected.push(c);
        await gateway.revalidateAll({ sockets: { sockets: new Map(all.map((c, i) => [String(i), c])) } } as never);
        expect(disconnected).toEqual([muerto, fuera, ajena]);
    });
});
