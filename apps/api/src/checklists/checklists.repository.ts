import { Injectable } from '@nestjs/common';
import type { Checklist, ChecklistItem, ChecklistProgress } from '@imagina-base/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { recordChecklistItems, recordChecklists, type RecordChecklistItemRow, type RecordChecklistRow } from '../db/schema';

/** Un ítem a insertar (ya validado). */
export interface NewChecklistItem {
    text: string;
    assigneeId: number | null;
    /** `AAAA-MM-DD` (sin hora) o instante ISO (con hora). */
    due: string | null;
    done?: boolean;
}

/**
 * A9 — Acceso a `record_checklists` + `record_checklist_items` (RLS +
 * tenant_id explícito). Sin estado: `RecordsService` lo crea a mano para el
 * progreso del listado (como el de dependencias).
 */
@Injectable()
export class ChecklistsRepository {
    /**
     * Candado del registro mientras se tocan sus checklists: dos personas que
     * marcan los dos últimos ítems a la vez no pueden «perderse» el momento en
     * que el checklist quedó completo (el disparador de automatizaciones).
     */
    async lockRecord(tx: Tx, tenantId: number, recordId: number): Promise<void> {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`chk:${tenantId}:${recordId}`}))`);
    }

    /** Los checklists de un registro con sus ítems, en orden. */
    async forRecord(tx: Tx, tenantId: number, recordId: number): Promise<Checklist[]> {
        const lists = await tx
            .select()
            .from(recordChecklists)
            .where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.recordId, recordId)))
            .orderBy(asc(recordChecklists.position), asc(recordChecklists.id));
        if (lists.length === 0) return [];
        const items = await tx
            .select()
            .from(recordChecklistItems)
            .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.recordId, recordId)))
            .orderBy(asc(recordChecklistItems.position), asc(recordChecklistItems.id));
        const byList = new Map<number, ChecklistItem[]>();
        for (const it of items) byList.set(it.checklistId, [...(byList.get(it.checklistId) ?? []), toItem(it)]);
        return lists.map((c) => toChecklist(c, byList.get(c.id) ?? []));
    }

    /**
     * Checklists de varios registros (blueprint de una lista con sus
     * registros, portal) en DOS consultas por tanda de 1.000.
     */
    async forRecords(tx: Tx, tenantId: number, recordIds: number[]): Promise<Map<number, Checklist[]>> {
        const out = new Map<number, Checklist[]>();
        const unique = [...new Set(recordIds)];
        for (let i = 0; i < unique.length; i += 1000) {
            const chunk = unique.slice(i, i + 1000);
            const lists = await tx
                .select()
                .from(recordChecklists)
                .where(and(eq(recordChecklists.tenantId, tenantId), inArray(recordChecklists.recordId, chunk)))
                .orderBy(asc(recordChecklists.position), asc(recordChecklists.id));
            if (lists.length === 0) continue;
            const items = await tx
                .select()
                .from(recordChecklistItems)
                .where(and(eq(recordChecklistItems.tenantId, tenantId), inArray(recordChecklistItems.recordId, chunk)))
                .orderBy(asc(recordChecklistItems.position), asc(recordChecklistItems.id));
            const byList = new Map<number, ChecklistItem[]>();
            for (const it of items) byList.set(it.checklistId, [...(byList.get(it.checklistId) ?? []), toItem(it)]);
            for (const c of lists) out.set(c.recordId, [...(out.get(c.recordId) ?? []), toChecklist(c, byList.get(c.id) ?? [])]);
        }
        return out;
    }

    async findChecklist(tx: Tx, tenantId: number, id: number): Promise<RecordChecklistRow | null> {
        const [row] = await tx
            .select()
            .from(recordChecklists)
            .where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.id, id)))
            .limit(1);
        return row ?? null;
    }

    async findItem(tx: Tx, tenantId: number, id: number): Promise<RecordChecklistItemRow | null> {
        const [row] = await tx
            .select()
            .from(recordChecklistItems)
            .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.id, id)))
            .limit(1);
        return row ?? null;
    }

    async countChecklists(tx: Tx, tenantId: number, recordId: number): Promise<number> {
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(recordChecklists)
            .where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.recordId, recordId)));
        return row?.n ?? 0;
    }

    async insertChecklist(
        tx: Tx,
        values: { tenantId: number; listId: number; recordId: number; name: string; createdBy: number | null },
    ): Promise<RecordChecklistRow> {
        const [last] = await tx
            .select({ p: sql<number>`coalesce(max(${recordChecklists.position}), -1)::int` })
            .from(recordChecklists)
            .where(and(eq(recordChecklists.tenantId, values.tenantId), eq(recordChecklists.recordId, values.recordId)));
        const [row] = await tx
            .insert(recordChecklists)
            .values({ ...values, position: (last?.p ?? -1) + 1 })
            .returning();
        if (!row) throw new Error('Insert de checklist no devolvió fila');
        return row;
    }

    /**
     * Inserta ítems en un checklist: al final, o debajo de `afterId`
     * (renumerando lo que sigue). Devuelve las filas nuevas en orden.
     */
    async insertItems(
        tx: Tx,
        cl: Pick<RecordChecklistRow, 'id' | 'tenantId' | 'listId' | 'recordId'>,
        items: NewChecklistItem[],
        createdBy: number | null,
        afterId: number | null = null,
    ): Promise<RecordChecklistItemRow[]> {
        if (items.length === 0) return [];
        const current = await tx
            .select({ id: recordChecklistItems.id })
            .from(recordChecklistItems)
            .where(and(eq(recordChecklistItems.tenantId, cl.tenantId), eq(recordChecklistItems.checklistId, cl.id)))
            .orderBy(asc(recordChecklistItems.position), asc(recordChecklistItems.id));
        const at = afterId === null ? current.length : Math.max(0, current.findIndex((c) => c.id === afterId) + 1) || current.length;
        const now = new Date();
        const inserted = await tx
            .insert(recordChecklistItems)
            .values(
                items.map((it, i) => ({
                    tenantId: cl.tenantId,
                    listId: cl.listId,
                    recordId: cl.recordId,
                    checklistId: cl.id,
                    text: it.text,
                    done: it.done === true,
                    doneAt: it.done === true ? now : null,
                    doneBy: it.done === true ? createdBy : null,
                    assigneeId: it.assigneeId,
                    ...dueColumns(it.due),
                    position: at + i,
                    createdBy,
                })),
            )
            .returning();
        // Lo que estaba después del punto de inserción se corre.
        const after = current.slice(at);
        for (const [i, c] of after.entries()) {
            await tx
                .update(recordChecklistItems)
                .set({ position: at + items.length + i })
                .where(and(eq(recordChecklistItems.tenantId, cl.tenantId), eq(recordChecklistItems.id, c.id)));
        }
        return inserted.sort((a, b) => a.position - b.position);
    }

    async updateItem(
        tx: Tx,
        tenantId: number,
        id: number,
        patch: Partial<{
            text: string;
            done: boolean;
            doneBy: number | null;
            doneAt: Date | null;
            assigneeId: number | null;
            due: string | null;
            checklistId: number;
            position: number;
        }>,
    ): Promise<RecordChecklistItemRow | null> {
        const { due, ...rest } = patch;
        const [row] = await tx
            .update(recordChecklistItems)
            .set({ ...rest, ...(due !== undefined ? dueColumns(due) : {}), updatedAt: new Date() })
            .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.id, id)))
            .returning();
        return row ?? null;
    }

    async renameChecklist(tx: Tx, tenantId: number, id: number, name: string): Promise<void> {
        await tx
            .update(recordChecklists)
            .set({ name, updatedAt: new Date() })
            .where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.id, id)));
    }

    async deleteItem(tx: Tx, tenantId: number, id: number): Promise<void> {
        await tx.delete(recordChecklistItems).where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.id, id)));
    }

    async deleteChecklist(tx: Tx, tenantId: number, id: number): Promise<number> {
        const [n] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(recordChecklistItems)
            .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.checklistId, id)));
        await tx.delete(recordChecklists).where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.id, id)));
        return n?.n ?? 0;
    }

    /** Fija el orden de los ítems de un checklist (los que no vienen van al final). */
    async reorderItems(tx: Tx, tenantId: number, checklistId: number, ids: number[]): Promise<void> {
        const current = await tx
            .select({ id: recordChecklistItems.id })
            .from(recordChecklistItems)
            .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.checklistId, checklistId)))
            .orderBy(asc(recordChecklistItems.position), asc(recordChecklistItems.id));
        const known = new Set(current.map((c) => c.id));
        const order = [...ids.filter((id) => known.has(id)), ...current.map((c) => c.id).filter((id) => !ids.includes(id))];
        for (const [i, id] of order.entries()) {
            await tx
                .update(recordChecklistItems)
                .set({ position: i })
                .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.id, id)));
        }
    }

    async reorderChecklists(tx: Tx, tenantId: number, recordId: number, ids: number[]): Promise<void> {
        const current = await tx
            .select({ id: recordChecklists.id })
            .from(recordChecklists)
            .where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.recordId, recordId)))
            .orderBy(asc(recordChecklists.position), asc(recordChecklists.id));
        const known = new Set(current.map((c) => c.id));
        const order = [...ids.filter((id) => known.has(id)), ...current.map((c) => c.id).filter((id) => !ids.includes(id))];
        for (const [i, id] of order.entries()) {
            await tx
                .update(recordChecklists)
                .set({ position: i })
                .where(and(eq(recordChecklists.tenantId, tenantId), eq(recordChecklists.id, id)));
        }
    }

    /** Siguiente posición al final de un checklist. */
    async nextItemPosition(tx: Tx, tenantId: number, checklistId: number): Promise<number> {
        const [row] = await tx
            .select({ p: sql<number>`coalesce(max(${recordChecklistItems.position}), -1)::int` })
            .from(recordChecklistItems)
            .where(and(eq(recordChecklistItems.tenantId, tenantId), eq(recordChecklistItems.checklistId, checklistId)));
        return (row?.p ?? -1) + 1;
    }

    /**
     * Progreso (hechos / total) de los checklists de una tanda de registros,
     * en UNA consulta index-only (regla de oro nº 8). Sólo los que tienen
     * ítems.
     */
    async progressOf(tx: Tx, tenantId: number, recordIds: number[]): Promise<Map<number, ChecklistProgress>> {
        const out = new Map<number, ChecklistProgress>();
        if (recordIds.length === 0) return out;
        for (let i = 0; i < recordIds.length; i += 1000) {
            const chunk = recordIds.slice(i, i + 1000);
            const rows = await tx
                .select({
                    recordId: recordChecklistItems.recordId,
                    total: sql<number>`count(*)::int`,
                    done: sql<number>`(count(*) FILTER (WHERE ${recordChecklistItems.done}))::int`,
                })
                .from(recordChecklistItems)
                .where(and(eq(recordChecklistItems.tenantId, tenantId), inArray(recordChecklistItems.recordId, chunk)))
                .groupBy(recordChecklistItems.recordId);
            for (const r of rows) out.set(r.recordId, { done: r.done, total: r.total });
        }
        return out;
    }
}

/** La fecha de un ítem → columnas (`due_date` sin hora, `due_at` con hora). */
export function dueColumns(due: string | null): { dueDate: string | null; dueAt: Date | null } {
    if (due === null || due === '') return { dueDate: null, dueAt: null };
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return { dueDate: due, dueAt: null };
    const at = new Date(due);
    return Number.isNaN(at.getTime()) ? { dueDate: null, dueAt: null } : { dueDate: null, dueAt: at };
}

export function dueOf(row: Pick<RecordChecklistItemRow, 'dueDate' | 'dueAt'>): string | null {
    if (row.dueAt) return row.dueAt.toISOString();
    return row.dueDate ?? null;
}

export function toItem(row: RecordChecklistItemRow): ChecklistItem {
    return {
        id: row.id,
        checklist_id: row.checklistId,
        text: row.text,
        done: row.done,
        done_by: row.doneBy ?? null,
        done_at: row.doneAt ? row.doneAt.toISOString() : null,
        assignee_id: row.assigneeId ?? null,
        due: dueOf(row),
        position: row.position,
        created_at: row.createdAt.toISOString(),
    };
}

export function toChecklist(row: RecordChecklistRow, items: ChecklistItem[]): Checklist {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        name: row.name,
        position: row.position,
        items,
        created_at: row.createdAt.toISOString(),
    };
}
