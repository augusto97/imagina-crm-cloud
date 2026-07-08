import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
    listSlugSchema,
    slugify,
    type CreateListInput,
    type List,
    type UpdateListInput,
} from '@imagina-base/shared';
import type { Tx } from '../db/client';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ListsRepository, type ListRow } from './lists.repository';

@Injectable()
export class ListsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: ListsRepository,
    ) {}

    async list(tenantId: number): Promise<List[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listAll(tx, tenantId),
        );
        return rows.map(toList);
    }

    async get(tenantId: number, idOrSlug: string): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolve(tx, tenantId, idOrSlug),
        );
        return toList(row);
    }

    async create(tenantId: number, input: CreateListInput): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const slug = await this.resolveNewSlug(tx, tenantId, input.name, input.slug);
            const position = await this.repo.nextPosition(tx, tenantId);
            return this.repo.insert(tx, {
                tenantId,
                slug,
                name: input.name,
                icon: input.icon ?? null,
                color: input.color ?? null,
                position,
            });
        });
        return toList(row);
    }

    async update(tenantId: number, idOrSlug: string, patch: UpdateListInput): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolve(tx, tenantId, idOrSlug);

            const changes: Partial<typeof import('../db/schema').lists.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.icon !== undefined) changes.icon = patch.icon;
            if (patch.color !== undefined) changes.color = patch.color;
            if (patch.position !== undefined) changes.position = patch.position;
            if (patch.settings !== undefined) changes.settings = patch.settings;

            if (patch.slug !== undefined && patch.slug !== current.slug) {
                // TODO(F1-slugs): registrar el rename en slug_history para redirects.
                if (await this.repo.slugExists(tx, tenantId, patch.slug, current.id)) {
                    throw new ConflictException({
                        code: 'slug_taken',
                        message: `El slug '${patch.slug}' ya existe en este workspace`,
                        data: { status: 409, errors: { slug: 'Ya está en uso' } },
                    });
                }
                changes.slug = patch.slug;
            }

            const updated = await this.repo.update(tx, tenantId, current.id, changes);
            if (!updated) {
                throw new NotFoundException(notFound(idOrSlug));
            }
            return updated;
        });
        return toList(row);
    }

    async remove(tenantId: number, idOrSlug: string): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolve(tx, tenantId, idOrSlug);
            await this.repo.remove(tx, tenantId, current.id);
        });
    }

    /** Resuelve una lista por id numérico o slug (CONTRACT.md §1). 404 si no existe. */
    private async resolve(tx: Tx, tenantId: number, idOrSlug: string): Promise<ListRow> {
        const row = /^\d+$/.test(idOrSlug)
            ? await this.repo.findById(tx, tenantId, Number(idOrSlug))
            : await this.repo.findBySlug(tx, tenantId, idOrSlug);
        if (!row) {
            throw new NotFoundException(notFound(idOrSlug));
        }
        return row;
    }

    /**
     * Slug para una lista nueva: si el usuario lo dio, valida formato/reservados
     * (ya cubierto por el schema) + unicidad. Si no, lo genera del nombre y
     * resuelve colisiones con sufijo `_2`, `_3`… (CONTRACT.md §2).
     */
    private async resolveNewSlug(
        tx: Tx,
        tenantId: number,
        name: string,
        provided?: string,
    ): Promise<string> {
        if (provided !== undefined) {
            if (await this.repo.slugExists(tx, tenantId, provided)) {
                throw new ConflictException({
                    code: 'slug_taken',
                    message: `El slug '${provided}' ya existe en este workspace`,
                    data: { status: 409, errors: { slug: 'Ya está en uso' } },
                });
            }
            return provided;
        }

        const base = ensureListSlug(slugify(name));
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? base : ensureListSlug(`${base.slice(0, 60)}_${i + 1}`);
            if (!(await this.repo.slugExists(tx, tenantId, candidate))) {
                return candidate;
            }
        }
        throw new ConflictException('No se pudo generar un slug de lista disponible');
    }
}

function toList(row: ListRow): List {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        icon: row.icon,
        color: row.color,
        settings: row.settings,
        position: row.position,
    };
}

function notFound(idOrSlug: string) {
    return {
        code: 'list_not_found',
        message: `Lista '${idOrSlug}' no encontrada`,
        data: { status: 404 },
    };
}

/**
 * Un slug generado del nombre puede chocar con un reservado de lista
 * (ej. lista llamada "Records" → `records`). En ese caso lo prefijamos.
 */
function ensureListSlug(slug: string): string {
    return listSlugSchema.safeParse(slug).success ? slug : `lista_${slug}`.slice(0, 63);
}
