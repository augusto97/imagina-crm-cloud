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
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createAutomationSchema,
    updateAutomationSchema,
    type Automation,
    type AutomationRun,
    type CreateAutomationInput,
    type UpdateAutomationInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AutomationsService } from './automations.service';

/** CRUD de automatizaciones por lista + runs (CONTRACT.md §8). */
@Controller('lists/:list/automations')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AutomationsController {
    constructor(private readonly automations: AutomationsService) {}

    @Get()
    @RequireCapability('manage_automations')
    all(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: Automation[] }> {
        return this.automations.list(req.tenant!.tenantId, list).then((data) => ({ data }));
    }

    @Get(':id')
    @RequireCapability('manage_automations')
    get(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<Automation> {
        return this.automations.get(req.tenant!.tenantId, list, id);
    }

    @Get(':id/runs')
    @RequireCapability('manage_automations')
    runs(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Query('cursor') cursor?: string,
    ): Promise<{ data: AutomationRun[]; meta: { next_cursor: string | null } }> {
        return this.automations.runs(req.tenant!.tenantId, list, id, {
            cursor: cursor ? Number(cursor) : undefined,
        });
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_automations')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createAutomationSchema)) input: CreateAutomationInput,
    ): Promise<Automation> {
        return this.automations.create(req.tenant!.tenantId, list, input);
    }

    @Patch(':id')
    @RequireCapability('manage_automations')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateAutomationSchema)) patch: UpdateAutomationInput,
    ): Promise<Automation> {
        return this.automations.update(req.tenant!.tenantId, list, id, patch);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_automations')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.automations.remove(req.tenant!.tenantId, list, id);
    }
}
