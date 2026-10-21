import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.290 — Pagar desde el portal del cliente (bloque «Pagos»). La API de
 * Mercado Pago se simula en el borde de red (`safeWebhookFetch`), igual que en
 * `collections.spec.ts`: el test ejercita todo lo nuestro — qué links ve el
 * cliente (sólo los SUYOS, también de listas vinculadas), que el monto sale
 * del REGISTRO y no del navegador, que «Pagar» dos veces reusa el link
 * pendiente, el aviso del proveedor que lo marca pagado, y que sin conexión
 * el bloque no se ofrece.
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
        safeWebhookFetch: async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string }) => {
            const call = { url, method: opts.method, headers: opts.headers, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json' };
        },
    };
});

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { SessionService } from '../src/auth/session.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { CollectionsService } from '../src/collections/collections.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { RecordLayoutDataService } from '../src/dashboards/record-layout-data.service';
import { connections, memberships, paymentLinks, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DomainsService } from '../src/domains/domains.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { PortalService, type PortalActor } from '../src/portal/portal.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';

class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
    }
}

describe('v0.1.290 — pagar desde el portal (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let records: RecordsService;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let portal: PortalService;
    let sessions: SessionService;
    let tenantId: number;
    let admin: Actor;
    const mailbox = new CapturingMail();
    const ids = { clientes: 0, facturas: 0, saldo: 0, nombre: 0, cliente: 0, numero: 0, total: 0 };
    let ana = { userId: 0, recordId: 0 };
    let beto = { userId: 0, recordId: 0 };
    let prefs: Array<Record<string, unknown>> = [];
    const mpPayments = new Map<string, Record<string, unknown>>();
    let connId = 0;

    const actorOf = (u: { userId: number }): PortalActor => ({ userId: u.userId, tenantId });

    function fakeMercadoPago(): void {
        prefs = [];
        mpPayments.clear();
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) {
                return { status: 200, body: JSON.stringify({ id: 123, nickname: 'TIENDA_ACME', site_id: 'MCO' }) };
            }
            if (call.url === `${MP}/checkout/preferences` && call.method === 'POST') {
                prefs.push(JSON.parse(call.body!) as Record<string, unknown>);
                return {
                    status: 201,
                    body: JSON.stringify({ id: `pref-${prefs.length}`, init_point: `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-${prefs.length}` }),
                };
            }
            const m = /\/v1\/payments\/(\d+)$/.exec(call.url);
            if (m) {
                const p = mpPayments.get(m[1]!);
                return p ? { status: 200, body: JSON.stringify(p) } : { status: 404, body: '{}' };
            }
            return { status: 404, body: '' };
        };
    }

    /** El diseño del portal: un bloque «Pagos» configurable. */
    async function setPaymentsBlock(config: Record<string, unknown>): Promise<void> {
        await lists.update(tenantId, 'clientes', {
            settings: {
                portal: { enabled: true },
                portal_layout_v3: {
                    v: 3,
                    pages: [
                        {
                            id: 'inicio',
                            name: 'Inicio',
                            sections: [{ id: 's1', columns: [12], blocks: [[{ id: 'pagos', type: 'payments', title: 'Pagos', config }]] }],
                        },
                    ],
                },
            },
        });
    }

    async function clientSession(email: string, recordId: number): Promise<number> {
        const link = await portal.issue(tenantId, 'clientes', { record_id: recordId, email });
        const { sessionToken } = await portal.consume(link.token!);
        return (await sessions.get(sessionToken))!.userId;
    }

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env));
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        records = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, new AutomationDispatcher(), new RelationsRepository());
        collections = new CollectionsService(
            tenantDb,
            pg.db,
            env,
            connectors,
            lists,
            new RecordsRepository(),
            activity,
            rt,
            new AutomationDispatcher(),
            audit,
            fieldsSvc,
        );
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-ppay-'))), env);
        const domains = new DomainsService(pg.db, env, files);
        domains.probeServing = () => Promise.resolve(false);
        portal = new PortalService(
            pg.db,
            redis,
            env,
            tenantDb,
            lists,
            (sessions = new SessionService(redis, env)),
            new MailService(env, mailbox),
            fieldsSvc,
            new CommentsRepository(),
            new ActivityRepository(),
            activity,
            rt,
            new AutomationDispatcher(),
            files,
            domains,
            new RecordLayoutDataService(
                tenantDb,
                lists,
                fieldsSvc,
                records,
                new DashboardsService(tenantDb, new AggregateService(tenantDb, lists, fieldsSvc), records, fieldsSvc),
            ),
            undefined,
            undefined,
            undefined,
            records,
            collections,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        admin = { userId: a!.id, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: a!.id, tenantId, role: 'admin' }));

        const clientes = await lists.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        ids.clientes = clientes.id;
        ids.nombre = (await fieldsSvc.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' })).id;
        ids.saldo = (await fieldsSvc.create(tenantId, 'clientes', { label: 'Saldo', type: 'currency', slug: 'saldo', config: { currency: 'COP', precision: 0 } })).id;
        const facturas = await lists.create(tenantId, { name: 'Facturas', slug: 'facturas' });
        ids.facturas = facturas.id;
        ids.numero = (await fieldsSvc.create(tenantId, 'facturas', { label: 'Número', type: 'text', slug: 'numero' })).id;
        ids.total = (await fieldsSvc.create(tenantId, 'facturas', { label: 'Total', type: 'currency', slug: 'total', config: { currency: 'COP' } })).id;
        ids.cliente = (
            await fieldsSvc.create(tenantId, 'facturas', { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientes.id } })
        ).id;

        ana.recordId = (await records.create(tenantId, admin, 'clientes', { data: { [`f${ids.nombre}`]: 'Ana SAS', [`f${ids.saldo}`]: 150000 } })).id;
        beto.recordId = (await records.create(tenantId, admin, 'clientes', { data: { [`f${ids.nombre}`]: 'Beto Ltda', [`f${ids.saldo}`]: 0 } })).id;
        ana = { ...ana, userId: await clientSession('ana@cliente.test', ana.recordId) };
        beto = { ...beto, userId: await clientSession('beto@cliente.test', beto.recordId) };
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    beforeEach(async () => {
        net.calls.length = 0;
        fakeMercadoPago();
        await redis.del(`portalpay:${tenantId}:${ana.userId}`, `portalpay:${tenantId}:${beto.userId}`);
    });

    it('sin conexión de cobro el bloque no se ofrece (no viaja nada)', async () => {
        await setPaymentsBlock({ show_links: true });
        const boot = await portal.me(actorOf(ana));
        expect(boot.payments).toEqual({});
        await expect(portal.payFromPortal(actorOf(ana), 'pagos')).rejects.toMatchObject({ response: { code: 'portal_nothing_to_pay' } });
    });

    it('el cliente ve SÓLO sus links (los de su registro y los de sus facturas vinculadas)', async () => {
        const { connection } = await connectors.connectIntegrationKey(tenantId, admin.userId, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        connId = connection.id;
        // Facturas: una de Ana y otra de Beto.
        const fa = await records.create(tenantId, admin, 'facturas', {
            data: { [`f${ids.numero}`]: 'F-1', [`f${ids.total}`]: 80000, [`f${ids.cliente}`]: [ana.recordId] },
        });
        const fb = await records.create(tenantId, admin, 'facturas', {
            data: { [`f${ids.numero}`]: 'F-2', [`f${ids.total}`]: 99000, [`f${ids.cliente}`]: [beto.recordId] },
        });
        // La empresa cobró desde la ficha: un link en cada factura y otro en el registro de Beto.
        await collections.createForRecord(tenantId, admin, 'facturas', fa.id, { connection_id: connId, title: 'Factura F-1', amount: 80000, currency: 'COP' });
        await collections.createForRecord(tenantId, admin, 'facturas', fb.id, { connection_id: connId, title: 'Factura F-2', amount: 99000, currency: 'COP' });
        await collections.createForRecord(tenantId, admin, 'clientes', beto.recordId, { connection_id: connId, title: 'Anticipo Beto', amount: 5000, currency: 'COP' });

        // Sin listas vinculadas en el bloque: sólo lo de su registro (nada).
        await setPaymentsBlock({ show_links: true, linked_list_ids: [] });
        expect((await portal.me(actorOf(ana))).payments.pagos?.links).toEqual([]);

        await setPaymentsBlock({ show_links: true, linked_list_ids: [ids.facturas] });
        const anaLinks = (await portal.me(actorOf(ana))).payments.pagos!.links;
        expect(anaLinks.map((l) => l.title)).toEqual(['Factura F-1']);
        expect(anaLinks[0]).toMatchObject({ amount: 80000, currency: 'COP', status: 'pending', record_title: 'F-1' });
        expect(anaLinks[0]!.url).toContain('mercadopago.com.co');
        const betoLinks = (await portal.me(actorOf(beto))).payments.pagos!.links;
        expect(betoLinks.map((l) => l.title).sort()).toEqual(['Anticipo Beto', 'Factura F-2']);
        // Sin el botón encendido, no se ofrece pagar.
        expect((await portal.me(actorOf(ana))).payments.pagos!.pay).toBeNull();
    });

    it('«Pagar»: el monto sale del REGISTRO; pagar dos veces reusa el link; si cambia el saldo nace otro', async () => {
        await setPaymentsBlock({
            show_links: true,
            pay_button: { enabled: true, connection_id: connId, amount_field_id: ids.saldo, concept: '', label: 'Pagar saldo' },
        });
        const boot = await portal.me(actorOf(ana));
        expect(boot.payments.pagos!.pay).toEqual({ label: 'Pagar saldo', amount: 150000, currency: 'COP', concept: 'Ana SAS', provider: 'mercadopago' });

        const first = await portal.payFromPortal(actorOf(ana), 'pagos');
        expect(first.reused).toBe(false);
        expect(first.url).toContain('pref_id=pref-1');
        // Lo que se le pidió a Mercado Pago: el monto del registro y el correo del cliente.
        expect(prefs).toHaveLength(1);
        expect((prefs[0]!.items as Array<{ unit_price: number; title: string }>)[0]).toMatchObject({ unit_price: 150000, title: 'Ana SAS' });
        expect(JSON.stringify(prefs[0]!.payer ?? {})).toContain('ana@cliente.test');

        // Segundo clic: el mismo link, sin llamar al proveedor.
        const again = await portal.payFromPortal(actorOf(ana), 'pagos');
        expect(again).toEqual({ url: first.url, reused: true });
        expect(prefs).toHaveLength(1);

        // El link aparece en sus pagos.
        const links = (await portal.me(actorOf(ana))).payments.pagos!.links;
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ amount: 150000, status: 'pending', record_title: 'Ana SAS' });

        // La empresa cambió el saldo: el próximo «Pagar» crea uno por el monto nuevo.
        await records.update(tenantId, admin, 'clientes', ana.recordId, { data: { [`f${ids.saldo}`]: 120000 } });
        const changed = await portal.payFromPortal(actorOf(ana), 'pagos');
        expect(changed.reused).toBe(false);
        expect((prefs[1]!.items as Array<{ unit_price: number }>)[0]!.unit_price).toBe(120000);
        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(paymentLinks).where(and(eq(paymentLinks.recordId, ana.recordId), eq(paymentLinks.listId, ids.clientes))),
        );
        expect(rows.map((r) => Number(r.amount)).sort((x, y) => x - y)).toEqual([120000, 150000]);
        // Bitácora: el link nació desde el portal.
        expect(rows.every((r) => r.createdBy === null)).toBe(true);
    });

    it('el aviso del proveedor marca el pago y el portal lo muestra pagado con su comprobante', async () => {
        const [row] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(paymentLinks).where(and(eq(paymentLinks.recordId, ana.recordId), eq(paymentLinks.amount, 120000))),
        );
        // En Mercado Pago el id externo del link ES la referencia de la preferencia.
        const ref = row!.externalId;
        expect(ref).toMatch(/^ib_/);
        mpPayments.set('9001', {
            id: 9001,
            status: 'approved',
            transaction_amount: 120000,
            currency_id: 'COP',
            date_approved: '2026-10-21T15:00:00.000-05:00',
            payment_method_id: 'pse',
            payment_type_id: 'bank_transfer',
            external_reference: ref,
        });
        const url = await collections.hookUrlFor(tenantId, connId, 'mercadopago');
        const token = url.split('/').pop()!;
        expect(await collections.handleHook(token, {}, { type: 'payment', data: { id: '9001' } })).toBe('applied');
        const links = (await portal.me(actorOf(ana))).payments.pagos!.links;
        const paid = links.find((l) => l.id === row!.id)!;
        expect(paid).toMatchObject({ status: 'approved', paid_amount: 120000, payment_id: '9001', url: null });
        expect(paid.paid_at).not.toBeNull();
    });

    it('nada que pagar, bloque ajeno o del navegador: no se crea nada', async () => {
        // Beto tiene saldo 0: no se le ofrece pagar.
        expect((await portal.me(actorOf(beto))).payments.pagos!.pay).toBeNull();
        await expect(portal.payFromPortal(actorOf(beto), 'pagos')).rejects.toMatchObject({ response: { code: 'portal_nothing_to_pay' } });
        // Un id de bloque que no está en el diseño.
        await expect(portal.payFromPortal(actorOf(ana), 'inventado')).rejects.toMatchObject({ response: { code: 'portal_block_not_found' } });
        // El monto apunta a un campo que no es numérico: no se ofrece.
        await setPaymentsBlock({ pay_button: { enabled: true, connection_id: connId, amount_field_id: ids.nombre } });
        await expect(portal.payFromPortal(actorOf(ana), 'pagos')).rejects.toMatchObject({ response: { code: 'portal_nothing_to_pay' } });
        // Una conexión PRIVADA (de una persona) no la puede usar el portal.
        await setPaymentsBlock({ pay_button: { enabled: true, connection_id: connId, amount_field_id: ids.saldo } });
        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(connections).set({ visibility: 'private', ownerUserId: admin.userId }).where(eq(connections.id, connId)),
        );
        await expect(portal.payFromPortal(actorOf(ana), 'pagos')).rejects.toMatchObject({ response: { code: 'portal_nothing_to_pay' } });
        expect((await portal.me(actorOf(ana))).payments).toEqual({});
        await withTenant(pg.db, tenantId, (tx) => tx.update(connections).set({ visibility: 'workspace' }).where(eq(connections.id, connId)));
        expect(prefs).toHaveLength(0);
    });

    it('freno por cliente: muchos «Pagar» seguidos se cortan', async () => {
        await setPaymentsBlock({ pay_button: { enabled: true, connection_id: connId, amount_field_id: ids.saldo } });
        for (let i = 0; i < 10; i++) await portal.payFromPortal(actorOf(ana), 'pagos');
        await expect(portal.payFromPortal(actorOf(ana), 'pagos')).rejects.toMatchObject({ response: { code: 'too_many_attempts' } });
    });
});
