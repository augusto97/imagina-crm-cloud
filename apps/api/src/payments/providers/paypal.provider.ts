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

const PAYPAL_API = {
    sandbox: 'https://api-m.sandbox.paypal.com',
    live: 'https://api-m.paypal.com',
};

/**
 * PayPal (Orders API v2). Crea una orden y devuelve el link `approve` para
 * redirigir. El webhook se verifica llamando a la API oficial
 * `verify-webhook-signature` (PayPal firma con cert rotativo, no con un secret
 * estático).
 *
 * SEC-29 (v0.1.228): una orden APROBADA todavía no es un pago — con
 * `intent: CAPTURE` la plata sólo se mueve cuando el comercio la CAPTURA.
 * Antes el plan se activaba con `CHECKOUT.ORDER.APPROVED` y nadie capturaba
 * nunca: el cliente aprobaba, se llevaba el plan y no se le cobraba. Ahora la
 * aprobación dispara la captura y el plan se activa sólo si PayPal confirma
 * la captura como COMPLETED.
 */
export class PayPalGateway implements PaymentGateway {
    readonly provider = 'paypal' as const;
    private readonly logger = new Logger('PayPal');

    constructor(
        private readonly env: Env,
        private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    ) {}

    get enabled(): boolean {
        return this.env.PAYPAL_CLIENT_ID !== '' && this.env.PAYPAL_CLIENT_SECRET !== '';
    }

    private get base(): string {
        return PAYPAL_API[this.env.PAYPAL_ENV];
    }

    private async token(): Promise<string> {
        const creds = Buffer.from(
            `${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_CLIENT_SECRET}`,
        ).toString('base64');
        const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                authorization: `Basic ${creds}`,
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        if (!res.ok) throw new Error(`PayPal oauth ${res.status}`);
        return ((await res.json()) as { access_token: string }).access_token;
    }

    async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
        if (!this.enabled) throw new Error('PayPal no está configurado');
        const accessToken = await this.token();
        const res = await this.fetchImpl(`${this.base}/v2/checkout/orders`, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        custom_id: req.reference,
                        description: `Imagina Base — plan ${req.plan}`,
                        amount: { currency_code: req.currency, value: req.amount.toFixed(2) },
                    },
                ],
                application_context: {
                    brand_name: 'Imagina Base',
                    return_url: req.returnUrl,
                    cancel_url: req.cancelUrl,
                    user_action: 'PAY_NOW',
                },
            }),
        });
        if (!res.ok) throw new Error(`PayPal orders ${res.status}: ${await res.text()}`);
        const order = (await res.json()) as { id: string; links: Array<{ rel: string; href: string }> };
        const approve = order.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
        if (!approve) throw new Error('PayPal no devolvió link de aprobación');
        return { url: approve.href, externalId: order.id };
    }

    async handleWebhook(
        headers: Record<string, string | undefined>,
        rawBody: string,
    ): Promise<PaymentEvent | null> {
        if (!this.enabled || !this.env.PAYPAL_WEBHOOK_ID) return null;
        const event = safeJson(rawBody);
        if (!event) return null;

        const verified = await this.verify(headers, rawBody);
        if (!verified) {
            this.logger.warn('firma de webhook inválida — rechazado');
            return null;
        }

        const customId = extractCustomId(event);
        const ref = customId ? decodeReference(customId) : null;
        if (!ref) return null;

        if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
            const orderId = event.resource?.id;
            if (typeof orderId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(orderId)) return null;
            const captured = await this.capture(orderId);
            if (!captured) return null;
            return { tenantId: ref.tenantId, plan: ref.plan, status: 'active' };
        }
        // Una captura "completada" que no dice COMPLETED (p. ej. PENDING por
        // revisión de PayPal) todavía no es plata cobrada.
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && event.resource?.status !== undefined && event.resource.status !== 'COMPLETED') {
            return null;
        }
        const status = mapPayPalEvent(event.event_type);
        if (!status) return null;
        return { tenantId: ref.tenantId, plan: ref.plan, status };
    }

    /**
     * Captura la orden aprobada. Idempotente: si otra entrega del mismo aviso
     * ya la capturó (PayPal reintenta), se consulta el estado de la orden en
     * vez de fallar. Sólo `COMPLETED` cuenta como cobrado.
     */
    private async capture(orderId: string): Promise<boolean> {
        try {
            const accessToken = await this.token();
            const res = await this.fetchImpl(`${this.base}/v2/checkout/orders/${orderId}/capture`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${accessToken}`,
                    'content-type': 'application/json',
                    // Misma clave para los reintentos: PayPal no captura dos veces.
                    'paypal-request-id': `capture-${orderId}`,
                },
                body: '{}',
            });
            if (res.ok) {
                return ((await res.json()) as { status?: string }).status === 'COMPLETED';
            }
            if (res.status === 422) {
                const order = await this.fetchImpl(`${this.base}/v2/checkout/orders/${orderId}`, {
                    headers: { authorization: `Bearer ${accessToken}` },
                });
                if (order.ok) return ((await order.json()) as { status?: string }).status === 'COMPLETED';
            }
            this.logger.warn(`no se pudo capturar la orden ${orderId}: ${res.status}`);
            return false;
        } catch (err) {
            this.logger.error(`captura de la orden ${orderId} falló: ${String(err)}`);
            return false;
        }
    }

    /** Verificación oficial: PayPal confirma la firma del webhook por API. */
    private async verify(headers: Record<string, string | undefined>, rawBody: string): Promise<boolean> {
        try {
            const accessToken = await this.token();
            const res = await this.fetchImpl(`${this.base}/v1/notifications/verify-webhook-signature`, {
                method: 'POST',
                headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    auth_algo: headers['paypal-auth-algo'],
                    cert_url: headers['paypal-cert-url'],
                    transmission_id: headers['paypal-transmission-id'],
                    transmission_sig: headers['paypal-transmission-sig'],
                    transmission_time: headers['paypal-transmission-time'],
                    webhook_id: this.env.PAYPAL_WEBHOOK_ID,
                    webhook_event: JSON.parse(rawBody),
                }),
            });
            if (!res.ok) return false;
            return ((await res.json()) as { verification_status: string }).verification_status === 'SUCCESS';
        } catch (err) {
            this.logger.error(`verify-webhook-signature falló: ${String(err)}`);
            return false;
        }
    }
}

/** Evento de PayPal → estado de billing (sólo los que cambian el estado). */
export function mapPayPalEvent(eventType: string | undefined): BillingStatus | null {
    switch (eventType) {
        // `CHECKOUT.ORDER.APPROVED` NO está acá a propósito: aprobar no es
        // pagar (ver `handleWebhook`, que captura antes de activar).
        case 'PAYMENT.CAPTURE.COMPLETED':
        case 'BILLING.SUBSCRIPTION.ACTIVATED':
            return 'active';
        case 'PAYMENT.CAPTURE.DENIED':
        case 'BILLING.SUBSCRIPTION.SUSPENDED':
            return 'past_due';
        case 'BILLING.SUBSCRIPTION.CANCELLED':
        case 'PAYMENT.CAPTURE.REFUNDED':
            return 'canceled';
        default:
            return null;
    }
}

/** El `custom_id` (nuestra referencia) viaja en el purchase_unit del recurso. */
function extractCustomId(event: PayPalEvent): string | undefined {
    const resource = event.resource;
    if (!resource) return undefined;
    if (typeof resource.custom_id === 'string') return resource.custom_id;
    const unit = resource.purchase_units?.[0];
    return unit?.custom_id;
}

interface PayPalEvent {
    event_type?: string;
    resource?: {
        id?: string;
        status?: string;
        custom_id?: string;
        purchase_units?: Array<{ custom_id?: string }>;
    };
}

function safeJson(raw: string): PayPalEvent | null {
    try {
        return JSON.parse(raw) as PayPalEvent;
    } catch {
        return null;
    }
}
