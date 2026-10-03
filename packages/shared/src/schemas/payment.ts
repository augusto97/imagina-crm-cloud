import { z } from 'zod';
import { planSchema } from './billing';

/**
 * Pagos (ADR-S12). Stripe no opera en Colombia, así que el cobro va por
 * proveedores locales/regionales detrás de una interfaz común: PayPal (USD) y
 * Mercado Pago (COP). El dominio (billing) no conoce el proveedor — enchufar
 * otro es un adapter nuevo, igual que los transportes de correo (ADR-S11).
 */
export const PAYMENT_PROVIDERS = ['paypal', 'mercadopago'] as const;
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

/** Moneda que cobra cada proveedor. PayPal → USD; Mercado Pago → COP. */
export const PROVIDER_CURRENCY: Record<PaymentProvider, 'USD' | 'COP'> = {
    paypal: 'USD',
    mercadopago: 'COP',
};
export type Currency = 'USD' | 'COP';

/**
 * Precio de checkout de un plan (ADR-S15 F3). Vive en la tabla `plans`, editable
 * por el operador — así un plan **custom** también se puede vender self-serve.
 * `null` en una moneda = el plan no se cobra con el proveedor de esa moneda
 * (p.ej. enterprise = "contactar ventas", o un plan sólo-USD sin precio COP).
 */
export const planPriceSchema = z.object({
    slug: planSchema,
    name: z.string(),
    usd: z.number().nullable(),
    cop: z.number().nullable(),
});
export type PlanPrice = z.infer<typeof planPriceSchema>;

/** Un plan es vendible con un proveedor si tiene precio en la moneda de éste. */
export function priceInCurrency(price: PlanPrice, currency: Currency): number | null {
    return currency === 'USD' ? price.usd : price.cop;
}

/**
 * v0.1.250 — Dos formas de pagar un plan:
 *  - `period`: pagar N meses de una vez (Checkout Pro de Mercado Pago o
 *    PayPal). Sirve con PSE, Nequi, efectivo y tarjeta; cada pago aprobado
 *    EXTIENDE el período pagado.
 *  - `subscription`: renovación automática con tarjeta (suscripciones de
 *    Mercado Pago): el proveedor cobra todos los meses y cada cobro aprobado
 *    extiende un mes.
 */
export const CHECKOUT_MODES = ['period', 'subscription'] as const;
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];
/** Meses que se pueden pagar de una vez. */
export const PERIOD_MONTHS = [1, 3, 6, 12] as const;
export type PeriodMonths = (typeof PERIOD_MONTHS)[number];

export const createCheckoutSchema = z
    .object({
        plan: planSchema,
        provider: paymentProviderSchema,
        mode: z.enum(CHECKOUT_MODES).default('period'),
        months: z.coerce
            .number()
            .int()
            .refine((m) => (PERIOD_MONTHS as readonly number[]).includes(m), 'Elegí 1, 3, 6 o 12 meses')
            .default(1),
        /**
         * Renovación automática: el correo de la cuenta de Mercado Pago que va
         * a autorizar la tarjeta (si falta, el de quien la activa).
         */
        payer_email: z.string().trim().email().max(254).optional(),
    })
    .refine((v) => v.mode === 'period' || v.provider === 'mercadopago', {
        message: 'La renovación automática sólo está disponible con Mercado Pago',
        path: ['provider'],
    });
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

/** Resultado del checkout: URL a la que redirige el front para pagar. */
export const checkoutResultSchema = z.object({
    provider: paymentProviderSchema,
    plan: planSchema,
    mode: z.enum(CHECKOUT_MODES).default('period'),
    url: z.string().url(),
    external_id: z.string(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/**
 * Config de pagos para la UI: proveedores habilitados (con credenciales) +
 * los planes vendibles self-serve con su precio. La lista es DINÁMICA (sale de
 * la tabla `plans`): incluye los planes custom que el operador marque con precio.
 */
export const paymentConfigSchema = z.object({
    providers: z.array(paymentProviderSchema),
    plans: z.array(planPriceSchema),
    /** Proveedores que admiten renovación automática (hoy, Mercado Pago). */
    subscription_providers: z.array(paymentProviderSchema).default([]),
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

// ── Período pagado, historial y renovación automática (v0.1.250) ──────────

/**
 * Suma meses a una fecha conservando la hora y RECORTANDO al último día del
 * mes destino: 31-ene + 1 mes = 28/29-feb (si no, `setUTCMonth` se pasaría a
 * marzo y el cliente pagaría un mes de 28 días por uno de 31).
 */
export function addMonthsClamped(date: Date, months: number): Date {
    const d = new Date(date.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d;
}

/**
 * El período nuevo arranca donde termina el pagado (si todavía no venció) o
 * desde hoy (si ya venció o nunca hubo): pagar por adelantado no pierde días
 * y pagar tarde no regala los que pasaron sin pagar.
 */
export function extendPaidUntil(current: Date | null, now: Date, months: number): Date {
    const base = current && current.getTime() > now.getTime() ? current : now;
    return addMonthsClamped(base, months);
}

export const BILLING_PAYMENT_STATUSES = ['approved', 'pending', 'rejected', 'refunded'] as const;
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];

export const billingPaymentSchema = z.object({
    id: z.number(),
    provider: paymentProviderSchema,
    kind: z.enum(CHECKOUT_MODES),
    plan: planSchema,
    months: z.number(),
    amount: z.number(),
    currency: z.string(),
    status: z.enum(BILLING_PAYMENT_STATUSES),
    /** «Tarjeta», «PSE», «Efecty»… en criollo. */
    method: z.string().nullable(),
    /** Hasta cuándo dejó pagado este pago (sólo los aprobados). */
    period_end: z.string().nullable(),
    created_at: z.string(),
});
export type BillingPayment = z.infer<typeof billingPaymentSchema>;

export const AUTO_RENEW_STATUSES = ['pending', 'authorized', 'paused', 'cancelled'] as const;
export type AutoRenewStatus = (typeof AUTO_RENEW_STATUSES)[number];

export const autoRenewSchema = z.object({
    provider: paymentProviderSchema,
    plan: planSchema,
    status: z.enum(AUTO_RENEW_STATUSES),
    amount: z.number(),
    currency: z.string(),
    next_payment_at: z.string().nullable(),
    /** Enlace para terminar de autorizar la tarjeta (mientras está `pending`). */
    authorize_url: z.string().nullable(),
    updated_at: z.string(),
});
export type AutoRenew = z.infer<typeof autoRenewSchema>;

export const subscriptionInfoSchema = z.object({
    plan: planSchema,
    /** Hasta cuándo está pagado por la app. */
    paid_until: z.string().nullable(),
    /** Desde cuándo pasa a solo-lectura si no se renueva (vencimiento + gracia). */
    read_only_at: z.string().nullable(),
    grace_days: z.number(),
    /** Corte manual del operador, si lo hay. */
    manual_ends_at: z.string().nullable(),
    auto_renew: autoRenewSchema.nullable(),
    payments: z.array(billingPaymentSchema),
});
export type SubscriptionInfo = z.infer<typeof subscriptionInfoSchema>;

// ── Credenciales de cobro de la PLATAFORMA (v0.1.250) ──────────────────────

/**
 * Las credenciales de Mercado Pago con las que la PLATAFORMA cobra sus planes.
 * Se cargan desde Plataforma → Cobros (cifradas con `SECRETS_KEY`) en vez del
 * `.env`; el `.env` queda como respaldo. Nunca vuelven: sólo un hint.
 */
export const platformPaymentsViewSchema = z.object({
    mercadopago: z.object({
        configured: z.boolean(),
        /** Las credenciales salen del `.env` (no se cargaron en la consola). */
        from_env: z.boolean(),
        /** `TEST-…` = sandbox; `APP_USR-…` = producción. */
        mode: z.enum(['test', 'live']).nullable(),
        access_token_hint: z.string().nullable(),
        webhook_secret_set: z.boolean(),
        /** La URL para pegar en Mercado Pago → Tus integraciones → Webhooks. */
        webhook_url: z.string(),
    }),
    paypal: z.object({ configured: z.boolean() }),
});
export type PlatformPaymentsView = z.infer<typeof platformPaymentsViewSchema>;

export const updatePlatformPaymentsSchema = z.object({
    /** Vacío = conservar la guardada. */
    mercadopago_access_token: z.string().trim().max(512).optional(),
    mercadopago_webhook_secret: z.string().trim().max(512).optional(),
    /** Borra lo cargado en la consola (vuelve al `.env`, si hay). */
    clear_mercadopago: z.boolean().optional(),
});
export type UpdatePlatformPaymentsInput = z.infer<typeof updatePlatformPaymentsSchema>;

/** Un pago reciente de cualquier empresa, para la consola. */
export const platformPaymentRowSchema = billingPaymentSchema.extend({
    tenant_id: z.number(),
    tenant_name: z.string(),
});
export type PlatformPaymentRow = z.infer<typeof platformPaymentRowSchema>;
