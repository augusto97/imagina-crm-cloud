import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { activity } from '../db/schema';

export type ActivityRow = typeof activity.$inferSelect;

@Injectable()
export class ActivityRepository {
    /** Append de una entrada de actividad (dentro del tx de la mutación). */
    async log(tx: Tx, values: typeof activity.$inferInsert): Promise<void> {
        await tx.insert(activity).values(values);
    }

    /** Log por lista (o por record si se pasa recordId), keyset desc por id. */
    list(
        tx: Tx,
        tenantId: number,
        listId: number,
        opts: { recordId?: number; cursor?: number; limit: number },
    ): Promise<ActivityRow[]> {
        return tx
            .select()
            .from(activity)
            .where(
                and(
                    eq(activity.tenantId, tenantId),
                    eq(activity.listId, listId),
                    opts.recordId !== undefined ? eq(activity.recordId, opts.recordId) : undefined,
                    opts.cursor !== undefined ? lt(activity.id, opts.cursor) : undefined,
                ),
            )
            .orderBy(desc(activity.id))
            .limit(opts.limit);
    }
}
