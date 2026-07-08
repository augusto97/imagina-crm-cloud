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
    addMemberSchema,
    updateMemberRoleSchema,
    type AddMemberInput,
    type UpdateMemberRoleInput,
    type WorkspaceMember,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { MembersService } from './members.service';

/**
 * Panel admin de miembros del workspace (F4). Todas las rutas exigen sesión +
 * tenant resuelto y rol `admin` (gestionar el equipo es exclusivo del admin;
 * no hay capability `manage_members` en la matriz portada del plugin, así que
 * gateamos por rol explícito). Sobre `memberships`, tenant-isolated por RLS.
 */
@Controller('workspaces/current/members')
@UseGuards(SessionGuard, TenantGuard)
export class MembersController {
    constructor(private readonly members: MembersService) {}

    @Get()
    async all(@Req() req: FastifyRequest): Promise<{ data: WorkspaceMember[] }> {
        assertAdmin(req);
        return { data: await this.members.list(tenantId(req)) };
    }

    @Post()
    @HttpCode(201)
    add(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(addMemberSchema)) input: AddMemberInput,
    ): Promise<WorkspaceMember> {
        assertAdmin(req);
        return this.members.add(tenantId(req), input);
    }

    @Patch(':userId')
    updateRole(
        @Req() req: FastifyRequest,
        @Param('userId', ParseIntPipe) userId: number,
        @Body(new ZodValidationPipe(updateMemberRoleSchema)) input: UpdateMemberRoleInput,
    ): Promise<WorkspaceMember> {
        assertAdmin(req);
        return this.members.updateRole(tenantId(req), userId, input);
    }

    @Delete(':userId')
    @HttpCode(204)
    async remove(
        @Req() req: FastifyRequest,
        @Param('userId', ParseIntPipe) userId: number,
    ): Promise<void> {
        assertAdmin(req);
        await this.members.remove(tenantId(req), req.authUserId!, userId);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function assertAdmin(req: FastifyRequest): void {
    if (req.tenant!.role !== 'admin') {
        throw new ForbiddenException({
            code: 'admin_only',
            message: 'Sólo un admin puede gestionar los miembros del workspace',
            data: { status: 403 },
        });
    }
}
