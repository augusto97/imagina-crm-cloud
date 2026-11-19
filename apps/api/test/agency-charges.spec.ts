import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_AGENCY_BILLING, type AgencyBillingSettings } from '@imagina-base/shared';
import { and, desc, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

/**
 * v0.1.452 (I3, ADR-S108) — La agencia cobra EN LÍNEA a sus clientes con su
 * propia cuenta de Mercado Pago (Wompi y PayPal van por el mismo camino).
 * Postgres y Redis reales; lo simulado es el borde: la API de Mercado Pago
 * (`safeWebhookFetch`, como en `shops-online.spec`) y el correo.
 *
 * Lo que se prueba: elegir la cuenta arma la lista «Empresas cliente» y un
 * PUT sin `online` no la apaga; el link se reusa si es igual y se reemplaza
 * si cambia; el aviso del proveedor (que se RELEE) registra el pago una sola
 * vez y corre el «pagado hasta»; un pago en línea no se deshace; el cliente
 * paga desde su app sólo si la agencia lo deja; al volver del checkout se le
 * pregunta al proveedor; el aviso por correo lleva el link; y una agencia
 * entra a su propia empresa antes que a la de un cliente.
 */
interface FakeCall {
    url: string;
    method?: string;
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
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string }) => {
            const call = { url, method: opts.method, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json' };
        },
    };
});

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AgencyBillingRemindersService } from '../src/agency/agency-billing-reminders.service';
import { AgencyBillingService } from '../src/agency/agency-billing.service';
import { AgencyChargesService, agencyLinkEmail } from '../src/agency/agency-charges.service';
import { AgencyClientsListService } from '../src/agency/agency-clients-list.service';
import { AgencyController } from '../src/agency/agency.controller';
import { AgencyService } from '../src/agency/agency.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { CollectionsService } from '../src/collections/collections.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { agencyCharges, agencyPayments, connections, memberships, paymentLinks, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const MP = 'https://api.mercadopago.com';
const DAY = 24 * 60 * 60 * 1000;

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class FakeHookStore implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(0);
    }
    ltrim(): Promise<string> {
        return Promise.resolve('OK');
    }
    expire(): Promise<number> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('v0.1.452 — la agencia cobra en línea a sus clientes (Postgres + Redis reales, Mercado Pago simulado)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let auth: AuthService;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let billingSvc: AgencyBillingService;
    let clientsList: AgencyClientsListService;
    let charges: AgencyChargesService;
    let agencySvc: AgencyService;
    let controller: AgencyController;
    let reminders: AgencyBillingRemindersService;
    let guard: TenantGuard;
    const dispatcher = new CapturingDispatcher();
    const sent: MailMessage[] = [];
    const payments = new Map<string, Record<string, unknown>>();
    const prefs: Array<Record<string, unknown>> = [];
    let counter = 0;

    function fakeMercadoPago(): void {
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) return { status: 200, body: JSON.stringify({ id: 123, nickname: 'AGENCIA', site_id: 'MCO' }) };
            if (call.url === `${MP}/checkout/preferences` && call.method === 'POST') {
                prefs.push(JSON.parse(call.body!) as Record<string, unknown>);
                return {
                    status: 201,
                    body: JSON.stringify({ id: `pref-${prefs.length}`, init_point: `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-${prefs.length}` }),
                };
            }
            const m = /\/v1\/payments\/(\d+)$/.exec(call.url);
            if (m) {
                const p = payments.get(m[1]!);
                return p ? { status: 200, body: JSON.stringify(p) } : { status: 404, body: '{}' };
            }
            if (call.url.startsWith(`${MP}/v1/payments/search`)) {
                const ref = new URL(call.url).searchParams.get('external_reference');
                return { status: 200, body: JSON.stringify({ results: [...payments.values()].filter((p) => p.external_reference === ref).reverse() }) };
            }
            return { status: 404, body: '' };
        };
    }

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({
            REDIS_URL: rd.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea',
            FILES_SIGNING_SECRET: 'agency-charges-secret',
            APP_BASE_URL: 'https://app.test',
        });
        const mail = new MailService(env, {
            name: 'test',
            send: async (m) => {
                sent.push(m);
            },
        });
        const rt = new RealtimeService();
        const listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), listsSvc, rt);
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsSvc, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsSvc);
        const recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsSvc, fieldsSvc, rt, activity, dispatcher, new RelationsRepository());
        const dashboards = new DashboardsService(tenantDb, null as never, recordsSvc, fieldsSvc);
        const blueprint = new BlueprintService(tenantDb, listsSvc, fieldsSvc, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        collections = new CollectionsService(tenantDb, pg.db, env, connectors, listsSvc, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsSvc);
        auth = new AuthService(pg.db, redis, env, mail, new SessionService(redis, env));
        billingSvc = new AgencyBillingService(pg.db, plans, audit, collections);
        clientsList = new AgencyClientsListService(pg.db, tenantDb, billingSvc, new RecordsRepository(), activity, rt, dispatcher, audit, redis as never, {
            get: () => blueprint,
        } as never);
        clientsList.onModuleInit();
        charges = new AgencyChargesService(pg.db, env, billingSvc, clientsList, collections, mail, audit);
        charges.onModuleInit();
        agencySvc = new AgencyService(pg.db, auth, plans, billingSvc, audit, clientsList);
        controller = new AgencyController(agencySvc, billingSvc, charges, clientsList, {} as never);
        reminders = new AgencyBillingRemindersService(pg.db, redis, env, mail, undefined, charges);
        guard = new TenantGuard(tenantDb, new Reflector(), audit, redis);
        fakeMercadoPago();
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(() => {
        counter += 1;
        sent.length = 0;
    });

    async function makeUser(name: string): Promise<{ id: number; email: string }> {
        const email = `${name}-${counter}-${Math.random().toString(36).slice(2, 7)}@cobro-linea.test`;
        const [u] = await pg.db.insert(users).values({ email, passwordHash: 'x', name, emailVerifiedAt: new Date() }).returning();
        return { id: u!.id, email };
    }

    async function makeTenant(input: Partial<typeof tenants.$inferInsert> & { name: string }): Promise<number> {
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `${input.name.toLowerCase().replace(/\W+/g, '-')}-${counter}-${Math.random().toString(36).slice(2, 6)}`, plan: 'pro', status: 'active', ...input })
            .returning();
        return t!.id;
    }

    async function addMember(tenantId: number, userId: number, role: 'admin' | 'manager', viaAgency = false): Promise<void> {
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId, role, viaAgency }));
    }

    const PLANS: AgencyBillingSettings = {
        ...DEFAULT_AGENCY_BILLING,
        plans: [
            { id: 'basico', name: 'Básico', description: null, price: 150000, currency: 'COP', period_months: 1, limits_plan: null, active: true },
            { id: 'anual', name: 'Anual', description: null, price: 1500000, currency: 'COP', period_months: 12, limits_plan: null, active: true },
        ],
        grace_days: 5,
        remind_days: 3,
        notify_client: true,
    };

    /** Agencia con su admin, su cuenta de Mercado Pago, sus planes y un cliente con plan «Básico». */
    async function setup(opts: { online?: Partial<AgencyBillingSettings['online']> } = {}) {
        const agency = await makeTenant({ name: 'Agencia Linea', isAgency: true, settings: { agency: { client_plan: 'pro' } } });
        const admin = await makeUser('ana');
        await addMember(agency, admin.id, 'admin');
        const { connection } = await connectors.connectIntegrationKey(agency, admin.id, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        await billingSvc.updateSettings(agency, admin.id, { ...PLANS, online: { connection_id: connection.id, client_can_pay: true, auto_link: true, debit: false, ...opts.online } });
        const client = await makeTenant({ name: 'Floristería Rosa', agencyId: agency });
        const clientAdmin = await makeUser('rosa');
        await addMember(client, clientAdmin.id, 'admin');
        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'basico' });
        return { agency, admin, client, clientAdmin, connId: connection.id };
    }

    const chargesOf = (agency: number, client: number) =>
        withTenant(pg.db, agency, (tx) =>
            tx
                .select()
                .from(agencyCharges)
                .where(and(eq(agencyCharges.tenantId, agency), eq(agencyCharges.clientId, client)))
                .orderBy(desc(agencyCharges.id)),
        );
    const paymentsOf = (agency: number, client: number) =>
        withTenant(pg.db, agency, (tx) =>
            tx
                .select()
                .from(agencyPayments)
                .where(and(eq(agencyPayments.tenantId, agency), eq(agencyPayments.clientId, client)))
                .orderBy(desc(agencyPayments.id)),
        );
    const linkOf = async (agency: number, id: number) => {
        const [l] = await withTenant(pg.db, agency, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, id)));
        return l!;
    };
    const paidUntil = async (client: number): Promise<Date | null> => {
        const [t] = await pg.db.select({ d: tenants.agencyPaidUntil }).from(tenants).where(eq(tenants.id, client));
        return t?.d ?? null;
    };
    /** El valor de una columna de la lista «Empresas cliente» para un cliente. */
    const listValue = async (agency: number, client: number, role: string): Promise<unknown> => {
        const ref = await clientsList.listRef(agency);
        const fieldId = (ref!.fields as Record<string, number | undefined>)[role];
        const [t] = await pg.db.select({ rec: tenants.agencyRecordId }).from(tenants).where(eq(tenants.id, client));
        if (!t?.rec || !fieldId) return undefined;
        const [r] = await withTenant(pg.db, agency, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, t.rec!)));
        return (r!.data as Record<string, unknown>)[`f${fieldId}`];
    };
    const waitFor = async (check: () => Promise<boolean>): Promise<void> => {
        for (let i = 0; i < 80; i++) {
            if (await check()) return;
            await sleep(50);
        }
    };
    /** Mercado Pago aprueba el pago de la preferencia N (sin avisar). */
    const approve = (paymentId: string, prefIndex: number, amount: number): void => {
        payments.set(paymentId, {
            id: Number(paymentId),
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: amount,
            currency_id: 'COP',
            date_approved: new Date().toISOString(),
            payment_method_id: 'pse',
            payment_type_id: 'bank_transfer',
            external_reference: prefs[prefIndex]!.external_reference,
        });
    };
    const hookToken = async (agency: number, connId: number): Promise<string> => (await collections.hookUrlFor(agency, connId, 'mercadopago')).split('/').pop()!;

    /** Lo que el TenantGuard le deja a la request (la consola de la agencia la necesita). */
    async function asAgencyAdmin(userId: number, tenantId: number, body: unknown): Promise<FastifyRequest> {
        const req = { url: '/api/v1/agency/billing', method: 'PUT', headers: { 'x-tenant-id': String(tenantId) }, cookies: {}, authUserId: userId, body } as unknown as FastifyRequest;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => () => undefined,
            getClass: () => class {},
        } as unknown as ExecutionContext;
        await guard.canActivate(ctx);
        return req;
    }

    it('elegir la cuenta arma la lista «Empresas cliente»; un PUT sin «online» la conserva; la moneda tiene que servir', async () => {
        const agency = await makeTenant({ name: 'Agencia Ajustes', isAgency: true, settings: { agency: { client_plan: 'pro' } } });
        const admin = await makeUser('luz');
        await addMember(agency, admin.id, 'admin');
        const client = await makeTenant({ name: 'Panadería Sol', agencyId: agency });
        const { connection } = await connectors.connectIntegrationKey(agency, admin.id, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        expect(await clientsList.listRef(agency)).toBeNull();

        const body = { ...PLANS, online: { connection_id: connection.id, client_can_pay: false, auto_link: true, debit: false } };
        await controller.setBilling(await asAgencyAdmin(admin.id, agency, body), body);
        const ref = await clientsList.listRef(agency);
        expect(ref).not.toBeNull();
        // La empresa cliente ya tiene su registro en la lista.
        await waitFor(async () => (await listValue(agency, client, 'name')) === 'Panadería Sol');
        expect(await listValue(agency, client, 'name')).toBe('Panadería Sol');

        // Una pestaña vieja (o la API) que no manda «online» no apaga el cobro en línea.
        const { online: _drop, ...withoutOnline } = body;
        void _drop;
        await controller.setBilling(await asAgencyAdmin(admin.id, agency, withoutOnline), { ...withoutOnline, online: { ...DEFAULT_AGENCY_BILLING.online } } as AgencyBillingSettings);
        const [row] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agency));
        const saved = (row!.settings as Record<string, unknown>).agency_billing as AgencyBillingSettings;
        expect(saved.online).toEqual({ connection_id: connection.id, client_can_pay: false, auto_link: true, debit: false });

        // Wompi sólo cobra en pesos: un plan en dólares no se puede cobrar con esa cuenta.
        const [wompi] = await withTenant(pg.db, agency, (tx) =>
            tx.insert(connections).values({ tenantId: agency, provider: 'wompi', name: 'Wompi', visibility: 'workspace', createdBy: admin.id }).returning(),
        );
        await expect(
            billingSvc.updateSettings(agency, admin.id, {
                ...PLANS,
                plans: [{ ...PLANS.plans[0]!, currency: 'USD', price: 40 }],
                online: { connection_id: wompi!.id, client_can_pay: true, auto_link: true, debit: false },
            }),
        ).rejects.toMatchObject({ response: { code: 'agency_online_currency' } });
        // Una cuenta de otra empresa no se puede elegir.
        await expect(
            billingSvc.updateSettings(agency, admin.id, { ...PLANS, online: { connection_id: 999_999, client_can_pay: true, auto_link: true, debit: false } }),
        ).rejects.toMatchObject({ response: { code: 'agency_online_connection' } });
    });

    it('un link por cliente: igual se reusa, distinto reemplaza al anterior; anular lo saca de la lista', async () => {
        const { agency, admin, client, clientAdmin } = await setup();
        const before = prefs.length;
        const first = await charges.create(agency, client, { months: 1, via: 'agency', userId: admin.id, sendEmail: true });
        expect(first.reused).toBe(false);
        expect(first.charge).toMatchObject({ months: 1, amount: 150000, currency: 'COP', status: 'pending', via: 'agency', provider: 'Mercado Pago' });
        expect(first.charge.url).toContain('mercadopago.com.co');
        expect(prefs).toHaveLength(before + 1);
        const pref = prefs.at(-1)!;
        expect((pref.items as Array<{ unit_price: number }>)[0]!.unit_price).toBe(150000);
        expect(String((pref.back_urls as { success: string }).success)).toMatch(/^https:\/\/app\.test\/api\/v1\/public\/agency-pay\/ib_/);
        // El correo con el link le llega al admin PROPIO de la empresa.
        await waitFor(async () => sent.some((m) => m.to === clientAdmin.email));
        const linkMail = sent.find((m) => m.to === clientAdmin.email)!;
        expect(linkMail.subject).toBe('Tu link de pago de Agencia Linea');
        expect(linkMail.text).toContain(first.charge.url!);
        // El link queda en la columna «Link de pago» de la lista de la agencia.
        await waitFor(async () => (await listValue(agency, client, 'pay_link')) === first.charge.url);
        expect(await listValue(agency, client, 'pay_link')).toBe(first.charge.url);

        // Pedir lo mismo otra vez: el mismo link, sin otra preferencia.
        const again = await charges.create(agency, client, { months: 1, via: 'agency', userId: admin.id });
        expect(again.reused).toBe(true);
        expect(again.charge.id).toBe(first.charge.id);
        expect(prefs).toHaveLength(before + 1);

        // Otra cantidad de meses: link nuevo y el anterior queda anulado (y su link, vencido).
        const three = await charges.create(agency, client, { months: 3, via: 'agency', userId: admin.id });
        expect(three.reused).toBe(false);
        expect(three.charge.amount).toBe(450000);
        const rows = await chargesOf(agency, client);
        expect(rows.map((r) => r.status)).toEqual(['pending', 'cancelled']);
        expect((await linkOf(agency, rows[1]!.linkId!)).status).not.toBe('pending');

        // Anular el pendiente: queda «cancelled» y la columna del link se vacía.
        await charges.cancel(agency, admin.id, client, three.charge.id);
        expect((await chargesOf(agency, client))[0]!.status).toBe('cancelled');
        await expect(charges.cancel(agency, admin.id, client, three.charge.id)).rejects.toMatchObject({ response: { code: 'agency_charge_not_pending' } });
        await waitFor(async () => (await listValue(agency, client, 'pay_link')) === undefined);
        expect(await listValue(agency, client, 'pay_link')).toBeUndefined();
        expect((await charges.list(agency, client)).every((c) => c.status !== 'pending')).toBe(true);

        // Otra agencia no cobra a este cliente; un cliente sin plan no se cobra.
        const other = await setup();
        await expect(charges.create(other.agency, client, { months: 1, via: 'agency', userId: other.admin.id })).rejects.toMatchObject({
            response: { code: 'agency_client_not_found' },
        });
        await pg.db
            .update(tenants)
            .set({ settings: {} })
            .where(eq(tenants.id, other.client));
        await expect(charges.create(other.agency, other.client, { months: 1, via: 'agency', userId: other.admin.id })).rejects.toMatchObject({
            response: { code: 'agency_no_plan' },
        });
    });

    it('el aviso del proveedor registra el pago una sola vez, corre el «pagado hasta» y no se deshace', async () => {
        const { agency, admin, client, clientAdmin, connId } = await setup();
        // Venció hace 10 días: la empresa está en solo lectura.
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() - 10 * DAY) }).where(eq(tenants.id, client));
        const { charge } = await charges.create(agency, client, { months: 2, via: 'agency', userId: admin.id });
        const prefIndex = prefs.length - 1;
        sent.length = 0;

        const payId = String(900_000 + counter);
        approve(payId, prefIndex, 300000);
        const token = await hookToken(agency, connId);
        expect(await collections.handleHook(token, {}, { type: 'payment', data: { id: payId } })).toBe('applied');
        await waitFor(async () => (await paymentsOf(agency, client)).length === 1);
        const pays = await paymentsOf(agency, client);
        expect(pays).toHaveLength(1);
        expect(pays[0]).toMatchObject({ method: 'mercadopago', months: 2, currency: 'COP' });
        expect(Number(pays[0]!.amount)).toBe(300000);
        expect(pays[0]!.note).toContain('Pago en línea con Mercado Pago');
        // Venció: el período corre desde hoy (dos meses adelante, no desde la fecha vieja).
        const until = (await paidUntil(client))!;
        expect(until.getTime()).toBeGreaterThan(Date.now() + 55 * DAY);
        expect(until.getTime()).toBeLessThan(Date.now() + 64 * DAY);
        const [c] = await chargesOf(agency, client);
        expect(c).toMatchObject({ id: charge.id, status: 'paid', paymentId: pays[0]!.id });

        // El mismo aviso otra vez (Mercado Pago reintenta): no se registra dos veces.
        await collections.handleHook(token, {}, { type: 'payment', data: { id: payId } });
        await sleep(200);
        expect(await paymentsOf(agency, client)).toHaveLength(1);

        // Los avisos del pago: al cliente y a la agencia.
        await waitFor(async () => sent.length >= 2);
        expect(sent.find((m) => m.to === clientAdmin.email)?.subject).toBe('Recibimos tu pago a Agencia Linea');
        expect(sent.find((m) => m.to === admin.email)?.subject).toContain('«Floristería Rosa» pagó');

        // Un pago en línea no se deshace desde la consola.
        await expect(billingSvc.undoPayment(agency, admin.id, client, pays[0]!.id)).rejects.toMatchObject({ response: { code: 'agency_payment_online' } });
        // La lista de la agencia ya dice que está al día y el link desapareció.
        await waitFor(async () => (await listValue(agency, client, 'pay_link')) === undefined);
        expect(await listValue(agency, client, 'pay_link')).toBeUndefined();
        expect(await listValue(agency, client, 'last_payment')).toBeTruthy();
    });

    it('el cliente paga desde su app (si la agencia lo deja); al volver del checkout se le pregunta al proveedor', async () => {
        const { agency, client, clientAdmin } = await setup();
        const before = await paidUntil(client);
        let online = await charges.onlineFor(client);
        expect(online).toMatchObject({ enabled: true, provider: 'Mercado Pago', periods: [1, 2, 3, 6, 12], pending: null });

        // Un número de períodos que no se ofrece se rechaza.
        await expect(charges.payAsClient(client, clientAdmin.id, 5)).rejects.toMatchObject({ response: { code: 'agency_charge_periods' } });
        const charge = await charges.payAsClient(client, clientAdmin.id, 3);
        expect(charge).toMatchObject({ months: 3, amount: 450000, via: 'client', status: 'pending' });
        online = await charges.onlineFor(client);
        expect(online.pending?.id).toBe(charge.id);

        // Pagó y vuelve del checkout ANTES de que llegue el aviso: se le pregunta a Mercado Pago.
        const prefIndex = prefs.length - 1;
        approve(String(800_000 + counter), prefIndex, 450000);
        const [row] = await chargesOf(agency, client);
        const reference = (await linkOf(agency, row!.linkId!)).reference!;
        const back = await charges.returnFromCheckout(reference);
        expect(back).toBe('https://app.test/#/settings?s=suscripcion&pago=1');
        await waitFor(async () => (await paymentsOf(agency, client)).length === 1);
        expect(await paymentsOf(agency, client)).toHaveLength(1);
        expect((await paidUntil(client))!.getTime()).toBeGreaterThan(before!.getTime() + 80 * DAY);
        expect((await charges.onlineFor(client, { refresh: true })).pending).toBeNull();
        // Una referencia que no es de la agencia (o mal formada) lleva a la app sin tocar nada.
        expect(await charges.returnFromCheckout('nada')).toBe('https://app.test');
        expect(await charges.returnFromCheckout('ib_noexiste12345')).toBe('https://app.test');

        // Si la agencia no deja pagar desde la app, el cliente no puede crear el link.
        const closed = await setup({ online: { client_can_pay: false } });
        expect((await charges.onlineFor(closed.client)).enabled).toBe(false);
        await expect(charges.payAsClient(closed.client, closed.clientAdmin.id, 1)).rejects.toMatchObject({ response: { code: 'agency_online_off' } });
        // Una empresa que no es cliente de una agencia, tampoco.
        const lone = await makeTenant({ name: 'Sola' });
        expect((await charges.onlineFor(lone)).enabled).toBe(false);
        await expect(charges.payAsClient(lone, clientAdmin.id, 1)).rejects.toMatchObject({ response: { code: 'not_agency_client' } });
    });

    it('el aviso por correo antes de vencer trae el link para pagar (si la agencia lo deja); sin él, sólo el botón a la app', async () => {
        const { agency, client, clientAdmin } = await setup();
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() + 2 * DAY) }).where(eq(tenants.id, client));
        await reminders.tick();
        const toClient = sent.find((m) => m.to === clientAdmin.email);
        expect(toClient).toBeTruthy();
        const [row] = await chargesOf(agency, client);
        expect(row).toMatchObject({ via: 'auto', months: 1, status: 'pending' });
        const url = (await linkOf(agency, row!.linkId!)).url;
        expect(toClient!.text).toContain(url);
        expect(toClient!.html).toContain('Pagar ahora');

        // Sin «link automático»: el aviso no arma ningún link.
        const plain = await setup({ online: { auto_link: false } });
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() + 2 * DAY) }).where(eq(tenants.id, plain.client));
        await reminders.tick();
        const mail = sent.find((m) => m.to === plain.clientAdmin.email);
        expect(mail).toBeTruthy();
        expect(mail!.text).not.toContain('mercadopago');
        expect(await chargesOf(plain.agency, plain.client)).toHaveLength(0);

        // El correo del link (puro): escapa los nombres.
        const msg = agencyLinkEmail({ agencyName: 'Agencia <X>', clientName: 'Rosa & Cía', amount: 150000, currency: 'COP', months: 1, url: 'https://pagar.test/x' });
        expect(msg.html).toContain('Agencia &lt;X&gt;');
        expect(msg.html).not.toContain('<X>');
        expect(msg.text).toContain('$ 150.000 COP');
    });

    it('una agencia abre su propia empresa antes que la de un cliente al que entró', async () => {
        const { agency, admin, client } = await setup();
        // Entró al cliente por la agencia (membresía «via_agency», creada después).
        await addMember(client, admin.id, 'admin', true);
        const list = await auth.membershipsOf(admin.id);
        expect(list.map((m) => m.tenant_id)).toEqual([agency, client]);
        expect(list[0]!.via_agency).toBe(false);
    });
});
