import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
    CommentDto,
    CommentKind,
    CommentReactionEmoji,
    CommentReactionSummary,
    CreateCommentInput,
    UpdateCommentInput,
} from '@imagina-base/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { memberships, mentions, recordFollows, users } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { CommentsRepository, type CommentRow } from './comments.repository';
import { NotifyHub } from '../notifications/notify-hub';

@Injectable()
export class CommentsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: CommentsRepository,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
        // v0.1.276 — avisos (mención y comentario en un registro que se sigue).
        @Optional() private readonly notify?: NotifyHub,
    ) {}

    async list(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
    ): Promise<CommentDto[]> {
        await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);
        return this.tenantDb.withTenant(tenantId, (tx) => this.listInTx(tx, tenantId, recordId));
    }

    /**
     * Comentarios de un registro YA autorizado (el llamador verificó que la
     * persona lo ve). Lo usa el bundle de la ficha para no repetir el chequeo.
     */
    async listInTx(tx: Tx, tenantId: number, recordId: number, limit?: number): Promise<CommentDto[]> {
        const rows = await this.repo.listByRecordWithAuthor(tx, tenantId, recordId, limit);
        const clients = await this.clientAuthors(tx, tenantId, rows);
        // v0.1.291 — las reacciones de toda la tanda en una query.
        const reactions = await this.repo.reactionsFor(
            tx,
            tenantId,
            rows.filter((r) => r.deletedAt === null).map((r) => r.id),
        );
        return rows.map((r) => toComment(r, r.userName, clients.get(r.userId), reactions.get(r.id)));
    }

    /**
     * Autores de los comentarios que son CLIENTES del portal (no miembros del
     * equipo): el equipo los ve marcados y con su nombre (el directorio de
     * miembros no los tiene).
     */
    private async clientAuthors(tx: Tx, tenantId: number, rows: CommentRow[]): Promise<Map<number, string>> {
        const ids = [...new Set(rows.filter((r) => r.visibility === 'client').map((r) => r.userId))];
        if (ids.length === 0) return new Map();
        const found = await tx
            .select({ id: users.id, name: users.name, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'client'), inArray(memberships.userId, ids)));
        return new Map(found.map((u) => [u.id, (u.name || u.email || '').trim()]));
    }

    async create(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        input: CreateCommentInput,
    ): Promise<CommentDto> {
        const listId = await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);

        let mentioned: number[] = [];
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // v0.1.291 — hilos de UN nivel: responder a una respuesta cuelga
            // del mismo raíz, y la respuesta HEREDA la visibilidad del raíz
            // (una respuesta a algo interno jamás llega al portal).
            let root: CommentRow | null = null;
            if (input.parent_id !== undefined) {
                root = await this.threadRoot(tx, tenantId, recordId, input.parent_id);
            }
            const row = await this.repo.insert(tx, {
                tenantId,
                listId,
                recordId,
                userId: actor.userId,
                body: input.body,
                kind: input.kind,
                parentId: root?.id ?? null,
                metadata: input.metadata ?? {},
                visibility: root ? (root.visibility === 'client' ? 'client' : 'internal') : (input.visibility ?? 'internal'),
            });
            // Menciones @login: se extraen y persisten en el mismo tx.
            mentioned = await this.storeMentions(tx, tenantId, row);
            // Comentar te suscribe al registro (ADR-S40) — en el MISMO tx, no
            // después: el aviso de `NotifyHub` corre en segundo plano y el
            // botón «Seguir» de la ficha releía el estado antes de que llegara
            // (v0.1.286). El hub lo repite y no pasa nada (conflict → nada).
            if (actor.role !== 'client') {
                await tx
                    .insert(recordFollows)
                    .values({ tenantId, userId: actor.userId, listId, recordId })
                    .onConflictDoNothing();
            }
            return { row, name: await this.repo.authorNameOf(tx, actor.userId) };
        });
        this.realtime.records(tenantId, listId); // el drawer del record re-fetchea
        // `visibility: client` → además del aviso al equipo, el portal le manda
        // un correo al cliente del registro (si no lo apagó).
        this.notify?.emit({
            type: 'comment',
            tenantId,
            listId,
            recordId,
            actorId: actor.userId,
            body: row.row.body,
            mentioned,
            commentId: row.row.id,
            visibility: row.row.visibility === 'client' ? 'client' : 'internal',
            ...(row.row.parentId !== null ? { parentId: row.row.parentId } : {}),
        });
        return toComment(row.row, row.name);
    }

    /**
     * El raíz del hilo al que se responde. Si el padre ya es una respuesta, el
     * raíz es SU padre (un solo nivel). Tiene que ser de este registro; un raíz
     * eliminado sólo acepta respuestas mientras su hilo siga vivo.
     */
    private async threadRoot(tx: Tx, tenantId: number, recordId: number, parentId: number): Promise<CommentRow> {
        const invalid = (): BadRequestException =>
            new BadRequestException({
                code: 'invalid_parent',
                message: 'No se puede responder a ese comentario: no es de este registro o se eliminó.',
                data: { status: 400, errors: { parent_id: 'Inválido' } },
            });
        const parent = await this.repo.findAnyById(tx, tenantId, parentId);
        if (!parent || parent.recordId !== recordId) throw invalid();
        // Se responde a una respuesta (aunque se haya borrado) → cuelga del
        // mismo raíz: los hilos son de un solo nivel.
        const root = parent.parentId === null ? parent : await this.repo.findAnyById(tx, tenantId, parent.parentId);
        if (!root || root.recordId !== recordId) throw invalid();
        // Un raíz borrado sigue aceptando respuestas SÓLO si su hilo está vivo
        // (se ve como «Comentario eliminado» con sus respuestas debajo).
        if (root.deletedAt !== null && !(await this.repo.hasLiveReplies(tx, tenantId, root.id))) throw invalid();
        return root;
    }

    /**
     * v0.1.291 — Pone o quita una reacción (toggle) y devuelve las del
     * comentario. Quien puede comentar puede reaccionar; un comentario
     * eliminado no recibe reacciones.
     */
    async toggleReaction(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        id: number,
        emoji: CommentReactionEmoji,
    ): Promise<{ reactions: CommentReactionSummary[] }> {
        const listId = await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);
        const reactions = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.recordId !== recordId) throw commentNotFound(id);
            await this.repo.toggleReaction(tx, tenantId, id, actor.userId, emoji);
            return (await this.repo.reactionsFor(tx, tenantId, [id])).get(id) ?? [];
        });
        this.realtime.records(tenantId, listId);
        return { reactions };
    }

    async update(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        id: number,
        patch: UpdateCommentInput,
    ): Promise<CommentDto> {
        const listId = await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.recordId !== recordId) throw commentNotFound(id);
            // Sólo el autor edita su comentario (o quien puede editar records).
            if (current.userId !== actor.userId) {
                throw new ForbiddenException('Sólo el autor puede editar el comentario');
            }
            const changes: Partial<typeof import('../db/schema').comments.$inferInsert> = {};
            if (patch.body !== undefined) changes.body = patch.body;
            if (patch.metadata !== undefined) changes.metadata = patch.metadata;
            if (patch.visibility !== undefined) {
                // v0.1.291 — una respuesta no tiene visibilidad propia: es la
                // del comentario original.
                if (current.parentId !== null) {
                    throw new BadRequestException({
                        code: 'reply_visibility',
                        message: 'Una respuesta se ve igual que el comentario al que responde: cambia la visibilidad de ese comentario.',
                        data: { status: 400 },
                    });
                }
                changes.visibility = patch.visibility;
            }
            const updated = await this.repo.update(tx, tenantId, id, changes);
            if (!updated) throw commentNotFound(id);
            if (patch.visibility !== undefined) {
                await this.repo.setRepliesVisibility(tx, tenantId, id, patch.visibility);
            }
            const reactions = (await this.repo.reactionsFor(tx, tenantId, [id])).get(id);
            return { row: updated, name: await this.repo.authorNameOf(tx, updated.userId), reactions };
        });
        this.realtime.records(tenantId, listId);
        return toComment(row.row, row.name, undefined, row.reactions);
    }

    /**
     * Borrar es suave (`deleted_at`). v0.1.291 — si el comentario es un RAÍZ
     * con respuestas vivas, el listado lo sigue mostrando como «Comentario
     * eliminado» (sin texto ni reacciones): borrar lo que otros respondieron
     * no le corresponde a quien escribió el primer mensaje, y el hilo sin su
     * cabeza no se entendería. Cuando se borra la última respuesta, el raíz
     * desaparece solo.
     */
    async remove(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        id: number,
    ): Promise<void> {
        const listId = await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.recordId !== recordId) throw commentNotFound(id);
            if (current.userId !== actor.userId) {
                throw new ForbiddenException('Sólo el autor puede eliminar el comentario');
            }
            await this.repo.softDelete(tx, tenantId, id);
        });
        this.realtime.records(tenantId, listId);
    }

    /** Resuelve la lista y verifica que el record exista/sea visible al actor. */
    /**
     * Extrae los tokens `@login` del body, los matchea contra los emails de
     * los MIEMBROS del workspace (case-insensitive; jamás usuarios ajenos) y
     * persiste una mención por usuario (sin auto-mención, dedupe). El bell
     * (`GET /me/mentions`) las consume; el "no leído" es client-side.
     */
    private async storeMentions(tx: Tx, tenantId: number, row: CommentRow): Promise<number[]> {
        const tokens = Array.from(row.body.matchAll(/@([\w.+-]+@[\w.-]+\.\w+)/g), (m) => m[1]!.toLowerCase());
        const unique = Array.from(new Set(tokens));
        if (unique.length === 0) return [];
        const members = await tx
            .select({ userId: memberships.userId, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(
                and(
                    eq(memberships.tenantId, tenantId),
                    inArray(sql`lower(${users.email})`, unique),
                ),
            );
        const targets = members.filter((m) => m.userId !== row.userId);
        if (targets.length === 0) return [];
        const snippet = row.body.slice(0, 180);
        await tx.insert(mentions).values(
            targets.map((m) => ({
                tenantId,
                commentId: row.id,
                listId: row.listId,
                recordId: row.recordId,
                mentionedUserId: m.userId,
                authorUserId: row.userId,
                snippet,
            })),
        );
        return targets.map((m) => m.userId);
    }

    private async resolveRecord(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
    ): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        // Reusa la lógica de visibilidad de records (404 si no lo puede ver).
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        return list.id;
    }
}

function toComment(
    row: CommentRow,
    userName: string | null,
    clientName?: string,
    reactions?: CommentReactionSummary[],
): CommentDto {
    const deleted = row.deletedAt !== null;
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        user_name: userName,
        // Un raíz eliminado que conserva sus respuestas viaja SIN su texto.
        body: deleted ? '' : row.body,
        kind: row.kind as CommentKind,
        parent_id: row.parentId,
        metadata: deleted ? {} : row.metadata,
        visibility: row.visibility === 'client' ? 'client' : 'internal',
        from_client: clientName !== undefined,
        author_name: clientName ?? null,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        reactions: deleted ? [] : (reactions ?? []),
        deleted,
    };
}

function commentNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'comment_not_found',
        message: `Comentario ${id} no encontrado`,
        data: { status: 404 },
    });
}
