import { MAIL_ACCOUNT_LIMITS, mailAccountKind } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.249 (ADR-S29) — el correo de la EMPRESA por su cuenta de Google o
 * Microsoft. Gmail y Graph se simulan en el borde de red (`safeWebhookFetch`):
 * el test ejercita todo lo nuestro — la elección guardada, el MailService que
 * la pone primera, la petición exacta, el contador diario, los errores que NO
 * caen a otra vía y las protecciones al borrar/desconectar.
 */
interface FakeCall {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 200, body: '{"id":"m1"}' }),
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (
            url: string,
            opts: { method?: string; headers?: Record<string, string>; body?: string },
        ) => {
            const call = { url, method: opts.method, headers: opts.headers, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json' };
        },
    };
});

import { AuditService } from '../src/audit/audit.service';
import { encryptSecret } from '../src/common/secret-box';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { MailAccountService, type MailAccountCounterStore } from '../src/connectors/mail-account.service';
import {
    buildAccountMailRequest,
    buildAccountRfc2822,
    readAccountMailResponse,
} from '../src/connectors/mail-account-request';
import { connections, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

function decodeGmail(body: string | undefined): string {
    const raw = (JSON.parse(body ?? '{}') as { raw: string }).raw;
    return Buffer.from(raw, 'base64url').toString('utf8');
}

describe('armado de la petición (puro)', () => {
    const msg: MailMessage = {
        to: 'cliente@acme.test, otro@acme.test',
        cc: 'jefe@acme.test',
        subject: 'Tu factura de julio — Ñandú',
        html: '<p>Hola <b>Ana</b></p><p>Total: $10</p>',
        from: 'facturacion@acme.test',
        fromName: 'Acme "Facturación"',
    };

    it('Gmail: multipart con texto de respaldo, From de la cuenta y el from pedido como Reply-To', () => {
        const req = buildAccountMailRequest('gmail', msg, 'tok-123', 'notificaciones@acme.test');
        expect(req.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
        expect(req.headers.authorization).toBe('Bearer tok-123');
        const mime = decodeGmail(req.body);
        expect(mime).toMatch(/^From: .+ <notificaciones@acme\.test>\r\n/);
        expect(mime).toContain('To: cliente@acme.test, otro@acme.test');
        expect(mime).toContain('Cc: jefe@acme.test');
        expect(mime).toContain('Reply-To: facturacion@acme.test');
        expect(mime).toContain('Subject: =?UTF-8?B?');
        expect(mime).toContain('Content-Type: multipart/alternative');
        const parts = mime.split(/--imb_[0-9a-f]+/);
        const plain = parts.find((p) => p.includes('text/plain'))!;
        const b64 = plain.split('\r\n\r\n')[1]!.replace(/\s+/g, '');
        expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('Hola Ana\nTotal: $10');
    });

    it('un asunto o nombre con salto de línea no inyecta cabeceras', () => {
        const mime = buildAccountRfc2822(
            { to: 'a@b.test', subject: 'Hola\r\nBcc: victima@x.test', text: 'x', fromName: 'X\nBcc: y@z.test' },
            { to: ['a@b.test'], cc: [], bcc: [], replyTo: null },
            'yo@acme.test',
            'b1',
        );
        expect(mime.split('\r\n').filter((l) => l.startsWith('Bcc:'))).toEqual([]);
    });

    it('Graph: mensaje con HTML, copias, responder-a y guardado en Enviados; el from igual a la cuenta no se duplica', () => {
        const req = buildAccountMailRequest(
            'outlook',
            { ...msg, from: 'NOTIFICACIONES@acme.test' },
            'tok-ms',
            'notificaciones@acme.test',
        );
        expect(req.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
        const body = JSON.parse(req.body!) as { message: Record<string, unknown>; saveToSentItems: boolean };
        expect(body.saveToSentItems).toBe(true);
        expect(body.message.body).toEqual({ contentType: 'HTML', content: msg.html });
        expect(body.message.ccRecipients).toEqual([{ emailAddress: { address: 'jefe@acme.test' } }]);
        expect(body.message.replyTo).toBeUndefined();
        expect(body.message.from).toBeUndefined();
    });

    it('sin destinatario válido no arma nada', () => {
        expect(() => buildAccountMailRequest('gmail', { to: 'no-es-un-correo', subject: 's' }, 't', null)).toThrow(
            /no es un correo válido/,
        );
    });

    it('lee los errores de Google y Microsoft: límite, autorización, permiso', () => {
        expect(readAccountMailResponse('gmail', 200, '{}')).toBeNull();
        const limitG = readAccountMailResponse(
            'gmail',
            429,
            JSON.stringify({ error: { code: 429, message: 'User-rate limit exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } }),
        );
        expect(limitG).toMatchObject({ limit: true });
        expect(limitG!.message).toMatch(/Google frenó el envío/);
        const dailyG = readAccountMailResponse(
            'gmail',
            403,
            JSON.stringify({ error: { message: 'Daily Limit Exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } }),
        );
        expect(dailyG).toMatchObject({ limit: true });
        const limitM = readAccountMailResponse(
            'outlook',
            403,
            JSON.stringify({ error: { code: 'ErrorExceededMessageLimit', message: 'Cannot send mail.' } }),
        );
        expect(limitM).toMatchObject({ limit: true });
        expect(limitM!.message).toMatch(/Microsoft frenó/);
        expect(readAccountMailResponse('outlook', 401, '{}')).toMatchObject({ limit: false });
        expect(readAccountMailResponse('outlook', 401, '{}')!.message).toMatch(/reconectala/);
        expect(
            readAccountMailResponse('gmail', 403, JSON.stringify({ error: { message: 'Request had insufficient authentication scopes.' } }))!
                .message,
        ).toMatch(/falta el permiso/);
    });

    it('tipo de cuenta y límites por dirección', () => {
        expect(mailAccountKind('gmail', 'ana@gmail.com')).toBe('gmail_personal');
        expect(mailAccountKind('gmail', 'ana@acme.co')).toBe('google_workspace');
        expect(mailAccountKind('outlook', 'ana@hotmail.com')).toBe('outlook_personal');
        expect(mailAccountKind('outlook', 'ana@acme.co')).toBe('microsoft_365');
        expect(MAIL_ACCOUNT_LIMITS.gmail_personal.daily_recipients).toBe(500);
        expect(MAIL_ACCOUNT_LIMITS.microsoft_365.per_minute).toBe(30);
    });
});

function memoryCounter(): MailAccountCounterStore & { data: Map<string, number> } {
    const data = new Map<string, number>();
    return {
        data,
        async incrby(key: string, n: number) {
            const v = (data.get(key) ?? 0) + n;
            data.set(key, v);
            return v;
        },
        async expire() {
            return 1;
        },
        async get(key: string) {
            return data.has(key) ? String(data.get(key)) : null;
        },
    };
}

class CaptureTransport implements MailTransport {
    readonly name = 'capture';
    sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
    }
}

describe('correo de la empresa por su cuenta (Postgres real)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let account: MailAccountService;
    let mail: MailService;
    let smtp: TenantSmtpService;
    let platformTransport: CaptureTransport;
    let counter: ReturnType<typeof memoryCounter>;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        const store = memoryOAuthStore();
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, new AuditService(tenantDb), new IntegrationAppsService(store, env));
        counter = memoryCounter();
        account = new MailAccountService(pg.db, counter, connectors);
        smtp = new TenantSmtpService(pg.db, env);
        platformTransport = new CaptureTransport();
        mail = new MailService(env, platformTransport, undefined, smtp, undefined, account);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenantId = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 200, body: '{"id":"m1"}' });
        platformTransport.sent.length = 0;
        counter.data.clear();
        for (const id of [tenantId, otherTenantId]) {
            await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, id));
            await withTenant(pg.db, id, (tx) => tx.delete(connections).where(eq(connections.tenantId, id)));
        }
    });

    async function seedConnection(
        tid: number,
        opts: { provider?: 'gmail' | 'outlook'; address?: string; visibility?: string; token?: boolean; name?: string } = {},
    ): Promise<number> {
        const [row] = await withTenant(pg.db, tid, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId: tid,
                    provider: opts.provider ?? 'gmail',
                    name: opts.name ?? `Gmail · ${opts.address ?? 'notificaciones@acme.test'}`,
                    authType: 'oauth2',
                    visibility: opts.visibility ?? 'workspace',
                    ownerUserId: adminId,
                    config: {
                        account_label: opts.address ?? 'notificaciones@acme.test',
                        oauth_state: { expiresAt: Date.now() + 3600_000, scope: '', error: null },
                    },
                    secrets: opts.token === false ? {} : { access_token: encryptSecret('tok-vigente', KEY), refresh_token: encryptSecret('r', KEY) },
                })
                .returning({ id: connections.id }),
        );
        return row!.id;
    }

    it('sin elegir nada: modo plataforma, la conexión aparece como candidata', async () => {
        const id = await seedConnection(tenantId);
        const st = await account.status(tenantId);
        expect(st.mode).toBe('platform');
        expect(st.account).toBeNull();
        expect(st.candidates).toEqual([
            expect.objectContaining({ connection_id: id, integration: 'gmail', address: 'notificaciones@acme.test', shared: true, ready: true }),
        ]);
        expect(st.notes.length).toBeGreaterThan(2);
    });

    it('elegida: los correos de la empresa salen por Gmail, sin tocar la plataforma, y se cuentan', async () => {
        const id = await seedConnection(tenantId);
        await account.set(tenantId, id);
        await mail.sendNow({ tenantId, to: 'cliente@x.test', cc: 'copia@x.test', subject: 'Hola', text: 'Cuerpo' });
        expect(platformTransport.sent).toHaveLength(0);
        expect(net.calls).toHaveLength(1);
        expect(net.calls[0]!.url).toContain('gmail.googleapis.com');
        expect(net.calls[0]!.headers!.authorization).toBe('Bearer tok-vigente');
        expect(decodeGmail(net.calls[0]!.body)).toContain('From: <notificaciones@acme.test>');

        const st = await account.status(tenantId);
        expect(st.mode).toBe('account');
        expect(st.account).toMatchObject({ connection_id: id, sent_today: 2, problem: null });
        expect(st.account!.limits!.kind).toBe('google_workspace');
        // No consume la cuota de la plataforma (ADR-S18).
        expect(await smtp.ownMail(tenantId)).toBe(true);

        // Los correos de CUENTA (sin empresa) siguen por la plataforma.
        await mail.sendNow({ to: 'alguien@x.test', subject: 'Verificá tu correo', text: 'x' });
        expect(platformTransport.sent).toHaveLength(1);
        // Otra empresa no se entera.
        await mail.sendNow({ tenantId: otherTenantId, to: 'z@x.test', subject: 's', text: 'x' });
        expect(platformTransport.sent).toHaveLength(2);
        expect(net.calls).toHaveLength(1);
    });

    it('Outlook: sale por Graph y la cuenta personal muestra sus límites', async () => {
        const id = await seedConnection(tenantId, { provider: 'outlook', address: 'ana@hotmail.com', name: 'Outlook · ana' });
        await account.set(tenantId, id);
        await mail.sendNow({ tenantId, to: 'cliente@x.test', subject: 'Hola', html: '<p>x</p>' });
        expect(net.calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
        const st = await account.status(tenantId);
        expect(st.account!.limits!.kind).toBe('outlook_personal');
    });

    it('no se puede elegir una privada, una sin autorizar ni una de otra empresa', async () => {
        const priv = await seedConnection(tenantId, { visibility: 'private', name: 'Privada' });
        await expect(account.set(tenantId, priv)).rejects.toThrow(/conexión privada/);
        const noAuth = await seedConnection(tenantId, { token: false, name: 'Sin autorizar' });
        await expect(account.set(tenantId, noAuth)).rejects.toThrow(/no está autorizada/);
        const ajena = await seedConnection(otherTenantId, { name: 'Ajena' });
        await expect(account.set(tenantId, ajena)).rejects.toThrow(/no existe/);
    });

    it('un límite del proveedor falla con su motivo y NO cae al correo de la plataforma', async () => {
        const id = await seedConnection(tenantId);
        await account.set(tenantId, id);
        net.handler = () => ({
            status: 429,
            body: JSON.stringify({ error: { message: 'Daily Limit Exceeded', errors: [{ reason: 'dailyLimitExceeded' }] } }),
        });
        await expect(mail.sendNow({ tenantId, to: 'c@x.test', subject: 's', text: 'x' })).rejects.toThrow(/Google frenó el envío/);
        expect(platformTransport.sent).toHaveLength(0);
        expect(counter.data.size).toBe(0);
    });

    it('la conexión elegida desaparece: falla ruidoso y el estado lo dice', async () => {
        const id = await seedConnection(tenantId);
        await account.set(tenantId, id);
        await withTenant(pg.db, tenantId, (tx) => tx.delete(connections).where(eq(connections.id, id)));
        await expect(mail.sendNow({ tenantId, to: 'c@x.test', subject: 's', text: 'x' })).rejects.toThrow(/ya no existe/);
        expect(platformTransport.sent).toHaveLength(0);
        const st = await account.status(tenantId);
        expect(st.mode).toBe('account');
        expect(st.account!.problem).toMatch(/no están saliendo/);
    });

    it('no se puede borrar ni desconectar la cuenta en uso; guardar un SMTP la reemplaza', async () => {
        const id = await seedConnection(tenantId);
        await account.set(tenantId, id);
        await expect(connectors.remove(tenantId, adminId, 'admin', id, true)).rejects.toThrow(/sale el correo de la empresa/);
        await expect(connectors.disconnectOAuth(tenantId, adminId, 'admin', id)).rejects.toThrow(/sale el correo de la empresa/);

        await smtp.update(tenantId, { host: 'smtp.gmail.com', port: 587, secure: false, user: 'u', pass: 'p', from: 'a@acme.test' });
        expect((await account.status(tenantId)).mode).toBe('smtp');
        // Ya no es la cuenta de envío: ahora sí se puede borrar.
        await connectors.remove(tenantId, adminId, 'admin', id, true);
    });

    it('dejar de usarla vuelve al SMTP guardado o a la plataforma', async () => {
        const id = await seedConnection(tenantId);
        await account.set(tenantId, id);
        await account.clear(tenantId);
        expect((await account.status(tenantId)).mode).toBe('platform');
        expect(await smtp.ownMail(tenantId)).toBe(false);
        await mail.sendNow({ tenantId, to: 'c@x.test', subject: 's', text: 'x' });
        expect(platformTransport.sent).toHaveLength(1);
        expect(net.calls).toHaveLength(0);
    });
});
