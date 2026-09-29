import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
    storeBulkApplySchema,
    storeBulkPreviewSchema,
    type StoreBulkApplyInput,
    type StoreBulkCatalog,
    type StoreBulkPreview,
    type StoreBulkPreviewInput,
    type StoreBulkResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { StoreBulkService } from './store-bulk.service';

/**
 * Edición masiva de la tienda (v0.1.217): cambia productos y variaciones EN
 * WooCommerce por lotes. Es una acción masiva (`bulk_actions`) y el service
 * exige además que la tienda tenga «Editar desde la app» activado y aplica el
 * alcance de edición del rol sobre la lista.
 */
@Controller('lists/:list/store-bulk')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('bulk_actions')
export class StoreBulkController {
    constructor(private readonly bulk: StoreBulkService) {}

    @Get('catalog')
    async catalog(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: StoreBulkCatalog }> {
        return { data: await this.bulk.catalog(req.tenant!.tenantId, list) };
    }

    @Get('attributes/:id/terms')
    async terms(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: Array<{ slug: string; name: string }> }> {
        return { data: await this.bulk.attributeTerms(req.tenant!.tenantId, list, id) };
    }

    @Post('preview')
    @HttpCode(200)
    preview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(storeBulkPreviewSchema)) input: StoreBulkPreviewInput,
    ): Promise<StoreBulkPreview> {
        return this.bulk.preview(req.tenant!.tenantId, actor(req), list, input.target, input.operations, input.include_variations);
    }

    @Post('apply')
    @HttpCode(200)
    apply(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(storeBulkApplySchema)) input: StoreBulkApplyInput,
    ): Promise<StoreBulkResult> {
        return this.bulk.apply(req.tenant!.tenantId, actor(req), list, input.ids, input.operations, input.include_variations);
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
