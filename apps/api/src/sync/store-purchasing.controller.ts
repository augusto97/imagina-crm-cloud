import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
    createPurchaseOrderSchema,
    purchasePreviewSchema,
    type CreatePurchaseOrderInput,
    type PurchaseOrderCreated,
    type PurchasePreviewInput,
    type PurchasePreviewItem,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { StorePurchasingService } from './store-purchasing.service';

/**
 * Reposición (v0.1.209): crear una orden de compra desde una selección de
 * productos o variaciones. Alcanza con poder CREAR registros (quien compra no
 * tiene por qué administrar la conexión con la tienda); el resto de los
 * permisos los aplica `RecordsService` lista por lista.
 */
@Controller('connections/:id/purchasing')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('create_records')
export class StorePurchasingController {
    constructor(private readonly purchasing: StorePurchasingService) {}

    @Post('preview')
    @HttpCode(200)
    async preview(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(purchasePreviewSchema)) input: PurchasePreviewInput,
    ): Promise<{ data: PurchasePreviewItem[] }> {
        return { data: await this.purchasing.preview(req.tenant!.tenantId, actor(req), id, input) };
    }

    @Post('orders')
    @HttpCode(201)
    async create(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createPurchaseOrderSchema)) input: CreatePurchaseOrderInput,
    ): Promise<{ data: PurchaseOrderCreated }> {
        return { data: await this.purchasing.createOrder(req.tenant!.tenantId, actor(req), id, input) };
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
