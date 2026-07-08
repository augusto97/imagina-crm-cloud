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
    createViewSchema,
    updateViewSchema,
    type CreateViewInput,
    type UpdateViewInput,
    type View,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ViewsService } from './views.service';

/** Saved views por lista (CONTRACT.md §7). Mutaciones exigen manage_views. */
@Controller('lists/:list/views')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ViewsController {
    constructor(private readonly views: ViewsService) {}

    @Get()
    all(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: View[] }> {
        return this.views.list(tenantId(req), list).then((data) => ({ data }));
    }

    @Get(':id')
    get(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<View> {
        return this.views.get(tenantId(req), list, id);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_views')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createViewSchema)) input: CreateViewInput,
    ): Promise<View> {
        return this.views.create(tenantId(req), list, input);
    }

    @Patch(':id')
    @RequireCapability('manage_views')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateViewSchema)) patch: UpdateViewInput,
    ): Promise<View> {
        return this.views.update(tenantId(req), list, id, patch);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_views')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.views.remove(tenantId(req), list, id);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
