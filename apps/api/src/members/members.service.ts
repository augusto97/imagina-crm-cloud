import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type {
    AddMemberInput,
    AddMemberResult,
    UpdateMemberRoleInput,
    WorkspaceMember,
} from '@imagina-base/shared';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import type { Tx } from '../db/client';
import { TenantDb } from '../tenancy/tenant-db.service';
import { MembersRepository, type MemberRow } from './members.repository';

/**
 * Miembros del EQUIPO de una empresa (los clientes del portal se gestionan
 * desde la ficha de su registro). Lo usan el panel de Miembros (admin de la
 * empresa) y la consola de plataforma; los guard rails —no quedarse sin admin,
 * no quitarse a uno mismo— valen para los dos.
 */
@Injectable()
export class MembersService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: MembersRepository,
        private readonly auth: AuthService,
        private readonly billing: BillingService,
    ) {}

    async list(tenantId: number): Promise<WorkspaceMember[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByTenant(tx, tenantId),
        );
        return rows.map(toMember);
    }

    /**
     * Suma a alguien por email. v0.1.240: si no tiene cuenta, se crea por
     * INVITACIÓN (correo para definir su contraseña) en vez de pedirle que se
     * registre primero. `enforcePlan` = el límite de usuarios del plan; la
     * consola de plataforma lo saltea (el operador decide).
     */
    async add(
        tenantId: number,
        input: AddMemberInput,
        opts: { invitedById?: number | null; enforcePlan?: boolean } = {},
    ): Promise<AddMemberResult> {
        if (opts.enforcePlan !== false) await this.billing.assertCanAddMember(tenantId);
        const r = await this.auth.addToTenant(tenantId, input, { invitedById: opts.invitedById ?? null });
        return {
            user_id: r.user.id,
            name: r.user.name,
            email: r.user.email,
            role: r.role,
            pending: r.pending,
            invited: r.invited,
            notified: r.notified,
        };
    }

    /** Reenvía la invitación de un miembro que todavía no definió su contraseña. */
    resendInvite(tenantId: number, userId: number): Promise<{ email: string }> {
        return this.auth.resendInvite(tenantId, userId);
    }

    async updateRole(
        tenantId: number,
        targetUserId: number,
        input: UpdateMemberRoleInput,
    ): Promise<WorkspaceMember> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const member = await this.repo.findMembership(tx, tenantId, targetUserId);
            if (!member) throw notMember(targetUserId);
            if (member.role === 'client') throw portalClient();
            // No dejar el workspace sin ningún admin.
            if (member.role === 'admin' && input.role !== 'admin') {
                await this.assertNotLastAdmin(tx, tenantId);
            }
            await this.repo.updateRole(tx, tenantId, targetUserId, input.role);
            return { ...toMember(member), role: input.role };
        });
    }

    async remove(tenantId: number, actingUserId: number, targetUserId: number): Promise<WorkspaceMember> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const member = await this.repo.findMembership(tx, tenantId, targetUserId);
            if (!member) throw notMember(targetUserId);
            if (member.role === 'client') throw portalClient();
            if (targetUserId === actingUserId) {
                throw new ForbiddenException({
                    code: 'cannot_remove_self',
                    message: 'No puedes quitarte a ti mismo del workspace',
                    data: { status: 403 },
                });
            }
            if (member.role === 'admin') await this.assertNotLastAdmin(tx, tenantId);
            await this.repo.remove(tx, tenantId, targetUserId);
            return toMember(member);
        });
    }

    private async assertNotLastAdmin(tx: Tx, tenantId: number): Promise<void> {
        const admins = await this.repo.countByRole(tx, tenantId, 'admin');
        if (admins <= 1) {
            throw new ConflictException({
                code: 'last_admin',
                message: 'El workspace debe conservar al menos un admin',
                data: { status: 409 },
            });
        }
    }
}

function toMember(row: MemberRow): WorkspaceMember {
    return {
        user_id: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        pending: row.invitedAt !== null,
    };
}

function notMember(userId: number) {
    return new ConflictException({
        code: 'not_member',
        message: `El usuario ${userId} no es miembro de este workspace`,
        data: { status: 409 },
    });
}

function portalClient() {
    return new ConflictException({
        code: 'portal_client',
        message: 'Es un cliente del portal: su acceso se maneja desde la ficha de su registro',
        data: { status: 409 },
    });
}
