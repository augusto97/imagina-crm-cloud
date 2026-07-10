import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ExportService } from './export.service';

/**
 * Export de intercambio de una lista (CONTRACT §11). GET → sigue disponible
 * en solo-lectura por impago (ADR-S09). Requiere export_records.
 *
 * SEC-10: se STREAMEA el bundle JSON (misma forma) en vez de acumular todos
 * los records en memoria → evita OOM en listas grandes.
 */
@Controller('lists/:list/export')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ExportController {
    constructor(private readonly exportService: ExportService) {}

    @Get()
    @RequireCapability('export_records')
    async export(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        reply.raw.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': 'attachment; filename="export.json"',
        });
        // `new Date()` acá es válido (código de app, no workflow script).
        await this.exportService.streamExport(
            req.tenant!.tenantId,
            list,
            new Date().toISOString(),
            (chunk) => reply.raw.write(chunk),
        );
        reply.raw.end();
    }
}
