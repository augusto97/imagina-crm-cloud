import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    SHEET_SYNC_FIELD_TYPES,
    SHEET_SYNC_KEY_TYPES,
    SHEET_SYNC_MAX_COLUMNS,
    SHEET_SYNC_MAX_ROWS,
    effectiveCapabilities,
    findSheetColumn,
    mirrorFromPlace,
    nextSheetSyncRun,
    quoteSheetTitle,
    readMirrorListMarker,
    readSheetSyncSettings,
    sheetColumnLetter,
    sheetSyncReadsSheet,
    type Field,
    type Role,
    type SheetSyncDryRun,
    type SheetSyncRunResult,
    type SheetSyncSettings,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import { planModuleOff } from '../billing/plan-module-gate';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import { customRoles, lists, memberships, records, sheetSyncRows, sheetSyncs, users, type SheetRowSnapshot } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { planSelectExpansion } from '../import/import.service';
import { IncidentHub } from '../incidents/incident-hub';
import { effectivePermissions, hiddenFieldsFor, type AclSubject } from '../lists/list-acl';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { releaseRedisLock } from '../redis/redis-lock';
import { removeGoneInTx, reviveInTx } from '../sync/source-gone';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { readTenantFormat } from '../tenancy/tenant-format';
import { TenantDb } from '../tenancy/tenant-db.service';
import { planSheetSync, sheetKeyOf, type LinkIn, type PlannedCellWrite, type PlannedLink, type SheetPlan } from './sheet-sync.plan';
import { cellCanon, type SheetValueCtx } from './sheet-values';
import { SHEETS_API_DEFAULT, SheetsApi, SheetsApiError, tabRange, type SheetsTab } from './sheets-api';

/** Filas por transacción al escribir en la app. */
const WRITE_CHUNK = 500;
/** Celdas por pedido de escritura a la hoja. */
const CELLS_PER_REQUEST = 2000;
/** Filas por pedido al agregar a la hoja. */
const APPEND_CHUNK = 1000;
/** Vida del candado de una corrida. */
const LOCK_TTL_MS = 15 * 60_000;
/** Ejemplos de «Probar». */
const SAMPLE_SIZE = 15;
/** Lo que dice la actividad de un registro que se fue (o volvió) por la hoja. */
const SOURCE_NAME = 'Google Sheets';

/** Lo que usa el candado de Redis (tipado chico: los tests usan uno en memoria). */
export interface SheetSyncLockStore {
    set(key: string, value: string, mode: 'PX', ms: number, nx: 'NX'): Promise<unknown>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
}

/** La corrida no puede seguir: el motivo se muestra en la sincronización. */
export class SheetSyncFatal extends Error {
    constructor(
        message: string,
        /** Lo arregla la persona (abre un problema); `false` = algo pasajero. */
        readonly needsUser = true,
    ) {
        super(message);
    }
}

interface Outcome {
    result: SheetSyncRunResult;
    plan: SheetPlan;
    /** Aviso que no impidió la corrida (tope del plan, la hoja falló al escribir). */
    warning: string | null;
}

/**
 * v0.1.459 (G3) — El motor de la sincronización con Google Sheets.
 *
 * Una corrida: lee la pestaña completa en UN pedido, la empareja con la lista
 * por la columna clave, arma el plan (puro, `sheet-sync.plan.ts`) y lo aplica:
 *  1. en la app (en tramos de 500 por transacción): altas, cambios, papelera;
 *  2. guarda los vínculos con lo sincronizado HASTA AQUÍ;
 *  3. en la hoja: encabezados que faltan, celdas (un pedido), filas que se
 *     borran y filas nuevas al final — antes vuelve a leer la columna clave,
 *     así una fila que alguien movió mientras tanto no recibe datos ajenos;
 *  4. deja los vínculos al día con lo que SÍ se escribió en la hoja: si la
 *     hoja falló a mitad, la próxima corrida lo reintenta.
 *
 * Escribe directo en `records` (como las otras sincronizaciones): nunca pasa
 * por el aviso de cambios, así lo que llega de la hoja no vuelve a la hoja. La
 * primera corrida no deja actividad ni dispara automatizaciones; las
 * siguientes sí, con el antes y el después.
 */
@Injectable()
export class SheetSyncEngine {
    private readonly logger = new Logger(SheetSyncEngine.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly connectors: ConnectorsService,
        private readonly fields: FieldsService,
        private readonly billing: BillingService,
        private readonly activity: ActivityService,
        private readonly automations: AutomationDispatcher,
        private readonly realtime: RealtimeService,
        @Inject(REDIS) private readonly redis: SheetSyncLockStore,
        @Inject(ENV) private readonly env: Pick<Env, 'GOOGLE_SHEETS_API_URL'>,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    // ── Corrida ─────────────────────────────────────────────────────────────

    /** `false` = otra corrida de la misma sincronización la tenía tomada. */
    async run(tenantId: number, syncId: number): Promise<boolean> {
        const lockKey = `sheetsync:lock:${syncId}`;
        const token = randomUUID();
        const got = await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
        if (got !== 'OK') return false;
        const startedAt = new Date();
        try {
            await this.saveState(tenantId, syncId, { running: true, queued: false, last_run_at: startedAt.toISOString() });
            let outcome: Outcome | null = null;
            let fatal: SheetSyncFatal | null = null;
            try {
                outcome = await this.execute(tenantId, syncId, false);
            } catch (err) {
                fatal = asFatal(err);
                if (!(err instanceof SheetSyncFatal) && !(err instanceof SheetsApiError)) {
                    this.logger.error(`Sincronización con Google Sheets #${syncId} falló: ${fatal.message}`);
                }
            }
            const row = await this.load(tenantId, syncId);
            if (!row) return true;
            const settings = readSheetSyncSettings(row.settings);
            const next = row.enabled ? nextSheetSyncRun(settings.interval_minutes, new Date()) : null;
            const patch: Record<string, unknown> = { running: false, queued: false };
            if (outcome) {
                patch.last_result = outcome.result;
                patch.errors = outcome.plan.errors;
                patch.conflicts = outcome.plan.conflicts;
                patch.notes = outcome.plan.notes;
                patch.initial_done = true;
                patch.last_error = outcome.warning;
                patch.last_success_at = startedAt.toISOString();
            } else {
                patch.last_error = fatal?.message ?? 'Falló la sincronización.';
            }
            await this.saveState(tenantId, syncId, patch, next);
            const key = incidentKey(row.connectionId, row.id);
            const problem = outcome ? outcome.warning : fatal && fatal.needsUser ? fatal.message : null;
            if (problem) {
                this.incidents?.report({
                    tenantId,
                    key,
                    source: 'sheet_sync',
                    sourceId: row.connectionId,
                    listId: row.listId,
                    ownerId: row.createdBy,
                    title: outcome ? `La sincronización «${row.name}» con Google Sheets no terminó todo` : `Falló la sincronización «${row.name}» con Google Sheets`,
                    message: problem,
                });
            } else if (outcome) {
                this.incidents?.resolve(tenantId, key);
            }
            return true;
        } finally {
            await releaseRedisLock(this.redis, lockKey, token);
        }
    }

    /** Qué haría la próxima corrida, sin escribir nada (ni en la app ni en la hoja). */
    async dryRun(tenantId: number, syncId: number): Promise<SheetSyncDryRun> {
        let out: Outcome;
        try {
            out = await this.execute(tenantId, syncId, true);
        } catch (err) {
            throw asFatal(err);
        }
        return { result: out.result, notes: out.plan.notes, errors: out.plan.errors, conflicts: out.plan.conflicts, sample: out.plan.sample };
    }

    /** La sincronización se borró: su problema abierto (si había) se cierra. */
    forgetIncident(tenantId: number, connectionId: number, syncId: number): void {
        this.incidents?.resolve(tenantId, incidentKey(connectionId, syncId));
    }

    /** El cliente de la API con el token VIGENTE de la conexión (uno por corrida). */
    apiFor(tenantId: number, connectionId: number): SheetsApi {
        let token: Promise<string> | null = null;
        return new SheetsApi({
            apiBase: this.env.GOOGLE_SHEETS_API_URL || SHEETS_API_DEFAULT,
            token: () => {
                token ??= this.connectors.oauthAccessToken(tenantId, connectionId).catch((err: unknown) => {
                    token = null;
                    throw new SheetsApiError(
                        `No se pudo usar la conexión con Google Sheets: ${err instanceof Error ? err.message : String(err)}`,
                        401,
                        true,
                    );
                });
                return token;
            },
        });
    }

    // ── El trabajo ──────────────────────────────────────────────────────────

    private async execute(tenantId: number, syncId: number, dry: boolean): Promise<Outcome> {
        const started = Date.now();
        const row = await this.load(tenantId, syncId);
        if (!row) throw new SheetSyncFatal('La sincronización ya no existe.');
        const settings = readSheetSyncSettings(row.settings);
        const state = (row.state ?? {}) as Record<string, unknown>;
        const dispatch = !dry && state.initial_done === true;
        const reads = sheetSyncReadsSheet(settings.direction);

        if (!dry) {
            const blocked = await this.tenantDb.withTenant(tenantId, async (tx) => {
                // SEC-34: una empresa en solo lectura (ADR-S09) no sincroniza sola.
                if (await tenantIsReadOnly(tx, tenantId)) return 'La empresa está en solo lectura (plan vencido o suspendido): la sincronización está en pausa.';
                if (await planModuleOff(tx, tenantId, 'integrations')) return 'El plan de la empresa no incluye las integraciones: la sincronización está en pausa.';
                return null;
            });
            if (blocked) throw new SheetSyncFatal(blocked);
        }

        // La lista y quien armó la sincronización, HOY: nunca viaja a la hoja
        // un campo que esa persona no puede ver.
        const list = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [l] = await tx
                .select({ id: lists.id, name: lists.name, settings: lists.settings, deletedAt: lists.deletedAt })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, row.listId)))
                .limit(1);
            return l ?? null;
        });
        if (!list || list.deletedAt) throw new SheetSyncFatal('La lista ya no existe (o está en la papelera).');
        const listSettings = (list.settings ?? {}) as Record<string, unknown>;
        const mirror = readMirrorListMarker(listSettings);
        if (mirror && reads) {
            throw new SheetSyncFatal(`Esa lista viene ${mirrorFromPlace(mirror)}: sólo se puede copiar a la hoja («De la app a la hoja»).`);
        }
        const actor = row.createdBy ? await this.actorFor(tenantId, row.createdBy) : null;
        if (!actor) {
            throw new SheetSyncFatal('Quien armó la sincronización ya no es del equipo (o su cuenta está desactivada): ábrela y guárdala de nuevo para que quede a tu nombre.');
        }
        if (effectivePermissions(listSettings, actor).view === 'none') {
            throw new SheetSyncFatal('Quien armó la sincronización ya no puede ver esa lista: que la guarde de nuevo alguien con acceso.');
        }
        const hidden = hiddenFieldsFor(listSettings, actor);

        // Los campos de HOY: una columna que apunta a un campo borrado (u
        // oculto para quien la armó) se saltea con un aviso.
        let fields = await this.fields.listByListId(tenantId, row.listId);
        const usable = (f: Field | undefined): f is Field => !!f && (SHEET_SYNC_FIELD_TYPES as readonly string[]).includes(f.type) && !hidden.has(f.slug);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const notes: string[] = [];
        let keyField: Field | null = null;
        if (settings.key.mode === 'field') {
            const kf = byId.get(settings.key.field_id);
            if (!usable(kf) || !(SHEET_SYNC_KEY_TYPES as readonly string[]).includes(kf.type)) {
                throw new SheetSyncFatal('El campo clave de la lista ya no existe (o ya no se puede usar): elige otro en la sincronización.');
            }
            keyField = kf;
        }
        let columns: Array<{ name: string; field: Field }> = [];
        for (const m of settings.columns) {
            const f = byId.get(m.field_id);
            if (!usable(f)) {
                notes.push(`La columna «${m.column}» apunta a un campo que ya no existe o que no se puede sincronizar: se saltea.`);
                continue;
            }
            columns.push({ name: m.column, field: f });
        }

        // La planilla: la pestaña por su id (sigue funcionando si la renombran).
        const api = this.apiFor(tenantId, row.connectionId);
        const meta = await api.spreadsheet(settings.spreadsheet_id);
        const tab = meta.tabs.find((t) => t.gid === settings.sheet_gid);
        if (!tab) throw new SheetSyncFatal('La pestaña elegida ya no existe en la planilla: elige otra en la sincronización.');
        if (!dry && (meta.title !== settings.spreadsheet_title || tab.title !== settings.sheet_title)) {
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .update(sheetSyncs)
                    .set({ settings: sql`${sheetSyncs.settings} || ${JSON.stringify({ spreadsheet_title: meta.title, sheet_title: tab.title })}::jsonb` })
                    .where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.id, syncId))),
            );
        }
        const { headers, dataRows, truncated } = await readTab(api, settings.spreadsheet_id, tab, settings.header_row);

        const format = await readTenantFormat(this.tenantDb, tenantId);
        const ctx: SheetValueCtx = { numberFormat: format.number_format, dateFormat: format.date_format, timeZone: format.timezone ?? 'UTC' };

        // Opciones de una selección que trae la hoja y la lista no tiene: se
        // agregan (como el import). En «Probar», sólo en memoria.
        if (reads) {
            columns = await this.expandOptions(tenantId, row.listId, headers, dataRows, columns, dry);
            if (!dry) {
                fields = await this.fields.listByListId(tenantId, row.listId);
                const fresh = new Map(fields.map((f) => [f.id, f]));
                columns = columns.map((c) => ({ ...c, field: fresh.get(c.field.id) ?? c.field }));
                if (keyField) keyField = fresh.get(keyField.id) ?? keyField;
            }
        }

        const { recordsIn, recordsTruncated } = await this.loadRecords(tenantId, row.listId);
        const linksIn = await this.loadLinks(tenantId, syncId);
        const plan = planSheetSync({
            settings,
            headers,
            columns,
            keyField,
            rows: dataRows,
            records: recordsIn,
            links: linksIn,
            sheetTruncated: truncated,
            recordsTruncated,
            ctx,
            sampleSize: dry ? SAMPLE_SIZE : 0,
        });
        plan.notes.unshift(...notes);
        if (plan.keyCol < 0) throw new SheetSyncFatal(plan.notes[plan.notes.length - 1] ?? 'La hoja no tiene la columna clave.');

        const result: SheetSyncRunResult = {
            read: plan.read,
            created: plan.creates.length,
            updated: plan.updates.length,
            cells_written: plan.writes.length + plan.creates.filter((c) => c.writeId).length,
            rows_added: plan.appends.length,
            rows_deleted: plan.deletes.length,
            trashed: plan.trash.length,
            unchanged: plan.unchanged,
            failed: plan.failed,
            conflicts: plan.conflicts.length,
            truncated,
            elapsed_ms: 0,
        };
        if (dry) {
            result.elapsed_ms = Date.now() - started;
            return { result, plan, warning: null };
        }

        // ── 1. La app ────────────────────────────────────────────────────────
        const warnings: string[] = [];
        let creates = plan.creates;
        if (creates.length > 0) {
            try {
                await this.billing.assertCanCreateRecords(tenantId, creates.length);
            } catch (err) {
                warnings.push(`No se crearon ${creates.length} registros nuevos: ${errMessage(err)}`);
                creates = [];
            }
        }
        const idWrites: PlannedCellWrite[] = [];
        result.created = await this.writeCreates(tenantId, row.listId, syncId, row.createdBy!, plan.keyCol, creates, idWrites, dispatch);
        result.updated = await this.writeUpdates(tenantId, row.listId, plan.updates, dispatch);
        if (plan.trash.length > 0 || plan.revive.length > 0) {
            result.trashed = await this.tenantDb.withTenant(tenantId, async (tx) => {
                await reviveInTx(tx, this.activity, tenantId, row.listId, plan.revive, SOURCE_NAME);
                return removeGoneInTx(tx, this.activity, tenantId, row.listId, SOURCE_NAME, plan.trash);
            });
        }

        // ── 2. Los vínculos, con lo sincronizado hasta aquí ──────────────────
        const original = new Map(linksIn.map((l) => [l.recordId, l]));
        await this.saveLinks(
            tenantId,
            syncId,
            plan.links.map((l) => ({ ...l, snapshot: l.snapshotBefore })),
            original,
        );
        await this.dropLinks(tenantId, syncId, plan.dropLinks);
        if (result.created + result.updated + result.trashed + plan.revive.length > 0) this.realtime.records(tenantId, row.listId);

        // ── 3. La hoja ───────────────────────────────────────────────────────
        const writes = [...plan.writes, ...idWrites];
        const sheet = await this.writeSheet(api, settings, tab, plan, writes);
        if (sheet.warning) warnings.push(sheet.warning);
        result.cells_written = sheet.cellsWritten;
        result.rows_deleted = sheet.deleted.length;
        result.rows_added = sheet.appended.length;
        if (sheet.dropped > 0) {
            plan.notes.push('La hoja cambió mientras se sincronizaba: algunas celdas no se escribieron. Se reintenta en la próxima corrida.');
        }

        // ── 4. Los vínculos, con lo que sí quedó en la hoja ──────────────────
        const okRecords = sheet.okRecords;
        const after: Array<PlannedLink & { snapshot: SheetRowSnapshot }> = [];
        for (const l of plan.links) {
            if (l.dependsOnSheet && okRecords.has(l.recordId)) after.push({ ...l, snapshot: l.snapshotAfter });
        }
        for (const c of creates) {
            if (!c.writeId) continue;
            const id = c.recordId;
            if (id && okRecords.has(id)) {
                after.push({
                    recordId: id,
                    rowKey: String(id),
                    snapshotBefore: c.snapshot,
                    snapshotAfter: c.snapshot,
                    snapshot: c.snapshot,
                    fingerprint: c.fingerprint,
                    removed: false,
                    dependsOnSheet: true,
                });
            }
        }
        for (const a of plan.appends) {
            if (!sheet.appended.includes(a.recordId)) continue;
            after.push({ recordId: a.recordId, rowKey: a.key, snapshotBefore: a.snapshot, snapshotAfter: a.snapshot, snapshot: a.snapshot, fingerprint: a.fingerprint, removed: false, dependsOnSheet: true });
        }
        await this.saveLinks(tenantId, syncId, after, new Map());
        await this.dropLinks(tenantId, syncId, sheet.deleted);

        result.elapsed_ms = Date.now() - started;
        return { result, plan, warning: warnings.length > 0 ? warnings.join(' ') : null };
    }

    /**
     * Escribe en la hoja lo que dice el plan. Antes vuelve a leer la columna
     * clave: una celda va a la fila que HOY tiene esa clave (si alguien
     * insertó o movió filas mientras tanto) y, si ya no se encuentra, no se
     * escribe — la próxima corrida lo reintenta.
     */
    private async writeSheet(
        api: SheetsApi,
        settings: SheetSyncSettings,
        tab: SheetsTab,
        plan: SheetPlan,
        writes: PlannedCellWrite[],
    ): Promise<{ cellsWritten: number; deleted: number[]; appended: number[]; okRecords: Set<number>; dropped: number; warning: string | null }> {
        const out = { cellsWritten: 0, deleted: [] as number[], appended: [] as number[], okRecords: new Set<number>(), dropped: 0, warning: null as string | null };
        if (writes.length === 0 && plan.deletes.length === 0 && plan.appends.length === 0 && plan.headerWrites.length === 0) return out;
        const id = settings.spreadsheet_id;
        const failedRecords = new Set<number>();
        try {
            // Encabezados que faltan (y columnas, si la pestaña no alcanza).
            if (plan.headerWrites.length > 0) {
                if (plan.width > tab.columns) await api.addColumns(id, tab.gid, plan.width - tab.columns);
                await api.writeCells(
                    id,
                    tab.title,
                    plan.headerWrites.map((h) => ({ row: settings.header_row, col: h.col, value: h.name })),
                );
            }
            // La columna clave, como está AHORA.
            const keyField = settings.key.mode === 'field' ? plan.columns.find((c) => c.index === plan.keyCol)?.field ?? null : null;
            const fresh = writes.length > 0 || plan.deletes.length > 0 ? await readKeyColumn(api, id, tab, settings.header_row, plan.keyCol, keyField) : null;
            const verified: PlannedCellWrite[] = [];
            for (const w of writes) {
                const target = fresh ? retarget(fresh, w.row, w.expectKey) : w.row;
                if (target === null) {
                    out.dropped++;
                    failedRecords.add(w.recordId);
                    continue;
                }
                verified.push({ ...w, row: target });
            }
            for (let i = 0; i < verified.length; i += CELLS_PER_REQUEST) {
                const chunk = verified.slice(i, i + CELLS_PER_REQUEST);
                await api.writeCells(id, tab.title, chunk);
                out.cellsWritten += chunk.length;
            }
            for (const w of verified) if (!failedRecords.has(w.recordId)) out.okRecords.add(w.recordId);
            // Filas de registros que se borraron en la app.
            if (plan.deletes.length > 0) {
                const rows: number[] = [];
                for (const d of plan.deletes) {
                    const target = fresh ? retarget(fresh, d.row, d.key) : d.row;
                    if (target === null) continue;
                    rows.push(target);
                    out.deleted.push(d.recordId);
                }
                await api.deleteRows(id, tab.gid, rows);
            }
            // Registros nuevos de la app: filas al final.
            for (let i = 0; i < plan.appends.length; i += APPEND_CHUNK) {
                const chunk = plan.appends.slice(i, i + APPEND_CHUNK);
                await api.appendRows(id, tab.title, settings.header_row, plan.width, chunk.map((a) => a.cells));
                out.appended.push(...chunk.map((a) => a.recordId));
            }
        } catch (err) {
            // Lo que no llegó deja su vínculo como estaba: la próxima corrida lo reintenta.
            out.warning = `No se pudo escribir todo en la hoja: ${err instanceof Error ? err.message : String(err)} Lo que faltó se reintenta en la próxima corrida.`;
        }
        return out;
    }

    // ── Escribir en la app ────────────────────────────────────────────────────

    private async writeCreates(
        tenantId: number,
        listId: number,
        syncId: number,
        actorId: number,
        keyCol: number,
        rows: SheetPlan['creates'],
        idWrites: PlannedCellWrite[],
        dispatch: boolean,
    ): Promise<number> {
        let created = 0;
        for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
            const chunk = rows.slice(i, i + WRITE_CHUNK);
            const ids = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const inserted = await tx
                    .insert(records)
                    .values(chunk.map((c) => ({ tenantId, listId, data: c.data, createdBy: actorId, updatedBy: 0 })))
                    .returning({ id: records.id });
                // El vínculo nace CON el registro: si escribir el ID en la hoja
                // falla, la próxima corrida reconoce la fila por su huella (`p`).
                await tx
                    .insert(sheetSyncRows)
                    .values(
                        inserted.map((r, j) => {
                            const c = chunk[j]!;
                            return {
                                tenantId,
                                syncId,
                                recordId: r.id,
                                rowKey: c.writeId ? String(r.id) : c.key,
                                snapshot: c.writeId ? { ...c.snapshot, p: 1 as const } : c.snapshot,
                                fingerprint: c.fingerprint,
                                removed: false,
                            };
                        }),
                    )
                    .onConflictDoNothing();
                if (dispatch) {
                    for (const [j, r] of inserted.entries()) {
                        await this.activity.logInTx(tx, {
                            tenantId,
                            listId,
                            recordId: r.id,
                            userId: null,
                            action: 'record_created',
                            diff: computeDiff({}, chunk[j]!.data),
                        });
                    }
                }
                return inserted.map((r) => r.id);
            });
            ids.forEach((id, j) => {
                const c = chunk[j]!;
                c.recordId = id;
                if (c.writeId) idWrites.push({ row: c.row, col: keyCol, value: id, expectKey: c.expectKey, recordId: id });
            });
            created += ids.length;
            if (dispatch) {
                ids.forEach((id, j) => this.automations.dispatch({ tenantId, listId, recordId: id, trigger: 'record_created', after: chunk[j]!.data }));
            }
        }
        return created;
    }

    private async writeUpdates(tenantId: number, listId: number, rows: SheetPlan['updates'], dispatch: boolean): Promise<number> {
        let updated = 0;
        for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
            const chunk = rows.slice(i, i + WRITE_CHUNK);
            const done = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const out: Array<{ id: number; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
                for (const u of chunk) {
                    // `||` mezcla SÓLO lo que cambió: lo que alguien editó en otra
                    // columna mientras corría la sincronización no se pisa.
                    const [r] = await tx
                        .update(records)
                        .set({ data: sql`${records.data} || ${JSON.stringify(u.patch)}::jsonb`, updatedAt: new Date(), updatedBy: 0 })
                        .where(and(eq(records.tenantId, tenantId), eq(records.id, u.recordId), isNull(records.deletedAt)))
                        .returning({ data: records.data });
                    if (!r) continue;
                    const after = (r.data ?? {}) as Record<string, unknown>;
                    if (dispatch) {
                        await this.activity.logInTx(tx, {
                            tenantId,
                            listId,
                            recordId: u.recordId,
                            userId: null,
                            action: 'record_updated',
                            diff: computeDiff(u.before, after),
                        });
                    }
                    out.push({ id: u.recordId, before: u.before, after });
                }
                return out;
            });
            updated += done.length;
            if (dispatch) {
                for (const d of done) {
                    this.automations.dispatch({ tenantId, listId, recordId: d.id, trigger: 'record_updated', after: d.after, before: d.before });
                }
            }
        }
        return updated;
    }

    /** Opciones nuevas de una selección que llegan desde la hoja (como el import). */
    private async expandOptions(
        tenantId: number,
        listId: number,
        headers: string[],
        rows: Array<{ cells: unknown[] }>,
        columns: Array<{ name: string; field: Field }>,
        dry: boolean,
    ): Promise<Array<{ name: string; field: Field }>> {
        const out: Array<{ name: string; field: Field }> = [];
        for (const c of columns) {
            if (c.field.type !== 'select' && c.field.type !== 'multi_select') {
                out.push(c);
                continue;
            }
            const index = findSheetColumn(headers, c.name);
            if (index < 0) {
                out.push(c);
                continue;
            }
            const raw = new Set<string>();
            for (const r of rows) {
                const text = cellCanon(r.cells[index]);
                if (text === '') continue;
                if (c.field.type === 'multi_select') text.split(/[,;]/).forEach((v) => v.trim() && raw.add(v.trim()));
                else raw.add(text);
            }
            const added = planSelectExpansion(c.field, raw);
            if (added.length === 0) {
                out.push(c);
                continue;
            }
            const options = [...((c.field.config as { options?: unknown[] }).options ?? []), ...added];
            const field = { ...c.field, config: { ...c.field.config, options } } as Field;
            if (!dry) await this.fields.update(tenantId, String(listId), String(field.id), { config: field.config });
            out.push({ name: c.name, field });
        }
        return out;
    }

    // ── Lecturas ──────────────────────────────────────────────────────────────

    private async loadRecords(tenantId: number, listId: number): Promise<{ recordsIn: Array<{ id: number; data: Record<string, unknown> }>; recordsTruncated: boolean }> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt)))
                .orderBy(asc(records.id))
                .limit(SHEET_SYNC_MAX_ROWS + 1),
        );
        return {
            recordsIn: rows.slice(0, SHEET_SYNC_MAX_ROWS).map((r) => ({ id: r.id, data: (r.data ?? {}) as Record<string, unknown> })),
            recordsTruncated: rows.length > SHEET_SYNC_MAX_ROWS,
        };
    }

    private async loadLinks(tenantId: number, syncId: number): Promise<LinkIn[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    recordId: sheetSyncRows.recordId,
                    rowKey: sheetSyncRows.rowKey,
                    snapshot: sheetSyncRows.snapshot,
                    fingerprint: sheetSyncRows.fingerprint,
                    removed: sheetSyncRows.removed,
                    deletedAt: records.deletedAt,
                })
                .from(sheetSyncRows)
                .innerJoin(records, eq(records.id, sheetSyncRows.recordId))
                .where(and(eq(sheetSyncRows.tenantId, tenantId), eq(sheetSyncRows.syncId, syncId))),
        );
        return rows.map((r) => ({
            recordId: r.recordId,
            rowKey: r.rowKey,
            snapshot: (r.snapshot ?? {}) as SheetRowSnapshot,
            fingerprint: r.fingerprint,
            removed: r.removed,
            trashed: r.deletedAt !== null,
        }));
    }

    /** Guarda los vínculos que cambiaron (los que quedan igual no se tocan). */
    private async saveLinks(
        tenantId: number,
        syncId: number,
        links: Array<Pick<PlannedLink, 'recordId' | 'rowKey' | 'fingerprint' | 'removed'> & { snapshot: SheetRowSnapshot }>,
        original: Map<number, LinkIn>,
    ): Promise<void> {
        const changed = links.filter((l) => {
            const o = original.get(l.recordId);
            return !o || o.rowKey !== l.rowKey || o.removed !== l.removed || o.fingerprint !== l.fingerprint || JSON.stringify(o.snapshot) !== JSON.stringify(l.snapshot);
        });
        for (let i = 0; i < changed.length; i += WRITE_CHUNK) {
            const chunk = changed.slice(i, i + WRITE_CHUNK);
            const values = chunk.map((l) => ({
                tenantId,
                syncId,
                recordId: l.recordId,
                rowKey: l.rowKey.slice(0, 190),
                snapshot: l.snapshot,
                fingerprint: l.fingerprint,
                removed: l.removed,
                updatedAt: new Date(),
            }));
            const upsert = (vs: typeof values) =>
                this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .insert(sheetSyncRows)
                        .values(vs)
                        .onConflictDoUpdate({
                            target: [sheetSyncRows.syncId, sheetSyncRows.recordId],
                            set: {
                                rowKey: sql`excluded.row_key`,
                                snapshot: sql`excluded.snapshot`,
                                fingerprint: sql`excluded.fingerprint`,
                                removed: sql`excluded.removed`,
                                updatedAt: sql`excluded.updated_at`,
                            },
                        }),
                );
            try {
                await upsert(values);
            } catch {
                // Dos vínculos que intercambian su clave en el mismo tramo: de a uno
                // (el que choca queda para la próxima corrida).
                for (const v of values) await upsert([v]).catch(() => undefined);
            }
        }
    }

    private async dropLinks(tenantId: number, syncId: number, recordIds: number[]): Promise<void> {
        if (recordIds.length === 0) return;
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(sheetSyncRows).where(and(eq(sheetSyncRows.tenantId, tenantId), eq(sheetSyncRows.syncId, syncId), inArray(sheetSyncRows.recordId, recordIds))),
        );
    }

    /** El acceso VIGENTE de quien armó la sincronización (`null` si ya no es del equipo). */
    private async actorFor(tenantId: number, userId: number): Promise<AclSubject | null> {
        const [r] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    role: memberships.role,
                    teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
                    customRoleId: memberships.customRoleId,
                    customCaps: customRoles.capabilities,
                })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .leftJoin(customRoles, and(eq(customRoles.id, memberships.customRoleId), eq(customRoles.tenantId, memberships.tenantId)))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), isNull(users.disabledAt)))
                .limit(1),
        );
        if (!r || r.role === 'client' || r.role === 'guest') return null;
        const custom = r.customCaps ? (r.customCaps as string[]) : null;
        return {
            userId,
            role: r.role as Role,
            teamIds: (r.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
            customRoleId: custom ? r.customRoleId : null,
            capabilities: effectiveCapabilities(r.role as Role, custom),
        };
    }

    private async load(tenantId: number, syncId: number) {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(sheetSyncs).where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.id, syncId))).limit(1);
            return r ?? null;
        });
    }

    /** Mezcla en `state` (nunca pisa `settings`, que edita la persona). */
    async saveState(tenantId: number, syncId: number, patch: Record<string, unknown>, nextRunAt?: Date | null): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(sheetSyncs)
                .set({
                    state: sql`${sheetSyncs.state} || ${JSON.stringify(patch)}::jsonb`,
                    ...(nextRunAt !== undefined ? { nextRunAt } : {}),
                })
                .where(and(eq(sheetSyncs.tenantId, tenantId), eq(sheetSyncs.id, syncId))),
        );
    }
}

// ── Piezas ─────────────────────────────────────────────────────────────────────

export function incidentKey(connectionId: number, syncId: number): string {
    return `sheet_sync:${connectionId}:${syncId}`;
}

/**
 * Lee la pestaña completa (encabezados + hasta el tope de filas) en UN
 * pedido. Se pide una fila de más para saber si la hoja sigue.
 */
export async function readTab(
    api: SheetsApi,
    spreadsheetId: string,
    tab: SheetsTab,
    headerRow: number,
    maxRows = SHEET_SYNC_MAX_ROWS,
): Promise<{ headers: string[]; dataRows: Array<{ row: number; cells: unknown[] }>; truncated: boolean }> {
    if (tab.rows > 0 && headerRow > tab.rows) return { headers: [], dataRows: [], truncated: false };
    const width = Math.max(1, Math.min(SHEET_SYNC_MAX_COLUMNS, tab.columns || SHEET_SYNC_MAX_COLUMNS));
    const last = tab.rows > 0 ? Math.min(tab.rows, headerRow + maxRows + 1) : headerRow + maxRows + 1;
    const values = await api.values(spreadsheetId, tabRange(tab.title, headerRow, last, width));
    const headers = (values[0] ?? []).map((h) => cellCanon(h));
    const body = values.slice(1);
    const truncated = body.length > maxRows;
    return {
        headers,
        dataRows: body.slice(0, maxRows).map((cells, i) => ({ row: headerRow + 1 + i, cells })),
        truncated,
    };
}

/** La columna clave como está AHORA: fila → clave, y clave → fila (si es única). */
async function readKeyColumn(
    api: SheetsApi,
    spreadsheetId: string,
    tab: SheetsTab,
    headerRow: number,
    keyCol: number,
    keyField: Pick<Field, 'id' | 'type'> | null,
): Promise<{ atRow: Map<number, string>; rowOf: Map<string, number | null> }> {
    const letter = sheetColumnLetter(keyCol);
    const last = headerRow + SHEET_SYNC_MAX_ROWS + 1;
    const values = await api.values(spreadsheetId, `${quoteSheetTitle(tab.title)}!${letter}${headerRow + 1}:${letter}${last}`);
    const atRow = new Map<number, string>();
    const rowOf = new Map<string, number | null>();
    values.forEach((r, i) => {
        const row = headerRow + 1 + i;
        const { key } = sheetKeyOf(r[0], keyField);
        atRow.set(row, key);
        if (key === '') return;
        rowOf.set(key, rowOf.has(key) ? null : row);
    });
    return { atRow, rowOf };
}

/** La fila donde HOY está la clave esperada (`null` = no se encuentra o está repetida). */
function retarget(fresh: { atRow: Map<number, string>; rowOf: Map<string, number | null> }, row: number, expectKey: string): number | null {
    if ((fresh.atRow.get(row) ?? '') === expectKey) return row;
    if (expectKey === '') return null;
    return fresh.rowOf.get(expectKey) ?? null;
}

function asFatal(err: unknown): SheetSyncFatal {
    if (err instanceof SheetSyncFatal) return err;
    if (err instanceof SheetsApiError) return new SheetSyncFatal(err.message, err.needsUser);
    return new SheetSyncFatal(err instanceof Error ? err.message : String(err), false);
}

function errMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: unknown }).getResponse === 'function') {
        const body = (err as { getResponse: () => unknown }).getResponse();
        if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
            return (body as { message: string }).message;
        }
    }
    return err instanceof Error ? err.message : String(err);
}
