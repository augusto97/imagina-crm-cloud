import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { AutoRenewStatus, BillingPaymentStatus } from '@imagina-base/shared';
import type { MercadoPagoCreds } from '../platform-payments.service';
import {
    decodeReference,
    paymentMethodLabel,
    type CheckoutRequest,
    type CheckoutSession,
    type PaymentGateway,
    type PaymentNotice,
    type SubscriptionRequest,
    type SubscriptionSession,
} from '../payment.types';

export const MP_API = 'https://api.mercadopago.com';

/** De dónde salen las credenciales (consola de Plataforma con respaldo en `.env`). */
export interface MercadoPagoCredsSource {
    mercadoPago(): Promise<MercadoPagoCreds | null>;
    webhookUrl(): string;
}

/**
 * Mercado Pago (v0.1.250). Dos formas de cobrar un plan:
 *
 *  - **Período** (Checkout Pro): una "preference" de N meses. Sirve con PSE,
 *    Nequi, efectivo y tarjeta.
 *  - **Renovación automática** (suscripciones, `/preapproval`): Mercado Pago
 *    cobra la tarjeta todos los meses.
 *
 * Los avisos se verifican con la firma `x-signature` y DESPUÉS se vuelve a
 * leer el recurso desde la API con nuestra clave: el cuerpo del aviso sólo
 * dice "mirá el pago 123", nunca se le cree el estado.
 */
export class MercadoPagoGateway implements PaymentGateway {
    readonly provider = 'mercadopago' as const;
    readonly supportsSubscription = true;
    private readonly logger = new Logger('MercadoPago');

    constructor(
        private readonly source: MercadoPagoCredsSource,
        private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
        private readonly apiBase: string = MP_API,
    ) {}

    async isEnabled(): Promise<boolean> {
        return (await this.source.mercadoPago()) !== null;
    }

    private async creds(): Promise<MercadoPagoCreds> {
        const creds = await this.source.mercadoPago();
        if (!creds) throw new Error('Mercado Pago no está configurado');
        return creds;
    }

    /** La URL de avisos sólo se manda si es pública (https): en desarrollo Mercado Pago la rechaza. */
    private notificationUrl(): string | undefined {
        const url = this.source.webhookUrl();
        return url.startsWith('https://') ? `${url}?source_news=webhooks` : undefined;
    }

    async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
        const { accessToken } = await this.creds();
        const res = await this.fetchImpl(`${this.apiBase}/checkout/preferences`, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                items: [
                    {
                        id: `plan-${req.plan}`,
                        title: req.title,
                        quantity: 1,
                        unit_price: req.amount,
                        currency_id: req.currency,
                    },
                ],
                external_reference: req.reference,
                back_urls: { success: req.returnUrl, failure: req.cancelUrl, pending: req.returnUrl },
                auto_return: 'approved',
                notification_url: this.notificationUrl(),
            }),
        });
        if (!res.ok) throw new Error(`Mercado Pago no creó el pago (${res.status}): ${await safeText(res)}`);
        const body = (await res.json()) as { id: string; init_point: string };
        return { url: body.init_point, externalId: body.id };
    }

    async createSubscription(req: SubscriptionRequest): Promise<SubscriptionSession> {
        const { accessToken } = await this.creds();
        const autoRecurring: Record<string, unknown> = {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: req.amount,
            currency_id: req.currency,
        };
        if (req.startAt && req.startAt.getTime() > Date.now() + 60_000) {
            autoRecurring.start_date = req.startAt.toISOString();
        }
        const res = await this.fetchImpl(`${this.apiBase}/preapproval`, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                reason: req.title,
                external_reference: req.reference,
                payer_email: req.payerEmail,
                auto_recurring: autoRecurring,
                back_url: req.returnUrl,
                status: 'pending',
            }),
        });
        if (!res.ok) throw new Error(`Mercado Pago no creó la suscripción (${res.status}): ${await safeText(res)}`);
        const body = (await res.json()) as MpPreapproval;
        if (!body.id || !body.init_point) throw new Error('Mercado Pago no devolvió el enlace para autorizar la tarjeta');
        return {
            url: body.init_point,
            externalId: body.id,
            status: mapPreapprovalStatus(body.status),
            nextPaymentAt: parseDate(body.next_payment_date),
        };
    }

    async cancelSubscription(externalId: string): Promise<void> {
        const { accessToken } = await this.creds();
        const res = await this.fetchImpl(`${this.apiBase}/preapproval/${encodeURIComponent(externalId)}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled' }),
        });
        if (!res.ok) throw new Error(`Mercado Pago no canceló la renovación (${res.status}): ${await safeText(res)}`);
    }

    async handleWebhook(
        headers: Record<string, string | undefined>,
        rawBody: string,
        query: Record<string, string | undefined>,
    ): Promise<PaymentNotice[]> {
        const creds = await this.source.mercadoPago();
        if (!creds) return [];
        const body = safeJson(rawBody);
        const dataId = query['data.id'] ?? (body?.data?.id !== undefined ? String(body.data.id) : undefined);
        if (!verifyMpSignature(headers, dataId, creds.webhookSecret)) {
            this.logger.warn('firma x-signature inválida — aviso rechazado');
            return [];
        }
        const type = body?.type ?? query.type ?? query.topic;
        if (!dataId || !/^[A-Za-z0-9-]{1,64}$/.test(dataId)) return [];
        try {
            switch (type) {
                case 'payment':
                    return this.fromPayment(creds.accessToken, dataId);
                case 'subscription_preapproval':
                    return this.fromPreapproval(creds.accessToken, dataId);
                case 'subscription_authorized_payment':
                    return this.fromAuthorizedPayment(creds.accessToken, dataId);
                default:
                    return [];
            }
        } catch (err) {
            // Se relanza: el controller responde 500 y Mercado Pago reintenta.
            this.logger.error(`no se pudo leer el ${type} ${dataId}: ${String(err)}`);
            throw err;
        }
    }

    private async get<T>(accessToken: string, path: string): Promise<T> {
        const res = await this.fetchImpl(`${this.apiBase}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
        return (await res.json()) as T;
    }

    private async fromPayment(accessToken: string, id: string): Promise<PaymentNotice[]> {
        const p = await this.get<MpPayment>(accessToken, `/v1/payments/${id}`);
        const ref = p.external_reference ? decodeReference(p.external_reference) : null;
        const subscriptionExternalId =
            p.metadata?.preapproval_id ?? p.point_of_interaction?.transaction_data?.subscription_id ?? undefined;
        if (!ref && !subscriptionExternalId) return [];
        const amount = Number(p.transaction_amount ?? 0);
        const currency = p.currency_id ?? '';
        let status = mapMpPaymentStatus(p.status);
        // Un pago de período tiene que ser POR lo que se cobró: la referencia
        // lleva el monto y la moneda la decide el proveedor (COP).
        if (status === 'approved' && ref?.mode === 'period' && ref.amount !== undefined) {
            if (currency !== 'COP' || amount + 0.5 < ref.amount) {
                this.logger.error(`pago ${id}: monto ${amount} ${currency} no cubre ${ref.amount} COP — no se aplica`);
                status = 'rejected';
            }
        }
        return [
            {
                kind: 'payment',
                tenantId: ref?.tenantId ?? null,
                plan: ref?.plan ?? null,
                mode: ref?.mode ?? 'subscription',
                months: ref?.months ?? 1,
                externalId: String(p.id ?? id),
                status,
                amount,
                currency,
                method: paymentMethodLabel(p.payment_type_id, p.payment_method_id),
                subscriptionExternalId: subscriptionExternalId ? String(subscriptionExternalId) : undefined,
            },
        ];
    }

    private async fromPreapproval(accessToken: string, id: string): Promise<PaymentNotice[]> {
        const s = await this.get<MpPreapproval>(accessToken, `/preapproval/${id}`);
        const ref = s.external_reference ? decodeReference(s.external_reference) : null;
        return [
            {
                kind: 'subscription',
                tenantId: ref?.tenantId ?? null,
                plan: ref?.plan ?? null,
                externalId: s.id ?? id,
                status: mapPreapprovalStatus(s.status),
                amount: Number(s.auto_recurring?.transaction_amount ?? 0),
                currency: s.auto_recurring?.currency_id ?? '',
                nextPaymentAt: parseDate(s.next_payment_date),
                authorizeUrl: s.init_point ?? null,
            },
        ];
    }

    private async fromAuthorizedPayment(accessToken: string, id: string): Promise<PaymentNotice[]> {
        const a = await this.get<MpAuthorizedPayment>(accessToken, `/authorized_payments/${id}`);
        // Una cuota "programada" todavía no intentó cobrar: no hay nada que registrar.
        if (!a.payment?.id || !a.preapproval_id) return [];
        const ref = a.external_reference ? decodeReference(a.external_reference) : null;
        return [
            {
                kind: 'payment',
                tenantId: ref?.tenantId ?? null,
                plan: ref?.plan ?? null,
                mode: 'subscription',
                months: 1,
                // El id del PAGO, no el de la cuota: el mismo cobro llega también
                // por el aviso `payment` y tiene que caer en la misma fila.
                externalId: String(a.payment.id),
                status: mapMpPaymentStatus(a.payment.status),
                amount: Number(a.transaction_amount ?? 0),
                currency: a.currency_id ?? '',
                method: 'Tarjeta (renovación automática)',
                subscriptionExternalId: a.preapproval_id,
            },
        ];
    }
}

/** Estado de un pago de MP → estado en el registro de pagos. */
export function mapMpPaymentStatus(status: string | undefined): BillingPaymentStatus {
    switch (status) {
        case 'approved':
            return 'approved';
        case 'refunded':
        case 'charged_back':
            return 'refunded';
        case 'rejected':
        case 'cancelled':
            return 'rejected';
        default:
            // pending / in_process / authorized / in_mediation: todavía no es plata.
            return 'pending';
    }
}

export function mapPreapprovalStatus(status: string | undefined): AutoRenewStatus {
    switch (status) {
        case 'authorized':
            return 'authorized';
        case 'paused':
            return 'paused';
        case 'cancelled':
            return 'cancelled';
        default:
            return 'pending';
    }
}

/**
 * Verifica la firma `x-signature` de Mercado Pago. Manifest:
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con HMAC-SHA256 y la
 * clave secreta de la integración. El `data.id` va en minúsculas (los ids
 * alfanuméricos de suscripciones llegan en mayúsculas en algunos avisos) y,
 * como pide Mercado Pago, la parte que no vino se omite del manifest.
 * Sin secret configurado no se puede verificar → rechaza.
 */
export function verifyMpSignature(
    headers: Record<string, string | undefined>,
    dataId: string | undefined,
    secret: string,
): boolean {
    if (!secret) return false;
    const sig = headers['x-signature'];
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
    const requestId = headers['x-request-id'];
    const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    return a.length === b.length && timingSafeEqual(a, b);
}

interface MpPayment {
    id?: number | string;
    status?: string;
    external_reference?: string;
    transaction_amount?: number;
    currency_id?: string;
    payment_type_id?: string;
    payment_method_id?: string;
    metadata?: { preapproval_id?: string };
    point_of_interaction?: { transaction_data?: { subscription_id?: string } };
}

interface MpPreapproval {
    id?: string;
    status?: string;
    init_point?: string;
    external_reference?: string;
    next_payment_date?: string;
    auto_recurring?: { transaction_amount?: number; currency_id?: string };
}

interface MpAuthorizedPayment {
    id?: number | string;
    preapproval_id?: string;
    external_reference?: string;
    transaction_amount?: number;
    currency_id?: string;
    payment?: { id?: number | string; status?: string };
}

function parseDate(raw: string | undefined): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function safeText(res: Response): Promise<string> {
    try {
        return (await res.text()).slice(0, 300);
    } catch {
        return '';
    }
}

function safeJson(raw: string): { type?: string; data?: { id?: string | number } } | null {
    try {
        return JSON.parse(raw) as { type?: string; data?: { id?: string | number } };
    } catch {
        return null;
    }
}
