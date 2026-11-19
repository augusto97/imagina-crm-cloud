import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    createSheetSyncSchema,
    sheetPreviewSchema,
    updateSheetSyncSchema,
    type CreateSheetSyncInput,
    type Role,
    type SheetPreviewInput,
    type SheetPreviewResult,
    type SheetSync,
    type SheetSyncDryRun,
    type UpdateSheetSyncInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AclSubject } from '../lists/list-acl';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SheetSyncService } from './sheet-sync.service';

/**
 * v0.1.459 (G3) — Sincronizaciones de una lista con una hoja de Google Sheets.
 * `manage_lists`, el módulo «Integraciones» del plan y, en el service, poder
 * EDITAR la conexión y ver la lista y los campos que se sincronizan.
 */
@PlanModule('integrations')
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
@RequireCapability('manage_lists')
export class SheetSyncController {
    constructor(private readonly syncs: SheetSyncService) {}

    @Get('connections/:id/sheet-syncs')
    async list(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SheetSync[] }> {
        return { data: await this.syncs.list(tenant(req), actor(req), id) };
    }

    @Post('connections/:id/sheet-syncs')
    @HttpCode(201)
    async create(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createSheetSyncSchema)) input: CreateSheetSyncInput,
    ): Promise<{ data: SheetSync }> {
        return { data: await this.syncs.create(tenant(req), actor(req), id, input) };
    }

    /** Abrir una planilla (no guarda nada). */
    @Post('connections/:id/sheet-preview')
    @HttpCode(200)
    async preview(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(sheetPreviewSchema)) input: SheetPreviewInput,
    ): Promise<{ data: SheetPreviewResult }> {
        return { data: await this.syncs.preview(tenant(req), actor(req), id, input) };
    }

    @Get('sheet-syncs/:id')
    async get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SheetSync }> {
        return { data: await this.syncs.get(tenant(req), actor(req), id) };
    }

    @Patch('sheet-syncs/:id')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateSheetSyncSchema)) input: UpdateSheetSyncInput,
    ): Promise<{ data: SheetSync }> {
        return { data: await this.syncs.update(tenant(req), actor(req), id, input) };
    }

    @Post('sheet-syncs/:id/run')
    @HttpCode(202)
    async run(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SheetSync }> {
        return { data: await this.syncs.runNow(tenant(req), actor(req), id) };
    }

    /** Qué haría la próxima corrida, sin escribir nada. */
    @Post('sheet-syncs/:id/dry-run')
    @HttpCode(200)
    async dryRun(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: SheetSyncDryRun }> {
        return { data: await this.syncs.dryRun(tenant(req), actor(req), id) };
    }

    @Delete('sheet-syncs/:id')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.syncs.remove(tenant(req), actor(req), id);
    }
}

function tenant(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actor(req: FastifyRequest): AclSubject {
    return { userId: req.authUserId!, role: req.tenant!.role as Role, ...aclOf(req) };
}
