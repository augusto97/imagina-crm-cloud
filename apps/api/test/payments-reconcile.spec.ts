import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { platformPaymentsViewSchema, updatePlatformPaymentsSchema, type Currency, type PlanPrice } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { loadEnv, type Env } from '../src/config/env';
import type { PlansService } from '../src/billing/plans.service';
import { billingPayments, billingSubscriptions, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import {
    emptyReconcileBatch,
    type CheckoutRequest,
    type PaymentGateway,
    type PaymentNotice,
    type ReconcileBatch,
    type ReconcileInput,
} from '../src/payments/payment.types';
import { PaymentsReconcileService, reconcileChangeText } from '../src/payments/payments-reconcile.service';
import { PaymentsService } from '../src/payments/payments.service';
import { PlatformPaymentsService } from '../src/payments/platform-payments.service';
import { MercadoPagoGateway } from '../src/payments/providers/mercadopago.provider';
import { PayPalGateway } from '../src/payments/providers/paypal.provider';
import {
    OPEN_CHECKOUTS_KEY,
    OpenCheckouts,
    RECONCILE_LOCK_KEY,
    nextReconcileAt,
    reconcileDue,
    reconcileSince,
} from '../src/payments/reconcile-state';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const H = 60 * 60 * 1000;
const DAY = 24 * H;

/** Redis en memoria con lo que usa la revisión (strings, NX/EX y un zset). */
class FakeRedis {
    kv = new Map<string, string>();
    zsets = new Map<string, Map<string, number>>();
    async get(k: string): Promise<string | null> {
        return this.kv.get(k) ?? null;
    }
    async set(k: string, v: string, ...args: Array<string | number>): Promise<unknown> {
        if (args.includes('NX') && this.kv.has(k)) return null;
        this.kv.set(k, v);
        return 'OK';
    }
    async del(k: string): Promise<unknown> {
        this.kv.delete(k);
        return 1;
    }
    private z(k: string): Map<string, number> {
        let m = this.zsets.get(k);
        if (!m) this.zsets.set(k, (m = new Map()));
        return m;
    }
    async zadd(k: string, score: number, member: string): Promise<unknown> {
        this.z(k).set(member, score);
        return 1;
    }
    private inRange(score: number, min: number | string, max: number | string): boolean {
        const lo = min === '-inf' ? -Infinity : Number(min);
        const hi = max === '+inf' ? Infinity : Number(max);
        return score >= lo && score <= hi;
    }
    async zrangebyscore(k: string, min: number | string, max: number | string): Promise<string[]> {
        return [...this.z(k).entries()]
            .filter(([, s]) => this.inRange(s, min, max))
            .sort((a, b) => a[1] - b[1])
            .map(([m]) => m);
    }
    async zremrangebyscore(k: string, min: number | string, max: number | string): Promise<unknown> {
        for (const [m, s] of [...this.z(k).entries()]) if (this.inRange(s, min, max)) this.z(k).delete(m);
        return 1;
    }
    async zrem(k: string, ...members: string[]): Promise<unknown> {
        for (const m of members) this.z(k).delete(m);
        return 1;
    }
}

describe('cuándo toca y desde cuándo buscar', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    it('apagada nunca; sin corridas, ya; con una reciente, cuando pasa el intervalo (con un minuto de margen)', () => {
        expect(reconcileDue(0, null, now)).toBe(false);
        expect(reconcileDue(60, null, now)).toBe(true);
        expect(reconcileDue(60, { started_at: new Date(now.getTime() - 30 * 60_000).toISOString() }, now)).toBe(false);
        expect(reconcileDue(60, { started_at: new Date(now.getTime() - 59.5 * 60_000).toISOString() }, now)).toBe(true);
        expect(reconcileDue(60, { started_at: 'roto' }, now)).toBe(true);
    });
    it('la próxima: la última + el intervalo, nunca en el pasado; apagada → null', () => {
        expect(nextReconcileAt(0, null, now)).toBeNull();
        expect(nextReconcileAt(60, { started_at: new Date(now.getTime() - 15 * 60_000).toISOString() }, now)!.toISOString()).toBe(
            new Date(now.getTime() + 45 * 60_000).toISOString(),
        );
        expect(nextReconcileAt(15, { started_at: new Date(now.getTime() - 5 * H).toISOString() }, now)!.getTime()).toBe(now.getTime());
    });
    it('manual: una semana; automática: desde la última buena con 2 h de solapamiento, entre 6 h y 30 días', () => {
        expect(now.getTime() - reconcileSince('manual', new Date(now.getTime() - H).toISOString(), now).getTime()).toBe(7 * DAY);
        expect(now.getTime() - reconcileSince('auto', null, now).getTime()).toBe(7 * DAY);
        expect(now.getTime() - reconcileSince('auto', new Date(now.getTime() - 10 * H).toISOString(), now).getTime()).toBe(12 * H);
        expect(now.getTime() - reconcileSince('auto', new Date(now.getTime() - H).toISOString(), now).getTime()).toBe(6 * H);
        expect(now.getTime() - reconcileSince('auto', new Date(now.getTime() - 90 * DAY).toISOString(), now).getTime()).toBe(30 * DAY);
    });
    it('el texto de cada cambio', () => {
        const pay = (over: Partial<Extract<PaymentNotice, { kind: 'payment' }>>): PaymentNotice => ({
            kind: 'payment',
            tenantId: 1,
            plan: 'pro',
            mode: 'period',
            months: 3,
            externalId: 'x',
            status: 'approved',
            amount: 597_000,
            currency: 'COP',
            method: 'PSE',
            ...over,
        });
        expect(reconcileChangeText(pay({}), 'pro')).toBe('Pago de 3 meses · plan «pro» aprobado (597.000 COP)');
        expect(reconcileChangeText(pay({ months: 1, status: 'pending' }), 'pro')).toBe('Pago de 1 mes · plan «pro» pendiente de confirmar (597.000 COP)');
        expect(reconcileChangeText(pay({ mode: 'subscription', status: 'rejected', amount: 199_000 }), 'pro')).toBe(
            'Cobro de la renovación automática rechazado (199.000 COP)',
        );
        expect(
            reconcileChangeText(
                { kind: 'subscription', tenantId: 1, plan: 'pro', externalId: 's', status: 'cancelled', amount: 0, currency: 'COP', nextPaymentAt: null, authorizeUrl: null },
                'pro',
            ),
        ).toBe('Renovación automática cancelada · plan «pro»');
    });
    it('la frecuencia sólo acepta los valores del selector', () => {
        expect(updatePlatformPaymentsSchema.safeParse({ reconcile_interval_minutes: 60 }).success).toBe(true);
        expect(updatePlatformPaymentsSchema.safeParse({ reconcile_interval_minutes: 0 }).success).toBe(true);
        expect(updatePlatformPaymentsSchema.safeParse({ reconcile_interval_minutes: 7 }).success).toBe(false);
        // Una vista vieja (sin `reconcile`) se sigue leyendo.
        const view = platformPaymentsViewSchema.parse({
            mercadopago: { configured: false, from_env: false, mode: null, access_token_hint: null, webhook_secret_set: false, webhook_url: 'x' },
            paypal: { configured: false },
        });
        expect(view.reconcile).toEqual({ interval_minutes: 60, running: false, last: null, next_at: null });
    });
});

describe('Mercado Pago: revisión de respaldo (red simulada)', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    const source = { mercadoPago: () => Promise.resolve({ accessToken: 'APP_USR-tok', webhookSecret: '' }), webhookUrl: () => 'https://x' };
    type Route = (u: URL) => { status: number; body: unknown } | null;
    function fakeFetch(route: Route) {
        const calls: string[] = [];
        const impl = (async (input: string | URL | Request) => {
            const u = new URL(String(input));
            calls.push(`${u.pathname}${u.search}`);
            const r = route(u) ?? { status: 404, body: {} };
            return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        return { impl, calls };
    }
    const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
        since: new Date(now.getTime() - 2 * DAY),
        now,
        openCheckouts: [],
        liveSubscriptions: [],
        ...over,
    });

    it('trae los pagos que cambiaron (sin firma: se leen con la clave), ignora los ajenos y relee las renovaciones con sus cuotas', async () => {
        const f = fakeFetch((u) => {
            if (u.pathname === '/v1/payments/search' && u.searchParams.get('range') === 'date_last_updated') {
                expect(u.searchParams.get('begin_date')).toBe('NOW-2DAYS');
                return {
                    status: 200,
                    body: {
                        paging: { total: 3 },
                        results: [
                            { id: 901, status: 'approved', external_reference: 'p:7:pro:3:597000', transaction_amount: 597_000, currency_id: 'COP', payment_method_id: 'pse' },
                            { id: 902, status: 'approved', external_reference: 'ib_otra-cosa', transaction_amount: 10, currency_id: 'COP' },
                            { id: 903, status: 'refunded', external_reference: 'p:8:starter:1:59000', transaction_amount: 59_000, currency_id: 'COP' },
                        ],
                    },
                };
            }
            if (u.pathname === '/preapproval/sub-9') {
                return { status: 200, body: { id: 'sub-9', status: 'authorized', external_reference: 's:9:pro', auto_recurring: { transaction_amount: 199_000, currency_id: 'COP' } } };
            }
            if (u.pathname === '/authorized_payments/search') {
                return {
                    status: 200,
                    body: {
                        results: [
                            { id: 1, preapproval_id: 'sub-9', external_reference: 's:9:pro', transaction_amount: 199_000, currency_id: 'COP', payment: { id: 777, status: 'approved' } },
                            { id: 2, preapproval_id: 'sub-9', payment: null },
                        ],
                    },
                };
            }
            return null;
        });
        const batch = await new MercadoPagoGateway(source, f.impl).reconcile(input({ liveSubscriptions: ['sub-9'] }));
        expect(batch.errors).toEqual([]);
        expect(batch.checked).toEqual({ payments: 4, subscriptions: 1, orders: 0 });
        expect(batch.notices.map((n) => `${n.kind}:${n.externalId}:${n.status}`)).toEqual([
            'payment:901:approved',
            'payment:903:refunded',
            'subscription:sub-9:authorized',
            'payment:777:approved',
        ]);
        expect(batch.notices[0]).toMatchObject({ tenantId: 7, plan: 'pro', months: 3, method: 'PSE' });
    });

    it('un pago abierto que la búsqueda amplia no trajo se busca por su referencia; cobrado o viejo se deja de mirar', async () => {
        const f = fakeFetch((u) => {
            if (u.pathname !== '/v1/payments/search') return null;
            if (u.searchParams.get('range')) return { status: 200, body: { results: [] } };
            if (u.searchParams.get('external_reference') === 'p:7:pro:1:199000') {
                return { status: 200, body: { results: [{ id: 950, status: 'approved', external_reference: 'p:7:pro:1:199000', transaction_amount: 199_000, currency_id: 'COP' }] } };
            }
            return { status: 200, body: { results: [] } };
        });
        const paid = { externalId: 'pref-1', reference: 'p:7:pro:1:199000', tenantId: 7, createdAt: now.getTime() - H };
        const waiting = { externalId: 'pref-2', reference: 'p:7:pro:2:398000', tenantId: 7, createdAt: now.getTime() - H };
        const old = { externalId: 'pref-3', reference: 'p:7:pro:6:1194000', tenantId: 7, createdAt: now.getTime() - 8 * DAY };
        const batch = await new MercadoPagoGateway(source, f.impl).reconcile(input({ openCheckouts: [paid, waiting, old] }));
        expect(batch.notices.map((n) => n.externalId)).toEqual(['950']);
        expect(batch.settled).toEqual([paid, old]);
    });

    it('si Mercado Pago rechaza la búsqueda o la clave, lo dice en lenguaje claro y sigue con lo demás', async () => {
        const f = fakeFetch((u) => {
            if (u.pathname === '/v1/payments/search') return { status: 401, body: { message: 'invalid token' } };
            if (u.pathname === '/preapproval/sub-x') return { status: 404, body: {} };
            return null;
        });
        const batch = await new MercadoPagoGateway(source, f.impl).reconcile(input({ liveSubscriptions: ['sub-x'] }));
        expect(batch.errors).toEqual([
            'Mercado Pago rechazó el Access Token al buscar los pagos recientes (401): revisa las credenciales en esta pantalla.',
            'La renovación sub-x no existe en esta cuenta de Mercado Pago (¿cambiaste el Access Token?).',
        ]);
        expect(batch.notices).toEqual([]);
    });

    it('cuotas: si la búsqueda paginada da 400, se pide sólo con el id', async () => {
        const f = fakeFetch((u) => {
            if (u.pathname === '/v1/payments/search') return { status: 200, body: { results: [] } };
            if (u.pathname === '/preapproval/sub-9') return { status: 200, body: { id: 'sub-9', status: 'authorized', external_reference: 's:9:pro' } };
            if (u.pathname === '/authorized_payments/search') {
                if (u.searchParams.has('offset')) return { status: 400, body: {} };
                return { status: 200, body: { results: [{ preapproval_id: 'sub-9', external_reference: 's:9:pro', payment: { id: 31, status: 'rejected' } }] } };
            }
            return null;
        });
        const batch = await new MercadoPagoGateway(source, f.impl).reconcile(input({ liveSubscriptions: ['sub-9'] }));
        expect(batch.errors).toEqual([]);
        expect(batch.notices.map((n) => `${n.externalId}:${n.status}`)).toEqual(['sub-9:authorized', '31:rejected']);
    });
});

describe('PayPal: revisión de las órdenes abiertas', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    const env = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_WEBHOOK_ID: 'wh', PAYPAL_ENV: 'sandbox' } as unknown as Env;
    const order = (status: string) => ({ id: 'O', status, purchase_units: [{ custom_id: 'p:7:pro:2:98', amount: { value: '98.00' } }] });

    it('aprobada sin capturar → la captura y la aplica; completada → la aplica; anulada, inexistente o vieja → se deja de mirar', async () => {
        const calls: string[] = [];
        const impl = (async (input: string | URL | Request, init?: RequestInit) => {
            const u = String(input);
            calls.push(`${init?.method ?? 'GET'} ${u}`);
            const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 't' });
            if (u.endsWith('/orders/A1/capture')) return json({ status: 'COMPLETED' }, 201);
            if (u.endsWith('/orders/A1')) return json(order('APPROVED'));
            if (u.endsWith('/orders/C1')) return json(order('COMPLETED'));
            if (u.endsWith('/orders/V1')) return json(order('VOIDED'));
            if (u.endsWith('/orders/N1')) return json(order('CREATED'));
            if (u.endsWith('/orders/OLD')) return json(order('CREATED'));
            return json({}, 404);
        }) as typeof fetch;
        const c = (externalId: string, ageMs = H) => ({ externalId, reference: 'p:7:pro:2:98', tenantId: 7, createdAt: now.getTime() - ageMs });
        const open = [c('A1'), c('C1'), c('V1'), c('N1'), c('OLD', 4 * DAY), c('GONE')];
        const batch = await new PayPalGateway(env, impl).reconcile({ since: now, now, openCheckouts: open, liveSubscriptions: [] });
        expect(batch.notices.map((n) => `${n.externalId}:${n.status}`)).toEqual(['A1:approved', 'C1:approved']);
        expect(batch.notices[0]).toMatchObject({ tenantId: 7, plan: 'pro', months: 2, amount: 98, currency: 'USD', method: 'PayPal' });
        expect(batch.settled.map((s) => s.externalId)).toEqual(['A1', 'C1', 'V1', 'OLD', 'GONE']);
        expect(batch.checked.orders).toBe(5);
        expect(calls.some((x) => x.startsWith('POST') && x.endsWith('/orders/A1/capture'))).toBe(true);
    });

    it('sin órdenes abiertas no llama a PayPal', async () => {
        let called = false;
        const impl = (async () => {
            called = true;
            return new Response('{}');
        }) as unknown as typeof fetch;
        const batch = await new PayPalGateway(env, impl).reconcile({ since: now, now, openCheckouts: [], liveSubscriptions: [] });
        expect(batch).toEqual(emptyReconcileBatch());
        expect(called).toBe(false);
    });
});

// ── El servicio con Postgres real ───────────────────────────────────────

function fakePlans(sellable: PlanPrice[]): PlansService {
    return {
        sellablePlans: () => Promise.resolve(sellable),
        priceFor: (slug: string, currency: Currency) => {
            const p = sellable.find((s) => s.slug === slug);
            return Promise.resolve(p ? (currency === 'USD' ? p.usd : p.cop) : null);
        },
    } as unknown as PlansService;
}

class ReconcilingGateway implements PaymentGateway {
    readonly supportsSubscription = true;
    batch: ReconcileBatch = emptyReconcileBatch();
    inputs: ReconcileInput[] = [];
    gate: Promise<void> | null = null;
    constructor(readonly provider: 'mercadopago' | 'paypal') {}
    isEnabled() {
        return Promise.resolve(true);
    }
    createCheckout(req: CheckoutRequest) {
        return Promise.resolve({ url: `https://pay.test/${req.reference}`, externalId: `pref-${req.months}` });
    }
    handleWebhook(): Promise<PaymentNotice[]> {
        return Promise.resolve([]);
    }
    async reconcile(input: ReconcileInput): Promise<ReconcileBatch> {
        this.inputs.push(input);
        if (this.gate) await this.gate;
        return this.batch;
    }
}

describe('PaymentsReconcileService (Postgres real)', () => {
    let pg: TestPg;
    let tA: number;
    let redis: FakeRedis;
    let gw: ReconcilingGateway;
    let payments: PaymentsService;
    let settings: PlatformPaymentsService;
    let svc: PaymentsReconcileService;
    const env = { ...loadEnv(), APP_BASE_URL: 'https://app.test', MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-x', SECRETS_KEY: '' } as Env;

    beforeAll(async () => {
        pg = await startPostgres();
        const [a] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'trial', status: 'trialing' }).returning();
        tA = a!.id;
    }, 120_000);
    afterAll(async () => pg?.stop());

    beforeEach(async () => {
        await withTenant(pg.db, tA, async (tx) => {
            await tx.delete(billingPayments).where(eq(billingPayments.tenantId, tA));
            await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, tA));
        });
        await pg.db.update(tenants).set({ paidUntil: null, plan: 'trial', status: 'trialing' }).where(eq(tenants.id, tA));
        redis = new FakeRedis();
        gw = new ReconcilingGateway('mercadopago');
        const open = new OpenCheckouts(redis);
        payments = new PaymentsService(env, [gw], fakePlans([{ slug: 'pro', name: 'Pro', usd: 49, cop: 199_000 }]), new TenantDb(pg.db), pg.db, open);
        settings = new PlatformPaymentsService(redis, env);
        svc = new PaymentsReconcileService(payments, settings, open, redis, pg.db);
    });

    const approved = (externalId: string, months = 3): PaymentNotice => ({
        kind: 'payment',
        tenantId: tA,
        plan: 'pro',
        mode: 'period',
        months,
        externalId,
        status: 'approved',
        amount: 199_000 * months,
        currency: 'COP',
        method: 'PSE',
    });

    it('aplica un pago cuyo aviso nunca llegó, una sola vez; la segunda revisión no cambia nada', async () => {
        gw.batch = { ...emptyReconcileBatch(), notices: [approved('mp-1')], checked: { payments: 5, subscriptions: 0, orders: 0 } };
        const first = await svc.run('manual');
        expect(first).toMatchObject({ trigger: 'manual', ok: true, applied: 1, checked: { payments: 5 } });
        expect(first!.changes).toEqual([
            { tenant_id: tA, tenant_name: 'ACME', provider: 'mercadopago', kind: 'payment', status: 'approved', text: 'Pago de 3 meses · plan «pro» aprobado (597.000 COP)' },
        ]);
        const t = (await pg.db.select().from(tenants).where(eq(tenants.id, tA)))[0]!;
        expect(t.plan).toBe('pro');
        expect(t.status).toBe('active');
        expect(t.paidUntil).not.toBeNull();

        const second = await svc.run('auto');
        expect(second).toMatchObject({ applied: 0, changes: [] });
        const rows = await withTenant(pg.db, tA, (tx) => tx.select().from(billingPayments).where(eq(billingPayments.tenantId, tA)));
        expect(rows).toHaveLength(1);
        // Y el aviso que llega tarde tampoco extiende de nuevo.
        expect(await payments.apply('mercadopago', approved('mp-1'))).toBe(false);
    });

    it('releer la misma renovación no cuenta como cambio; un cambio de estado sí', async () => {
        await withTenant(pg.db, tA, (tx) =>
            tx.insert(billingSubscriptions).values({ tenantId: tA, provider: 'mercadopago', externalId: 'sub-1', plan: 'pro', status: 'pending', amount: 199_000, currency: 'COP' }),
        );
        const sub = (status: 'pending' | 'authorized'): PaymentNotice => ({
            kind: 'subscription',
            tenantId: tA,
            plan: 'pro',
            externalId: 'sub-1',
            status,
            amount: 199_000,
            currency: 'COP',
            nextPaymentAt: null,
            authorizeUrl: null,
        });
        gw.batch = { ...emptyReconcileBatch(), notices: [sub('pending')], checked: { payments: 0, subscriptions: 1, orders: 0 } };
        expect((await svc.run('auto'))!.applied).toBe(0);
        expect(gw.inputs[0]!.liveSubscriptions).toEqual(['sub-1']);
        gw.batch = { ...emptyReconcileBatch(), notices: [sub('authorized')] };
        const r = await svc.run('auto');
        expect(r!.changes.map((c) => c.text)).toEqual(['Renovación automática activada · plan «pro» (199.000 COP)']);
    });

    it('los pagos que se abren se recuerdan y se dejan de mirar cuando el proveedor dice que terminaron', async () => {
        await payments.createCheckout(tA, 'a@b.co', { plan: 'pro', provider: 'mercadopago', mode: 'period', months: 2 });
        const stored = await redis.zrangebyscore(OPEN_CHECKOUTS_KEY, '-inf', '+inf');
        expect(stored).toHaveLength(1);
        expect(JSON.parse(stored[0]!)).toMatchObject({ provider: 'mercadopago', external_id: 'pref-2', reference: `p:${tA}:pro:2:398000`, tenant_id: tA });

        await svc.run('auto');
        expect(gw.inputs[0]!.openCheckouts).toEqual([expect.objectContaining({ externalId: 'pref-2', reference: `p:${tA}:pro:2:398000` })]);
        expect(await redis.zrangebyscore(OPEN_CHECKOUTS_KEY, '-inf', '+inf')).toHaveLength(1);

        gw.batch = { ...emptyReconcileBatch(), settled: [gw.inputs[0]!.openCheckouts[0]!] };
        await svc.run('auto');
        expect(await redis.zrangebyscore(OPEN_CHECKOUTS_KEY, '-inf', '+inf')).toEqual([]);
    });

    it('una sola a la vez: «Revisar ahora» mientras otra corre no lanza otra', async () => {
        let release!: () => void;
        gw.gate = new Promise((r) => (release = r));
        const started = await svc.start();
        expect(started.running).toBe(true);
        expect(await redis.get(RECONCILE_LOCK_KEY)).not.toBeNull();
        expect(await svc.run('manual')).toBeNull();
        await svc.start();
        release();
        // Espera a que termine la que arrancó en segundo plano.
        for (let i = 0; i < 50 && (await redis.get(RECONCILE_LOCK_KEY)); i++) await new Promise((r) => setTimeout(r, 20));
        expect(gw.inputs).toHaveLength(1);
        const status = await svc.status();
        expect(status).toMatchObject({ running: false, interval_minutes: 60, last: { trigger: 'manual', ok: true } });
    });

    it('el reloj respeta la frecuencia elegida (y «sólo con los avisos» no revisa)', async () => {
        const now = new Date();
        expect(await svc.tick(now)).not.toBeNull();
        expect(await svc.tick(new Date(now.getTime() + 10 * 60_000))).toBeNull();
        expect(await svc.tick(new Date(now.getTime() + 60 * 60_000))).not.toBeNull();

        await settings.update({ reconcile_interval_minutes: 15 });
        expect(await settings.reconcileInterval()).toBe(15);
        expect(await svc.tick(new Date(now.getTime() + 76 * 60_000))).not.toBeNull();

        await settings.update({ reconcile_interval_minutes: 0 });
        expect(await svc.tick(new Date(now.getTime() + 10 * DAY))).toBeNull();
        expect((await settings.view()).reconcile).toMatchObject({ interval_minutes: 0, next_at: null });

        // Quitar las credenciales no borra la frecuencia.
        await settings.update({ clear_mercadopago: true });
        expect(await settings.reconcileInterval()).toBe(0);
        // Un valor raro vuelve a cada hora.
        redis.kv.set('platform:payments', JSON.stringify({ reconcile_interval_minutes: 7 }));
        expect(await settings.reconcileInterval()).toBe(60);
    });

    it('sin proveedores con revisión: dice por qué no revisó', async () => {
        const plain: PaymentGateway = {
            provider: 'paypal',
            supportsSubscription: false,
            isEnabled: () => Promise.resolve(true),
            createCheckout: () => Promise.resolve({ url: 'x', externalId: 'y' }),
            handleWebhook: () => Promise.resolve([]),
        };
        const only = new PaymentsService(env, [plain], fakePlans([]), new TenantDb(pg.db), pg.db);
        const s = new PaymentsReconcileService(only, settings, new OpenCheckouts(redis), redis, pg.db);
        const r = await s.run('manual');
        expect(r!.skipped).toMatch(/No hay cobros configurados/);
        expect(await s.tick()).toBeNull();
    });

    it('los errores de un proveedor quedan a la vista y la ventana de búsqueda no avanza', async () => {
        gw.batch = { ...emptyReconcileBatch(), errors: ['Mercado Pago respondió 503 al buscar los pagos recientes.'] };
        const r = await svc.run('auto');
        expect(r).toMatchObject({ ok: false, errors: ['Mercado Pago respondió 503 al buscar los pagos recientes.'] });
        expect(await redis.get('billing:reconcile:last_ok_at')).toBeNull();
        gw.batch = emptyReconcileBatch();
        await svc.run('auto');
        expect(await redis.get('billing:reconcile:last_ok_at')).not.toBeNull();
        // Ninguna clave de la revisión viaja en el snapshot salvo la frecuencia.
        expect([...redis.kv.keys()].filter((k) => k.startsWith('platform:'))).toEqual([]);
    });
});
