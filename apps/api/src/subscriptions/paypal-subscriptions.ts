import type { SubscriptionChargeStatus, SubscriptionFrequencyType, SubscriptionProviderStatus } from '@imagina-base/shared';
import type { IntegrationRequest } from '../connectors/integration-calls';
import { isPaypalId, num, obj, parseJson, paypalAmountValue, paypalError, str, trimBase } from '../collections/paypal-gateway';
import type { ParsedInvoice } from './subscription-gateway';

/**
 * v0.1.373 (addendum ADR-S96) — Suscripciones de las EMPRESAS con SU cuenta
 * de PayPal: las piezas PURAS de la API de suscripciones (Billing v1). Sin red
 * ni base; el servicio las usa con el cliente de PayPal de los cobros.
 *
 * Lo que cambia respecto de Mercado Pago:
 *
 * 1. PayPal exige un PRODUCTO y un PLAN propios antes de suscribir. La app los
 *    crea la primera vez que hace falta (con clave de idempotencia) y los
 *    recuerda en `subscription_plans.provider_refs`. El plan de PayPal sólo
 *    fija la frecuencia, las cuotas y la moneda: el VALOR va en cada
 *    suscripción (`plan` en línea), así un valor distinto por cliente o un
 *    cambio de precio no obliga a otro plan.
 * 2. La prueba gratis no es un ciclo de PayPal: es un `start_time` a futuro
 *    (igual que en Mercado Pago, el primer cobro es la fecha de inicio).
 * 3. Los cobros se leen de `/transactions`; un cobro FALLIDO no siempre
 *    aparece ahí, sino en `billing_info.last_failed_payment`: se agrega como
 *    un cobro rechazado con su propio id.
 */

/** Hasta cuántos cobros fallidos seguidos PayPal reintenta antes de suspender. */
export const PAYPAL_FAILURE_THRESHOLD = 3;

/** Lo que la app recuerda de PayPal en cada plan: el producto y un plan por forma de cobro. */
export interface PaypalPlanRefs {
    product_id?: string;
    plans?: Record<string, string>;
}

export function readPaypalPlanRefs(raw: unknown): PaypalPlanRefs {
    const o = obj(raw);
    const product = str(o?.product_id);
    const plans: Record<string, string> = {};
    const p = obj(o?.plans);
    if (p) for (const [k, v] of Object.entries(p)) if (isPaypalId(v)) plans[k] = v;
    return { ...(isPaypalId(product) ? { product_id: product } : {}), plans };
}

/**
 * La «forma» del plan en PayPal: lo que no se puede cambiar en una
 * suscripción. Si cambia (otra frecuencia, otras cuotas, otra moneda), hace
 * falta otro plan de PayPal; las suscripciones viejas siguen con el suyo.
 */
export function paypalPlanKey(p: { frequency: number; frequencyType: SubscriptionFrequencyType; cycles: number | null; currency: string }): string {
    const unit = p.frequencyType === 'days' ? 'DAY' : 'MONTH';
    return `${unit}-${p.frequency}-${p.cycles && p.cycles > 0 ? p.cycles : 0}-${p.currency.toUpperCase()}`;
}

function auth(token: string): Record<string, string> {
    return { accept: 'application/json', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

// ── Producto y plan ─────────────────────────────────────────────────────

export function createProductRequest(base: string, token: string, input: { name: string; requestId: string }): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/catalogs/products`,
        method: 'POST',
        headers: { ...auth(token), 'paypal-request-id': input.requestId.slice(0, 108) },
        body: JSON.stringify({ name: input.name.slice(0, 127) || 'Suscripción', type: 'SERVICE', category: 'SOFTWARE' }),
    };
}

export function createBillingPlanRequest(
    base: string,
    token: string,
    input: {
        productId: string;
        name: string;
        amount: number;
        currency: string;
        frequency: number;
        frequencyType: SubscriptionFrequencyType;
        cycles: number | null;
        requestId: string;
    },
): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/billing/plans`,
        method: 'POST',
        headers: { ...auth(token), prefer: 'return=representation', 'paypal-request-id': input.requestId.slice(0, 108) },
        body: JSON.stringify({
            product_id: input.productId,
            name: input.name.slice(0, 127) || 'Plan',
            status: 'ACTIVE',
            billing_cycles: [
                {
                    frequency: { interval_unit: input.frequencyType === 'days' ? 'DAY' : 'MONTH', interval_count: input.frequency },
                    tenure_type: 'REGULAR',
                    sequence: 1,
                    total_cycles: input.cycles && input.cycles > 0 ? input.cycles : 0,
                    pricing_scheme: { fixed_price: { value: paypalAmountValue(input.amount, input.currency), currency_code: input.currency.toUpperCase() } },
                },
            ],
            payment_preferences: {
                // Lo que quedó sin cobrar se suma al próximo cobro (no se pierde).
                auto_bill_outstanding: true,
                setup_fee_failure_action: 'CONTINUE',
                payment_failure_threshold: PAYPAL_FAILURE_THRESHOLD,
            },
        }),
    };
}

/** El id de un producto o plan recién creado (o el motivo). */
export function parseCreatedId(status: number, body: string): { id: string } | { error: string } {
    const json = parseJson(body);
    const id = str(json?.id);
    if ((status === 200 || status === 201) && isPaypalId(id)) return { id };
    return { error: paypalError(status, body) };
}

// ── Suscripción ─────────────────────────────────────────────────────────

export interface PaypalSubscriptionInput {
    planId: string;
    reference: string;
    payerEmail: string;
    amount: number;
    currency: string;
    /** El primer cobro (null = al aprobar). */
    startAt: Date | null;
    brandName: string;
    returnUrl: string;
    cancelUrl: string;
}

export function createPaypalSubscriptionRequest(base: string, token: string, input: PaypalSubscriptionInput, now = new Date()): IntegrationRequest {
    // PayPal rechaza un inicio en el pasado (o «ahora»): sin él cobra al aprobar.
    const start = input.startAt && input.startAt.getTime() > now.getTime() + 60_000 ? input.startAt : null;
    return {
        url: `${trimBase(base)}/v1/billing/subscriptions`,
        method: 'POST',
        headers: { ...auth(token), prefer: 'return=representation', 'paypal-request-id': input.reference },
        body: JSON.stringify({
            plan_id: input.planId,
            custom_id: input.reference,
            ...(start ? { start_time: start.toISOString() } : {}),
            subscriber: { email_address: input.payerEmail },
            // El valor de ESTE cliente (puede ser distinto del valor del plan).
            plan: {
                billing_cycles: [
                    { sequence: 1, pricing_scheme: { fixed_price: { value: paypalAmountValue(input.amount, input.currency), currency_code: input.currency.toUpperCase() } } },
                ],
            },
            application_context: {
                brand_name: input.brandName.slice(0, 127) || undefined,
                user_action: 'SUBSCRIBE_NOW',
                shipping_preference: 'NO_SHIPPING',
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
            },
        }),
    };
}

/** Pendiente → por autorizar; activa → autorizada; suspendida → pausada; cancelada o vencida → cancelada. */
export function mapPaypalSubscriptionStatus(raw: string | null | undefined): SubscriptionProviderStatus {
    switch ((raw ?? '').toUpperCase()) {
        case 'ACTIVE':
            return 'authorized';
        case 'SUSPENDED':
            return 'paused';
        case 'CANCELLED':
        case 'EXPIRED':
            return 'cancelled';
        default:
            return 'pending';
    }
}

export interface ParsedPaypalSubscription {
    externalId: string;
    rawStatus: string;
    providerStatus: SubscriptionProviderStatus;
    reference: string | null;
    url: string | null;
    startAt: Date | null;
    nextPaymentAt: Date | null;
    amount: number | null;
    currency: string | null;
    lastPaymentAt: Date | null;
    failedCount: number;
    lastFailed: { at: Date; amount: number | null; reason: string } | null;
}

function date(v: unknown): Date | null {
    const s = str(v);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function approveUrl(json: Record<string, unknown> | null): string | null {
    const links = Array.isArray(json?.links) ? (json!.links as Array<Record<string, unknown>>) : [];
    const href = str(links.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href);
    return href && /^https?:\/\//.test(href) ? href : null;
}

export function parsePaypalSubscription(status: number, body: string): ParsedPaypalSubscription | null {
    if (status !== 200 && status !== 201) return null;
    const json = parseJson(body);
    const id = str(json?.id);
    if (!json || !isPaypalId(id)) return null;
    const rawStatus = (str(json.status) ?? 'APPROVAL_PENDING').toUpperCase();
    const billing = obj(json.billing_info);
    const lastPayment = obj(billing?.last_payment);
    const lastFailed = obj(billing?.last_failed_payment);
    // El valor de la suscripción: el del plan en línea (con `?fields=plan`) o el último cobro.
    const cycles = Array.isArray(obj(json.plan)?.billing_cycles) ? (obj(json.plan)!.billing_cycles as Array<Record<string, unknown>>) : [];
    const regular = cycles.find((c) => str(c.tenure_type) !== 'TRIAL') ?? cycles[0];
    const price = obj(obj(regular?.pricing_scheme)?.fixed_price);
    const lastAmount = obj(lastPayment?.amount);
    const failedAt = date(lastFailed?.time);
    return {
        externalId: id,
        rawStatus,
        providerStatus: mapPaypalSubscriptionStatus(rawStatus),
        reference: str(json.custom_id),
        url: rawStatus === 'APPROVAL_PENDING' ? approveUrl(json) : null,
        startAt: date(json.start_time),
        nextPaymentAt: date(billing?.next_billing_time),
        amount: num(price?.value) ?? null,
        currency: str(price?.currency_code) ?? str(lastAmount?.currency_code),
        lastPaymentAt: date(lastPayment?.time),
        failedCount: Math.max(0, Math.round(num(billing?.failed_payments_count) ?? 0)),
        lastFailed: failedAt ? { at: failedAt, amount: num(obj(lastFailed?.amount)?.value), reason: paypalFailureReason(str(lastFailed?.reason_code)) } : null,
    };
}

export function parseCreatedPaypalSubscription(status: number, body: string): ParsedPaypalSubscription | { error: string } {
    const parsed = parsePaypalSubscription(status, body);
    if (parsed && parsed.url) return parsed;
    if (parsed) return { error: 'PayPal creó la suscripción pero no devolvió el link para aprobarla. Prueba de nuevo en un momento.' };
    return { error: paypalError(status, body) };
}

export function getPaypalSubscriptionRequest(base: string, token: string, id: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/billing/subscriptions/${encodeURIComponent(id)}?fields=plan,last_failed_payment`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    };
}

export type PaypalSubscriptionAction = 'suspend' | 'activate' | 'cancel';

export function paypalSubscriptionActionRequest(base: string, token: string, id: string, action: PaypalSubscriptionAction, reason: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/billing/subscriptions/${encodeURIComponent(id)}/${action}`,
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ reason: reason.slice(0, 127) || 'Pedido de la empresa' }),
    };
}

/** Cambiar el valor de los próximos cobros (sólo el plan en línea de ESTA suscripción). */
export function paypalPriceRequest(base: string, token: string, id: string, amount: number, currency: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/billing/subscriptions/${encodeURIComponent(id)}`,
        method: 'PATCH',
        headers: auth(token),
        body: JSON.stringify([
            {
                op: 'replace',
                path: '/plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price',
                value: { value: paypalAmountValue(amount, currency), currency_code: currency.toUpperCase() },
            },
        ]),
    };
}

/**
 * Lo que PayPal responde al pausar/reanudar/cancelar algo que ya está en ese
 * estado (o una transición que no admite) es un 422: se traduce.
 */
export function paypalActionError(status: number, body: string): string {
    const json = parseJson(body);
    const issue = Array.isArray(json?.details) ? str((json!.details as Array<Record<string, unknown>>)[0]?.issue) : null;
    if (status === 422 && issue === 'SUBSCRIPTION_STATUS_INVALID') return 'PayPal no permite ese cambio con la suscripción en su estado actual. Toca «Verificar» para ver cómo está.';
    if (status === 422 && issue === 'USER_ACCOUNT_CLOSED') return 'La cuenta PayPal del cliente está cerrada.';
    return paypalError(status, body);
}

// ── Cobros ──────────────────────────────────────────────────────────────

export function paypalTransactionsRequest(base: string, token: string, id: string, from: Date, to: Date): IntegrationRequest {
    const qs = new URLSearchParams({ start_time: from.toISOString(), end_time: to.toISOString() });
    return {
        url: `${trimBase(base)}/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?${qs.toString()}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    };
}

export function mapPaypalTransactionStatus(raw: string | null | undefined): SubscriptionChargeStatus {
    switch ((raw ?? '').toUpperCase()) {
        case 'COMPLETED':
            return 'approved';
        case 'DECLINED':
        case 'FAILED':
            return 'rejected';
        case 'REFUNDED':
        case 'PARTIALLY_REFUNDED':
        case 'REVERSED':
            return 'refunded';
        default:
            return 'pending';
    }
}

/**
 * Los cobros de PayPal como «cuotas» (la forma que entiende el resumen de
 * cobros: cada cobro es su propia cuota). Null si no se pudo leer.
 */
export function parsePaypalTransactions(status: number, body: string, subscriptionId: string): ParsedInvoice[] | null {
    if (status === 404) return [];
    if (status !== 200) return null;
    const json = parseJson(body);
    const list = Array.isArray(json?.transactions) ? (json!.transactions as Array<Record<string, unknown>>) : [];
    const out: ParsedInvoice[] = [];
    for (const t of list) {
        const id = str(t.id);
        if (!isPaypalId(id)) continue;
        const gross = obj(obj(t.amount_with_breakdown)?.gross_amount);
        const when = date(t.time);
        const st = mapPaypalTransactionStatus(str(t.status));
        out.push({
            invoiceId: id,
            preapprovalId: subscriptionId,
            status: 'processed',
            debitDate: when,
            createdAt: when,
            updatedAt: when,
            retryAttempt: null,
            amount: num(gross?.value) ?? 0,
            currency: (str(gross?.currency_code) ?? '').toUpperCase(),
            paymentId: id,
            paymentStatus: st,
            failureReason: st === 'rejected' ? 'PayPal rechazó el cobro.' : null,
        });
    }
    return out;
}

/** El cobro fallido que PayPal informa aparte, como un cobro rechazado con su id propio. */
export function failedPaymentCharge(sub: ParsedPaypalSubscription, currency: string): ParsedInvoice | null {
    if (!sub.lastFailed) return null;
    const id = `fail-${sub.lastFailed.at.getTime().toString(36)}`;
    return {
        invoiceId: id,
        preapprovalId: sub.externalId,
        status: 'processed',
        debitDate: sub.lastFailed.at,
        createdAt: sub.lastFailed.at,
        updatedAt: sub.lastFailed.at,
        retryAttempt: sub.failedCount || null,
        amount: sub.lastFailed.amount ?? 0,
        currency: currency.toUpperCase(),
        paymentId: id,
        paymentStatus: 'rejected',
        failureReason: sub.lastFailed.reason,
    };
}

/**
 * El estado del cobro según PayPal. Si lo último que pasó fue un fallo:
 * mientras no llegue al tope PayPal REINTENTA (sigue activa); al tope la
 * SUSPENDE — y eso no es «pausada» (nadie la pausó): es mora.
 */
export function paypalChargeState(sub: ParsedPaypalSubscription): {
    providerStatus: SubscriptionProviderStatus;
    retrying: boolean;
    failedFinal: boolean;
} {
    const lastFailedWins = Boolean(sub.lastFailed && (!sub.lastPaymentAt || sub.lastFailed.at.getTime() > sub.lastPaymentAt.getTime()));
    if (sub.rawStatus === 'SUSPENDED' && lastFailedWins && sub.failedCount >= PAYPAL_FAILURE_THRESHOLD) {
        return { providerStatus: 'authorized', retrying: false, failedFinal: true };
    }
    if (sub.rawStatus === 'ACTIVE' && lastFailedWins) {
        return { providerStatus: 'authorized', retrying: sub.failedCount < PAYPAL_FAILURE_THRESHOLD, failedFinal: sub.failedCount >= PAYPAL_FAILURE_THRESHOLD };
    }
    return { providerStatus: sub.providerStatus, retrying: false, failedFinal: false };
}

/** Por qué falló un cobro de PayPal, en palabras. */
export function paypalFailureReason(code: string | null): string {
    switch ((code ?? '').toUpperCase()) {
        case 'PAYMENT_DENIED':
            return 'PayPal rechazó el cobro.';
        case 'PAYER_CANNOT_PAY':
        case 'PAYER_ACCOUNT_RESTRICTED':
            return 'La cuenta PayPal del cliente no puede pagar (restringida o sin fondos).';
        case 'PAYER_ACCOUNT_LOCKED_OR_CLOSED':
            return 'La cuenta PayPal del cliente está bloqueada o cerrada.';
        case 'PAYEE_ACCOUNT_RESTRICTED':
        case 'PAYEE_ACCOUNT_LOCKED_OR_CLOSED':
            return 'Tu cuenta de PayPal está restringida: revísala en paypal.com.';
        case 'TRANSACTION_RECEIVING_LIMIT_EXCEEDED':
        case 'SENDING_LIMIT_EXCEEDED':
            return 'Se superó un límite de la cuenta de PayPal.';
        case 'CURRENCY_MISMATCH':
            return 'Tu cuenta de PayPal no recibe esa moneda.';
        case 'INSTRUMENT_DECLINED':
        case 'CARD_ATTEMPT_INVALID':
            return 'El banco rechazó la tarjeta del cliente.';
        default:
            return code ? `PayPal no pudo cobrar (${code}).` : 'PayPal no pudo cobrar.';
    }
}

// ── Avisos ──────────────────────────────────────────────────────────────

/** De qué suscripción habla un aviso de PayPal (o null si no es de suscripciones). */
export type PaypalSubscriptionNotice = { kind: 'subscription'; id: string } | { kind: 'sale'; saleId: string; subscriptionId: string | null };

export function paypalSubscriptionNotice(body: unknown): PaypalSubscriptionNotice | null {
    const b = obj(body);
    const type = str(b?.event_type) ?? '';
    const resource = obj(b?.resource);
    if (!resource) return null;
    if (type.startsWith('BILLING.SUBSCRIPTION.')) {
        const id = str(resource.id);
        return isPaypalId(id) ? { kind: 'subscription', id } : null;
    }
    if (type.startsWith('PAYMENT.SALE.')) {
        const agreement = str(resource.billing_agreement_id);
        // Un reembolso trae el reembolso: su venta está en `sale_id`.
        const saleId = str(resource.sale_id) ?? str(resource.id);
        if (isPaypalId(agreement)) return { kind: 'subscription', id: agreement };
        return isPaypalId(saleId) ? { kind: 'sale', saleId, subscriptionId: null } : null;
    }
    return null;
}

export function paypalSaleRequest(base: string, token: string, saleId: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/payments/sale/${encodeURIComponent(saleId)}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    };
}

/** La suscripción de una venta (null si la venta no es de una suscripción). */
export function parseSaleSubscription(status: number, body: string): string | null {
    if (status !== 200) return null;
    const id = str(parseJson(body)?.billing_agreement_id);
    return isPaypalId(id) ? id : null;
}
