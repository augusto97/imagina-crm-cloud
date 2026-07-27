import { createHash } from 'node:crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { loadEnv } from '../src/config/env';
import { users } from '../src/db/schema';
import { MailService } from '../src/mail/mail.service';
import {
    startPostgres,
    startRedis,
    type TestPg,
    type TestRedis,
} from './helpers/containers';
import { loginOk } from './helpers/login';
import { totp } from '../src/auth/totp';

/** Espera a que algo asíncrono aparezca (evita sleeps fijos que flakean). */
async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error('waitFor: timeout');
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('AuthService (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let auth: AuthService;
    let sessions: SessionService;
    const sentMail: Array<{ to: string; subject: string; text: string }> = [];

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, DATABASE_URL: pg.container.getConnectionUri() });
        sessions = new SessionService(redis, env);
        const mail = new MailService(env, {
            name: 'test',
            send: async (m) => {
                sentMail.push({ to: m.to, subject: m.subject, text: m.text ?? '' });
            },
        });
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
        const session = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        expect(session.token).toBeTruthy();
        expect(session.memberships[0]!.tenant_slug).toBe('acme-s-a-s');
    });

    it('password incorrecta y usuario inexistente → 401', async () => {
        await expect(
            loginOk(auth, { email: 'ana@acme.test', password: 'incorrecta' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
            loginOk(auth, { email: 'nadie@acme.test', password: 'loquesea' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('logout revoca la sesión al instante (sesiones opacas en Redis)', async () => {
        const session = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const token = session.token as string;
        expect(await sessions.get(token)).not.toBeNull();

        await auth.logout(token);
        expect(await sessions.get(token)).toBeNull();
    });

    // SEC-22 (v0.1.113): resetear la contraseña tiene que CERRAR todas las
    // sesiones abiertas. Sin esto, quien hubiera robado una sesión seguía
    // adentro después de que la víctima "recuperaba" la cuenta (el TTL de
    // sesión es de 30 días deslizantes).
    it('resetear la contraseña revoca TODAS las sesiones abiertas', async () => {
        const a = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const b = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const tokenA = a.token as string;
        const tokenB = b.token as string;
        expect(await sessions.get(tokenA)).not.toBeNull();
        expect(await sessions.get(tokenB)).not.toBeNull();

        // Simula el flujo real: se emite el token de reset y se consume.
        await auth.requestPasswordReset('ana@acme.test');
        const key = (await redis.keys('pwreset:*'))[0];
        expect(key).toBeDefined();
        const resetToken = key!.split(':')[1]!;
        await auth.resetPassword(resetToken, 'nueva-clave-456');

        // Las dos sesiones previas quedaron muertas...
        expect(await sessions.get(tokenA)).toBeNull();
        expect(await sessions.get(tokenB)).toBeNull();
        // ...y la contraseña nueva es la que vale.
        const fresh = await loginOk(auth, { email: 'ana@acme.test', password: 'nueva-clave-456' });
        expect(fresh.token).toBeTruthy();
        // Restauramos la contraseña original para no romper los tests siguientes.
        await auth.requestPasswordReset('ana@acme.test');
        const key2 = (await redis.keys('pwreset:*'))[0]!;
        await auth.resetPassword(key2.split(':')[1]!, 'secreto-123');
    });

    // ─── v0.1.118: verificación de email ────────────────────────────────

    it('el alta queda SIN verificar, manda el correo y el link la confirma', async () => {
        const email = 'nuevo@verify.test';
        const reg = await auth.register({
            email,
            password: 'secreto-123',
            name: 'Nuevo',
            workspace_name: 'Verify WS',
        });
        // Entra igual (bloquear el primer uso mata la activación)…
        expect(reg.token).toBeTruthy();
        // …pero marcado como no verificado.
        expect(reg.user.email_verified).toBe(false);

        // El correo se encola SIN await dentro de register (no bloquear el
        // alta), así que se espera por CONDICIÓN — un sleep fijo flakea en un
        // runner frío. Y el token se saca del correo de ESTE usuario, no de un
        // scan de Redis: `keys()` devuelve también los de otros tests y a
        // veces terminaba verificando la cuenta equivocada.
        const mail = await waitFor(async () =>
            sentMail.find((m) => m.to === email && /Confirmá tu email/i.test(m.subject)),
        );
        const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
        expect(token).toBeTruthy();

        await auth.verifyEmail(token!);
        const after = await auth.me(reg.user.id);
        expect(after.user.email_verified).toBe(true);

        // El token es de un solo uso.
        await expect(auth.verifyEmail(token!)).rejects.toThrow(/inválido o expiró/i);
    });

    it('reenviar la verificación no hace nada si ya está verificado', async () => {
        const [u] = await pg.db
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = 'nuevo@verify.test'`)
            .limit(1);
        // Silencioso: si ya está verificado, no manda correo nuevo.
        const before = sentMail.filter((m) => m.to === 'nuevo@verify.test').length;
        await auth.sendEmailVerification(u!.id);
        expect(sentMail.filter((m) => m.to === 'nuevo@verify.test').length).toBe(before);
    });

    // ─── v0.1.116: seguridad de la cuenta ───────────────────────────────

    it('cambiar la contraseña cierra los OTROS dispositivos, no el actual', async () => {
        const a = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const b = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const tokenA = a.token as string;
        const tokenB = b.token as string;

        const res = await auth.changePassword(a.user.id, tokenA, {
            current_password: 'secreto-123',
            new_password: 'otra-clave-999',
        });
        expect(res.revoked_sessions).toBeGreaterThanOrEqual(1);
        // La sesión desde la que se cambió SIGUE viva (no te echa a vos mismo)…
        expect(await sessions.get(tokenA)).not.toBeNull();
        // …y las demás mueren.
        expect(await sessions.get(tokenB)).toBeNull();

        const fresh = await loginOk(auth, { email: 'ana@acme.test', password: 'otra-clave-999' });
        expect(fresh.token).toBeTruthy();
        // Restaurar para los tests siguientes.
        await auth.changePassword(fresh.user.id, fresh.token as string, {
            current_password: 'otra-clave-999',
            new_password: 'secreto-123',
        });
    });

    it('cambiar la contraseña exige la actual', async () => {
        const s = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        await expect(
            auth.changePassword(s.user.id, s.token as string, {
                current_password: 'no-es-esta',
                new_password: 'da-igual-123',
            }),
        ).rejects.toThrow(/actual no es correcta/i);
    });

    it('lista las sesiones activas sin exponer el token y permite cerrarlas', async () => {
        const a = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const b = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const tokenA = a.token as string;

        const list = await auth.listSessions(a.user.id, tokenA);
        expect(list.length).toBeGreaterThanOrEqual(2);
        // El token NUNCA aparece en la respuesta.
        expect(JSON.stringify(list)).not.toContain(tokenA);
        expect(list[0]!.current).toBe(true);

        // Se identifica la sesión B por el hash de SU token (no por el orden
        // de la lista: varias sesiones del mismo segundo empatan y el test
        // quedaba a merced del desempate).
        const idOfB = createHash('sha256').update(b.token as string).digest('hex').slice(0, 16);
        expect(list.some((x) => x.id === idOfB)).toBe(true);
        await auth.revokeSession(a.user.id, idOfB);
        expect(await sessions.get(b.token as string)).toBeNull();
        await expect(auth.revokeSession(a.user.id, 'no-existe')).rejects.toThrow();
    });

    it('bloquea la fuerza bruta POR CUENTA aunque cambie la IP', async () => {
        // El límite por IP de main.ts no frena a mil IPs contra el mismo email;
        // este contador vive en Redis y es por cuenta.
        const email = 'bruta@acme.test';
        await auth.register({
            email,
            password: 'secreto-123',
            name: 'Bruta',
            workspace_name: 'Bruta WS',
        });
        for (let i = 0; i < 10; i++) {
            await expect(auth.login({ email, password: 'incorrecta' })).rejects.toThrow();
        }
        // Al pasar el tope, ni siquiera la contraseña BUENA entra.
        await expect(auth.login({ email, password: 'secreto-123' })).rejects.toThrow(
            /demasiados intentos/i,
        );
        await redis.del(`loginfail:${email}`);
        const ok = await loginOk(auth, { email, password: 'secreto-123' });
        expect(ok.token).toBeTruthy();
    });

    it('me devuelve usuario + memberships', async () => {
        const login = await loginOk(auth, { email: 'ana@acme.test', password: 'secreto-123' });
        const me = await auth.me(login.user.id);
        expect(me.user.id).toBe(login.user.id);
        expect(me.memberships).toHaveLength(1);
        expect(me.token).toBeUndefined();
    });

    // SEC-04: un email de PLATFORM_SUPERADMINS no puede reclamarse vía registro
    // público, y se pre-provisiona en el boot para que solo su dueño lo active.
    it('pre-provisiona superadmins en boot y bloquea su registro público', async () => {
        const env = loadEnv({
            REDIS_URL: redisBox.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            PLATFORM_SUPERADMINS: 'boss@platform.test',
        });
        const mail = new MailService(env, { name: 'test', send: async () => undefined });
        const superAuth = new AuthService(pg.db, redis, env, mail, sessions);

        // Boot: crea la cuenta si no existe.
        await superAuth.onModuleInit();
        const [provisioned] = await pg.db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = 'boss@platform.test'`)
            .limit(1);
        expect(provisioned).toBeTruthy();

        // El registro público de ese email se rechaza (mismo error que duplicado).
        await expect(
            superAuth.register({
                email: 'boss@platform.test',
                password: 'atacante-123',
                name: 'Atacante',
                workspace_name: 'Hostil',
            }),
        ).rejects.toBeInstanceOf(ConflictException);

        // Idempotente: re-boot no falla ni duplica.
        await superAuth.onModuleInit();
        const rows = await pg.db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = 'boss@platform.test'`);
        expect(rows).toHaveLength(1);
    });

    // ─────────────── v0.1.120: verificación en dos pasos ───────────────

    describe('2FA (TOTP)', () => {
        const EMAIL = 'mfa@acme.test';
        const PASSWORD = 'clave-mfa-123';

        async function newAccount(): Promise<number> {
            const s = await auth.register({
                email: `${Date.now()}-${EMAIL}`,
                password: PASSWORD,
                name: 'MFA',
                workspace_name: `WS MFA ${Date.now()}`,
            });
            return s.user.id;
        }

        it('alta: el secreto no se activa hasta confirmar un código válido', async () => {
            const userId = await newAccount();
            const setup = await auth.setupTwoFactor(userId);
            expect(setup.otpauth_uri).toContain('otpauth://totp/');

            // Todavía inactivo: el login sigue abriendo sesión directo.
            expect((await auth.twoFactorStatus(userId)).enabled).toBe(false);

            // Código equivocado → 400 y sigue inactivo.
            await expect(auth.enableTwoFactor(userId, '000000')).rejects.toThrow();
            expect((await auth.twoFactorStatus(userId)).enabled).toBe(false);

            const { backup_codes } = await auth.enableTwoFactor(userId, totp(setup.secret));
            expect(backup_codes).toHaveLength(10);
            const status = await auth.twoFactorStatus(userId);
            expect(status).toMatchObject({ enabled: true, backup_codes_left: 10 });
        });

        it('el secreto se guarda CIFRADO (quien lea la tabla no genera códigos)', async () => {
            const cryptoEnv = loadEnv({
                REDIS_URL: redisBox.url,
                DATABASE_URL: pg.container.getConnectionUri(),
                SECRETS_KEY: 'clave-de-cifrado-de-los-tests',
            });
            const mail = new MailService(cryptoEnv, { name: 'test', send: async () => undefined });
            const encAuth = new AuthService(pg.db, redis, cryptoEnv, mail, sessions);

            const s = await encAuth.register({
                email: `enc-${Date.now()}@acme.test`,
                password: PASSWORD,
                name: 'Enc',
                workspace_name: `WS Enc ${Date.now()}`,
            });
            const setup = await encAuth.setupTwoFactor(s.user.id);
            await encAuth.enableTwoFactor(s.user.id, totp(setup.secret));

            const [row] = await pg.db
                .select({ secret: users.totpSecret })
                .from(users)
                .where(eq(users.id, s.user.id))
                .limit(1);
            expect(row!.secret).toMatch(/^enc:v1:/);
            expect(row!.secret).not.toContain(setup.secret);

            // Y aun así el login funciona (se descifra para verificar).
            const challenge = await encAuth.login({ email: s.user.email, password: PASSWORD });
            expect('mfa_required' in challenge).toBe(true);
            const session = await encAuth.verifyTwoFactorLogin({
                challenge: (challenge as { challenge: string }).challenge,
                code: totp(setup.secret),
            });
            expect(session.token).toBeTruthy();
        });

        it('login: con 2FA no abre sesión, devuelve desafío y lo canjea el código', async () => {
            const userId = await newAccount();
            const [u] = await pg.db.select().from(users).where(eq(users.id, userId)).limit(1);
            const email = u!.email;
            const setup = await auth.setupTwoFactor(userId);
            await auth.enableTwoFactor(userId, totp(setup.secret));

            const result = await auth.login({ email, password: PASSWORD });
            expect(result).toMatchObject({ mfa_required: true });
            const challenge = (result as { challenge: string }).challenge;
            // Contraseña buena pero SIN segundo factor no hay sesión abierta.
            expect((result as { token?: string }).token).toBeUndefined();

            // Código equivocado → 401, el desafío sigue vivo (un dedazo no obliga
            // a reingresar la contraseña).
            await expect(
                auth.verifyTwoFactorLogin({ challenge, code: '000000' }),
            ).rejects.toBeInstanceOf(UnauthorizedException);

            const session = await auth.verifyTwoFactorLogin({ challenge, code: totp(setup.secret) });
            expect(session.token).toBeTruthy();
            expect(session.user.two_factor_enabled).toBe(true);
            expect((await sessions.get(session.token as string))?.userId).toBe(userId);

            // El desafío es de un solo uso.
            await expect(
                auth.verifyTwoFactorLogin({ challenge, code: totp(setup.secret) }),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('un código de respaldo entra UNA vez y desaparece de la lista', async () => {
            const userId = await newAccount();
            const [u] = await pg.db.select().from(users).where(eq(users.id, userId)).limit(1);
            const email = u!.email;
            const setup = await auth.setupTwoFactor(userId);
            const { backup_codes } = await auth.enableTwoFactor(userId, totp(setup.secret));
            const code = backup_codes[0]!;

            const first = await auth.login({ email, password: PASSWORD });
            const session = await auth.verifyTwoFactorLogin({
                challenge: (first as { challenge: string }).challenge,
                // Se tipea con minúsculas y sin guión a propósito.
                code: code.toLowerCase().replace('-', ''),
            });
            expect(session.token).toBeTruthy();
            expect((await auth.twoFactorStatus(userId)).backup_codes_left).toBe(9);

            // El mismo código ya no sirve.
            const second = await auth.login({ email, password: PASSWORD });
            await expect(
                auth.verifyTwoFactorLogin({
                    challenge: (second as { challenge: string }).challenge,
                    code,
                }),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('desactivar exige la contraseña y devuelve la cuenta al login simple', async () => {
            const userId = await newAccount();
            const [u] = await pg.db.select().from(users).where(eq(users.id, userId)).limit(1);
            const email = u!.email;
            const setup = await auth.setupTwoFactor(userId);
            await auth.enableTwoFactor(userId, totp(setup.secret));

            await expect(auth.disableTwoFactor(userId, 'no-es-la-clave')).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
            expect((await auth.twoFactorStatus(userId)).enabled).toBe(true);

            await auth.disableTwoFactor(userId, PASSWORD);
            expect((await auth.twoFactorStatus(userId)).enabled).toBe(false);

            const session = await loginOk(auth, { email, password: PASSWORD });
            expect(session.token).toBeTruthy();
            expect(session.user.two_factor_enabled).toBe(false);
        });
    });
});
