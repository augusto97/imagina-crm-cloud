import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    createSqlSyncSchema,
    sqlPreviewSchema,
    updateSqlSyncSchema,
    type CreateSqlSyncInput,
    type Role,
    type SqlPreviewInput,
    type SqlPreviewResult,
    type SqlSync,
    type SqlSyncDryRun,
    type UpdateSqlSyncInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SqlSyncService } from './sql-sync.service';

/**
 * Sincronizaciones desde SQL Server / Azure SQL (v0.1.243). Traen datos de una
 * base externa a una lista: `manage_lists` y, en el service, poder EDITAR la
 * conexión (la misma puerta que la sincronización de la tienda).
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_lists')
export class SqlSyncController {
    constructor(private readonly syncs: SqlSyncService) {}

    @Get('connections/:id/sql-syncs')
    async list(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SqlSync[] }> {
        return { data: await this.syncs.list(tenant(req), user(req), role(req), id) };
    }

    @Post('connections/:id/sql-syncs')
    @HttpCode(201)
    async create(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createSqlSyncSchema)) input: CreateSqlSyncInput,
    ): Promise<{ data: SqlSync }> {
        return { data: await this.syncs.create(tenant(req), user(req), role(req), id, input) };
    }

    /** Probar una consulta (no guarda nada). */
    @Post('connections/:id/sql-preview')
    @HttpCode(200)
    async preview(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(sqlPreviewSchema)) input: SqlPreviewInput,
    ): Promise<{ data: SqlPreviewResult }> {
        return { data: await this.syncs.preview(tenant(req), user(req), role(req), id, input) };
    }

    @Get('sql-syncs/:id')
    async get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SqlSync }> {
        return { data: await this.syncs.get(tenant(req), user(req), role(req), id) };
    }

    @Patch('sql-syncs/:id')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateSqlSyncSchema)) input: UpdateSqlSyncInput,
    ): Promise<{ data: SqlSync }> {
        return { data: await this.syncs.update(tenant(req), user(req), role(req), id, input) };
    }

    @Post('sql-syncs/:id/run')
    @HttpCode(202)
    async run(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SqlSync }> {
        return { data: await this.syncs.runNow(tenant(req), user(req), role(req), id) };
    }

    /** Qué haría una corrida, sin escribir nada. */
    @Post('sql-syncs/:id/dry-run')
    @HttpCode(200)
    async dryRun(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SqlSyncDryRun }> {
        return { data: await this.syncs.dryRun(tenant(req), user(req), role(req), id) };
    }

    @Delete('sql-syncs/:id')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.syncs.remove(tenant(req), user(req), role(req), id);
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
