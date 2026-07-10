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
    updateDashboardSchema,
    type CreateDashboardInput,
    type Dashboard,
    type UpdateDashboardInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DashboardsService } from './dashboards.service';

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
        return this.dashboards.list(tenantId(req));
    }

    @Get(':id')
    @RequireCapability('access_admin')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Dashboard> {
        return this.dashboards.get(tenantId(req), id);
    }

    @Get(':id/widgets/:widgetId/data')
    @RequireCapability('access_admin')
    widgetData(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('widgetId') widgetId: string,
    ): Promise<unknown> {
        return this.dashboards.widgetData(tenantId(req), id, widgetId);
    }

    /** Bundle: evalúa TODOS los widgets del dashboard en un request (PERF-03). */
    @Post(':id/widgets/data')
    @HttpCode(200)
    @RequireCapability('access_admin')
    widgetsData(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<Record<string, unknown>> {
        return this.dashboards.widgetsData(tenantId(req), id);
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
        return this.dashboards.update(tenantId(req), id, patch);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_dashboards')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.dashboards.remove(tenantId(req), id);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
