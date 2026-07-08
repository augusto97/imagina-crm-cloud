import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { MembershipSummary } from '@imagina-crm/shared';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { TenantGuard, type TenantContext } from '../tenancy/tenant.guard';

@Controller('workspaces')
@UseGuards(SessionGuard)
export class WorkspacesController {
    constructor(private readonly auth: AuthService) {}

    /** Workspaces del usuario autenticado (plano auth, sin tenant activo). */
    @Get()
    async mine(@Req() req: FastifyRequest): Promise<{ data: MembershipSummary[] }> {
        return { data: await this.auth.membershipsOf(req.authUserId as number) };
    }

    /** Tenant activo resuelto vía X-Tenant-Id + membership (TenantGuard). */
    @Get('current')
    @UseGuards(TenantGuard)
    current(@Req() req: FastifyRequest): TenantContext {
        return req.tenant as TenantContext;
    }
}
