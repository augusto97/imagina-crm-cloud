import {
    addSubscriptionPeriod,
    type SubscriptionChargeStatus,
    type SubscriptionFrequencyType,
    type SubscriptionProviderStatus,
} from '@imagina-base/shared';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';
import { isTestCreds, mpMethodText, mpRejectionText, providerError, type GatewayBases } from '../collections/collection-gateways';

/**
 * v0.1.367 (ADR-S96) — Las piezas PURAS que hablan con la API de suscripciones
 * de Mercado Pago (`/preapproval`, `/authorized_payments`). Cada una arma un
 * pedido o lee una respuesta; el servicio hace la red (por el guard
 * anti-SSRF) y nunca le cree a un aviso: siempre relee la suscripción y sus
 * cuotas con la credencial de la empresa.
 *
 * Modelo de Mercado Pago que usamos: suscripción SIN plan asociado, con
 * `status: pending` → Mercado Pago devuelve un `init_point` donde el cliente
 * pone su tarjeta (nunca pasa por nosotros). Cada período Mercado Pago crea
 * una «cuota» (authorized payment) y la cobra; si la rechazan, la reintenta
 * hasta 4 veces en unos 10 días, y tras 3 cuotas rechazadas da de baja la
 * suscripción sola.
 */

function trimBase(url: string): string {
    return url.replace(/\/+$/, '');
}

function parseJson(body: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(body) as unknown;
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
}

function num(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

function date(v: unknown): Date | null {
    const s = str(v);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function authHeaders(creds: IntegrationCreds): Record<string, string> {
    return { accept: 'application/json', authorization: `Bearer ${creds.secret}` };
}

/** El estado de una suscripción de Mercado Pago, en nuestras palabras. */
export function mapPreapprovalStatus(raw: string | null | undefined): SubscriptionProviderStatus {
    switch (raw) {
        case 'authorized':
            return 'authorized';
        case 'paused':
            return 'paused';
        case 'cancelled':
        case 'finished':
            return 'cancelled';
        default:
            return 'pending';
    }
}

/** El estado de un pago de una cuota. */
export function mapChargeStatus(raw: string | null | undefined): SubscriptionChargeStatus {
    switch (raw) {
        case 'approved':
            return 'approved';
        case 'rejected':
        case 'cancelled':
            return 'rejected';
        case 'refunded':
        case 'charged_back':
            return 'refunded';
        default:
            return 'pending';
    }
}

// ── Crear la suscripción ─────────────────────────────────────────────────

export interface PreapprovalInput {
    reference: string;
    title: string;
    payerEmail: string;
    amount: number;
    currency: string;
    frequency: number;
    frequencyType: SubscriptionFrequencyType;
    /** Desde cuándo cobra (null = en cuanto el cliente autoriza). */
    startAt: Date | null;
    /** Cuántos cobros (null = hasta que se cancele). */
    cycles: number | null;
    /** Adónde vuelve el cliente al autorizar la tarjeta. */
    backUrl: string;
}

/** Hasta cuándo autoriza el cliente: justo antes del período que ya no se cobra. */
export function preapprovalEndDate(startAt: Date, frequency: number, type: SubscriptionFrequencyType, cycles: number): Date {
    return new Date(addSubscriptionPeriod(startAt, frequency, type, cycles).getTime() - 60 * 60 * 1000);
}

export function createPreapprovalRequest(creds: IntegrationCreds, input: PreapprovalInput, bases: GatewayBases, now = new Date()): IntegrationRequest {
    const auto: Record<string, unknown> = {
        frequency: input.frequency,
        frequency_type: input.frequencyType,
        transaction_amount: Math.round(input.amount * 100) / 100,
        currency_id: input.currency.toUpperCase(),
    };
    // Una fecha de inicio a futuro (prueba gratis o «desde el día 1»); en
    // pasado/ahora Mercado Pago la rechaza: sin ella cobra al autorizar.
    const start = input.startAt && input.startAt.getTime() > now.getTime() + 60_000 ? input.startAt : null;
    if (start) auto.start_date = start.toISOString();
    if (input.cycles !== null && input.cycles > 0) {
        auto.end_date = preapprovalEndDate(start ?? now, input.frequency, input.frequencyType, input.cycles).toISOString();
    }
    return {
        url: `${trimBase(bases.mercadopago)}/preapproval`,
        method: 'POST',
        headers: {
            ...authHeaders(creds),
            'content-type': 'application/json',
            'x-idempotency-key': input.reference,
        },
        body: JSON.stringify({
            reason: input.title.slice(0, 200),
            external_reference: input.reference,
            payer_email: input.payerEmail,
            auto_recurring: auto,
            back_url: input.backUrl,
            status: 'pending',
        }),
    };
}

export interface ParsedPreapproval {
    externalId: string;
    providerStatus: SubscriptionProviderStatus;
    rawStatus: string | null;
    url: string | null;
    externalReference: string | null;
    amount: number | null;
    currency: string | null;
    nextPaymentAt: Date | null;
    startAt: Date | null;
}

function readPreapproval(json: Record<string, unknown>, creds: IntegrationCreds): ParsedPreapproval | null {
    const id = str(json.id);
    if (!id) return null;
    const auto = (json.auto_recurring ?? {}) as Record<string, unknown>;
    const test = isTestCreds('mercadopago', creds);
    const url = (test ? str(json.sandbox_init_point) : null) ?? str(json.init_point);
    const raw = str(json.status);
    return {
        externalId: id,
        providerStatus: mapPreapprovalStatus(raw),
        rawStatus: raw,
        url,
        externalReference: str(json.external_reference),
        amount: num(auto.transaction_amount),
        currency: str(auto.currency_id)?.toUpperCase() ?? null,
        nextPaymentAt: date(json.next_payment_date),
        startAt: date(auto.start_date),
    };
}

export function parseCreatedPreapproval(
    status: number,
    body: string,
    creds: IntegrationCreds,
): ParsedPreapproval | { error: string } {
    const json = parseJson(body);
    if (status < 200 || status >= 300 || !json) return { error: providerError('mercadopago', status, body) };
    const p = readPreapproval(json, creds);
    if (!p) return { error: 'Mercado Pago no devolvió la suscripción.' };
    if (!p.url) return { error: 'Mercado Pago no devolvió el link para autorizar la tarjeta.' };
    return p;
}

// ── Leer la suscripción y sus cuotas ─────────────────────────────────────

export function preapprovalRequest(creds: IntegrationCreds, externalId: string, bases: GatewayBases): IntegrationRequest {
    return {
        url: `${trimBase(bases.mercadopago)}/preapproval/${encodeURIComponent(externalId)}`,
        method: 'GET',
        headers: authHeaders(creds),
    };
}

export function parsePreapproval(status: number, body: string, creds: IntegrationCreds): ParsedPreapproval | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    return json ? readPreapproval(json, creds) : null;
}

/** Una cuota de Mercado Pago (authorized payment) con su último intento de cobro. */
export interface ParsedInvoice {
    invoiceId: string;
    preapprovalId: string | null;
    /** scheduled / processed / recycling / cancelled / waiting for gateway… */
    status: string;
    debitDate: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    retryAttempt: number | null;
    amount: number;
    currency: string;
    paymentId: string | null;
    paymentStatus: SubscriptionChargeStatus | null;
    failureReason: string | null;
}

function readInvoice(json: Record<string, unknown>): ParsedInvoice | null {
    const id = str(json.id);
    if (!id) return null;
    const payment = (json.payment ?? null) as Record<string, unknown> | null;
    const paymentStatusRaw = payment ? str(payment.status) : null;
    const paymentStatus = payment && str(payment.id) ? mapChargeStatus(paymentStatusRaw) : null;
    const detail = payment ? str(payment.status_detail) : null;
    return {
        invoiceId: id,
        preapprovalId: str(json.preapproval_id),
        status: str(json.status) ?? 'scheduled',
        debitDate: date(json.debit_date),
        createdAt: date(json.date_created),
        updatedAt: date(json.last_modified),
        retryAttempt: num(json.retry_attempt),
        amount: num(json.transaction_amount) ?? 0,
        currency: (str(json.currency_id) ?? '').toUpperCase(),
        paymentId: payment ? str(payment.id) : null,
        paymentStatus,
        failureReason: paymentStatus === 'rejected' ? (mpRejectionText(detail) ?? (detail ? detail : 'el banco rechazó el pago')) : null,
    };
}

export function invoicesSearchRequest(creds: IntegrationCreds, preapprovalId: string, bases: GatewayBases): IntegrationRequest {
    const q = new URLSearchParams({ preapproval_id: preapprovalId, limit: '100', offset: '0' });
    return {
        url: `${trimBase(bases.mercadopago)}/authorized_payments/search?${q.toString()}`,
        method: 'GET',
        headers: authHeaders(creds),
    };
}

/** null = no se pudo leer (el servicio conserva lo que ya sabía). */
export function parseInvoices(status: number, body: string): ParsedInvoice[] | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    if (!json || !Array.isArray(json.results)) return null;
    return (json.results as unknown[])
        .map((r) => (r && typeof r === 'object' ? readInvoice(r as Record<string, unknown>) : null))
        .filter((r): r is ParsedInvoice => r !== null);
}

export function invoiceRequest(creds: IntegrationCreds, invoiceId: string, bases: GatewayBases): IntegrationRequest {
    return {
        url: `${trimBase(bases.mercadopago)}/authorized_payments/${encodeURIComponent(invoiceId)}`,
        method: 'GET',
        headers: authHeaders(creds),
    };
}

export function parseInvoice(status: number, body: string): ParsedInvoice | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    return json ? readInvoice(json) : null;
}

/** Un pago suelto (aviso `payment`): a qué suscripción pertenece y cómo quedó. */
export interface ParsedSubscriptionPayment {
    paymentId: string;
    preapprovalId: string | null;
    externalReference: string | null;
    status: SubscriptionChargeStatus;
    amount: number;
    currency: string;
    method: string | null;
    paidAt: Date | null;
    createdAt: Date | null;
    failureReason: string | null;
}

export function parseSubscriptionPayment(status: number, body: string): ParsedSubscriptionPayment | null {
    if (status !== 200) return null;
    const p = parseJson(body);
    if (!p) return null;
    const id = str(p.id);
    if (!id) return null;
    const metadata = (p.metadata ?? {}) as Record<string, unknown>;
    const poi = ((p.point_of_interaction ?? {}) as Record<string, unknown>).transaction_data as Record<string, unknown> | undefined;
    const st = mapChargeStatus(str(p.status));
    const detail = str(p.status_detail);
    return {
        paymentId: id,
        preapprovalId: str(metadata.preapproval_id) ?? (poi ? str(poi.subscription_id) : null),
        externalReference: str(p.external_reference),
        status: st,
        amount: num(p.transaction_amount) ?? 0,
        currency: (str(p.currency_id) ?? '').toUpperCase(),
        method: mpMethodText(str(p.payment_type_id), str(p.payment_method_id)),
        paidAt: st === 'approved' ? (date(p.date_approved) ?? date(p.date_created)) : null,
        createdAt: date(p.date_created),
        failureReason: st === 'rejected' ? (mpRejectionText(detail) ?? 'el banco rechazó el pago') : null,
    };
}

// ── Cambiar la suscripción ───────────────────────────────────────────────

export type PreapprovalPatch =
    | { kind: 'status'; status: 'paused' | 'authorized' | 'cancelled' }
    | { kind: 'amount'; amount: number; currency: string };

export function updatePreapprovalRequest(creds: IntegrationCreds, externalId: string, patch: PreapprovalPatch, bases: GatewayBases): IntegrationRequest {
    const body =
        patch.kind === 'status'
            ? { status: patch.status }
            : { auto_recurring: { transaction_amount: Math.round(patch.amount * 100) / 100, currency_id: patch.currency.toUpperCase() } };
    return {
        url: `${trimBase(bases.mercadopago)}/preapproval/${encodeURIComponent(externalId)}`,
        method: 'PUT',
        headers: { ...authHeaders(creds), 'content-type': 'application/json' },
        body: JSON.stringify(body),
    };
}

// ── Avisos ───────────────────────────────────────────────────────────────

export type MpNoticeTopic = 'payment' | 'subscription_preapproval' | 'subscription_authorized_payment';

/** El tema y el id de un aviso de Mercado Pago (los dos formatos: webhooks e IPN). */
export function mpNotice(query: Record<string, unknown>, body: unknown): { topic: MpNoticeTopic; id: string } | null {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const raw = str(b.type) ?? str(b.topic) ?? str(query.type) ?? str(query.topic);
    const topic: MpNoticeTopic | null =
        raw === 'payment'
            ? 'payment'
            : raw === 'subscription_preapproval' || raw === 'preapproval'
              ? 'subscription_preapproval'
              : raw === 'subscription_authorized_payment' || raw === 'authorized_payment'
                ? 'subscription_authorized_payment'
                : null;
    if (!topic) return null;
    const data = (b.data && typeof b.data === 'object' ? b.data : {}) as Record<string, unknown>;
    const id = str(data.id) ?? str(query['data.id']) ?? str(query.id) ?? str(b.id);
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    return { topic, id };
}

// ── Lo que dicen los cobros guardados (puro) ─────────────────────────────

export interface ChargeLike {
    invoiceId: string | null;
    providerPaymentId: string;
    status: SubscriptionChargeStatus;
    periodStart: Date | null;
    paidAt: Date | null;
    createdAt: Date;
    failureReason: string | null;
}

export interface ChargesSummary {
    chargesPaid: number;
    chargesFailed: number;
    consecutiveFailed: number;
    paidUntil: Date | null;
    lastChargeAt: Date | null;
    lastChargeStatus: SubscriptionChargeStatus | null;
    lastFailureReason: string | null;
}

/**
 * Resume los cobros guardados agrupados por CUOTA (varios intentos, una
 * cuota): pagada si algún intento se aprobó (y no se reembolsó), fallida si
 * todos fueron rechazados. «Pagado hasta» = el fin del período de la última
 * cuota pagada. La cuota que se está reintentando no cuenta como fallida.
 */
export function summarizeCharges(
    charges: readonly ChargeLike[],
    opts: { frequency: number; frequencyType: SubscriptionFrequencyType; retryingInvoiceId?: string | null },
): ChargesSummary {
    const groups = new Map<string, ChargeLike[]>();
    for (const c of charges) {
        const key = c.invoiceId ?? `p:${c.providerPaymentId}`;
        const g = groups.get(key);
        if (g) g.push(c);
        else groups.set(key, [c]);
    }
    type Inv = { key: string; when: number; start: Date; paid: boolean; failed: boolean; reason: string | null };
    const invoices: Inv[] = [];
    for (const [key, list] of groups) {
        const approved = list.find((c) => c.status === 'approved');
        const refunded = list.some((c) => c.status === 'refunded');
        const allRejected = list.every((c) => c.status === 'rejected');
        const first = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
        const start = (approved?.periodStart ?? approved?.paidAt) ?? first.periodStart ?? first.createdAt;
        const lastRejected = [...list].filter((c) => c.status === 'rejected').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        invoices.push({
            key,
            when: start.getTime(),
            start,
            paid: Boolean(approved) && !refunded,
            failed: allRejected && key !== opts.retryingInvoiceId,
            reason: lastRejected?.failureReason ?? null,
        });
    }
    invoices.sort((a, b) => a.when - b.when);
    let paidUntil: Date | null = null;
    let consecutive = 0;
    for (const inv of invoices) {
        if (inv.paid) {
            const end = addSubscriptionPeriod(inv.start, opts.frequency, opts.frequencyType);
            if (!paidUntil || end.getTime() > paidUntil.getTime()) paidUntil = end;
            consecutive = 0;
        } else if (inv.failed) {
            consecutive += 1;
        }
    }
    // El último cobro por su fecha REAL (cuándo se pagó o qué período cubría): en
    // la primera lectura todas las filas se guardan juntas y su `createdAt` no dice nada.
    const when = (c: ChargeLike): number => (c.paidAt ?? c.periodStart ?? c.createdAt).getTime();
    const latest = [...charges].sort((a, b) => when(b) - when(a) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    return {
        chargesPaid: invoices.filter((i) => i.paid).length,
        chargesFailed: invoices.filter((i) => i.failed).length,
        consecutiveFailed: consecutive,
        paidUntil,
        lastChargeAt: latest ? (latest.paidAt ?? latest.createdAt) : null,
        lastChargeStatus: latest?.status ?? null,
        lastFailureReason: latest?.status === 'rejected' ? latest.failureReason : null,
    };
}
