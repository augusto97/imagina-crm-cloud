import { Injectable } from '@nestjs/common';
import { COMMENT_REACTION_EMOJIS, type CommentReactionEmoji, type CommentReactionSummary } from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { commentReactions, comments, users } from '../db/schema';

export type CommentRow = typeof comments.$inferSelect;
/** Comentario + el nombre visible de su autor (leftJoin, como la actividad). */
export type CommentWithAuthorRow = CommentRow & { userName: string | null };

/** Nombre visible: el nombre, o el email si la cuenta no tiene nombre. */
const authorName = sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`;

/**
 * v0.1.291 — Un comentario RAÍZ borrado se sigue listando (como «Comentario
 * eliminado») mientras tenga alguna respuesta viva: el hilo no queda huérfano.
 * Sin respuestas, desaparece como siempre.
 */
const visibleOrThreadAnchor: SQL = or(
    isNull(comments.deletedAt),
    and(
        isNull(comments.parentId),
        sql`EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = ${comments.id} AND r.deleted_at IS NULL)`,
    ),
)!;

/** Lo que pide la UI para pintar las reacciones de una tanda de comentarios. */
export type ReactionsByComment = Map<number, CommentReactionSummary[]>;

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
                visibility: comments.visibility,
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
                    visibleOrThreadAnchor,
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

    /**
     * La conversación que ve el CLIENTE en su portal: sólo los comentarios
     * marcados visibles para él (los suyos lo son siempre).
     *
     * v0.1.291 — una RESPUESTA hereda la visibilidad de su raíz al escribirse
     * (y se actualiza si el raíz cambia), pero se exige igual que el raíz sea
     * visible: aunque una fila vieja quedara marcada `client`, una respuesta a
     * un comentario interno jamás llega al portal.
     */
    listClientVisible(tx: Tx, tenantId: number, recordId: number, limit = 200): Promise<CommentRow[]> {
        return tx
            .select()
            .from(comments)
            .where(
                and(
                    eq(comments.tenantId, tenantId),
                    eq(comments.recordId, recordId),
                    eq(comments.visibility, 'client'),
                    visibleOrThreadAnchor,
                    or(
                        isNull(comments.parentId),
                        sql`EXISTS (SELECT 1 FROM comments p WHERE p.id = ${comments.parentId} AND p.visibility = 'client')`,
                    ),
                ),
            )
            .orderBy(asc(comments.id))
            .limit(Math.min(Math.max(limit, 1), 500));
    }

    /**
     * Reacciones de una tanda de comentarios en UNA query (regla de oro nº 8),
     * agrupadas por emoji en el orden del set curado, con el nombre de quién.
     */
    async reactionsFor(tx: Tx, tenantId: number, commentIds: number[]): Promise<ReactionsByComment> {
        const out: ReactionsByComment = new Map();
        if (commentIds.length === 0) return out;
        const rows = await tx
            .select({
                commentId: commentReactions.commentId,
                emoji: commentReactions.emoji,
                userId: commentReactions.userId,
                name: authorName,
            })
            .from(commentReactions)
            .leftJoin(users, eq(users.id, commentReactions.userId))
            .where(and(eq(commentReactions.tenantId, tenantId), inArray(commentReactions.commentId, commentIds)))
            .orderBy(asc(commentReactions.id));
        const grouped = new Map<number, Map<string, { ids: number[]; names: string[] }>>();
        for (const r of rows) {
            const byEmoji = grouped.get(r.commentId) ?? new Map<string, { ids: number[]; names: string[] }>();
            const bucket = byEmoji.get(r.emoji) ?? { ids: [], names: [] };
            bucket.ids.push(r.userId);
            bucket.names.push((r.name ?? '').trim() || `Usuario #${r.userId}`);
            byEmoji.set(r.emoji, bucket);
            grouped.set(r.commentId, byEmoji);
        }
        for (const [commentId, byEmoji] of grouped) {
            const list: CommentReactionSummary[] = [];
            for (const emoji of COMMENT_REACTION_EMOJIS) {
                const b = byEmoji.get(emoji);
                if (b) list.push({ emoji, count: b.ids.length, user_ids: b.ids, user_names: b.names });
            }
            out.set(commentId, list);
        }
        return out;
    }

    /**
     * Pone o quita la reacción de una persona (toggle). Devuelve si quedó
     * puesta. La unicidad (comentario, persona, emoji) la garantiza el índice:
     * dos toques simultáneos no duplican.
     */
    async toggleReaction(
        tx: Tx,
        tenantId: number,
        commentId: number,
        userId: number,
        emoji: CommentReactionEmoji,
    ): Promise<boolean> {
        const removed = await tx
            .delete(commentReactions)
            .where(
                and(
                    eq(commentReactions.tenantId, tenantId),
                    eq(commentReactions.commentId, commentId),
                    eq(commentReactions.userId, userId),
                    eq(commentReactions.emoji, emoji),
                ),
            )
            .returning({ id: commentReactions.id });
        if (removed.length > 0) return false;
        await tx.insert(commentReactions).values({ tenantId, commentId, userId, emoji }).onConflictDoNothing();
        return true;
    }

    /** La visibilidad de un raíz alcanza a sus respuestas (nunca quedan más abiertas que él). */
    async setRepliesVisibility(tx: Tx, tenantId: number, rootId: number, visibility: 'internal' | 'client'): Promise<void> {
        await tx
            .update(comments)
            .set({ visibility })
            .where(and(eq(comments.tenantId, tenantId), eq(comments.parentId, rootId)));
    }

    /**
     * v0.1.291 — Un comentario aunque esté borrado (para continuar un hilo cuyo
     * raíz quedó como «Comentario eliminado»).
     */
    async findAnyById(tx: Tx, tenantId: number, id: number): Promise<CommentRow | null> {
        const [row] = await tx
            .select()
            .from(comments)
            .where(and(eq(comments.tenantId, tenantId), eq(comments.id, id)))
            .limit(1);
        return row ?? null;
    }

    /** ¿Tiene respuestas vivas? (un raíz borrado sigue siendo un hilo). */
    async hasLiveReplies(tx: Tx, tenantId: number, id: number): Promise<boolean> {
        const [row] = await tx
            .select({ id: comments.id })
            .from(comments)
            .where(and(eq(comments.tenantId, tenantId), eq(comments.parentId, id), isNull(comments.deletedAt)))
            .limit(1);
        return row !== undefined;
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
