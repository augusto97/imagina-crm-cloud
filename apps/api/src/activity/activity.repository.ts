import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
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

    /** La última entrada de un registro (para juntar ediciones seguidas). */
    async latestForRecord(tx: Tx, tenantId: number, recordId: number): Promise<typeof activity.$inferSelect | null> {
        const [row] = await tx
            .select()
            .from(activity)
            .where(and(eq(activity.tenantId, tenantId), eq(activity.recordId, recordId)))
            .orderBy(desc(activity.id))
            .limit(1);
        return row ?? null;
    }

    /** Reescribe el diff de una entrada y la trae al presente. */
    async rewrite(tx: Tx, tenantId: number, id: number, diff: Record<string, unknown>): Promise<void> {
        await tx
            .update(activity)
            .set({ diff, createdAt: new Date() })
            .where(and(eq(activity.tenantId, tenantId), eq(activity.id, id)));
    }

    /**
     * v0.1.288 — Los cambios de UN campo de un registro (`diff ? 'fN'`), de lo
     * más nuevo a lo más viejo, keyset por id. Recorre el índice
     * `(tenant_id, record_id, id DESC)` y corta en el LIMIT: no lee el
     * historial entero del registro.
     */
    fieldHistory(
        tx: Tx,
        tenantId: number,
        listId: number,
        recordId: number,
        key: string,
        opts: { cursor?: number; limit: number },
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
                    eq(activity.recordId, recordId),
                    eq(activity.listId, listId),
                    // `?` de jsonb con la clave bindeada (jamás interpolada).
                    sql`${activity.diff} ? ${key}`,
                    opts.cursor !== undefined ? lt(activity.id, opts.cursor) : undefined,
                ),
            )
            .orderBy(desc(activity.id))
            .limit(opts.limit);
    }

    /** Log por lista (o por record si se pasa recordId), keyset desc por id. */
    list(
        tx: Tx,
        tenantId: number,
        listId: number,
        opts: { recordId?: number; cursor?: number; limit: number; where?: SQL },
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
                    opts.where,
                ),
            )
            .orderBy(desc(activity.id))
            .limit(opts.limit);
    }
}
