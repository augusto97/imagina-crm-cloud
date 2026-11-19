import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    SHEET_SYNC_FIELD_TYPES,
    SHEET_SYNC_KEY_TYPES,
    SHEET_SYNC_PREVIEW_ROWS,
    findSheetColumn,
    mirrorFromPlace,
    nextSheetSyncRun,
    normalizeSheetHeader,
    parseSpreadsheetLink,
    readMirrorListMarker,
    readSheetSyncSettings,
    sheetColumnLetter,
    sheetSyncReadsSheet,
    sheetSyncWritesSheet,
    spreadsheetUrl,
    type CreateSheetSyncInput,
    type Field,
    type SheetPreviewInput,
    type SheetPreviewResult,
    type SheetSync,
    type SheetSyncDryRun,
    type SheetSyncSettings,
    type SheetSyncStatus,
    type UpdateSheetSyncInput,
} from '@imagina-base/shared';
import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { planIncludesSql } from '../billing/plan-module-gate';
import { ConnectorsService } from '../connectors/connectors.service';
import { DRIZZLE, type Db } from '../db/client';
import { sheetSyncRows, sheetSyncs, type SheetSyncRow } from '../db/schema';
import { EventWebhookHub } from '../event-webhooks/event-hub';
import { FieldsService } from '../fields/fields.service';
import { effectivePermissions, hiddenFieldsFor, type AclSubject } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RecordChangeHub } from '../records/record-change-hub';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SheetSyncEngine, readTab } from './sheet-sync.engine';
import { SheetSyncQueue } from './sheet-sync.queue';
import { cellDisplay, suggestSheetFieldType } from './sheet-values';
import { SheetsApiError } from './sheets-api';

/** Cuánto se recuerda qué listas de una empresa se sincronizan con una hoja. */
const WATCH_TTL_MS = 60_000;

/**
 * v0.1.459 (G3) — Sincronizaciones con Google Sheets: alta, cambios, estado,
 * «Probar» (una planilla y la próxima corrida) y el tick que encola las que
 * tocan. Además escucha los cambios de la app: un registro que cambia en una
 * lista que escribe en una hoja dispara una corrida a los pocos segundos.
 *
 * Quién: `manage_lists` (lo exige el controller), poder EDITAR la conexión
 * (la misma puerta que las otras sincronizaciones) y ver la lista y los campos
 * que se sincronizan: nada que esa persona no ve viaja a la hoja.
 */
@Injectable()
export class SheetSyncService {
    /** tenant → { lista → sincronizaciones que escriben en la hoja }. */
    private readonly watch = new Map<number, { at: number; byList: Map<number, number[]> }>();

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly connectors: ConnectorsService,
        private readonly listsService: ListsService,
        private readonly fields: FieldsService,
        private readonly engine: SheetSyncEngine,
        private readonly queue: SheetSyncQueue,
        private readonly audit: AuditService,
        @Optional() changes?: RecordChangeHub,
        @Optional() events?: EventWebhookHub,
    ) {
        // Borrar la conexión borra sus sincronizaciones (cascada); sus problemas se cierran.
        this.connectors.onBeforeRemove(async (tenantId, connectionId) => {
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.select({ id: sheetSyncs.id }).from(sheetSyncs).where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.connectionId, connectionId))),
            );
            for (const r of rows) this.engine.forgetIncident(tenantId, connectionId, r.id);
            this.watch.delete(tenantId);
        });
        // Lo que cambia en la app sale a la hoja enseguida (sin esperar el horario).
        changes?.subscribe((c) => this.onAppChange(c.tenantId, c.listId));
        events?.subscribe((e) => {
            if (e.event === 'record.deleted') return this.onAppChange(e.tenantId, e.listId);
        });
    }

    // ── Lectura ─────────────────────────────────────────────────────────────

    async list(tenantId: number, actor: AclSubject, connectionId: number): Promise<SheetSync[]> {
        const conn = await this.requireSheetsConnection(tenantId, actor, connectionId);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(sheetSyncs)
                .where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.connectionId, connectionId)))
                .orderBy(asc(sheetSyncs.id)),
        );
        const linked = await this.linkedCounts(tenantId, rows.map((r) => r.id));
        return Promise.all(rows.map((r) => this.toDto(tenantId, r, conn.name, linked.get(r.id) ?? 0)));
    }

    async get(tenantId: number, actor: AclSubject, syncId: number): Promise<SheetSync> {
        const { row, conn } = await this.requireSync(tenantId, actor, syncId);
        const linked = await this.linkedCounts(tenantId, [row.id]);
        return this.toDto(tenantId, row, conn.name, linked.get(row.id) ?? 0);
    }

    /** Las sincronizaciones de una lista (para el asistente y el MCP). Sin secretos. */
    async forList(tenantId: number, listId: number): Promise<Array<{ row: SheetSyncRow; settings: SheetSyncSettings }>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(sheetSyncs).where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.listId, listId))).orderBy(asc(sheetSyncs.id)),
        );
        return rows.map((row) => ({ row, settings: readSheetSyncSettings(row.settings) }));
    }

    // ── Alta / cambios / baja ───────────────────────────────────────────────

    async create(tenantId: number, actor: AclSubject, connectionId: number, input: CreateSheetSyncInput): Promise<SheetSync> {
        await this.requireSheetsConnection(tenantId, actor, connectionId);
        const base = settingsOf(input);
        const titles = await this.checkSpreadsheet(tenantId, connectionId, base.spreadsheet_id, base.sheet_gid);
        const settings: SheetSyncSettings = { ...base, ...titles };
        await this.validate(tenantId, actor, input.list_id, settings);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(sheetSyncs)
                .values({
                    tenantId,
                    connectionId,
                    listId: input.list_id,
                    name: input.name,
                    settings: settings as unknown as Record<string, unknown>,
                    state: {},
                    enabled: input.enabled,
                    // La primera corrida, enseguida.
                    nextRunAt: input.enabled ? new Date() : null,
                    createdBy: actor.userId,
                })
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'sheet_sync.create',
                targetType: 'list',
                targetId: input.list_id,
                targetLabel: input.name,
                meta: { connection_id: connectionId, spreadsheet_id: settings.spreadsheet_id, direction: settings.direction },
            });
            return created!;
        });
        this.watch.delete(tenantId);
        if (row.enabled) {
            await this.engine.saveState(tenantId, row.id, { queued: true });
            this.queue.enqueueRun(tenantId, row.id);
        }
        return this.get(tenantId, actor, row.id);
    }

    async update(tenantId: number, actor: AclSubject, syncId: number, input: UpdateSheetSyncInput): Promise<SheetSync> {
        const { row } = await this.requireSync(tenantId, actor, syncId);
        const current = readSheetSyncSettings(row.settings);
        let merged: SheetSyncSettings = {
            spreadsheet_id: input.spreadsheet_id ?? current.spreadsheet_id,
            sheet_gid: input.sheet_gid ?? current.sheet_gid,
            header_row: input.header_row ?? current.header_row,
            direction: input.direction ?? current.direction,
            key: input.key ?? current.key,
            columns: input.columns ?? current.columns,
            on_sheet_delete: input.on_sheet_delete ?? current.on_sheet_delete,
            on_app_delete: input.on_app_delete ?? current.on_app_delete,
            interval_minutes: input.interval_minutes ?? current.interval_minutes,
            spreadsheet_title: current.spreadsheet_title,
            sheet_title: current.sheet_title,
        };
        const sheetChanged = merged.spreadsheet_id !== current.spreadsheet_id || merged.sheet_gid !== current.sheet_gid || merged.header_row !== current.header_row;
        const keyChanged = JSON.stringify(merged.key) !== JSON.stringify(current.key);
        if (sheetChanged) merged = { ...merged, ...(await this.checkSpreadsheet(tenantId, row.connectionId, merged.spreadsheet_id, merged.sheet_gid)) };
        const listId = input.list_id ?? row.listId;
        await this.validate(tenantId, actor, listId, merged);
        const enabled = input.enabled ?? row.enabled;
        const intervalChanged = input.interval_minutes !== undefined || (input.enabled === true && !row.enabled);
        const nextRunAt = !enabled ? null : intervalChanged || !row.nextRunAt ? nextSheetSyncRun(merged.interval_minutes, new Date()) : row.nextRunAt;
        // Otra hoja, otra pestaña, otra lista u otra clave: los vínculos de antes
        // ya no dicen nada (la próxima corrida vuelve a emparejar).
        const relink = sheetChanged || keyChanged || listId !== row.listId;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(sheetSyncs)
                .set({
                    name: input.name ?? row.name,
                    listId,
                    settings: merged as unknown as Record<string, unknown>,
                    enabled,
                    nextRunAt,
                    // Guardarla la deja a nombre de quien la guarda (su acceso manda).
                    createdBy: actor.userId,
                    updatedAt: new Date(),
                    ...(relink ? { state: sql`${sheetSyncs.state} - 'initial_done'` } : {}),
                })
                .where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.id, syncId)));
            if (relink) await tx.delete(sheetSyncRows).where(and(eq(sheetSyncRows.tenantId, tenantId), eq(sheetSyncRows.syncId, syncId)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'sheet_sync.update',
                targetType: 'list',
                targetId: listId,
                targetLabel: input.name ?? row.name,
                meta: { sync_id: syncId, changed: Object.keys(input) },
            });
        });
        this.watch.delete(tenantId);
        return this.get(tenantId, actor, syncId);
    }

    async remove(tenantId: number, actor: AclSubject, syncId: number): Promise<void> {
        const { row } = await this.requireSync(tenantId, actor, syncId);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx.delete(sheetSyncs).where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.id, syncId)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: actor.userId,
                action: 'sheet_sync.delete',
                targetType: 'list',
                targetId: row.listId,
                targetLabel: row.name,
                // Lo sincronizado queda en los dos lados: dejar de sincronizar no borra datos (ADR-S09).
                meta: { sync_id: syncId },
            });
        });
        this.engine.forgetIncident(tenantId, row.connectionId, syncId);
        this.watch.delete(tenantId);
    }

    // ── Ejecutar / probar ───────────────────────────────────────────────────

    async runNow(tenantId: number, actor: AclSubject, syncId: number): Promise<SheetSync> {
        const { row } = await this.requireSync(tenantId, actor, syncId);
        await this.engine.saveState(tenantId, syncId, { queued: true });
        this.queue.enqueueRun(tenantId, row.id);
        return this.get(tenantId, actor, syncId);
    }

    /** Qué haría la próxima corrida con la configuración GUARDADA, sin escribir nada. */
    async dryRun(tenantId: number, actor: AclSubject, syncId: number): Promise<SheetSyncDryRun> {
        await this.requireSync(tenantId, actor, syncId);
        try {
            return await this.engine.dryRun(tenantId, syncId);
        } catch (err) {
            throw new BadRequestException({ code: 'sheet_sync_error', message: err instanceof Error ? err.message : String(err), data: { status: 400 } });
        }
    }

    /** Abrir una planilla: pestañas, columnas con su tipo sugerido y las primeras filas. */
    async preview(tenantId: number, actor: AclSubject, connectionId: number, input: SheetPreviewInput): Promise<SheetPreviewResult> {
        await this.requireSheetsConnection(tenantId, actor, connectionId);
        const link = parseSpreadsheetLink(input.spreadsheet);
        if (!link) throw bad('No se reconoce ese enlace: copia la dirección de la planilla desde Google Sheets (empieza con https://docs.google.com/spreadsheets/d/…).');
        const api = this.engine.apiFor(tenantId, connectionId);
        try {
            const meta = await api.spreadsheet(link.spreadsheetId);
            if (meta.tabs.length === 0) throw bad('La planilla no tiene pestañas.');
            const gid = input.sheet_gid ?? link.gid;
            const tab = meta.tabs.find((t) => t.gid === gid) ?? meta.tabs[0]!;
            const headerRow = input.header_row ?? 1;
            const { headers, dataRows, truncated } = await readTab(api, link.spreadsheetId, tab, headerRow);
            const named = headers.map((h, i) => ({ name: h, i })).filter((h) => h.name !== '');
            const filled = dataRows.filter((r) => r.cells.some((c) => cellDisplay(c) !== null));
            return {
                spreadsheet_id: link.spreadsheetId,
                spreadsheet_title: meta.title,
                tabs: meta.tabs.map((t) => ({ gid: t.gid, title: t.title, rows: t.rows, columns: t.columns })),
                sheet_gid: tab.gid,
                sheet_title: tab.title,
                header_row: headerRow,
                columns: named.map((h) => ({
                    name: h.name,
                    letter: sheetColumnLetter(h.i),
                    suggested_type: suggestSheetFieldType(filled.map((r) => r.cells[h.i])),
                })),
                rows: filled.slice(0, SHEET_SYNC_PREVIEW_ROWS).map((r) => {
                    const out: Record<string, string | null> = {};
                    for (const h of named) out[h.name] = cellDisplay(r.cells[h.i]);
                    return out;
                }),
                total_rows: filled.length + (truncated ? 1 : 0),
                empty: named.length === 0,
            };
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            throw new BadRequestException({
                code: 'sheets_error',
                message: err instanceof SheetsApiError ? err.message : err instanceof Error ? err.message : String(err),
                data: { status: 400 },
            });
        }
    }

    // ── Cola ────────────────────────────────────────────────────────────────

    /** Tick global (cada minuto): encola las que tocan. Conexión base (cross-tenant). */
    async tick(): Promise<number> {
        const due = await this.db
            .select({ id: sheetSyncs.id, tenantId: sheetSyncs.tenantId })
            .from(sheetSyncs)
            .where(
                and(
                    eq(sheetSyncs.enabled, true),
                    lte(sheetSyncs.nextRunAt, new Date()),
                    // Con la lista en la papelera no corre; al restaurarla sigue sola.
                    sql`NOT EXISTS (SELECT 1 FROM lists l WHERE l.id = ${sheetSyncs.listId} AND l.deleted_at IS NOT NULL)`,
                    planIncludesSql(sheetSyncs.tenantId, 'integrations'),
                ),
            )
            .orderBy(asc(sheetSyncs.nextRunAt))
            .limit(100);
        for (const d of due) {
            // Provisorio: evita re-encolar mientras espera; el motor pone la próxima al terminar.
            await this.db
                .update(sheetSyncs)
                .set({ nextRunAt: new Date(Date.now() + 10 * 60_000) })
                .where(eq(sheetSyncs.id, d.id));
            this.queue.enqueueRun(d.tenantId, d.id);
        }
        return due.length;
    }

    /** Un registro cambió (o se borró) en la app: las hojas de esa lista se ponen al día. */
    async onAppChange(tenantId: number, listId: number): Promise<void> {
        let w = this.watch.get(tenantId);
        if (!w || Date.now() - w.at > WATCH_TTL_MS) {
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ id: sheetSyncs.id, listId: sheetSyncs.listId, settings: sheetSyncs.settings })
                    .from(sheetSyncs)
                    .where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.enabled, true))),
            );
            const byList = new Map<number, number[]>();
            for (const r of rows) {
                if (!sheetSyncWritesSheet(readSheetSyncSettings(r.settings).direction)) continue;
                byList.set(r.listId, [...(byList.get(r.listId) ?? []), r.id]);
            }
            w = { at: Date.now(), byList };
            this.watch.set(tenantId, w);
        }
        for (const id of w.byList.get(listId) ?? []) this.queue.enqueuePush(tenantId, id);
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    /** La planilla y la pestaña existen y la cuenta conectada las puede abrir. */
    private async checkSpreadsheet(tenantId: number, connectionId: number, spreadsheetId: string, gid: number): Promise<{ spreadsheet_title: string; sheet_title: string }> {
        try {
            const meta = await this.engine.apiFor(tenantId, connectionId).spreadsheet(spreadsheetId);
            const tab = meta.tabs.find((t) => t.gid === gid);
            if (!tab) throw bad('Esa pestaña no existe en la planilla: ábrela de nuevo y elige otra.');
            return { spreadsheet_title: meta.title, sheet_title: tab.title };
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            throw bad(err instanceof Error ? err.message : String(err), 'sheets_error');
        }
    }

    /**
     * La configuración tiene que tener sentido contra la lista de HOY y lo que
     * VE quien la guarda: la lista visible, cada columna en un campo que se
     * puede sincronizar y que esa persona ve, sin dos columnas al mismo campo
     * ni dos campos a la misma columna, y la clave bien elegida.
     */
    private async validate(tenantId: number, actor: AclSubject, listId: number, s: SheetSyncSettings): Promise<void> {
        let list;
        try {
            list = await this.listsService.get(tenantId, String(listId));
        } catch {
            throw bad('La lista elegida no existe.');
        }
        const settings = (list.settings ?? {}) as Record<string, unknown>;
        if (effectivePermissions(settings, actor).view === 'none') throw bad('No tienes acceso a esa lista.');
        const mirror = readMirrorListMarker(settings);
        if (mirror && sheetSyncReadsSheet(s.direction)) {
            throw bad(`Esa lista viene ${mirrorFromPlace(mirror)}: sólo se puede copiar a la hoja. Elige «De la app a la hoja».`);
        }
        const hidden = hiddenFieldsFor(settings, actor);
        const fields: Field[] = await this.fields.listByListId(tenantId, list.id);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const check = (f: Field | undefined, what: string): Field => {
            if (!f) throw bad(`${what} apunta a un campo que no es de esa lista.`);
            if (hidden.has(f.slug)) throw bad(`«${f.label}» está oculto para ti: no se puede sincronizar.`);
            if (!(SHEET_SYNC_FIELD_TYPES as readonly string[]).includes(f.type)) {
                throw bad(`«${f.label}» no se puede sincronizar con una hoja (es un campo calculado, de archivos o de otro tipo especial).`);
            }
            return f;
        };
        const seenFields = new Set<number>();
        const seenColumns = new Set<string>([normalizeSheetHeader(s.key.column)]);
        if (s.key.mode === 'field') {
            const kf = check(byId.get(s.key.field_id), 'La columna clave');
            if (!(SHEET_SYNC_KEY_TYPES as readonly string[]).includes(kf.type)) {
                throw bad(`«${kf.label}» no puede ser la clave: elige un campo de texto, número, email, teléfono o enlace.`);
            }
            seenFields.add(kf.id);
        }
        for (const m of s.columns) {
            const f = check(byId.get(m.field_id), `La columna «${m.column}»`);
            if (s.key.mode === 'field' && f.id === s.key.field_id) {
                if (normalizeSheetHeader(m.column) !== normalizeSheetHeader(s.key.column)) throw bad(`«${f.label}» ya es la clave: no la mapees a otra columna.`);
                continue;
            }
            if (seenFields.has(f.id)) throw bad(`Dos columnas van al mismo campo «${f.label}».`);
            seenFields.add(f.id);
            const n = normalizeSheetHeader(m.column);
            if (n === '' || seenColumns.has(n)) throw bad(`La columna «${m.column}» está repetida (o es la columna clave).`);
            seenColumns.add(n);
        }
        if (s.columns.length === 0 && s.key.mode === 'app_id') throw bad('Elige al menos una columna para sincronizar.');
        // La columna clave del modo «ID de la app» no puede ser una columna de datos.
        if (s.key.mode === 'app_id' && findSheetColumn(s.columns.map((c) => c.column), s.key.column) >= 0) {
            throw bad(`«${s.key.column}» es la columna del ID: elige otro nombre para la columna de datos.`);
        }
    }

    private async requireSheetsConnection(tenantId: number, actor: AclSubject, connectionId: number) {
        const conn = await this.connectors.editableConnection(tenantId, actor.userId, actor.role, connectionId);
        if (conn.provider !== 'google_sheets') throw bad('Esa conexión no es de Google Sheets.');
        return conn;
    }

    private async requireSync(tenantId: number, actor: AclSubject, syncId: number) {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(sheetSyncs).where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.id, syncId))).limit(1);
            return r ?? null;
        });
        if (!row) throw new NotFoundException({ code: 'sheet_sync_not_found', message: 'Esa sincronización no existe.', data: { status: 404 } });
        const conn = await this.requireSheetsConnection(tenantId, actor, row.connectionId);
        return { row, conn };
    }

    private async linkedCounts(tenantId: number, ids: number[]): Promise<Map<number, number>> {
        if (ids.length === 0) return new Map();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ syncId: sheetSyncRows.syncId, n: count() })
                .from(sheetSyncRows)
                .where(and(eq(sheetSyncRows.tenantId, tenantId), inArray(sheetSyncRows.syncId, ids), eq(sheetSyncRows.removed, false)))
                .groupBy(sheetSyncRows.syncId),
        );
        return new Map(rows.map((r) => [r.syncId, Number(r.n)]));
    }

    private async toDto(tenantId: number, row: SheetSyncRow, connectionName: string, linked: number): Promise<SheetSync> {
        const s = readSheetSyncSettings(row.settings);
        const st = (row.state ?? {}) as Record<string, unknown>;
        const list = await this.listsService.get(tenantId, String(row.listId)).catch(() => null);
        const status: SheetSyncStatus = {
            running: st.running === true,
            queued: st.queued === true,
            initial_done: st.initial_done === true,
            last_run_at: str(st.last_run_at),
            last_success_at: str(st.last_success_at),
            next_run_at: row.enabled && row.nextRunAt ? row.nextRunAt.toISOString() : null,
            last_error: str(st.last_error),
            notes: Array.isArray(st.notes) ? (st.notes as string[]) : [],
            last_result: st.last_result && typeof st.last_result === 'object' ? (st.last_result as SheetSyncStatus['last_result']) : null,
            errors: Array.isArray(st.errors) ? (st.errors as SheetSyncStatus['errors']) : [],
            conflicts: Array.isArray(st.conflicts) ? (st.conflicts as SheetSyncStatus['conflicts']) : [],
        };
        return {
            id: row.id,
            connection_id: row.connectionId,
            connection_name: connectionName,
            name: row.name,
            list_id: row.listId,
            list_name: list?.name ?? null,
            list_slug: list?.slug ?? null,
            spreadsheet_id: s.spreadsheet_id,
            spreadsheet_title: s.spreadsheet_title,
            spreadsheet_url: spreadsheetUrl(s.spreadsheet_id, s.sheet_gid),
            sheet_gid: s.sheet_gid,
            sheet_title: s.sheet_title,
            header_row: s.header_row,
            direction: s.direction,
            key: s.key,
            columns: s.columns,
            on_sheet_delete: s.on_sheet_delete,
            on_app_delete: s.on_app_delete,
            interval_minutes: s.interval_minutes,
            enabled: row.enabled,
            linked,
            status,
            created_at: row.createdAt.toISOString(),
        };
    }
}

function settingsOf(input: CreateSheetSyncInput): Omit<SheetSyncSettings, 'spreadsheet_title' | 'sheet_title'> {
    return {
        spreadsheet_id: input.spreadsheet_id,
        sheet_gid: input.sheet_gid,
        header_row: input.header_row,
        direction: input.direction,
        key: input.key,
        columns: input.columns,
        on_sheet_delete: input.on_sheet_delete,
        on_app_delete: input.on_app_delete,
        interval_minutes: input.interval_minutes,
    };
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : null;
}

function bad(message: string, code = 'sheet_sync_invalid'): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}
