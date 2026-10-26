import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
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
    createCustomRoleSchema,
    updateCustomRoleSchema,
    type CreateCustomRoleInput,
    type CustomRole,
    type UpdateCustomRoleInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CustomRolesService, type BaseRoleCount } from './custom-roles.service';

/**
 * C2 — Ajustes → Roles. Sólo el admin (como Miembros): un rol propio decide
 * qué puede hacer cada persona en toda la empresa.
 */
@Controller('workspaces/current/roles')
@UseGuards(SessionGuard, TenantGuard)
export class CustomRolesController {
    constructor(private readonly roles: CustomRolesService) {}

    @Get()
    list(@Req() req: FastifyRequest): Promise<{ base: BaseRoleCount[]; custom: CustomRole[] }> {
        assertAdmin(req);
        return this.roles.list(req.tenant!.tenantId);
    }

    @Post()
    @HttpCode(201)
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createCustomRoleSchema)) input: CreateCustomRoleInput,
    ): Promise<CustomRole> {
        assertAdmin(req);
        return this.roles.create(req.tenant!.tenantId, req.authUserId!, input);
    }

    @Patch(':id')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateCustomRoleSchema)) input: UpdateCustomRoleInput,
    ): Promise<CustomRole> {
        assertAdmin(req);
        return this.roles.update(req.tenant!.tenantId, req.authUserId!, id, input);
    }

    @Delete(':id')
    remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ moved: number }> {
        assertAdmin(req);
        return this.roles.remove(req.tenant!.tenantId, req.authUserId!, id);
    }
}

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant!.role !== 'admin') {
        throw new ForbiddenException({ code: 'admin_only', message: 'Sólo un admin puede gestionar los roles', data: { status: 403 } });
    }
}
