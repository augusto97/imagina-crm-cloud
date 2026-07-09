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
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { DashboardsService } from './dashboards.service';

/**
 * Dashboards del workspace (CONTRACT.md §5). Requiere sesión + tenant; la
 * evaluación de widgets se apoya en el motor de agregados. RLS aísla por tenant.
 */
@Controller('dashboards')
@UseGuards(SessionGuard, TenantGuard)
export class DashboardsController {
    constructor(private readonly dashboards: DashboardsService) {}

    @Get()
    list(@Req() req: FastifyRequest): Promise<Dashboard[]> {
        return this.dashboards.list(tenantId(req));
    }

    @Get(':id')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Dashboard> {
        return this.dashboards.get(tenantId(req), id);
    }

    @Get(':id/widgets/:widgetId/data')
    widgetData(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('widgetId') widgetId: string,
    ): Promise<unknown> {
        return this.dashboards.widgetData(tenantId(req), id, widgetId);
    }

    @Post()
    @HttpCode(201)
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createDashboardSchema)) input: CreateDashboardInput,
    ): Promise<Dashboard> {
        return this.dashboards.create(tenantId(req), req.authUserId!, input);
    }

    @Patch(':id')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateDashboardSchema)) patch: UpdateDashboardInput,
    ): Promise<Dashboard> {
        return this.dashboards.update(tenantId(req), id, patch);
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.dashboards.remove(tenantId(req), id);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
