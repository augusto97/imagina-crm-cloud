import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { memberships, users } from '../db/schema';

export interface MeUserRow {
    id: number;
    name: string;
    email: string;
}

/** Escapa los comodines de LIKE (`%`, `_`) y la barra de escape del needle. */
function escapeLike(needle: string): string {
    return needle.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Acceso a datos de los endpoints `/me/*`. La búsqueda de usuarios recibe un
 * `tx` ya scopeado al tenant (withTenant): la RLS de `memberships` aísla el
 * join, así sólo se alcanzan usuarios del tenant activo. La firma va directo
 * sobre `users` (sin RLS) con el `db` base, filtrada por el id de la sesión.
 */
@Injectable()
export class MeRepository {
    /**
     * Miembros del tenant cuyo nombre O email contiene `q` (case-insensitive,
     * parámetro bindeado — jamás interpolado). Excluye cuentas desactivadas.
     */
    searchMembers(tx: Tx, tenantId: number, q: string, limit: number): Promise<MeUserRow[]> {
        const pattern = `%${escapeLike(q)}%`;
        return tx
            .select({ id: users.id, name: users.name, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(
                and(
                    eq(memberships.tenantId, tenantId),
                    isNull(users.disabledAt),
                    or(ilike(users.name, pattern), ilike(users.email, pattern)),
                ),
            )
            .orderBy(asc(users.name), asc(users.id))
            .limit(limit);
    }

    /** Miembro del tenant por user id — null si no hay membership. */
    async findMember(tx: Tx, tenantId: number, userId: number): Promise<MeUserRow | null> {
        const [row] = await tx
            .select({ id: users.id, name: users.name, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
            .limit(1);
        return row ?? null;
    }

    /** Firma de email del usuario (users no tiene RLS; filtra por id de sesión). */
    async getSignature(db: Db, userId: number): Promise<string> {
        const [row] = await db
            .select({ emailSignature: users.emailSignature })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return row?.emailSignature ?? '';
    }

    async setSignature(db: Db, userId: number, signature: string): Promise<void> {
        await db
            .update(users)
            .set({ emailSignature: signature, updatedAt: new Date() })
            .where(eq(users.id, userId));
    }
}
