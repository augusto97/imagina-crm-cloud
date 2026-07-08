import { z } from 'zod';

/**
 * Pagos (ADR-S12). Stripe no opera en Colombia, así que el cobro va por
 * proveedores locales/regionales detrás de una interfaz común: PayPal (USD) y
 * Mercado Pago (COP). El dominio (billing) no conoce el proveedor — enchufar
 * otro es un adapter nuevo, igual que los transportes de correo (ADR-S11).
 */
export const PAYMENT_PROVIDERS = ['paypal', 'mercadopago'] as const;
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

/** Planes con checkout self-serve (enterprise es "contactar ventas"). */
export const CHECKOUT_PLANS = ['starter', 'pro'] as const;
export const checkoutPlanSchema = z.enum(CHECKOUT_PLANS);
export type CheckoutPlan = z.infer<typeof checkoutPlanSchema>;

/** Precio mensual por plan y moneda. PayPal cobra en USD; Mercado Pago en COP. */
export const PLAN_PRICES: Record<CheckoutPlan, { usd: number; cop: number }> = {
    starter: { usd: 15, cop: 59_000 },
    pro: { usd: 49, cop: 199_000 },
};

/** Moneda que cobra cada proveedor. */
export const PROVIDER_CURRENCY: Record<PaymentProvider, 'USD' | 'COP'> = {
    paypal: 'USD',
    mercadopago: 'COP',
};

export function priceFor(plan: CheckoutPlan, provider: PaymentProvider): { amount: number; currency: 'USD' | 'COP' } {
    const currency = PROVIDER_CURRENCY[provider];
    const amount = currency === 'USD' ? PLAN_PRICES[plan].usd : PLAN_PRICES[plan].cop;
    return { amount, currency };
}

export const createCheckoutSchema = z.object({
    plan: checkoutPlanSchema,
    provider: paymentProviderSchema,
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

/** Resultado del checkout: URL a la que redirige el front para pagar. */
export const checkoutResultSchema = z.object({
    provider: paymentProviderSchema,
    plan: checkoutPlanSchema,
    url: z.string().url(),
    external_id: z.string(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/** Qué proveedores están habilitados (tienen credenciales) — para la UI. */
export const paymentConfigSchema = z.object({
    providers: z.array(paymentProviderSchema),
    prices: z.record(checkoutPlanSchema, z.object({ usd: z.number(), cop: z.number() })),
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;
