import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    createChecklistItemsSchema,
    createChecklistSchema,
    reorderChecklistIdsSchema,
    updateChecklistItemSchema,
    updateChecklistSchema,
    type CreateChecklistInput,
    type CreateChecklistItemsInput,
    type RecordChecklists,
    type RecordDto,
    type ReorderChecklistIdsInput,
    type UpdateChecklistInput,
    type UpdateChecklistItemInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ChecklistsService } from './checklists.service';

function actor(req: FastifyRequest): Actor {
    // C1/C2/C3 — con sus equipos, rol propio y capacidades efectivas.
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

/**
 * A9 — Checklists de un registro. Leer pide VER el registro; cualquier cambio
 * pide EDITARLO (lo valida el service con el ACL de la lista). Convertir un
 * ítem en subtarea, además, crear registros.
 */
@Controller('lists/:list/records/:id')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ChecklistsController {
    constructor(private readonly checklists: ChecklistsService) {}

    @Get('checklists')
    @RequireCapability('view_records', 'view_own_records')
    async list(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.forRecord(req.tenant!.tenantId, actor(req), list, id) };
    }

    @Post('checklists')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    async create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createChecklistSchema)) input: CreateChecklistInput,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.create(req.tenant!.tenantId, actor(req), list, id, input) };
    }

    @Patch('checklists/reorder')
    @RequireCapability('edit_records', 'edit_own_records')
    async reorderChecklists(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(reorderChecklistIdsSchema)) input: ReorderChecklistIdsInput,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.reorderChecklists(req.tenant!.tenantId, actor(req), list, id, input.ids) };
    }

    @Patch('checklists/:checklistId')
    @RequireCapability('edit_records', 'edit_own_records')
    async rename(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('checklistId', ParseIntPipe) checklistId: number,
        @Body(new ZodValidationPipe(updateChecklistSchema)) patch: UpdateChecklistInput,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.rename(req.tenant!.tenantId, actor(req), list, id, checklistId, patch) };
    }

    @Delete('checklists/:checklistId')
    @RequireCapability('edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('checklistId', ParseIntPipe) checklistId: number,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.remove(req.tenant!.tenantId, actor(req), list, id, checklistId) };
    }

    @Post('checklists/:checklistId/items')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    async addItems(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('checklistId', ParseIntPipe) checklistId: number,
        @Body(new ZodValidationPipe(createChecklistItemsSchema)) input: CreateChecklistItemsInput,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.addItems(req.tenant!.tenantId, actor(req), list, id, checklistId, input) };
    }

    @Patch('checklists/:checklistId/items/reorder')
    @RequireCapability('edit_records', 'edit_own_records')
    async reorderItems(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('checklistId', ParseIntPipe) checklistId: number,
        @Body(new ZodValidationPipe(reorderChecklistIdsSchema)) input: ReorderChecklistIdsInput,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.reorderItems(req.tenant!.tenantId, actor(req), list, id, checklistId, input.ids) };
    }

    @Patch('checklist-items/:itemId')
    @RequireCapability('edit_records', 'edit_own_records')
    async updateItem(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('itemId', ParseIntPipe) itemId: number,
        @Body(new ZodValidationPipe(updateChecklistItemSchema)) patch: UpdateChecklistItemInput,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.updateItem(req.tenant!.tenantId, actor(req), list, id, itemId, patch) };
    }

    @Delete('checklist-items/:itemId')
    @RequireCapability('edit_records', 'edit_own_records')
    async removeItem(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('itemId', ParseIntPipe) itemId: number,
    ): Promise<{ data: RecordChecklists }> {
        return { data: await this.checklists.removeItem(req.tenant!.tenantId, actor(req), list, id, itemId) };
    }

    @Post('checklist-items/:itemId/to-subtask')
    @HttpCode(201)
    @RequireCapability('create_records')
    async toSubtask(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('itemId', ParseIntPipe) itemId: number,
    ): Promise<{ data: { record: RecordDto; checklists: RecordChecklists } }> {
        return { data: await this.checklists.convertToSubtask(req.tenant!.tenantId, actor(req), list, id, itemId) };
    }
}
