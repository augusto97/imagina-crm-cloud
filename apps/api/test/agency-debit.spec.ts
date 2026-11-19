import { DEFAULT_AGENCY_BILLING, type AgencyBillingSettings } from '@imagina-base/shared';
import { and, desc, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.453 (I3, ADR-S108) — Débito automático de los clientes de una agencia:
 * la empresa autoriza su tarjeta UNA vez en la cuenta de Mercado Pago de la
 * agencia y cada cuota cobrada se registra sola como pago y corre el «pagado
 * hasta». Postgres y Redis reales; lo simulado es el borde: la API de Mercado
 * Pago (`safeWebhookFetch`) y el correo.
 *
 * Lo que se prueba: sólo con Mercado Pago o PayPal; el plan de suscripción lo
 * maneja la agencia (no aparece entre los planes de la empresa ni se edita);
 * armar el débito pide la suscripción con el valor del plan y el primer cobro
 * dos días antes de que venza; uno por autorizar se reemplaza y uno activo da
 * 409; la cuota cobrada se registra UNA vez (aunque llegue por dos avisos) y
 * no se deshace; con el débito cobrando, los avisos no mandan link; otro
 * valor cambia el monto en Mercado Pago y otro período lo cancela; el cliente
 * lo activa y lo cancela desde su app; y si deja la agencia, la vuelta
 * horaria lo cancela.
 */
interface FakeCall {
    url: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 404, body: '' }),
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string; headers?: Record<string, string> }) => {
            const call = { url, method: opts.method, body: opts.body, headers: opts.headers };
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
import { AgencyChargesService } from '../src/agency/agency-charges.service';
import { AgencyClientsListService } from '../src/agency/agency-clients-list.service';
import { AgencyDebitService } from '../src/agency/agency-debit.service';
import { AuditService } from '../src/audit/audit.service';
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
import { agencyCharges, agencyPayments, connections, memberships, subscriptionPlans, subscriptions, tenants, users } from '../src/db/schema';
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
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
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

/** Un Mercado Pago con memoria: suscripciones (preapproval), cuotas y pagos. */
interface FakeMp {
    pre: Map<string, Record<string, unknown>>;
    invoices: Map<string, Record<string, unknown>>;
    payments: Map<string, Record<string, unknown>>;
    puts: Array<{ id: string; body: Record<string, unknown> }>;
}
const mp: FakeMp = { pre: new Map(), invoices: new Map(), payments: new Map(), puts: [] };
let preSeq = 0;

function fakeMercadoPago(): void {
    net.handler = (call) => {
        if (call.url === `${MP}/users/me`) return { status: 200, body: JSON.stringify({ id: 123, nickname: 'AGENCIA', site_id: 'MCO' }) };
        if (call.url === `${MP}/preapproval` && call.method === 'POST') {
            const body = JSON.parse(call.body!) as Record<string, unknown>;
            preSeq += 1;
            const id = `pre-ag-${preSeq}`;
            const row = {
                id,
                status: 'pending',
                reason: body.reason,
                external_reference: body.external_reference,
                payer_email: body.payer_email,
                auto_recurring: body.auto_recurring,
                back_url: body.back_url,
                init_point: `https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=${id}`,
                next_payment_date: null,
            };
            mp.pre.set(id, row);
            return { status: 201, body: JSON.stringify(row) };
        }
        const pre = /\/preapproval\/([\w-]+)$/.exec(call.url);
        if (pre) {
            const row = mp.pre.get(pre[1]!);
            if (!row) return { status: 404, body: '{}' };
            if (call.method === 'PUT') {
                const body = JSON.parse(call.body!) as Record<string, unknown>;
                mp.puts.push({ id: pre[1]!, body });
                if (typeof body.status === 'string') row.status = body.status;
                if (body.auto_recurring) row.auto_recurring = { ...(row.auto_recurring as object), ...(body.auto_recurring as object) };
            }
            return { status: 200, body: JSON.stringify(row) };
        }
        if (call.url.startsWith(`${MP}/authorized_payments/search`)) {
            const id = new URL(call.url).searchParams.get('preapproval_id');
            return { status: 200, body: JSON.stringify({ results: [...mp.invoices.values()].filter((i) => i.preapproval_id === id) }) };
        }
        const inv = /\/authorized_payments\/([\w-]+)$/.exec(call.url);
        if (inv) {
            const row = mp.invoices.get(inv[1]!);
            return row ? { status: 200, body: JSON.stringify(row) } : { status: 404, body: '{}' };
        }
        const pay = /\/v1\/payments\/(\d+)$/.exec(call.url);
        if (pay) {
            const row = mp.payments.get(pay[1]!);
            return row ? { status: 200, body: JSON.stringify(row) } : { status: 404, body: '{}' };
        }
        return { status: 404, body: '' };
    };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('v0.1.453 — débito automático de los clientes de una agencia (Postgres + Redis reales, Mercado Pago simulado)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let subs: SubscriptionsService;
    let billingSvc: AgencyBillingService;
    let clientsList: AgencyClientsListService;
    let charges: AgencyChargesService;
    let debit: AgencyDebitService;
    let reminders: AgencyBillingRemindersService;
    const dispatcher = new CapturingDispatcher();
    const sent: MailMessage[] = [];
    let counter = 0;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({
            REDIS_URL: rd.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea',
            FILES_SIGNING_SECRET: 'agency-debit-secret',
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
        subs = new SubscriptionsService(tenantDb, pg.db, env, connectors, listsSvc, new RecordsRepository(), activity, rt, dispatcher, audit, collections, fieldsSvc);
        subs.onModuleInit();
        billingSvc = new AgencyBillingService(pg.db, plans, audit, collections);
        clientsList = new AgencyClientsListService(pg.db, tenantDb, billingSvc, new RecordsRepository(), activity, rt, dispatcher, audit, redis as never, {
            get: () => blueprint,
        } as never);
        clientsList.onModuleInit();
        charges = new AgencyChargesService(pg.db, env, billingSvc, clientsList, collections, mail, audit);
        charges.onModuleInit();
        debit = new AgencyDebitService(pg.db, env, billingSvc, clientsList, charges, subs, mail, audit);
        debit.onModuleInit();
        reminders = new AgencyBillingRemindersService(pg.db, redis, env, mail, undefined, charges, debit);
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
        const email = `${name}-${counter}-${Math.random().toString(36).slice(2, 7)}@debito.test`;
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

    async function addMember(tenantId: number, userId: number, role: 'admin' | 'manager'): Promise<void> {
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId, role }));
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

    /** Agencia con su cuenta de Mercado Pago y el débito ofrecido; un cliente con plan «Básico». */
    async function setup(opts: { debitOn?: boolean } = {}) {
        const agency = await makeTenant({ name: 'Agencia Debito', isAgency: true, settings: { agency: { client_plan: 'pro' } } });
        const admin = await makeUser('ana');
        await addMember(agency, admin.id, 'admin');
        const { connection } = await connectors.connectIntegrationKey(agency, admin.id, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        await billingSvc.updateSettings(agency, admin.id, {
            ...PLANS,
            online: { connection_id: connection.id, client_can_pay: true, auto_link: true, debit: opts.debitOn ?? true },
        });
        const client = await makeTenant({ name: 'Floristería Rosa', agencyId: agency });
        const clientAdmin = await makeUser('rosa');
        await addMember(client, clientAdmin.id, 'admin');
        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'basico' });
        return { agency, admin, client, clientAdmin, connId: connection.id };
    }

    const paymentsOf = (agency: number, client: number) =>
        withTenant(pg.db, agency, (tx) =>
            tx
                .select()
                .from(agencyPayments)
                .where(and(eq(agencyPayments.tenantId, agency), eq(agencyPayments.clientId, client)))
                .orderBy(desc(agencyPayments.id)),
        );
    const paidUntil = async (client: number): Promise<Date | null> => {
        const [t] = await pg.db.select({ d: tenants.agencyPaidUntil }).from(tenants).where(eq(tenants.id, client));
        return t?.d ?? null;
    };
    const waitFor = async (check: () => Promise<boolean>): Promise<void> => {
        for (let i = 0; i < 80; i++) {
            if (await check()) return;
            await sleep(50);
        }
    };
    const preIdOf = (url: string | null): string => new URL(url!).searchParams.get('preapproval_id')!;
    const hookToken = async (agency: number, connId: number): Promise<string> => (await collections.hookUrlFor(agency, connId, 'mercadopago')).split('/').pop()!;
    /** El cliente autoriza la tarjeta y Mercado Pago cobra una cuota. */
    function authorizeAndCharge(preId: string, invId: string, paymentId: number): void {
        const row = mp.pre.get(preId)!;
        row.status = 'authorized';
        row.next_payment_date = new Date(Date.now() + 30 * DAY).toISOString();
        const now = new Date().toISOString();
        mp.invoices.set(invId, {
            id: invId,
            preapproval_id: preId,
            status: 'processed',
            debit_date: now,
            date_created: now,
            last_modified: now,
            retry_attempt: 0,
            transaction_amount: 150000,
            currency_id: 'COP',
            payment: { id: paymentId, status: 'approved', status_detail: 'accredited' },
        });
        mp.payments.set(String(paymentId), {
            id: paymentId,
            status: 'approved',
            transaction_amount: 150000,
            currency_id: 'COP',
            payment_type_id: 'credit_card',
            payment_method_id: 'visa',
            date_approved: now,
            metadata: { preapproval_id: preId },
        });
    }

    it('sólo con Mercado Pago o PayPal: una cuenta de Wompi no ofrece débito', async () => {
        const { agency, admin } = await setup({ debitOn: false });
        const [wompi] = await withTenant(pg.db, agency, (tx) =>
            tx.insert(connections).values({ tenantId: agency, provider: 'wompi', name: 'Wompi', visibility: 'workspace', createdBy: admin.id }).returning(),
        );
        await expect(
            billingSvc.updateSettings(agency, admin.id, { ...PLANS, online: { connection_id: wompi!.id, client_can_pay: true, auto_link: true, debit: true } }),
        ).rejects.toMatchObject({ response: { code: 'agency_debit_provider' } });
        // Sin cuenta, el débito queda apagado aunque venga encendido.
        await billingSvc.updateSettings(agency, admin.id, { ...PLANS, online: { connection_id: null, client_can_pay: true, auto_link: true, debit: true } });
        const [row] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agency));
        expect(((row!.settings as Record<string, unknown>).agency_billing as AgencyBillingSettings).online.debit).toBe(false);
    });

    it('armar el débito: la suscripción con el valor del plan, el primer cobro antes de vencer, uno por autorizar se reemplaza', async () => {
        const { agency, admin, client, clientAdmin, connId } = await setup();
        // Sin débito ofrecido, no se puede armar.
        const off = await setup({ debitOn: false });
        await expect(debit.start(off.agency, off.client, { via: 'agency', userId: off.admin.id })).rejects.toMatchObject({ response: { code: 'agency_debit_off' } });

        const before = await paidUntil(client);
        expect(before).not.toBeNull();
        const first = await debit.start(agency, client, { via: 'agency', userId: admin.id, sendEmail: true });
        expect(first).toMatchObject({ status: 'pending', amount: 150000, currency: 'COP', months: 1, provider: 'Mercado Pago' });
        expect(first.payer_email).toBe(clientAdmin.email.toLowerCase());
        const sentPre = mp.pre.get(preIdOf(first.url))!;
        expect(sentPre.auto_recurring).toMatchObject({ frequency: 1, frequency_type: 'months', transaction_amount: 150000, currency_id: 'COP' });
        expect(String(sentPre.back_url)).toMatch(/^https:\/\/app\.test\/api\/v1\/public\/agency-pay\/debit\/ibs_/);
        // El primer cobro: dos días antes de que venza lo ya pagado.
        const start = new Date(String((sentPre.auto_recurring as { start_date?: string }).start_date));
        expect(Math.abs(start.getTime() - (before!.getTime() - 2 * DAY))).toBeLessThan(2 * DAY);

        // El link le llega al administrador de la empresa.
        await waitFor(async () => sent.some((m) => m.to === clientAdmin.email));
        const m = sent.find((x) => x.to === clientAdmin.email)!;
        expect(m.subject).toBe('Activa el débito automático de tu plan con Agencia Debito');
        expect(m.text).toContain(first.url!);

        // El plan de suscripción lo maneja la agencia: no aparece entre los planes ni se edita.
        const plansList = await subs.listPlans(agency, { userId: admin.id, role: 'admin' }, connId);
        expect(plansList.some((p) => p.name.startsWith('Básico'))).toBe(false);
        const [managed] = await pg.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.tenantId, agency));
        expect((managed!.providerRefs as Record<string, unknown>).agency_plan_id).toBe('basico');

        // Lo que ve la empresa en su app: disponible y por autorizar.
        const mine = await debit.mineFor(client);
        expect(mine).toMatchObject({ available: true, current: { status: 'pending' } });
        expect((await debit.mineFor(off.client)).available).toBe(false);

        // Armarlo otra vez mientras está por autorizar: reemplaza (el viejo se cancela en Mercado Pago).
        const second = await debit.start(agency, client, { email: 'pagos@rosa.test', via: 'agency', userId: admin.id });
        expect(mp.puts).toContainEqual({ id: preIdOf(first.url), body: { status: 'cancelled' } });
        expect(second.url).not.toBe(first.url);
        expect(second.payer_email).toBe('pagos@rosa.test');
        // El mismo plan de suscripción (no se crea otro por cada débito).
        expect(await pg.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.tenantId, agency))).toHaveLength(1);
    });

    it('la cuota cobrada se registra sola una vez, corre el «pagado hasta», no se deshace y apaga el link de los avisos', async () => {
        const { agency, admin, client, clientAdmin, connId } = await setup();
        const before = (await paidUntil(client))!;
        const d = await debit.start(agency, client, { via: 'agency', userId: admin.id });
        const preId = preIdOf(d.url);
        sent.length = 0;

        authorizeAndCharge(preId, `inv-${counter}`, 700_000 + counter);
        const token = await hookToken(agency, connId);
        expect(await collections.handleHook(token, {}, { type: 'subscription_preapproval', data: { id: preId } })).toBe('applied');
        await waitFor(async () => (await paymentsOf(agency, client)).length === 1);
        // El mismo cobro por los otros dos avisos: no se registra dos veces.
        await collections.handleHook(token, {}, { type: 'payment', data: { id: String(700_000 + counter) } });
        await collections.handleHook(token, {}, { type: 'subscription_authorized_payment', data: { id: `inv-${counter}` } });
        await debit.tick();
        await sleep(150);
        const pays = await paymentsOf(agency, client);
        expect(pays).toHaveLength(1);
        expect(pays[0]).toMatchObject({ method: 'mercadopago', months: 1, currency: 'COP' });
        expect(Number(pays[0]!.amount)).toBe(150000);
        expect(pays[0]!.note).toContain('Débito automático con Mercado Pago');
        expect(pays[0]!.subscriptionChargeId).not.toBeNull();
        // Un mes más sobre lo que ya tenía pagado.
        const after = (await paidUntil(client))!;
        expect(after.getTime() - before.getTime()).toBeGreaterThan(27 * DAY);
        expect(after.getTime() - before.getTime()).toBeLessThan(32 * DAY);

        // Activo y cobrando: no se arma otro, y no se deshace desde la consola.
        expect(await debit.isCharging(agency, client)).toBe(true);
        expect((await debit.mineFor(client)).current).toMatchObject({ status: 'active', url: null });
        await expect(debit.start(agency, client, { via: 'agency', userId: admin.id })).rejects.toMatchObject({ response: { code: 'agency_debit_exists' } });
        await expect(billingSvc.undoPayment(agency, admin.id, client, pays[0]!.id)).rejects.toMatchObject({ response: { code: 'agency_payment_online' } });

        // Los correos del pago dicen que fue por débito.
        await waitFor(async () => sent.some((m) => m.to === clientAdmin.email));
        expect(sent.find((m) => m.to === clientAdmin.email)?.text).toContain('débito automático');

        // Por vencer con el débito cobrando: ni aviso «por vencer» ni link de pago (cobraría dos veces).
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() + 2 * DAY) }).where(eq(tenants.id, client));
        sent.length = 0;
        await reminders.tick(new Date());
        expect(sent.filter((m) => m.to === clientAdmin.email)).toHaveLength(0);
        const links = await withTenant(pg.db, agency, (tx) => tx.select().from(agencyCharges).where(eq(agencyCharges.clientId, client)));
        expect(links).toHaveLength(0);
    });

    it('otro valor cambia el monto en Mercado Pago; otro período lo cancela; el cliente lo activa y lo cancela desde su app', async () => {
        const { agency, admin, client, clientAdmin, connId } = await setup();
        const d = await debit.start(agency, client, { via: 'agency', userId: admin.id });
        const preId = preIdOf(d.url);
        authorizeAndCharge(preId, `inv-${counter}`, 710_000 + counter);
        await collections.handleHook(await hookToken(agency, connId), {}, { type: 'subscription_preapproval', data: { id: preId } });
        await waitFor(async () => (await debit.mineFor(client)).current?.status === 'active');

        // La agencia le sube el valor: el débito cobra el nuevo.
        mp.puts.length = 0;
        await billingSvc.setClientBilling(agency, admin.id, client, { price: 180000 });
        await waitFor(async () => mp.puts.some((p) => p.id === preId && (p.body.auto_recurring as { transaction_amount?: number } | undefined)?.transaction_amount === 180000));
        expect(mp.puts.find((p) => p.id === preId)?.body).toMatchObject({ auto_recurring: { transaction_amount: 180000 } });

        // Otro período (plan anual): el débito mensual se cancela.
        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'anual' });
        await waitFor(async () => (await debit.mineFor(client)).current === null);
        expect(mp.pre.get(preId)!.status).toBe('cancelled');

        // El cliente lo activa desde su app con el correo de su cuenta de pago, y lo cancela.
        const mine = await debit.startAsClient(client, clientAdmin.id, 'Pagos@Rosa.test');
        expect(mine).toMatchObject({ status: 'pending', amount: 1500000, months: 12, payer_email: 'pagos@rosa.test' });
        await debit.cancelAsClient(client, clientAdmin.id);
        expect(mp.pre.get(preIdOf(mine.url))!.status).toBe('cancelled');
        expect((await debit.mineFor(client)).current).toBeNull();
    });

    it('si la empresa deja la agencia, la vuelta horaria cancela su débito', async () => {
        const { agency, admin, client } = await setup();
        const d = await debit.start(agency, client, { via: 'agency', userId: admin.id });
        const preId = preIdOf(d.url);
        await pg.db.update(tenants).set({ agencyId: null, agencyRecordId: null }).where(eq(tenants.id, client));
        await debit.tick();
        expect(mp.pre.get(preId)!.status).toBe('cancelled');
        const [row] = await pg.db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.tenantId, agency));
        expect(row!.status).toBe('cancelled');
    });
});
