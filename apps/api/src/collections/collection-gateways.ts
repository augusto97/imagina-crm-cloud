import { createHash, timingSafeEqual } from 'node:crypto';
import type { CollectionProvider, PaymentLinkStatus } from '@imagina-base/shared';
import type { IntegrationCreds, IntegrationRequest, VerifyOutcome } from '../connectors/integration-calls';

/**
 * Cobros de las empresas (v0.1.251, ADR-S31) — las piezas PURAS de cada
 * proveedor: qué se pide para crear un link, cómo se lee un pago y cómo se
 * verifica un aviso. Sin red ni base: el service las usa con
 * `safeWebhookFetch` y los tests las prueban contra la forma real de cada API.
 *
 * Por qué así: lo que crea el botón «Cobrar» y lo que crea la automatización
 * tienen que ser EXACTAMENTE lo mismo (misma lección de `buildWebhookRequest`).
 */

export const MP_API_BASE = 'https://api.mercadopago.com';
export const WOMPI_PRODUCTION = 'https://production.wompi.co/v1';
export const WOMPI_SANDBOX = 'https://sandbox.wompi.co/v1';
export const WOMPI_CHECKOUT = 'https://checkout.wompi.co/l/';

/** Bases de cada API. En desarrollo apuntan a un proveedor simulado. */
export interface GatewayBases {
    mercadopago: string;
    wompiProduction: string;
    wompiSandbox: string;
    wompiCheckout: string;
}

export const DEFAULT_GATEWAY_BASES: GatewayBases = {
    mercadopago: MP_API_BASE,
    wompiProduction: WOMPI_PRODUCTION,
    wompiSandbox: WOMPI_SANDBOX,
    wompiCheckout: WOMPI_CHECKOUT,
};

/** Credenciales de prueba: los pagos no son dinero real. */
export function isTestCreds(provider: CollectionProvider, creds: IntegrationCreds): boolean {
    if (provider === 'mercadopago') return creds.secret.startsWith('TEST-');
    return (creds.fields.public_key ?? '').startsWith('pub_test_') || creds.secret.startsWith('prv_test_');
}

function wompiBase(creds: IntegrationCreds, bases: GatewayBases): string {
    return isTestCreds('wompi', creds) ? bases.wompiSandbox : bases.wompiProduction;
}

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

/** El mensaje de error que devuelve cada API, legible. */
export function providerError(provider: CollectionProvider, status: number, body: string): string {
    const json = parseJson(body);
    if (provider === 'mercadopago') {
        const message = str(json?.message) ?? str(json?.error);
        const cause = Array.isArray(json?.cause)
            ? (json!.cause as Array<Record<string, unknown>>)
                  .map((c) => str(c.description) ?? str(c.code))
                  .filter((s): s is string => s !== null)
                  .join('; ')
            : '';
        if (status === 401 || status === 403) return 'Mercado Pago rechazó el Access Token (¿lo cambiaste o lo revocaste?). Actualízalo en Integraciones.';
        return `Mercado Pago respondió ${status}${message ? `: ${message}` : ''}${cause ? ` (${cause})` : ''}.`;
    }
    const err = (json?.error ?? null) as Record<string, unknown> | null;
    const reason = str(err?.reason) ?? str(err?.type);
    const messages = err?.messages && typeof err.messages === 'object'
        ? Object.entries(err.messages as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
              .join('; ')
        : '';
    if (status === 401 || status === 403) return 'Wompi rechazó la llave privada (¿es la del mismo ambiente que la pública?). Actualízala en Integraciones.';
    return `Wompi respondió ${status}${reason ? `: ${reason}` : ''}${messages ? ` (${messages})` : ''}.`;
}

// ── Conectar: verificar las credenciales ────────────────────────────────

/**
 * Lo que se puede saber sin red: que las llaves tengan la forma correcta y
 * sean del MISMO ambiente. La mezcla prueba/producción es el error nº 1 de
 * Wompi y su API sólo dice «no autorizado».
 */
export function precheckCreds(provider: CollectionProvider, creds: IntegrationCreds): string | null {
    if (provider === 'mercadopago') {
        const t = creds.secret.trim();
        if (!/^(APP_USR|TEST)-/.test(t)) {
            return 'Ese no parece un Access Token de Mercado Pago: empieza con APP_USR- (producción) o TEST- (prueba). La «Public Key» no sirve aquí.';
        }
        return null;
    }
    const pub = (creds.fields.public_key ?? '').trim();
    const prv = creds.secret.trim();
    const pubEnv = /^pub_(prod|test)_/.exec(pub)?.[1] ?? null;
    const prvEnv = /^prv_(prod|test)_/.exec(prv)?.[1] ?? null;
    if (!pubEnv) return 'La llave pública de Wompi empieza con pub_prod_ (o pub_test_).';
    if (!prvEnv) return 'La llave privada de Wompi empieza con prv_prod_ (o prv_test_).';
    if (pubEnv !== prvEnv) {
        return 'Las dos llaves tienen que ser del mismo ambiente: las dos de producción (prod) o las dos de prueba (test).';
    }
    const ev = (creds.signingSecret ?? '').trim();
    if (ev !== '') {
        const evEnv = /^(prod|test)_events_/.exec(ev)?.[1] ?? null;
        if (evEnv && evEnv !== pubEnv) {
            return 'El secreto de eventos es de otro ambiente que las llaves (prod_events_ va con las de producción, test_events_ con las de prueba).';
        }
    }
    return null;
}

export function collectionVerifyRequest(
    provider: CollectionProvider,
    creds: IntegrationCreds,
    bases: GatewayBases,
): IntegrationRequest {
    if (provider === 'mercadopago') {
        return {
            url: `${trimBase(bases.mercadopago)}/users/me`,
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${creds.secret}` },
        };
    }
    return {
        url: `${trimBase(wompiBase(creds, bases))}/merchants/${encodeURIComponent((creds.fields.public_key ?? '').trim())}`,
        method: 'GET',
        headers: { accept: 'application/json' },
    };
}

export function parseCollectionVerify(
    provider: CollectionProvider,
    status: number,
    body: string,
    creds: IntegrationCreds,
): VerifyOutcome {
    const out: VerifyOutcome = { ok: true, label: null, error: null, warning: null, options: {}, fields: {} };
    const test = isTestCreds(provider, creds);
    const suffix = test ? ' (prueba)' : '';
    const json = parseJson(body);
    if (provider === 'mercadopago') {
        if (status === 401 || status === 403) {
            return { ...out, ok: false, error: 'Mercado Pago no reconoce ese Access Token. Cópialo de nuevo de «Credenciales de producción».' };
        }
        if (status !== 200 || !json) {
            return { ...out, ok: false, error: providerError('mercadopago', status, body) };
        }
        const name = str(json.nickname) ?? str(json.email) ?? str(json.id);
        return {
            ...out,
            label: name ? `${name}${suffix}` : null,
            fields: { test_mode: test ? 'true' : 'false', site_id: str(json.site_id) ?? '' },
        };
    }
    if (status === 404 || status === 422 || status === 401) {
        return { ...out, ok: false, error: 'Wompi no reconoce esa llave pública. Cópiala de nuevo de Desarrolladores → Programadores.' };
    }
    const data = (json?.data ?? null) as Record<string, unknown> | null;
    if (status !== 200 || !data) {
        return { ...out, ok: false, error: providerError('wompi', status, body) };
    }
    const name = str(data.name) ?? str(data.legal_name) ?? str(data.email);
    return {
        ...out,
        label: name ? `${name}${suffix}` : null,
        warning: (creds.signingSecret ?? '').trim() === ''
            ? 'Sin el secreto de eventos los avisos de Wompi se aceptan sólo después de volver a leer el pago con tu llave (es seguro, pero conviene cargarlo).'
            : null,
        fields: { test_mode: test ? 'true' : 'false' },
    };
}

// ── Crear un link ───────────────────────────────────────────────────────

export interface LinkInput {
    title: string;
    amount: number;
    currency: string;
    payerEmail: string | null;
    expiresAt: Date | null;
    /** Referencia nuestra, única: así se reconoce el pago al volver. */
    reference: string;
    /** URL de avisos (sólo https; Mercado Pago la recibe por link). */
    notificationUrl: string | null;
}

/** Wompi sólo cobra en pesos colombianos; Mercado Pago, en la moneda de la cuenta. */
export function linkInputError(provider: CollectionProvider, input: LinkInput): string | null {
    if (!(input.amount > 0)) return 'El monto tiene que ser mayor a cero.';
    if (provider === 'wompi') {
        if (input.currency.toUpperCase() !== 'COP') return 'Wompi sólo cobra en pesos colombianos (COP).';
        // Wompi pide al menos $1.500 COP por transacción.
        if (input.amount < 1500) return 'Wompi no acepta cobros menores a $1.500 COP.';
    }
    return null;
}

export function createLinkRequest(
    provider: CollectionProvider,
    creds: IntegrationCreds,
    input: LinkInput,
    bases: GatewayBases,
): IntegrationRequest {
    if (provider === 'mercadopago') {
        const body: Record<string, unknown> = {
            items: [
                {
                    id: input.reference,
                    title: input.title.slice(0, 250),
                    quantity: 1,
                    unit_price: Math.round(input.amount * 100) / 100,
                    currency_id: input.currency.toUpperCase(),
                },
            ],
            external_reference: input.reference,
            metadata: { imagina_ref: input.reference },
        };
        if (input.payerEmail) body.payer = { email: input.payerEmail };
        if (input.notificationUrl && input.notificationUrl.startsWith('https://')) {
            body.notification_url = input.notificationUrl;
        }
        if (input.expiresAt) {
            body.expires = true;
            body.expiration_date_to = input.expiresAt.toISOString();
        }
        return {
            url: `${trimBase(bases.mercadopago)}/checkout/preferences`,
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${creds.secret}`,
                'x-idempotency-key': input.reference,
            },
            body: JSON.stringify(body),
        };
    }
    const body: Record<string, unknown> = {
        name: input.title.slice(0, 64),
        description: input.title.slice(0, 255),
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: Math.round(input.amount * 100),
    };
    if (input.expiresAt) body.expires_at = input.expiresAt.toISOString();
    return {
        url: `${trimBase(wompiBase(creds, bases))}/payment_links`,
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${creds.secret}`,
        },
        body: JSON.stringify(body),
    };
}

/**
 * La respuesta del alta. El id externo de un link de Mercado Pago es NUESTRA
 * referencia (los pagos la traen en `external_reference`); el de Wompi es el
 * id del link (los pagos lo traen en `payment_link_id`).
 */
export function parseCreatedLink(
    provider: CollectionProvider,
    status: number,
    body: string,
    creds: IntegrationCreds,
    input: LinkInput,
    bases: GatewayBases,
): { externalId: string; url: string } | { error: string } {
    const json = parseJson(body);
    if (status < 200 || status >= 300 || !json) return { error: providerError(provider, status, body) };
    if (provider === 'mercadopago') {
        const test = isTestCreds('mercadopago', creds);
        const url = (test ? str(json.sandbox_init_point) : null) ?? str(json.init_point);
        if (!url) return { error: 'Mercado Pago no devolvió el link de pago.' };
        return { externalId: input.reference, url };
    }
    const data = (json.data ?? null) as Record<string, unknown> | null;
    const id = str(data?.id);
    if (!id) return { error: 'Wompi no devolvió el link de pago.' };
    return { externalId: id, url: `${bases.wompiCheckout.replace(/\/*$/, '/')}${encodeURIComponent(id)}` };
}

// ── Leer un pago ────────────────────────────────────────────────────────

export interface GatewayPayment {
    paymentId: string;
    status: PaymentLinkStatus;
    amount: number;
    currency: string;
    paidAt: Date | null;
    method: string | null;
    /** MP: `external_reference`; Wompi: `payment_link_id`. Lo que une el pago al link. */
    linkRef: string | null;
    note: string | null;
}

const MP_STATUS: Record<string, PaymentLinkStatus> = {
    approved: 'approved',
    authorized: 'pending',
    pending: 'pending',
    in_process: 'pending',
    in_mediation: 'pending',
    rejected: 'rejected',
    cancelled: 'cancelled',
    refunded: 'refunded',
    charged_back: 'refunded',
};

const WOMPI_STATUS: Record<string, PaymentLinkStatus> = {
    APPROVED: 'approved',
    PENDING: 'pending',
    DECLINED: 'rejected',
    ERROR: 'rejected',
    VOIDED: 'cancelled',
};

const MP_METHOD: Record<string, string> = {
    pse: 'PSE',
    efecty: 'Efecty',
    nequi: 'Nequi',
    daviplata: 'Daviplata',
    account_money: 'Dinero en Mercado Pago',
    pix: 'Pix',
    oxxo: 'OXXO',
    rapipago: 'Rapipago',
    pagofacil: 'Pago Fácil',
};
const MP_TYPE: Record<string, string> = {
    credit_card: 'Tarjeta de crédito',
    debit_card: 'Tarjeta débito',
    prepaid_card: 'Tarjeta prepago',
    ticket: 'Efectivo',
    atm: 'Cajero',
    bank_transfer: 'Transferencia',
    account_money: 'Dinero en Mercado Pago',
    digital_wallet: 'Billetera digital',
};
const WOMPI_METHOD: Record<string, string> = {
    CARD: 'Tarjeta',
    PSE: 'PSE',
    NEQUI: 'Nequi',
    DAVIPLATA: 'Daviplata',
    BANCOLOMBIA_TRANSFER: 'Botón Bancolombia',
    BANCOLOMBIA_COLLECT: 'Corresponsal Bancolombia',
    BANCOLOMBIA_QR: 'QR Bancolombia',
    BANCOLOMBIA_BNPL: 'Compra y paga después',
    PCOL: 'Puntos Colombia',
    SU_PLUS: 'SU+ Pay',
};

const MP_REJECTED: Record<string, string> = {
    cc_rejected_insufficient_amount: 'fondos insuficientes',
    cc_rejected_bad_filled_security_code: 'código de seguridad incorrecto',
    cc_rejected_bad_filled_date: 'fecha de vencimiento incorrecta',
    cc_rejected_bad_filled_other: 'datos de la tarjeta incorrectos',
    cc_rejected_call_for_authorize: 'el banco pide autorizar el pago',
    cc_rejected_card_disabled: 'tarjeta deshabilitada',
    cc_rejected_duplicated_payment: 'pago duplicado',
    cc_rejected_high_risk: 'rechazado por seguridad',
    cc_rejected_max_attempts: 'demasiados intentos',
    cc_rejected_other_reason: 'el banco rechazó el pago',
};

export function paymentRequest(
    provider: CollectionProvider,
    creds: IntegrationCreds,
    paymentId: string,
    bases: GatewayBases,
): IntegrationRequest {
    if (provider === 'mercadopago') {
        return {
            url: `${trimBase(bases.mercadopago)}/v1/payments/${encodeURIComponent(paymentId)}`,
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${creds.secret}` },
        };
    }
    return {
        url: `${trimBase(wompiBase(creds, bases))}/transactions/${encodeURIComponent(paymentId)}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${creds.secret}` },
    };
}

function parseMpPayment(p: Record<string, unknown>): GatewayPayment | null {
    const id = str(p.id);
    const raw = str(p.status);
    if (!id || !raw) return null;
    const status = MP_STATUS[raw] ?? 'pending';
    const methodId = str(p.payment_method_id);
    const typeId = str(p.payment_type_id);
    const method = (methodId && MP_METHOD[methodId]) ?? (typeId && MP_TYPE[typeId]) ?? methodId ?? null;
    const detail = str(p.status_detail);
    const paidAt = status === 'approved' ? (str(p.date_approved) ?? str(p.date_created)) : null;
    return {
        paymentId: id,
        status,
        amount: num(p.transaction_amount) ?? 0,
        currency: (str(p.currency_id) ?? '').toUpperCase(),
        paidAt: paidAt ? new Date(paidAt) : null,
        method,
        linkRef: str(p.external_reference),
        note: status === 'rejected' && detail ? `Rechazado: ${MP_REJECTED[detail] ?? detail}.` : null,
    };
}

function parseWompiTx(t: Record<string, unknown>): GatewayPayment | null {
    const id = str(t.id);
    const raw = str(t.status);
    if (!id || !raw) return null;
    const status = WOMPI_STATUS[raw] ?? 'pending';
    const cents = num(t.amount_in_cents);
    const type = str(t.payment_method_type);
    const when = str(t.finalized_at) ?? str(t.created_at);
    const message = str(t.status_message);
    return {
        paymentId: id,
        status,
        amount: cents === null ? 0 : cents / 100,
        currency: (str(t.currency) ?? 'COP').toUpperCase(),
        paidAt: status === 'approved' && when ? new Date(when) : null,
        method: type ? (WOMPI_METHOD[type] ?? type) : null,
        linkRef: str(t.payment_link_id),
        note: status === 'rejected' && message ? `Rechazado: ${message}.` : null,
    };
}

export function parsePayment(provider: CollectionProvider, status: number, body: string): GatewayPayment | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    if (!json) return null;
    if (provider === 'mercadopago') return parseMpPayment(json);
    const data = (json.data ?? null) as Record<string, unknown> | null;
    return data ? parseWompiTx(data) : null;
}

/** Busca los pagos de un link (botón «Verificar» cuando no llegó el aviso). */
export function searchPaymentsRequest(
    provider: CollectionProvider,
    creds: IntegrationCreds,
    link: { externalId: string; createdAt: Date },
    bases: GatewayBases,
    now: Date = new Date(),
): IntegrationRequest {
    if (provider === 'mercadopago') {
        const q = new URLSearchParams({
            external_reference: link.externalId,
            sort: 'date_created',
            criteria: 'desc',
            limit: '30',
        });
        return {
            url: `${trimBase(bases.mercadopago)}/v1/payments/search?${q.toString()}`,
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${creds.secret}` },
        };
    }
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const q = new URLSearchParams({
        from_date: day(link.createdAt),
        until_date: day(until),
        page: '1',
        page_size: '100',
        order_by: 'created_at',
        order: 'DESC',
    });
    return {
        url: `${trimBase(wompiBase(creds, bases))}/transactions?${q.toString()}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${creds.secret}` },
    };
}

export function parsePaymentSearch(
    provider: CollectionProvider,
    status: number,
    body: string,
    externalId: string,
): GatewayPayment[] | null {
    if (status !== 200) return null;
    const json = parseJson(body);
    if (!json) return null;
    const list = provider === 'mercadopago' ? json.results : json.data;
    if (!Array.isArray(list)) return [];
    const out: GatewayPayment[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const p = provider === 'mercadopago'
            ? parseMpPayment(item as Record<string, unknown>)
            : parseWompiTx(item as Record<string, unknown>);
        if (p && p.linkRef === externalId) out.push(p);
    }
    return out;
}

/** De varios intentos de pago, el que cuenta: un aprobado gana a todo; si no, el último. */
export function pickPayment(payments: GatewayPayment[]): GatewayPayment | null {
    const approved = payments.find((p) => p.status === 'approved' || p.status === 'refunded');
    return approved ?? payments[0] ?? null;
}

// ── Avisos del proveedor ────────────────────────────────────────────────

/**
 * Del aviso de Mercado Pago sólo se toma el ID del pago: el estado se RELEE
 * con la credencial de la empresa (nunca se le cree al cuerpo). Llega como
 * webhook (`type=payment`, `data.id`) o IPN (`topic=payment`, `id`).
 */
export function mpNotificationPaymentId(query: Record<string, unknown>, body: unknown): string | null {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const kind = str(b.type) ?? str(b.topic) ?? str(query.type) ?? str(query.topic);
    if (kind !== 'payment') return null;
    const data = (b.data && typeof b.data === 'object' ? b.data : {}) as Record<string, unknown>;
    const id = str(data.id) ?? str(query['data.id']) ?? str(query.id) ?? str(b.id);
    return id && /^\d{1,30}$/.test(id) ? id : null;
}

function getPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

/** El id de la transacción de un evento de Wompi (`transaction.updated`). */
export function wompiEventTransactionId(body: unknown): string | null {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (str(b.event) !== 'transaction.updated') return null;
    const id = str(getPath(b.data, 'transaction.id'));
    return id && /^[\w-]{1,80}$/.test(id) ? id : null;
}

/**
 * Firma de un evento de Wompi: SHA-256 de los valores de
 * `signature.properties` (en orden, leídos de `data`) + `timestamp` + el
 * secreto de eventos, comparado en tiempo constante con `signature.checksum`.
 */
export function verifyWompiChecksum(body: unknown, eventsSecret: string): boolean {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const sig = (b.signature && typeof b.signature === 'object' ? b.signature : {}) as Record<string, unknown>;
    const props = Array.isArray(sig.properties) ? sig.properties : null;
    const checksum = str(sig.checksum);
    const timestamp = b.timestamp;
    if (!props || !checksum || (typeof timestamp !== 'number' && typeof timestamp !== 'string')) return false;
    const values = props.map((p) => {
        const v = typeof p === 'string' ? getPath(b.data, p) : undefined;
        return v === undefined || v === null ? '' : String(v);
    });
    const expected = createHash('sha256').update(`${values.join('')}${String(timestamp)}${eventsSecret}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const c = Buffer.from(checksum.toLowerCase(), 'utf8');
    return a.length === c.length && timingSafeEqual(a, c);
}

// ── Aplicar un pago a un link ───────────────────────────────────────────

export interface LinkStateBefore {
    status: PaymentLinkStatus;
    amount: number;
    currency: string;
    paymentId: string | null;
}

export interface LinkStateAfter {
    status: PaymentLinkStatus;
    paidAmount: number | null;
    paidAt: Date | null;
    method: string | null;
    paymentId: string;
    note: string | null;
}

/**
 * El estado nuevo de un link ante un pago, o `null` si no cambia nada.
 *
 * - Un link ya PAGADO sólo lo cambia ese mismo pago (un reembolso): un
 *   intento rechazado después no lo "despaga".
 * - Aprobado por OTRO monto o moneda → `mismatch` («Monto distinto»), para
 *   revisar en vez de darlo por pagado.
 */
export function nextLinkState(link: LinkStateBefore, p: GatewayPayment): LinkStateAfter | null {
    const settled = link.status === 'approved' || link.status === 'mismatch' || link.status === 'refunded';
    if (settled && link.paymentId && link.paymentId !== p.paymentId) return null;
    let status = p.status;
    let note = p.note;
    if (status === 'approved') {
        const sameCurrency = p.currency === '' || p.currency === link.currency.toUpperCase();
        if (!sameCurrency || p.amount + 0.005 < link.amount) {
            status = 'mismatch';
            note = `Se pagó ${p.amount} ${p.currency || link.currency} y el link era por ${link.amount} ${link.currency}.`;
        }
    }
    if (status === link.status && p.paymentId === link.paymentId) return null;
    const paid = status === 'approved' || status === 'mismatch' || status === 'refunded';
    return {
        status,
        paidAmount: paid ? p.amount : null,
        paidAt: paid ? p.paidAt : null,
        method: p.method,
        paymentId: p.paymentId,
        note,
    };
}
