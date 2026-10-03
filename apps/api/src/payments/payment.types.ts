import type {
    AutoRenewStatus,
    BillingPaymentStatus,
    CheckoutMode,
    PaymentProvider,
    Plan,
} from '@imagina-base/shared';

/** Datos para abrir un pago de N meses (Checkout Pro / PayPal Orders). */
export interface CheckoutRequest {
    tenantId: number;
    plan: Plan;
    months: number;
    /** Total a cobrar (precio del plan × meses). */
    amount: number;
    currency: 'USD' | 'COP';
    /** Referencia opaca que vuelve en el aviso (ver `encodeReference`). */
    reference: string;
    title: string;
    returnUrl: string;
    cancelUrl: string;
}

/** Datos para abrir una renovación automática (suscripción del proveedor). */
export interface SubscriptionRequest {
    tenantId: number;
    plan: Plan;
    /** Cobro de cada mes. */
    amount: number;
    currency: 'USD' | 'COP';
    reference: string;
    title: string;
    payerEmail: string;
    /** Primer cobro: el día que vence lo ya pagado (o `null` = ahora). */
    startAt: Date | null;
    returnUrl: string;
}

/** Sesión creada: la URL a la que se redirige a quien paga. */
export interface CheckoutSession {
    url: string;
    externalId: string;
}

/** Suscripción creada en el proveedor (todavía `pending` hasta autorizar la tarjeta). */
export interface SubscriptionSession extends CheckoutSession {
    status: AutoRenewStatus;
    nextPaymentAt: Date | null;
}

/**
 * Lo que un aviso del proveedor dice que pasó, ya verificado y normalizado.
 *
 *  - `payment`: un cobro (de un período o de una cuota de la suscripción).
 *    `externalId` identifica el COBRO: el mismo cobro que llega por dos
 *    caminos (el aviso del pago y el de la cuota) tiene el mismo id → el
 *    registro de pagos lo aplica una sola vez.
 *  - `subscription`: cambió el estado de la renovación automática.
 *
 * `tenantId` puede faltar en un cobro de suscripción cuya referencia no vino:
 * se resuelve por `subscriptionExternalId`.
 */
export type PaymentNotice =
    | {
          kind: 'payment';
          tenantId: number | null;
          plan: Plan | null;
          mode: CheckoutMode;
          months: number;
          externalId: string;
          status: BillingPaymentStatus;
          amount: number;
          currency: string;
          method: string | null;
          subscriptionExternalId?: string;
      }
    | {
          kind: 'subscription';
          tenantId: number | null;
          plan: Plan | null;
          externalId: string;
          status: AutoRenewStatus;
          amount: number;
          currency: string;
          nextPaymentAt: Date | null;
          authorizeUrl: string | null;
      };

/**
 * Pasarela de pago intercambiable (ADR-S12). Cada proveedor implementa esta
 * interfaz; el PaymentsService no conoce el detalle. `isEnabled` es async
 * porque las credenciales pueden venir de la consola (Redis), no sólo del
 * `.env`.
 */
export interface PaymentGateway {
    readonly provider: PaymentProvider;
    /** Admite renovación automática con tarjeta. */
    readonly supportsSubscription: boolean;
    isEnabled(): Promise<boolean>;
    createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
    createSubscription?(req: SubscriptionRequest): Promise<SubscriptionSession>;
    cancelSubscription?(externalId: string): Promise<void>;
    /** Verifica la firma y devuelve lo que pasó (vacío si no aplica o no es auténtico). */
    handleWebhook(
        headers: Record<string, string | undefined>,
        rawBody: string,
        query: Record<string, string | undefined>,
    ): Promise<PaymentNotice[]>;
}

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

/** El slug de plan es URL-safe (`[a-z0-9_]+`), así que viaja sin escapar en la ref. */
const PLAN_SLUG_RE = /^[a-z0-9_]+$/;

export interface DecodedReference {
    tenantId: number;
    plan?: Plan;
    mode: CheckoutMode;
    months: number;
    /** Monto esperado (sólo en los pagos de período): el aviso se valida contra él. */
    amount?: number;
}

/**
 * Referencia que viaja al proveedor y vuelve en el aviso:
 *  - período:      `p:{tenant}:{plan}:{meses}:{monto}`
 *  - suscripción:  `s:{tenant}:{plan}`
 *  - heredada:     `{tenant}:{plan}` (pagos abiertos antes de v0.1.250 = 1 mes)
 */
export function encodeReference(
    tenantId: number,
    plan: Plan,
    opts: { mode?: CheckoutMode; months?: number; amount?: number } = {},
): string {
    if (opts.mode === 'subscription') return `s:${tenantId}:${plan}`;
    if (opts.mode === 'period') {
        const amount = (opts.amount ?? 0).toFixed(2).replace(/\.00$/, '');
        return `p:${tenantId}:${plan}:${opts.months ?? 1}:${amount}`;
    }
    return `${tenantId}:${plan}`;
}

export function decodeReference(ref: string): DecodedReference | null {
    const parts = ref.split(':');
    const plan = (raw: string | undefined): Plan | undefined => (raw && PLAN_SLUG_RE.test(raw) ? raw : undefined);
    const id = (raw: string | undefined): number | null => {
        const n = Number(raw);
        return Number.isInteger(n) && n > 0 ? n : null;
    };
    if (parts[0] === 'p' || parts[0] === 's') {
        const tenantId = id(parts[1]);
        if (tenantId === null) return null;
        if (parts[0] === 's') return { tenantId, plan: plan(parts[2]), mode: 'subscription', months: 1 };
        const months = Number(parts[3]);
        const amount = Number(parts[4]);
        return {
            tenantId,
            plan: plan(parts[2]),
            mode: 'period',
            months: Number.isInteger(months) && months > 0 && months <= 24 ? months : 1,
            amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
        };
    }
    const tenantId = id(parts[0]);
    if (tenantId === null) return null;
    return { tenantId, plan: plan(parts[1]), mode: 'period', months: 1 };
}

/** «Tarjeta de crédito», «PSE», «Efecty»… en criollo, para el historial. */
export function paymentMethodLabel(typeId: string | undefined, methodId: string | undefined): string | null {
    const m = (methodId ?? '').toLowerCase();
    const named: Record<string, string> = {
        pse: 'PSE',
        efecty: 'Efecty',
        nequi: 'Nequi',
        daviplata: 'Daviplata',
        bancolombia: 'Bancolombia',
        account_money: 'Dinero en Mercado Pago',
    };
    if (named[m]) return named[m];
    switch (typeId) {
        case 'credit_card':
            return 'Tarjeta de crédito';
        case 'debit_card':
            return 'Tarjeta débito';
        case 'prepaid_card':
            return 'Tarjeta prepago';
        case 'bank_transfer':
            return 'Transferencia bancaria';
        case 'ticket':
            return 'Pago en efectivo';
        case 'atm':
            return 'Cajero';
        case 'account_money':
            return 'Dinero en Mercado Pago';
        default:
            return typeId ? typeId : null;
    }
}
