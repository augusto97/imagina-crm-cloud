import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { globalSearchQuerySchema, type GlobalSearchHit, type GlobalSearchQuery } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordSearchService } from './record-search.service';

/**
 * `GET /search?q=` — registros de TODAS las listas visibles, por título
 * (paleta de comandos). Misma capability que el listado de registros; el
 * ACL por lista lo aplica el service.
 */
@Controller('search')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordSearchController {
    constructor(private readonly search: RecordSearchService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    run(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(globalSearchQuerySchema)) query: GlobalSearchQuery,
    ): Promise<GlobalSearchHit[]> {
        return this.search.search(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role, teamIds: req.tenant!.teamIds }, query);
    }
}
