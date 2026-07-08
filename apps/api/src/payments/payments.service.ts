import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
    PLAN_PRICES,
    priceFor,
    type CheckoutResult,
    type CreateCheckoutInput,
    type PaymentConfig,
    type PaymentProvider,
} from '@imagina-base/shared';
import { BillingService } from '../billing/billing.service';
import { ENV, type Env } from '../config/env';
import { encodeReference, PAYMENT_GATEWAYS, type PaymentGateway } from './payment.types';

/**
 * Orquesta el cobro (ADR-S12) sobre las pasarelas registradas. No conoce el
 * detalle de cada proveedor: sólo elige el gateway, arma el checkout y aplica
 * el evento del webhook al billing del tenant.
 */
@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);
    private readonly byProvider: Map<PaymentProvider, PaymentGateway>;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(PAYMENT_GATEWAYS) gateways: PaymentGateway[],
        private readonly billing: BillingService,
    ) {
        this.byProvider = new Map(gateways.map((g) => [g.provider, g]));
    }

    /** Proveedores habilitados (con credenciales) + precios — para la UI. */
    config(): PaymentConfig {
        const providers = [...this.byProvider.values()].filter((g) => g.enabled).map((g) => g.provider);
        return { providers, prices: PLAN_PRICES };
    }

    async createCheckout(tenantId: number, input: CreateCheckoutInput): Promise<CheckoutResult> {
        const gateway = this.byProvider.get(input.provider);
        if (!gateway || !gateway.enabled) {
            throw new BadRequestException({
                code: 'provider_unavailable',
                message: `El proveedor ${input.provider} no está disponible`,
                data: { status: 400, errors: { provider: 'no configurado' } },
            });
        }
        const { amount, currency } = priceFor(input.plan, input.provider);
        const session = await gateway.createCheckout({
            tenantId,
            plan: input.plan,
            amount,
            currency,
            reference: encodeReference(tenantId, input.plan),
            returnUrl: `${this.env.APP_BASE_URL}/settings?checkout=success`,
            cancelUrl: `${this.env.APP_BASE_URL}/settings?checkout=cancel`,
        });
        return { provider: input.provider, plan: input.plan, url: session.url, external_id: session.externalId };
    }

    /** Procesa un webhook de pago: verifica, mapea y aplica el estado al tenant. */
    async handleWebhook(
        provider: PaymentProvider,
        headers: Record<string, string | undefined>,
        rawBody: string,
    ): Promise<void> {
        const gateway = this.byProvider.get(provider);
        if (!gateway) return;
        const event = await gateway.handleWebhook(headers, rawBody);
        if (!event) return;
        await this.billing.setBilling(event.tenantId, { plan: event.plan, status: event.status });
        this.logger.log(
            `webhook ${provider}: tenant ${event.tenantId} → ${event.plan ?? '—'}/${event.status}`,
        );
    }
}
