import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    checklistTemplateFromChecklistSchema,
    createFromTemplateSchema,
    createRecordTemplateSchema,
    recordTemplateFromRecordSchema,
    recordTemplateKindSchema,
    updateRecordTemplateSchema,
    type ChecklistTemplateFromChecklistInput,
    type CreateFromTemplateInput,
    type CreateRecordTemplateInput,
    type FromTemplateResult,
    type RecordDto,
    type RecordTemplate,
    type RecordTemplateFromRecordInput,
    type UpdateRecordTemplateInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordTemplatesService } from './record-templates.service';

function actor(req: FastifyRequest): Actor {
    // C1 — con sus equipos: el acceso por equipo a la lista cuenta.
    return { userId: req.authUserId!, role: req.tenant!.role, teamIds: req.tenant!.teamIds };
}

/**
 * C6 — Plantillas de registro (y de checklist) de una lista. Las ve quien ve
 * los registros (para usarlas en el alta); las administran admins y managers
 * (`manage_lists` o `manage_views`).
 */
@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordTemplatesController {
    constructor(
        private readonly templates: RecordTemplatesService,
        private readonly records: RecordsService,
    ) {}

    @Get('record-templates')
    @RequireCapability('view_records', 'view_own_records')
    async list(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query('kind') kind?: string,
    ): Promise<{ data: RecordTemplate[] }> {
        const k = kind === undefined || kind === '' ? undefined : recordTemplateKindSchema.safeParse(kind);
        if (k && !k.success) throw new BadRequestException({ code: 'invalid_kind', message: 'Tipo de plantilla inválido.', data: { status: 400 } });
        return { data: await this.templates.list(req.tenant!.tenantId, list, k?.data) };
    }

    @Post('record-templates/from-record')
    @HttpCode(201)
    @RequireCapability('manage_lists', 'manage_views')
    async fromRecord(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(recordTemplateFromRecordSchema)) input: RecordTemplateFromRecordInput,
    ): Promise<{ data: RecordTemplate }> {
        return { data: await this.templates.fromRecord(req.tenant!.tenantId, actor(req), list, input) };
    }

    @Post('record-templates/from-checklist')
    @HttpCode(201)
    @RequireCapability('manage_lists', 'manage_views')
    async fromChecklist(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(checklistTemplateFromChecklistSchema)) input: ChecklistTemplateFromChecklistInput,
    ): Promise<{ data: RecordTemplate }> {
        return { data: await this.templates.fromChecklist(req.tenant!.tenantId, actor(req), list, input) };
    }

    @Get('record-templates/:id')
    @RequireCapability('view_records', 'view_own_records')
    async get(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: RecordTemplate }> {
        return { data: await this.templates.get(req.tenant!.tenantId, list, id) };
    }

    @Post('record-templates')
    @HttpCode(201)
    @RequireCapability('manage_lists', 'manage_views')
    async create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createRecordTemplateSchema)) input: CreateRecordTemplateInput,
    ): Promise<{ data: RecordTemplate }> {
        return { data: await this.templates.create(req.tenant!.tenantId, req.authUserId!, list, input) };
    }

    @Patch('record-templates/:id')
    @RequireCapability('manage_lists', 'manage_views')
    async update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateRecordTemplateSchema)) patch: UpdateRecordTemplateInput,
    ): Promise<{ data: RecordTemplate }> {
        return { data: await this.templates.update(req.tenant!.tenantId, req.authUserId!, list, id, patch) };
    }

    @Delete('record-templates/:id')
    @HttpCode(204)
    @RequireCapability('manage_lists', 'manage_views')
    async remove(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.templates.remove(req.tenant!.tenantId, req.authUserId!, list, id);
    }

    /**
     * Alta desde una plantilla: el registro, sus subtareas y sus checklists en
     * una transacción. Devuelve el registro creado (DTO de siempre) y lo que
     * no se pudo usar de la plantilla.
     */
    @Post('records/from-template')
    @HttpCode(201)
    @RequireCapability('create_records')
    async createFrom(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createFromTemplateSchema)) input: CreateFromTemplateInput,
    ): Promise<{ data: RecordDto; meta: FromTemplateResult }> {
        const out = await this.templates.createFromTemplate(req.tenant!.tenantId, actor(req), list, input);
        const record = await this.records.get(req.tenant!.tenantId, actor(req), list, out.record_id);
        return {
            data: record,
            meta: { record_id: out.record_id, subtask_ids: out.subtask_ids, checklist_ids: out.checklist_ids, warnings: out.warnings },
        };
    }
}
