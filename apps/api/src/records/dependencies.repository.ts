import { Injectable } from '@nestjs/common';
import type { DoneRule } from '@imagina-base/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { recordDependencies, records, type RecordDependencyRow } from '../db/schema';

/** Una punta de una dependencia con los datos del OTRO registro (vivo). */
export interface DependencyLinkRow {
    dep: RecordDependencyRow;
    /** El otro registro (null si está en la papelera: la dependencia queda inerte). */
    other: { id: number; listId: number; data: Record<string, unknown>; createdBy: number } | null;
}

/**
 * A8 — Acceso a `record_dependencies` (tenant-scoped: RLS + tenant_id
 * explícito). Toda lectura que «cuenta» cruza `records.deleted_at IS NULL`:
 * un registro en la papelera deja sus dependencias inertes.
 */
@Injectable()
export class DependenciesRepository {
    /**
     * Candado de la lista mientras se agrega una dependencia: dos altas
     * simultáneas (A→B y B→A) no pueden pasar las dos el chequeo de ciclos.
     */
    async lockList(tx: Tx, tenantId: number, listId: number): Promise<void> {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`deps:${tenantId}:${listId}`}))`);
    }

    /** Todas las aristas «bloquea a» de una lista (para el chequeo de ciclos). */
    async edgesOfList(tx: Tx, tenantId: number, listId: number): Promise<Array<{ blocker: number; blocked: number }>> {
        const rows = await tx
            .select({ blocker: recordDependencies.blockerRecordId, blocked: recordDependencies.blockedRecordId })
            .from(recordDependencies)
            .where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.blockedListId, listId)));
        return rows;
    }

    async findById(tx: Tx, tenantId: number, id: number): Promise<RecordDependencyRow | null> {
        const [row] = await tx
            .select()
            .from(recordDependencies)
            .where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.id, id)))
            .limit(1);
        return row ?? null;
    }

    async findPair(tx: Tx, tenantId: number, blocker: number, blocked: number): Promise<RecordDependencyRow | null> {
        const [row] = await tx
            .select()
            .from(recordDependencies)
            .where(
                and(
                    eq(recordDependencies.tenantId, tenantId),
                    eq(recordDependencies.blockerRecordId, blocker),
                    eq(recordDependencies.blockedRecordId, blocked),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    async countBlockersOf(tx: Tx, tenantId: number, blocked: number): Promise<number> {
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(recordDependencies)
            .where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.blockedRecordId, blocked)));
        return row?.n ?? 0;
    }

    async insert(tx: Tx, values: typeof recordDependencies.$inferInsert): Promise<RecordDependencyRow> {
        const [row] = await tx.insert(recordDependencies).values(values).returning();
        if (!row) throw new Error('Insert de dependencia no devolvió fila');
        return row;
    }

    async updateLag(tx: Tx, tenantId: number, id: number, lagDays: number): Promise<RecordDependencyRow | null> {
        const [row] = await tx
            .update(recordDependencies)
            .set({ lagDays })
            .where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.id, id)))
            .returning();
        return row ?? null;
    }

    async delete(tx: Tx, tenantId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(recordDependencies)
            .where(and(eq(recordDependencies.tenantId, tenantId), eq(recordDependencies.id, id)))
            .returning({ id: recordDependencies.id });
        return rows.length > 0;
    }

    /**
     * Las dos listas de un registro: lo que lo bloquea y lo que él bloquea,
     * con los datos del otro registro (null si está en la papelera).
     */
    async linksOf(tx: Tx, tenantId: number, recordId: number): Promise<{ blockedBy: DependencyLinkRow[]; blocks: DependencyLinkRow[] }> {
        const deps = await tx
            .select()
            .from(recordDependencies)
            .where(
                and(
                    eq(recordDependencies.tenantId, tenantId),
                    or(eq(recordDependencies.blockedRecordId, recordId), eq(recordDependencies.blockerRecordId, recordId)),
                ),
            )
            .orderBy(recordDependencies.id);
        const otherIds = [...new Set(deps.map((d) => (d.blockedRecordId === recordId ? d.blockerRecordId : d.blockedRecordId)))];
        const others = otherIds.length
            ? await tx
                  .select({ id: records.id, listId: records.listId, data: records.data, createdBy: records.createdBy })
                  .from(records)
                  .where(and(eq(records.tenantId, tenantId), inArray(records.id, otherIds), isNull(records.deletedAt)))
            : [];
        const byId = new Map(others.map((o) => [o.id, { ...o, data: o.data as Record<string, unknown> }]));
        const blockedBy: DependencyLinkRow[] = [];
        const blocks: DependencyLinkRow[] = [];
        for (const d of deps) {
            if (d.blockedRecordId === recordId) blockedBy.push({ dep: d, other: byId.get(d.blockerRecordId) ?? null });
            else blocks.push({ dep: d, other: byId.get(d.blockedRecordId) ?? null });
        }
        return { blockedBy, blocks };
    }

    /**
     * Cuántos bloqueantes ABIERTOS tiene cada registro de una tanda (vivos y
     * no terminados), en una consulta (regla de oro nº 8). `done` = la regla
     * de «terminado» de la lista; sin regla, todo bloqueante vivo cuenta.
     */
    async openBlockerCounts(tx: Tx, tenantId: number, ids: number[], done: DoneRule | null): Promise<Map<number, number>> {
        const out = new Map<number, number>();
        if (ids.length === 0) return out;
        const val = done ? sql`(${records.data} ->> ${`f${done.fieldId}`})` : null;
        const notDone =
            done && val
                ? sql`(${val} IS NULL OR ${val} NOT IN (${sql.join(done.values.map((v) => sql`${v}`), sql`, `)}))`
                : undefined;
        const rows = await tx
            .select({ id: recordDependencies.blockedRecordId, n: sql<number>`count(*)::int` })
            .from(recordDependencies)
            .innerJoin(records, eq(records.id, recordDependencies.blockerRecordId))
            .where(
                and(
                    eq(recordDependencies.tenantId, tenantId),
                    inArray(recordDependencies.blockedRecordId, ids),
                    isNull(records.deletedAt),
                    notDone,
                ),
            )
            .groupBy(recordDependencies.blockedRecordId);
        for (const r of rows) out.set(r.id, r.n);
        return out;
    }

    /** Los que dependen de estos registros (aristas «blocker → blocked» con el blocked vivo). */
    async dependentsOf(tx: Tx, tenantId: number, blockerIds: number[]): Promise<Array<{ blocker: number; blocked: number; listId: number }>> {
        if (blockerIds.length === 0) return [];
        return tx
            .select({
                blocker: recordDependencies.blockerRecordId,
                blocked: recordDependencies.blockedRecordId,
                listId: recordDependencies.blockedListId,
            })
            .from(recordDependencies)
            .innerJoin(records, eq(records.id, recordDependencies.blockedRecordId))
            .where(
                and(
                    eq(recordDependencies.tenantId, tenantId),
                    inArray(recordDependencies.blockerRecordId, blockerIds),
                    isNull(records.deletedAt),
                ),
            )
            .orderBy(recordDependencies.id);
    }

    /** Aristas cuyas DOS puntas están en la tanda (las flechas del Gantt). */
    async edgesAmong(tx: Tx, tenantId: number, ids: number[]): Promise<Array<{ id: number; blocker_id: number; blocked_id: number; lag_days: number }>> {
        if (ids.length === 0) return [];
        // Por tandas: un IN con miles de ids sigue siendo una consulta por tanda.
        const out: Array<{ id: number; blocker_id: number; blocked_id: number; lag_days: number }> = [];
        const set = new Set(ids);
        for (let i = 0; i < ids.length; i += 1000) {
            const chunk = ids.slice(i, i + 1000);
            const rows = await tx
                .select({
                    id: recordDependencies.id,
                    blocker_id: recordDependencies.blockerRecordId,
                    blocked_id: recordDependencies.blockedRecordId,
                    lag_days: recordDependencies.lagDays,
                })
                .from(recordDependencies)
                .where(and(eq(recordDependencies.tenantId, tenantId), inArray(recordDependencies.blockedRecordId, chunk)));
            for (const r of rows) if (set.has(r.blocker_id)) out.push(r);
        }
        return out;
    }

    /** Datos de una tanda de registros vivos de la lista (títulos, ACL), en una consulta. */
    async rowsOf(
        tx: Tx,
        tenantId: number,
        listId: number,
        ids: number[],
    ): Promise<Map<number, { id: number; data: Record<string, unknown>; createdBy: number }>> {
        const out = new Map<number, { id: number; data: Record<string, unknown>; createdBy: number }>();
        const unique = [...new Set(ids)];
        for (let i = 0; i < unique.length; i += 1000) {
            const chunk = unique.slice(i, i + 1000);
            const rows = await tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.id, chunk), isNull(records.deletedAt)));
            for (const r of rows) out.set(r.id, { id: r.id, data: r.data as Record<string, unknown>, createdBy: r.createdBy });
        }
        return out;
    }

    /** Resumen por lista (asistente): cuántas dependencias hay entre registros vivos. */
    async countForList(tx: Tx, tenantId: number, listId: number): Promise<number> {
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(recordDependencies)
            .innerJoin(records, eq(records.id, recordDependencies.blockedRecordId))
            .where(
                and(
                    eq(recordDependencies.tenantId, tenantId),
                    eq(recordDependencies.blockedListId, listId),
                    isNull(records.deletedAt),
                    // Las dos puntas vivas: una en la papelera deja la dependencia inerte.
                    sql`EXISTS (SELECT 1 FROM records rb WHERE rb.id = ${recordDependencies.blockerRecordId} AND rb.deleted_at IS NULL)`,
                ),
            );
        return row?.n ?? 0;
    }
}
