import { Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
    updateBrandingSchema,
    type BrandingResponse,
    type MembershipSummary,
    type UpdateBrandingInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard, type TenantContext } from '../tenancy/tenant.guard';
import { BrandingService } from './branding.service';

@Controller('workspaces')
@UseGuards(SessionGuard)
export class WorkspacesController {
    constructor(
        private readonly auth: AuthService,
        private readonly branding: BrandingService,
    ) {}

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

    /** Branding del workspace — lo lee cualquier miembro (lo aplica el boot). */
    @Get('current/branding')
    @UseGuards(TenantGuard)
    getBranding(@Req() req: FastifyRequest): Promise<BrandingResponse> {
        return this.branding.get(req.tenant!.tenantId);
    }

    /** Editarlo es exclusivo del admin del workspace (mismo gate que Miembros). */
    @Patch('current/branding')
    @UseGuards(TenantGuard)
    updateBranding(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateBrandingSchema)) patch: UpdateBrandingInput,
    ): Promise<BrandingResponse> {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo el admin del workspace puede editar la marca',
                data: { status: 403 },
            });
        }
        return this.branding.update(req.tenant!.tenantId, patch);
    }
}
