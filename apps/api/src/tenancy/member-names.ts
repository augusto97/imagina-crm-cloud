import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { memberships, users } from '../db/schema';

/**
 * El nombre de una persona COMO LO VE LA EMPRESA: el de su cuenta, salvo que
 * un admin la haya sumado (la cuenta ya existía) y todavía no haya entrado —
 * sumar una cuenta no le pide permiso a nadie, así que hasta que entra sólo
 * se muestra lo que la empresa ya sabía: la parte del correo antes de la @.
 */
export const memberDisplayName: SQL<string> = sql<string>`(CASE WHEN ${memberships.joinedAt} IS NULL THEN split_part(${users.email}, '@', 1) ELSE ${users.name} END)`;

/**
 * SEC (auditoría 2026-11) — Nombre y correo de PERSONAS DE ESTA EMPRESA.
 *
 * `users` es una tabla global (una cuenta puede estar en varias empresas): un
 * id que sale de los datos de un registro o de una configuración (un campo
 * Persona, quién atiende una agenda) lo pudo escribir cualquiera, así que
 * buscarlo directo en `users` le mostraba a una empresa el nombre y el correo
 * de cuentas ajenas con sólo probar ids. Aquí sólo se resuelve quien tiene una
 * membresía en la empresa; el resto queda sin nombre (quien llama usa su
 * texto de «persona desconocida»).
 */
export async function memberNames(
    db: Db | Tx,
    tenantId: number,
    ids: readonly number[],
): Promise<Map<number, { name: string; email: string }>> {
    const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
    if (unique.length === 0) return new Map();
    const rows = await db
        .select({ id: users.id, name: memberDisplayName, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, unique)));
    return new Map(rows.map((r) => [r.id, { name: r.name ?? '', email: r.email }]));
}
