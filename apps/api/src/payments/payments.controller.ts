import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Headers,
    HttpCode,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createCheckoutSchema,
    paymentProviderSchema,
    type CheckoutResult,
    type CreateCheckoutInput,
    type PaymentConfig,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PaymentsService } from './payments.service';

/**
 * Cobro (ADR-S12). `config` y `checkout` operan sobre el tenant activo (sesión
 * + admin). Los webhooks son públicos por proveedor: la firma la verifica cada
 * gateway sobre el cuerpo crudo (rawBody), no un guard.
 */
@Controller('billing')
export class PaymentsController {
    constructor(private readonly payments: PaymentsService) {}

    @Get('payments/config')
    @UseGuards(SessionGuard, TenantGuard)
    config(): Promise<PaymentConfig> {
        return this.payments.config();
    }

    @Post('checkout')
    @UseGuards(SessionGuard, TenantGuard)
    checkout(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createCheckoutSchema)) input: CreateCheckoutInput,
    ): Promise<CheckoutResult> {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo un admin puede gestionar la suscripción',
                data: { status: 403 },
            });
        }
        return this.payments.createCheckout(req.tenant!.tenantId, input);
    }

    /**
     * Webhook por proveedor (paypal | mercadopago). Público: la autenticidad la
     * da la verificación de firma dentro del gateway sobre el rawBody. Siempre
     * responde 200 (los proveedores reintentan ante no-2xx).
     */
    @Post('webhook/:provider')
    @HttpCode(200)
    async webhook(
        @Param('provider') provider: string,
        @Req() req: FastifyRequest & { rawBody?: Buffer },
        @Headers() headers: Record<string, string | undefined>,
    ): Promise<{ ok: true }> {
        const parsed = paymentProviderSchema.safeParse(provider);
        if (!parsed.success) return { ok: true };
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
        await this.payments.handleWebhook(parsed.data, headers, rawBody);
        return { ok: true };
    }
}
