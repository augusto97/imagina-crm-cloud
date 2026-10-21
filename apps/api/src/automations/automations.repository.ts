import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { automationRuns, automations } from '../db/schema';

export type AutomationRow = typeof automations.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;

@Injectable()
export class AutomationsRepository {
    listByList(tx: Tx, tenantId: number, listId: number): Promise<AutomationRow[]> {
        return tx
            .select()
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.listId, listId)))
            .orderBy(desc(automations.id));
    }

    async findById(tx: Tx, tenantId: number, id: number): Promise<AutomationRow | null> {
        const [row] = await tx
            .select()
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.id, id)))
            .limit(1);
        return row ?? null;
    }

    /** Automatizaciones activas de una lista cuyo trigger_type está en la lista dada. */
    async activeByTriggers(
        tx: Tx,
        tenantId: number,
        listId: number,
        triggerTypes: string[],
    ): Promise<AutomationRow[]> {
        return tx
            .select()
            .from(automations)
            .where(
                and(
                    eq(automations.tenantId, tenantId),
                    eq(automations.listId, listId),
                    eq(automations.isActive, true),
                    inArray(automations.triggerType, triggerTypes),
                ),
            );
    }

    async insert(tx: Tx, values: typeof automations.$inferInsert): Promise<AutomationRow> {
        const [row] = await tx.insert(automations).values(values).returning();
        if (!row) throw new Error('Insert de automation no devolvió fila');
        return row;
    }

    async update(
        tx: Tx,
        tenantId: number,
        id: number,
        patch: Partial<typeof automations.$inferInsert>,
    ): Promise<AutomationRow | null> {
        const [row] = await tx
            .update(automations)
            .set({ ...patch, updatedAt: sql`now()` })
            .where(and(eq(automations.tenantId, tenantId), eq(automations.id, id)))
            .returning();
        return row ?? null;
    }

    async remove(tx: Tx, tenantId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.id, id)))
            .returning({ id: automations.id });
        return rows.length > 0;
    }

    async logRun(tx: Tx, values: typeof automationRuns.$inferInsert): Promise<void> {
        await tx.insert(automationRuns).values(values);
    }

    /**
     * Abre la corrida en `running` ANTES de ejecutar (se confirma aparte): un
     * escaneo de vencimientos que llega mientras corre no la vuelve a lanzar,
     * y si el proceso se cae a mitad queda a la vista (el mantenimiento la
     * marca como interrumpida). Devuelve null si la automatización ya no existe.
     */
    async startRun(
        tx: Tx,
        values: { tenantId: number; automationId: number; recordId: number | null; startedAt: Date },
    ): Promise<number | null> {
        const [row] = await tx
            .insert(automationRuns)
            .values({ ...values, status: 'running', actionsLog: [] })
            .returning({ id: automationRuns.id });
        return row?.id ?? null;
    }

    async finishRun(
        tx: Tx,
        tenantId: number,
        runId: number,
        values: Pick<typeof automationRuns.$inferInsert, 'status' | 'actionsLog' | 'error' | 'finishedAt'>,
    ): Promise<void> {
        await tx
            .update(automationRuns)
            // v0.1.288 — una corrida que termina deja de tener espera pendiente.
            .set({ ...values, resumeAt: null, resumeState: null })
            .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, runId)));
    }

    /**
     * v0.1.288 — La corrida queda en pausa en un «Esperar»: `waiting` con la
     * hora de reanudación y el estado (puntero + contexto). El reloj de las
     * esperas la toma cuando vence.
     */
    async pauseRun(
        tx: Tx,
        tenantId: number,
        runId: number,
        values: { actionsLog: typeof automationRuns.$inferInsert.actionsLog; resumeAt: Date; resumeState: Record<string, unknown>; error: string | null },
    ): Promise<void> {
        await tx
            .update(automationRuns)
            .set({ status: 'waiting', resumedAt: null, finishedAt: null, ...values })
            .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, runId)));
    }

    /**
     * v0.1.288 — Cancela las esperas de una automatización (al pausarla) o
     * una sola (`runId`). Devuelve cuántas canceló.
     */
    async cancelWaiting(
        tx: Tx,
        tenantId: number,
        automationId: number,
        reason: string,
        runId?: number,
    ): Promise<number> {
        const rows = await tx
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
                    eq(automationRuns.automationId, automationId),
                    eq(automationRuns.status, 'waiting'),
                    runId !== undefined ? eq(automationRuns.id, runId) : undefined,
                ),
            )
            .returning({ id: automationRuns.id });
        return rows.length;
    }

    listRuns(
        tx: Tx,
        tenantId: number,
        automationId: number,
        opts: { cursor?: number; limit: number },
    ): Promise<AutomationRunRow[]> {
        return tx
            .select()
            .from(automationRuns)
            .where(
                and(
                    eq(automationRuns.tenantId, tenantId),
                    eq(automationRuns.automationId, automationId),
                    opts.cursor !== undefined ? lt(automationRuns.id, opts.cursor) : undefined,
                ),
            )
            .orderBy(desc(automationRuns.id))
            .limit(opts.limit);
    }
}
