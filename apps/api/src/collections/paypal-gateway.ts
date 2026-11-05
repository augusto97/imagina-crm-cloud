import { PAYPAL_ZERO_DECIMAL_CURRENCIES, type PaymentLinkStatus } from '@imagina-base/shared';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';
import type { GatewayPayment } from './collection-gateways';

/**
 * v0.1.372 — PayPal como cobro de la EMPRESA (no confundir con el PayPal de la
 * plataforma, `payments/providers/paypal.provider.ts`, que cobra los planes).
 * Las piezas PURAS de su API: el token, la orden (Orders v2), la captura, la
 * lectura de un aviso y el registro del webhook. Sin red ni base: el servicio
 * las usa con `safeWebhookFetch` y los tests las prueban contra la forma real.
 *
 * Tres cosas de PayPal que cambian el diseño respecto de Mercado Pago:
 *
 * 1. APROBAR NO ES PAGAR. Con `intent: CAPTURE` el dinero se mueve recién
 *    cuando el comercio CAPTURA la orden aprobada (la lección de SEC-29). La
 *    app captura al volver el cliente, al llegar el aviso de aprobación y al
 *    tocar «Verificar» — con la misma clave de idempotencia, así nunca dos
 *    veces.
 * 2. UNA ORDEN NO ES UN LINK. Una orden sin aprobar vence en horas y no hay
 *    forma de buscar las órdenes de un link. Por eso el link que se manda es
 *    NUESTRO (`/api/v1/public/pay/<referencia>`): al abrirlo se reusa la orden
 *    reciente o se crea una nueva, y el link guarda las órdenes que creó.
 * 3. El token se pide con el Client ID y el Secret (client credentials) y dura
 *    horas: el servicio lo guarda en memoria.
 */

export const PAYPAL_LIVE = 'https://api-m.paypal.com';
export const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com';

/** Una orden de PayPal sin aprobar se reusa hasta esta edad; después se crea otra. */
export const PAYPAL_ORDER_REUSE_MS = 60 * 60 * 1000;

/** Cuántas órdenes recuerda un link (las más nuevas). */
export const PAYPAL_MAX_ORDERS = 10;

/**
 * Los avisos que la app registra en la cuenta. Los de suscripciones se dejan
 * listos para cuando PayPal también cobre suscripciones (llegan y se ignoran).
 */
export const PAYPAL_WEBHOOK_EVENTS = [
    'CHECKOUT.ORDER.APPROVED',
    'CHECKOUT.ORDER.COMPLETED',
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.CAPTURE.PENDING',
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.CAPTURE.DECLINED',
    'PAYMENT.CAPTURE.REFUNDED',
    'PAYMENT.CAPTURE.REVERSED',
    'BILLING.SUBSCRIPTION.ACTIVATED',
    'BILLING.SUBSCRIPTION.UPDATED',
    'BILLING.SUBSCRIPTION.SUSPENDED',
    'BILLING.SUBSCRIPTION.CANCELLED',
    'BILLING.SUBSCRIPTION.EXPIRED',
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    'PAYMENT.SALE.COMPLETED',
    'PAYMENT.SALE.DENIED',
    'PAYMENT.SALE.REFUNDED',
    'PAYMENT.SALE.REVERSED',
] as const;

/** Las órdenes que creó un link (en `payment_links.provider_orders`). */
export interface PaypalOrderRef {
    id: string;
    approve_url: string;
    created_at: string;
    /** El cliente ya hizo algo con ella (la aprobó, se cobró, se anuló): no se reusa. */
    done?: boolean;
}

export function paypalEnv(creds: IntegrationCreds): 'live' | 'sandbox' {
    return creds.fields.env === 'sandbox' ? 'sandbox' : 'live';
}

export function trimBase(url: string): string {
    return url.replace(/\/+$/, '');
}

export function parseJson(body: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(body) as unknown;
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export function str(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
}

export function num(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

export function obj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Un id de orden, captura o webhook de PayPal (letras, números y guiones). */
export function isPaypalId(v: unknown): v is string {
    return typeof v === 'string' && /^[A-Za-z0-9-]{4,64}$/.test(v);
}

// ── Token ───────────────────────────────────────────────────────────────

export function paypalTokenRequest(clientId: string, secret: string, base: string): IntegrationRequest {
    const basic = Buffer.from(`${clientId.trim()}:${secret.trim()}`).toString('base64');
    return {
        url: `${trimBase(base)}/v1/oauth2/token`,
        method: 'POST',
        headers: {
            accept: 'application/json',
            authorization: `Basic ${basic}`,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    };
}

export type PaypalTokenResult =
    | { token: string; expiresIn: number }
    | { error: string; invalidClient: boolean };

export function parsePaypalToken(status: number, body: string): PaypalTokenResult {
    const json = parseJson(body);
    const token = str(json?.access_token);
    if (status === 200 && token) {
        return { token, expiresIn: Math.max(60, num(json?.expires_in) ?? 3600) };
    }
    // `invalid_client` = ese Client ID no existe en ESTE ambiente (o el Secret no es el suyo).
    const code = str(json?.error);
    if (status === 401 || code === 'invalid_client') {
        return { error: 'PayPal no reconoce ese Client ID con ese Secret. Cópialos de nuevo de la misma app.', invalidClient: true };
    }
    return { error: paypalError(status, body), invalidClient: false };
}

/** El mensaje de error de PayPal, legible. */
export function paypalError(status: number, body: string): string {
    const json = parseJson(body);
    if (status === 401) return 'PayPal rechazó la credencial (¿cambiaste el Secret o borraste la app?). Vuelve a conectar la cuenta en Integraciones.';
    if (status === 403) return 'Tu cuenta de PayPal no tiene permiso para cobrar con esta app. Revisa en developer.paypal.com que la app tenga «Accept payments» activado.';
    const details = Array.isArray(json?.details)
        ? (json!.details as Array<Record<string, unknown>>)
              .map((d) => str(d.description) ?? str(d.issue))
              .filter((s): s is string => s !== null)
              .join('; ')
        : '';
    const message = str(json?.message) ?? str(json?.error_description) ?? str(json?.name) ?? str(json?.error);
    return `PayPal respondió ${status}${message ? `: ${message}` : ''}${details ? ` (${details})` : ''}.`;
}

// ── Orden ───────────────────────────────────────────────────────────────

/** El monto como lo pide PayPal: con dos decimales, o sin ellos en JPY, HUF y TWD. */
export function paypalAmountValue(amount: number, currency: string): string {
    const zero = PAYPAL_ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase());
    return zero ? String(Math.round(amount)) : (Math.round(amount * 100) / 100).toFixed(2);
}

export interface PaypalOrderInput {
    reference: string;
    title: string;
    amount: number;
    currency: string;
    payerEmail: string | null;
    /** Adónde vuelve el cliente al aprobar (la app captura ahí). */
    returnUrl: string;
    cancelUrl: string;
    /** El nombre que ve el cliente en PayPal (el de la empresa). */
    brandName: string | null;
}

export function createOrderRequest(base: string, token: string, input: PaypalOrderInput, requestId: string): IntegrationRequest {
    const paypal: Record<string, unknown> = {
        experience_context: {
            ...(input.brandName ? { brand_name: input.brandName.slice(0, 127) } : {}),
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            landing_page: 'NO_PREFERENCE',
            // Sin cheques electrónicos: un pago que tarda días en confirmarse no sirve para un cobro.
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
        },
    };
    if (input.payerEmail) paypal.email_address = input.payerEmail;
    const body = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                reference_id: input.reference,
                custom_id: input.reference,
                description: input.title.slice(0, 127),
                amount: { currency_code: input.currency.toUpperCase(), value: paypalAmountValue(input.amount, input.currency) },
            },
        ],
        payment_source: { paypal },
    };
    return {
        url: `${trimBase(base)}/v2/checkout/orders`,
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            // Un reintento del mismo pedido no crea otra orden.
            'paypal-request-id': requestId,
            prefer: 'return=representation',
        },
        body: JSON.stringify(body),
    };
}

function approveLink(json: Record<string, unknown>): string | null {
    const links = Array.isArray(json.links) ? (json.links as Array<Record<string, unknown>>) : [];
    const hit = links.find((l) => l.rel === 'payer-action') ?? links.find((l) => l.rel === 'approve');
    const href = str(hit?.href);
    return href && /^https?:\/\//.test(href) ? href : null;
}

export function parseCreatedOrder(status: number, body: string): { orderId: string; approveUrl: string } | { error: string } {
    const json = parseJson(body);
    if (status < 200 || status >= 300 || !json) return { error: paypalError(status, body) };
    const id = str(json.id);
    const url = approveLink(json);
    if (!isPaypalId(id) || !url) return { error: 'PayPal no devolvió el link para pagar.' };
    return { orderId: id, approveUrl: url };
}

export function getOrderRequest(base: string, token: string, orderId: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    };
}

/** Captura una orden aprobada. Idempotente por `paypal-request-id`. */
export function captureOrderRequest(base: string, token: string, orderId: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'paypal-request-id': `capture-${orderId}`,
            prefer: 'return=representation',
        },
        body: '{}',
    };
}

export function getCaptureRequest(base: string, token: string, captureId: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v2/payments/captures/${encodeURIComponent(captureId)}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    };
}

/** De una captura, la orden a la que pertenece. */
export function parseCaptureOrderId(status: number, body: string): string | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    const id = str(obj(obj(json?.supplementary_data)?.related_ids)?.order_id);
    return isPaypalId(id) ? id : null;
}

const CAPTURE_STATUS: Record<string, PaymentLinkStatus> = {
    COMPLETED: 'approved',
    PARTIALLY_REFUNDED: 'approved',
    REFUNDED: 'refunded',
    PENDING: 'pending',
    DECLINED: 'rejected',
    FAILED: 'rejected',
};

const PENDING_REASON: Record<string, string> = {
    PENDING_REVIEW: 'PayPal está revisando el pago',
    ECHECK: 'es un cheque electrónico: tarda unos días en confirmarse',
    RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION: 'hay que aceptarlo a mano en tu cuenta de PayPal (moneda distinta a la de tu cuenta)',
    UNILATERAL: 'la cuenta de PayPal que cobra todavía no está confirmada',
    VERIFICATION_REQUIRED: 'PayPal pide verificar la cuenta que cobra',
    BUYER_COMPLAINT: 'el cliente abrió un reclamo',
    CHARGEBACK: 'el cliente desconoció el pago con su banco',
};

const METHOD: Record<string, string> = {
    paypal: 'Cuenta PayPal',
    card: 'Tarjeta (PayPal)',
    venmo: 'Venmo',
    apple_pay: 'Apple Pay',
    google_pay: 'Google Pay',
    paylater: 'Paga después (PayPal)',
};

/** Cómo quedó una orden de PayPal, en nuestros términos. */
export interface PaypalOrderView {
    orderId: string;
    /** El estado de la ORDEN: CREATED, APPROVED, COMPLETED, VOIDED… */
    status: string;
    /** Nuestra referencia (`ib_…`), la que une la orden al link. */
    reference: string | null;
    approveUrl: string | null;
    /** Aprobada por el cliente y sin capturar: hay que capturarla. */
    needsCapture: boolean;
    /** El pago (null = el cliente todavía no hizo nada con esta orden). */
    payment: GatewayPayment | null;
}

export function parseOrder(status: number, body: string): PaypalOrderView | null {
    if (status !== 200 && status !== 201) return null;
    const json = parseJson(body);
    if (!json) return null;
    const orderId = str(json.id);
    const orderStatus = str(json.status) ?? '';
    if (!isPaypalId(orderId)) return null;
    const units = Array.isArray(json.purchase_units) ? (json.purchase_units as unknown[]) : [];
    const unit = obj(units[0]);
    const reference = str(unit?.custom_id) ?? str(unit?.reference_id);
    const source = obj(json.payment_source);
    const methodKey = source ? Object.keys(source)[0] : undefined;
    const method = methodKey ? (METHOD[methodKey] ?? 'PayPal') : 'PayPal';
    const captures = Array.isArray(obj(unit?.payments)?.captures) ? (obj(unit?.payments)!.captures as unknown[]) : [];
    // Con varias capturas (un reintento tras un rechazo), cuenta la que cobró.
    const parsed = captures.map((c) => obj(c)).filter((c): c is Record<string, unknown> => c !== null);
    const capture = parsed.find((c) => str(c.status) === 'COMPLETED' || str(c.status) === 'PARTIALLY_REFUNDED' || str(c.status) === 'REFUNDED') ?? parsed[parsed.length - 1] ?? null;
    let payment: GatewayPayment | null = null;
    if (capture) {
        const raw = str(capture.status) ?? '';
        const st = CAPTURE_STATUS[raw] ?? 'pending';
        const amount = obj(capture.amount);
        const reason = str(obj(capture.status_details)?.reason);
        const when = str(capture.create_time) ?? str(capture.update_time);
        let note: string | null = null;
        if (st === 'pending') note = `Pendiente: ${reason ? (PENDING_REASON[reason] ?? reason) : 'PayPal todavía no confirma el pago'}.`;
        if (st === 'rejected') note = 'Rechazado: PayPal no aprobó el cobro.';
        if (raw === 'PARTIALLY_REFUNDED') note = 'Se reembolsó una parte del pago en PayPal.';
        payment = {
            paymentId: orderId,
            status: st,
            amount: num(amount?.value) ?? 0,
            currency: (str(amount?.currency_code) ?? '').toUpperCase(),
            paidAt: (st === 'approved' || st === 'refunded') && when ? new Date(when) : null,
            method,
            linkRef: reference,
            note,
        };
    } else if (orderStatus === 'APPROVED') {
        payment = {
            paymentId: orderId,
            status: 'pending',
            amount: num(obj(unit?.amount)?.value) ?? 0,
            currency: (str(obj(unit?.amount)?.currency_code) ?? '').toUpperCase(),
            paidAt: null,
            method,
            linkRef: reference,
            note: 'El cliente aprobó el pago; falta confirmarlo con PayPal.',
        };
    }
    return {
        orderId,
        status: orderStatus,
        reference,
        approveUrl: approveLink(json),
        needsCapture: orderStatus === 'APPROVED' && parsed.length === 0,
        payment,
    };
}

// ── Avisos ──────────────────────────────────────────────────────────────

export type PaypalNotice =
    | { kind: 'order'; orderId: string }
    | { kind: 'capture'; captureId: string; orderId: string | null }
    | { kind: 'other'; eventType: string };

/**
 * Del aviso sólo se toman IDS: qué orden (o qué captura) mirar. El estado se
 * RELEE de PayPal con la credencial de la empresa — un aviso falso a lo sumo
 * hace que la app pregunte por una orden que no es suya (y PayPal no se la da).
 */
export function paypalNotice(body: unknown): PaypalNotice | null {
    const b = obj(body);
    const type = str(b?.event_type);
    const resource = obj(b?.resource);
    if (!type || !resource) return null;
    if (type.startsWith('CHECKOUT.ORDER.')) {
        const id = str(resource.id);
        return isPaypalId(id) ? { kind: 'order', orderId: id } : null;
    }
    if (type.startsWith('PAYMENT.CAPTURE.')) {
        const related = str(obj(obj(resource.supplementary_data)?.related_ids)?.order_id);
        const links = Array.isArray(resource.links) ? (resource.links as Array<Record<string, unknown>>) : [];
        // Un reembolso trae el reembolso: su captura está en el link «up».
        const up = str(links.find((l) => l.rel === 'up')?.href);
        const fromUp = up ? /\/captures\/([A-Za-z0-9-]{4,64})/.exec(up)?.[1] ?? null : null;
        const captureId = fromUp ?? str(resource.id);
        if (!isPaypalId(captureId)) return null;
        return { kind: 'capture', captureId, orderId: isPaypalId(related) && !fromUp ? related : null };
    }
    return { kind: 'other', eventType: type };
}

// ── Webhook ─────────────────────────────────────────────────────────────

export function listWebhooksRequest(base: string, token: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/notifications/webhooks`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    };
}

/** El id del webhook de la cuenta que ya apunta a esa URL (o null). */
export function findWebhook(status: number, body: string, url: string): string | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    const list = Array.isArray(json?.webhooks) ? (json!.webhooks as Array<Record<string, unknown>>) : [];
    const hit = list.find((w) => str(w.url) === url);
    const id = str(hit?.id);
    return isPaypalId(id) ? id : null;
}

export function createWebhookRequest(base: string, token: string, url: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/notifications/webhooks`,
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })) }),
    };
}

export function parseCreatedWebhook(status: number, body: string): { id: string } | { error: string; exists: boolean } {
    const json = parseJson(body);
    const id = str(json?.id);
    if ((status === 200 || status === 201) && isPaypalId(id)) return { id };
    const name = str(json?.name);
    if (name === 'WEBHOOK_URL_ALREADY_EXISTS') return { error: 'Ya existe', exists: true };
    if (name === 'WEBHOOK_NUMBER_LIMIT_EXCEEDED') {
        return {
            error: 'Tu app de PayPal ya tiene 10 direcciones de avisos (el máximo). Borra una que no uses en developer.paypal.com → tu app → Webhooks y vuelve a abrir esta página.',
            exists: false,
        };
    }
    return { error: paypalError(status, body), exists: false };
}

export function deleteWebhookRequest(base: string, token: string, id: string): IntegrationRequest {
    return {
        url: `${trimBase(base)}/v1/notifications/webhooks/${encodeURIComponent(id)}`,
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
    };
}

/** Las órdenes que recuerda un link (tolerante con lo guardado). */
export function readPaypalOrders(raw: unknown): PaypalOrderRef[] {
    if (!Array.isArray(raw)) return [];
    const out: PaypalOrderRef[] = [];
    for (const r of raw) {
        const o = obj(r);
        const id = str(o?.id);
        const url = str(o?.approve_url);
        const at = str(o?.created_at);
        if (isPaypalId(id) && url && at) out.push({ id, approve_url: url, created_at: at, ...(o?.done === true ? { done: true } : {}) });
    }
    return out;
}

/** ¿Se puede reusar la última orden (reciente y con su link para pagar)? */
export function reusableOrder(orders: readonly PaypalOrderRef[], now: Date): PaypalOrderRef | null {
    const last = orders[orders.length - 1];
    if (!last || last.done) return null;
    const age = now.getTime() - new Date(last.created_at).getTime();
    return age >= 0 && age < PAYPAL_ORDER_REUSE_MS ? last : null;
}

/** Marca una orden como usada (ya no se manda al cliente a pagarla otra vez). */
export function markOrderDone(orders: readonly PaypalOrderRef[], id: string): PaypalOrderRef[] {
    return orders.map((o) => (o.id === id ? { ...o, done: true } : o));
}

/** Agrega una orden y conserva sólo las más nuevas. */
export function appendOrder(orders: readonly PaypalOrderRef[], order: PaypalOrderRef): PaypalOrderRef[] {
    return [...orders.filter((o) => o.id !== order.id), order].slice(-PAYPAL_MAX_ORDERS);
}
