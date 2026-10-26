import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
    AddMemberInput,
    AddMemberResult,
    UpdateMemberRoleInput,
    WorkspaceMember,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import type { Tx } from '../db/client';
import { recordShares } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { CustomRolesService } from '../roles/custom-roles.service';
import { TeamsService } from '../teams/teams.service';
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
        @Optional() private readonly teams?: TeamsService,
        @Optional() private readonly roles?: CustomRolesService,
        @Optional() private readonly realtime?: RealtimeService,
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
     * consola de plataforma lo saltea (el operador decide). `allowReserved`
     * deja sumar a un superadmin: SÓLO la consola de plataforma (v0.1.293).
     */
    async add(
        tenantId: number,
        input: AddMemberInput,
        opts: { invitedById?: number | null; enforcePlan?: boolean; allowReserved?: boolean } = {},
    ): Promise<AddMemberResult> {
        // C2 — con un rol propio, el rol base es el de ese rol (lo decide el servidor).
        const custom = await this.resolveCustomRole(tenantId, input.role, input.custom_role_id);
        if (opts.enforcePlan !== false) await this.billing.assertCanAddMember(tenantId);
        const r = await this.auth.addToTenant(
            tenantId,
            { email: input.email, name: input.name, role: custom?.baseRole ?? input.role, customRoleId: custom?.id ?? null },
            {
                invitedById: opts.invitedById ?? null,
                allowReserved: opts.allowReserved === true,
            },
        );
        return {
            user_id: r.user.id,
            name: r.user.name,
            email: r.user.email,
            role: r.role,
            custom_role_id: custom?.id ?? null,
            custom_role_name: custom?.name ?? null,
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
        opts: { enforcePlan?: boolean } = {},
    ): Promise<WorkspaceMember> {
        const custom = await this.resolveCustomRole(tenantId, input.role, input.custom_role_id);
        const role = custom?.baseRole ?? input.role;
        const current = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findMembership(tx, tenantId, targetUserId));
        // C3 — pasar un invitado a miembro ocupa un usuario del plan.
        if (current?.role === 'guest' && opts.enforcePlan !== false) await this.billing.assertCanAddMember(tenantId);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const member = await this.repo.findMembership(tx, tenantId, targetUserId);
            if (!member) throw notMember(targetUserId);
            if (member.role === 'client') throw portalClient();
            // No dejar el workspace sin ningún admin.
            if (member.role === 'admin' && role !== 'admin') {
                await this.assertNotLastAdmin(tx, tenantId);
            }
            await this.repo.updateRole(tx, tenantId, targetUserId, role, custom?.id ?? null);
            // C3 — al pasar a miembro, los registros sueltos que tenía
            // compartidos dejan de aplicar (ve lo que su rol le deja ver); las
            // listas compartidas con él quedan como acceso por persona.
            if (member.role === 'guest') {
                await tx
                    .delete(recordShares)
                    .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, targetUserId)));
            }
            return {
                ...toMember(member),
                role,
                custom_role_id: custom?.id ?? null,
                custom_role_name: custom?.name ?? null,
                promoted: member.role === 'guest',
            };
        });
        // Sus capacidades y su acceso cambiaron: la app se refresca (y la
        // sesión, que trae las capacidades de su rol).
        this.realtime?.lists(tenantId);
        this.realtime?.invalidate(tenantId, 'roles');
        const { promoted: _promoted, ...member } = out;
        return member;
    }

    /** C2 — el rol propio pedido (de ESTA empresa) o 404; null si no se pidió. */
    private async resolveCustomRole(
        tenantId: number,
        role: string,
        customRoleId: number | null | undefined,
    ): Promise<{ id: number; baseRole: 'manager' | 'agent' | 'viewer'; name: string } | null> {
        if (!customRoleId || role === 'admin') return null;
        if (!this.roles) return null;
        const hit = await this.tenantDb.withTenant(tenantId, (tx) => this.roles!.findInTx(tx, tenantId, customRoleId));
        if (!hit) {
            throw new NotFoundException({
                code: 'role_not_found',
                message: 'Ese rol no existe en esta empresa',
                data: { status: 404, errors: { custom_role_id: 'No existe' } },
            });
        }
        return hit;
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
            // C3 — si era invitado, sus registros compartidos se van con él.
            await tx
                .delete(recordShares)
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, targetUserId)));
            // C1 — deja de ser del equipo de trabajo: sale de sus equipos.
            await this.teams?.removeUserEverywhere(tx, tenantId, targetUserId);
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
        custom_role_id: row.customRoleId,
        custom_role_name: row.customRoleName,
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
