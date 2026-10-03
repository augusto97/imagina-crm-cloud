import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ENV, type Env } from '../config/env';
import { BillingRemindersBootstrap, BillingRemindersService } from './billing-reminders.service';
import { PaymentsController, PlatformPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAYS, type PaymentGateway } from './payment.types';
import { PlatformPaymentsService } from './platform-payments.service';
import { MercadoPagoGateway, MP_API } from './providers/mercadopago.provider';
import { PayPalGateway } from './providers/paypal.provider';

/**
 * Pagos (ADR-S12). Registra las pasarelas disponibles (PayPal + Mercado Pago);
 * cada una se auto-deshabilita si faltan sus credenciales. Las de Mercado Pago
 * se cargan desde Plataforma → Cobros (v0.1.250), con el `.env` de respaldo.
 */
@Module({
    imports: [AuthModule],
    controllers: [PaymentsController, PlatformPaymentsController],
    providers: [
        PlatformPaymentsService,
        {
            provide: PAYMENT_GATEWAYS,
            inject: [ENV, PlatformPaymentsService],
            useFactory: (env: Env, platform: PlatformPaymentsService): PaymentGateway[] => [
                new PayPalGateway(env),
                new MercadoPagoGateway(
                    platform,
                    undefined,
                    env.NODE_ENV !== 'production' && env.MERCADOPAGO_API_URL ? env.MERCADOPAGO_API_URL : MP_API,
                ),
            ],
        },
        PaymentsService,
        BillingRemindersService,
        BillingRemindersBootstrap,
        SuperadminGuard,
    ],
    exports: [PaymentsService],
})
export class PaymentsModule {}
