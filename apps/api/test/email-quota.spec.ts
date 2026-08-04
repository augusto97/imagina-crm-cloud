import { createServer, type Server } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { plans, tenants } from '../src/db/schema';
import { EmailQuotaExceededError, EmailQuotaService, periodOf } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { startPostgres, type TestPg } from './helpers/containers';

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

/**
 * SMTP mínimo de verdad (el diálogo que espera nodemailer). Sirve para probar
 * que un correo enviado por el SMTP PROPIO del cliente NO consume la cuota de
 * la plataforma — que es toda la promesa de ADR-S18.
 */
function startFakeSmtp(): Promise<{ server: Server; port: number; received: string[] }> {
    const received: string[] = [];
    const server = createServer((socket) => {
        let data = false;
        socket.write('220 fake ESMTP\r\n');
        socket.on('data', (chunk) => {
            for (const line of chunk.toString('utf8').split(/\r\n/)) {
                if (line === '') continue;
                if (data) {
                    if (line === '.') {
                        data = false;
                        received.push('mail');
                        socket.write('250 OK\r\n');
                    }
                    continue;
                }
                const cmd = line.slice(0, 4).toUpperCase();
                if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
                else if (cmd === 'AUTH') socket.write('235 ok\r\n');
                else if (cmd === 'DATA') {
                    data = true;
                    socket.write('354 go\r\n');
                } else if (cmd === 'QUIT') socket.write('221 bye\r\n');
                else socket.write('250 OK\r\n');
            }
        });
        socket.on('error', () => undefined);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () =>
            resolve({ server, port: (server.address() as { port: number }).port, received }),
        );
    });
}

describe('Cuota mensual de correos (ADR-S18)', () => {
    let pg: TestPg;
    let quota: EmailQuotaService;
    let plansService: PlansService;
    let smtp: TenantSmtpService;
    let tenantId: number;

    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });

    beforeAll(async () => {
        pg = await startPostgres();
        plansService = new PlansService(pg.db);
        quota = new EmailQuotaService(pg.db, plansService);
        smtp = new TenantSmtpService(pg.db, env);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    beforeEach(async () => {
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `mailq-${counter}`, name: 'ACME', plan: 'trial', status: 'trialing' })
            .returning();
        tenantId = t!.id;
    });

    it('cuenta por mes: cada envío suma y el período se aísla', async () => {
        expect(await quota.usedThisMonth(tenantId)).toBe(0);
        await quota.record(tenantId);
        await quota.record(tenantId);
        expect(await quota.usedThisMonth(tenantId)).toBe(2);
        // El mes que viene arranca de cero (el contador es por período).
        const nextMonth = new Date(Date.UTC(2099, 0, 15));
        expect(periodOf(nextMonth)).toBe('2099-01');
        expect(await quota.usedThisMonth(tenantId, nextMonth)).toBe(0);
    });

    it('el límite sale del plan y bloquea al alcanzarlo', async () => {
        await pg.db.update(plans).set({ maxEmailsMonth: 2 }).where(eq(plans.slug, 'trial'));
        await new Promise((r) => setTimeout(r, 0));
        const fresh = new PlansService(pg.db);
        const q = new EmailQuotaService(pg.db, fresh);

        expect(await q.limitFor(tenantId)).toBe(2);
        await q.assertWithinQuota(tenantId); // 0/2 → pasa
        await q.record(tenantId);
        await q.record(tenantId);
        await expect(q.assertWithinQuota(tenantId)).rejects.toBeInstanceOf(EmailQuotaExceededError);
        // El mensaje enseña la salida: SMTP propio.
        await q.assertWithinQuota(tenantId).catch((err: Error) => {
            expect(err.message).toContain('SMTP propio');
        });
        await pg.db.update(plans).set({ maxEmailsMonth: 100 }).where(eq(plans.slug, 'trial'));
    });

    it('un plan sin límite (enterprise) no bloquea nunca', async () => {
        await pg.db.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantId));
        const q = new EmailQuotaService(pg.db, new PlansService(pg.db));
        expect(await q.limitFor(tenantId)).toBeNull();
        await q.record(tenantId);
        await expect(q.assertWithinQuota(tenantId)).resolves.toBeUndefined();
    });

    it('los correos por el SMTP de la plataforma consumen cuota y, agotada, NO se envían', async () => {
        await pg.db.update(plans).set({ maxEmailsMonth: 1 }).where(eq(plans.slug, 'trial'));
        const q = new EmailQuotaService(pg.db, new PlansService(pg.db));
        const transport = new CapturingMailTransport();
        const mail = new MailService(env, transport, undefined, smtp, q);

        await mail.sendNow({ tenantId, to: 'a@test.local', subject: 'uno', text: 'x' });
        expect(transport.sent).toHaveLength(1);
        expect(await q.usedThisMonth(tenantId)).toBe(1);

        await expect(
            mail.sendNow({ tenantId, to: 'b@test.local', subject: 'dos', text: 'x' }),
        ).rejects.toBeInstanceOf(EmailQuotaExceededError);
        // El segundo NO salió: la cuota se verifica ANTES de entregar.
        expect(transport.sent).toHaveLength(1);
        expect(await q.usedThisMonth(tenantId)).toBe(1);
        await pg.db.update(plans).set({ maxEmailsMonth: 100 }).where(eq(plans.slug, 'trial'));
    });

    it('los correos de CUENTA (sin empresa) nunca se limitan', async () => {
        await pg.db.update(plans).set({ maxEmailsMonth: 0 }).where(eq(plans.slug, 'trial'));
        const q = new EmailQuotaService(pg.db, new PlansService(pg.db));
        const transport = new CapturingMailTransport();
        const mail = new MailService(env, transport, undefined, smtp, q);
        // Reset de contraseña / verificación de email: sin tenantId. Frenarlos
        // dejaría a alguien afuera de su propia cuenta.
        await mail.sendNow({ to: 'quien@test.local', subject: 'reset', text: 'x' });
        expect(transport.sent).toHaveLength(1);
        await pg.db.update(plans).set({ maxEmailsMonth: 100 }).where(eq(plans.slug, 'trial'));
    });

    it('con SMTP PROPIO el correo sale y NO consume cuota (aunque esté agotada)', async () => {
        const fake = await startFakeSmtp();
        try {
            await pg.db.update(plans).set({ maxEmailsMonth: 0 }).where(eq(plans.slug, 'trial'));
            await smtp.update(tenantId, {
                host: '127.0.0.1',
                port: fake.port,
                secure: false,
                user: 'u',
                pass: 'p',
                from: 'ventas@acme.test',
            });
            const q = new EmailQuotaService(pg.db, new PlansService(pg.db));
            const transport = new CapturingMailTransport();
            const mail = new MailService(env, transport, undefined, smtp, q);

            await mail.sendNow({ tenantId, to: 'cliente@test.local', subject: 'propio', text: 'x' });

            expect(fake.received).toEqual(['mail']); // salió por el SMTP del cliente
            expect(transport.sent).toHaveLength(0); // no tocó el de la plataforma
            expect(await q.usedThisMonth(tenantId)).toBe(0); // ni consumió cuota
        } finally {
            await pg.db.update(plans).set({ maxEmailsMonth: 100 }).where(eq(plans.slug, 'trial'));
            await new Promise<void>((resolve) => fake.server.close(() => resolve()));
        }
    });
});
