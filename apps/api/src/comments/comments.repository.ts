import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { comments, users } from '../db/schema';

export type CommentRow = typeof comments.$inferSelect;
/** Comentario + el nombre visible de su autor (leftJoin, como la actividad). */
export type CommentWithAuthorRow = CommentRow & { userName: string | null };

/** Nombre visible: el nombre, o el email si la cuenta no tiene nombre. */
const authorName = sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`;

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

    /**
     * Igual que `listByRecord` pero con el NOMBRE del autor resuelto en la
     * misma query (sin esto la ficha mostraba "Usuario #2" y hacía una
     * request por autor). `limit` acota el bundle de la ficha (los MÁS
     * NUEVOS, devueltos en orden cronológico).
     */
    async listByRecordWithAuthor(
        tx: Tx,
        tenantId: number,
        recordId: number,
        limit?: number,
    ): Promise<CommentWithAuthorRow[]> {
        const base = tx
            .select({
                id: comments.id,
                tenantId: comments.tenantId,
                listId: comments.listId,
                recordId: comments.recordId,
                userId: comments.userId,
                body: comments.body,
                kind: comments.kind,
                parentId: comments.parentId,
                metadata: comments.metadata,
                createdAt: comments.createdAt,
                updatedAt: comments.updatedAt,
                deletedAt: comments.deletedAt,
                userName: authorName,
            })
            .from(comments)
            .leftJoin(users, eq(users.id, comments.userId))
            .where(
                and(
                    eq(comments.tenantId, tenantId),
                    eq(comments.recordId, recordId),
                    isNull(comments.deletedAt),
                ),
            );
        if (limit === undefined) return base.orderBy(asc(comments.id));
        const newest = await base.orderBy(sql`${comments.id} desc`).limit(limit);
        return newest.reverse();
    }

    /** Nombre visible de una persona (para devolver el comentario recién escrito). */
    async authorNameOf(tx: Tx, userId: number): Promise<string | null> {
        const [row] = await tx.select({ name: authorName }).from(users).where(eq(users.id, userId)).limit(1);
        return row?.name ?? null;
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
