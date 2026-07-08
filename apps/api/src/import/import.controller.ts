import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { importRowsSchema, type ImportResult, type ImportRowsInput } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ImportService } from './import.service';

/**
 * Import de filas a una lista (CONTRACT §11). POST → bloqueado en solo-lectura
 * por impago (ADR-S09). Requiere import_records.
 */
@Controller('lists/:list/import')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ImportController {
    constructor(private readonly importService: ImportService) {}

    @Post()
    @HttpCode(200)
    @RequireCapability('import_records')
    import(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(importRowsSchema)) input: ImportRowsInput,
    ): Promise<ImportResult> {
        return this.importService.importRows(req.tenant!.tenantId, req.authUserId!, list, input);
    }
}
