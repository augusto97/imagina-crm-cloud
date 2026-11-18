import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    createWebhookSubscriptionSchema,
    updateWebhookSubscriptionSchema,
    type CreateWebhookSubscriptionInput,
    type CreatedWebhookSubscriptionDto,
    type UpdateWebhookSubscriptionInput,
    type WebhookDeliveryDto,
    type WebhookSubscriptionDto,
    type WebhookTestResultDto,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { aclOf } from '../tenancy/acl-of';
import { EventWebhooksService, type WebhookRequester } from './event-webhooks.service';

/**
 * v0.1.442 (addendum de ADR-S105) — Webhooks de eventos de la empresa. Los
 * administra quien tiene «Usar la API» (los administradores siempre): desde
 * Ajustes → API o por la API misma con un token (así n8n registra y borra su
 * propio webhook al encender o apagar un flujo).
 */
@Controller('webhooks')
@UseGuards(SessionGuard, TenantGuard)
@PlanModule('api')
export class EventWebhooksController {
    constructor(private readonly webhooks: EventWebhooksService) {}

    private who(req: FastifyRequest): WebhookRequester {
        return {
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId!,
            role: req.tenant!.role, ...aclOf(req),
            via: req.apiToken ? 'api' : 'app',
        };
    }

    @Get()
    async list(@Req() req: FastifyRequest): Promise<{ data: WebhookSubscriptionDto[] }> {
        return { data: await this.webhooks.list(this.who(req)) };
    }

    @Post()
    @HttpCode(201)
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createWebhookSubscriptionSchema)) input: CreateWebhookSubscriptionInput,
    ): Promise<CreatedWebhookSubscriptionDto> {
        return this.webhooks.create(this.who(req), input);
    }

    @Get(':id')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<WebhookSubscriptionDto> {
        return this.webhooks.get(this.who(req), id);
    }

    @Patch(':id')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateWebhookSubscriptionSchema)) input: UpdateWebhookSubscriptionInput,
    ): Promise<WebhookSubscriptionDto> {
        return this.webhooks.update(this.who(req), id, input);
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.webhooks.remove(this.who(req), id);
    }

    @Post(':id/test')
    @HttpCode(200)
    test(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<WebhookTestResultDto> {
        return this.webhooks.test(this.who(req), id);
    }

    @Post(':id/rotate-secret')
    @HttpCode(200)
    rotate(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<CreatedWebhookSubscriptionDto> {
        return this.webhooks.rotateSecret(this.who(req), id);
    }

    @Get(':id/deliveries')
    async deliveries(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Query('limit') limit?: string,
        @Query('before') before?: string,
    ): Promise<{ data: WebhookDeliveryDto[] }> {
        const n = Number(limit);
        const b = Number(before);
        return {
            data: await this.webhooks.deliveries(this.who(req), id, {
                ...(Number.isInteger(n) && n > 0 ? { limit: n } : {}),
                ...(Number.isInteger(b) && b > 0 ? { before: b } : {}),
            }),
        };
    }

    @Post(':id/deliveries/:deliveryId/redeliver')
    @HttpCode(200)
    redeliver(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('deliveryId', ParseIntPipe) deliveryId: number,
    ): Promise<WebhookDeliveryDto> {
        return this.webhooks.redeliver(this.who(req), id, deliveryId);
    }
}
