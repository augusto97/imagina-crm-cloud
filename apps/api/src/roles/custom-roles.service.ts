import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
    CAPABILITIES_BY_ROLE,
    CUSTOM_ROLE_BASES,
    MAX_CUSTOM_ROLES,
    TOGGLEABLE_CAPABILITIES,
    type Capability,
    type CreateCustomRoleInput,
    type CustomRole,
    type CustomRoleBase,
    type UpdateCustomRoleInput,
} from '@imagina-base/shared';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { customRoles, memberships } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Personas por rol base (para «cuántas personas lo tienen» de los roles fijos). */
export interface BaseRoleCount {
    role: 'admin' | CustomRoleBase;
    member_count: number;
}

/**
 * C2 — Roles PROPIOS de una empresa. Cada uno parte de un rol base (manager,
 * agente o lector) y guarda la lista EXPLÍCITA de capacidades. Lo gestiona
 * sólo el admin (lo exige el controller); el TenantGuard los lee en cada
 * request para resolver las capacidades efectivas.
 */
@Injectable()
export class CustomRolesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
    ) {}

    async list(tenantId: number): Promise<{ base: BaseRoleCount[]; custom: CustomRole[] }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({
                    row: customRoles,
                    members: sql<number>`(SELECT count(*)::int FROM memberships m WHERE m.tenant_id = ${customRoles.tenantId} AND m.custom_role_id = ${customRoles.id})`,
                })
                .from(customRoles)
                .where(eq(customRoles.tenantId, tenantId))
                .orderBy(asc(customRoles.name));
            const counts = await tx
                .select({ role: memberships.role, n: sql<number>`count(*)::int` })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), sql`${memberships.customRoleId} IS NULL`))
                .groupBy(memberships.role);
            const byRole = new Map(counts.map((c) => [c.role as string, c.n]));
            return {
                base: (['admin', ...CUSTOM_ROLE_BASES] as const).map((role) => ({ role, member_count: byRole.get(role) ?? 0 })),
                custom: rows.map((r) => toDto(r.row, r.members)),
            };
        });
    }

    async get(tenantId: number, id: number): Promise<CustomRole> {
        const hit = (await this.list(tenantId)).custom.find((r) => r.id === id);
        if (!hit) throw notFound(id);
        return hit;
    }

    /** El rol propio de la empresa (o 404): para asignarlo a una persona. */
    async findInTx(tx: Tx, tenantId: number, id: number): Promise<{ id: number; baseRole: CustomRoleBase; name: string } | null> {
        const [row] = await tx
            .select({ id: customRoles.id, baseRole: customRoles.baseRole, name: customRoles.name })
            .from(customRoles)
            .where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.id, id)))
            .limit(1);
        return row ? { id: row.id, baseRole: row.baseRole as CustomRoleBase, name: row.name } : null;
    }

    async create(tenantId: number, actorId: number, input: CreateCustomRoleInput): Promise<CustomRole> {
        const caps = sanitizeCaps(input.capabilities ?? CAPABILITIES_BY_ROLE[input.base_role]);
        const id = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [{ n } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(customRoles)
                .where(eq(customRoles.tenantId, tenantId));
            if (n >= MAX_CUSTOM_ROLES) {
                throw new BadRequestException({
                    code: 'role_limit',
                    message: `Una empresa puede tener hasta ${MAX_CUSTOM_ROLES} roles propios.`,
                    data: { status: 400 },
                });
            }
            await this.assertNameFree(tx, tenantId, input.name, null);
            const [row] = await tx
                .insert(customRoles)
                .values({
                    tenantId,
                    name: input.name.trim(),
                    description: input.description?.trim() || null,
                    color: input.color ?? null,
                    baseRole: input.base_role,
                    capabilities: caps,
                    createdBy: actorId > 0 ? actorId : null,
                })
                .returning({ id: customRoles.id });
            return row!.id;
        });
        this.realtime.invalidate(tenantId, 'roles');
        const role = await this.get(tenantId, id);
        await this.audit.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'role.create',
            targetType: 'role',
            targetId: id,
            targetLabel: role.name,
            meta: { base_role: role.base_role, capabilities: role.capabilities },
        });
        return role;
    }

    async update(tenantId: number, actorId: number, id: number, input: UpdateCustomRoleInput): Promise<CustomRole> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await this.findInTx(tx, tenantId, id);
            if (!existing) throw notFound(id);
            if (input.name !== undefined) await this.assertNameFree(tx, tenantId, input.name, id);
            const patch: Partial<typeof customRoles.$inferInsert> = { updatedAt: new Date() };
            if (input.name !== undefined) patch.name = input.name.trim();
            if (input.description !== undefined) patch.description = input.description?.trim() || null;
            if (input.color !== undefined) patch.color = input.color;
            if (input.capabilities !== undefined) patch.capabilities = sanitizeCaps(input.capabilities);
            await tx.update(customRoles).set(patch).where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.id, id)));
        });
        this.realtime.invalidate(tenantId, 'roles');
        // Lo que puede hacer cada persona con este rol cambió: la app se refresca.
        if (input.capabilities !== undefined) this.realtime.lists(tenantId);
        const role = await this.get(tenantId, id);
        await this.audit.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'role.update',
            targetType: 'role',
            targetId: id,
            targetLabel: role.name,
            meta: input.capabilities !== undefined ? { capabilities: role.capabilities } : undefined,
        });
        return role;
    }

    /** Borra el rol: sus personas quedan en su rol base (FK `ON DELETE SET NULL`). */
    async remove(tenantId: number, actorId: number, id: number): Promise<{ moved: number }> {
        const { name, moved } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [{ n } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.customRoleId, id)));
            const [row] = await tx
                .delete(customRoles)
                .where(and(eq(customRoles.tenantId, tenantId), eq(customRoles.id, id)))
                .returning({ name: customRoles.name });
            if (!row) throw notFound(id);
            return { name: row.name, moved: n };
        });
        this.realtime.invalidate(tenantId, 'roles');
        this.realtime.lists(tenantId);
        await this.audit.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'role.delete',
            targetType: 'role',
            targetId: id,
            targetLabel: name,
            meta: { moved_to_base: moved },
        });
        return { moved };
    }

    private async assertNameFree(tx: Tx, tenantId: number, name: string, exceptId: number | null): Promise<void> {
        const [hit] = await tx
            .select({ id: customRoles.id })
            .from(customRoles)
            .where(
                and(
                    eq(customRoles.tenantId, tenantId),
                    sql`lower(${customRoles.name}) = ${name.trim().toLowerCase()}`,
                    exceptId !== null ? ne(customRoles.id, exceptId) : undefined,
                ),
            )
            .limit(1);
        if (hit) {
            throw new ConflictException({
                code: 'role_name_taken',
                message: `Ya hay un rol llamado «${name.trim()}»`,
                data: { status: 409, errors: { name: 'Ya existe' } },
            });
        }
    }
}

/** Sólo las capacidades que un rol propio puede elegir, sin repetir y en orden. */
export function sanitizeCaps(list: readonly string[]): Capability[] {
    const wanted = new Set(list);
    return TOGGLEABLE_CAPABILITIES.filter((c) => wanted.has(c));
}

function toDto(row: typeof customRoles.$inferSelect, members: number): CustomRole {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
        base_role: row.baseRole as CustomRoleBase,
        capabilities: sanitizeCaps(Array.isArray(row.capabilities) ? row.capabilities : []),
        member_count: Number(members ?? 0),
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function notFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'role_not_found', message: `El rol ${id} no existe en esta empresa`, data: { status: 404 } });
}
