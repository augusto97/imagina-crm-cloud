import {
    ConflictException,
    ForbiddenException,
    Injectable,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    AddMemberInput,
    UpdateMemberRoleInput,
    WorkspaceMember,
} from '@imagina-base/shared';
import type { Tx } from '../db/client';
import { TenantDb } from '../tenancy/tenant-db.service';
import { MembersRepository, type MemberRow } from './members.repository';

@Injectable()
export class MembersService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: MembersRepository,
    ) {}

    async list(tenantId: number): Promise<WorkspaceMember[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByTenant(tx, tenantId),
        );
        return rows.map(toMember);
    }

    /** Suma un usuario YA registrado (por email) al workspace con un rol. */
    async add(tenantId: number, input: AddMemberInput): Promise<WorkspaceMember> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const user = await this.repo.findUserByEmail(tx, input.email);
            if (!user) {
                throw new UnprocessableEntityException({
                    code: 'user_not_registered',
                    message: `No hay un usuario registrado con ${input.email}. Pedile que cree su cuenta primero.`,
                    data: { status: 422, errors: { email: 'Sin cuenta' } },
                });
            }
            const existing = await this.repo.findMembership(tx, tenantId, user.id);
            if (existing) {
                throw new ConflictException({
                    code: 'already_member',
                    message: `${input.email} ya es miembro de este workspace`,
                    data: { status: 409, errors: { email: 'Ya es miembro' } },
                });
            }
            await this.repo.insert(tx, tenantId, user.id, input.role);
            return { user_id: user.id, name: user.name, email: user.email, role: input.role };
        });
    }

    async updateRole(
        tenantId: number,
        targetUserId: number,
        input: UpdateMemberRoleInput,
    ): Promise<WorkspaceMember> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const member = await this.repo.findMembership(tx, tenantId, targetUserId);
            if (!member) throw notMember(targetUserId);
            // No dejar el workspace sin ningún admin.
            if (member.role === 'admin' && input.role !== 'admin') {
                await this.assertNotLastAdmin(tx, tenantId);
            }
            await this.repo.updateRole(tx, tenantId, targetUserId, input.role);
            return { ...toMember(member), role: input.role };
        });
    }

    async remove(tenantId: number, actingUserId: number, targetUserId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const member = await this.repo.findMembership(tx, tenantId, targetUserId);
            if (!member) throw notMember(targetUserId);
            if (targetUserId === actingUserId) {
                throw new ForbiddenException({
                    code: 'cannot_remove_self',
                    message: 'No podés quitarte a vos mismo del workspace',
                    data: { status: 403 },
                });
            }
            if (member.role === 'admin') await this.assertNotLastAdmin(tx, tenantId);
            await this.repo.remove(tx, tenantId, targetUserId);
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
    return { user_id: row.userId, name: row.name, email: row.email, role: row.role };
}

function notMember(userId: number) {
    return new ConflictException({
        code: 'not_member',
        message: `El usuario ${userId} no es miembro de este workspace`,
        data: { status: 409 },
    });
}
