import {
    MIRROR_GONE_VALUE,
    mirrorGoneFieldId,
    mirrorRecordGone,
    mirrorRowFromData,
    type MirrorListMarker,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ActivityService } from '../activity/activity.service';
import type { Tx } from '../db/client';
import { records } from '../db/schema';

/**
 * v0.1.336 — Lo que la FUENTE (la tienda o el sitio) ya borró.
 *
 * Una lista espejo no deja borrar registros: se borran allá y la próxima vuelta
 * los traería de nuevo. Pero lo que ya se borró allá (marcado «Papelera») no
 * tiene por qué quedarse para siempre en la app ocupando registros del plan:
 * se puede QUITAR. Quitar es el borrado de siempre de la app —va a su papelera
 * 30 días, se puede restaurar y deja de contar para el plan— y la
 * sincronización lo respeta:
 *  - nunca crea un registro para algo que ya está borrado en la fuente;
 *  - si lo que se quitó vuelve a estar vivo allá (se restauró en WordPress o en
 *    la tienda), el MISMO registro vuelve de la papelera de la app.
 * Las dos reglas viven en los motores; aquí, lo común a los dos.
 */

/** ¿Este dato de la fuente dice que ya no está (o está en su papelera)? */
export function isGoneValue(v: unknown): boolean {
    return v === MIRROR_GONE_VALUE;
}

/** ¿La fila guardada (con su padre, si es una subtarea) ya se borró en la fuente? */
export function rowIsGone(
    marker: MirrorListMarker,
    data: Record<string, unknown> | null | undefined,
    parentData?: Record<string, unknown> | null,
): boolean {
    return mirrorRecordGone(marker, mirrorRowFromData(marker, data), parentData ? mirrorRowFromData(marker, parentData) : null);
}

/**
 * Las filas que se pueden quitar de una lista: las que la fuente marcó como
 * borradas, salvo las subtareas cuyo padre también se borró (se van con él).
 * Ids, en el orden de la lista.
 */
export async function goneIdsInList(tx: Tx, tenantId: number, listId: number, marker: MirrorListMarker, limit = 5000): Promise<number[]> {
    const fieldId = mirrorGoneFieldId(marker);
    if (fieldId === null) return [];
    const key = `f${fieldId}`;
    const rows = await tx.execute<{ id: number | string }>(sql`
        SELECT r.id FROM records r
        LEFT JOIN records p ON p.id = r.parent_id AND p.tenant_id = r.tenant_id AND p.deleted_at IS NULL
        WHERE r.tenant_id = ${tenantId} AND r.list_id = ${listId} AND r.deleted_at IS NULL
          AND r.data->>${key} = ${MIRROR_GONE_VALUE}
          AND (r.parent_id IS NULL OR coalesce(p.data->>${key}, '') <> ${MIRROR_GONE_VALUE})
        ORDER BY r.id
        LIMIT ${limit}
    `);
    return rows.rows.map((r) => Number(r.id));
}

/** Cuántas filas de la lista se pueden quitar (las que cuenta `goneIdsInList`). */
export async function countGoneInList(tx: Tx, tenantId: number, listId: number, marker: MirrorListMarker): Promise<number> {
    const fieldId = mirrorGoneFieldId(marker);
    if (fieldId === null) return 0;
    const key = `f${fieldId}`;
    const [row] = (
        await tx.execute<{ n: number | string }>(sql`
            SELECT count(*)::int AS n FROM records r
            LEFT JOIN records p ON p.id = r.parent_id AND p.tenant_id = r.tenant_id AND p.deleted_at IS NULL
            WHERE r.tenant_id = ${tenantId} AND r.list_id = ${listId} AND r.deleted_at IS NULL
              AND r.data->>${key} = ${MIRROR_GONE_VALUE}
              AND (r.parent_id IS NULL OR coalesce(p.data->>${key}, '') <> ${MIRROR_GONE_VALUE})
        `)
    ).rows;
    return Number(row?.n ?? 0);
}

/**
 * Quita de la app (a su papelera) registros de una lista espejo, con sus
 * subtareas, dentro de `tx`. Lo usa la sincronización cuando la empresa eligió
 * «quitarlo de la app»: no lo hace una persona (`deleted_by` vacío) y la
 * actividad dice por qué. Devuelve cuántos registros (sin contar subtareas).
 */
export async function removeGoneInTx(
    tx: Tx,
    activity: ActivityService,
    tenantId: number,
    listId: number,
    /** «WordPress» / «WooCommerce» (lo dice la actividad del registro). */
    sourceName: string,
    ids: number[],
): Promise<number> {
    if (ids.length === 0) return 0;
    const unique = [...new Set(ids)];
    const removed = await tx
        .update(records)
        .set({ deletedAt: sql`now()`, deletedBy: null })
        .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.id, unique), isNull(records.deletedAt)))
        .returning({ id: records.id });
    if (removed.length === 0) return 0;
    const removedIds = removed.map((r) => r.id);
    // Las subtareas se van con el padre (mismo instante: restaurarlo las trae de vuelta).
    await tx
        .update(records)
        .set({ deletedAt: sql`now()`, deletedBy: null })
        .where(and(eq(records.tenantId, tenantId), inArray(records.parentId, removedIds), isNull(records.deletedAt)));
    for (const id of removedIds) {
        await activity.logInTx(tx, {
            tenantId,
            listId,
            recordId: id,
            userId: null,
            action: 'record_deleted',
            diff: { source_gone: { from: sourceName, to: null } },
        });
    }
    return removedIds.length;
}

/**
 * Vuelve a la vida un registro que se quitó de la app porque la fuente lo había
 * borrado, cuando la fuente lo vuelve a tener (se restauró allá). Sólo el
 * registro: sus subtareas vuelven cuando llegan vivas por su cuenta.
 */
export async function reviveInTx(
    tx: Tx,
    activity: ActivityService,
    tenantId: number,
    listId: number,
    ids: number[],
    sourceName: string,
): Promise<void> {
    if (ids.length === 0) return;
    const revived = await tx.execute<{ id: number | string }>(sql`
        UPDATE records SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = 0
        WHERE tenant_id = ${tenantId} AND list_id = ${listId} AND deleted_at IS NOT NULL AND id IN (${sql.join(
            [...new Set(ids)].map((i) => sql`${i}`),
            sql`, `,
        )})
        RETURNING id
    `);
    for (const r of revived.rows) {
        await activity.logInTx(tx, { tenantId, listId, recordId: Number(r.id), userId: null, action: 'record_restored', diff: { source_back: { from: null, to: sourceName } } });
    }
}
