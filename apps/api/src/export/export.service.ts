import { Injectable } from '@nestjs/common';
import { asc, eq, gt, isNull, and, type SQL } from 'drizzle-orm';
import type { ExportBundle, FieldType, RecordDto, ViewType } from '@imagina-base/shared';
import { records } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ViewsService } from '../views/views.service';

const PAGE = 1000;

/**
 * Export JSON de intercambio de una lista (STANDALONE §16). Recorre TODOS los
 * records por keyset (sin OFFSET) para soportar listas grandes. Disponible en
 * solo-lectura (es un GET → no lo bloquea el TenantGuard) — ADR-S09.
 */
@Injectable()
export class ExportService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly views: ViewsService,
    ) {}

    async exportList(tenantId: number, listIdOrSlug: string, now: string): Promise<ExportBundle> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const views = await this.views.list(tenantId, String(list.id));
        const allRecords = await this.allRecords(tenantId, list.id);

        return {
            version: 1,
            exported_at: now,
            list,
            fields: fields.map((f) => ({ ...f, type: f.type as FieldType })),
            views: views.map((v) => ({ ...v, type: v.type as ViewType })),
            records: allRecords,
        };
    }

    /** Recorre los records por keyset (id asc) en páginas de 1000. */
    private async allRecords(tenantId: number, listId: number): Promise<RecordDto[]> {
        const out: RecordDto[] = [];
        let cursor: number | undefined;
        for (;;) {
            const cursorClause: SQL | undefined = cursor !== undefined ? gt(records.id, cursor) : undefined;
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select()
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, listId),
                            isNull(records.deletedAt),
                            cursorClause,
                        ),
                    )
                    .orderBy(asc(records.id))
                    .limit(PAGE),
            );
            for (const r of rows) {
                out.push({
                    id: r.id,
                    list_id: r.listId,
                    data: r.data,
                    created_by: r.createdBy,
                    created_at: r.createdAt.toISOString(),
                    updated_at: r.updatedAt.toISOString(),
                });
            }
            if (rows.length < PAGE) break;
            cursor = rows[rows.length - 1]!.id;
        }
        return out;
    }
}
