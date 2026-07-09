import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    fieldSlugSchema,
    parseFieldConfig,
    slugify,
    type CreateFieldInput,
    type Field,
    type FieldType,
    type UpdateFieldInput,
} from '@imagina-base/shared';
import type { Tx } from '../db/client';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ListsService } from '../lists/lists.service';
import { FieldsRepository, type FieldRow } from './fields.repository';

@Injectable()
export class FieldsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: FieldsRepository,
        private readonly lists: ListsService,
        private readonly realtime: RealtimeService,
    ) {}

    async list(tenantId: number, listIdOrSlug: string): Promise<Field[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        return this.listByListId(tenantId, listId);
    }

    /**
     * Igual que `list()` pero con el `list_id` numérico YA resuelto: evita el
     * `lists.get` redundante cuando el caller (p.ej. RecordsService) ya resolvió
     * la lista. Ahorra una transacción con scope por request (perf).
     */
    async listByListId(tenantId: number, listId: number): Promise<Field[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, listId),
        );
        return rows.map(toField);
    }

    async get(tenantId: number, listIdOrSlug: string, fieldIdOrSlug: string): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolveField(tx, tenantId, listId, fieldIdOrSlug),
        );
        return toField(row);
    }

    async create(tenantId: number, listIdOrSlug: string, input: CreateFieldInput): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const config = safeConfig(input.type, input.config);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const slug = await this.resolveNewSlug(tx, tenantId, listId, input.label, input.slug);
            const position = await this.repo.nextPosition(tx, tenantId, listId);
            return this.repo.insert(tx, {
                tenantId,
                listId,
                slug,
                label: input.label,
                type: input.type,
                config,
                isRequired: input.is_required ?? false,
                isUnique: input.is_unique ?? false,
                isIndexed: input.is_indexed ?? false,
                position,
            });
        });
        this.realtime.fields(tenantId, listId);
        return toField(row);
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        patch: UpdateFieldInput,
    ): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);

            const changes: Partial<typeof import('../db/schema').fields.$inferInsert> = {};
            if (patch.label !== undefined) changes.label = patch.label;
            if (patch.is_required !== undefined) changes.isRequired = patch.is_required;
            if (patch.is_unique !== undefined) changes.isUnique = patch.is_unique;
            if (patch.position !== undefined) changes.position = patch.position;
            if (patch.config !== undefined) {
                changes.config = safeConfig(current.type as FieldType, patch.config);
            }
            if (patch.is_indexed !== undefined) {
                // TODO(F2): al pasar a true, encolar CREATE INDEX CONCURRENTLY
                // por expresión tipada (STANDALONE.md §3.3). Por ahora solo flag.
                changes.isIndexed = patch.is_indexed;
            }
            if (patch.slug !== undefined && patch.slug !== current.slug) {
                if (await this.repo.slugExists(tx, tenantId, listId, patch.slug, current.id)) {
                    throw slugConflict(patch.slug);
                }
                changes.slug = patch.slug;
            }

            const updated = await this.repo.update(tx, tenantId, listId, current.id, changes);
            if (!updated) throw fieldNotFound(fieldIdOrSlug);
            return updated;
        });
        // Un cambio de schema (config/slug/required) afecta cómo se leen los
        // records → invalidamos fields Y records de la lista.
        this.realtime.fields(tenantId, listId);
        this.realtime.records(tenantId, listId);
        return toField(row);
    }

    async remove(tenantId: number, listIdOrSlug: string, fieldIdOrSlug: string): Promise<void> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);
            await this.repo.remove(tx, tenantId, listId, current.id);
        });
        this.realtime.fields(tenantId, listId);
        this.realtime.records(tenantId, listId);
    }

    async reorder(tenantId: number, listIdOrSlug: string, fieldIds: number[]): Promise<Field[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await this.repo.existingIds(tx, tenantId, listId, fieldIds);
            if (existing.length !== fieldIds.length || new Set(fieldIds).size !== fieldIds.length) {
                throw new BadRequestException({
                    code: 'invalid_reorder',
                    message: 'field_ids debe contener ids únicos que pertenezcan a la lista',
                    data: { status: 400 },
                });
            }
            await this.repo.applyOrder(tx, tenantId, listId, fieldIds);
            return this.repo.listByList(tx, tenantId, listId);
        });
        this.realtime.fields(tenantId, listId);
        return rows.map(toField);
    }

    /** Resuelve el list_id validando pertenencia al tenant (404 si no existe). */
    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }

    private async resolveField(
        tx: Tx,
        tenantId: number,
        listId: number,
        fieldIdOrSlug: string,
    ): Promise<FieldRow> {
        const row = /^\d+$/.test(fieldIdOrSlug)
            ? await this.repo.findById(tx, tenantId, listId, Number(fieldIdOrSlug))
            : await this.repo.findBySlug(tx, tenantId, listId, fieldIdOrSlug);
        if (!row) throw fieldNotFound(fieldIdOrSlug);
        return row;
    }

    private async resolveNewSlug(
        tx: Tx,
        tenantId: number,
        listId: number,
        label: string,
        provided?: string,
    ): Promise<string> {
        if (provided !== undefined) {
            if (await this.repo.slugExists(tx, tenantId, listId, provided)) {
                throw slugConflict(provided);
            }
            return provided;
        }
        const base = ensureFieldSlug(slugify(label));
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? base : ensureFieldSlug(`${base.slice(0, 60)}_${i + 1}`);
            if (!(await this.repo.slugExists(tx, tenantId, listId, candidate))) {
                return candidate;
            }
        }
        throw new ConflictException('No se pudo generar un slug de campo disponible');
    }
}

function toField(row: FieldRow): Field {
    return {
        id: row.id,
        list_id: row.listId,
        slug: row.slug,
        label: row.label,
        type: row.type as FieldType,
        config: row.config,
        is_required: row.isRequired,
        is_unique: row.isUnique,
        is_indexed: row.isIndexed,
        position: row.position,
    };
}

/** Valida la config contra el schema del tipo; 400 legible si no cuadra. */
function safeConfig(type: FieldType, config: unknown): Record<string, unknown> {
    try {
        return parseFieldConfig(type, config);
    } catch {
        throw new BadRequestException({
            code: 'invalid_field_config',
            message: `Config inválida para un campo de tipo '${type}'`,
            data: { status: 400, errors: { config: 'No cumple el schema del tipo' } },
        });
    }
}

function ensureFieldSlug(slug: string): string {
    return fieldSlugSchema.safeParse(slug).success ? slug : `campo_${slug}`.slice(0, 63);
}

function slugConflict(slug: string): ConflictException {
    return new ConflictException({
        code: 'slug_taken',
        message: `El slug '${slug}' ya existe en esta lista`,
        data: { status: 409, errors: { slug: 'Ya está en uso' } },
    });
}

function fieldNotFound(idOrSlug: string): NotFoundException {
    return new NotFoundException({
        code: 'field_not_found',
        message: `Campo '${idOrSlug}' no encontrado`,
        data: { status: 404 },
    });
}
