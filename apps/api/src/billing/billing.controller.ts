import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Headers,
    HttpCode,
    Inject,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { setBillingSchema, type BillingSummary } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BillingService } from './billing.service';

const webhookBodySchema = setBillingSchema.extend({
    tenant_id: z.number().int().positive(),
});
type WebhookBody = z.infer<typeof webhookBodySchema>;

/** Comparación de secretos en tiempo constante (evita timing leak). */
function safeEqual(a: string | undefined, b: string): boolean {
    if (!a) return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

@Controller('billing')
export class BillingController {
    constructor(
        private readonly billing: BillingService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Plan + estado + uso + límites del workspace activo (solo admin, SEC-18). */
    @Get()
    @UseGuards(SessionGuard, TenantGuard)
    summary(@Req() req: FastifyRequest): Promise<BillingSummary> {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo un admin puede ver la facturación',
                data: { status: 403 },
            });
        }
        return this.billing.summary(req.tenant!.tenantId);
    }

    /**
     * Webhook de billing (stand-in de Stripe). Público pero gateado por un
     * secret compartido — NO pasa por TenantGuard, así puede reactivar un
     * workspace en read-only (canceled/past_due → active). En producción se
     * reemplaza la verificación del secret por la firma de Stripe.
     */
    @Post('webhook')
    @HttpCode(200)
    async webhook(
        @Headers('x-billing-secret') secret: string | undefined,
        @Body(new ZodValidationPipe(webhookBodySchema)) body: WebhookBody,
    ): Promise<BillingSummary> {
        // SEC-16: comparación timing-safe del secret compartido.
        if (!this.env.BILLING_WEBHOOK_SECRET || !safeEqual(secret, this.env.BILLING_WEBHOOK_SECRET)) {
            throw new ForbiddenException('Webhook de billing no autorizado');
        }
        return this.billing.setBilling(body.tenant_id, {
            plan: body.plan,
            status: body.status,
        });
    }
}
