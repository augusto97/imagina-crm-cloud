import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_STATUS_OPTIONS } from '@imagina-base/shared';

/**
 * v0.1.367 (ADR-S96) — Suscripciones de las empresas con Mercado Pago, de
 * punta a punta con Postgres real. La API de Mercado Pago se simula en el
 * borde de red (`safeWebhookFetch`) con memoria (suscripciones, cuotas y
 * pagos), así el test ejercita TODO lo nuestro: planes, crear la suscripción
 * desde un registro y desde una automatización, el estado que se recalcula
 * RELEYENDO a Mercado Pago (nunca con lo que dice el aviso), el mismo pago por
 * dos avisos, los reintentos, la mora, el vencimiento por días de gracia, el
 * «cancelar al vencer», las columnas de la lista y el disparador.
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
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { CollectionsService } from '../src/collections/collections.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import {
    automationRuns,
    automations,
    connections,
    fields,
    lists,
    records,
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
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { createPreapprovalRequest, mpNotice, summarizeCharges } from '../src/subscriptions/subscription-gateway';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';
const DAY = 24 * 60 * 60 * 1000;

class NullMail implements MailTransport {
    readonly name = 'null';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

/** Un Mercado Pago con memoria: suscripciones, cuotas (authorized payments) y pagos. */
interface FakeMp {
    pre: Map<string, Record<string, unknown>>;
    invoices: Map<string, Record<string, unknown>>;
    payments: Map<string, Record<string, unknown>>;
    puts: Array<{ id: string; body: Record<string, unknown> }>;
}

function fakeMercadoPago(): FakeMp {
    const mp: FakeMp = { pre: new Map(), invoices: new Map(), payments: new Map(), puts: [] };
    net.handler = (call) => {
        if (call.url === `${MP}/users/me`) {
            return call.headers?.authorization === 'Bearer APP_USR-buena'
                ? { status: 200, body: JSON.stringify({ id: 123, nickname: 'TIENDA_ACME', site_id: 'MCO' }) }
                : { status: 401, body: JSON.stringify({ message: 'invalid access token' }) };
        }
        if (call.url === `${MP}/preapproval` && call.method === 'POST') {
            const body = JSON.parse(call.body!) as Record<string, unknown>;
            const id = `pre-${mp.pre.size + 1}`;
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
                _headers: call.headers,
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
            const results = [...mp.invoices.values()].filter((i) => i.preapproval_id === id);
            return { status: 200, body: JSON.stringify({ results }) };
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
    return mp;
}

describe('Suscripciones de las empresas — Mercado Pago (v0.1.367)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let subs: SubscriptionsService;
    let fieldsService: FieldsService;
    let listsService: ListsService;
    let engine: AutomationEngine;
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
        subs = new SubscriptionsService(tenantDb, pg.db, env, connectors, listsService, new RecordsRepository(), activity, rt, dispatcher, audit, collections, fieldsService);
        subs.onModuleInit();
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NullMail()),
            connectors,
            undefined,
            undefined,
            undefined,
            collections,
        );
        engine.setSubscriptions(subs);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        admin.userId = adminId;
    });

    afterAll(async () => {
        subs?.onApplicationShutdown();
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
            await tx.delete(records).where(eq(records.tenantId, tenantId));
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

    /** Lista «Clientes» con nombre y correo + un registro. */
    async function seedClient(): Promise<{ listId: number; slug: string; recordId: number }> {
        const list = await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        const nombre = await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        const email = await fieldsService.create(tenantId, 'clientes', { label: 'Correo', type: 'email' });
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({ tenantId, listId: list.id, data: { [`f${nombre.id}`]: 'Panadería Sol', [`f${email.id}`]: 'Pagos@PanaderiaSol.test' }, createdBy: adminId })
                .returning(),
        );
        return { listId: list.id, slug: 'clientes', recordId: rec!.id };
    }

    async function recordData(listId: number, recordId: number): Promise<Record<string, unknown>> {
        const [r] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.listId, listId), eq(records.id, recordId))));
        return r!.data as Record<string, unknown>;
    }

    async function hookToken(connectionId: number): Promise<string> {
        const url = await collections.hookUrlFor(tenantId, connectionId, 'mercadopago');
        return url.split('/').pop()!;
    }

    async function plan(connectionId: number, extra: Record<string, unknown> = {}) {
        return subs.createPlan(tenantId, admin, {
            connection_id: connectionId,
            name: 'Mantenimiento mensual',
            description: null,
            amount: 150000,
            currency: 'COP',
            frequency: 1,
            frequency_type: 'months',
            cycles: null,
            trial_days: 0,
            grace_days: 10,
            on_expire: 'mark',
            ...extra,
        } as Parameters<SubscriptionsService['createPlan']>[2]);
    }

    /** Autoriza la suscripción en el Mercado Pago simulado y agrega una cuota. */
    function authorize(mp: FakeMp, preId: string, nextPayment: string): void {
        const row = mp.pre.get(preId)!;
        row.status = 'authorized';
        row.next_payment_date = nextPayment;
    }
    function invoice(mp: FakeMp, id: string, preId: string, o: { status: string; paymentId?: number; paymentStatus?: string; detail?: string; debit: string; retry?: number }): void {
        mp.invoices.set(id, {
            id,
            preapproval_id: preId,
            status: o.status,
            debit_date: o.debit,
            date_created: o.debit,
            last_modified: o.debit,
            retry_attempt: o.retry ?? 0,
            transaction_amount: 150000,
            currency_id: 'COP',
            payment: o.paymentId ? { id: o.paymentId, status: o.paymentStatus, status_detail: o.detail ?? null } : null,
        });
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: el pedido a Mercado Pago, los avisos y el resumen de cuotas', () => {
        const now = new Date('2026-11-05T12:00:00Z');
        const req = createPreapprovalRequest(
            { secret: 'APP_USR-x', accessToken: '', fields: {} } as never,
            {
                reference: 'ibs_abc',
                title: 'Plan',
                payerEmail: 'a@b.co',
                amount: 99.999,
                currency: 'cop',
                frequency: 1,
                frequencyType: 'months',
                startAt: new Date('2026-12-01T05:00:00Z'),
                cycles: 12,
                backUrl: 'https://app/x',
            },
            { mercadopago: MP } as never,
            now,
        );
        expect(req.headers['x-idempotency-key']).toBe('ibs_abc');
        const body = JSON.parse(req.body!) as { auto_recurring: Record<string, unknown>; status: string; external_reference: string };
        expect(body.status).toBe('pending');
        expect(body.external_reference).toBe('ibs_abc');
        expect(body.auto_recurring).toMatchObject({ transaction_amount: 100, currency_id: 'COP', start_date: '2026-12-01T05:00:00.000Z' });
        // 12 cuotas desde el 1-dic: la última cubre noviembre del año siguiente.
        expect(String(body.auto_recurring.end_date)).toMatch(/^2027-12-01T0[34]/);
        // Una fecha pasada no se manda (Mercado Pago la rechaza): cobra al autorizar.
        const past = createPreapprovalRequest(
            { secret: 'APP_USR-x' } as never,
            { reference: 'r', title: 't', payerEmail: 'a@b.co', amount: 1, currency: 'COP', frequency: 1, frequencyType: 'months', startAt: new Date('2026-01-01'), cycles: null, backUrl: 'x' },
            { mercadopago: MP } as never,
            now,
        );
        expect((JSON.parse(past.body!) as { auto_recurring: Record<string, unknown> }).auto_recurring.start_date).toBeUndefined();

        expect(mpNotice({}, { type: 'subscription_preapproval', data: { id: 'pre-1' } })).toEqual({ topic: 'subscription_preapproval', id: 'pre-1' });
        expect(mpNotice({ topic: 'authorized_payment', id: '77' }, {})).toEqual({ topic: 'subscription_authorized_payment', id: '77' });
        expect(mpNotice({}, { type: 'payment', data: { id: '1;drop' } })).toBeNull();
        expect(mpNotice({}, { type: 'merchant_order', data: { id: '1' } })).toBeNull();

        const d = (s: string) => new Date(s);
        const sum = summarizeCharges(
            [
                { invoiceId: 'i1', providerPaymentId: '1', status: 'approved', periodStart: d('2026-08-05'), paidAt: d('2026-08-05'), createdAt: d('2026-08-05'), failureReason: null },
                { invoiceId: 'i2', providerPaymentId: '2', status: 'rejected', periodStart: d('2026-09-05'), paidAt: null, createdAt: d('2026-09-05'), failureReason: 'fondos insuficientes' },
                { invoiceId: 'i2', providerPaymentId: '3', status: 'approved', periodStart: d('2026-09-05'), paidAt: d('2026-09-07'), createdAt: d('2026-09-07'), failureReason: null },
                { invoiceId: 'i3', providerPaymentId: '4', status: 'rejected', periodStart: d('2026-10-05'), paidAt: null, createdAt: d('2026-10-05'), failureReason: 'tarjeta vencida' },
            ],
            { frequency: 1, frequencyType: 'months', retryingInvoiceId: 'i3' },
        );
        // Dos cuotas pagadas (la 2 al reintento), la 3 se está reintentando: no cuenta como fallida.
        expect(sum).toMatchObject({ chargesPaid: 2, chargesFailed: 0, consecutiveFailed: 0, lastChargeStatus: 'rejected', lastFailureReason: 'tarjeta vencida' });
        expect(sum.paidUntil?.toISOString().slice(0, 10)).toBe('2026-10-05');
    });

    // ── Planes ──────────────────────────────────────────────────────────

    it('planes: se crean sólo con Mercado Pago, se listan con sus suscriptores y no se borran en uso', async () => {
        fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId);
        expect(p).toMatchObject({ name: 'Mantenimiento mensual', amount: 150000, frequency_type: 'months', subscribers: { live: 0, total: 0 } });
        expect((await subs.listPlans(tenantId, admin)).map((x) => x.id)).toEqual([p.id]);
        await expect(plan(connId, { frequency: 13 })).rejects.toThrow();

        const c = await seedClient();
        await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@panaderiasol.test' });
        expect((await subs.listPlans(tenantId, admin))[0]!.subscribers).toEqual({ live: 1, total: 1 });
        await expect(subs.deletePlan(tenantId, admin, p.id)).rejects.toThrow(/suscrip/i);
        const paused = await subs.updatePlan(tenantId, admin, p.id, { active: false, grace_days: 5 });
        expect(paused.active).toBe(false);
        // Los días de gracia valen también para la suscripción que ya existe.
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
        expect(row!.graceDays).toBe(5);
    });

    // ── De punta a punta ────────────────────────────────────────────────

    it('suscribir desde la ficha: el pedido, el link en la columna, la autorización y el primer cobro por dos avisos', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId);
        const c = await seedClient();
        const mapping = await subs.setupFields(tenantId, admin, c.slug);
        expect(mapping.status).not.toBeNull();
        expect(mapping.link).not.toBeNull();

        const panel = await subs.recordSubscriptions(tenantId, admin, c.slug, c.recordId);
        expect(panel.suggested).toMatchObject({ title: 'Panadería Sol', payer_email: 'Pagos@PanaderiaSol.test' });
        expect(panel.plans.map((x) => x.id)).toEqual([p.id]);

        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'Pagos@PanaderiaSol.test', amount: 120000 });
        expect(sub).toMatchObject({ status: 'pending', amount: 120000, payer_email: 'pagos@panaderiasol.test' });
        expect(sub.url).toContain('preapproval_id=pre-1');
        const sent = mp.pre.get('pre-1')!;
        expect(sent).toMatchObject({ payer_email: 'pagos@panaderiasol.test', reason: 'Mantenimiento mensual' });
        expect(sent.auto_recurring).toMatchObject({ frequency: 1, frequency_type: 'months', transaction_amount: 120000, currency_id: 'COP' });
        expect(String(sent.back_url)).toMatch(/^https:\/\/app\.imagina\.test\/api\/v1\/public\/subscriptions\/ibs_/);
        let data = await recordData(c.listId, c.recordId);
        expect(data[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.pending.value);
        expect(data[`f${mapping.link}`]).toBe(sub.url);

        // Una sola por registro: otra mientras está pendiente REEMPLAZA (la vieja se cancela en Mercado Pago).
        const again = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@panaderiasol.test' });
        expect(mp.puts).toContainEqual({ id: 'pre-1', body: { status: 'cancelled' } });
        expect(again.url).toContain('pre-2');

        // El cliente autoriza y Mercado Pago cobra la primera cuota.
        authorize(mp, 'pre-2', '2026-12-05T12:00:00.000-05:00');
        invoice(mp, 'inv-1', 'pre-2', { status: 'processed', paymentId: 9001, paymentStatus: 'approved', debit: '2026-11-05T12:00:00.000-05:00' });
        mp.payments.set('9001', { id: 9001, status: 'approved', transaction_amount: 150000, currency_id: 'COP', payment_type_id: 'credit_card', payment_method_id: 'visa', date_approved: '2026-11-05T17:00:00Z', metadata: { preapproval_id: 'pre-2' } });

        const token = await hookToken(connId);
        expect(await collections.handleHook(token, {}, { type: 'subscription_preapproval', data: { id: 'pre-2' } })).toBe('applied');
        // El MISMO pago por los dos avisos: una sola fila de cobro.
        expect(await collections.handleHook(token, {}, { type: 'payment', data: { id: '9001' } })).toBe('applied');
        expect(await collections.handleHook(token, {}, { type: 'subscription_authorized_payment', data: { id: 'inv-1' } })).toBe('applied');
        const charges = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptionCharges).where(eq(subscriptionCharges.tenantId, tenantId)));
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({ status: 'approved', providerPaymentId: '9001', invoiceId: 'inv-1', method: 'Tarjeta de crédito' });

        const view = await subs.recordSubscriptions(tenantId, admin, c.slug, c.recordId);
        const live = view.subscriptions[0]!;
        expect(live).toMatchObject({ status: 'active', charges_paid: 1, url: null });
        expect(live.paid_until?.slice(0, 10)).toBe('2026-12-05');
        data = await recordData(c.listId, c.recordId);
        expect(data[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.active.value);
        // Columnas de fecha: el día en la zona de la empresa (Bogotá).
        expect(data[`f${mapping.next_charge}`]).toBe('2026-12-05');
        expect(data[`f${mapping.paid_until}`]).toBe('2026-12-05');
        // Disparador: se activó y se cobró (una vez cada uno).
        const evs = dispatcher.events.filter((e) => e.trigger === 'subscription_event').map((e) => e.subscription?.evento);
        expect(evs.filter((e) => e === 'activated')).toHaveLength(1);
        expect(evs.filter((e) => e === 'charged')).toHaveLength(1);
        // Con una viva cobrando, no se crea otra.
        await expect(subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'otro@x.test' })).rejects.toThrow(/ya tiene una suscripción/);
    });

    it('un cobro rechazado: reintentando, después en mora, y vencida pasados los días de gracia (con «cancelar al vencer»)', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId, { grace_days: 5, on_expire: 'cancel' });
        const c = await seedClient();
        const mapping = await subs.setupFields(tenantId, admin, c.slug);
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@panaderiasol.test' });

        // Pagó octubre; noviembre se rechaza y Mercado Pago lo reintenta.
        authorize(mp, 'pre-1', '2026-11-05T12:00:00.000Z');
        invoice(mp, 'inv-1', 'pre-1', { status: 'processed', paymentId: 1, paymentStatus: 'approved', debit: '2026-10-05T12:00:00.000Z' });
        invoice(mp, 'inv-2', 'pre-1', { status: 'recycling', paymentId: 2, paymentStatus: 'rejected', detail: 'cc_rejected_insufficient_amount', debit: '2026-11-05T12:00:00.000Z', retry: 1 });
        let out = await subs.sync(tenantId, sub.id, new Date('2026-11-06T12:00:00Z'));
        expect(out).toMatchObject({ status: 'retrying', last_charge_status: 'rejected' });
        expect(out.last_failure_reason).toMatch(/fondos insuficientes/i);
        expect((await recordData(c.listId, c.recordId))[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.retrying.value);
        expect(dispatcher.events.some((e) => e.subscription?.evento === 'charge_failed')).toBe(true);

        // Se agotan los reintentos: en mora (sigue en los días de gracia).
        invoice(mp, 'inv-2', 'pre-1', { status: 'processed', paymentId: 3, paymentStatus: 'rejected', detail: 'cc_rejected_insufficient_amount', debit: '2026-11-05T12:00:00.000Z', retry: 4 });
        out = await subs.sync(tenantId, sub.id, new Date('2026-11-08T12:00:00Z'));
        expect(out.status).toBe('past_due');
        expect(dispatcher.events.some((e) => e.subscription?.evento === 'past_due')).toBe(true);

        // Pagado hasta el 5-nov + 5 días de gracia: el 11 ya está vencida y el plan pide cancelarla.
        out = await subs.sync(tenantId, sub.id, new Date('2026-11-11T12:00:00Z'));
        expect(dispatcher.events.some((e) => e.subscription?.evento === 'expired')).toBe(true);
        expect(mp.puts).toContainEqual({ id: 'pre-1', body: { status: 'cancelled' } });
        expect(out.status).toBe('cancelled');
        expect(out.cancel_reason).toMatch(/venció sin pago/);
        expect((await recordData(c.listId, c.recordId))[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.cancelled.value);
    });

    it('pausar, reanudar, cambiar el valor y cancelar llaman a Mercado Pago y quedan en el registro', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId);
        const c = await seedClient();
        const mapping = await subs.setupFields(tenantId, admin, c.slug);
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@panaderiasol.test' });
        await expect(subs.pause(tenantId, admin, sub.id)).rejects.toThrow(/no hay nada que pausar/);
        authorize(mp, 'pre-1', new Date(Date.now() + 20 * DAY).toISOString());
        invoice(mp, 'inv-1', 'pre-1', { status: 'processed', paymentId: 1, paymentStatus: 'approved', debit: new Date(Date.now() - 10 * DAY).toISOString() });
        await subs.verify(tenantId, admin, sub.id);

        expect((await subs.pause(tenantId, admin, sub.id)).status).toBe('paused');
        expect((await recordData(c.listId, c.recordId))[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.paused.value);
        expect((await subs.resume(tenantId, admin, sub.id)).status).toBe('active');
        const changed = await subs.changeAmount(tenantId, admin, sub.id, 175000);
        expect(changed.amount).toBe(175000);
        expect(mp.puts.at(-1)).toEqual({ id: 'pre-1', body: { auto_recurring: { transaction_amount: 175000, currency_id: 'COP' } } });
        expect((await recordData(c.listId, c.recordId))[`f${mapping.amount}`]).toBe(175000);
        const cancelled = await subs.cancel(tenantId, admin, sub.id, 'Cerró el local');
        expect(cancelled).toMatchObject({ status: 'cancelled', cancel_reason: 'Cerró el local' });
        await expect(subs.resume(tenantId, admin, sub.id)).rejects.toThrow(/ya terminó/);
    });

    it('la revisión periódica se entera sola (sin avisos) de lo que está por cobrarse', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId);
        const c = await seedClient();
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@panaderiasol.test' });
        authorize(mp, 'pre-1', new Date(Date.now() + 30 * DAY).toISOString());
        invoice(mp, 'inv-1', 'pre-1', { status: 'processed', paymentId: 5, paymentStatus: 'approved', debit: new Date().toISOString() });
        // Recién creada (hace menos de 10 minutos): todavía no le toca.
        expect(await subs.tick(new Date())).toBe(0);
        // 15 minutos después sí.
        expect(await subs.tick(new Date(Date.now() + 15 * 60 * 1000))).toBe(1);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, sub.id)));
        expect(row!.status).toBe('active');
        expect(row!.chargesPaid).toBe(1);
    });

    it('automatización: «Crear suscripción» con el correo del registro deja {{suscripcion.link}} y «Pausar» la pausa', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId);
        const c = await seedClient();
        const sentHooks: FakeCall[] = [];
        const prev = net.handler;
        net.handler = (call) => {
            if (call.url === 'https://hooks.example.test/whatsapp') {
                sentHooks.push(call);
                return { status: 200, body: '{}' };
            }
            return prev(call);
        };
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId: c.listId,
                    name: 'Suscribir al crear',
                    triggerType: 'record_created',
                    triggerConfig: {},
                    actions: [
                        { type: 'connector_action', config: { connection_id: connId, action_key: 'create_subscription_link', values: { plan_id: String(p.id), payer_email: '{{correo}}', amount: '99.000' } } },
                        { type: 'call_webhook', config: { url: 'https://hooks.example.test/whatsapp', method: 'POST', body_template: '{"msg":"Autoriza tu tarjeta: {{suscripcion.link}} ({{suscripcion.monto}})"}' } },
                    ],
                    isActive: true,
                })
                .returning(),
        );
        await engine.process({ tenantId, listId: c.listId, recordId: c.recordId, trigger: 'record_created', after: await recordData(c.listId, c.recordId) });
        const [run] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        expect(run!.status).toBe('success');
        expect(mp.pre.get('pre-1')).toMatchObject({ payer_email: 'pagos@panaderiasol.test' });
        expect((mp.pre.get('pre-1')!.auto_recurring as Record<string, unknown>).transaction_amount).toBe(99000);
        expect(sentHooks[0]!.body).toContain('Autoriza tu tarjeta: https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=pre-1 (99000)');

        // Otra automatización la pausa (una vez autorizada).
        authorize(mp, 'pre-1', new Date(Date.now() + 20 * DAY).toISOString());
        const [subRow] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
        await subs.sync(tenantId, subRow!.id);
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(automations).values({
                tenantId,
                listId: c.listId,
                name: 'Pausar',
                triggerType: 'record_updated',
                triggerConfig: {},
                actions: [{ type: 'connector_action', config: { connection_id: connId, action_key: 'manage_subscription', values: { operation: 'pause' } } }],
                isActive: true,
            }),
        );
        await engine.process({ tenantId, listId: c.listId, recordId: c.recordId, trigger: 'record_updated', after: await recordData(c.listId, c.recordId), before: {} });
        expect(mp.puts).toContainEqual({ id: 'pre-1', body: { status: 'paused' } });
    });

    it('el disparador «Cuando cambia una suscripción» filtra por evento y por plan', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const p1 = await plan(connId);
        const p2 = await plan(connId, { name: 'Anual', frequency: 12 });
        const c = await seedClient();
        const hooks: FakeCall[] = [];
        const prev = net.handler;
        net.handler = (call) => {
            if (call.url.startsWith('https://hooks.example.test/')) {
                hooks.push(call);
                return { status: 200, body: '{}' };
            }
            return prev(call);
        };
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(automations).values([
                {
                    tenantId,
                    listId: c.listId,
                    name: 'Avisar rechazos del plan 1',
                    triggerType: 'subscription_event',
                    triggerConfig: { subscription_events: ['charge_failed'], plan_ids: [p1.id] },
                    actions: [{ type: 'call_webhook', config: { url: 'https://hooks.example.test/p1', method: 'POST', body_template: '{"m":"{{suscripcion.evento}} {{suscripcion.motivo}} {{suscripcion.monto_cobrado}}"}' } }],
                    isActive: true,
                },
                {
                    tenantId,
                    listId: c.listId,
                    name: 'Sólo el plan 2',
                    triggerType: 'subscription_event',
                    triggerConfig: { plan_ids: [p2.id] },
                    actions: [{ type: 'call_webhook', config: { url: 'https://hooks.example.test/p2', method: 'POST', body_template: '{}' } }],
                    isActive: true,
                },
            ]),
        );
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p1.id, payer_email: 'pagos@panaderiasol.test' });
        authorize(mp, 'pre-1', '2026-12-05T12:00:00.000Z');
        invoice(mp, 'inv-1', 'pre-1', { status: 'recycling', paymentId: 2, paymentStatus: 'rejected', detail: 'cc_rejected_card_disabled', debit: '2026-11-05T12:00:00.000Z' });
        await subs.sync(tenantId, sub.id, new Date('2026-11-05T13:00:00Z'));
        // El dispatcher de prueba sólo guarda: los eventos se procesan a mano con el motor.
        for (const ev of dispatcher.events.filter((e) => e.trigger === 'subscription_event')) await engine.process(ev);
        expect(hooks.filter((h) => h.url.endsWith('/p2'))).toHaveLength(0);
        const p1Hooks = hooks.filter((h) => h.url.endsWith('/p1'));
        expect(p1Hooks).toHaveLength(1);
        expect(p1Hooks[0]!.body).toContain('Falló un cobro');
        expect(p1Hooks[0]!.body).toContain('150000');
    });

    it('la página de vuelta muestra sólo lo que el cliente ya sabe y una referencia inválida no existe', async () => {
        fakeMercadoPago();
        const connId = await connectMp();
        const p = await plan(connId);
        const c = await seedClient();
        await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@panaderiasol.test' });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)));
        const status = await subs.publicStatus(row!.reference);
        expect(status).toMatchObject({ tenantName: 'ACME', title: 'Mantenimiento mensual', status: 'pending', amount: 150000, currency: 'COP' });
        expect(await subs.publicStatus('ibs_noexiste123')).toBeNull();
        expect(await subs.publicStatus("ibs_' or 1=1")).toBeNull();
    });
});
