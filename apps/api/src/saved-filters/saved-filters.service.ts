import { Injectable } from '@nestjs/common';
import type { CreateSavedFilterInput, SavedFilter } from '@imagina-base/shared';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SavedFiltersRepository, type SavedFilterRow } from './saved-filters.repository';

/**
 * Filtros guardados por lista (herencia del plugin). CRUD mínimo: listar los
 * visibles para el usuario (shared + propios), crear y borrar. Tenant-scoped.
 */
@Injectable()
export class SavedFiltersService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: SavedFiltersRepository,
        private readonly lists: ListsService,
    ) {}

    async list(tenantId: number, userId: number, listIdOrSlug: string): Promise<SavedFilter[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listVisible(tx, tenantId, listId, userId),
        );
        return rows.map(toSavedFilter);
    }

    async create(
        tenantId: number,
        userId: number,
        listIdOrSlug: string,
        input: CreateSavedFilterInput,
    ): Promise<SavedFilter> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.insert(tx, {
                tenantId,
                listId,
                // shared → sin dueño (todo el workspace); personal → dueño = quien lo crea.
                userId: input.scope === 'shared' ? null : userId,
                name: input.name,
                filterTree: input.filter_tree as unknown as Record<string, unknown>,
            }),
        );
        return toSavedFilter(row);
    }

    async remove(tenantId: number, userId: number, listIdOrSlug: string, id: number): Promise<boolean> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        return this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.remove(tx, tenantId, listId, id, userId),
        );
    }

    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }
}

function toSavedFilter(row: SavedFilterRow): SavedFilter {
    return {
        id: row.id,
        list_id: row.listId,
        user_id: row.userId ?? null,
        name: row.name,
        filter_tree: row.filterTree as unknown as SavedFilter['filter_tree'],
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}
