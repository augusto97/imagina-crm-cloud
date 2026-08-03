import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { activity, users } from '../db/schema';

/**
 * Fila de actividad + el NOMBRE de quien la hizo (v0.1.149). El feed mostraba
 * "por usuario #2" porque el DTO sólo traía el id; el nombre se resuelve en la
 * misma query (leftJoin, igual que la bitácora administrativa) para no hacer
 * una request por entrada.
 */
export type ActivityRow = typeof activity.$inferSelect & { userName: string | null };

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
            .select({
                id: activity.id,
                tenantId: activity.tenantId,
                listId: activity.listId,
                recordId: activity.recordId,
                userId: activity.userId,
                action: activity.action,
                diff: activity.diff,
                createdAt: activity.createdAt,
                userName: users.name,
            })
            .from(activity)
            .leftJoin(users, eq(users.id, activity.userId))
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
