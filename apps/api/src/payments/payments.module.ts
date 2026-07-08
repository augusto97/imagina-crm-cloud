import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAYS, type PaymentGateway } from './payment.types';
import { MercadoPagoGateway } from './providers/mercadopago.provider';
import { PayPalGateway } from './providers/paypal.provider';

/**
 * Pagos (ADR-S12). Registra las pasarelas disponibles (PayPal + Mercado Pago);
 * cada una se auto-deshabilita si faltan sus credenciales. BillingModule es
 * @Global, así que BillingService se inyecta sin re-importar.
 */
@Module({
    controllers: [PaymentsController],
    providers: [
        {
            provide: PAYMENT_GATEWAYS,
            inject: [ENV],
            useFactory: (env: Env): PaymentGateway[] => [
                new PayPalGateway(env),
                new MercadoPagoGateway(env),
            ],
        },
        PaymentsService,
    ],
    exports: [PaymentsService],
})
export class PaymentsModule {}
