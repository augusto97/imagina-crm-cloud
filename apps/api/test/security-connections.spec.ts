import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeCall {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 200, body: '{}' }),
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string }) => {
            const call = { url, method: opts.method, headers: opts.headers, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json', truncated: false };
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
import { AutomationsService, connectionIdsOf, type HookCaptureStore } from '../src/automations/automations.service';
import { encryptSecret } from '../src/common/secret-box';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { automationRuns, automations, connections, fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class MemoryHookStore implements HookCaptureStore {
    private readonly data = new Map<string, string[]>();
    lpush(key: string, value: string): Promise<number> {
        const list = this.data.get(key) ?? [];
        list.unshift(value);
        this.data.set(key, list);
        return Promise.resolve(list.length);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(key: string): Promise<string[]> {
        return Promise.resolve(this.data.get(key) ?? []);
    }
}

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const TOKEN = 'S3CRET99-token-del-proveedor';

/**
 * Auditoría de seguridad — conexiones y probadores de automatizaciones.
 *
 * 1. La credencial de una conexión sólo se envía a SU servidor.
 * 2. Una conexión privada (o el calendario de la agenda) sólo la elige su dueño.
 * 3. Los probadores leen el registro de muestra con el acceso de quien prueba.
 */
describe('Seguridad — conexiones en automatizaciones', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let autos: AutomationsService;
    let connectors: ConnectorsService;
    let tenantId: number;
    let ana: number;
    let beto: number;
    let f: Record<string, Field>;
    const admin = (userId: number): Actor => ({ userId, role: 'admin' });

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
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
        connectors = new ConnectorsService(tenantDb, pg.db, loadEnv({ SECRETS_KEY: KEY }), memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps(KEY));
        const engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), { name: 'nulo', send: () => Promise.resolve() }),
            connectors,
        );
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            new MemoryHookStore(),
            connectors,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            engine,
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'ana@test.local', passwordHash: 'x', name: 'Ana' }).returning();
        const [b] = await pg.db.insert(users).values({ email: 'beto@test.local', passwordHash: 'x', name: 'Beto' }).returning();
        ana = a!.id;
        beto = b!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 200, body: '{}' });
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(connections).where(eq(connections.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await listsService.create(tenantId, { name: 'Deals' });
        f = {};
        const defs: CreateFieldInput[] = [
            { label: 'Cliente', type: 'text', slug: 'cliente' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
        ];
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'deals', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;

    async function conn(over: Partial<typeof connections.$inferInsert> = {}): Promise<number> {
        const [row] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: 'http',
                    name: `Proveedor ${Math.random().toString(36).slice(2, 8)}`,
                    baseUrl: 'https://api.vendor.test',
                    authType: 'bearer',
                    config: {},
                    secrets: { token: encryptSecret(TOKEN, KEY) },
                    visibility: 'workspace',
                    ownerUserId: ana,
                    createdBy: ana,
                    ...over,
                })
                .returning({ id: connections.id }),
        );
        return row!.id;
    }

    const hook = (connectionId: number, url: string) => ({ type: 'call_webhook' as const, config: { connection_id: connectionId, url, method: 'POST' } });

    describe('la credencial sólo va al servidor de la conexión', () => {
        it('probador: URL absoluta a otro servidor → error y ninguna petición', async () => {
            const id = await conn();
            const out = await autos.testWebhook(tenantId, 'deals', { config: { connection_id: id, url: 'https://attacker.test/collect', method: 'GET' } }, admin(ana));
            expect(out.error ?? '').toMatch(/sólo envía su credencial a https:\/\/api\.vendor\.test/);
            expect(out.response).toBeNull();
            expect(net.calls).toHaveLength(0);
            expect(JSON.stringify(out)).not.toContain(TOKEN);
        });

        it('probador: mismo servidor → lleva la credencial, y un eco no la devuelve', async () => {
            const id = await conn();
            net.handler = (call) => ({ status: 200, body: JSON.stringify({ recibido: call.headers }) });
            const out = await autos.testWebhook(tenantId, 'deals', { config: { connection_id: id, url: 'https://api.vendor.test/v1/eco', method: 'GET' } }, admin(ana));
            expect(out.error).toBeNull();
            expect(net.calls).toHaveLength(1);
            expect(net.calls[0]!.headers?.authorization).toBe(`Bearer ${TOKEN}`);
            expect(out.response?.body ?? '').toContain('authorization');
            expect(JSON.stringify(out)).not.toContain(TOKEN);
        });

        it('una conexión con credencial y sin dirección no la envía', async () => {
            const id = await conn({ baseUrl: '' });
            const out = await autos.testWebhook(tenantId, 'deals', { config: { connection_id: id, url: 'https://api.vendor.test/x' } }, admin(ana));
            expect(out.error ?? '').toMatch(/no tiene una dirección/);
            expect(net.calls).toHaveLength(0);
        });

        it('«Probar» paso a paso ejecutando de verdad: tampoco sale a otro servidor', async () => {
            const id = await conn();
            await recordsService.create(tenantId, admin(ana), 'deals', { data: { [key('cliente')]: 'Uno' } });
            const out = await autos.testRun(
                tenantId,
                'deals',
                { trigger_type: 'record_created', trigger_config: {}, actions: [hook(id, 'https://attacker.test/x')], real_steps: ['0'] },
                admin(ana),
            );
            expect(out.steps[0]!.status).toBe('failed');
            expect(out.steps[0]!.message).toMatch(/sólo envía su credencial/);
            expect(net.calls).toHaveLength(0);
        });

        it('una app conectada con credencial no se usa con «Llamar webhook externo»', async () => {
            const id = await conn({
                provider: 'telegram',
                baseUrl: '',
                authType: 'none',
                secrets: { token: encryptSecret(TOKEN, KEY), signing_secret: encryptSecret('firma-de-la-app', KEY) },
            });
            const out = await autos.testWebhook(tenantId, 'deals', { config: { connection_id: id, url: 'https://attacker.test/x' } }, admin(ana));
            expect(out.error ?? '').toMatch(/es una app conectada/);
            expect(net.calls).toHaveLength(0);
        });

        it('«Probar conexión» con la credencial guardada no acepta otra dirección, y cambiarla exige reescribirla', async () => {
            const id = await conn();
            const moved = await connectors.test(tenantId, ana, 'admin', {
                connection_id: id,
                base_url: 'https://attacker.test',
                auth_type: 'none',
                auth_key: '',
                headers: [],
                query_params: [],
                path: '/',
                method: 'GET',
            } as never);
            expect(moved.ok).toBe(false);
            expect(moved.error ?? '').toMatch(/sólo se prueba contra https:\/\/api\.vendor\.test/);
            const absolute = await connectors.test(tenantId, ana, 'admin', {
                connection_id: id,
                base_url: '',
                auth_type: 'none',
                auth_key: '',
                headers: [],
                query_params: [],
                path: 'https://attacker.test/x',
                method: 'GET',
            } as never);
            expect(absolute.ok).toBe(false);
            expect(net.calls).toHaveLength(0);

            await expect(connectors.update(tenantId, ana, 'admin', id, { base_url: 'https://attacker.test' })).rejects.toMatchObject({
                response: { code: 'connection_secret_required' },
            });
            // Misma dirección con otra ruta, o reescribiendo la credencial: sí.
            await connectors.update(tenantId, ana, 'admin', id, { base_url: 'https://api.vendor.test/v2' });
            const ok = await connectors.update(tenantId, ana, 'admin', id, { base_url: 'https://nuevo.vendor.test', token: 'otra-clave-123456' });
            expect(ok.base_url).toBe('https://nuevo.vendor.test');
        });
    });

    describe('una conexión privada o de la agenda sólo la elige su dueño', () => {
        it('probar, guardar y ejecutar de verdad con la conexión privada de otra persona: no', async () => {
            const priv = await conn({ visibility: 'private', ownerUserId: ana });

            const tested = await autos.testWebhook(tenantId, 'deals', { config: { connection_id: priv, url: '/x' } }, admin(beto));
            expect(tested.error ?? '').toMatch(/no existe o no la puedes usar/);
            expect(net.calls).toHaveLength(0);

            const input = { name: 'Con la de Ana', trigger_type: 'record_created' as const, trigger_config: {}, actions: [hook(priv, '/x')] };
            await expect(autos.create(tenantId, 'deals', input, { actorId: beto })).rejects.toMatchObject({ response: { code: 'connection_not_found' } });

            await recordsService.create(tenantId, admin(ana), 'deals', { data: { [key('cliente')]: 'Uno' } });
            const run = await autos.testRun(tenantId, 'deals', { trigger_type: 'record_created', trigger_config: {}, actions: [hook(priv, '/x')], real_steps: ['0'] }, admin(beto));
            expect(run.steps[0]!.status).toBe('failed');
            expect(net.calls).toHaveLength(0);

            // Su dueña sí; y una persona del equipo puede seguir editando OTRA
            // parte de esa automatización (la conexión ya estaba), pero no
            // sumarla a una automatización suya.
            const mine = await autos.create(tenantId, 'deals', input, { actorId: ana });
            const renamed = await autos.update(
                tenantId,
                'deals',
                mine.id,
                { name: 'Renombrada por Beto', actions: [hook(priv, '/otra'), { type: 'update_field', config: { values: { cliente: 'x' } } }] },
                { actorId: beto },
            );
            expect(renamed.name).toBe('Renombrada por Beto');
            const other = await autos.create(tenantId, 'deals', { ...input, name: 'De Beto', actions: [] , is_active: false }, { actorId: beto });
            await expect(
                autos.update(tenantId, 'deals', other.id, { actions: [{ type: 'if_else', config: { condition: [], then_actions: [hook(priv, '/x')], else_actions: [] } }] }, { actorId: beto }),
            ).rejects.toMatchObject({ response: { code: 'connection_not_found' } });
        });

        it('el calendario personal de la agenda no se usa en automatizaciones (ni su dueña)', async () => {
            const agenda = await conn({
                provider: 'google_calendar',
                baseUrl: '',
                authType: 'oauth2',
                visibility: 'private',
                ownerUserId: ana,
                config: { purpose: 'agenda' },
                secrets: { access_token: encryptSecret('ya29.token-de-ana', KEY) },
            });
            const action = { type: 'connector_action' as const, config: { connection_id: agenda, action_key: 'create_event', values: {} } };
            for (const who of [ana, beto]) {
                await expect(
                    autos.create(tenantId, 'deals', { name: 'Agenda', trigger_type: 'record_created', trigger_config: {}, actions: [action] }, { actorId: who }),
                ).rejects.toMatchObject({ response: { code: 'connection_not_found' } });
                const tested = await autos.testWebhook(tenantId, 'deals', { config: action.config }, admin(who));
                expect(tested.error ?? '').toMatch(/no existe o no la puedes usar/);
            }
            // Y aunque quedara guardada de antes, el motor no la resuelve.
            await expect(connectors.resolveAction(tenantId, agenda, 'create_event')).rejects.toThrow(/calendario personal/);
            await expect(connectors.resolveParts(tenantId, agenda)).rejects.toThrow(/calendario personal/);
            expect(net.calls).toHaveLength(0);
        });

        it('connectionIdsOf recorre ramas, bucles y el disparador', () => {
            const ids = connectionIdsOf(
                [
                    hook(3, '/a'),
                    { type: 'if_else', config: { then_actions: [hook(4, '/b')], else_actions: [{ type: 'for_each_linked', config: { actions: [hook(5, '/c')] } }] } },
                ],
                { connection_id: '6' },
            );
            expect(ids.sort()).toEqual([3, 4, 5, 6]);
        });
    });

    describe('los probadores leen el registro como quien prueba', () => {
        const agent = (userId: number): Actor => ({ userId, role: 'agent' });

        beforeEach(async () => {
            const list = await listsService.get(tenantId, 'deals');
            await listsService.update(tenantId, 'deals', {
                settings: { ...list.settings, permissions: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['monto'] } } } },
            });
        });

        const body = { config: { url: 'https://api.example.test/x', method: 'POST', content_type: 'json', body_params: [{ key: 'cliente', value: '{{cliente}}' }, { key: 'monto', value: '{{monto}}' }] } };

        it('webhook y correo: ni un registro fuera de su alcance ni un campo oculto', async () => {
            const ajeno = await recordsService.create(tenantId, admin(ana), 'deals', { data: { [key('cliente')]: 'Secreto SA', [key('monto')]: 987654 } });

            // Sin registros a su alcance, no hay muestra (ni la elegida por id).
            for (const input of [body, { ...body, record_id: ajeno.id }]) {
                const out = await autos.testWebhook(tenantId, 'deals', input, agent(beto));
                expect(out.sample_record_id).toBeNull();
                expect(JSON.stringify(out)).not.toContain('Secreto SA');
                expect(JSON.stringify(out)).not.toContain('987654');
            }
            const mail = await autos.testEmail(
                tenantId,
                'deals',
                { config: { to: 'x@test.local', subject: '{{cliente}}', body: 'Monto {{monto}}' }, record_id: ajeno.id, send: false },
                { id: beto, email: 'beto@test.local' },
                agent(beto),
            );
            expect(JSON.stringify(mail)).not.toContain('Secreto SA');
            expect(JSON.stringify(mail)).not.toContain('987654');

            // Con uno suyo: lo ve, sin el campo oculto.
            const propio = await recordsService.create(tenantId, agent(beto), 'deals', { data: { [key('cliente')]: 'Mi cliente' } });
            await withTenant(pg.db, tenantId, (tx) =>
                tx.update(records).set({ data: { [key('cliente')]: 'Mi cliente', [key('monto')]: 4321 } }).where(eq(records.id, propio.id)),
            );
            const mine = await autos.testWebhook(tenantId, 'deals', body, agent(beto));
            expect(mine.sample_record_id).toBe(propio.id);
            expect(mine.request.body).toContain('Mi cliente');
            expect(mine.request.body).not.toContain('4321');

            // Un admin sigue viendo todo (y sin actor —llamadas internas— igual que antes).
            const full = await autos.testWebhook(tenantId, 'deals', { ...body, record_id: ajeno.id }, admin(ana));
            expect(full.request.body).toContain('Secreto SA');
            expect(full.request.body).toContain('987654');
        });

        it('«Probar» paso a paso: la muestra es de su alcance y sin campos ocultos', async () => {
            const ajeno = await recordsService.create(tenantId, admin(ana), 'deals', { data: { [key('cliente')]: 'Secreto SA', [key('monto')]: 987654 } });
            const input = { trigger_type: 'record_created' as const, trigger_config: {}, actions: [{ type: 'call_webhook' as const, config: body.config }], real_steps: [] as string[] };
            const none = await autos.testRun(tenantId, 'deals', { ...input, record_id: ajeno.id }, agent(beto));
            expect(none.record).toBeNull();
            expect(JSON.stringify(none)).not.toContain('Secreto SA');

            const propio = await recordsService.create(tenantId, agent(beto), 'deals', { data: { [key('cliente')]: 'Mi cliente' } });
            await withTenant(pg.db, tenantId, (tx) =>
                tx.update(records).set({ data: { [key('cliente')]: 'Mi cliente', [key('monto')]: 4321 } }).where(eq(records.id, propio.id)),
            );
            const mine = await autos.testRun(tenantId, 'deals', input, agent(beto));
            expect(mine.record?.id).toBe(propio.id);
            expect(JSON.stringify(mine)).toContain('Mi cliente');
            expect(JSON.stringify(mine)).not.toContain('4321');

            const full = await autos.testRun(tenantId, 'deals', { ...input, record_id: ajeno.id }, admin(ana));
            expect(JSON.stringify(full)).toContain('987654');
        });

        it('historial y datos del webhook: sólo quien ve la lista entera', async () => {
            const auto = await autos.create(tenantId, 'deals', { name: 'Hook', trigger_type: 'incoming_webhook', trigger_config: {}, actions: [], is_active: false }, { actorId: ana });
            await expect(autos.runsById(tenantId, auto.id, {}, agent(beto))).rejects.toMatchObject({ response: { code: 'automation_list_forbidden' } });
            await expect(autos.hookCaptures(tenantId, auto.id, undefined, agent(beto))).rejects.toMatchObject({ response: { code: 'automation_list_forbidden' } });
            expect((await autos.runsById(tenantId, auto.id, {}, admin(ana))).data).toEqual([]);
            // Un rol que ve todo y sin campos ocultos, sí.
            expect((await autos.runsById(tenantId, auto.id, {}, { userId: beto, role: 'manager' })).data).toEqual([]);
        });
    });

    describe('migración: dirección de las conexiones que no la tenían', () => {
        it('toma el servidor de sus acciones cuando todas llaman al mismo', async () => {
            const one = await conn({ baseUrl: '' });
            const two = await conn({ baseUrl: '' });
            const tagged = await conn({ baseUrl: '' });
            const kept = await conn({ baseUrl: 'https://ya.tenia.test' });
            const named = await conn({ baseUrl: '', config: { actions: [{ key: 'enviar', label: 'Enviar', path: 'https://Named.Vendor.test:8443/send' }] } });
            const list = await listsService.get(tenantId, 'deals');
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(automations).values([
                    {
                        tenantId,
                        listId: list.id,
                        name: 'A',
                        triggerType: 'record_created',
                        triggerConfig: {},
                        actions: [
                            hook(one, 'https://API.vendor.test/v1/send?x=1'),
                            { type: 'if_else', config: { condition: [], then_actions: [hook(one, 'https://api.vendor.test/otra')], else_actions: [hook(two, 'https://uno.test/a')] } },
                            { type: 'for_each_linked', config: { actions: [hook(two, 'https://dos.test/b')] } },
                            hook(tagged, '{{url}}'),
                            hook(tagged, 'https://tres.test/c'),
                            hook(kept, 'https://otro.test/d'),
                        ] as never,
                    },
                ]),
            );
            const file = path.join(__dirname, '..', 'src', 'db', 'migrations', '0117_connection_base_url_backfill.sql');
            await pg.db.execute(sql.raw(readFileSync(file, 'utf8')));
            const rows = await pg.db.select({ id: connections.id, baseUrl: connections.baseUrl }).from(connections).where(eq(connections.tenantId, tenantId));
            const base = new Map(rows.map((r) => [r.id, r.baseUrl]));
            expect(base.get(one)).toBe('https://api.vendor.test');
            expect(base.get(two)).toBe(''); // dos servidores: lo decide un admin
            expect(base.get(tagged)).toBe(''); // una URL que sale de una variable
            expect(base.get(kept)).toBe('https://ya.tenia.test');
            expect(base.get(named)).toBe('https://named.vendor.test:8443');

            // Y con la dirección puesta, la automatización de siempre sigue saliendo con su credencial.
            const out = await autos.testWebhook(tenantId, 'deals', { config: { connection_id: one, url: 'https://API.vendor.test/v1/send?x=1' } }, admin(ana));
            expect(out.error).toBeNull();
            expect(net.calls.at(-1)?.headers?.authorization).toBe(`Bearer ${TOKEN}`);
        });
    });
});
