import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';

/**
 * v0.1.449 (I3, ADR-S108) — Limpieza del acceso «por la agencia».
 *
 * El guard ya corta al instante a quien dejó de ser admin de la agencia (o a
 * un cliente desvinculado), aunque la fila exista. Esto BORRA esas filas para
 * que la persona no aparezca en el equipo del cliente y, si vuelve a la
 * agencia, tenga que volver a «Entrar» (queda en la bitácora del cliente).
 *
 * Corre con la conexión BASE (las membresías de los clientes no se ven desde
 * el scope de la agencia). Devuelve los clientes afectados.
 */
export async function revokeAgencyStaffAccess(db: Db | Tx, agencyId: number, userId: number): Promise<number[]> {
    const list = (
        await db.execute(sql`
            DELETE FROM memberships m
            USING tenants t
            WHERE m.tenant_id = t.id AND t.agency_id = ${agencyId} AND m.user_id = ${userId} AND m.via_agency
            RETURNING m.tenant_id AS tenant_id
        `)
    ).rows as Array<{ tenant_id: number | string }>;
    const ids = list.map((r) => Number(r.tenant_id)).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length > 0) {
        await db.execute(sql`DELETE FROM team_members WHERE user_id = ${userId} AND tenant_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    }
    return ids;
}

/** Al desvincular un cliente (o pasarlo a otra agencia): fuera toda la gente de la agencia anterior. */
export async function revokeClientAgencyAccess(db: Db | Tx, clientId: number): Promise<number> {
    const list = (
        await db.execute(sql`DELETE FROM memberships WHERE tenant_id = ${clientId} AND via_agency RETURNING user_id`)
    ).rows as Array<{ user_id: number | string }>;
    const userIds = list.map((r) => Number(r.user_id)).filter((n) => Number.isInteger(n) && n > 0);
    if (userIds.length > 0) {
        await db.execute(sql`DELETE FROM team_members WHERE tenant_id = ${clientId} AND user_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    return userIds.length;
}
