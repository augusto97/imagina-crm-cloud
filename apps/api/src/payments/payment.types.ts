import type { BillingStatus, PaymentProvider, Plan } from '@imagina-base/shared';

/** Datos para abrir un checkout en el proveedor. */
export interface CheckoutRequest {
    tenantId: number;
    plan: Plan;
    amount: number;
    currency: 'USD' | 'COP';
    /** Referencia opaca que el proveedor devuelve en el webhook (`tenantId:plan`). */
    reference: string;
    returnUrl: string;
    cancelUrl: string;
}

/** Sesión de checkout creada: la URL a la que se redirige al cliente. */
export interface CheckoutSession {
    url: string;
    externalId: string;
}

/** Evento normalizado de un webhook de pago → mapea a plan/estado del tenant. */
export interface PaymentEvent {
    tenantId: number;
    plan?: Plan;
    status: BillingStatus;
}

/**
 * Pasarela de pago intercambiable (ADR-S12). Cada proveedor (PayPal, Mercado
 * Pago) implementa esta interfaz; el PaymentsService no conoce la
 * implementación. `enabled` es false si faltan credenciales (degradación).
 */
export interface PaymentGateway {
    readonly provider: PaymentProvider;
    readonly enabled: boolean;
    createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
    /** Verifica la firma y devuelve el evento normalizado, o null si no aplica. */
    handleWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<PaymentEvent | null>;
}

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

/** El slug de plan es URL-safe (`[a-z0-9_]+`), así que viaja sin escapar en la ref. */
const PLAN_SLUG_RE = /^[a-z0-9_]+$/;

/** Codifica/decodifica la referencia `tenantId:plan` que viaja al proveedor. */
export function encodeReference(tenantId: number, plan: Plan): string {
    return `${tenantId}:${plan}`;
}
export function decodeReference(ref: string): { tenantId: number; plan?: Plan } | null {
    const [rawId, plan] = ref.split(':');
    const tenantId = Number(rawId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return null;
    return { tenantId, plan: plan && PLAN_SLUG_RE.test(plan) ? plan : undefined };
}
