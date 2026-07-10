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
        const allRecords: RecordDto[] = [];
        for await (const r of this.iterateRecords(tenantId, list.id)) allRecords.push(r);

        return {
            version: 1,
            exported_at: now,
            list,
            fields: fields.map((f) => ({ ...f, type: f.type as FieldType })),
            views: views.map((v) => ({ ...v, type: v.type as ViewType })),
            records: allRecords,
        };
    }

    /**
     * Export por STREAMING (SEC-10). Escribe el MISMO bundle JSON pero sin
     * materializar todos los records en memoria: cabecera + `"records":[` y luego
     * cada record por keyset a medida que llega, evitando OOM en listas grandes
     * (el seed de 100k acumulaba todo en un array antes de serializar).
     */
    async streamExport(
        tenantId: number,
        listIdOrSlug: string,
        now: string,
        write: (chunk: string) => void,
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const views = await this.views.list(tenantId, String(list.id));

        write('{"version":1');
        write(`,"exported_at":${JSON.stringify(now)}`);
        write(`,"list":${JSON.stringify(list)}`);
        write(`,"fields":${JSON.stringify(fields.map((f) => ({ ...f, type: f.type as FieldType })))}`);
        write(`,"views":${JSON.stringify(views.map((v) => ({ ...v, type: v.type as ViewType })))}`);
        write(',"records":[');
        let first = true;
        for await (const r of this.iterateRecords(tenantId, list.id)) {
            write((first ? '' : ',') + JSON.stringify(r));
            first = false;
        }
        write(']}');
    }

    /** Recorre los records por keyset (id asc) en páginas de 1000. */
    private async *iterateRecords(tenantId: number, listId: number): AsyncGenerator<RecordDto> {
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
                yield {
                    id: r.id,
                    list_id: r.listId,
                    data: r.data,
                    created_by: r.createdBy,
                    created_at: r.createdAt.toISOString(),
                    updated_at: r.updatedAt.toISOString(),
                };
            }
            if (rows.length < PAGE) break;
            cursor = rows[rows.length - 1]!.id;
        }
    }
}
