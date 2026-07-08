import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { comments } from '../db/schema';

export type CommentRow = typeof comments.$inferSelect;

@Injectable()
export class CommentsRepository {
    listByRecord(tx: Tx, tenantId: number, recordId: number): Promise<CommentRow[]> {
        return tx
            .select()
            .from(comments)
            .where(
                and(
                    eq(comments.tenantId, tenantId),
                    eq(comments.recordId, recordId),
                    isNull(comments.deletedAt),
                ),
            )
            .orderBy(asc(comments.id));
    }

    async findById(tx: Tx, tenantId: number, id: number): Promise<CommentRow | null> {
        const [row] = await tx
            .select()
            .from(comments)
            .where(
                and(eq(comments.tenantId, tenantId), eq(comments.id, id), isNull(comments.deletedAt)),
            )
            .limit(1);
        return row ?? null;
    }

    async insert(tx: Tx, values: typeof comments.$inferInsert): Promise<CommentRow> {
        const [row] = await tx.insert(comments).values(values).returning();
        if (!row) throw new Error('Insert de comentario no devolvió fila');
        return row;
    }

    async update(
        tx: Tx,
        tenantId: number,
        id: number,
        patch: Partial<typeof comments.$inferInsert>,
    ): Promise<CommentRow | null> {
        const [row] = await tx
            .update(comments)
            .set({ ...patch, updatedAt: sql`now()` })
            .where(
                and(eq(comments.tenantId, tenantId), eq(comments.id, id), isNull(comments.deletedAt)),
            )
            .returning();
        return row ?? null;
    }

    async softDelete(tx: Tx, tenantId: number, id: number): Promise<boolean> {
        const rows = await tx
            .update(comments)
            .set({ deletedAt: sql`now()` })
            .where(
                and(eq(comments.tenantId, tenantId), eq(comments.id, id), isNull(comments.deletedAt)),
            )
            .returning({ id: comments.id });
        return rows.length > 0;
    }
}
