import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Currency, PlanPrice } from '@imagina-base/shared';
import { loadEnv } from '../src/config/env';
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
import { mapPayPalEvent } from '../src/payments/providers/paypal.provider';

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
