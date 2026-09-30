import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    importCsvPreviewSchema,
    importCsvRunSchema,
    importRowsSchema,
    importUpdateSchema,
    type ImportUpdateInput,
    type ImportUpdatePreview,
    type ImportUpdateResult,
    type ImportCsvPreviewInput,
    type ImportCsvPreviewResult,
    type ImportCsvRunInput,
    type ImportCsvRunResult,
    type ImportResult,
    type ImportRowsInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ImportUpdateService } from './import-update.service';
import { ImportService } from './import.service';

/**
 * Import de filas a una lista (CONTRACT §11). POST → bloqueado en solo-lectura
 * por impago (ADR-S09). Requiere import_records.
 */
@Controller('lists/:list/import')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ImportController {
    constructor(
        private readonly importService: ImportService,
        private readonly updater: ImportUpdateService,
    ) {}

    /**
     * v0.1.219 — Actualizar registros existentes desde un archivo: vista
     * previa (todo el archivo) y aplicación por tramos de hasta 200 filas.
     */
    @Post('update/preview')
    @HttpCode(200)
    @RequireCapability('import_records')
    updatePreview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(importUpdateSchema)) input: ImportUpdateInput,
    ): Promise<ImportUpdatePreview> {
        return this.updater.preview(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role }, list, input);
    }

    @Post('update')
    @HttpCode(200)
    @RequireCapability('import_records')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(importUpdateSchema)) input: ImportUpdateInput,
    ): Promise<ImportUpdateResult> {
        return this.updater.apply(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role }, list, input);
    }

    @Post()
    @HttpCode(200)
    @RequireCapability('import_records')
    import(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(importRowsSchema)) input: ImportRowsInput,
    ): Promise<ImportResult> {
        return this.importService.importRows(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role }, list, input);
    }

    /** Paso 1 del ImportDialog: inspección del CSV sin escribir nada. */
    @Post('preview')
    @HttpCode(200)
    @RequireCapability('import_records')
    preview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(importCsvPreviewSchema)) input: ImportCsvPreviewInput,
    ): Promise<ImportCsvPreviewResult> {
        return this.importService.preview(req.tenant!.tenantId, list, input.csv, input.mode);
    }

    /** Paso 2: mapping confirmado + campos nuevos → bulk insert. */
    @Post('run')
    @HttpCode(200)
    @RequireCapability('import_records')
    run(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(importCsvRunSchema)) input: ImportCsvRunInput,
    ): Promise<ImportCsvRunResult> {
        return this.importService.runCsv(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role }, list, input);
    }
}
