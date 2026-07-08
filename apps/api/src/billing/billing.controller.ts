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

@Controller('billing')
export class BillingController {
    constructor(
        private readonly billing: BillingService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Plan + estado + uso + límites del workspace activo. */
    @Get()
    @UseGuards(SessionGuard, TenantGuard)
    summary(@Req() req: FastifyRequest): Promise<BillingSummary> {
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
        if (!this.env.BILLING_WEBHOOK_SECRET || secret !== this.env.BILLING_WEBHOOK_SECRET) {
            throw new ForbiddenException('Webhook de billing no autorizado');
        }
        return this.billing.setBilling(body.tenant_id, {
            plan: body.plan,
            status: body.status,
        });
    }
}
