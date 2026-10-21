import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createDashboardSchema,
    dashboardBundleRequestSchema,
    reorderDashboardsSchema,
    updateDashboardSchema,
    widgetPreviewRequestSchema,
    type CreateDashboardInput,
    type Dashboard,
    type ReorderDashboardsInput,
    type UpdateDashboardInput,
    type WidgetPreviewRequest,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DashboardsService, type DashboardViewer } from './dashboards.service';

/**
 * Dashboards del workspace (CONTRACT.md §5). Requiere sesión + tenant; la
 * evaluación de widgets se apoya en el motor de agregados. RLS aísla por tenant.
 *
 * SEC-06: `TenantGuard` autentica la MEMBRESÍA, no el rol. Sin capability check
 * cualquier miembro —incluido el `client` externo del portal— podía CRUD
 * dashboards y leer datos agregados. Ahora: lectura requiere `access_admin`
 * (excluye `client`); mutaciones requieren `manage_dashboards` (admin/manager).
 */
@Controller('dashboards')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class DashboardsController {
    constructor(private readonly dashboards: DashboardsService) {}

    @Get()
    @RequireCapability('access_admin')
    list(@Req() req: FastifyRequest): Promise<Dashboard[]> {
        return this.dashboards.list(tenantId(req), viewer(req));
    }

    @Get(':id')
    @RequireCapability('access_admin')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Dashboard> {
        return this.dashboards.get(tenantId(req), id, viewer(req));
    }

    @Get(':id/widgets/:widgetId/data')
    @RequireCapability('access_admin')
    widgetData(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('widgetId') widgetId: string,
    ): Promise<unknown> {
        return this.dashboards.widgetData(tenantId(req), id, viewer(req), widgetId);
    }

    /**
     * Bundle: evalúa TODOS los widgets del dashboard en un request (PERF-03).
     * v0.1.100 — el body acepta `period_preset` (filtro GLOBAL de período del
     * tablero): se aplica a cada widget con campo de fecha configurado,
     * pisando su período propio. Un preset inválido se ignora.
     */
    @Post(':id/widgets/data')
    @HttpCode(200)
    @RequireCapability('access_admin')
    // ADR-S09: es una LECTURA (POST por el body); una empresa en solo-lectura
    // sigue viendo sus tableros.
    @AllowReadOnly()
    widgetsData(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body() body: unknown,
    ): Promise<Record<string, unknown>> {
        // v0.1.286 — `filters` (filtros del tablero). Un body inválido no
        // rompe el tablero: se evalúa sin período ni filtros.
        const parsed = dashboardBundleRequestSchema.safeParse(body ?? {});
        return this.dashboards.widgetsData(tenantId(req), id, viewer(req), parsed.success ? parsed.data : {});
    }

    /**
     * v0.1.286 — Vista previa de un widget SIN guardar (diálogo de edición).
     * Lectura: vale en solo-lectura.
     */
    @Post(':id/widgets/preview')
    @HttpCode(200)
    @RequireCapability('access_admin')
    @AllowReadOnly()
    preview(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(widgetPreviewRequestSchema)) body: WidgetPreviewRequest,
    ): Promise<unknown> {
        const { widget, ...rest } = body;
        return this.dashboards.previewWidget(tenantId(req), id, viewer(req), widget, rest);
    }

    /** v0.1.286 — reordenar los tableros del menú (arrastrar en el panel). */
    @Patch('reorder')
    @RequireCapability('manage_dashboards')
    reorder(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(reorderDashboardsSchema)) body: ReorderDashboardsInput,
    ): Promise<Dashboard[]> {
        return this.dashboards.reorder(tenantId(req), viewer(req), body.ids);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_dashboards')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createDashboardSchema)) input: CreateDashboardInput,
    ): Promise<Dashboard> {
        return this.dashboards.create(tenantId(req), req.authUserId!, input);
    }

    @Patch(':id')
    @RequireCapability('manage_dashboards')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateDashboardSchema)) patch: UpdateDashboardInput,
    ): Promise<Dashboard> {
        return this.dashboards.update(tenantId(req), id, viewer(req), patch);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_dashboards')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.dashboards.remove(tenantId(req), id, viewer(req));
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function viewer(req: FastifyRequest): DashboardViewer {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
