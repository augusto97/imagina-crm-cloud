import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Currency, PlanPrice } from '@imagina-base/shared';
import { loadEnv, type Env } from '../src/config/env';
import type { BillingService } from '../src/billing/billing.service';
import type { PlansService } from '../src/billing/plans.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
    decodeReference,
    encodeReference,
    type CheckoutRequest,
    type PaymentEvent,
    type PaymentGateway,
} from '../src/payments/payment.types';
import { mapMpStatus, verifyMpSignature } from '../src/payments/providers/mercadopago.provider';
import { mapPayPalEvent, PayPalGateway } from '../src/payments/providers/paypal.provider';

function fakeBilling(): { billing: BillingService; calls: Array<{ tenantId: number; input: unknown }> } {
    const calls: Array<{ tenantId: number; input: unknown }> = [];
    const billing = {
        setBilling: vi.fn((tenantId: number, input: unknown) => {
            calls.push({ tenantId, input });
            return Promise.resolve({} as never);
        }),
    } as unknown as BillingService;
    return { billing, calls };
}

/** PlansService de prueba: precios en memoria (evita tocar la DB). */
function fakePlans(sellable: PlanPrice[]): PlansService {
    return {
        sellablePlans: () => Promise.resolve(sellable),
        priceFor: (slug: string, currency: Currency) => {
            const p = sellable.find((s) => s.slug === slug);
            if (!p) return Promise.resolve(null);
            return Promise.resolve(currency === 'USD' ? p.usd : p.cop);
        },
    } as unknown as PlansService;
}
const STARTER: PlanPrice = { slug: 'starter', name: 'Starter', usd: 15, cop: 59_000 };
const PRO: PlanPrice = { slug: 'pro', name: 'Pro', usd: 49, cop: 199_000 };

class FakeGateway implements PaymentGateway {
    constructor(
        readonly provider: 'paypal' | 'mercadopago',
        readonly enabled: boolean,
        private readonly event: PaymentEvent | null = null,
    ) {}
    createCheckout(req: CheckoutRequest): Promise<{ url: string; externalId: string }> {
        return Promise.resolve({ url: `https://pay.test/${req.reference}`, externalId: 'ext_1' });
    }
    handleWebhook(): Promise<PaymentEvent | null> {
        return Promise.resolve(this.event);
    }
}

describe('reference encode/decode', () => {
    it('round-trip tenant + plan', () => {
        expect(decodeReference(encodeReference(42, 'pro'))).toEqual({ tenantId: 42, plan: 'pro' });
    });
    it('rechaza referencias inválidas', () => {
        expect(decodeReference('x:pro')).toBeNull();
        // Cualquier slug URL-safe es válido (los planes ahora son dinámicos).
        expect(decodeReference('7:growth')).toEqual({ tenantId: 7, plan: 'growth' });
        // Un slug con caracteres fuera de [a-z0-9_] no cuenta como plan.
        expect(decodeReference('7:Pro Max')).toEqual({ tenantId: 7, plan: undefined });
    });
});

describe('mapeos de estado', () => {
    it('Mercado Pago', () => {
        expect(mapMpStatus('approved')).toBe('active');
        expect(mapMpStatus('refunded')).toBe('canceled');
        expect(mapMpStatus('pending')).toBe('past_due');
    });
    it('PayPal', () => {
        expect(mapPayPalEvent('PAYMENT.CAPTURE.COMPLETED')).toBe('active');
        expect(mapPayPalEvent('BILLING.SUBSCRIPTION.CANCELLED')).toBe('canceled');
        expect(mapPayPalEvent('UNKNOWN.EVENT')).toBeNull();
        // SEC-29: aprobar no es pagar.
        expect(mapPayPalEvent('CHECKOUT.ORDER.APPROVED')).toBeNull();
    });
});

// SEC-29 (v0.1.228): la orden aprobada se CAPTURA antes de activar el plan.
describe('PayPal: captura antes de activar', () => {
    const ppEnv = {
        PAYPAL_CLIENT_ID: 'id',
        PAYPAL_CLIENT_SECRET: 'secret',
        PAYPAL_WEBHOOK_ID: 'wh',
        PAYPAL_ENV: 'sandbox',
    } as unknown as Env;
    const approved = JSON.stringify({
        event_type: 'CHECKOUT.ORDER.APPROVED',
        resource: { id: 'ORDER-123', purchase_units: [{ custom_id: '7:pro' }] },
    });

    function fakeFetch(capture: { status: number; body?: unknown }, order?: { status?: string }) {
        const calls: string[] = [];
        const impl = (async (url: string | URL | Request) => {
            const u = String(url);
            calls.push(u);
            const json = (body: unknown, status = 200) =>
                new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 't' });
            if (u.endsWith('/verify-webhook-signature')) return json({ verification_status: 'SUCCESS' });
            if (u.endsWith('/capture')) return json(capture.body ?? {}, capture.status);
            if (u.endsWith('/v2/checkout/orders/ORDER-123')) return json(order ?? {});
            return json({}, 404);
        }) as typeof fetch;
        return { impl, calls };
    }

    it('captura COMPLETED → activa el plan de la referencia', async () => {
        const f = fakeFetch({ status: 201, body: { status: 'COMPLETED' } });
        const ev = await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, approved);
        expect(ev).toEqual({ tenantId: 7, plan: 'pro', status: 'active' });
        expect(f.calls.some((c) => c.endsWith('/v2/checkout/orders/ORDER-123/capture'))).toBe(true);
    });

    it('captura rechazada (fondos, orden inválida) → no activa nada', async () => {
        const f = fakeFetch({ status: 400, body: { name: 'INSTRUMENT_DECLINED' } });
        expect(await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, approved)).toBeNull();
    });

    it('captura PENDIENTE → todavía no es plata cobrada', async () => {
        const f = fakeFetch({ status: 201, body: { status: 'PENDING' } });
        expect(await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, approved)).toBeNull();
    });

    it('reintento del aviso con la orden ya capturada → consulta y activa', async () => {
        const f = fakeFetch({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } }, { status: 'COMPLETED' });
        expect(await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, approved)).toEqual({
            tenantId: 7,
            plan: 'pro',
            status: 'active',
        });
    });

    it('PAYMENT.CAPTURE.COMPLETED en estado PENDING no activa', async () => {
        const f = fakeFetch({ status: 201 });
        const body = JSON.stringify({
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: { status: 'PENDING', custom_id: '7:pro' },
        });
        expect(await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, body)).toBeNull();
    });
});

describe('verifyMpSignature', () => {
    const secret = 'mp_secret';
    const dataId = '123456';
    const requestId = 'req-abc';
    const ts = '1700000000';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
    const headers = { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };

    it('acepta una firma válida', () => {
        expect(verifyMpSignature(headers, dataId, secret)).toBe(true);
    });
    it('rechaza firma adulterada', () => {
        expect(verifyMpSignature({ ...headers, 'x-signature': `ts=${ts},v1=deadbeef` }, dataId, secret)).toBe(false);
    });
    it('sin secret configurado → rechaza', () => {
        expect(verifyMpSignature(headers, dataId, '')).toBe(false);
    });
});

describe('PaymentsService', () => {
    const env = loadEnv();

    it('config() lista sólo proveedores habilitados + planes vendibles', async () => {
        const { billing } = fakeBilling();
        const svc = new PaymentsService(env, [new FakeGateway('paypal', true), new FakeGateway('mercadopago', false)], billing, fakePlans([STARTER, PRO]));
        const cfg = await svc.config();
        expect(cfg.providers).toEqual(['paypal']);
        expect(cfg.plans.find((p) => p.slug === 'pro')?.usd).toBe(49);
    });

    it('createCheckout usa el gateway y arma la referencia (precio de la DB)', async () => {
        const { billing } = fakeBilling();
        const svc = new PaymentsService(env, [new FakeGateway('mercadopago', true)], billing, fakePlans([STARTER]));
        const res = await svc.createCheckout(7, { provider: 'mercadopago', plan: 'starter' });
        expect(res).toMatchObject({ provider: 'mercadopago', plan: 'starter' });
        expect(res.url).toContain('7:starter');
    });

    it('createCheckout vende un plan CUSTOM apenas tiene precio', async () => {
        const { billing } = fakeBilling();
        const growth: PlanPrice = { slug: 'growth', name: 'Growth', usd: 29, cop: 119_000 };
        const svc = new PaymentsService(env, [new FakeGateway('paypal', true)], billing, fakePlans([growth]));
        const res = await svc.createCheckout(3, { provider: 'paypal', plan: 'growth' });
        expect(res.url).toContain('3:growth');
    });

    it('createCheckout rechaza un plan sin precio en la moneda del proveedor', async () => {
        const { billing } = fakeBilling();
        // starter no tiene precio USD → PayPal (USD) no puede cobrarlo.
        const usdless: PlanPrice = { slug: 'starter', name: 'Starter', usd: null, cop: 59_000 };
        const svc = new PaymentsService(env, [new FakeGateway('paypal', true)], billing, fakePlans([usdless]));
        await expect(svc.createCheckout(1, { provider: 'paypal', plan: 'starter' })).rejects.toThrow();
    });

    it('createCheckout rechaza un proveedor deshabilitado', async () => {
        const { billing } = fakeBilling();
        const svc = new PaymentsService(env, [new FakeGateway('paypal', false)], billing, fakePlans([PRO]));
        await expect(svc.createCheckout(1, { provider: 'paypal', plan: 'pro' })).rejects.toThrow();
    });

    it('handleWebhook aplica el evento al billing del tenant', async () => {
        const { billing, calls } = fakeBilling();
        const event: PaymentEvent = { tenantId: 9, plan: 'pro', status: 'active' };
        const svc = new PaymentsService(env, [new FakeGateway('paypal', true, event)], billing, fakePlans([PRO]));
        await svc.handleWebhook('paypal', {}, '{}');
        expect(calls).toEqual([{ tenantId: 9, input: { plan: 'pro', status: 'active' } }]);
    });

    it('handleWebhook ignora un evento nulo', async () => {
        const { billing, calls } = fakeBilling();
        const svc = new PaymentsService(env, [new FakeGateway('mercadopago', true, null)], billing, fakePlans([]));
        await svc.handleWebhook('mercadopago', {}, '{}');
        expect(calls).toHaveLength(0);
    });
});
