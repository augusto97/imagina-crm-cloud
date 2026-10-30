import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    updatePublicDashboardSchema,
    type PublicDashboardAdmin,
    type PublicDashboardBundle,
    type UpdatePublicDashboardInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import type { DashboardViewer } from '../dashboards/dashboards.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { devPublicPage, loadBuiltPublicPage, missingBuildPage, publicDashboardCsp, unavailableDashboardPage } from './public-dashboard-page';
import { PublicDashboardsService } from './public-dashboards.service';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';

function viewer(req: FastifyRequest): DashboardViewer {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

/**
 * v0.1.292 (ADR-S50) — Compartir → Enlace público (quien puede cambiar el
 * tablero: su creador o un admin, con `manage_dashboards`).
 */
@PlanModule('public_sharing')
@Controller('dashboards')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class PublicDashboardsAdminController {
    constructor(private readonly publicDashboards: PublicDashboardsService) {}

    @Get(':id/public')
    @RequireCapability('manage_dashboards')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PublicDashboardAdmin> {
        return this.publicDashboards.getAdmin(req.tenant!.tenantId, id, viewer(req));
    }

    @Patch(':id/public')
    @RequireCapability('manage_dashboards')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updatePublicDashboardSchema)) input: UpdatePublicDashboardInput,
    ): Promise<PublicDashboardAdmin> {
        return this.publicDashboards.update(req.tenant!.tenantId, id, viewer(req), input);
    }

    @Post(':id/public/regenerate')
    @HttpCode(200)
    @RequireCapability('manage_dashboards')
    regenerate(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PublicDashboardAdmin> {
        return this.publicDashboards.regenerate(req.tenant!.tenantId, id, viewer(req));
    }
}

/**
 * Los datos de la página pública, SIN sesión: el token es la credencial.
 * `?period=` sólo se aplica si quien publicó dejó cambiar el período.
 */
@Controller('public/dashboards')
export class PublicDashboardsDataController {
    constructor(private readonly publicDashboards: PublicDashboardsService) {}

    @Get(':token')
    async bundle(
        @Param('token') token: string,
        @Query('period') period: string | undefined,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<PublicDashboardBundle> {
        void reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
        return this.publicDashboards.bundle(token, typeof period === 'string' ? period : undefined);
    }
}

/**
 * La página HTML (`/api/v1/public/d/:token`), pensada también para un
 * `<iframe>`: `frame-ancestors` con los dominios que eligió quien publicó.
 */
@Controller('public/d')
export class PublicDashboardPageController {
    constructor(
        private readonly publicDashboards: PublicDashboardsService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Get(':token')
    async page(@Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        let domains: string[];
        try {
            domains = (await this.publicDashboards.pageConfig(token)).allowed_domains;
        } catch {
            reply
                .status(404)
                .header('Content-Security-Policy', publicDashboardCsp([]).replace("script-src 'self'", "script-src 'none'"))
                .header('X-Robots-Tag', 'noindex')
                .header('Cache-Control', 'no-store')
                .type('text/html; charset=utf-8')
                .send(unavailableDashboardPage());
            return;
        }
        const useBuild = this.env.NODE_ENV === 'production' || this.env.WEB_DIST_DIR.trim() !== '';
        let html: string;
        let csp: string;
        if (useBuild) {
            const built = loadBuiltPublicPage(this.env.WEB_DIST_DIR);
            if (!built) {
                reply.status(503).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(missingBuildPage());
                return;
            }
            html = built;
            csp = publicDashboardCsp(domains);
        } else {
            const nonce = randomBytes(16).toString('base64');
            html = devPublicPage(nonce);
            csp = publicDashboardCsp(domains, { dev: true, nonce });
        }
        reply
            .header('Content-Security-Policy', csp)
            .header('X-Robots-Tag', 'noindex')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin')
            .header('X-Content-Type-Options', 'nosniff')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(html);
    }
}
