import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

/**
 * v0.1.260 — quién pide. Sin viewer (procesos internos: plantillas, export,
 * duplicar) las vistas PRIVADAS no existen y las protegidas no se tocan.
 */
export interface ViewViewer {
    userId: number;
    role: string;
}

/** ¿La ve esta persona? Las privadas, sólo quien las creó. */
export function canSeeView(row: Pick<ViewRow, 'isPrivate' | 'createdBy'>, viewer?: ViewViewer): boolean {
    return !row.isPrivate || (viewer !== undefined && row.createdBy === viewer.userId);
}

/** ¿Puede cambiar/borrar una vista protegida? Quien la creó o un admin. */
function canEditLocked(row: Pick<ViewRow, 'createdBy'>, viewer?: ViewViewer): boolean {
    return viewer !== undefined && (row.createdBy === viewer.userId || viewer.role === 'admin');
}

@Injectable()
export class ViewsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: ViewsRepository,
        private readonly lists: ListsService,
        private readonly realtime: RealtimeService,
    ) {}

    async list(tenantId: number, listIdOrSlug: string, viewer?: ViewViewer): Promise<View[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, listId),
        );
        return rows.filter((r) => canSeeView(r, viewer)).map(toView);
    }

    async get(tenantId: number, listIdOrSlug: string, id: number, viewer?: ViewViewer): Promise<View> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, listId, id),
        );
        if (!row || !canSeeView(row, viewer)) throw viewNotFound(id);
        return toView(row);
    }

    async create(
        tenantId: number,
        listIdOrSlug: string,
        input: CreateViewInput,
        viewer?: ViewViewer,
    ): Promise<View> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const config = safeConfig(input.type, input.config);
        const isPrivate = input.is_private === true && viewer !== undefined;
        if (isPrivate && input.is_default) throw privateDefault();

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
                createdBy: viewer?.userId ?? null,
                isPrivate,
                isLocked: input.is_locked === true && viewer !== undefined,
                autosave: input.autosave === true,
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
        viewer?: ViewViewer,
    ): Promise<View> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !canSeeView(current, viewer)) throw viewNotFound(id);
            assertCanPatch(current, patch, viewer);

            const changes: Partial<typeof import('../db/schema').savedViews.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.position !== undefined) changes.position = patch.position;
            if (patch.icon !== undefined) changes.icon = patch.icon;
            if (patch.color !== undefined) changes.color = patch.color;
            if (patch.is_locked !== undefined) changes.isLocked = patch.is_locked;
            if (patch.autosave !== undefined) changes.autosave = patch.autosave;
            if (patch.is_private !== undefined) {
                changes.isPrivate = patch.is_private;
                // Quien la hace privada pasa a ser su dueño (vistas viejas sin autor).
                if (patch.is_private && current.createdBy === null && viewer) changes.createdBy = viewer.userId;
            }
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
    async reorder(tenantId: number, listIdOrSlug: string, viewIds: number[], viewer?: ViewViewer): Promise<View[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const all = await this.repo.listByList(tx, tenantId, listId);
            // Las privadas de otros no se ven ni se mueven (quedan donde estaban).
            const existing = all.filter((v) => canSeeView(v, viewer));
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
        return rows.filter((r) => canSeeView(r, viewer)).map(toView);
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number, viewer?: ViewViewer): Promise<void> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !canSeeView(current, viewer)) return false;
            if (current.isLocked && !canEditLocked(current, viewer)) throw viewLocked();
            return this.repo.remove(tx, tenantId, listId, id);
        });
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
        created_by: row.createdBy ?? null,
        is_private: row.isPrivate,
        is_locked: row.isLocked,
        autosave: row.autosave,
    };
}

/**
 * Reglas del PATCH (v0.1.260):
 * - protegida: sólo quien la creó o un admin cambia su contenido, la
 *   desprotege o la borra. Reordenar y "por defecto" no tocan su contenido.
 * - privada: sólo quien la creó (o un admin, si la vista no tiene autor) la
 *   vuelve privada o pública; una privada no puede ser la por defecto.
 */
function assertCanPatch(current: ViewRow, patch: UpdateViewInput, viewer?: ViewViewer): void {
    const touchesContent =
        patch.name !== undefined ||
        patch.config !== undefined ||
        patch.icon !== undefined ||
        patch.color !== undefined ||
        patch.autosave !== undefined ||
        patch.is_locked !== undefined ||
        patch.is_private !== undefined;
    if (current.isLocked && touchesContent && !canEditLocked(current, viewer)) throw viewLocked();
    if (patch.is_locked !== undefined && !canEditLocked(current, viewer)) throw viewLocked();
    if (patch.is_private !== undefined) {
        const owner =
            viewer !== undefined &&
            (current.createdBy === viewer.userId || (current.createdBy === null && viewer.role === 'admin'));
        if (!owner) {
            throw new ForbiddenException({
                code: 'view_not_owner',
                message: 'Sólo quien creó la vista puede hacerla privada o compartirla.',
                data: { status: 403 },
            });
        }
    }
    const willBePrivate = patch.is_private ?? current.isPrivate;
    const willBeDefault = patch.is_default ?? current.isDefault;
    if (willBePrivate && willBeDefault) throw privateDefault();
}

function viewLocked(): ForbiddenException {
    return new ForbiddenException({
        code: 'view_locked',
        message: 'La vista está protegida: sólo quien la creó o un admin puede cambiarla.',
        data: { status: 403 },
    });
}

function privateDefault(): BadRequestException {
    return new BadRequestException({
        code: 'private_default',
        message: 'Una vista privada no puede ser la vista por defecto de la lista (los demás no la ven).',
        data: { status: 400 },
    });
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
