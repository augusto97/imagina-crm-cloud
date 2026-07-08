import { Injectable } from '@nestjs/common';
import {
    fieldSlugSchema,
    listSlugSchema,
    type SlugCheckQuery,
    type SlugCheckResult,
} from '@imagina-base/shared';
import { FieldsRepository } from '../fields/fields.repository';
import { ListsRepository } from '../lists/lists.repository';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * Chequeo de disponibilidad de slug (CONTRACT.md §1-§2): formato → reservado
 * → unicidad. Lista: unicidad global por tenant; campo: dentro de su lista.
 */
@Injectable()
export class SlugsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsRepository,
        private readonly fields: FieldsRepository,
    ) {}

    async check(tenantId: number, query: SlugCheckQuery): Promise<SlugCheckResult> {
        const schema = query.type === 'list' ? listSlugSchema : fieldSlugSchema;
        const parsed = schema.safeParse(query.slug);
        if (!parsed.success) {
            // El refine de reservados y el regex comparten el mismo schema;
            // distinguimos el motivo re-chequeando solo el formato base.
            const formatOk = /^[a-z][a-z0-9_]{0,62}$/.test(query.slug);
            return { available: false, reason: formatOk ? 'reserved' : 'format' };
        }

        const taken = await this.tenantDb.withTenant(tenantId, (tx) =>
            query.type === 'list'
                ? this.lists.slugExists(tx, tenantId, query.slug, query.except_id)
                : this.fields.slugExists(tx, tenantId, query.list_id!, query.slug, query.except_id),
        );
        return taken ? { available: false, reason: 'taken' } : { available: true };
    }
}
