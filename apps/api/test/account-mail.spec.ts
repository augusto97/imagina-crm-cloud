import { describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import { loadEnv, type Env } from '../src/config/env';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { PlatformSettingsService } from '../src/mail/platform-settings.service';
import { LogMailTransport } from '../src/mail/transports/log.transport';
import {
    attachDiagnostics,
    clearDiagnostics,
    readMailLog,
    readServerErrors,
    recordServerError,
} from '../src/observability/diagnostics';

/**
 * v0.1.238 — correos de cuenta honestos + registro de diagnóstico.
 * Redis en memoria: alcanza con los comandos que usan estos dos módulos.
 */
class FakeRedis {
    status = 'ready';
    private kv = new Map<string, string>();
    private lists = new Map<string, string[]>();
    get(k: string) {
        return Promise.resolve(this.kv.get(k) ?? null);
    }
    set(k: string, v: string) {
        this.kv.set(k, v);
        return Promise.resolve('OK');
    }
    del(...keys: string[]) {
        for (const k of keys) {
            this.kv.delete(k);
            this.lists.delete(k);
        }
        return Promise.resolve(keys.length);
    }
    lrange(k: string, start: number, stop: number) {
        return Promise.resolve((this.lists.get(k) ?? []).slice(start, stop + 1));
    }
    multi() {
        const ops: Array<() => void> = [];
        const chain = {
            lpush: (k: string, v: string) => {
                ops.push(() => this.lists.set(k, [v, ...(this.lists.get(k) ?? [])]));
                return chain;
            },
            ltrim: (k: string, start: number, stop: number) => {
                ops.push(() => this.lists.set(k, (this.lists.get(k) ?? []).slice(start, stop + 1)));
                return chain;
            },
            expire: () => chain,
            exec: () => {
                ops.forEach((op) => op());
                return Promise.resolve([]);
            },
        };
        return chain;
    }
}

class CaptureTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

class FailingTransport implements MailTransport {
    readonly name = 'failing';
    send(): Promise<void> {
        return Promise.reject(new Error('535 Authentication failed'));
    }
}

function setup(env: Partial<Env> = {}) {
    const redis = new FakeRedis();
    const fullEnv = { ...loadEnv(), SECRETS_KEY: 'k'.repeat(64), ...env } as Env;
    const platform = new PlatformSettingsService(redis as unknown as Redis, fullEnv);
    attachDiagnostics(redis as unknown as Redis);
    return { redis, env: fullEnv, platform };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('correo de cuenta (v0.1.238)', () => {
    it('re-guardar el SMTP de plataforma con la contraseña vacía CONSERVA la guardada', async () => {
        const { platform } = setup();
        await platform.setSmtp({ host: 'smtp.acme.test', port: 587, secure: false, user: 'u@acme.test', pass: 's3creta', from: 'A <a@acme.test>' });
        // El formulario se re-guarda para cambiar sólo el remitente.
        await platform.setSmtp({ host: 'smtp.acme.test', port: 587, secure: false, user: 'u@acme.test', pass: '', from: 'B <b@acme.test>' });
        const read = await platform.readSmtp();
        expect(read.state).toBe('ok');
        if (read.state === 'ok') {
            expect(read.config.pass).toBe('s3creta');
            expect(read.config.from).toBe('B <b@acme.test>');
        }
        // Con OTRO usuario la contraseña vieja no se arrastra.
        await platform.setSmtp({ host: 'smtp.acme.test', port: 587, secure: false, user: 'otro@acme.test', pass: '', from: 'B <b@acme.test>' });
        const other = await platform.readSmtp();
        expect(other.state === 'ok' && other.config.pass).toBe('');
    });

    it('en producción sin SMTP los correos de cuenta cortan con 503 en vez de "enviarse" al registro', async () => {
        const { platform, env } = setup({ NODE_ENV: 'production' });
        const mail = new MailService(env, new LogMailTransport(), platform);
        const status = await mail.accountMailStatus();
        expect(status).toMatchObject({ available: false, via: 'none' });
        await expect(mail.assertAccountMailAvailable()).rejects.toMatchObject({
            status: 503,
            response: expect.objectContaining({ code: 'mail_unavailable' }),
        });

        // Con el SMTP de plataforma configurado, sí hay por dónde.
        await platform.setSmtp({ host: 'smtp.acme.test', port: 587, secure: false, user: 'u', pass: 'p', from: 'a@acme.test' });
        await expect(mail.accountMailStatus()).resolves.toMatchObject({ available: true, via: 'platform_smtp', host: 'smtp.acme.test' });
        await expect(mail.assertAccountMailAvailable()).resolves.toBeUndefined();
    });

    it('un SMTP del .env cuenta, y en desarrollo el registro alcanza', async () => {
        const { platform, env } = setup({ NODE_ENV: 'production' });
        await expect(new MailService(env, new CaptureTransport(), platform).accountMailStatus()).resolves.toMatchObject({
            available: true,
            via: 'server_smtp',
        });
        const dev = setup({ NODE_ENV: 'development' });
        await expect(new MailService(dev.env, new LogMailTransport(), dev.platform).accountMailStatus()).resolves.toMatchObject({
            available: true,
        });
    });

    it('el registro de correos anota enviados, no enviados y fallidos', async () => {
        const { redis, env, platform } = setup();
        await clearDiagnostics(redis as unknown as Redis);

        await new MailService(env, new CaptureTransport(), platform).sendNow({ to: 'a@b.test', subject: 'Verificá tu correo' });
        await new MailService(env, new LogMailTransport(), platform).sendNow({ to: 'c@d.test', subject: 'Recuperar contraseña' });
        await expect(
            new MailService(env, new FailingTransport(), platform).sendNow({ to: 'e@f.test', subject: 'Invitación', tenantId: 7 }),
        ).rejects.toThrow('535');
        await flush();

        const log = await readMailLog(redis as unknown as Redis);
        expect(log.map((e) => [e.to, e.status, e.via, e.scope])).toEqual([
            ['e@f.test', 'failed', 'server_smtp', 'tenant'],
            ['c@d.test', 'not_sent', 'none', 'account'],
            ['a@b.test', 'sent', 'server_smtp', 'account'],
        ]);
        expect(log[0]!.error).toContain('535');
        expect(log[0]!.tenant_id).toBe(7);
    });

    it('los errores del servidor se guardan sin query string (puede traer tokens)', async () => {
        const { redis } = setup();
        await clearDiagnostics(redis as unknown as Redis);
        recordServerError({ source: 'request', method: 'POST', path: '/api/v1/auth/reset?token=SECRETO', message: 'boom' });
        recordServerError({ source: 'database', message: 'Conexión a Postgres cerrada: terminating connection' });
        await flush();
        const errors = await readServerErrors(redis as unknown as Redis);
        expect(errors).toHaveLength(2);
        expect(errors[1]).toMatchObject({ source: 'request', method: 'POST', path: '/api/v1/auth/reset', message: 'boom' });
        expect(JSON.stringify(errors)).not.toContain('SECRETO');
        expect(errors[0]!.source).toBe('database');
    });
});
