import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateFieldInput, Field, Role } from '@imagina-base/shared';
import { webhookRetryDelay, webhookShouldRetry } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { customRoles, lists as listsTable, memberships, tenants, users, webhookDeliveries, webhookSubscriptions } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EventWebhookHub } from '../src/event-webhooks/event-hub';
import { kickDrain } from '../src/event-webhooks/event-webhooks.queue';
import { EventWebhooksService, signWebhookBody, type WebhookRequester } from '../src/event-webhooks/event-webhooks.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.442 — Webhooks de eventos: el alta, el cambio y el borrado de un
 * registro llegan firmados a la dirección registrada, con el acceso de quien
 * creó la suscripción; se reintentan los errores pasajeros, un 410 la apaga y
 * las fallas seguidas la pausan con un Problema.
 */
describe('Webhooks de eventos: reglas puras', () => {
    it('firma t=…,v1=HMAC(secreto, "t.cuerpo")', () => {
        const sig = signWebhookBody('whsec_x', 1700000000, '{"a":1}');
        const expected = createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex');
        expect(sig).toBe(`t=1700000000,v1=${expected}`);
    });

    it('qué se reintenta y cuánto se espera', () => {
        expect(webhookShouldRetry(null)).toBe(true);
        expect(webhookShouldRetry(500)).toBe(true);
        expect(webhookShouldRetry(503)).toBe(true);
        expect(webhookShouldRetry(429)).toBe(true);
        expect(webhookShouldRetry(408)).toBe(true);
        expect(webhookShouldRetry(400)).toBe(false);
        expect(webhookShouldRetry(404)).toBe(false);
        expect(webhookRetryDelay(1)).toBe(60);
        expect(webhookRetryDelay(6)).toBe(43_200);
        expect(webhookRetryDelay(7)).toBeNull();
    });

    it('un evento que llega mientras se manda otro no espera al reloj', async () => {
        // BullMQ ignora un `add` con el id de un trabajo que está corriendo:
        // con el primero activo, el despertar usa el segundo id.
        const added: string[] = [];
        let state = 'unknown';
        const queue = {
            getJobState: async () => state,
            add: async (_n: string, _d: unknown, o: { jobId: string }) => {
                added.push(o.jobId);
                return {} as never;
            },
        };
        expect(await kickDrain(queue as never)).toBe('event-webhooks-drain');
        state = 'active';
        expect(await kickDrain(queue as never)).toBe('event-webhooks-drain-next');
        state = 'waiting';
        expect(await kickDrain(queue as never)).toBe('event-webhooks-drain');
        expect(added).toEqual(['event-webhooks-drain', 'event-webhooks-drain-next', 'event-webhooks-drain']);
    });
});

interface Hit {
    path: string;
    headers: IncomingHttpHeaders;
    body: string;
}

describe('Webhooks de eventos (Postgres + Redis + receptor HTTP)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let server: Server;
    let base: string;
    const hits: Hit[] = [];
    let replies: number[] = [];
    let webhooks: EventWebhooksService;
    let recs: RecordsService;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let agentId: number;
    let listId: number;
    let f: Record<string, Field>;
    const reports: IncidentReport[] = [];
    const resolved: string[] = [];

    const admin = (): WebhookRequester => ({ tenantId, userId: adminId, role: 'admin', capabilities: [], via: 'app' });
    const agent = (caps: string[] = ['view_records', 'use_api']): WebhookRequester => ({
        tenantId,
        userId: agentId,
        role: 'agent' as Role,
        capabilities: caps as WebhookRequester['capabilities'],
        via: 'api',
    });
    const actorAdmin = (): Actor => ({ userId: adminId, role: 'admin' });
    const actorAgent = (): Actor => ({ userId: agentId, role: 'agent' });
    const k = (slug: string): string => `f${f[slug]!.id}`;

    const deliveriesOf = (subId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, subId)).orderBy(webhookDeliveries.id));

    async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (await fn()) return;
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('timeout esperando la condición');
    }

    beforeAll(async () => {
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                hits.push({ path: req.url ?? '', headers: req.headers, body });
                const status = replies.shift() ?? 200;
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ received: true }));
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsService = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const hub = new EventWebhookHub();
        const dispatcher = new AutomationDispatcher(undefined, undefined, undefined, hub);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            hub,
        );
        const incidents = new IncidentHub();
        incidents.subscribe({
            report: (r) => {
                reports.push(r);
            },
            resolve: (_t, key) => {
                resolved.push(key);
            },
            resolvePrefix: () => undefined,
        });
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        webhooks = new EventWebhooksService(env, pg.db, tenantDb, hub, lists, fieldsService, recs, new AuditService(tenantDb), incidents, redis as never);
        webhooks.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-wh', name: 'Acme', plan: 'pro' }).returning();
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-wh', name: 'Otra', plan: 'pro' }).returning();
        tenantId = t!.id;
        otherTenantId = o!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@wh.test', name: 'Ana Admin', passwordHash: 'x' }).returning();
        const [g] = await pg.db.insert(users).values({ email: 'agente@wh.test', name: 'Gabo Agente', passwordHash: 'x' }).returning();
        adminId = a!.id;
        agentId = g!.id;
        const [role] = await pg.db
            .insert(customRoles)
            .values({ tenantId, name: 'Integraciones', baseRole: 'agent', capabilities: ['view_records', 'create_records', 'edit_own_records', 'use_api'] })
            .returning();
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: agentId, role: 'agent', customRoleId: role!.id },
        ]);
        listId = (await lists.create(tenantId, { name: 'Clientes', slug: 'clientes' })).id;
        f = {};
        for (const d of [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Costo', type: 'number', slug: 'costo' },
        ] as CreateFieldInput[]) {
            f[d.slug!] = await fieldsService.create(tenantId, 'clientes', d);
        }
        // El agente sólo ve lo suyo y nunca el costo.
        await pg.db
            .update(listsTable)
            .set({ settings: sql`${listsTable.settings} || ${JSON.stringify({ permissions: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['costo'] } } } })}::jsonb` })
            .where(eq(listsTable.id, listId));
    });

    afterAll(async () => {
        delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        redis?.disconnect();
        await new Promise<void>((r) => server.close(() => r()));
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(() => {
        hits.length = 0;
        replies = [];
    });

    function verify(hit: Hit, secret: string): Record<string, unknown> {
        const sig = String(hit.headers['x-webhook-signature']);
        const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
        expect(m, sig).not.toBeNull();
        const expected = createHmac('sha256', secret).update(`${m![1]}.${hit.body}`).digest('hex');
        expect(m![2]).toBe(expected);
        expect(Math.abs(Date.now() / 1000 - Number(m![1]))).toBeLessThan(60);
        return JSON.parse(hit.body) as Record<string, unknown>;
    }

    it('alta, cambio y borrado llegan firmados con el registro, los valores por slug y qué cambió', async () => {
        const sub = await webhooks.create(admin(), { url: `${base}/n8n/abc`, events: ['record.created', 'record.updated', 'record.deleted'] });
        expect(sub.secret).toMatch(/^whsec_/);
        expect(sub.secret_hint).toBe(sub.secret.slice(-4));
        expect(sub.name).toBe('n8n · ' + new URL(base).host);
        // El secreto se guarda cifrado.
        const [raw] = await pg.db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, sub.id));
        expect(raw!.secretEnc).not.toContain(sub.secret);

        const rec = await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Acme', [k('costo')]: 1000 } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 1);
        expect(await webhooks.drain()).toBe(1);
        expect(hits).toHaveLength(1);
        const created = verify(hits[0]!, sub.secret);
        expect(hits[0]!.headers['x-webhook-event']).toBe('record.created');
        expect(hits[0]!.headers['x-webhook-id']).toBe(created.id);
        expect(created).toMatchObject({
            event: 'record.created',
            list: { id: listId, slug: 'clientes', name: 'Clientes' },
            tenant: { id: tenantId, slug: 'acme-wh' },
            values: { nombre: 'Acme', costo: 1000 },
        });
        expect((created.record as { id: number }).id).toBe(rec.id);
        expect((created.fields as Record<string, { slug: string }>)[k('nombre')]!.slug).toBe('nombre');

        await recs.update(tenantId, actorAdmin(), 'clientes', rec.id, { data: { [k('nombre')]: 'Acme S.A.S.' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 2);
        await webhooks.drain();
        const updated = verify(hits[1]!, sub.secret);
        expect(updated.event).toBe('record.updated');
        expect(updated.changes).toEqual([{ field: k('nombre'), slug: 'nombre', label: 'Nombre', before: 'Acme', after: 'Acme S.A.S.' }]);

        await recs.remove(tenantId, actorAdmin(), 'clientes', rec.id);
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 3);
        await webhooks.drain();
        const deleted = verify(hits[2]!, sub.secret);
        expect(deleted).toMatchObject({ event: 'record.deleted', record: { id: rec.id, list_id: listId, deleted: true } });

        const log = await webhooks.deliveries(admin(), sub.id);
        expect(log.map((d) => d.status)).toEqual(['success', 'success', 'success']);
        expect(log.every((d) => d.response_status === 200 && d.attempts === 1)).toBe(true);
        // Ya entregado: el contenido queda para volver a enviarlo, el contexto no.
        const rows = await deliveriesOf(sub.id);
        expect(rows.every((r) => r.payload !== null && Object.keys(r.context ?? {}).length === 0)).toBe(true);
        await webhooks.remove(admin(), sub.id);
    });

    it('con el acceso de quien la creó: no llega lo que no alcanza ni los campos ocultos', async () => {
        // Un agente sin «Usar la API» no crea webhooks.
        await expect(webhooks.create(agent(['view_records']), { url: `${base}/x`, events: ['record.created'] })).rejects.toMatchObject({
            response: { code: 'webhooks_forbidden' },
        });
        const sub = await webhooks.create(agent(), { url: `${base}/agente`, events: ['record.created'] });
        expect(sub.source).toBe('api');
        await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'De Ana', [k('costo')]: 5 } });
        const mine = await recs.create(tenantId, actorAgent(), 'clientes', { data: { [k('nombre')]: 'Mío' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 2);
        await webhooks.drain();
        const rows = await deliveriesOf(sub.id);
        expect(rows.map((r) => r.status)).toEqual(['skipped', 'success']);
        expect(rows[0]!.error).toContain('no existe o quien creó la suscripción no lo alcanza');
        expect(hits).toHaveLength(1);
        const body = verify(hits[0]!, sub.secret);
        expect((body.record as { id: number }).id).toBe(mine.id);
        expect(body.values).toEqual({ nombre: 'Mío' });
        expect(Object.keys(body.fields as object)).toEqual([k('nombre')]);
        expect(JSON.stringify((body.record as { data: unknown }).data)).not.toContain(k('costo'));
        // El agente sólo ve sus webhooks; el administrador, todos.
        expect((await webhooks.list(agent())).map((s) => s.id)).toEqual([sub.id]);
        expect((await webhooks.list(admin())).map((s) => s.id)).toContain(sub.id);
        await webhooks.remove(agent(), sub.id);
    });

    it('reintenta lo pasajero; un 410 la apaga y las fallas seguidas la pausan con un Problema', async () => {
        const sub = await webhooks.create(admin(), { url: `${base}/reintentos`, events: ['record.created'] });
        replies = [500];
        await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Reintento' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 1);
        await webhooks.drain();
        let [d] = await deliveriesOf(sub.id);
        expect(d).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 500 });
        expect(d!.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(50_000);
        // Todavía no venció: el tic no lo toma.
        expect(await webhooks.drain()).toBe(0);
        await pg.db.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(webhookDeliveries.id, d!.id));
        await webhooks.drain();
        [d] = await deliveriesOf(sub.id);
        expect(d).toMatchObject({ status: 'success', attempts: 2, responseStatus: 200 });
        expect(hits.map((h) => h.headers['x-webhook-attempt'])).toEqual(['1', '2']);
        // Mismo aviso en los dos intentos.
        expect(hits[0]!.headers['x-webhook-id']).toBe(hits[1]!.headers['x-webhook-id']);
        expect(JSON.parse(hits[0]!.body)).toEqual(JSON.parse(hits[1]!.body));

        // Un 400 no se reintenta y abre un Problema; una entrega buena lo cierra.
        replies = [400];
        await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Rechazado' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 2);
        await webhooks.drain();
        expect((await deliveriesOf(sub.id))[1]!.status).toBe('failed');
        expect(reports.at(-1)).toMatchObject({ key: `webhook:${sub.id}`, source: 'webhook', title: expect.stringContaining('no pudo entregar') });

        // «Volver a enviar»: el mismo aviso, ahora sí.
        const failed = (await deliveriesOf(sub.id))[1]!;
        hits.length = 0;
        await webhooks.redeliver(admin(), sub.id, failed.id);
        await webhooks.drain();
        expect((await deliveriesOf(sub.id))[1]!.status).toBe('success');
        expect(hits[0]!.headers['x-webhook-id']).toBe(failed.eventId);
        expect(resolved).toContain(`webhook:${sub.id}`);

        // 20 intentos fallidos seguidos: se pausa.
        await pg.db.update(webhookSubscriptions).set({ consecutiveFailures: 19 }).where(eq(webhookSubscriptions.id, sub.id));
        replies = [503];
        await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Vigésimo' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 3);
        await webhooks.drain();
        let current = await webhooks.get(admin(), sub.id);
        expect(current.active).toBe(false);
        expect(current.disabled_reason).toContain('20 intentos fallidos seguidos');
        expect(reports.at(-1)!.title).toContain('se pausó');
        // Pausada: lo nuevo no genera entregas.
        await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Ignorado' } });
        await new Promise((r) => setTimeout(r, 150));
        expect(await deliveriesOf(sub.id)).toHaveLength(3);

        // Encenderla reinicia la cuenta; un 410 la apaga.
        current = await webhooks.update(admin(), sub.id, { active: true });
        expect(current).toMatchObject({ active: true, consecutive_failures: 0, disabled_reason: null });
        replies = [410];
        await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Gone' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 4);
        await webhooks.drain();
        current = await webhooks.get(admin(), sub.id);
        expect(current.active).toBe(false);
        expect(current.disabled_reason).toContain('410');
        await webhooks.remove(admin(), sub.id);
    });

    it('si quien la creó pierde «Usar la API», no manda nada y se pausa', async () => {
        const sub = await webhooks.create(agent(), { url: `${base}/perdio`, events: ['record.created'] });
        await pg.db.update(memberships).set({ customRoleId: null }).where(and(eq(memberships.userId, agentId), eq(memberships.tenantId, tenantId)));
        await recs.create(tenantId, actorAgent(), 'clientes', { data: { [k('nombre')]: 'Sin permiso' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).length === 1);
        await webhooks.drain();
        expect(hits).toHaveLength(0);
        expect((await deliveriesOf(sub.id))[0]!.status).toBe('skipped');
        const current = await webhooks.get(admin(), sub.id);
        expect(current.active).toBe(false);
        expect(current.disabled_reason).toContain('ya no tiene permiso para usar la API');
        const [role] = await pg.db.select().from(customRoles).where(eq(customRoles.tenantId, tenantId));
        await pg.db.update(memberships).set({ customRoleId: role!.id }).where(and(eq(memberships.userId, agentId), eq(memberships.tenantId, tenantId)));
        await webhooks.remove(admin(), sub.id);
    });

    it('prueba, secreto nuevo, filtro por lista y validaciones', async () => {
        const sub = await webhooks.create(admin(), { url: `${base}/ping`, events: ['record.created'], list_ids: [listId], name: 'Mi ERP' });
        const test = await webhooks.test(admin(), sub.id);
        expect(test).toMatchObject({ ok: true, status: 200 });
        const ping = verify(hits[0]!, sub.secret);
        expect(ping).toMatchObject({ event: 'ping', webhook: { id: sub.id, name: 'Mi ERP' } });
        expect((await webhooks.deliveries(admin(), sub.id))[0]).toMatchObject({ event: 'ping', status: 'success' });

        const rotated = await webhooks.rotateSecret(admin(), sub.id);
        expect(rotated.secret).not.toBe(sub.secret);
        hits.length = 0;
        await webhooks.test(admin(), sub.id);
        verify(hits[0]!, rotated.secret);

        // Filtrado por lista: la de la suscripción sí avisa.
        const other = await recs.create(tenantId, actorAdmin(), 'clientes', { data: { [k('nombre')]: 'Sí avisa' } });
        await waitFor(async () => (await deliveriesOf(sub.id)).some((d) => d.recordId === other.id));

        // Validaciones de la dirección.
        await expect(webhooks.create(admin(), { url: 'ftp://x.test/a', events: ['record.created'] })).rejects.toMatchObject({ response: { code: 'webhook_url' } });
        await expect(webhooks.create(admin(), { url: 'https://u:p@example.com/a', events: ['record.created'] })).rejects.toMatchObject({ response: { code: 'webhook_url' } });
        delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        await expect(webhooks.create(admin(), { url: 'http://127.0.0.1:9/a', events: ['record.created'] })).rejects.toMatchObject({ response: { code: 'webhook_url' } });
        await expect(webhooks.create(admin(), { url: 'https://10.0.0.5/a', events: ['record.created'] })).rejects.toMatchObject({ response: { code: 'webhook_url' } });
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        await expect(webhooks.create(admin(), { url: `${base}/a`, events: ['record.created'], list_ids: [999_999] })).rejects.toMatchObject({ response: { code: 'webhook_lists' } });

        // Tope por empresa.
        await pg.db.insert(webhookSubscriptions).values(
            Array.from({ length: 24 }, (_, i) => ({ tenantId, name: `n${i}`, url: `${base}/n${i}`, events: ['record.created'], secretEnc: 'x', secretHint: 'xxxx', createdBy: adminId, active: false })),
        );
        await expect(webhooks.create(admin(), { url: `${base}/26`, events: ['record.created'] })).rejects.toMatchObject({ response: { code: 'webhook_limit' } });
        await pg.db.delete(webhookSubscriptions).where(and(eq(webhookSubscriptions.tenantId, tenantId), eq(webhookSubscriptions.active, false)));
        await webhooks.remove(admin(), sub.id);
    });

    it('RLS: una empresa no ve los webhooks ni las entregas de otra', async () => {
        const sub = await webhooks.create(admin(), { url: `${base}/rls`, events: ['record.created'] });
        const seen = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(webhookSubscriptions));
        expect(seen).toHaveLength(0);
        const seenDeliveries = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(webhookDeliveries));
        expect(seenDeliveries).toHaveLength(0);
        await expect(webhooks.get({ ...admin(), tenantId: otherTenantId }, sub.id)).rejects.toMatchObject({ response: { code: 'webhook_not_found' } });
        await webhooks.remove(admin(), sub.id);
    });
});
