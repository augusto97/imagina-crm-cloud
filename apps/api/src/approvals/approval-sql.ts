import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';

/**
 * C5 — El campo derivado «Aprobación»: el estado de la ÚLTIMA solicitud del
 * registro (de un flujo, o de cualquiera si `flowId` es null), como una
 * subconsulta correlacionada sobre la fila de `records`. Es lo que filtra
 * («pendientes»), ordena y agrupa — igual que un rollup — y el índice
 * `(record_id, id DESC)` la resuelve con una sola búsqueda por fila. Sin
 * solicitudes, NULL («sin pedir»).
 *
 * El flujo va como parámetro (es un id numérico validado al guardar el campo);
 * la RLS de `approval_requests` acota a la empresa de la transacción.
 */
export function approvalStatusExpr(flowId: number | null): SQL {
    // La columna va ANIDADA en otro `sql`: si quedara como chunk de primer
    // nivel, drizzle la escribe sin tabla (`"id"`) cuando la expresión es una
    // columna del SELECT de una sola tabla, y dentro de la subconsulta `"id"`
    // sería `ar.id` — la del registro dejaría de correlacionar.
    const recordId = sql`${records.id}`;
    return flowId
        ? sql`(SELECT ar.status FROM approval_requests ar WHERE ar.record_id = ${recordId} AND ar.flow_id = ${flowId} ORDER BY ar.id DESC LIMIT 1)`
        : sql`(SELECT ar.status FROM approval_requests ar WHERE ar.record_id = ${recordId} ORDER BY ar.id DESC LIMIT 1)`;
}

/** `IN ($1, $2, …)` con cada id bindeado (drizzle serializa un array JS como JSON). */
function idList(ids: readonly number[]): SQL {
    return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

/**
 * El estado de la última solicitud de cada registro de una página (el valor del
 * campo «Aprobación» en el DTO), en UNA consulta por campo.
 */
export async function latestApprovalStatuses(tx: Tx, ids: readonly number[], flowId: number | null): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    const res = await tx.execute(
        flowId
            ? sql`SELECT DISTINCT ON (ar.record_id) ar.record_id AS rid, ar.status FROM approval_requests ar
                  WHERE ar.record_id IN (${idList(ids)}) AND ar.flow_id = ${flowId}
                  ORDER BY ar.record_id, ar.id DESC`
            : sql`SELECT DISTINCT ON (ar.record_id) ar.record_id AS rid, ar.status FROM approval_requests ar
                  WHERE ar.record_id IN (${idList(ids)})
                  ORDER BY ar.record_id, ar.id DESC`,
    );
    // OJO: el alias de salida NO puede llamarse `id`. En un ORDER BY, Postgres
    // resuelve primero los nombres de las columnas de SALIDA: `ORDER BY …, id
    // DESC` ordenaba por `record_id AS id` y la «última» solicitud salía al
    // azar (un registro devuelto y vuelto a pedir mostraba «Devuelta»).
    for (const row of res.rows as Array<{ rid: unknown; status: unknown }>) out.set(Number(row.rid), String(row.status));
    return out;
}

/**
 * Cuántas solicitudes PENDIENTES tiene cada registro de una página: el
 * indicador de la fila (reloj de arena junto al título). Una consulta por
 * página, por el índice único parcial de las pendientes.
 */
export async function pendingApprovalCounts(tx: Tx, ids: readonly number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (ids.length === 0) return out;
    const res = await tx.execute(sql`
        SELECT record_id AS id, count(*)::int AS n FROM approval_requests
        WHERE record_id IN (${idList(ids)}) AND status = 'pending'
        GROUP BY record_id`);
    for (const row of res.rows as Array<{ id: unknown; n: unknown }>) out.set(Number(row.id), Number(row.n) || 0);
    return out;
}
