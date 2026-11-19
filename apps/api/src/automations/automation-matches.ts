import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { automationMatches, records } from '../db/schema';

/**
 * v0.1.455 — «Cuando un registro empieza a cumplir una condición»: el estado
 * de quién la cumple vive en `automation_matches` (una fila por automatización
 * y registro). Disparar es la transición «no estaba → está»; la decide el
 * `INSERT … ON CONFLICT DO NOTHING RETURNING`, así dos eventos o una revisión
 * a la vez nunca disparan dos veces por la misma entrada.
 *
 * `where` es la condición ya compilada por el MISMO motor de filtros de la
 * tabla (campos calculados, fechas relativas en la zona de la empresa), sobre
 * la tabla `records` sin alias. Lo que está en la papelera no entra ni sale:
 * su fila se conserva, así restaurarlo no vuelve a disparar.
 */

/** El registro vivo y si cumple la condición AHORA (null = no existe o está en la papelera). */
export async function matchesNow(
    tx: Tx,
    tenantId: number,
    listId: number,
    recordId: number,
    where: SQL,
): Promise<{ matches: boolean; data: Record<string, unknown> } | null> {
    const [row] = await tx
        .select({ data: records.data, matches: sql<boolean>`coalesce((${where}), false)` })
        .from(records)
        .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId), sql`${records.deletedAt} IS NULL`))
        .limit(1);
    if (!row) return null;
    return { matches: row.matches === true, data: (row.data ?? {}) as Record<string, unknown> };
}

/** Anota que el registro cumple la condición. true = no estaba (entró ahora). */
export async function enterMatch(tx: Tx, tenantId: number, automationId: number, recordId: number): Promise<boolean> {
    const inserted = await tx
        .insert(automationMatches)
        .values({ tenantId, automationId, recordId })
        .onConflictDoNothing()
        .returning({ recordId: automationMatches.recordId });
    return inserted.length > 0;
}

/** El registro dejó de cumplirla: puede volver a disparar si vuelve a entrar. */
export async function leaveMatch(tx: Tx, tenantId: number, automationId: number, recordId: number): Promise<void> {
    await tx
        .delete(automationMatches)
        .where(and(eq(automationMatches.tenantId, tenantId), eq(automationMatches.automationId, automationId), eq(automationMatches.recordId, recordId)));
}

/**
 * La línea de base: se borra lo anotado y se anotan TODOS los que la cumplen
 * hoy, sin disparar. Devuelve cuántos.
 */
export async function seedBaseline(tx: Tx, tenantId: number, automationId: number, listId: number, where: SQL): Promise<number> {
    await tx.delete(automationMatches).where(and(eq(automationMatches.tenantId, tenantId), eq(automationMatches.automationId, automationId)));
    const res = await tx.execute(sql`
        INSERT INTO ${automationMatches} (tenant_id, automation_id, record_id)
        SELECT ${tenantId}, ${automationId}, ${records.id} FROM ${records}
        WHERE ${records.tenantId} = ${tenantId} AND ${records.listId} = ${listId} AND ${records.deletedAt} IS NULL AND (${where})
        ON CONFLICT DO NOTHING`);
    return Number((res as { rowCount?: number | null }).rowCount ?? 0);
}

/**
 * La revisión periódica: (1) salen los que ya no la cumplen (vivos); (2)
 * entran, hasta `cap`, los que la cumplen y no estaban — ésos disparan.
 * Devuelve los que entraron (en orden de id) y si quedaron más para la próxima.
 */
export async function sweepMatches(
    tx: Tx,
    tenantId: number,
    automationId: number,
    listId: number,
    where: SQL,
    cap: number,
): Promise<{ entered: number[]; left: number; more: boolean }> {
    const left = await tx.execute(sql`
        DELETE FROM ${automationMatches} m
        WHERE m.tenant_id = ${tenantId} AND m.automation_id = ${automationId}
          AND EXISTS (
            SELECT 1 FROM ${records}
            WHERE ${records.id} = m.record_id AND ${records.tenantId} = ${tenantId} AND ${records.deletedAt} IS NULL
              AND NOT coalesce((${where}), false)
          )`);
    const res = await tx.execute(sql`
        INSERT INTO ${automationMatches} (tenant_id, automation_id, record_id)
        SELECT ${tenantId}, ${automationId}, ${records.id} FROM ${records}
        WHERE ${records.tenantId} = ${tenantId} AND ${records.listId} = ${listId} AND ${records.deletedAt} IS NULL AND (${where})
          AND NOT EXISTS (
            SELECT 1 FROM ${automationMatches} m2 WHERE m2.automation_id = ${automationId} AND m2.record_id = ${records.id}
          )
        ORDER BY ${records.id}
        LIMIT ${cap + 1}
        ON CONFLICT DO NOTHING
        RETURNING record_id`);
    const ids = (res.rows as Array<{ record_id: number | string }>).map((r) => Number(r.record_id)).sort((a, b) => a - b);
    // Se insertó uno de más para saber si había más: ése se devuelve a la
    // revisión siguiente (sin dispararlo ahora).
    const more = ids.length > cap;
    if (more) {
        const extra = ids.slice(cap);
        await tx.execute(sql`
            DELETE FROM ${automationMatches}
            WHERE tenant_id = ${tenantId} AND automation_id = ${automationId}
              AND record_id IN (${sql.join(extra.map((id) => sql`${id}`), sql`, `)})`);
    }
    return { entered: ids.slice(0, cap), left: Number((left as { rowCount?: number | null }).rowCount ?? 0), more };
}
