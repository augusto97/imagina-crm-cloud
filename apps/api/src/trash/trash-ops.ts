import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { automationRuns, automations, dashboards, fields, lists, records, savedViews } from '../db/schema';

/**
 * Papelera — operaciones de bajo nivel que comparten los services que borran
 * (listas, campos, vistas, automatizaciones, tableros) y el de la papelera.
 *
 * Las filas borradas de esas cinco tablas las OCULTA la RLS (migración 0079):
 * sólo se ven con `app.trash = 'on'` en la transacción. Marcar una fila como
 * borrada también lo necesita (Postgres valida la fila nueva contra la policy
 * de lectura cuando el UPDATE filtra por columnas), así que cada operación
 * enciende el modo, hace lo suyo y lo apaga: lo que sigue en la misma
 * transacción vuelve a no ver la papelera.
 *
 * Los registros (`records`) no pasan por eso: siempre se borraron de forma
 * lógica y TODAS sus lecturas ya filtran `deleted_at IS NULL`.
 */

export async function enterTrashMode(tx: Tx): Promise<void> {
    await tx.execute(sql`select set_config('app.trash', 'on', true)`);
}

export async function exitTrashMode(tx: Tx): Promise<void> {
    await tx.execute(sql`select set_config('app.trash', '', true)`);
}

/**
 * Corre `fn` viendo la papelera. Si `fn` falla la transacción ya está abortada
 * (no hay nada que apagar): el error sube tal cual.
 */
export async function inTrashMode<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
    await enterTrashMode(tx);
    const out = await fn();
    await exitTrashMode(tx);
    return out;
}

export type TrashTableName = 'lists' | 'fields' | 'saved_views' | 'automations' | 'dashboards';

const TABLES = {
    lists,
    fields,
    saved_views: savedViews,
    automations,
    dashboards,
} as const;

/** Manda UNA fila a la papelera. false si no existía viva. */
export async function trashRow(
    tx: Tx,
    table: TrashTableName,
    tenantId: number,
    id: number,
    userId: number | null,
): Promise<boolean> {
    const t = TABLES[table];
    return inTrashMode(tx, async () => {
        const rows = await tx
            .update(t)
            .set({ deletedAt: sql`now()`, deletedBy: userId } as never)
            .where(and(eq(t.tenantId, tenantId), eq(t.id, id), isNull(t.deletedAt)))
            .returning({ id: t.id });
        return rows.length > 0;
    });
}

/**
 * Manda una lista a la papelera CON todo lo de adentro: campos, vistas,
 * automatizaciones y registros vivos quedan marcados con el MISMO instante
 * (`now()` es el de la transacción), así restaurar la lista trae de vuelta
 * exactamente lo que se fue con ella — y no lo que ya estaba en la papelera
 * desde antes, que conserva su propia fecha.
 *
 * Las esperas en curso de sus automatizaciones se cancelan (como al pausar:
 * restaurar no las retoma). Devuelve los ids de esas automatizaciones.
 */
export async function trashListCascade(
    tx: Tx,
    tenantId: number,
    listId: number,
    userId: number | null,
): Promise<{ trashed: boolean; automationIds: number[] }> {
    return inTrashMode(tx, async () => {
        const hit = await tx
            .update(lists)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId), isNull(lists.deletedAt)))
            .returning({ id: lists.id });
        if (hit.length === 0) return { trashed: false, automationIds: [] };
        await tx
            .update(fields)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, listId), isNull(fields.deletedAt)));
        await tx
            .update(savedViews)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.listId, listId), isNull(savedViews.deletedAt)));
        const autos = await tx
            .update(automations)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(and(eq(automations.tenantId, tenantId), eq(automations.listId, listId), isNull(automations.deletedAt)))
            .returning({ id: automations.id });
        await tx
            .update(records)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt)));
        const automationIds = autos.map((a) => a.id);
        if (automationIds.length > 0) {
            await cancelWaitingRuns(tx, tenantId, automationIds, 'La lista se movió a la papelera: la espera no siguió.');
        }
        return { trashed: true, automationIds };
    });
}

/** Cancela las corridas en espera de estas automatizaciones (con el motivo en el historial). */
export async function cancelWaitingRuns(tx: Tx, tenantId: number, automationIds: number[], reason: string): Promise<void> {
    if (automationIds.length === 0) return;
    await tx
        .update(automationRuns)
        .set({
            status: 'cancelled',
            error: reason,
            finishedAt: sql`now()`,
            resumeAt: null,
            resumeState: null,
            actionsLog: sql`${automationRuns.actionsLog} || ${JSON.stringify([{ action: 'wait', status: 'skipped', message: reason, details: {} }])}::jsonb`,
        })
        .where(
            and(
                eq(automationRuns.tenantId, tenantId),
                inArray(automationRuns.automationId, automationIds),
                eq(automationRuns.status, 'waiting'),
            ),
        );
}
