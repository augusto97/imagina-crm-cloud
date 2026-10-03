import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    createPaymentLinkSchema,
    type CollectionConnection,
    type CollectionConnectionDetail,
    type CollectionFields,
    type CreatePaymentLinkInput,
    type PaymentLink,
    type RecordPayments,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CollectionsService, type CollectionActor } from './collections.service';

/**
 * Cobros de la empresa a sus clientes (v0.1.251, ADR-S31). Crear un link es
 * EDITAR el registro (queda escrito en él); verlo, verlo.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class CollectionsController {
    constructor(private readonly collections: CollectionsService) {}

    @Get('collections/connections')
    @RequireCapability('view_records', 'view_own_records')
    async connections(@Req() req: FastifyRequest): Promise<{ data: CollectionConnection[] }> {
        return { data: await this.collections.connectionsFor(tenantId(req), actorOf(req)) };
    }

    /** El panel «Cobros» de una conexión (sólo quien puede editarla). */
    @Get('collections/connections/:id')
    async connection(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<CollectionConnectionDetail> {
        return this.collections.connectionDetail(tenantId(req), actorOf(req), id);
    }

    @Get('lists/:list/records/:recordId/payments')
    @RequireCapability('view_records', 'view_own_records')
    record(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
    ): Promise<RecordPayments> {
        return this.collections.recordPayments(tenantId(req), actorOf(req), list, recordId);
    }

    @Post('lists/:list/records/:recordId/payments')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(createPaymentLinkSchema)) input: CreatePaymentLinkInput,
    ): Promise<PaymentLink> {
        return this.collections.createForRecord(tenantId(req), actorOf(req), list, recordId, input);
    }

    @Post('payment-links/:id/verify')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    verify(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PaymentLink> {
        return this.collections.verifyLink(tenantId(req), actorOf(req), id);
    }

    @Post('payment-links/:id/cancel')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    cancel(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PaymentLink> {
        return this.collections.cancelLink(tenantId(req), actorOf(req), id);
    }

    /** Crea en la lista las columnas de cobro que falten. */
    @Post('lists/:list/collections/setup')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setup(@Req() req: FastifyRequest, @Param('list') list: string): Promise<CollectionFields> {
        return this.collections.setupFields(tenantId(req), actorOf(req), list);
    }
}

/**
 * Avisos de pago de Mercado Pago y Wompi. PÚBLICO: el token de la URL dice de
 * qué conexión es; el estado del pago se RELEE del proveedor con la
 * credencial de esa empresa (y Wompi además firma el aviso).
 */
@Controller('public/collections')
export class CollectionHooksController {
    constructor(private readonly collections: CollectionsService) {}

    @Post(':token')
    @HttpCode(200)
    async receive(
        @Param('token') token: string,
        @Query() query: Record<string, unknown>,
        @Body() body: unknown,
    ): Promise<{ ok: true }> {
        await this.collections.handleHook(token, query ?? {}, body ?? {});
        return { ok: true };
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorOf(req: FastifyRequest): CollectionActor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
