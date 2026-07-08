import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { BillingStatus } from '@imagina-base/shared';
import type { Env } from '../../config/env';
import {
    decodeReference,
    type CheckoutRequest,
    type CheckoutSession,
    type PaymentEvent,
    type PaymentGateway,
} from '../payment.types';

const MP_API = 'https://api.mercadopago.com';

/**
 * Mercado Pago (Checkout Pro). Crea una "preference" y devuelve su `init_point`.
 * El webhook se verifica con la firma `x-signature` (HMAC-SHA256 sobre el
 * manifest `id:...;request-id:...;ts:...;`). Al recibir un pago, consulta su
 * estado y lo mapea a plan/estado del tenant vía `external_reference`.
 */
export class MercadoPagoGateway implements PaymentGateway {
    readonly provider = 'mercadopago' as const;
    private readonly logger = new Logger('MercadoPago');

    constructor(private readonly env: Env) {}

    get enabled(): boolean {
        return this.env.MERCADOPAGO_ACCESS_TOKEN !== '';
    }

    async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
        if (!this.enabled) throw new Error('Mercado Pago no está configurado');
        const res = await fetch(`${MP_API}/checkout/preferences`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${this.env.MERCADOPAGO_ACCESS_TOKEN}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                items: [
                    {
                        title: `Imagina Base — plan ${req.plan}`,
                        quantity: 1,
                        unit_price: req.amount,
                        currency_id: req.currency,
                    },
                ],
                external_reference: req.reference,
                back_urls: { success: req.returnUrl, failure: req.cancelUrl, pending: req.returnUrl },
                auto_return: 'approved',
                // notification_url (webhook) se registra en el panel de Mercado
                // Pago apuntando a POST /api/v1/billing/webhook/mercadopago (runbook).
            }),
        });
        if (!res.ok) {
            throw new Error(`Mercado Pago preferences ${res.status}: ${await res.text()}`);
        }
        const body = (await res.json()) as { id: string; init_point: string };
        return { url: body.init_point, externalId: body.id };
    }

    async handleWebhook(
        headers: Record<string, string | undefined>,
        rawBody: string,
    ): Promise<PaymentEvent | null> {
        if (!this.enabled) return null;
        const dataId = extractDataId(rawBody, headers);
        if (!verifyMpSignature(headers, dataId, this.env.MERCADOPAGO_WEBHOOK_SECRET)) {
            this.logger.warn('firma x-signature inválida — webhook rechazado');
            return null;
        }
        const parsed = safeJson(rawBody);
        if (parsed?.type !== 'payment' || !dataId) return null;

        // Consultamos el pago para conocer su estado y external_reference.
        const res = await fetch(`${MP_API}/v1/payments/${dataId}`, {
            headers: { authorization: `Bearer ${this.env.MERCADOPAGO_ACCESS_TOKEN}` },
        });
        if (!res.ok) {
            this.logger.error(`no se pudo leer el pago ${dataId}: ${res.status}`);
            return null;
        }
        const payment = (await res.json()) as { status: string; external_reference?: string };
        const ref = payment.external_reference ? decodeReference(payment.external_reference) : null;
        if (!ref) return null;
        return { tenantId: ref.tenantId, plan: ref.plan, status: mapMpStatus(payment.status) };
    }
}

/** Estado de pago de MP → estado de billing. */
export function mapMpStatus(status: string): BillingStatus {
    switch (status) {
        case 'approved':
            return 'active';
        case 'refunded':
        case 'charged_back':
        case 'cancelled':
            return 'canceled';
        default:
            // pending / in_process / rejected: aún sin acceso de escritura.
            return 'past_due';
    }
}

/**
 * Verifica la firma `x-signature` de Mercado Pago. Manifest:
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con HMAC-SHA256 y el secret.
 * Sin secret configurado, no se puede verificar → rechaza.
 */
export function verifyMpSignature(
    headers: Record<string, string | undefined>,
    dataId: string | undefined,
    secret: string,
): boolean {
    if (!secret) return false;
    const sig = headers['x-signature'];
    const requestId = headers['x-request-id'] ?? '';
    if (!sig || !dataId) return false;
    const parts = Object.fromEntries(
        sig.split(',').map((kv) => {
            const [k, v] = kv.split('=');
            return [k?.trim() ?? '', v?.trim() ?? ''];
        }),
    );
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** `data.id` viene en el body o en el query (?data.id=). MP manda ambos formatos. */
function extractDataId(rawBody: string, headers: Record<string, string | undefined>): string | undefined {
    const parsed = safeJson(rawBody);
    const fromBody = parsed?.data?.id;
    if (fromBody) return String(fromBody);
    // Fallback: algunos envíos traen el id en el header custom.
    return headers['x-data-id'];
}

function safeJson(raw: string): { type?: string; data?: { id?: string | number } } | null {
    try {
        return JSON.parse(raw) as { type?: string; data?: { id?: string | number } };
    } catch {
        return null;
    }
}
