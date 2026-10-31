import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    fileImportAiStartSchema,
    fileImportAnalyzeSchema,
    fileImportApplySchema,
    type FileImportAiJob,
    type FileImportAnalysis,
    type FileImportAnalyzeInput,
    type FileImportApplyInput,
    type FileImportApplyResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import type { AiToolContext } from '../ai/tools/registry';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { FileImportAiService } from './file-import-ai.service';
import { FileImportService } from './file-import.service';

/**
 * v0.1.339 (ADR-S88) — «Crear desde un archivo». Crear listas exige
 * `manage_lists` (el mismo permiso de «Nueva lista»). Cerrado a invitados (no
 * lleva `@AllowGuest()`); un cliente del portal no llega (TenantGuard). Las
 * hojas viajan con el tipo de contenido propio (`FILE_IMPORT_CONTENT_TYPE`,
 * ver main.ts): su tope es mayor que el del resto del API.
 */
@Controller('file-import')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class FileImportController {
    constructor(
        private readonly service: FileImportService,
        private readonly ai: FileImportAiService,
    ) {}

    /** Perfil del archivo + borrador del plan (reglas, gratis). */
    @Post('analyze')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    analyze(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(fileImportAnalyzeSchema)) input: FileImportAnalyzeInput,
    ): Promise<FileImportAnalysis> {
        return this.service.analyze(toolCtx(req), input);
    }

    /** Afinar el borrador con IA (resumen protegido; corre en segundo plano). */
    @Post(':id/ai')
    @HttpCode(202)
    @RequireCapability('manage_lists')
    startAi(
        @Req() req: FastifyRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(fileImportAiStartSchema)) _input: unknown,
    ): Promise<FileImportAiJob> {
        return this.ai.start(toolCtx(req), id);
    }

    @Get(':id/ai')
    @RequireCapability('manage_lists')
    aiJob(@Req() req: FastifyRequest, @Param('id') id: string): Promise<FileImportAiJob> {
        return this.ai.get(req.tenant!.tenantId, req.authUserId!, id);
    }

    /** Crea las listas, los registros y los vínculos del plan revisado. */
    @Post('apply')
    @HttpCode(201)
    @RequireCapability('manage_lists')
    apply(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(fileImportApplySchema)) input: FileImportApplyInput,
    ): Promise<FileImportApplyResult> {
        return this.service.apply(toolCtx(req), input);
    }
}

function toolCtx(req: FastifyRequest): AiToolContext {
    return { tenantId: req.tenant!.tenantId, userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
