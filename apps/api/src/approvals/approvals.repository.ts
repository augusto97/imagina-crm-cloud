import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { approvalDecisions, approvalFlows, approvalRequests, records, type ApprovalDecisionRow, type ApprovalFlowRow, type ApprovalRequestRow } from '../db/schema';

/**
 * C5 — Acceso a datos de las aprobaciones. Todo corre dentro de la
 * transacción con el scope de la empresa (RLS) que abre el service; el
 * `tenant_id` explícito además de la RLS es la costumbre del repo.
 */
@Injectable()
export class ApprovalsRepository {
    // ── Flujos ──────────────────────────────────────────────────────────

    listFlows(tx: Tx, tenantId: number, listId: number): Promise<ApprovalFlowRow[]> {
        return tx
            .select()
            .from(approvalFlows)
            .where(and(eq(approvalFlows.tenantId, tenantId), eq(approvalFlows.listId, listId)))
            .orderBy(asc(approvalFlows.position), asc(approvalFlows.id));
    }

    async findFlow(tx: Tx, tenantId: number, id: number): Promise<ApprovalFlowRow | null> {
        const [row] = await tx
            .select()
            .from(approvalFlows)
            .where(and(eq(approvalFlows.tenantId, tenantId), eq(approvalFlows.id, id)))
            .limit(1);
        return row ?? null;
    }

    async insertFlow(tx: Tx, values: typeof approvalFlows.$inferInsert): Promise<ApprovalFlowRow> {
        const [row] = await tx.insert(approvalFlows).values(values).returning();
        if (!row) throw new Error('El alta del flujo no devolvió fila');
        return row;
    }

    async updateFlow(tx: Tx, tenantId: number, id: number, patch: Partial<typeof approvalFlows.$inferInsert>): Promise<ApprovalFlowRow | null> {
        const [row] = await tx
            .update(approvalFlows)
            .set({ ...patch, updatedAt: sql`now()` as unknown as Date })
            .where(and(eq(approvalFlows.tenantId, tenantId), eq(approvalFlows.id, id)))
            .returning();
        return row ?? null;
    }

    async deleteFlow(tx: Tx, tenantId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(approvalFlows)
            .where(and(eq(approvalFlows.tenantId, tenantId), eq(approvalFlows.id, id)))
            .returning({ id: approvalFlows.id });
        return rows.length > 0;
    }

    async nextFlowPosition(tx: Tx, tenantId: number, listId: number): Promise<number> {
        const [row] = await tx
            .select({ n: sql<number>`coalesce(max(${approvalFlows.position}), -1)::int + 1` })
            .from(approvalFlows)
            .where(and(eq(approvalFlows.tenantId, tenantId), eq(approvalFlows.listId, listId)));
        return row?.n ?? 0;
    }

    /** Pendientes por flujo (para avisar antes de borrar o cambiar). */
    async pendingCountsByFlow(tx: Tx, tenantId: number, flowIds: number[]): Promise<Map<number, number>> {
        const out = new Map<number, number>();
        if (flowIds.length === 0) return out;
        const rows = await tx
            .select({ flowId: approvalRequests.flowId, n: sql<number>`count(*)::int` })
            .from(approvalRequests)
            .innerJoin(records, and(eq(records.id, approvalRequests.recordId), isNull(records.deletedAt)))
            .where(and(eq(approvalRequests.tenantId, tenantId), inArray(approvalRequests.flowId, flowIds), eq(approvalRequests.status, 'pending')))
            .groupBy(approvalRequests.flowId);
        for (const r of rows) if (r.flowId !== null) out.set(r.flowId, r.n);
        return out;
    }

    // ── Solicitudes ─────────────────────────────────────────────────────

    async insertRequest(tx: Tx, values: typeof approvalRequests.$inferInsert): Promise<ApprovalRequestRow> {
        const [row] = await tx.insert(approvalRequests).values(values).returning();
        if (!row) throw new Error('El alta de la solicitud no devolvió fila');
        return row;
    }

    async findRequest(tx: Tx, tenantId: number, id: number): Promise<ApprovalRequestRow | null> {
        const [row] = await tx
            .select()
            .from(approvalRequests)
            .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id)))
            .limit(1);
        return row ?? null;
    }

    /**
     * La solicitud CON candado de fila: dos decisiones a la vez sobre la misma
     * solicitud se ponen en fila (la segunda ve lo que dejó la primera).
     */
    async lockRequest(tx: Tx, tenantId: number, id: number): Promise<ApprovalRequestRow | null> {
        const [row] = await tx
            .select()
            .from(approvalRequests)
            .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id)))
            .for('update')
            .limit(1);
        return row ?? null;
    }

    async updateRequest(tx: Tx, tenantId: number, id: number, patch: Partial<typeof approvalRequests.$inferInsert>): Promise<void> {
        await tx
            .update(approvalRequests)
            .set({ ...patch, updatedAt: sql`now()` as unknown as Date })
            .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id)));
    }

    /** Las solicitudes de un registro, de la más nueva a la más vieja. */
    forRecord(tx: Tx, tenantId: number, recordId: number, limit = 30): Promise<ApprovalRequestRow[]> {
        return tx
            .select()
            .from(approvalRequests)
            .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.recordId, recordId)))
            .orderBy(desc(approvalRequests.id))
            .limit(limit);
    }

    /** La pendiente de un registro para un flujo (o cualquiera si `flowId` es null). */
    async pendingFor(tx: Tx, tenantId: number, recordId: number, flowId: number | null): Promise<ApprovalRequestRow | null> {
        const [row] = await tx
            .select()
            .from(approvalRequests)
            .where(
                and(
                    eq(approvalRequests.tenantId, tenantId),
                    eq(approvalRequests.recordId, recordId),
                    eq(approvalRequests.status, 'pending'),
                    flowId !== null ? eq(approvalRequests.flowId, flowId) : undefined,
                ),
            )
            .orderBy(desc(approvalRequests.id))
            .limit(1);
        return row ?? null;
    }

    /** La última solicitud de un registro para un flujo (cualquier estado). */
    async latestFor(tx: Tx, tenantId: number, recordId: number, flowId: number | null): Promise<ApprovalRequestRow | null> {
        const [row] = await tx
            .select()
            .from(approvalRequests)
            .where(
                and(
                    eq(approvalRequests.tenantId, tenantId),
                    eq(approvalRequests.recordId, recordId),
                    flowId !== null ? eq(approvalRequests.flowId, flowId) : undefined,
                ),
            )
            .orderBy(desc(approvalRequests.id))
            .limit(1);
        return row ?? null;
    }

    /** Cancela las pendientes de un flujo (al borrarlo). Devuelve las canceladas. */
    cancelPendingOfFlow(tx: Tx, tenantId: number, flowId: number, reason: string): Promise<Array<{ id: number; listId: number; recordId: number }>> {
        return tx
            .update(approvalRequests)
            .set({ status: 'cancelled', reason, resolvedAt: sql`now()` as unknown as Date, updatedAt: sql`now()` as unknown as Date })
            .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.flowId, flowId), eq(approvalRequests.status, 'pending')))
            .returning({ id: approvalRequests.id, listId: approvalRequests.listId, recordId: approvalRequests.recordId });
    }

    /** Las que pidió una persona: pendientes y las resueltas desde `since`. */
    requestedBy(tx: Tx, tenantId: number, userId: number, since: Date, limit: number): Promise<ApprovalRequestRow[]> {
        return tx
            .select()
            .from(approvalRequests)
            .innerJoin(records, and(eq(records.id, approvalRequests.recordId), isNull(records.deletedAt)))
            .where(
                and(
                    eq(approvalRequests.tenantId, tenantId),
                    eq(approvalRequests.requestedBy, userId),
                    or(eq(approvalRequests.status, 'pending'), gt(approvalRequests.resolvedAt, since)),
                ),
            )
            .orderBy(desc(approvalRequests.id))
            .limit(limit)
            .then((rows) => rows.map((r) => r.approval_requests));
    }

    // ── Decisiones ──────────────────────────────────────────────────────

    async insertDecision(tx: Tx, values: typeof approvalDecisions.$inferInsert): Promise<ApprovalDecisionRow> {
        const [row] = await tx.insert(approvalDecisions).values(values).returning();
        if (!row) throw new Error('El alta de la decisión no devolvió fila');
        return row;
    }

    decisionsFor(tx: Tx, tenantId: number, requestIds: number[]): Promise<ApprovalDecisionRow[]> {
        if (requestIds.length === 0) return Promise.resolve([]);
        return tx
            .select()
            .from(approvalDecisions)
            .where(and(eq(approvalDecisions.tenantId, tenantId), inArray(approvalDecisions.requestId, requestIds)))
            .orderBy(asc(approvalDecisions.id));
    }
}
