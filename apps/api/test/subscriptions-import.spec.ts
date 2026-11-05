import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_STATUS_OPTIONS, addSubscriptionPeriod, decideImport, mpFrequency, mpTrialDays, readSubscriptionFields, readSubscriptionImportConfig } from '@imagina-base/shared';

/**
 * v0.1.376 (ADR-S96, addendum) — Importar las suscripciones y los planes que la
 * empresa YA tiene en Mercado Pago, con Postgres real. Mercado Pago se simula en
 * el borde de red con memoria (búsqueda de suscripciones y de planes, cuotas y
 * pagos): la vista previa, la lista nueva con sus columnas, vincular por correo
 * con una lista existente, que nada se duplique, que lo importado no dispare
 * automatizaciones y que las suscripciones nuevas lleguen solas (aviso y
 * revisión periódica).
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
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { CollectionsService } from '../src/collections/collections.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RecordsService } from '../src/records/records.service';
import { SubscriptionChargeLogService } from '../src/subscriptions/subscription-charge-log.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import {
    automationRuns,
    automations,
    connections,
    dashboards,
    fields,
    lists,
    records,
    relations,
    savedViews,
    subscriptionCharges,
    subscriptionPlans,
    subscriptions,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import {
    isSummaryCharge,
    mpPayerName,
    parsePreapprovalPlans,
    parsePreapprovalSearch,
    readPaymentPayer,
    sameChargeDay,
    summaryChargeId,
} from '../src/subscriptions/subscription-gateway';
import { SubscriptionImportService, cyclesBetween } from '../src/subscriptions/subscription-import.service';
import { emptyMaps, remapWhatsappConnectionConfig } from '../src/platform/tenant-transfer.remap';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';
const DAY = 24 * 60 * 60 * 1000;

class FakeHookStore implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
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

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

/** Un Mercado Pago con memoria: suscripciones (con búsqueda), planes, cuotas y pagos. */
interface FakeMp {
    pre: Map<string, Record<string, unknown>>;
    plans: Map<string, Record<string, unknown>>;
    invoices: Map<string, Record<string, unknown>>;
    payments: Map<string, Record<string, unknown>>;
    searches: number;
}

const iso = (daysFromNow: number): string => new Date(Date.now() + daysFromNow * DAY).toISOString();

function fakeMercadoPago(): FakeMp {
    const mp: FakeMp = { pre: new Map(), plans: new Map(), invoices: new Map(), payments: new Map(), searches: 0 };
    net.handler = (call) => {
        if (call.url === `${MP}/users/me`) {
            return call.headers?.authorization === 'Bearer APP_USR-buena'
                ? { status: 200, body: JSON.stringify({ id: 123, nickname: 'TIENDA_ACME', site_id: 'MCO' }) }
                : { status: 401, body: JSON.stringify({ message: 'invalid access token' }) };
        }
        if (call.url.startsWith(`${MP}/preapproval/search`)) {
            mp.searches += 1;
            const q = new URL(call.url).searchParams;
            const offset = Number(q.get('offset') ?? 0);
            const limit = Number(q.get('limit') ?? 100);
            const all = [...mp.pre.values()];
            return { status: 200, body: JSON.stringify({ paging: { offset, limit, total: all.length }, results: all.slice(offset, offset + limit) }) };
        }
        if (call.url.startsWith(`${MP}/preapproval_plan/search`)) {
            const all = [...mp.plans.values()];
            return { status: 200, body: JSON.stringify({ paging: { offset: 0, limit: 100, total: all.length }, results: all }) };
        }
        const pre = /\/preapproval\/([\w-]+)$/.exec(call.url);
        if (pre) {
            const row = mp.pre.get(pre[1]!);
            if (!row) return { status: 404, body: '{}' };
            if (call.method === 'PUT') {
                const body = JSON.parse(call.body!) as Record<string, unknown>;
                if (typeof body.status === 'string') row.status = body.status;
            }
            return { status: 200, body: JSON.stringify(row) };
        }
        if (call.url.startsWith(`${MP}/authorized_payments/search`)) {
            const id = new URL(call.url).searchParams.get('preapproval_id');
            const results = [...mp.invoices.values()].filter((i) => i.preapproval_id === id);
            return { status: 200, body: JSON.stringify({ results }) };
        }
        const pay = /\/v1\/payments\/(\d+)$/.exec(call.url);
        if (pay) {
            const row = mp.payments.get(pay[1]!);
            return row ? { status: 200, body: JSON.stringify(row) } : { status: 404, body: '{}' };
        }
        return { status: 404, body: '' };
    };
    return mp;
}

/** Una suscripción que ya existía en Mercado Pago (creada en su panel). */
function mpSub(
    mp: FakeMp,
    id: string,
    o: { email?: string | null; status?: string; amount?: number; plan?: string | null; reason?: string; ref?: string | null; paid?: boolean; created?: number; payerId?: number },
): void {
    mp.pre.set(id, {
        id,
        status: o.status ?? 'authorized',
        reason: o.reason ?? 'Hosting mensual',
        external_reference: o.ref ?? null,
        payer_email: o.email === undefined ? `${id}@clientes.test` : (o.email ?? ''),
        payer_id: o.payerId ?? 777,
        preapproval_plan_id: o.plan ?? null,
        date_created: iso(o.created ?? -60),
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: o.amount ?? 90000, currency_id: 'COP', start_date: iso(o.created ?? -60) },
        next_payment_date: iso(25),
        init_point: `https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=${id}`,
    });
    if (o.paid !== false && (o.status ?? 'authorized') === 'authorized') {
        const pid = String(5000 + mp.payments.size + 1);
        mp.invoices.set(`inv-${id}`, {
            id: `inv-${id}`,
            preapproval_id: id,
            status: 'processed',
            debit_date: iso(-5),
            date_created: iso(-5),
            last_modified: iso(-5),
            retry_attempt: 0,
            transaction_amount: o.amount ?? 90000,
            currency_id: 'COP',
            payment: { id: Number(pid), status: 'approved', status_detail: 'accredited' },
        });
        mp.payments.set(pid, { id: Number(pid), status: 'approved', payer: { email: o.email === undefined ? `${id}@clientes.test` : (o.email ?? 'pagador@desde-el-pago.test') } });
    }
}

describe('Importar suscripciones de Mercado Pago (v0.1.376)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let subs: SubscriptionsService;
    let importer: SubscriptionImportService;
    let fieldsService: FieldsService;
    let listsService: ListsService;
    let dispatcher: CapturingDispatcher;
    let tenantId: number;
    let adminId: number;
    const admin = { userId: 0, role: 'admin' as const };

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env));
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        dispatcher = new CapturingDispatcher();
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        collections = new CollectionsService(tenantDb, pg.db, env, connectors, listsService, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsService);
        const recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsService, fieldsService, rt, activity, dispatcher, new RelationsRepository());
        const plansSvc = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansSvc, new EmailQuotaService(pg.db, plansSvc), new TenantSmtpService(pg.db, env));
        const automationsSvc = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsService, new AutomationScheduler(), new FakeHookStore(), connectors);
        const blueprints = new BlueprintService(
            tenantDb,
            listsService,
            fieldsService,
            new ViewsService(tenantDb, new ViewsRepository(), listsService, rt),
            automationsSvc,
            new RecordsRepository(),
            new RelationsRepository(),
            billing,
            rt,
            new DashboardsService(tenantDb, null as never, null as never, null as never),
        );
        const moduleRef = {
            get: (token: unknown) => (token === RecordsService ? recordsSvc : token === BlueprintService ? blueprints : undefined),
        };
        const chargeLog = new SubscriptionChargeLogService(tenantDb, listsService, new RecordsRepository(), activity, rt, audit, fieldsService, undefined, undefined, moduleRef as never);
        subs = new SubscriptionsService(
            tenantDb,
            pg.db,
            env,
            connectors,
            listsService,
            new RecordsRepository(),
            activity,
            rt,
            dispatcher,
            audit,
            collections,
            fieldsService,
            undefined,
            undefined,
            undefined,
            chargeLog,
        );
        subs.onModuleInit();
        importer = new SubscriptionImportService(tenantDb, pg.db, env, connectors, listsService, subs, audit, rt, fieldsService, chargeLog, undefined, undefined, moduleRef as never);
        importer.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        admin.userId = adminId;
    });

    afterAll(async () => {
        subs?.onApplicationShutdown();
        importer?.onApplicationShutdown();
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 404, body: '' });
        dispatcher.events.length = 0;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(subscriptionCharges).where(eq(subscriptionCharges.tenantId, tenantId));
            await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
            await tx.delete(subscriptionPlans).where(eq(subscriptionPlans.tenantId, tenantId));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(dashboards).where(eq(dashboards.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
            await tx.delete(connections).where(eq(connections.tenantId, tenantId));
        });
    });

    async function connectMp(): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        return connection.id;
    }

    async function recordsOf(listId: number): Promise<Array<Record<string, unknown>>> {
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        return rows.map((r) => r.data as Record<string, unknown>);
    }

    async function hookToken(connectionId: number): Promise<string> {
        const url = await collections.hookUrlFor(tenantId, connectionId, 'mercadopago');
        return url.split('/').pop()!;
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: decidir qué se trae, la búsqueda, los planes, la prueba gratis y las cuotas', () => {
        const base = { known: false, status: 'authorized' as const, includeCancelled: false, ours: false, mode: 'match' as const, email: 'a@b.co', match: null, createMissing: true };
        expect(decideImport({ ...base, known: true }).action).toBe('known');
        expect(decideImport({ ...base, ours: true }).action).toBe('skip');
        expect(decideImport({ ...base, status: 'cancelled' }).action).toBe('skip');
        expect(decideImport({ ...base, status: 'cancelled', includeCancelled: true }).action).toBe('create_record');
        expect(decideImport({ ...base, match: { recordId: 1, hasLive: false } }).action).toBe('link');
        expect(decideImport({ ...base, match: { recordId: 1, hasLive: true } }).action).toBe('no_record');
        expect(decideImport({ ...base, createMissing: false }).action).toBe('no_record');
        expect(decideImport({ ...base, mode: 'create' }).action).toBe('create_record');

        expect(mpTrialDays(1, 'months')).toBe(30);
        expect(mpTrialDays(7, 'days')).toBe(7);
        expect(mpTrialDays(null, 'days')).toBe(0);
        expect(mpFrequency(24, 'months')).toEqual({ frequency: 12, frequency_type: 'months' });
        expect(mpFrequency('15', 'days')).toEqual({ frequency: 15, frequency_type: 'days' });

        const s = new Date('2026-01-01T05:00:00Z');
        // 12 cuotas: el fin que pone la app (inicio + 12 períodos − 1 h) cuenta 12.
        expect(cyclesBetween(s, new Date('2027-01-01T04:00:00Z'), 1, 'months')).toBe(12);

        const page = parsePreapprovalSearch(
            200,
            JSON.stringify({
                paging: { total: 2 },
                results: [
                    { id: 'p1', status: 'authorized', payer_email: ' Ana@X.co ', payer_id: 5, reason: 'Plan', preapproval_plan_id: 'pl1', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 10, currency_id: 'cop' } },
                    { id: 'p2', status: 'finished', payer_email: '', auto_recurring: { frequency: 30, frequency_type: 'days', transaction_amount: 5, currency_id: 'COP' } },
                ],
            }),
            { secret: 'APP_USR-x' } as never,
        );
        expect(page?.total).toBe(2);
        expect(page?.items[0]).toMatchObject({ externalId: 'p1', mpStatus: 'authorized', payerEmail: 'ana@x.co', planExternalId: 'pl1', currency: 'COP' });
        expect(page?.items[1]).toMatchObject({ mpStatus: 'cancelled', payerEmail: null, frequency: 30, frequencyType: 'days' });
        expect(parsePreapprovalSearch(401, '{}', { secret: 'x' } as never)).toBeNull();

        const plans = parsePreapprovalPlans(
            200,
            JSON.stringify({
                results: [
                    { id: 'pl1', reason: 'Hosting', status: 'active', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 90000, currency_id: 'COP', repetitions: 12, free_trial: { frequency: 1, frequency_type: 'months' } } },
                    { id: 'pl2', reason: 'Viejo', status: 'cancelled', auto_recurring: { frequency: 3, frequency_type: 'months' } },
                ],
            }),
        );
        expect(plans?.items[0]).toMatchObject({ externalId: 'pl1', amount: 90000, cycles: 12, trialDays: 30, active: true });
        expect(plans?.items[1]).toMatchObject({ amount: null, frequency: 3, active: false });

        // Migrar la empresa: la lista y la columna de correo se re-mapean; sin lista, deja de traer.
        const maps = emptyMaps();
        maps.list.set(10, 99);
        maps.field.set(20, 77);
        const cfg = { subscription_import: { mode: 'match', list_id: 10, email_field_id: 20, create_missing: true, auto: true, since: 'x', last_scan_at: null } };
        expect(remapWhatsappConnectionConfig('mercadopago', cfg, maps)).toEqual({ subscription_import: { ...cfg.subscription_import, list_id: 99, email_field_id: 77 } });
        expect(remapWhatsappConnectionConfig('mercadopago', { subscription_import: { ...cfg.subscription_import, list_id: 11 } }, maps)).toMatchObject({
            subscription_import: { list_id: null, auto: false },
        });
    });

    // ── Lista nueva ─────────────────────────────────────────────────────

    it('vista previa + importar a una lista nueva: columnas, planes, cobros, sin duplicar y sin disparar automatizaciones', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        mp.plans.set('pl-hosting', {
            id: 'pl-hosting',
            reason: 'Hosting mensual',
            status: 'active',
            auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 90000, currency_id: 'COP' },
        });
        mpSub(mp, 'a1', { email: 'Ana@Clientes.test', plan: 'pl-hosting' });
        mpSub(mp, 'a2', { email: 'beto@clientes.test', plan: 'pl-hosting' });
        mpSub(mp, 'a3', { email: null, reason: 'Soporte', amount: 50000 }); // sin correo: sale del pago
        mpSub(mp, 'p1', { status: 'paused', email: 'pausa@clientes.test' });
        mpSub(mp, 'n1', { status: 'pending', email: 'pendiente@clientes.test', paid: false });
        mpSub(mp, 'c1', { status: 'cancelled', email: 'baja@clientes.test' });
        mpSub(mp, 'ours', { email: 'nuestra@clientes.test', ref: 'ibs_abcdef' });

        const preview = await importer.preview(tenantId, admin, connId, { mode: 'create', create_missing: true, include_cancelled: false, include_pending: true, charge_log: true, dashboard: true, auto: true });
        expect(preview).toMatchObject({ total: 7, known: 0, to_import: 5, skipped_cancelled: 1, without_email: 1, match: null, truncated: false });
        expect(preview.by_status).toMatchObject({ authorized: 4, paused: 1, pending: 1, cancelled: 1 });
        expect(preview.plans).toEqual([expect.objectContaining({ external_id: 'pl-hosting', subscribers: 2, known: false })]);
        expect(preview.sample.find((x) => x.external_id === 'ours')).toMatchObject({ action: 'skip' });

        const started = await importer.start(tenantId, admin, connId, { mode: 'create', create_missing: true, include_cancelled: false, include_pending: true, charge_log: true, dashboard: true, auto: true });
        expect(started.state).toBe('running');
        const done = await importer.waitFor(tenantId, connId);
        expect(done).toMatchObject({ state: 'done', total: 5, imported: 5, records_created: 5, failed: 0, plans_imported: 1, list_name: 'Suscriptores · Mercado Pago' });
        expect(done.charge_log_list_id).not.toBeNull();
        expect(done.dashboard_id).not.toBeNull();
        expect(done.config).toMatchObject({ mode: 'create', auto: true });

        const [list] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(lists).where(eq(lists.id, done.list_id!)));
        const mapping = readSubscriptionFields(list!.settings)!;
        expect(mapping.status).not.toBeNull();
        const rows = await recordsOf(done.list_id!);
        expect(rows).toHaveLength(5);
        const ana = rows.find((r) => Object.values(r).includes('ana@clientes.test'))!;
        expect(ana[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.active.value);
        expect(ana[`f${mapping.plan}`]).toBe('Hosting mensual');
        // El correo que la búsqueda no trajo, sacado de su último pago.
        expect(rows.some((r) => Object.values(r).includes('pagador@desde-el-pago.test'))).toBe(true);
        const paused = rows.find((r) => Object.values(r).includes('pausa@clientes.test'))!;
        expect(paused[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.paused.value);
        const pending = rows.find((r) => Object.values(r).includes('pendiente@clientes.test'))!;
        expect(pending[`f${mapping.link}`]).toContain('preapproval_id=n1');

        const subRows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
        expect(subRows).toHaveLength(5);
        const [plan] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.tenantId, tenantId)));
        expect(plan).toMatchObject({ name: 'Hosting mensual', amount: 90000, providerRefs: { mp_plan_id: 'pl-hosting' } });
        expect(subRows.filter((r) => r.planId === plan!.id)).toHaveLength(2);
        // Los cobros que ya existían quedaron, y en el registro de cobros.
        const charges = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.tenantId, tenantId)));
        // a1, a2 y a3 (la «nuestra» no se trae y la pausada no tenía cobros).
        expect(charges).toHaveLength(3);
        expect((await recordsOf(done.charge_log_list_id!)).length).toBe(3);
        // Lo que ya existía no dispara nada (nadie quiere 5 «Se activó» al importar).
        expect(dispatcher.events).toHaveLength(0);

        // Importar otra vez no duplica: todo es «ya está en la app».
        const again = await importer.preview(tenantId, admin, connId, { mode: 'create', create_missing: true, include_cancelled: false, include_pending: true, charge_log: false, dashboard: false, auto: true });
        expect(again).toMatchObject({ known: 5, to_import: 0 });
        expect(again.plans[0]!.known).toBe(true);
    });

    // ── Lista existente ─────────────────────────────────────────────────

    it('vincular por correo con una lista existente: los que están, los que faltan y el que ya tenía una viva', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const list = await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        const nombre = await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        const email = await fieldsService.create(tenantId, 'clientes', { label: 'Correo', type: 'email' });
        const [sol] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({ tenantId, listId: list.id, data: { [`f${nombre.id}`]: 'Panadería Sol', [`f${email.id}`]: 'Pagos@PanaderiaSol.test' }, createdBy: adminId })
                .returning(),
        );
        const [luna] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({ tenantId, listId: list.id, data: { [`f${nombre.id}`]: 'Café Luna', [`f${email.id}`]: 'hola@cafeluna.test' }, createdBy: adminId })
                .returning(),
        );
        // Café Luna ya tiene una suscripción viva creada desde la app.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(subscriptions).values({
                tenantId,
                connectionId: connId,
                provider: 'mercadopago',
                listId: list.id,
                recordId: luna!.id,
                externalId: 'de-la-app',
                reference: 'ibs_de_la_app',
                title: 'Plan',
                amount: 1,
                currency: 'COP',
                status: 'active',
            }),
        );
        mpSub(mp, 'm1', { email: 'pagos@panaderiasol.test' });
        mpSub(mp, 'm2', { email: 'nuevo@cliente.test' });
        mpSub(mp, 'm3', { email: 'HOLA@cafeluna.test' });

        const input = { mode: 'match' as const, list_id: list.id, email_field_id: email.id, create_missing: true, include_cancelled: false, include_pending: true, charge_log: false, dashboard: false, auto: false };
        const preview = await importer.preview(tenantId, admin, connId, input);
        expect(preview.match).toMatchObject({ list_name: 'Clientes', matched: 1, unmatched: 1, conflicts: 1 });
        expect(preview.sample.find((x) => x.external_id === 'm1')).toMatchObject({ action: 'link', record_title: 'Panadería Sol' });

        await importer.start(tenantId, admin, connId, input);
        const done = await importer.waitFor(tenantId, connId);
        expect(done).toMatchObject({ state: 'done', imported: 3, linked: 1, records_created: 1, without_record: 1 });
        const linked = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.externalId, 'm1'))),
        );
        expect(linked[0]).toMatchObject({ recordId: sol!.id, listId: list.id, status: 'active' });
        const conflict = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.externalId, 'm3'))),
        );
        expect(conflict[0]).toMatchObject({ recordId: null, listId: null });
        // La lista ganó las columnas de la suscripción y el cliente nuevo su registro.
        const mapping = (await subs.getFields(tenantId, 'clientes'))!;
        const rows = await recordsOf(list.id);
        expect(rows).toHaveLength(3);
        expect(rows.find((r) => r[`f${email.id}`] === 'pagos@panaderiasol.test' || r[`f${email.id}`] === 'Pagos@PanaderiaSol.test')![`f${mapping.status}`]).toBe(
            SUBSCRIPTION_STATUS_OPTIONS.active.value,
        );
        expect(rows.some((r) => r[`f${email.id}`] === 'nuevo@cliente.test')).toBe(true);
    });

    // ── Las nuevas, solas ───────────────────────────────────────────────

    it('las nuevas llegan solas: por el aviso (dispara «Se activó») y por la revisión periódica; apagado no trae nada', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        mpSub(mp, 'old1', { email: 'vieja@clientes.test' });
        mpSub(mp, 'oldc', { status: 'cancelled', email: 'baja-vieja@clientes.test', created: -200 });
        await importer.start(tenantId, admin, connId, { mode: 'create', create_missing: true, include_cancelled: false, include_pending: true, charge_log: false, dashboard: false, auto: true });
        const first = await importer.waitFor(tenantId, connId);
        expect(first.imported).toBe(1);
        dispatcher.events.length = 0;

        // Alguien crea una suscripción en el panel de Mercado Pago y llega el aviso.
        mpSub(mp, 'new1', { email: 'nueva@clientes.test', created: 0 });
        const token = await hookToken(connId);
        expect(await collections.handleHook(token, {}, { type: 'subscription_preapproval', data: { id: 'new1' } })).toBe('applied');
        const rows = await recordsOf(first.list_id!);
        expect(rows.some((r) => Object.values(r).includes('nueva@clientes.test'))).toBe(true);
        expect(dispatcher.events.filter((e) => e.trigger === 'subscription_event').map((e) => e.subscription?.evento)).toContain('activated');
        // La que crea la app (`ibs_…`) nunca se importa por un aviso.
        mpSub(mp, 'mine', { email: 'mia@clientes.test', ref: 'ibs_en_curso' });
        expect(await collections.handleHook(token, {}, { type: 'subscription_preapproval', data: { id: 'mine' } })).toBe('ignored');

        // Sin aviso: la revisión periódica la encuentra. La cancelada vieja no vuelve.
        mpSub(mp, 'new2', { email: 'otra@clientes.test', created: 0 });
        expect(await importer.scanConnection(tenantId, connId)).toBe(1);
        const after = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
        expect(after.map((s) => s.externalId).sort()).toEqual(['new1', 'new2', 'old1']);
        const status = await importer.status(tenantId, admin, connId);
        expect(status.auto_imported).toBe(2);

        // Apagado: ni el aviso ni la revisión traen nada.
        await importer.setAuto(tenantId, admin, connId, false);
        mpSub(mp, 'new3', { email: 'tercera@clientes.test', created: 0 });
        expect(await collections.handleHook(token, {}, { type: 'subscription_preapproval', data: { id: 'new3' } })).toBe('ignored');
        expect(await importer.scanConnection(tenantId, connId)).toBe(0);
        const [conn] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connId)));
        expect(readSubscriptionImportConfig(conn!.config)).toMatchObject({ auto: false });
    });

    it('permisos y errores: sólo quien crea listas importa, una credencial rechazada no crea nada y no corren dos a la vez', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        mpSub(mp, 'x1', { email: 'x@clientes.test' });
        const input = { mode: 'create' as const, create_missing: true, include_cancelled: false, include_pending: true, charge_log: false, dashboard: false, auto: true };
        await expect(importer.preview(tenantId, { userId: adminId, role: 'agent' }, connId, input)).rejects.toThrow(/crear listas/);

        // Mercado Pago rechaza el token: error claro y ninguna lista creada.
        const prev = net.handler;
        net.handler = (call) => (call.url.startsWith(`${MP}/preapproval/search`) ? { status: 401, body: '{}' } : prev(call));
        await expect(importer.start(tenantId, admin, connId, input)).rejects.toThrow(/Access Token/);
        const none = await withTenant(pg.db, tenantId, (tx) => tx.select().from(lists).where(eq(lists.tenantId, tenantId)));
        expect(none).toHaveLength(0);
        net.handler = prev;

        // Una a la vez por conexión (el candado se suelta al terminar).
        await importer.start(tenantId, admin, connId, input);
        await expect(importer.start(tenantId, admin, connId, input)).rejects.toThrow(/en curso/);
        await importer.waitFor(tenantId, connId);
        await expect(importer.start(tenantId, admin, connId, input)).resolves.toMatchObject({ state: 'running' });
        await importer.waitFor(tenantId, connId);
    });

    // ── v0.1.380: el caso real (sin correo, sin cuotas, varias por cliente) ──

    it('v0.1.380 — piezas puras: nombre y resumen de la búsqueda, quién pagó y el cobro del resumen', () => {
        const creds = { secret: 'APP_USR-x', fields: {} } as never;
        const page = parsePreapprovalSearch(
            200,
            JSON.stringify({
                results: [
                    {
                        id: 'a',
                        status: 'authorized',
                        payer_id: 261317178,
                        payer_email: '',
                        payer_first_name: ' Ana ',
                        payer_last_name: 'Gómez',
                        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 86000, currency_id: 'COP' },
                        summarized: { charged_quantity: 8, last_charged_date: '2026-10-14T10:00:00.000-04:00', last_charged_amount: 86000, semaphore: 'green' },
                    },
                    { id: 'b', status: 'pending', payer_id: 1, payer_first_name: 'null', payer_last_name: '' },
                ],
            }),
            creds,
        )!;
        expect(page.items[0]).toMatchObject({ payerName: 'Ana Gómez', payerEmail: null, payerId: '261317178', summary: { chargedQuantity: 8, lastChargedAmount: 86000, semaphore: 'green' } });
        expect(page.items[0]!.summary!.lastChargedDate!.toISOString()).toBe('2026-10-14T14:00:00.000Z');
        expect(page.items[1]).toMatchObject({ payerName: null, summary: null });
        expect(mpPayerName('A', null)).toBeNull();

        expect(readPaymentPayer({ payer: { email: 'Ana@X.co', first_name: null }, card: { cardholder: { name: 'ANA M GOMEZ' } } })).toEqual({ email: 'ana@x.co', name: 'ANA M GOMEZ' });
        expect(readPaymentPayer({ payer: {}, additional_info: { payer: { first_name: 'Beto', last_name: 'Ruiz' } } })).toEqual({ email: null, name: 'Beto Ruiz' });
        expect(readPaymentPayer(null)).toEqual({ email: null, name: null });

        const id = summaryChargeId(new Date('2026-10-14T14:00:00Z'));
        expect(id).toBe('mp-resumen-2026-10-14');
        expect(isSummaryCharge(id)).toBe(true);
        expect(isSummaryCharge('9001')).toBe(false);
        expect(sameChargeDay(new Date('2026-10-14T14:00:00Z'), new Date('2026-10-16T09:00:00Z'))).toBe(true);
        expect(sameChargeDay(new Date('2026-10-14T14:00:00Z'), new Date('2026-11-14T14:00:00Z'))).toBe(false);
        expect(sameChargeDay(null, new Date())).toBe(false);
    });

    it('v0.1.380 — sin correo ni cuotas: el nombre de Mercado Pago, el estado por su resumen, el último cobro y las «Por autorizar» fuera', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const lastCharged = new Date(Date.now() - 21 * DAY);
        // La de Ana: paga hace 8 meses, Mercado Pago no da su correo ni entrega las cuotas.
        mpSub(mp, 'vps', { email: '', amount: 86000, created: -245, payerId: 261317178, paid: false });
        Object.assign(mp.pre.get('vps')!, {
            payer_first_name: 'Ana',
            payer_last_name: 'Gómez',
            next_payment_date: iso(9),
            summarized: { charged_quantity: 8, charged_amount: 688000, last_charged_date: lastCharged.toISOString(), last_charged_amount: 86000, semaphore: 'green' },
        });
        // Una vieja de la misma persona, cancelada, y un pago que nadie terminó.
        mpSub(mp, 'vps-vieja', { email: '', status: 'cancelled', payerId: 261317178, paid: false });
        mpSub(mp, 'abandonada', { email: '', status: 'pending', payerId: 27610642, paid: false });
        const base = net.handler;
        let rejectInvoices = true;
        net.handler = (call) =>
            rejectInvoices && call.url.startsWith(`${MP}/authorized_payments/search`)
                ? { status: 400, body: JSON.stringify({ message: 'invalid parameters', error: 'bad_request', status: 400 }) }
                : base(call);

        const input = { mode: 'create' as const, create_missing: true, include_cancelled: false, include_pending: false, charge_log: true, dashboard: false, auto: true };
        const preview = await importer.preview(tenantId, admin, connId, input);
        expect(preview).toMatchObject({ to_import: 1, skipped_pending: 1, skipped_cancelled: 1 });
        expect(preview.sample.find((x) => x.external_id === 'vps')).toMatchObject({ title: 'Ana Gómez', action: 'create_record' });

        await importer.start(tenantId, admin, connId, input);
        const done = await importer.waitFor(tenantId, connId);
        expect(done).toMatchObject({ state: 'done', imported: 1, records_created: 1 });

        // El suscriptor se llama como en Mercado Pago, y la lista trae «Por cliente».
        const [list] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(lists).where(eq(lists.id, done.list_id!)));
        const titleKey = `f${(list!.settings as { title_field_id: number }).title_field_id}`;
        const [row] = await recordsOf(done.list_id!);
        expect(row![titleKey]).toBe('Ana Gómez');
        const views = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(eq(savedViews.listId, done.list_id!)));
        expect(views.find((v) => v.name === 'Por cliente')?.config).toMatchObject({ group_by_field_id: (list!.settings as { title_field_id: number }).title_field_id });

        // Al día (antes: «Vencida»), pagado hasta el último cobro + un mes, 8 cobros.
        const [sub] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.externalId, 'vps')));
        expect(sub).toMatchObject({ status: 'active', chargesPaid: 8 });
        expect(sub!.paidUntil?.toISOString().slice(0, 10)).toBe(addSubscriptionPeriod(lastCharged, 1, 'months').toISOString().slice(0, 10));
        const charges = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.subscriptionId, sub!.id)));
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({ status: 'approved', amount: 86000, method: 'Según el resumen de Mercado Pago' });
        expect(charges[0]!.providerPaymentId.startsWith('mp-resumen-')).toBe(true);
        // Ese cobro queda en «Cobros de suscripciones».
        expect((await recordsOf(done.charge_log_list_id!)).length).toBe(1);
        // Y lo que respondió Mercado Pago al pedir las cuotas queda a la vista.
        const overview = await subs.overview(tenantId, admin, connId);
        expect(overview.invoice_read).toBeNull(); // sin Redis en el test: no se guarda
        expect(net.calls.filter((c) => c.url.includes('/authorized_payments/search') && !c.url.includes('limit=')).length).toBeGreaterThan(0);

        // Mercado Pago empieza a entregar la cuota real de esa fecha: el MISMO cobro
        // pasa a llevar su id de pago (no se duplica en la lista de cobros).
        rejectInvoices = false;
        mp.invoices.set('inv-vps', {
            id: 'inv-vps',
            preapproval_id: 'vps',
            status: 'processed',
            debit_date: lastCharged.toISOString(),
            date_created: lastCharged.toISOString(),
            last_modified: lastCharged.toISOString(),
            retry_attempt: 0,
            transaction_amount: 86000,
            currency_id: 'COP',
            payment: { id: 9001, status: 'approved', status_detail: 'accredited' },
        });
        await subs.sync(tenantId, sub!.id);
        const after = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.subscriptionId, sub!.id)));
        expect(after.map((c) => c.providerPaymentId)).toEqual(['9001']);
        expect((await recordsOf(done.charge_log_list_id!)).length).toBe(1);

        // Una importación anterior (con el título provisorio) se completa sola en
        // la revisión periódica; un nombre escrito a mano no se toca.
        mpSub(mp, 'vieja-import', { email: '', amount: 30000, payerId: 555 });
        mpSub(mp, 'a-mano', { email: '', amount: 30000, payerId: 556 });
        Object.assign(mp.pre.get('vieja-import')!, { payer_first_name: 'Carlos', payer_last_name: 'Ruiz' });
        Object.assign(mp.pre.get('a-mano')!, { payer_first_name: 'Dora', payer_last_name: 'Paz' });
        net.handler = (call) =>
            call.url.startsWith(`${MP}/preapproval/search`)
                ? {
                      status: 200,
                      body: JSON.stringify({
                          results: [...mp.pre.values()].map((p) => ({ ...p, payer_first_name: undefined, payer_last_name: undefined })),
                          paging: { total: mp.pre.size },
                      }),
                  }
                : base(call);
        expect(await importer.scanConnection(tenantId, connId)).toBe(2);
        const titles = () => recordsOf(done.list_id!).then((rs) => rs.map((r) => r[titleKey]).sort());
        expect(await titles()).toEqual(['Ana Gómez', 'Cliente de Mercado Pago #555', 'Cliente de Mercado Pago #556']);
        const [manual] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.externalId, 'a-mano'))),
        );
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(records)
                .set({ data: sql`jsonb_set(${records.data}, ${`{${titleKey}}`}, '"Doña Dora (la de la esquina)"')` })
                .where(eq(records.id, manual!.recordId!)),
        );
        net.handler = base;
        await withTenant(pg.db, tenantId, (tx) => tx.update(connections).set({ config: sql`jsonb_set(${connections.config}, '{subscription_import,last_scan_at}', 'null')` }).where(eq(connections.id, connId)));
        await importer.scanConnection(tenantId, connId);
        expect(await titles()).toEqual(['Ana Gómez', 'Carlos Ruiz', 'Doña Dora (la de la esquina)']);
    });
});
