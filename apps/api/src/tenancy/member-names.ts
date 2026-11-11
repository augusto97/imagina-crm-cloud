import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { memberships, users } from '../db/schema';

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
        .select({ id: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, unique)));
    return new Map(rows.map((r) => [r.id, { name: r.name ?? '', email: r.email }]));
}
