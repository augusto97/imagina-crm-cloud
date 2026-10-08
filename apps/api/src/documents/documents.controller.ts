import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    createDocumentTemplateSchema,
    documentPreviewInputSchema,
    generateDocumentInputSchema,
    updateDocumentTemplateSchema,
    type CreateDocumentTemplateInput,
    type DocumentPreviewInput,
    type DocumentPreviewResult,
    type DocumentTemplate,
    type DocumentTemplateSummary,
    type GenerateDocumentInput,
    type GenerateDocumentResult,
    type UpdateDocumentTemplateInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DocumentsService } from './documents.service';

/**
 * v0.1.266 (ADR-S35) — Plantillas de documentos PDF de una lista.
 * Diseñarlas es de quien arma la lista o sus automatizaciones; generar el PDF
 * de un registro, de quien puede verlo (con su ACL: los campos que tiene
 * ocultos no aparecen en el documento).
 */
@Controller('lists/:list/documents')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class DocumentsController {
    constructor(private readonly documents: DocumentsService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    list(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: DocumentTemplateSummary[] }> {
        return this.documents.list(req.tenant!.tenantId, list).then((data) => ({ data }));
    }

    @Post('preview')
    @HttpCode(200)
    @RequireCapability('manage_lists', 'manage_automations')
    preview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(documentPreviewInputSchema)) input: DocumentPreviewInput,
    ): Promise<DocumentPreviewResult> {
        return this.documents.preview(req.tenant!.tenantId, actor(req), list, input);
    }

    @Get(':id')
    @RequireCapability('view_records', 'view_own_records')
    get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<DocumentTemplate> {
        return this.documents.get(req.tenant!.tenantId, list, id);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_lists', 'manage_automations')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createDocumentTemplateSchema)) input: CreateDocumentTemplateInput,
    ): Promise<DocumentTemplate> {
        return this.documents.create(req.tenant!.tenantId, req.authUserId!, list, input);
    }

    @Patch(':id')
    @RequireCapability('manage_lists', 'manage_automations')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateDocumentTemplateSchema)) input: UpdateDocumentTemplateInput,
    ): Promise<DocumentTemplate> {
        return this.documents.update(req.tenant!.tenantId, req.authUserId!, list, id, input);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_lists', 'manage_automations')
    async remove(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.documents.remove(req.tenant!.tenantId, req.authUserId!, list, id);
    }

    /** El PDF de un registro (y, si se pide, guardado en un campo Archivo). */
    @Post(':id/generate')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    generate(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(generateDocumentInputSchema)) input: GenerateDocumentInput & { record_id: number },
    ): Promise<GenerateDocumentResult & { pdf: string }> {
        return this.documents.generateForRecord(req.tenant!.tenantId, actor(req), list, input.record_id, id, input);
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
