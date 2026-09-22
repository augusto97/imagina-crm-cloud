import { Injectable } from '@nestjs/common';
import { asc, eq, gt, inArray, isNotNull, isNull, and, sql, type SQL } from 'drizzle-orm';
import {
    EXPORT_ID_HEADER,
    EXPORT_PARENT_HEADER,
    formatDuration,
    isDataField,
    jsonbKeyForField,
    resolveTitleFieldId,
    type ExportBundle,
    type Field,
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
        // `list` (no `listByListId`): trae los lookup/rollup con su relación
        // RESUELTA en `through`, que es lo que necesita el formateo de abajo.
        const all = await this.fields.list(tenantId, String(list.id));
        // v0.1.200 — el CSV exporta TODO lo que se ve en la tabla, no sólo lo
        // que vive en `data`. Antes `isDataField` dejaba afuera los computed,
        // los lookup, los rollup y las relaciones: una lista de Facturas se
        // exportaba sin el cliente y sin el total. Los derivados ya vienen
        // resueltos en `RecordsService.list` (el motor los inyecta en `data`);
        // las relaciones se resuelven acá a los TÍTULOS de los vinculados, que
        // es lo que el archivo tiene que decir para ser legible.
        const exportable = all.filter((f) => isDataField(f.type) || isExportableDerived(f.type));
        const byId = new Map(exportable.map((f) => [f.id, f]));
        const columns =
            opts.fieldIds.length > 0
                ? opts.fieldIds.map((id) => byId.get(id)).filter((f) => f !== undefined)
                : exportable;
        const labeler = await this.relationLabeler(
            tenantId,
            columns.filter((c) => c.type === 'relation'),
        );

        // v0.1.132 — jerarquía. Las subtareas SIEMPRE se exportan (si no, el
        // archivo perdería filas en silencio), pero las dos columnas que la
        // describen sólo aparecen si la lista tiene alguna: una lista sin
        // subtareas exporta exactamente el mismo CSV que antes.
        const withHierarchy = await this.hasSubtasks(tenantId, list.id);

        onStart(`${list.slug}.csv`);
        if (opts.withBom) write('﻿');
        const header = columns.map((c) => c.label);
        write(
            csvLine(
                withHierarchy ? [EXPORT_ID_HEADER, EXPORT_PARENT_HEADER, ...header] : header,
                opts.delimiter,
            ),
        );

        let cursor: number | undefined;
        for (;;) {
            const page = await this.records_.list(tenantId, actor, String(list.id), {
                cursor,
                limit: 200,
                sort_dir: 'asc',
                filter_tree: opts.filterTree,
                include_subtasks: true,
            });
            await labeler.prime(page.data);
            for (const r of page.data) {
                const cells = columns.map((c) =>
                    c.type === 'relation'
                        ? labeler.labels(c.id, r.relations?.[jsonbKeyForField(c.id)])
                        : stringifyCell(r.data[jsonbKeyForField(c.id)], c.type, targetTypeOf(c)),
                );
                write(
                    csvLine(
                        withHierarchy
                            ? [String(r.id), r.parent_id === null ? '' : String(r.parent_id), ...cells]
                            : cells,
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

    /**
     * Resuelve los ids de una relación a los TÍTULOS de los registros
     * vinculados (v0.1.200). Un CSV con "12, 47" no le sirve a nadie; lo que
     * el archivo tiene que decir es «Acme S.A.».
     *
     * Una query por lista destino y por PÁGINA, no por fila (regla de oro
     * nº 8), y con cache entre páginas: en una lista de facturas el mismo
     * cliente se repite muchísimo.
     */
    private async relationLabeler(tenantId: number, relFields: Field[]): Promise<RelationLabeler> {
        const targets = new Map<number, { listId: number; titleKey: string }>();
        for (const f of relFields) {
            const listId = Number((f.config as { target_list_id?: unknown }).target_list_id);
            if (!Number.isInteger(listId) || listId <= 0) continue;
            const otherList = await this.lists.get(tenantId, String(listId)).catch(() => null);
            if (!otherList) continue;
            const otherFields = await this.fields.listByListId(tenantId, listId);
            const titleId = resolveTitleFieldId(otherFields, otherList.settings);
            if (titleId === null) continue;
            targets.set(f.id, { listId, titleKey: jsonbKeyForField(titleId) });
        }
        const cache = new Map<number, string>();

        return {
            prime: async (rows) => {
                const wanted = new Set<number>();
                for (const r of rows) {
                    for (const f of relFields) {
                        const ids = r.relations?.[jsonbKeyForField(f.id)];
                        if (!Array.isArray(ids)) continue;
                        for (const id of ids) if (!cache.has(id)) wanted.add(id);
                    }
                }
                if (wanted.size === 0) return;
                const byList = new Map<string, number[]>();
                for (const t of targets.values()) byList.set(t.titleKey, []);
                // Los ids de todas las relaciones se piden juntos por clave de
                // título: dos relaciones a la misma lista comparten la query.
                for (const f of relFields) {
                    const t = targets.get(f.id);
                    if (!t) continue;
                    for (const r of rows) {
                        const ids = r.relations?.[jsonbKeyForField(f.id)];
                        if (!Array.isArray(ids)) continue;
                        for (const id of ids) if (wanted.has(id)) byList.get(t.titleKey)!.push(id);
                    }
                }
                for (const [titleKey, ids] of byList) {
                    if (ids.length === 0) continue;
                    const unique = [...new Set(ids)];
                    const rowsOut = await this.tenantDb.withTenant(tenantId, (tx) =>
                        tx
                            .select({
                                id: records.id,
                                title: sql<string | null>`(${records.data} ->> ${titleKey})`,
                            })
                            .from(records)
                            .where(
                                and(
                                    eq(records.tenantId, tenantId),
                                    inArray(records.id, unique),
                                    isNull(records.deletedAt),
                                ),
                            ),
                    );
                    for (const row of rowsOut) cache.set(row.id, row.title ?? `#${row.id}`);
                }
            },
            labels: (fieldId, value) => {
                const ids = Array.isArray(value) ? value : [];
                if (ids.length === 0 || !targets.has(fieldId)) return '';
                return ids.map((id) => cache.get(Number(id)) ?? `#${String(id)}`).join(', ');
            },
        };
    }

    /** ¿La lista tiene alguna subtarea viva? (una query, con LIMIT 1). */
    private async hasSubtasks(tenantId: number, listId: number): Promise<boolean> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, listId),
                        isNotNull(records.parentId),
                        isNull(records.deletedAt),
                    ),
                )
                .limit(1),
        );
        return rows.length > 0;
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
                    // v0.1.132 — la jerarquía viaja en el archivo: quién es
                    // subtarea de quién se reconstruye por estos ids.
                    parent_id: r.parentId ?? null,
                    subtask_count: 0,
                    has_description: (r.description ?? null) !== null,
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

/** Derivados que SÍ salen en el CSV (`relation` incluida: se exporta el título). */
function isExportableDerived(type: string): boolean {
    return type === 'computed' || type === 'lookup' || type === 'rollup' || type === 'relation';
}

/** Tipo del campo del OTRO lado, para formatear un lookup/rollup como la celda. */
function targetTypeOf(field: Field): string | undefined {
    return field.through?.target_field?.type;
}

interface RelationLabeler {
    prime(rows: Array<{ relations?: Record<string, number[]> }>): Promise<void>;
    labels(fieldId: number, value: unknown): string;
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
function stringifyCell(value: unknown, type: string, targetType?: string): string {
    if (value === null || value === undefined || value === '') return '';
    // v0.1.200 — un lookup trae una LISTA de valores del otro lado: cada uno
    // se formatea con el tipo del campo DESTINO (una duración sale `1h 30m`,
    // no 90), igual que en la celda.
    if (type === 'lookup') {
        const items = Array.isArray(value) ? value : [value];
        return items
            .map((v) => stringifyCell(v, targetType ?? 'text'))
            .filter((v) => v !== '')
            .join(', ');
    }
    // Un rollup es un escalar; el tipo del destino manda cuando aporta
    // (min/max de una fecha, una duración).
    if (type === 'rollup') return stringifyCell(value, targetType ?? 'number');
    if (type === 'multi_select') {
        return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    }
    if (type === 'checkbox') return value === true || value === 1 || value === '1' ? '1' : '0';
    // v0.1.158 — la duración se guarda en minutos: en una planilla eso no se
    // lee. Sale como la escribió el usuario (`1h 30m`) y el import la vuelve
    // a entender (el parser acepta ese mismo texto), así el round-trip cierra.
    if (type === 'duration') return formatDuration(value);
    if (type === 'percent') return `${String(value)}%`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
