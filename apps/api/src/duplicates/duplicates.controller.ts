import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
    duplicateCheckSchema,
    duplicateDismissSchema,
    duplicateSettingsInputSchema,
    mergePreviewSchema,
    mergeRecordsSchema,
    type DuplicateCheckInput,
    type DuplicateDismissInput,
    type DuplicateGroupsPage,
    type DuplicateMatch,
    type DuplicateSettings,
    type DuplicateSettingsInput,
    type MergePreview,
    type MergePreviewInput,
    type MergeRecordsInput,
    type MergeResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DuplicatesService } from './duplicates.service';
import { RecordMergeService } from './record-merge.service';

/**
 * A14 (v0.1.445, ADR-S106) — Duplicados de una lista: reglas, aviso al
 * crear, grupos, «no son duplicados» y fusionar. El alcance por fila (quién
 * ve, edita y borra qué) lo resuelven los services con el ACL de la lista.
 */
@Controller('lists/:list/duplicates')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class DuplicatesController {
    constructor(
        private readonly duplicates: DuplicatesService,
        private readonly merge: RecordMergeService,
    ) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    groups(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query('offset') offset?: string,
        @Query('limit') limit?: string,
    ): Promise<DuplicateGroupsPage> {
        return this.duplicates.groups(tenantId(req), actor(req), list, { offset: toInt(offset), limit: toInt(limit) });
    }

    @Get('settings')
    @RequireCapability('view_records', 'view_own_records')
    settings(@Req() req: FastifyRequest, @Param('list') list: string): Promise<DuplicateSettings> {
        return this.duplicates.settings(tenantId(req), actor(req), list);
    }

    @Put('settings')
    @RequireCapability('manage_lists')
    updateSettings(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(duplicateSettingsInputSchema)) input: DuplicateSettingsInput,
    ): Promise<DuplicateSettings> {
        return this.duplicates.updateSettings(tenantId(req), actor(req), list, input);
    }

    /** Lo que se está escribiendo en el alta ¿ya existe? */
    @Post('check')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    check(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(duplicateCheckSchema)) input: DuplicateCheckInput,
    ): Promise<DuplicateMatch[]> {
        return this.duplicates.check(tenantId(req), actor(req), list, input.values, { excludeId: input.exclude_id, purpose: 'create' });
    }

    /** Los posibles duplicados de un registro (banner de la ficha). */
    @Get('record/:id')
    @RequireCapability('view_records', 'view_own_records')
    forRecord(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<DuplicateMatch[]> {
        return this.duplicates.forRecord(tenantId(req), actor(req), list, id);
    }

    @Post('dismiss')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    dismiss(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(duplicateDismissSchema)) input: DuplicateDismissInput,
    ): Promise<{ pairs: number }> {
        return this.duplicates.dismiss(tenantId(req), actor(req), list, input.ids);
    }

    @Post('merge/preview')
    @HttpCode(200)
    @RequireCapability('delete_records', 'delete_own_records')
    mergePreview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(mergePreviewSchema)) input: MergePreviewInput,
    ): Promise<MergePreview> {
        return this.merge.preview(tenantId(req), actor(req), list, input.primary_id, input.duplicate_ids);
    }

    @Post('merge')
    @HttpCode(200)
    @RequireCapability('delete_records', 'delete_own_records')
    mergeRecords(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(mergeRecordsSchema)) input: MergeRecordsInput,
    ): Promise<MergeResult> {
        return this.merge.merge(tenantId(req), actor(req), list, input);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

function toInt(v: string | undefined): number | undefined {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
}
