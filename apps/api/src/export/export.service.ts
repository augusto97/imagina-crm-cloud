import { Injectable } from '@nestjs/common';
import { asc, eq, gt, isNull, and, type SQL } from 'drizzle-orm';
import {
    isDataField,
    jsonbKeyForField,
    type ExportBundle,
    type FieldType,
    type FilterGroup,
    type RecordDto,
    type ViewType,
} from '@imagina-base/shared';
import { records } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ViewsService } from '../views/views.service';

const PAGE = 1000;

export interface CsvExportOptions {
    /** IDs de campos a exportar, en orden. Vacío → todos los data fields. */
    fieldIds: number[];
    delimiter: ',' | ';';
    withBom: boolean;
    filterTree?: FilterGroup;
}

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
        private readonly records_: RecordsService,
    ) {}

    /**
     * Export CSV con selección de campos, delimiter y filtro (el que usa el
     * ExportButton del fork). A diferencia del bundle JSON de intercambio,
     * acá los records pasan por `RecordsService.list` → se respetan el ACL
     * por rol (scope de lectura + campos ocultos) y el filter tree activo.
     * Streaming por keyset — nunca se materializa la lista entera.
     */
    async streamCsvExport(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: CsvExportOptions,
        onStart: (filename: string) => void,
        write: (chunk: string) => void,
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const all = await this.fields.listByListId(tenantId, list.id);
        const dataFields = all.filter((f) => isDataField(f.type));
        const byId = new Map(dataFields.map((f) => [f.id, f]));
        const columns =
            opts.fieldIds.length > 0
                ? opts.fieldIds.map((id) => byId.get(id)).filter((f) => f !== undefined)
                : dataFields;

        onStart(`${list.slug}.csv`);
        if (opts.withBom) write('﻿');
        write(csvLine(columns.map((c) => c.label), opts.delimiter));

        let cursor: number | undefined;
        for (;;) {
            const page = await this.records_.list(tenantId, actor, String(list.id), {
                cursor,
                limit: 200,
                sort_dir: 'asc',
                filter_tree: opts.filterTree,
            });
            for (const r of page.data) {
                write(
                    csvLine(
                        columns.map((c) => stringifyCell(r.data[jsonbKeyForField(c.id)], c.type)),
                        opts.delimiter,
                    ),
                );
            }
            const next = page.meta.next_cursor;
            if (next === null || page.data.length === 0) break;
            cursor = Number(next);
        }
    }

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

/** Una línea CSV con quoting RFC-4180 (comillas dobladas, quote si hace falta). */
function csvLine(cells: string[], delimiter: string): string {
    return (
        cells
            .map((cell) => {
                if (
                    cell.includes(delimiter)
                    || cell.includes('"')
                    || cell.includes('\n')
                    || cell.includes('\r')
                ) {
                    return `"${cell.replace(/"/g, '""')}"`;
                }
                return cell;
            })
            .join(delimiter) + '\r\n'
    );
}

/** Serializa un valor JSONB a celda CSV (paridad con el CsvExporter del plugin). */
function stringifyCell(value: unknown, type: string): string {
    if (value === null || value === undefined || value === '') return '';
    if (type === 'multi_select') {
        return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    }
    if (type === 'checkbox') return value === true || value === 1 || value === '1' ? '1' : '0';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
