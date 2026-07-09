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
