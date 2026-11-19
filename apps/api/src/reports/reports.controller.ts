import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    createReportSchema,
    dashboardSubscriptionInputSchema,
    reportBundleRequestSchema,
    reportExportRequestSchema,
    reportPreviewRequestSchema,
    updateReportSchema,
    type CreateReportInput,
    type DashboardSubscription,
    type DashboardSubscriptionInput,
    type Report,
    type ReportBundle,
    type ReportBundleRequest,
    type ReportExportRequest,
    type ReportPreviewRequest,
    type UpdateReportInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DashboardSubscriptionsService, type SubscriptionSendResult } from '../dashboard-sharing/dashboard-subscriptions.service';
import type { DashboardViewer } from '../dashboards/dashboards.service';
import { contentDispositionHeader } from '../files/safe-content-type';
import { aclOf } from '../tenancy/acl-of';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ReportsService } from './reports.service';

function viewer(req: FastifyRequest): DashboardViewer {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

const tenantId = (req: FastifyRequest): number => req.tenant!.tenantId;

/**
 * v0.1.464 (J1) — Informes. Viven dentro de Tableros: los ve quien ve
 * tableros (`view_dashboards`, más la visibilidad del informe) y los arma
 * quien los administra (`manage_dashboards`). Un invitado o un cliente del
 * portal nunca (el `TenantGuard` corta a los invitados en toda ruta sin
 * `@AllowGuest`). Calcular, ver y descargar también en solo-lectura (ADR-S09).
 */
@Controller('reports')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ReportsController {
    constructor(
        private readonly reports: ReportsService,
        private readonly subscriptions: DashboardSubscriptionsService,
    ) {}

    @Get()
    @RequireCapability('view_dashboards')
    list(@Req() req: FastifyRequest): Promise<Report[]> {
        return this.reports.list(tenantId(req), viewer(req));
    }

    @Post()
    @RequireCapability('manage_dashboards')
    create(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(createReportSchema)) input: CreateReportInput): Promise<Report> {
        return this.reports.create(tenantId(req), viewer(req), input);
    }

    /** Vista previa del editor: los bloques sin guardar, calculados con el mismo motor. */
    @Post('preview')
    @HttpCode(200)
    @RequireCapability('manage_dashboards')
    preview(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(reportPreviewRequestSchema)) body: ReportPreviewRequest): Promise<ReportBundle> {
        return this.reports.preview(tenantId(req), viewer(req), body.blocks, body);
    }

    @Get(':id')
    @RequireCapability('view_dashboards')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Report> {
        return this.reports.get(tenantId(req), id, viewer(req));
    }

    @Patch(':id')
    @RequireCapability('manage_dashboards')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateReportSchema)) patch: UpdateReportInput,
    ): Promise<Report> {
        return this.reports.update(tenantId(req), id, viewer(req), patch);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_dashboards')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.reports.remove(tenantId(req), id, viewer(req));
    }

    @Post(':id/duplicate')
    @RequireCapability('manage_dashboards')
    duplicate(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Report> {
        return this.reports.duplicate(tenantId(req), id, viewer(req));
    }

    /** El informe calculado en UN pedido (`GET` con lo guardado; `POST` con el período/comparación de quien mira). */
    @Get(':id/bundle')
    @RequireCapability('view_dashboards')
    bundleGet(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ReportBundle> {
        return this.reports.bundle(tenantId(req), id, viewer(req));
    }

    @Post(':id/bundle')
    @HttpCode(200)
    @AllowReadOnly()
    @RequireCapability('view_dashboards')
    bundle(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(reportBundleRequestSchema)) body: ReportBundleRequest,
    ): Promise<ReportBundle> {
        return this.reports.bundle(tenantId(req), id, viewer(req), body);
    }

    /** Descargar en PDF o Excel (`?format=pdf|xlsx&period=…&compare=…`). */
    @Get(':id/export')
    @RequireCapability('view_dashboards')
    async export(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Param('id', ParseIntPipe) id: number,
        @Query(new ZodValidationPipe(reportExportRequestSchema)) q: ReportExportRequest,
    ): Promise<void> {
        const file = await this.reports.export(tenantId(req), id, viewer(req), q.format, { ...(q.period !== undefined ? { period: q.period } : {}), ...(q.compare !== undefined ? { compare: q.compare } : {}) });
        reply.raw.writeHead(200, {
            'content-type': file.contentType,
            'content-length': String(file.buffer.length),
            'content-disposition': contentDispositionHeader('attachment', file.filename),
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, no-store',
        });
        reply.raw.end(file.buffer);
    }

    // ─────────────────── Envíos programados por correo (ADR-S50) ───────────────────

    @Get(':id/subscriptions')
    @RequireCapability('manage_dashboards')
    subs(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<DashboardSubscription[]> {
        return this.subscriptions.listFor(tenantId(req), { kind: 'report', id }, viewer(req));
    }

    @Post(':id/subscriptions')
    @RequireCapability('manage_dashboards')
    createSub(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(dashboardSubscriptionInputSchema)) input: DashboardSubscriptionInput,
    ): Promise<DashboardSubscription> {
        return this.subscriptions.createFor(tenantId(req), { kind: 'report', id }, viewer(req), input);
    }

    /** «Enviarme una prueba ahora» con lo que está en el formulario (no se guarda). */
    @Post(':id/subscriptions/test')
    @HttpCode(200)
    @RequireCapability('manage_dashboards')
    testSub(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(dashboardSubscriptionInputSchema)) input: DashboardSubscriptionInput,
    ): Promise<SubscriptionSendResult> {
        return this.subscriptions.sendTestFor(tenantId(req), { kind: 'report', id }, viewer(req), input);
    }

    @Patch(':id/subscriptions/:sid')
    @RequireCapability('manage_dashboards')
    updateSub(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('sid', ParseIntPipe) sid: number,
        @Body(new ZodValidationPipe(dashboardSubscriptionInputSchema)) input: DashboardSubscriptionInput,
    ): Promise<DashboardSubscription> {
        return this.subscriptions.updateFor(tenantId(req), { kind: 'report', id }, sid, viewer(req), input);
    }

    @Post(':id/subscriptions/:sid/send')
    @HttpCode(200)
    @RequireCapability('manage_dashboards')
    sendNow(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number): Promise<SubscriptionSendResult> {
        return this.subscriptions.runNowFor(tenantId(req), { kind: 'report', id }, sid, viewer(req));
    }

    @Delete(':id/subscriptions/:sid')
    @HttpCode(204)
    @RequireCapability('manage_dashboards')
    async removeSub(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number): Promise<void> {
        await this.subscriptions.removeFor(tenantId(req), { kind: 'report', id }, sid, viewer(req));
    }
}
