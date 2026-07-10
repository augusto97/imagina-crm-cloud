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

export const createCheckoutSchema = z.object({
    plan: planSchema,
    provider: paymentProviderSchema,
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

/** Resultado del checkout: URL a la que redirige el front para pagar. */
export const checkoutResultSchema = z.object({
    provider: paymentProviderSchema,
    plan: planSchema,
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
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;
