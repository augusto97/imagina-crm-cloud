import { ConflictException, UnauthorizedException } from '@nestjs/common';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { loadEnv } from '../src/config/env';
import { MailService } from '../src/mail/mail.service';
import {
    startPostgres,
    startRedis,
    type TestPg,
    type TestRedis,
} from './helpers/containers';

describe('AuthService (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let auth: AuthService;
    let sessions: SessionService;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, DATABASE_URL: pg.container.getConnectionUri() });
        sessions = new SessionService(redis, env);
        const mail = new MailService(env, { name: 'test', send: async () => undefined });
        auth = new AuthService(pg.db, redis, env, mail, sessions);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('register crea usuario + workspace + membership admin y devuelve sesión', async () => {
        const session = await auth.register({
            email: 'ana@acme.test',
            password: 'secreto-123',
            name: 'Ana',
            workspace_name: 'ACME S.A.S.',
        });

        expect(session.user.email).toBe('ana@acme.test');
        expect(session.token).toBeTruthy();
        expect(session.memberships).toHaveLength(1);
        expect(session.memberships[0]).toMatchObject({ tenant_slug: 'acme-s-a-s', role: 'admin' });

        const stored = await sessions.get(session.token as string);
        expect(stored?.userId).toBe(session.user.id);
    });

    it('email duplicado (case-insensitive) → 409', async () => {
        await expect(
            auth.register({
                email: 'ANA@acme.test'.toLowerCase(),
                password: 'otra-clave-99',
                name: 'Ana bis',
                workspace_name: 'Otro WS',
            }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('colisión de slug de workspace → sufijo -2', async () => {
        const session = await auth.register({
            email: 'beto@acme.test',
            password: 'secreto-123',
            name: 'Beto',
            workspace_name: 'ACME S.A.S.',
        });
        expect(session.memberships[0]!.tenant_slug).toBe('acme-s-a-s-2');
    });

    it('login válido devuelve sesión con memberships', async () => {
        const session = await auth.login({ email: 'ana@acme.test', password: 'secreto-123' });
        expect(session.token).toBeTruthy();
        expect(session.memberships[0]!.tenant_slug).toBe('acme-s-a-s');
    });

    it('password incorrecta y usuario inexistente → 401', async () => {
        await expect(
            auth.login({ email: 'ana@acme.test', password: 'incorrecta' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
            auth.login({ email: 'nadie@acme.test', password: 'loquesea' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('logout revoca la sesión al instante (sesiones opacas en Redis)', async () => {
        const session = await auth.login({ email: 'ana@acme.test', password: 'secreto-123' });
        const token = session.token as string;
        expect(await sessions.get(token)).not.toBeNull();

        await auth.logout(token);
        expect(await sessions.get(token)).toBeNull();
    });

    it('me devuelve usuario + memberships', async () => {
        const login = await auth.login({ email: 'ana@acme.test', password: 'secreto-123' });
        const me = await auth.me(login.user.id);
        expect(me.user.id).toBe(login.user.id);
        expect(me.memberships).toHaveLength(1);
        expect(me.token).toBeUndefined();
    });
});
