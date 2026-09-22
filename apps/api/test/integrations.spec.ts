import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.203 — la galería de apps de punta a punta, con Postgres real.
 *
 * Las APIs externas (Slack, Microsoft, Telegram, WAS) se simulan en el borde de
 * red —`safeWebhookFetch`— así el test ejercita TODO lo nuestro: la app que el
 * operador registra en Plataforma, el viaje de autorización con PKCE, el canje,
 * la cuenta que queda a la vista, los tokens cifrados, la renovación con la app
 * de la plataforma, la clave que se rechaza sin guardarse, el motor y el
 * probador leyendo el error que Slack devuelve con un 200.
 */
interface FakeCall {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 404, body: '' }),
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

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { automationRuns, automations, connections, fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { encryptSecret } from '../src/common/secret-box';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

class NullMail implements MailTransport {
    readonly name = 'null';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}
class NoHooks implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(0);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

describe('Integraciones de la galería (v0.1.203)', () => {
    let pg: TestPg;
    let store: ReturnType<typeof memoryOAuthStore>;
    let apps: IntegrationAppsService;
    let svc: ConnectorsService;
    let automationsService: AutomationsService;
    let recordsService: RecordsService;
    let fieldsService: FieldsService;
    let listsService: ListsService;
    let engine: AutomationEngine;
    let tenantId: number;
    let adminId: number;
    const admin = (): Actor => ({ userId: adminId, role: 'admin' });

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        store = memoryOAuthStore();
        apps = new IntegrationAppsService(store, env);
        svc = new ConnectorsService(tenantDb, pg.db, env, store, new AuditService(tenantDb), apps);

        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        automationsService = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            new NoHooks(),
            svc,
        );
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NullMail()),
            svc,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db
            .insert(users)
            .values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' })
            .returning();
        adminId = u!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 404, body: '' });
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
            await tx.delete(connections).where(eq(connections.tenantId, tenantId));
        });
    });

    /** Arranca la autorización y simula la vuelta del proveedor. */
    async function authorizeAndReturn(
        key: 'slack' | 'outlook',
        connectionId?: number,
    ): Promise<{ url: URL; result: { ok: boolean; error: string | null } }> {
        const { authorize_url } = await svc.startIntegrationOAuth(tenantId, adminId, 'admin', key, {
            visibility: 'workspace',
            connection_id: connectionId ?? null,
        });
        const url = new URL(authorize_url);
        const result = await svc.completeOAuth(adminId, 'codigo-del-proveedor', url.searchParams.get('state')!);
        return { url, result };
    }

    it('sin la app registrada por el operador, conectar dice qué falta (no un 500)', async () => {
        const overview = await svc.integrationsOverview(tenantId, adminId, 'admin');
        expect(overview.providers.slack).toEqual({ configured: false });
        expect(overview.can_connect_workspace).toBe(true);
        await expect(
            svc.startIntegrationOAuth(tenantId, adminId, 'admin', 'slack', { visibility: 'workspace' }),
        ).rejects.toThrow(/Plataforma → Integraciones/);
    });

    it('el operador registra la app: el secreto queda cifrado y nunca vuelve', async () => {
        const view = await apps.update(
            'slack',
            { client_id: 'slack-client-1', client_secret: 'slack-secreto-9876' },
            new Map(),
        );
        expect(view).toMatchObject({ configured: true, client_id: 'slack-client-1', secret_hint: '••••9876' });
        expect(JSON.stringify(view)).not.toContain('slack-secreto-9876');
        const raw = await store.get('platform:integrations');
        expect(raw).not.toContain('slack-secreto-9876');
        // Guardar sin secreto conserva el anterior (mismo contrato que el SMTP).
        const again = await apps.update('slack', { client_id: 'slack-client-1', client_secret: '' }, new Map());
        expect(again.secret_hint).toBe('••••9876');
        expect((await svc.integrationsOverview(tenantId, adminId, 'admin')).providers.slack).toEqual({
            configured: true,
        });
    });

    it('Slack: autorizar → la conexión nace AL VOLVER, con la cuenta a la vista y el token cifrado', async () => {
        await apps.update('slack', { client_id: 'slack-client-1', client_secret: 'slack-secreto-9876' }, new Map());
        net.handler = (call) => {
            if (call.url === 'https://slack.com/api/oauth.v2.access') {
                return { status: 200, body: JSON.stringify({ ok: true, access_token: 'xoxb-bot-token-1', scope: 'chat:write' }) };
            }
            if (call.url === 'https://slack.com/api/auth.test') {
                return { status: 200, body: JSON.stringify({ ok: true, team: 'Acme' }) };
            }
            return { status: 404, body: '' };
        };

        const { authorize_url } = await svc.startIntegrationOAuth(tenantId, adminId, 'admin', 'slack', {
            visibility: 'workspace',
        });
        const url = new URL(authorize_url);
        expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
        expect(url.searchParams.get('client_id')).toBe('slack-client-1');
        expect(url.searchParams.get('scope')).toBe('chat:write,chat:write.public');
        expect(url.searchParams.get('redirect_uri')).toBe(
            'https://app.imagina.test/api/v1/connections/oauth/callback',
        );
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        // Cancelar en el proveedor no deja nada a medias.
        expect(await svc.list(tenantId, adminId, 'admin')).toHaveLength(0);

        const result = await svc.completeOAuth(adminId, 'codigo', url.searchParams.get('state')!);
        expect(result).toEqual({ ok: true, error: null });
        const exchange = net.calls.find((c) => c.url.includes('oauth.v2.access'))!;
        const body = new URLSearchParams(exchange.body!);
        expect(body.get('client_secret')).toBe('slack-secreto-9876');
        expect(body.get('code_verifier')).toBeTruthy();

        const [conn] = await svc.list(tenantId, adminId, 'admin');
        expect(conn).toMatchObject({
            provider: 'slack',
            integration_key: 'slack',
            account_label: 'Acme',
            name: 'Slack · Acme',
            auth_type: 'oauth2',
        });
        expect(conn!.actions.map((a) => a.key)).toEqual(['send_message']);
        expect(conn!.oauth_status?.connected).toBe(true);
        const [row] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(connections).where(eq(connections.id, conn!.id)),
        );
        expect(JSON.stringify(row!.secrets)).not.toContain('xoxb-bot-token-1');

        // El motor recibe el token para ejecutar.
        const resolved = await svc.resolveAction(tenantId, conn!.id, 'send_message');
        expect(resolved!.integration?.creds.accessToken).toBe('xoxb-bot-token-1');

        // Reconectar la MISMA conexión no crea otra.
        await authorizeAndReturn('slack', conn!.id);
        expect(await svc.list(tenantId, adminId, 'admin')).toHaveLength(1);
    });

    it('Outlook: renueva con la app de la PLATAFORMA y repite los scopes (Microsoft los exige)', async () => {
        await apps.update('microsoft', { client_id: 'ms-client', client_secret: 'ms-secreto-5555' }, new Map());
        const [created] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: 'outlook',
                    name: 'Outlook · ana@acme.test',
                    authType: 'oauth2',
                    config: { account_label: 'ana@acme.test', oauth_state: { expiresAt: Date.now() - 1000, scope: '', error: null } },
                    secrets: {
                        access_token: encryptSecret('viejo', KEY),
                        refresh_token: encryptSecret('refresh-1', KEY),
                    },
                    visibility: 'workspace',
                    ownerUserId: adminId,
                })
                .returning(),
        );
        net.handler = (call) =>
            call.url.includes('login.microsoftonline.com')
                ? { status: 200, body: JSON.stringify({ access_token: 'nuevo-ms', expires_in: 3600, refresh_token: 'refresh-2' }) }
                : { status: 404, body: '' };

        const resolved = await svc.resolveAction(tenantId, created!.id, 'send_email');
        expect(resolved!.integration?.creds.accessToken).toBe('nuevo-ms');
        const refresh = new URLSearchParams(net.calls[0]!.body!);
        expect(refresh.get('grant_type')).toBe('refresh_token');
        expect(refresh.get('client_id')).toBe('ms-client');
        expect(refresh.get('client_secret')).toBe('ms-secreto-5555');
        expect(refresh.get('scope')).toContain('Mail.Send');
    });

    it('Telegram por clave: se verifica ANTES de guardar; una clave rechazada no se guarda', async () => {
        net.handler = (call) =>
            call.url === 'https://api.telegram.org/bot111:malo/getMe'
                ? { status: 401, body: '{"ok":false,"description":"Unauthorized"}' }
                : call.url === 'https://api.telegram.org/bot222:bueno/getMe'
                  ? { status: 200, body: '{"ok":true,"result":{"username":"acme_bot"}}' }
                  : { status: 404, body: '' };

        await expect(
            svc.connectIntegrationKey(tenantId, adminId, 'admin', 'telegram', {
                fields: { token: '111:malo' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow(/no reconoce ese token/);
        expect(await svc.list(tenantId, adminId, 'admin')).toHaveLength(0);

        const { connection } = await svc.connectIntegrationKey(tenantId, adminId, 'admin', 'telegram', {
            fields: { token: '222:bueno' },
            visibility: 'workspace',
        });
        expect(connection).toMatchObject({
            name: 'Telegram · @acme_bot',
            integration_key: 'telegram',
            account_label: '@acme_bot',
            secret_state: 'ok',
            secret_hint: '••••ueno',
        });

        // Actualizar sin volver a pegar la clave conserva la guardada.
        net.calls.length = 0;
        await svc.connectIntegrationKey(tenantId, adminId, 'admin', 'telegram', {
            fields: {},
            visibility: 'workspace',
            connection_id: connection.id,
        });
        expect(net.calls[0]!.url).toBe('https://api.telegram.org/bot222:bueno/getMe');
        expect(await svc.list(tenantId, adminId, 'admin')).toHaveLength(1);
    });

    it('WhatsApp: verificar lista las cuentas de la clave para elegir', async () => {
        net.handler = (call) =>
            call.url.startsWith('https://was.imagina.cloud/api/get/wa.accounts')
                ? {
                      status: 200,
                      body: JSON.stringify({ status: 200, data: [{ unique: 'acc-1', phone: '+573001112233' }] }),
                  }
                : { status: 404, body: '' };
        const res = await svc.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp', {
            fields: { secret: 'was-secreto', account: '' },
        });
        expect(res.ok).toBe(true);
        expect(res.options.account).toEqual([{ value: 'acc-1', label: '+573001112233' }]);
        // Falta la cuenta: no se puede guardar a medias.
        await expect(
            svc.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp', {
                fields: { secret: 'was-secreto' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow(/Cuenta de WhatsApp/);
    });

    it('WhatsApp: una clave de ENVÍO sin permiso de listar se guarda, y el mensaje de prueba la confirma (v0.1.204)', async () => {
        // El caso real: la clave de WAS manda perfecto desde un webhook, pero
        // WAS contesta 403 al listar cuentas porque la clave no tiene ese
        // permiso. Antes eso se leía como «clave inválida» y no dejaba guardar.
        net.handler = (call) => {
            if (call.url.startsWith('https://was.imagina.cloud/api/get/wa.accounts')) {
                return { status: 403, body: '{"status":403,"message":"API key has no permission"}' };
            }
            if (call.url === 'https://was.imagina.cloud/api/send/whatsapp') {
                const body = new URLSearchParams(call.body ?? '');
                return body.get('recipient') === '+570000000000'
                    ? { status: 200, body: '{"status":400,"message":"Invalid recipient!"}' }
                    : { status: 200, body: '{"status":200,"message":"WhatsApp message has been queued for sending!"}' };
            }
            return { status: 404, body: '' };
        };
        const fieldsIn = { secret: 'was-envio-1234', account: '1765987873c81e' };

        const listing = await svc.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp', { fields: fieldsIn });
        expect(listing.ok).toBe(true);
        expect(listing.warning).toContain('API key has no permission');

        net.calls.length = 0;
        const sent = await svc.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp', {
            fields: fieldsIn,
            test_to: '+57 300 111 2233',
        });
        expect(sent).toMatchObject({ ok: true, test_sent: true, warning: null, error: null });
        const send = net.calls.find((c) => c.url.endsWith('/api/send/whatsapp'))!;
        expect(Object.fromEntries(new URLSearchParams(send.body!))).toMatchObject({
            secret: 'was-envio-1234',
            account: '1765987873c81e',
            recipient: '+573001112233',
        });

        // Un envío que WAS rechaza (200 con error adentro) se dice, con su motivo.
        const bad = await svc.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp', {
            fields: fieldsIn,
            test_to: '+570000000000',
        });
        expect(bad.ok).toBe(false);
        expect(bad.test_sent).toBe(false);
        expect(bad.error).toMatch(/Invalid recipient/);

        // Sin cuenta no se manda nada.
        net.calls.length = 0;
        const noAccount = await svc.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp', {
            fields: { secret: 'was-envio-1234', account: '' },
            test_to: '+573001112233',
        });
        expect(noAccount.error).toMatch(/Cuenta de WhatsApp/);
        expect(net.calls.some((c) => c.url.endsWith('/api/send/whatsapp'))).toBe(false);

        // Y guardar ya no se bloquea por el listado.
        const { connection } = await svc.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp', {
            fields: fieldsIn,
            visibility: 'workspace',
        });
        expect(connection).toMatchObject({ integration_key: 'whatsapp', secret_state: 'ok', secret_hint: '••••1234' });
    });

    it('motor y probador: el 200 con error de Slack es un FALLO con el motivo, y borrar avisa del uso', async () => {
        await apps.update('slack', { client_id: 'slack-client-1', client_secret: 'slack-secreto-9876' }, new Map());
        net.handler = (call) => {
            if (call.url.includes('oauth.v2.access')) {
                return { status: 200, body: JSON.stringify({ ok: true, access_token: 'xoxb-bot-token-1' }) };
            }
            if (call.url.includes('auth.test')) return { status: 200, body: '{"ok":true,"team":"Acme"}' };
            if (call.url.includes('chat.postMessage')) {
                return { status: 200, body: '{"ok":false,"error":"not_in_channel"}' };
            }
            return { status: 404, body: '' };
        };
        await authorizeAndReturn('slack');
        const [conn] = await svc.list(tenantId, adminId, 'admin');

        const list = await listsService.create(tenantId, { name: 'Pedidos' });
        const defs: CreateFieldInput[] = [{ label: 'Cliente', type: 'text', slug: 'cliente' }];
        const f: Record<string, Field> = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'pedidos', d);
        const auto = await automationsService.create(tenantId, 'pedidos', {
            name: 'Avisar en Slack',
            trigger_type: 'record_created',
            actions: [
                {
                    type: 'connector_action',
                    config: {
                        connection_id: conn!.id,
                        action_key: 'send_message',
                        values: { channel: '#ventas', text: 'Nuevo pedido de {{cliente}}' },
                    },
                },
            ],
        });
        const rec = await recordsService.create(tenantId, admin(), 'pedidos', {
            data: { [`f${f.cliente!.id}`]: 'Ana' },
        });

        // Probador: la petición exacta, el token tapado, y el motivo legible.
        const test = await automationsService.testWebhook(tenantId, 'pedidos', {
            config: auto.actions[0]!.config as Record<string, unknown>,
        });
        expect(JSON.parse(test.request.body!)).toEqual({ channel: '#ventas', text: 'Nuevo pedido de Ana' });
        expect(test.request.headers.authorization).not.toContain('xoxb-bot-token-1');
        expect(test.error).toMatch(/invitala/);

        // Motor: el run queda FALLIDO con el motivo (antes un 200 era «éxito»).
        await engine.process({
            tenantId,
            listId: list.id,
            recordId: rec.id,
            trigger: 'record_created',
            after: { [`f${f.cliente!.id}`]: 'Ana' },
        });
        const runs = await automationsService.runsById(tenantId, auto.id, {});
        expect(runs.data[0]).toMatchObject({ status: 'failed' });
        expect(runs.data[0]!.error ?? '').toMatch(/invitala/);

        // La acción con nombre CUENTA como uso: borrar la conexión avisa.
        const usage = await svc.usage(tenantId, conn!.id);
        expect(usage).toHaveLength(1);
        await expect(svc.remove(tenantId, adminId, 'admin', conn!.id, false)).rejects.toBeInstanceOf(
            ConflictException,
        );
        const [still] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .select({ id: connections.id })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, conn!.id))),
        );
        expect(still).toBeDefined();
    });
});
