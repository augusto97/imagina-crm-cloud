import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { AutoRenewStatus, BillingPaymentStatus } from '@imagina-base/shared';
import type { MercadoPagoCreds } from '../platform-payments.service';
import {
    decodeReference,
    emptyReconcileBatch,
    paymentMethodLabel,
    type CheckoutRequest,
    type CheckoutSession,
    type PaymentGateway,
    type PaymentNotice,
    type ReconcileBatch,
    type ReconcileInput,
    type SubscriptionRequest,
    type SubscriptionSession,
} from '../payment.types';

export const MP_API = 'https://api.mercadopago.com';

/** De dónde salen las credenciales (consola de Plataforma con respaldo en `.env`). */
export interface MercadoPagoCredsSource {
    mercadoPago(): Promise<MercadoPagoCreds | null>;
    webhookUrl(): string;
    /**
     * v0.1.379 — anota el último aviso recibido (firma y qué pasó) para
     * mostrarlo en Plataforma → Cobros. Best-effort: nunca rompe el aviso.
     */
    recordHook?(entry: MpHookRecord): Promise<void>;
}

/** Lo que se anota de cada aviso de Mercado Pago (sin datos del pago). */
export interface MpHookRecord {
    type: string | null;
    dataId: string | null;
    signature: 'ok' | 'bad' | 'no_secret';
    result: 'read' | 'unrelated' | 'not_found' | 'error';
    message?: string;
}

/** Una respuesta no-2xx de la API de Mercado Pago (para distinguir 404 de una falla). */
class MpHttpError extends Error {
    constructor(
        path: string,
        readonly status: number,
    ) {
        super(`GET ${path} → ${status}`);
    }
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
 * dice "mira el pago 123", nunca se le cree el estado.
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
        const type = body?.type ?? query.type ?? query.topic ?? null;
        const record = (entry: Omit<MpHookRecord, 'type' | 'dataId'>): void => {
            void this.source
                .recordHook?.({ type: type ? String(type).slice(0, 64) : null, dataId: dataId ? dataId.slice(0, 64) : null, ...entry })
                .catch(() => undefined);
        };
        if (!verifyMpSignature(headers, dataId, creds.webhookSecret)) {
            this.logger.warn('firma x-signature inválida — aviso rechazado');
            record({ signature: creds.webhookSecret ? 'bad' : 'no_secret', result: 'unrelated' });
            return [];
        }
        if (!dataId || !/^[A-Za-z0-9-]{1,64}$/.test(dataId)) {
            record({ signature: 'ok', result: 'unrelated' });
            return [];
        }
        try {
            let notices: PaymentNotice[];
            switch (type) {
                case 'payment':
                    notices = await this.fromPayment(creds.accessToken, dataId);
                    break;
                case 'subscription_preapproval':
                    notices = await this.fromPreapproval(creds.accessToken, dataId);
                    break;
                case 'subscription_authorized_payment':
                    notices = await this.fromAuthorizedPayment(creds.accessToken, dataId);
                    break;
                default:
                    notices = [];
            }
            record({ signature: 'ok', result: notices.length > 0 ? 'read' : 'unrelated' });
            return notices;
        } catch (err) {
            // Un id que Mercado Pago no tiene (la «Simular notificación» del
            // panel manda 12345; un aviso de otra cuenta) nunca va a existir:
            // reintentar no sirve, se contesta 200 sin hacer nada.
            if (err instanceof MpHttpError && err.status === 404) {
                this.logger.warn(`aviso de ${type} ${dataId}: Mercado Pago no lo tiene (404) — ignorado`);
                record({ signature: 'ok', result: 'not_found' });
                return [];
            }
            // El resto (red, 5xx, clave rechazada) se relanza: el controller
            // responde 500 y Mercado Pago reintenta.
            this.logger.error(`no se pudo leer el ${type} ${dataId}: ${String(err)}`);
            record({ signature: 'ok', result: 'error', message: String(err instanceof Error ? err.message : err).slice(0, 200) });
            throw err;
        }
    }

    private async get<T>(accessToken: string, path: string): Promise<T> {
        const res = await this.fetchImpl(`${this.apiBase}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new MpHttpError(path, res.status);
        return (await res.json()) as T;
    }

    private async fromPayment(accessToken: string, id: string): Promise<PaymentNotice[]> {
        const p = await this.get<MpPayment>(accessToken, `/v1/payments/${id}`);
        return this.paymentNotices(p, id);
    }

    /** Un pago de MP (leído por id o venido de una búsqueda) → lo que pasó. */
    private paymentNotices(p: MpPayment, idHint: string): PaymentNotice[] {
        const id = String(p.id ?? idHint);
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
                externalId: id,
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
        return authorizedPaymentNotices(a);
    }

    /**
     * v0.1.382 — Revisión de respaldo. Tres búsquedas, todas con nuestra clave
     * y sin creerle nada a nadie:
     *
     *  1. Los pagos de la cuenta que cambiaron desde `since` (atrapa los de
     *     período, las cuotas de las renovaciones y los reembolsos). SUPUESTO:
     *     `range=date_last_updated` y `begin_date=NOW-<n>DAYS` como dice la
     *     documentación de la búsqueda de pagos.
     *  2. Los pagos abiertos desde la app que esa búsqueda no trajo, por su
     *     referencia (la misma búsqueda que usa «Verificar» en los cobros).
     *  3. Cada renovación automática viva: su estado y sus cuotas.
     */
    async reconcile(input: ReconcileInput): Promise<ReconcileBatch> {
        const batch = emptyReconcileBatch();
        const creds = await this.source.mercadoPago();
        if (!creds) return batch;
        const token = creds.accessToken;
        const seen = new Set<string>();
        const refsSeen = new Set<string>();
        /** Referencias con un pago que ya es definitivo (cobrado o devuelto). */
        const refsDone = new Set<string>();
        const add = (p: MpPayment): void => {
            const id = p.id === undefined ? '' : String(p.id);
            if (!id || seen.has(id)) return;
            seen.add(id);
            batch.checked.payments++;
            if (p.external_reference) {
                refsSeen.add(p.external_reference);
                if (p.status === 'approved' || p.status === 'refunded' || p.status === 'charged_back') refsDone.add(p.external_reference);
            }
            batch.notices.push(...this.paymentNotices(p, id));
        };
        const fail = (what: string, err: unknown): void => {
            const text = mpErrorText(what, err);
            if (!batch.errors.includes(text)) batch.errors.push(text);
        };

        // 1. Lo que cambió en la cuenta.
        const days = Math.min(30, Math.max(1, Math.ceil((input.now.getTime() - input.since.getTime()) / DAY)));
        for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
            const q = new URLSearchParams({
                sort: 'date_last_updated',
                criteria: 'desc',
                range: 'date_last_updated',
                begin_date: `NOW-${days}DAYS`,
                end_date: 'NOW',
                limit: String(SEARCH_PAGE),
                offset: String(page * SEARCH_PAGE),
            });
            try {
                const res = await this.get<MpSearch<MpPayment>>(token, `/v1/payments/search?${q.toString()}`);
                const results = Array.isArray(res.results) ? res.results : [];
                for (const p of results) add(p);
                const total = Number(res.paging?.total);
                if (results.length < SEARCH_PAGE || (Number.isFinite(total) && (page + 1) * SEARCH_PAGE >= total)) break;
            } catch (err) {
                fail('buscar los pagos recientes', err);
                break;
            }
        }

        // 2. Los abiertos desde la app que no aparecieron.
        for (const c of input.openCheckouts) {
            if (!refsSeen.has(c.reference)) {
                const q = new URLSearchParams({ external_reference: c.reference, sort: 'date_created', criteria: 'desc', limit: '30' });
                try {
                    const res = await this.get<MpSearch<MpPayment>>(token, `/v1/payments/search?${q.toString()}`);
                    for (const p of Array.isArray(res.results) ? res.results : []) add(p);
                    refsSeen.add(c.reference);
                } catch (err) {
                    fail('buscar los pagos abiertos desde la app', err);
                    continue;
                }
            }
            const old = input.now.getTime() - c.createdAt > OPEN_DAYS * DAY;
            if (refsDone.has(c.reference) || old) batch.settled.push(c);
        }

        // 3. Las renovaciones vivas.
        for (const id of input.liveSubscriptions.slice(0, MAX_SUBSCRIPTIONS)) {
            if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) continue;
            let status: string | undefined;
            try {
                const notices = await this.fromPreapproval(token, id);
                batch.checked.subscriptions++;
                batch.notices.push(...notices);
                const n = notices[0];
                status = n && n.kind === 'subscription' ? n.status : undefined;
            } catch (err) {
                if (err instanceof MpHttpError && err.status === 404) {
                    batch.errors.push(`La renovación ${id} no existe en esta cuenta de Mercado Pago (¿cambiaste el Access Token?).`);
                } else {
                    fail('leer las renovaciones automáticas', err);
                }
                continue;
            }
            if (status !== 'authorized' && status !== 'paused') continue;
            const items = await this.subscriptionPayments(token, id).catch((err: unknown) => {
                fail('leer las cuotas de las renovaciones', err);
                return [] as MpAuthorizedPayment[];
            });
            for (const a of items) {
                const paymentId = a.payment?.id === undefined ? '' : String(a.payment.id);
                if (!paymentId || seen.has(paymentId)) continue;
                const notices = authorizedPaymentNotices({ ...a, preapproval_id: a.preapproval_id ?? id });
                if (notices.length === 0) continue;
                seen.add(paymentId);
                batch.checked.payments++;
                batch.notices.push(...notices);
            }
        }
        return batch;
    }

    /**
     * Las cuotas de una renovación. Con paginación y, si Mercado Pago lo
     * rechaza (v0.1.380: hay cuentas que responden 400), sólo con el id.
     */
    private async subscriptionPayments(token: string, preapprovalId: string): Promise<MpAuthorizedPayment[]> {
        const paged = new URLSearchParams({ preapproval_id: preapprovalId, limit: '50', offset: '0' });
        try {
            const res = await this.get<MpSearch<MpAuthorizedPayment>>(token, `/authorized_payments/search?${paged.toString()}`);
            return Array.isArray(res.results) ? res.results : [];
        } catch (err) {
            if (!(err instanceof MpHttpError) || err.status !== 400) throw err;
            const bare = new URLSearchParams({ preapproval_id: preapprovalId });
            const res = await this.get<MpSearch<MpAuthorizedPayment>>(token, `/authorized_payments/search?${bare.toString()}`);
            return Array.isArray(res.results) ? res.results : [];
        }
    }
}

const DAY = 24 * 60 * 60 * 1000;
/** Páginas de la búsqueda de pagos recientes (de a 100). */
const MAX_SEARCH_PAGES = 5;
const SEARCH_PAGE = 100;
/** Renovaciones vivas que se releen por vez. */
const MAX_SUBSCRIPTIONS = 200;
/** Cuánto se sigue mirando un pago abierto (PSE y efectivo pueden tardar). */
const OPEN_DAYS = 7;

/** Una cuota de la renovación → el cobro que hizo (si ya intentó cobrar). */
export function authorizedPaymentNotices(a: MpAuthorizedPayment): PaymentNotice[] {
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

/** Un error de la API de Mercado Pago en lenguaje claro, para la consola. */
export function mpErrorText(what: string, err: unknown): string {
    if (err instanceof MpHttpError) {
        if (err.status === 401 || err.status === 403) {
            return `Mercado Pago rechazó el Access Token al ${what} (${err.status}): revisa las credenciales en esta pantalla.`;
        }
        if (err.status === 400) return `Mercado Pago no aceptó el pedido al ${what} (400).`;
        if (err.status === 429) return `Mercado Pago pidió esperar al ${what} (429): se vuelve a intentar en la próxima revisión.`;
        return `Mercado Pago respondió ${err.status} al ${what}.`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `No se pudo conectar con Mercado Pago al ${what}: ${msg.slice(0, 160)}`;
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
            // pending / in_process / authorized / in_mediation: todavía no es dinero.
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

interface MpSearch<T> {
    results?: T[];
    paging?: { total?: number; limit?: number; offset?: number };
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

export interface MpAuthorizedPayment {
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
