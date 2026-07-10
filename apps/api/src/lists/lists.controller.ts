import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createListSchema,
    updateListPermissionsSchema,
    updateListSchema,
    type CreateListInput,
    type List,
    type ListPermissionsDoc,
    type UpdateListInput,
    type UpdateListPermissionsInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ListsService } from './lists.service';

/**
 * CRUD de listas (CONTRACT.md §1). Toda ruta exige sesión + tenant resuelto
 * (X-Tenant-Id); las mutaciones exigen la capability `manage_lists`.
 * Las URLs aceptan id numérico o slug.
 */
@Controller('lists')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ListsController {
    constructor(private readonly lists: ListsService) {}

    @Get()
    all(@Req() req: FastifyRequest): Promise<{ data: List[] }> {
        return this.lists.list(tenantId(req)).then((data) => ({ data }));
    }

    @Get(':idOrSlug')
    get(@Req() req: FastifyRequest, @Param('idOrSlug') idOrSlug: string): Promise<List> {
        return this.lists.get(tenantId(req), idOrSlug);
    }

    /** ACL por lista (permisos por rol). Solo admin (manage_lists). */
    @Get(':idOrSlug/permissions')
    @RequireCapability('manage_lists')
    getPermissions(
        @Req() req: FastifyRequest,
        @Param('idOrSlug') idOrSlug: string,
    ): Promise<ListPermissionsDoc> {
        return this.lists.getPermissions(tenantId(req), idOrSlug);
    }

    @Patch(':idOrSlug/permissions')
    @RequireCapability('manage_lists')
    updatePermissions(
        @Req() req: FastifyRequest,
        @Param('idOrSlug') idOrSlug: string,
        @Body(new ZodValidationPipe(updateListPermissionsSchema)) input: UpdateListPermissionsInput,
    ): Promise<ListPermissionsDoc> {
        return this.lists.updatePermissions(tenantId(req), idOrSlug, input);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_lists')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createListSchema)) input: CreateListInput,
    ): Promise<List> {
        return this.lists.create(tenantId(req), input);
    }

    @Patch(':idOrSlug')
    @RequireCapability('manage_lists')
    update(
        @Req() req: FastifyRequest,
        @Param('idOrSlug') idOrSlug: string,
        @Body(new ZodValidationPipe(updateListSchema)) patch: UpdateListInput,
    ): Promise<List> {
        return this.lists.update(tenantId(req), idOrSlug, patch);
    }

    @Delete(':idOrSlug')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async remove(@Req() req: FastifyRequest, @Param('idOrSlug') idOrSlug: string): Promise<void> {
        await this.lists.remove(tenantId(req), idOrSlug);
    }
}

function tenantId(req: FastifyRequest): number {
    // TenantGuard garantiza que req.tenant existe antes de llegar acá.
    return req.tenant!.tenantId;
}
