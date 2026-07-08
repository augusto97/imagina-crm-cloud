import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
    CommentDto,
    CommentKind,
    CreateCommentInput,
    UpdateCommentInput,
} from '@imagina-base/shared';
import { RealtimeService } from '../realtime/realtime.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { CommentsRepository, type CommentRow } from './comments.repository';

@Injectable()
export class CommentsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: CommentsRepository,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
    ) {}

    async list(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
    ): Promise<CommentDto[]> {
        await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByRecord(tx, tenantId, recordId),
        );
        return rows.map(toComment);
    }

    async create(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        input: CreateCommentInput,
    ): Promise<CommentDto> {
        const listId = await this.resolveRecord(tenantId, actor, listIdOrSlug, recordId);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (input.parent_id !== undefined) {
                const parent = await this.repo.findById(tx, tenantId, input.parent_id);
                if (!parent || parent.recordId !== recordId) {
                    throw new BadRequestException({
                        code: 'invalid_parent',
                        message: 'El comentario padre no pertenece a este record',
                        data: { status: 400, errors: { parent_id: 'Inválido' } },
                    });
                }
            }
            return this.repo.insert(tx, {
                tenantId,
                listId,
                recordId,
                userId: actor.userId,
                body: input.body,
                kind: input.kind,
                parentId: input.parent_id ?? null,
                metadata: input.metadata ?? {},
            });
        });
        this.realtime.records(tenantId, listId); // el drawer del record re-fetchea
        return toComment(row);
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
            const updated = await this.repo.update(tx, tenantId, id, changes);
            if (!updated) throw commentNotFound(id);
            return updated;
        });
        this.realtime.records(tenantId, listId);
        return toComment(row);
    }

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

function toComment(row: CommentRow): CommentDto {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        body: row.body,
        kind: row.kind as CommentKind,
        parent_id: row.parentId,
        metadata: row.metadata,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function commentNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'comment_not_found',
        message: `Comentario ${id} no encontrado`,
        data: { status: 404 },
    });
}
