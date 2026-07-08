import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { memberships, users } from '../db/schema';

export interface MemberRow {
    userId: number;
    name: string;
    email: string;
    role: (typeof memberships.$inferSelect)['role'];
}

/**
 * Acceso a datos de miembros de un workspace. Los métodos reciben un `tx` ya
 * scopeado al tenant (withTenant): la RLS de `memberships` filtra por
 * `app.tenant_id`, así que el join sólo devuelve usuarios de este tenant.
 * `users` no tiene RLS, pero sólo se alcanza a través de memberships aisladas.
 */
@Injectable()
export class MembersRepository {
    listByTenant(tx: Tx, tenantId: number): Promise<MemberRow[]> {
        return tx
            .select({
                userId: memberships.userId,
                name: users.name,
                email: users.email,
                role: memberships.role,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.tenantId, tenantId))
            .orderBy(asc(users.name), asc(memberships.userId));
    }

    async findMembership(
        tx: Tx,
        tenantId: number,
        userId: number,
    ): Promise<MemberRow | null> {
        const [row] = await tx
            .select({
                userId: memberships.userId,
                name: users.name,
                email: users.email,
                role: memberships.role,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
            .limit(1);
        return row ?? null;
    }

    /** Busca un usuario por email (case-insensitive). `users` no tiene RLS. */
    async findUserByEmail(
        tx: Tx,
        email: string,
    ): Promise<{ id: number; name: string; email: string } | null> {
        const [row] = await tx
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(sql`lower(${users.email}) = lower(${email})`)
            .limit(1);
        return row ?? null;
    }

    async insert(
        tx: Tx,
        tenantId: number,
        userId: number,
        role: MemberRow['role'],
    ): Promise<void> {
        await tx.insert(memberships).values({ tenantId, userId, role });
    }

    async updateRole(
        tx: Tx,
        tenantId: number,
        userId: number,
        role: MemberRow['role'],
    ): Promise<void> {
        await tx
            .update(memberships)
            .set({ role, updatedAt: new Date() })
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    }

    async remove(tx: Tx, tenantId: number, userId: number): Promise<void> {
        await tx
            .delete(memberships)
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    }

    /** Cuenta miembros con un rol dado — para no quedarnos sin admins. */
    async countByRole(tx: Tx, tenantId: number, role: MemberRow['role']): Promise<number> {
        const [row] = await tx
            .select({ n: count() })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, role)));
        return row?.n ?? 0;
    }
}
