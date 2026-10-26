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
    reorderViewsSchema,
    updateViewSchema,
    type CreateViewInput,
    type ReorderViewsInput,
    type UpdateViewInput,
    type View,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ViewsService, type ViewViewer } from './views.service';
import { aclOf } from '../tenancy/acl-of';
import { AllowGuest } from '../tenancy/allow-guest.decorator';
import { listForRequest } from '../guests/guest-gate';
import { effectivePermissions } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';

/** Saved views por lista (CONTRACT.md §7). Mutaciones exigen manage_views. */
@Controller('lists/:list/views')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ViewsController {
    constructor(
        private readonly views: ViewsService,
        private readonly lists: ListsService,
    ) {}

    @Get()
    @AllowGuest()
    async all(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: View[] }> {
        if (req.tenant!.role === 'guest') {
            // C3 — un invitado sólo ve las vistas de TABLA de una lista que le
            // compartieron entera (con registros sueltos, la tabla sin vistas).
            const owner = await listForRequest(this.lists, req, list);
            const who = { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
            if (effectivePermissions(owner.settings as Record<string, unknown>, who).view === 'none') return { data: [] };
            const all = await this.views.list(tenantId(req), list, viewer(req));
            // La tabla agrupada (y sus agregados) no está abierta a invitados:
            // la vista llega plana.
            return {
                data: all
                    .filter((v) => v.type === 'table')
                    .map((v) => ({ ...v, config: { ...v.config, group_by_field_id: null, sub_group_by_field_id: null } }) as View),
            };
        }
        return this.views.list(tenantId(req), list, viewer(req)).then((data) => ({ data }));
    }

    @Get(':id')
    get(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<View> {
        return this.views.get(tenantId(req), list, id, viewer(req));
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_views')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createViewSchema)) input: CreateViewInput,
    ): Promise<View> {
        return this.views.create(tenantId(req), list, input, viewer(req));
    }

    /** v0.1.259 — orden de las pestañas (declarada antes de `:id`). */
    @Patch('reorder')
    @RequireCapability('manage_views')
    reorder(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(reorderViewsSchema)) input: ReorderViewsInput,
    ): Promise<{ data: View[] }> {
        return this.views.reorder(tenantId(req), list, input.view_ids, viewer(req)).then((data) => ({ data }));
    }

    @Patch(':id')
    @RequireCapability('manage_views')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateViewSchema)) patch: UpdateViewInput,
    ): Promise<View> {
        return this.views.update(tenantId(req), list, id, patch, viewer(req));
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_views')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.views.remove(tenantId(req), list, id, viewer(req));
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function viewer(req: FastifyRequest): ViewViewer {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
