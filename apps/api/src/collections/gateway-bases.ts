import type { Env } from '../config/env';
import { DEFAULT_GATEWAY_BASES, type GatewayBases } from './collection-gateways';

/**
 * Las bases de las APIs de cobro. En desarrollo pueden apuntar a un proveedor
 * SIMULADO (los E2E no tienen credenciales reales); en producción, siempre las
 * reales — una variable mal puesta no puede desviar los cobros.
 */
export function gatewayBases(
    env: Pick<Env, 'NODE_ENV' | 'MERCADOPAGO_API_URL' | 'WOMPI_API_URL' | 'WOMPI_CHECKOUT_URL' | 'PAYPAL_COLLECT_API_URL'>,
): GatewayBases {
    if (env.NODE_ENV === 'production') return DEFAULT_GATEWAY_BASES;
    const wompi = env.WOMPI_API_URL.replace(/\/+$/, '');
    // v0.1.372 — un solo PayPal simulado para los dos ambientes (en el simulado
    // el Client ID dice de cuál es).
    const paypal = env.PAYPAL_COLLECT_API_URL.replace(/\/+$/, '');
    return {
        mercadopago: env.MERCADOPAGO_API_URL || DEFAULT_GATEWAY_BASES.mercadopago,
        wompiProduction: wompi || DEFAULT_GATEWAY_BASES.wompiProduction,
        wompiSandbox: wompi || DEFAULT_GATEWAY_BASES.wompiSandbox,
        wompiCheckout: env.WOMPI_CHECKOUT_URL || DEFAULT_GATEWAY_BASES.wompiCheckout,
        paypalLive: paypal ? `${paypal}/live` : DEFAULT_GATEWAY_BASES.paypalLive,
        paypalSandbox: paypal ? `${paypal}/sandbox` : DEFAULT_GATEWAY_BASES.paypalSandbox,
    };
}
