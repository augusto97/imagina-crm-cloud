import { Injectable } from '@nestjs/common';
import type { GanttBaselineItem } from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { ganttBaselineItems, ganttBaselines, users, type GanttBaselineRow } from '../db/schema';

/**
 * B1 — Acceso a `gantt_baselines` + `gantt_baseline_items` (tenant-scoped:
 * RLS + tenant_id explícito en cada consulta).
 */
@Injectable()
export class GanttBaselinesRepository {
    async forView(tx: Tx, tenantId: number, viewId: number): Promise<(GanttBaselineRow & { createdByName: string | null }) | null> {
        const [row] = await tx
            .select({ b: ganttBaselines, name: users.name })
            .from(ganttBaselines)
            .leftJoin(users, eq(users.id, ganttBaselines.createdBy))
            .where(and(eq(ganttBaselines.tenantId, tenantId), eq(ganttBaselines.viewId, viewId)))
            .limit(1);
        return row ? { ...row.b, createdByName: row.name ?? null } : null;
    }

    /** Guardar otra línea base REEMPLAZA a la anterior (una por vista). */
    async replace(
        tx: Tx,
        values: typeof ganttBaselines.$inferInsert,
        items: Array<{ recordId: number; start: string | null; end: string | null }>,
    ): Promise<GanttBaselineRow> {
        await tx
            .delete(ganttBaselines)
            .where(and(eq(ganttBaselines.tenantId, values.tenantId), eq(ganttBaselines.viewId, values.viewId)));
        const [row] = await tx.insert(ganttBaselines).values({ ...values, itemCount: items.length }).returning();
        if (!row) throw new Error('Insert de línea base no devolvió fila');
        // En tandas: un INSERT con miles de filas por tanda, no uno por registro.
        for (let i = 0; i < items.length; i += 1000) {
            const chunk = items.slice(i, i + 1000);
            await tx.insert(ganttBaselineItems).values(
                chunk.map((it) => ({
                    tenantId: values.tenantId,
                    baselineId: row.id,
                    recordId: it.recordId,
                    startValue: it.start,
                    endValue: it.end,
                })),
            );
        }
        return row;
    }

    async deleteForView(tx: Tx, tenantId: number, viewId: number): Promise<boolean> {
        const rows = await tx
            .delete(ganttBaselines)
            .where(and(eq(ganttBaselines.tenantId, tenantId), eq(ganttBaselines.viewId, viewId)))
            .returning({ id: ganttBaselines.id });
        return rows.length > 0;
    }

    /** Las fechas congeladas de estos registros (sólo los que se muestran). */
    async itemsFor(tx: Tx, tenantId: number, baselineId: number, recordIds: number[]): Promise<Record<string, GanttBaselineItem>> {
        const out: Record<string, GanttBaselineItem> = {};
        for (let i = 0; i < recordIds.length; i += 1000) {
            const chunk = recordIds.slice(i, i + 1000);
            if (chunk.length === 0) continue;
            const rows = await tx
                .select({ recordId: ganttBaselineItems.recordId, start: ganttBaselineItems.startValue, end: ganttBaselineItems.endValue })
                .from(ganttBaselineItems)
                .where(
                    and(
                        eq(ganttBaselineItems.tenantId, tenantId),
                        eq(ganttBaselineItems.baselineId, baselineId),
                        inArray(ganttBaselineItems.recordId, chunk),
                    ),
                );
            for (const r of rows) out[String(r.recordId)] = { start: r.start, end: r.end };
        }
        return out;
    }
}
