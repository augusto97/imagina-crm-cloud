import { Controller, Get, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import type { RecordViewBundle, Role } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordViewService } from './record-view.service';

/**
 * `GET /lists/:list/records/:id/view` — todo lo que la ficha del registro
 * necesita al abrir, en un request (ver RecordViewService). Lectura: exige
 * poder ver registros; el ACL fino lo aplica cada service.
 */
@Controller('lists/:list/records/:id/view')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordViewController {
    constructor(private readonly service: RecordViewService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async view(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: RecordViewBundle }> {
        const actor = { userId: req.authUserId!, role: req.tenant!.role as Role, teamIds: req.tenant!.teamIds };
        return { data: await this.service.bundle(req.tenant!.tenantId, actor, list, id) };
    }
}
