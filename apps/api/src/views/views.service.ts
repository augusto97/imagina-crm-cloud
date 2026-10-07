import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    parseViewConfig,
    type CreateViewInput,
    type UpdateViewInput,
    type View,
    type ViewType,
} from '@imagina-base/shared';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ViewsRepository, type ViewRow } from './views.repository';

@Injectable()
export class ViewsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: ViewsRepository,
        private readonly lists: ListsService,
        private readonly realtime: RealtimeService,
    ) {}

    async list(tenantId: number, listIdOrSlug: string): Promise<View[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, listId),
        );
        return rows.map(toView);
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<View> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, listId, id),
        );
        if (!row) throw viewNotFound(id);
        return toView(row);
    }

    async create(tenantId: number, listIdOrSlug: string, input: CreateViewInput): Promise<View> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const config = safeConfig(input.type, input.config);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const position = await this.repo.nextPosition(tx, tenantId, listId);
            const isDefault = input.is_default ?? false;
            if (isDefault) await this.repo.clearDefault(tx, tenantId, listId);
            return this.repo.insert(tx, {
                tenantId,
                listId,
                name: input.name,
                type: input.type,
                config,
                isDefault,
                position,
                icon: input.icon ?? null,
                color: input.color ?? null,
            });
        });
        this.realtime.views(tenantId, listId);
        return toView(row);
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        id: number,
        patch: UpdateViewInput,
    ): Promise<View> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current) throw viewNotFound(id);

            const changes: Partial<typeof import('../db/schema').savedViews.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.position !== undefined) changes.position = patch.position;
            if (patch.icon !== undefined) changes.icon = patch.icon;
            if (patch.color !== undefined) changes.color = patch.color;
            if (patch.config !== undefined) {
                changes.config = safeConfig(current.type as ViewType, patch.config);
            }
            if (patch.is_default === true) {
                await this.repo.clearDefault(tx, tenantId, listId, current.id);
                changes.isDefault = true;
            } else if (patch.is_default === false) {
                changes.isDefault = false;
            }

            const updated = await this.repo.update(tx, tenantId, listId, current.id, changes);
            if (!updated) throw viewNotFound(id);
            return updated;
        });
        this.realtime.views(tenantId, listId);
        return toView(row);
    }

    /**
     * v0.1.259 — orden de las pestañas. Los ids deben ser vistas de ESTA lista
     * y únicos; las que no vengan quedan después, en el orden que tenían.
     */
    async reorder(tenantId: number, listIdOrSlug: string, viewIds: number[]): Promise<View[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await this.repo.listByList(tx, tenantId, listId);
            const valid = new Set(existing.map((v) => v.id));
            if (new Set(viewIds).size !== viewIds.length || viewIds.some((id) => !valid.has(id))) {
                throw new BadRequestException({
                    code: 'invalid_reorder',
                    message: 'view_ids debe contener ids únicos de vistas de esta lista',
                    data: { status: 400 },
                });
            }
            const wanted = new Set(viewIds);
            const order = [...viewIds, ...existing.filter((v) => !wanted.has(v.id)).map((v) => v.id)];
            for (let i = 0; i < order.length; i++) {
                const id = order[i]!;
                if (existing.find((v) => v.id === id)?.position === i) continue;
                await this.repo.update(tx, tenantId, listId, id, { position: i });
            }
            return this.repo.listByList(tx, tenantId, listId);
        });
        this.realtime.views(tenantId, listId);
        return rows.map(toView);
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number): Promise<void> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.remove(tx, tenantId, listId, id),
        );
        if (!deleted) throw viewNotFound(id);
        this.realtime.views(tenantId, listId);
    }

    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }
}

function toView(row: ViewRow): View {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        type: row.type as ViewType,
        config: row.config,
        is_default: row.isDefault,
        position: row.position,
        icon: row.icon ?? null,
        color: row.color ?? null,
    };
}

function safeConfig(type: ViewType, config: unknown): Record<string, unknown> {
    try {
        return parseViewConfig(type, config);
    } catch {
        throw new BadRequestException({
            code: 'invalid_view_config',
            message: `Config inválida para una vista de tipo '${type}'`,
            data: { status: 400, errors: { config: 'No cumple el schema del tipo' } },
        });
    }
}

function viewNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'view_not_found',
        message: `Vista ${id} no encontrada`,
        data: { status: 404 },
    });
}
