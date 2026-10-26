import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    dashboardSubscriptionInputSchema,
    type DashboardSubscription,
    type DashboardSubscriptionInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { DashboardViewer } from '../dashboards/dashboards.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DashboardSubscriptionsService, type SubscriptionSendResult } from './dashboard-subscriptions.service';
import { aclOf } from '../tenancy/acl-of';

function viewer(req: FastifyRequest): DashboardViewer {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

/**
 * v0.1.292 (ADR-S50) — Envíos programados de un tablero por correo. Mandar los
 * datos de la empresa por correo —también a externos— es compartir: hace falta
 * `manage_dashboards` y poder ver el tablero. Cada uno maneja los suyos; el
 * admin, todos.
 */
@Controller('dashboards')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class DashboardSubscriptionsController {
    constructor(private readonly subscriptions: DashboardSubscriptionsService) {}

    @Get(':id/subscriptions')
    @RequireCapability('manage_dashboards')
    list(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<DashboardSubscription[]> {
        return this.subscriptions.list(req.tenant!.tenantId, id, viewer(req));
    }

    @Post(':id/subscriptions')
    @RequireCapability('manage_dashboards')
    create(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(dashboardSubscriptionInputSchema)) input: DashboardSubscriptionInput,
    ): Promise<DashboardSubscription> {
        return this.subscriptions.create(req.tenant!.tenantId, id, viewer(req), input);
    }

    /** «Enviarme una prueba ahora» con lo que está en el formulario (no se guarda). */
    @Post(':id/subscriptions/test')
    @HttpCode(200)
    @RequireCapability('manage_dashboards')
    test(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(dashboardSubscriptionInputSchema)) input: DashboardSubscriptionInput,
    ): Promise<SubscriptionSendResult> {
        return this.subscriptions.sendTest(req.tenant!.tenantId, id, viewer(req), input);
    }

    @Patch(':id/subscriptions/:sid')
    @RequireCapability('manage_dashboards')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('sid', ParseIntPipe) sid: number,
        @Body(new ZodValidationPipe(dashboardSubscriptionInputSchema)) input: DashboardSubscriptionInput,
    ): Promise<DashboardSubscription> {
        return this.subscriptions.update(req.tenant!.tenantId, id, sid, viewer(req), input);
    }

    @Post(':id/subscriptions/:sid/send')
    @HttpCode(200)
    @RequireCapability('manage_dashboards')
    sendNow(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number): Promise<SubscriptionSendResult> {
        return this.subscriptions.runNow(req.tenant!.tenantId, id, sid, viewer(req));
    }

    @Delete(':id/subscriptions/:sid')
    @HttpCode(204)
    @RequireCapability('manage_dashboards')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number): Promise<void> {
        await this.subscriptions.remove(req.tenant!.tenantId, id, sid, viewer(req));
    }
}
