import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
    codeSearchQuerySchema,
    globalSearchQuerySchema,
    type CodeSearchQuery,
    type CodeSearchResult,
    type GlobalSearchHit,
    type GlobalSearchQuery,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordSearchService } from './record-search.service';
import { aclOf } from '../tenancy/acl-of';

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
        return this.search.search(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) }, query);
    }

    /**
     * H3 — `GET /search/code?code=&list=&field=` — el código leído con la
     * cámara: en todas las listas (sin `list`) o en una (su campo «Código»).
     */
    @Get('code')
    @RequireCapability('view_records', 'view_own_records')
    async code(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(codeSearchQuerySchema)) query: CodeSearchQuery,
    ): Promise<{ data: CodeSearchResult }> {
        return { data: await this.search.findByCode(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) }, query) };
    }
}
