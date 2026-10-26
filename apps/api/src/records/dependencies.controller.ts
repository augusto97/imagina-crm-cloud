import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    createDependencyPairSchema,
    createDependencySchema,
    updateDependencySchema,
    updateDependencySettingsSchema,
    type CreateDependencyInput,
    type CreateDependencyPairInput,
    type DependencySettings,
    type RecordDependencies,
    type UpdateDependencyInput,
    type UpdateDependencySettingsInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DependenciesService } from './dependencies.service';
import type { Actor } from './records.service';

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, teamIds: req.tenant!.teamIds };
}

/**
 * A8 — Dependencias entre registros. Leer pide VER el registro; agregar,
 * cambiar el desfase o quitar pide EDITAR el registro bloqueado (lo valida el
 * service con el ACL de la lista). La reprogramación es un ajuste de la
 * lista (`manage_lists`).
 */
@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class DependenciesController {
    constructor(private readonly deps: DependenciesService) {}

    @Get('records/:id/dependencies')
    @RequireCapability('view_records', 'view_own_records')
    async forRecord(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: RecordDependencies }> {
        return { data: await this.deps.forRecord(req.tenant!.tenantId, actor(req), list, id) };
    }

    @Post('records/:id/dependencies')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    async add(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createDependencySchema)) input: CreateDependencyInput,
    ): Promise<{ data: RecordDependencies }> {
        return { data: await this.deps.add(req.tenant!.tenantId, actor(req), list, id, input) };
    }

    @Delete('records/:id/dependencies/:depId')
    @HttpCode(204)
    @RequireCapability('edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('depId', ParseIntPipe) depId: number,
    ): Promise<void> {
        await this.deps.remove(req.tenant!.tenantId, actor(req), list, depId, id);
    }

    /** Alta por las dos puntas (Gantt: arrastrar de una barra a otra). */
    @Post('dependencies')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    async addPair(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createDependencyPairSchema)) input: CreateDependencyPairInput,
    ): Promise<{ data: { id: number; blocker_id: number; blocked_id: number; lag_days: number; created: boolean } }> {
        return {
            data: await this.deps.addPair(req.tenant!.tenantId, actor(req), list, input.blocker_id, input.blocked_id, input.lag_days ?? 0),
        };
    }

    @Get('dependencies/settings')
    @RequireCapability('view_records', 'view_own_records')
    async settings(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: DependencySettings }> {
        return { data: await this.deps.settings(req.tenant!.tenantId, list) };
    }

    @Patch('dependencies/settings')
    @RequireCapability('manage_lists')
    async updateSettings(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(updateDependencySettingsSchema)) patch: UpdateDependencySettingsInput,
    ): Promise<{ data: DependencySettings }> {
        return { data: await this.deps.updateSettings(req.tenant!.tenantId, actor(req), list, patch) };
    }

    @Patch('dependencies/:depId')
    @RequireCapability('edit_records', 'edit_own_records')
    async updateLag(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('depId', ParseIntPipe) depId: number,
        @Body(new ZodValidationPipe(updateDependencySchema)) input: UpdateDependencyInput,
    ): Promise<{ data: { id: number; lag_days: number } }> {
        return { data: await this.deps.updateLag(req.tenant!.tenantId, actor(req), list, depId, input.lag_days) };
    }

    @Delete('dependencies/:depId')
    @HttpCode(204)
    @RequireCapability('edit_records', 'edit_own_records')
    async removeById(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('depId', ParseIntPipe) depId: number,
    ): Promise<void> {
        await this.deps.remove(req.tenant!.tenantId, actor(req), list, depId);
    }
}
