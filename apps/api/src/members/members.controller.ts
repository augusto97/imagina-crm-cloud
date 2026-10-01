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
    type AddMemberResult,
    type UpdateMemberRoleInput,
    type WorkspaceMember,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { AuditService } from '../audit/audit.service';
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
    constructor(
        private readonly members: MembersService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    async all(@Req() req: FastifyRequest): Promise<{ data: WorkspaceMember[] }> {
        assertAdmin(req);
        return { data: await this.members.list(tenantId(req)) };
    }

    @Post()
    @HttpCode(201)
    async add(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(addMemberSchema)) input: AddMemberInput,
    ): Promise<AddMemberResult> {
        assertAdmin(req);
        const member = await this.members.add(tenantId(req), input, { invitedById: req.authUserId ?? null });
        await this.audit.log({
            tenantId: tenantId(req),
            userId: req.authUserId ?? null,
            action: 'member.add',
            targetType: 'user',
            targetId: member.user_id,
            targetLabel: member.email,
            meta: { role: member.role, invited: member.invited },
        });
        return member;
    }

    /** v0.1.240 — Reenvía la invitación a quien todavía no definió su contraseña. */
    @Post(':userId/resend-invite')
    @HttpCode(202)
    async resendInvite(
        @Req() req: FastifyRequest,
        @Param('userId', ParseIntPipe) userId: number,
    ): Promise<{ ok: true }> {
        assertAdmin(req);
        const { email } = await this.members.resendInvite(tenantId(req), userId);
        await this.audit.log({
            tenantId: tenantId(req),
            userId: req.authUserId ?? null,
            action: 'member.invite_resend',
            targetType: 'user',
            targetId: userId,
            targetLabel: email,
        });
        return { ok: true };
    }

    @Patch(':userId')
    async updateRole(
        @Req() req: FastifyRequest,
        @Param('userId', ParseIntPipe) userId: number,
        @Body(new ZodValidationPipe(updateMemberRoleSchema)) input: UpdateMemberRoleInput,
    ): Promise<WorkspaceMember> {
        assertAdmin(req);
        const member = await this.members.updateRole(tenantId(req), userId, input);
        await this.audit.log({
            tenantId: tenantId(req),
            userId: req.authUserId ?? null,
            action: 'member.role_change',
            targetType: 'user',
            targetId: userId,
            targetLabel: member.email,
            meta: { role: member.role },
        });
        return member;
    }

    @Delete(':userId')
    @HttpCode(204)
    async remove(
        @Req() req: FastifyRequest,
        @Param('userId', ParseIntPipe) userId: number,
    ): Promise<void> {
        assertAdmin(req);
        const gone = await this.members.remove(tenantId(req), req.authUserId!, userId);
        await this.audit.log({
            tenantId: tenantId(req),
            userId: req.authUserId ?? null,
            action: 'member.remove',
            targetType: 'user',
            targetId: userId,
            targetLabel: gone.email,
            meta: { role: gone.role },
        });
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
