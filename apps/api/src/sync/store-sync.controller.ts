import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
    mapStoreMetaSchema,
    runStoreSyncSchema,
    setupStoreSyncSchema,
    unmapStoreMetaSchema,
    updateStoreSyncSchema,
    type MapStoreMetaInput,
    type Role,
    type RunStoreSyncInput,
    type SetupStoreSyncInput,
    type StoreSyncStatus,
    type UnmapStoreMetaInput,
    type UpdateStoreSyncInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { StoreSyncService } from './store-sync.service';

/**
 * Sincronización con tiendas (v0.1.206, ADR-S24). Crea listas y trae datos de
 * afuera a nombre de la empresa: exige `manage_lists` y, en el service, poder
 * EDITAR la conexión de la tienda.
 */
@Controller('connections/:id/sync')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_lists')
export class StoreSyncController {
    constructor(private readonly sync: StoreSyncService) {}

    @Get()
    async status(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: StoreSyncStatus }> {
        return { data: await this.sync.status(tenant(req), user(req), role(req), id) };
    }

    @Post()
    @HttpCode(201)
    async setup(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(setupStoreSyncSchema)) input: SetupStoreSyncInput,
    ): Promise<{ data: StoreSyncStatus }> {
        return { data: await this.sync.setup(tenant(req), user(req), role(req), id, input) };
    }

    @Patch()
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateStoreSyncSchema)) input: UpdateStoreSyncInput,
    ): Promise<{ data: StoreSyncStatus }> {
        return { data: await this.sync.update(tenant(req), user(req), role(req), id, input) };
    }

    @Post('run')
    @HttpCode(202)
    async run(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(runStoreSyncSchema)) input: RunStoreSyncInput,
    ): Promise<{ data: StoreSyncStatus }> {
        return { data: await this.sync.runNow(tenant(req), user(req), role(req), id, input.full) };
    }

    @Put('meta')
    async mapMeta(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(mapStoreMetaSchema)) input: MapStoreMetaInput,
    ): Promise<{ data: StoreSyncStatus }> {
        return { data: await this.sync.mapMeta(tenant(req), user(req), role(req), id, input) };
    }

    @Post('meta/unmap')
    @HttpCode(200)
    async unmapMeta(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(unmapStoreMetaSchema)) input: UnmapStoreMetaInput,
    ): Promise<{ data: StoreSyncStatus }> {
        return { data: await this.sync.unmapMeta(tenant(req), user(req), role(req), id, input) };
    }

    @Delete()
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.sync.remove(tenant(req), user(req), role(req), id);
    }
}

function tenant(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
function user(req: FastifyRequest): number {
    return req.authUserId!;
}
function role(req: FastifyRequest): Role {
    return req.tenant!.role as Role;
}
