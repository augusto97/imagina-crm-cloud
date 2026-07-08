import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { ExportBundle } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ExportService } from './export.service';

/**
 * Export de intercambio de una lista (CONTRACT §11). GET → sigue disponible
 * en solo-lectura por impago (ADR-S09). Requiere export_records.
 */
@Controller('lists/:list/export')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ExportController {
    constructor(private readonly exportService: ExportService) {}

    @Get()
    @RequireCapability('export_records')
    export(@Req() req: FastifyRequest, @Param('list') list: string): Promise<ExportBundle> {
        // `new Date()` acá es válido (código de app, no workflow script).
        return this.exportService.exportList(req.tenant!.tenantId, list, new Date().toISOString());
    }
}
