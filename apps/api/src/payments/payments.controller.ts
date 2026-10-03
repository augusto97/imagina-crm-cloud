import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Headers,
    HttpCode,
    Inject,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createCheckoutSchema,
    paymentProviderSchema,
    updatePlatformPaymentsSchema,
    type CheckoutResult,
    type CreateCheckoutInput,
    type PaymentConfig,
    type PlatformPaymentRow,
    type PlatformPaymentsView,
    type SubscriptionInfo,
    type UpdatePlatformPaymentsInput,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DRIZZLE, type Db } from '../db/client';
import { users } from '../db/schema';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PaymentsService } from './payments.service';
import { PlatformPaymentsService } from './platform-payments.service';

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant!.role !== 'admin') {
        throw new ForbiddenException({
            code: 'admin_only',
            message: 'Sólo un admin puede gestionar la suscripción',
            data: { status: 403 },
        });
    }
}

/**
 * Cobro de los planes (ADR-S12, v0.1.250). Todo lo de la empresa se permite en
 * solo-lectura (`@AllowReadOnly`): una empresa vencida tiene que poder pagar.
 * Los avisos son públicos por proveedor: la autenticidad la verifica cada
 * gateway sobre el cuerpo crudo.
 */
@Controller('billing')
export class PaymentsController {
    constructor(
        private readonly payments: PaymentsService,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    @Get('payments/config')
    @UseGuards(SessionGuard, TenantGuard)
    config(): Promise<PaymentConfig> {
        return this.payments.config();
    }

    @Post('checkout')
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    async checkout(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createCheckoutSchema)) input: CreateCheckoutInput,
    ): Promise<CheckoutResult> {
        assertAdmin(req);
        let email = input.payer_email;
        if (!email) {
            const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, req.authUserId!)).limit(1);
            email = u?.email ?? '';
        }
        return this.payments.createCheckout(req.tenant!.tenantId, email, input);
    }

    @Get('subscription')
    @UseGuards(SessionGuard, TenantGuard)
    subscription(@Req() req: FastifyRequest): Promise<SubscriptionInfo> {
        assertAdmin(req);
        return this.payments.subscriptionInfo(req.tenant!.tenantId);
    }

    @Post('subscription/cancel')
    @HttpCode(200)
    @AllowReadOnly()
    @UseGuards(SessionGuard, TenantGuard)
    cancel(@Req() req: FastifyRequest): Promise<SubscriptionInfo> {
        assertAdmin(req);
        return this.payments.cancelAutoRenew(req.tenant!.tenantId);
    }

    /**
     * Aviso por proveedor (paypal | mercadopago). Público: la autenticidad la da
     * la firma, verificada dentro del gateway. Si el proveedor no responde al
     * releer el pago, el error sube (500) y el proveedor reintenta; un aviso
     * falso o ajeno responde 200 sin hacer nada.
     */
    @Post('webhook/:provider')
    @HttpCode(200)
    async webhook(
        @Param('provider') provider: string,
        @Req() req: FastifyRequest & { rawBody?: Buffer },
        @Headers() headers: Record<string, string | undefined>,
        @Query() query: Record<string, string | undefined>,
    ): Promise<{ ok: true }> {
        const parsed = paymentProviderSchema.safeParse(provider);
        if (!parsed.success) return { ok: true };
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
        await this.payments.handleWebhook(parsed.data, headers, rawBody, query);
        return { ok: true };
    }
}

/** Plataforma → Cobros: las credenciales con las que se cobran los planes y los pagos recientes. */
@Controller('platform/payments')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformPaymentsController {
    constructor(
        private readonly settings: PlatformPaymentsService,
        private readonly payments: PaymentsService,
    ) {}

    @Get()
    view(): Promise<PlatformPaymentsView> {
        return this.settings.view();
    }

    @Patch()
    update(
        @Body(new ZodValidationPipe(updatePlatformPaymentsSchema)) input: UpdatePlatformPaymentsInput,
    ): Promise<PlatformPaymentsView> {
        return this.settings.update(input);
    }

    @Get('recent')
    recent(@Query('limit') limit?: string): Promise<PlatformPaymentRow[]> {
        return this.payments.recentPayments(limit ? Number(limit) || 100 : 100);
    }
}
