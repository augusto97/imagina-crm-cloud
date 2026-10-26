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
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    createTimeEntrySchema,
    startTimerSchema,
    updateTimeEntrySchema,
    type ActiveTimerDto,
    type CreateTimeEntryInput,
    type RecordTimeDto,
    type StartTimerInput,
    type TimeEntryDto,
    type UpdateTimeEntryInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TimeTrackingService } from './time-tracking.service';

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, teamIds: req.tenant!.teamIds };
}

/**
 * v0.1.291 — Registro de tiempo. Las rutas por registro piden VER el registro
 * (el service repite el ACL de la ficha: 404 si el alcance del rol no lo
 * alcanza); el cronómetro en curso es de la persona autenticada.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class TimeTrackingController {
    constructor(private readonly time: TimeTrackingService) {}

    /** El cronómetro en curso de quien pide (para la barra superior). */
    @Get('me/timer')
    @RequireCapability('view_records', 'view_own_records')
    async active(@Req() req: FastifyRequest): Promise<{ data: ActiveTimerDto | null }> {
        return { data: await this.time.active(req.tenant!.tenantId, req.authUserId!) };
    }

    /** Detiene el cronómetro en curso (esté en el registro que esté). */
    @Post('me/timer/stop')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    async stopMine(@Req() req: FastifyRequest): Promise<{ data: TimeEntryDto | null }> {
        return { data: await this.time.stop(req.tenant!.tenantId, actor(req)) };
    }

    @Get('lists/:list/records/:recordId/time')
    @RequireCapability('view_records', 'view_own_records')
    async recordTime(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
    ): Promise<{ data: RecordTimeDto }> {
        return { data: await this.time.recordTime(req.tenant!.tenantId, actor(req), list, recordId) };
    }

    @Post('lists/:list/records/:recordId/time/start')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    async start(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(startTimerSchema)) input: StartTimerInput,
    ): Promise<{ data: { entry: TimeEntryDto; stopped: TimeEntryDto | null } }> {
        return { data: await this.time.start(req.tenant!.tenantId, actor(req), list, recordId, input.note) };
    }

    @Post('lists/:list/records/:recordId/time')
    @HttpCode(201)
    @RequireCapability('view_records', 'view_own_records')
    async create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(createTimeEntrySchema)) input: CreateTimeEntryInput,
    ): Promise<{ data: TimeEntryDto }> {
        return { data: await this.time.create(req.tenant!.tenantId, actor(req), list, recordId, input) };
    }

    @Patch('lists/:list/records/:recordId/time/:entryId')
    @RequireCapability('view_records', 'view_own_records')
    async update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('entryId', ParseIntPipe) entryId: number,
        @Body(new ZodValidationPipe(updateTimeEntrySchema)) patch: UpdateTimeEntryInput,
    ): Promise<{ data: TimeEntryDto }> {
        return { data: await this.time.update(req.tenant!.tenantId, actor(req), list, recordId, entryId, patch) };
    }

    @Delete('lists/:list/records/:recordId/time/:entryId')
    @HttpCode(204)
    @RequireCapability('view_records', 'view_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('entryId', ParseIntPipe) entryId: number,
    ): Promise<void> {
        await this.time.remove(req.tenant!.tenantId, actor(req), list, recordId, entryId);
    }

    /** CSV con las entradas de la lista (fecha, persona, registro, duración, nota), con el ACL de quien exporta. */
    @Get('lists/:list/time/export')
    @RequireCapability('export_records')
    async export(@Req() req: FastifyRequest, @Param('list') list: string, @Res() reply: FastifyReply): Promise<void> {
        const { filename, csv } = await this.time.exportCsv(req.tenant!.tenantId, actor(req), list);
        reply.raw.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
            'cache-control': 'no-store',
        });
        reply.raw.end(csv);
    }
}
