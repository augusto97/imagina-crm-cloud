import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { loadEnv } from '../src/config/env';
import { comments, lists, memberships, records, savedFilters, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { MailService } from '../src/mail/mail.service';
import { AccountDataService } from '../src/me/account-data.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { loginOk } from './helpers/login';

/**
 * v0.1.121 — Datos personales: descarga (GDPR art. 15) y borrado (art. 17).
 *
 * El borrado es una ANONIMIZACIÓN a propósito: el contenido que la persona
 * produjo dentro de una empresa es del cliente, no suyo (ver el comentario del
 * service). Estos tests fijan justamente esa frontera.
 */
describe('AccountDataService (export + borrado de cuenta)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let auth: AuthService;
    let sessions: SessionService;
    let account: AccountDataService;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({
            REDIS_URL: redisBox.url,
            DATABASE_URL: pg.container.getConnectionUri(),
        });
        sessions = new SessionService(redis, env);
        const mail = new MailService(env, { name: 'test', send: async () => undefined });
        auth = new AuthService(pg.db, redis, env, mail, sessions);
        account = new AccountDataService(pg.db, new TenantDb(pg.db), sessions);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    /** Una lista + un registro reales (los FKs de comments/saved_filters). */
    async function seedList(tenantId: number, userId: number): Promise<{ listId: number; recordId: number }> {
        return withTenant(pg.db, tenantId, async (tx) => {
            const [l] = await tx
                .insert(lists)
                .values({ tenantId, slug: `l-${Date.now()}-${Math.floor(userId)}`, name: 'Lista' })
                .returning();
            const [r] = await tx
                .insert(records)
                .values({ tenantId, listId: l!.id, createdBy: userId, data: {} })
                .returning();
            return { listId: l!.id, recordId: r!.id };
        });
    }

    /** Alta con workspace propio; devuelve ids y el email real. */
    async function seedUser(prefix: string): Promise<{ userId: number; tenantId: number; email: string }> {
        const email = `${prefix}-${Date.now()}@gdpr.test`;
        const s = await auth.register({
            email,
            password: 'password123',
            name: prefix,
            workspace_name: `WS ${prefix} ${Date.now()}`,
        });
        return { userId: s.user.id, tenantId: s.memberships[0]!.tenant_id, email };
    }

    it('el export trae la cuenta, sus empresas y lo que escribió en cada una', async () => {
        const { userId, tenantId, email } = await seedUser('export');
        const { listId } = await seedList(tenantId, userId);
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(savedFilters).values({ tenantId, userId, listId, name: 'Mi filtro', filterTree: {} }),
        );

        const dump = await account.exportData(userId);
        expect(dump.account).toMatchObject({ id: userId, email, email_verified: false });
        expect(dump.workspaces).toHaveLength(1);
        expect(dump.workspaces[0]).toMatchObject({ id: tenantId, role: 'admin' });
        expect(dump.workspaces[0]!.saved_filters.map((f) => f.name)).toEqual(['Mi filtro']);
        expect(dump.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('el export NO trae datos de empresas ajenas', async () => {
        const mine = await seedUser('propio');
        const other = await seedUser('ajeno');
        const ajena = await seedList(other.tenantId, other.userId);
        await withTenant(pg.db, other.tenantId, (tx) =>
            tx.insert(savedFilters).values({
                tenantId: other.tenantId,
                userId: other.userId,
                listId: ajena.listId,
                name: 'Filtro ajeno',
                filterTree: {},
            }),
        );

        const dump = await account.exportData(mine.userId);
        expect(dump.workspaces.map((w) => w.id)).toEqual([mine.tenantId]);
        const names = dump.workspaces.flatMap((w) => w.saved_filters.map((f) => f.name));
        expect(names).not.toContain('Filtro ajeno');
    });

    it('borrar exige la contraseña correcta', async () => {
        const { userId } = await seedUser('clave');
        await expect(account.deleteAccount(userId, 'no-es')).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        const [row] = await pg.db.select().from(users).where(eq(users.id, userId)).limit(1);
        expect(row!.disabledAt).toBeNull();
    });

    it('el único admin de una empresa no puede borrarse (409 con la lista)', async () => {
        const { userId } = await seedUser('unico');
        await expect(account.deleteAccount(userId, 'password123')).rejects.toBeInstanceOf(
            ConflictException,
        );
        const blockers = await account.soleAdminWorkspaces(userId);
        expect(blockers).toHaveLength(1);
    });

    it('borra: anonimiza la identidad, corta membresías y sesiones, y CONSERVA el contenido de la empresa', async () => {
        const { userId, tenantId, email } = await seedUser('borra');
        // Otro admin en la misma empresa: sin esto el guard rail bloquearía.
        const socio = await seedUser('socio');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId: socio.userId, tenantId, role: 'admin' }),
        );
        // Un comentario suyo (dato de la EMPRESA) y un filtro suyo (dato personal).
        const { listId, recordId } = await seedList(tenantId, userId);
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.insert(comments).values({
                tenantId,
                listId,
                recordId,
                userId,
                body: 'Comentario de trabajo',
                kind: 'note',
            });
            await tx.insert(savedFilters).values({ tenantId, userId, listId, name: 'Personal', filterTree: {} });
        });
        const session = await loginOk(auth, { email, password: 'password123' });
        expect(await sessions.get(session.token as string)).not.toBeNull();

        await account.deleteAccount(userId, 'password123');

        // Identidad borrada.
        const [row] = await pg.db.select().from(users).where(eq(users.id, userId)).limit(1);
        expect(row!.email).not.toBe(email);
        expect(row!.name).toBe('Usuario eliminado');
        expect(row!.disabledAt).not.toBeNull();
        expect(row!.totpSecret).toBeNull();

        // Sesión muerta al instante y sin membresías.
        expect(await sessions.get(session.token as string)).toBeNull();
        const mems = await pg.db.select().from(memberships).where(eq(memberships.userId, userId));
        expect(mems).toHaveLength(0);

        // Lo personal se fue; lo de la empresa quedó.
        const rest = await withTenant(pg.db, tenantId, async (tx) => ({
            filters: await tx.select().from(savedFilters).where(eq(savedFilters.userId, userId)),
            comments: await tx.select().from(comments).where(eq(comments.userId, userId)),
        }));
        expect(rest.filters).toHaveLength(0);
        expect(rest.comments).toHaveLength(1);
        expect(rest.comments[0]!.body).toBe('Comentario de trabajo');

        // Y la cuenta ya no sirve para entrar.
        await expect(loginOk(auth, { email, password: 'password123' })).rejects.toThrow();
    });
});
