import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    SQL_SYNC_MAX_ROWS,
    SQL_SYNC_FIELD_TYPES,
    nextSqlSyncRun,
    readSqlSyncSettings,
    sameBulkValue,
    validateFieldValue,
    type Field,
    type FieldType,
    type SqlSyncDryRun,
    type SqlSyncRowError,
    type SqlSyncRunResult,
    type SqlSyncSettings,
} from '@imagina-base/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import { ConnectorsService } from '../connectors/connectors.service';
import { SQL_RUNNER, SqlRunError, sqlConnParams, type SqlQueryResult, type SqlRunner } from '../connectors/sqlserver/sql-runner';
import { findColumn, sqlCellToText } from '../connectors/sqlserver/sql-values';
import { memberships, records, sqlSyncs } from '../db/schema';
import type { Tx } from '../db/client';
import { FieldsService } from '../fields/fields.service';
import { keyExpr, normalizeKey } from '../import/import-update.service';
import { coerceCellValue, planSelectExpansion } from '../import/import.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Filas por transacción al escribir. */
const WRITE_CHUNK = 500;
/** Claves por consulta al buscar los registros existentes. */
const LOOKUP_CHUNK = 1000;
/** Errores por fila que se guardan para mostrar. */
const ERROR_LIST = 50;
/** Ejemplos de la vista previa de la carga. */
const SAMPLE_SIZE = 15;
/** Vida del candado de una corrida (más que la consulta más larga + escribir). */
const LOCK_TTL_MS = 15 * 60_000;

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'percent', 'rating', 'duration'];

/** Lo que usa el candado de Redis (tipado chico: los tests usan uno en memoria). */
export interface SqlSyncLockStore {
    set(key: string, value: string, mode: 'PX', ms: number, nx: 'NX'): Promise<unknown>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
}

/** Una fila del resultado ya interpretada. */
interface PlannedRow {
    key: string;
    /** Clave tal como vino (para mostrar). */
    rawKey: string;
    /** `f{id}` → valor validado (o null para vaciar). */
    values: Record<string, unknown>;
}

export interface SqlRunOptions {
    /** Sólo calcular qué haría (vista previa de la carga): no escribe nada. */
    dry?: boolean;
}

/** La corrida no puede seguir (configuración rota, base caída…): el motivo se muestra. */
export class SqlSyncFatal extends Error {}

/**
 * El motor de la sincronización desde SQL Server (v0.1.243).
 *
 * Ejecuta la consulta, interpreta cada fila con el MISMO camino que una celda
 * de CSV (`coerceCellValue` + `validateFieldValue`) y la empareja con la lista
 * por la columna clave: si el registro existe, se escribe SÓLO lo que cambió;
 * si no, se crea. Nunca se duplica — la clave se normaliza igual que en
 * «Actualizar desde un archivo» (sin espacios ni mayúsculas; teléfono por
 * dígitos; número como número).
 *
 * Escribe directo en la tabla (como la sincronización de la tienda) en tramos
 * de 500 filas por transacción, con bitácora y automatizaciones a partir de la
 * segunda corrida. La primera carga no dispara nada.
 */
@Injectable()
export class SqlSyncEngine {
    private readonly logger = new Logger(SqlSyncEngine.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly connectors: ConnectorsService,
        private readonly fields: FieldsService,
        private readonly billing: BillingService,
        private readonly activity: ActivityService,
        private readonly automations: AutomationDispatcher,
        private readonly realtime: RealtimeService,
        @Inject(REDIS) private readonly redis: SqlSyncLockStore,
        @Inject(SQL_RUNNER) private readonly runner: SqlRunner,
    ) {}

    // ── Corrida programada / manual ─────────────────────────────────────────

    /** `false` = otra corrida de la misma sincronización la tenía tomada. */
    async run(tenantId: number, syncId: number): Promise<boolean> {
        const lockKey = `sqlsync:lock:${syncId}`;
        const token = randomUUID();
        const got = await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
        if (got !== 'OK') return false;
        const startedAt = new Date();
        try {
            await this.saveState(tenantId, syncId, { running: true, queued: false, last_run_at: startedAt.toISOString() });
            let outcome: Awaited<ReturnType<SqlSyncEngine['execute']>> | null = null;
            let fatal: string | null = null;
            try {
                outcome = await this.execute(tenantId, syncId, {});
            } catch (err) {
                fatal = err instanceof Error ? err.message : String(err);
                if (!(err instanceof SqlSyncFatal) && !(err instanceof SqlRunError)) {
                    this.logger.error(`Sincronización SQL #${syncId} falló: ${fatal}`);
                }
            }
            const row = await this.load(tenantId, syncId);
            if (!row) return true;
            const settings = readSqlSyncSettings(row.settings);
            const next = row.enabled ? nextSqlSyncRun(settings.schedule, new Date()) : null;
            const patch: Record<string, unknown> = { running: false, queued: false };
            if (outcome) {
                patch.last_result = outcome.result;
                patch.errors = outcome.errors;
                patch.initial_done = true;
                patch.last_error = outcome.warning;
                // Una corrida que terminó (aunque con avisos) cuenta como la
                // última buena: es la marca de `@ultima_sincronizacion`.
                patch.last_success_at = startedAt.toISOString();
            } else {
                patch.last_error = fatal;
            }
            await this.saveState(tenantId, syncId, patch, next);
            return true;
        } finally {
            const current = await this.redis.get(lockKey).catch(() => null);
            if (current === token) await this.redis.del(lockKey).catch(() => undefined);
        }
    }

    /** Qué haría una corrida, sin escribir nada (la «vista previa de la carga»). */
    async dryRun(tenantId: number, syncId: number): Promise<SqlSyncDryRun> {
        const out = await this.execute(tenantId, syncId, { dry: true });
        return { result: out.result, errors: out.errors, sample: out.sample };
    }

    // ── El trabajo ──────────────────────────────────────────────────────────

    private async execute(
        tenantId: number,
        syncId: number,
        opts: SqlRunOptions,
    ): Promise<{
        result: SqlSyncRunResult;
        errors: SqlSyncRowError[];
        sample: SqlSyncDryRun['sample'];
        /** Aviso que no impidió la corrida (tope del plan, filas cortadas). */
        warning: string | null;
    }> {
        const started = Date.now();
        const row = await this.load(tenantId, syncId);
        if (!row) throw new SqlSyncFatal('La sincronización ya no existe.');
        const settings = readSqlSyncSettings(row.settings);
        const state = (row.state ?? {}) as Record<string, unknown>;
        const dispatch = !opts.dry && state.initial_done === true;

        // SEC-34: una empresa en solo-lectura (ADR-S09) no trae datos sola.
        if (!opts.dry) {
            const ro = await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId));
            if (ro) throw new SqlSyncFatal('La empresa está en solo lectura (plan vencido o suspendido): la sincronización está en pausa.');
        }

        // Los campos de HOY: una columna borrada desde que se armó la
        // sincronización se saltea con un aviso, no rompe la corrida.
        let fields = await this.fields.listByListId(tenantId, row.listId);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const keyField = byId.get(settings.key_field_id);
        if (!keyField) throw new SqlSyncFatal('El campo clave de la lista ya no existe: elegí otro en la sincronización.');
        const flagField = settings.on_missing === 'flag' && settings.flag_field_id ? (byId.get(settings.flag_field_id) ?? null) : null;

        const creds = await this.connectors.integrationCredsFor(tenantId, row.connectionId);
        if (!creds) throw new SqlSyncFatal('La conexión con la base de datos ya no existe.');
        const lastSuccess = typeof state.last_success_at === 'string' ? new Date(state.last_success_at) : null;
        let res: SqlQueryResult;
        try {
            res = await this.runner.run(sqlConnParams(creds.creds.fields, creds.creds.secret), settings.source, {
                maxRows: SQL_SYNC_MAX_ROWS,
                timeoutMs: settings.timeout_seconds * 1000,
                lastSync: lastSuccess && !Number.isNaN(lastSuccess.getTime()) ? lastSuccess : null,
            });
        } catch (err) {
            if (err instanceof SqlRunError) throw err;
            throw new SqlSyncFatal(err instanceof Error ? err.message : String(err));
        }

        // Columnas del resultado (sin distinguir mayúsculas).
        const keyColumn = findColumn(res.columns, settings.key_column);
        if (!keyColumn) {
            throw new SqlSyncFatal(
                `La consulta no devuelve la columna clave «${settings.key_column}». Columnas que devolvió: ${res.columns.map((c) => c.name).join(', ') || '(ninguna)'}.`,
            );
        }
        const typeOf = new Map(res.columns.map((c) => [c.name, c.type]));
        const notes: string[] = [];
        const maps: Array<{ column: string; field: Field }> = [];
        for (const m of settings.columns) {
            const field = byId.get(m.field_id);
            const column = findColumn(res.columns, m.column);
            if (!field || !(SQL_SYNC_FIELD_TYPES as readonly string[]).includes(field.type)) {
                notes.push(`La columna «${m.column}» apunta a un campo que ya no existe o no se puede llenar desde SQL: se saltea.`);
                continue;
            }
            if (!column) {
                notes.push(`La consulta ya no devuelve la columna «${m.column}»: «${field.label}» no se actualiza.`);
                continue;
            }
            if (field.id === keyField.id) continue;
            maps.push({ column, field });
        }

        // Opciones de select que la base trae y la lista no tiene: se agregan
        // (igual que el import). En la vista previa sólo en memoria.
        for (const m of maps) {
            if (m.field.type !== 'select' && m.field.type !== 'multi_select') continue;
            const raw = new Set<string>();
            for (const r of res.rows) {
                const text = sqlCellToText(r[m.column], typeOf.get(m.column) ?? '', m.field.type, settings.date_timezone);
                if (text === null || text.trim() === '') continue;
                if (m.field.type === 'multi_select') text.split(/[,;]/).forEach((v) => v.trim() && raw.add(v.trim()));
                else raw.add(text.trim());
            }
            const added = planSelectExpansion(m.field, raw);
            if (added.length === 0) continue;
            const options = [...((m.field.config as { options?: unknown[] }).options ?? []), ...added];
            m.field = { ...m.field, config: { ...m.field.config, options } };
            if (!opts.dry) {
                await this.fields.update(tenantId, String(row.listId), String(m.field.id), { config: m.field.config });
            }
        }
        if (!opts.dry) fields = await this.fields.listByListId(tenantId, row.listId);

        // Interpretar cada fila.
        const errors: SqlSyncRowError[] = [];
        let failed = 0;
        const addError = (key: string, message: string): void => {
            failed++;
            if (errors.length < ERROR_LIST) errors.push({ key, message });
        };
        const firstIndex = new Map<string, number>();
        const planned: PlannedRow[] = [];
        res.rows.forEach((r, i) => {
            const rawKeyText = sqlCellToText(r[keyColumn], typeOf.get(keyColumn) ?? '', keyField.type, settings.date_timezone) ?? '';
            const key = normalizeKey(keyField, rawKeyText);
            if (key === '') {
                addError(`fila ${i + 1}`, `La columna clave «${keyColumn}» está vacía.`);
                return;
            }
            if (firstIndex.has(key)) {
                addError(rawKeyText.trim(), `La clave aparece más de una vez en el resultado: se usó la primera (fila ${(firstIndex.get(key) ?? 0) + 1}).`);
                return;
            }
            firstIndex.set(key, i);
            const values: Record<string, unknown> = {};
            let bad: string | null = null;
            for (const m of maps) {
                const out = this.cell(r[m.column], typeOf.get(m.column) ?? '', m.field, settings.date_timezone);
                if (!out.ok) {
                    bad = `«${m.column}» → «${m.field.label}»: ${out.error}`;
                    break;
                }
                if (out.value === null && !settings.null_clears) continue;
                values[`f${m.field.id}`] = out.value;
            }
            if (bad) {
                addError(rawKeyText.trim(), bad);
                return;
            }
            // La clave se guarda tal como vino (para que la próxima vez empareje).
            const keyValue = this.cell(r[keyColumn], typeOf.get(keyColumn) ?? '', keyField, settings.date_timezone);
            if (!keyValue.ok || keyValue.value === null) {
                addError(rawKeyText.trim(), `La clave no es un valor válido para «${keyField.label}»${keyValue.ok ? '' : `: ${keyValue.error}`}.`);
                return;
            }
            values[`f${keyField.id}`] = keyValue.value;
            planned.push({ key, rawKey: rawKeyText.trim(), values });
        });

        // Emparejar con lo que ya hay.
        const existing = await this.lookup(tenantId, row.listId, keyField, planned.map((p) => p.key));
        const toCreate: PlannedRow[] = [];
        const toUpdate: Array<{ plan: PlannedRow; id: number; before: Record<string, unknown>; patch: Record<string, unknown> }> = [];
        let unchanged = 0;
        const sample: SqlSyncDryRun['sample'] = [];
        const label = (k: string) => byId.get(Number(k.slice(1)))?.label ?? k;
        for (const p of planned) {
            const matches = existing.get(p.key) ?? [];
            if (matches.length > 1) {
                addError(p.rawKey, `Hay ${matches.length} registros con esa clave en la lista: no se sabe cuál actualizar.`);
                continue;
            }
            const rec = matches[0];
            if (!rec) {
                if (!settings.create_missing) {
                    unchanged++;
                    continue;
                }
                const data = { ...p.values };
                if (flagField) data[`f${flagField.id}`] = true;
                toCreate.push({ ...p, values: data });
                if (opts.dry && sample.length < SAMPLE_SIZE) {
                    sample.push({
                        key: p.rawKey,
                        action: 'create',
                        changes: Object.entries(data).map(([k, v]) => ({ label: label(k), before: '—', after: show(v) })),
                    });
                }
                continue;
            }
            const patch: Record<string, unknown> = {};
            const before: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(p.values)) {
                const cur = rec.data[k] ?? null;
                const field = byId.get(Number(k.slice(1)));
                if (sameBulkValue(cur, v, field?.type === 'multi_select')) continue;
                patch[k] = v;
                before[k] = cur;
            }
            if (Object.keys(patch).length === 0) {
                unchanged++;
                continue;
            }
            toUpdate.push({ plan: p, id: rec.id, before: rec.data, patch });
            if (opts.dry && sample.length < SAMPLE_SIZE) {
                sample.push({
                    key: p.rawKey,
                    action: 'update',
                    changes: Object.entries(patch).map(([k, v]) => ({ label: label(k), before: show(before[k]), after: show(v) })),
                });
            }
        }

        // El plan manda: si las altas no entran, se actualiza igual y se dice.
        let warning: string | null = null;
        if (toCreate.length > 0 && !opts.dry) {
            try {
                await this.billing.assertCanCreateRecords(tenantId, toCreate.length);
            } catch (err) {
                warning = `No se crearon ${toCreate.length} registros nuevos: ${errMessage(err)}`;
                toCreate.length = 0;
            }
        }
        if (res.truncated) {
            notes.push(`La consulta devolvió más de ${SQL_SYNC_MAX_ROWS.toLocaleString('es')} filas: se cargaron las primeras. Filtrá la consulta (por fecha, con @ultima_sincronizacion).`);
        }

        let created = toCreate.length;
        let updated = toUpdate.length;
        let flagged = 0;
        if (!opts.dry) {
            const actorId = row.createdBy ?? (await this.fallbackActor(tenantId));
            created = await this.writeCreates(tenantId, row.listId, actorId, toCreate, dispatch);
            updated = await this.writeUpdates(tenantId, row.listId, toUpdate, dispatch);
            // Lo que ya no está en la base: sólo con un resultado COMPLETO (si se
            // cortó por el tope, faltarían filas que sí existen).
            if (flagField && !res.truncated) {
                flagged = await this.flagMissing(tenantId, row.listId, keyField, flagField, new Set(firstIndex.keys()), dispatch);
            }
            if (created + updated + flagged > 0) this.realtime.records(tenantId, row.listId);
        } else if (flagField && !res.truncated) {
            flagged = await this.countMissing(tenantId, row.listId, keyField, flagField, new Set(firstIndex.keys()));
        }

        const allNotes = [...notes, ...(warning ? [warning] : [])];
        return {
            result: {
                read: res.rows.length,
                created,
                updated,
                unchanged,
                failed,
                flagged,
                truncated: res.truncated,
                elapsed_ms: Date.now() - started,
            },
            errors,
            sample,
            warning: allNotes.length > 0 ? allNotes.join(' ') : null,
        };
    }

    /**
     * Una celda de SQL al valor del campo. Los números y los sí/no que ya
     * vienen tipados no pasan por texto: «12.345» como texto se leería como
     * doce mil (punto de miles).
     */
    private cell(value: unknown, sqlType: string, field: Field, tz: string): { ok: true; value: unknown } | { ok: false; error: string } {
        if (value === null || value === undefined) return { ok: true, value: null };
        let candidate: unknown;
        if ((typeof value === 'number' || typeof value === 'bigint') && NUMERIC_TYPES.includes(field.type)) {
            candidate = Number(value);
        } else if (typeof value === 'boolean' && field.type === 'checkbox') {
            candidate = value;
        } else {
            const text = sqlCellToText(value, sqlType, field.type, tz);
            if (text === null || text.trim() === '') return { ok: true, value: null };
            candidate = coerceCellValue(text, field);
        }
        const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, candidate);
        return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.error };
    }

    /** Registros de la lista por clave normalizada (sin ACL: es la sincronización de la empresa). */
    private async lookup(
        tenantId: number,
        listId: number,
        keyField: Field,
        keys: string[],
    ): Promise<Map<string, Array<{ id: number; data: Record<string, unknown> }>>> {
        const out = new Map<string, Array<{ id: number; data: Record<string, unknown> }>>();
        const unique = [...new Set(keys)];
        const expr = keyExpr(keyField);
        for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
            const chunk = unique.slice(i, i + LOOKUP_CHUNK);
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ id: records.id, data: records.data, k: sql<string>`${expr}` })
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, listId),
                            isNull(records.deletedAt),
                            sql`${expr} IN (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`,
                        ),
                    ),
            );
            for (const r of rows) {
                const k = normalizeKey(keyField, String(r.k ?? ''));
                out.set(k, [...(out.get(k) ?? []), { id: r.id, data: (r.data ?? {}) as Record<string, unknown> }]);
            }
        }
        return out;
    }

    private async writeCreates(tenantId: number, listId: number, actorId: number, rows: PlannedRow[], dispatch: boolean): Promise<number> {
        let created = 0;
        for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
            const chunk = rows.slice(i, i + WRITE_CHUNK);
            const ids = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const inserted = await tx
                    .insert(records)
                    .values(chunk.map((c) => ({ tenantId, listId, data: c.values, createdBy: actorId })))
                    .returning({ id: records.id });
                if (dispatch) {
                    for (const [j, r] of inserted.entries()) {
                        await this.activity.logInTx(tx, {
                            tenantId,
                            listId,
                            recordId: r.id,
                            userId: null,
                            action: 'record_created',
                            diff: computeDiff({}, chunk[j]!.values),
                        });
                    }
                }
                return inserted.map((r) => r.id);
            });
            created += ids.length;
            if (dispatch) {
                ids.forEach((id, j) =>
                    this.automations.dispatch({ tenantId, listId, recordId: id, trigger: 'record_created', after: chunk[j]!.values }),
                );
            }
        }
        return created;
    }

    private async writeUpdates(
        tenantId: number,
        listId: number,
        rows: Array<{ id: number; before: Record<string, unknown>; patch: Record<string, unknown> }>,
        dispatch: boolean,
    ): Promise<number> {
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
                        .set({ data: sql`${records.data} || ${JSON.stringify(u.patch)}::jsonb`, updatedAt: new Date() })
                        .where(and(eq(records.tenantId, tenantId), eq(records.id, u.id), isNull(records.deletedAt)))
                        .returning({ data: records.data });
                    if (!r) continue;
                    const after = (r.data ?? {}) as Record<string, unknown>;
                    if (dispatch) {
                        await this.activity.logInTx(tx, {
                            tenantId,
                            listId,
                            recordId: u.id,
                            userId: null,
                            action: 'record_updated',
                            diff: computeDiff(u.before, after),
                        });
                    }
                    out.push({ id: u.id, before: u.before, after });
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

    /** Pone la casilla «está en SQL» en sí/no según aparezca o no en el resultado. */
    private async flagMissing(
        tenantId: number,
        listId: number,
        keyField: Field,
        flagField: Field,
        present: Set<string>,
        dispatch: boolean,
    ): Promise<number> {
        const flips = await this.flagFlips(tenantId, listId, keyField, flagField, present);
        if (flips.length === 0) return 0;
        const k = `f${flagField.id}`;
        await this.writeUpdates(
            tenantId,
            listId,
            flips.map((f) => ({ id: f.id, before: f.data, patch: { [k]: f.want } })),
            dispatch,
        );
        return flips.filter((f) => !f.want).length;
    }

    private async countMissing(tenantId: number, listId: number, keyField: Field, flagField: Field, present: Set<string>): Promise<number> {
        const flips = await this.flagFlips(tenantId, listId, keyField, flagField, present);
        return flips.filter((f) => !f.want).length;
    }

    private async flagFlips(
        tenantId: number,
        listId: number,
        keyField: Field,
        flagField: Field,
        present: Set<string>,
    ): Promise<Array<{ id: number; data: Record<string, unknown>; want: boolean }>> {
        const expr = keyExpr(keyField);
        const rows = await this.tenantDb.withTenant(tenantId, (tx: Tx) =>
            tx
                .select({ id: records.id, data: records.data, k: sql<string>`${expr}` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt))),
        );
        const flagKey = `f${flagField.id}`;
        const out: Array<{ id: number; data: Record<string, unknown>; want: boolean }> = [];
        for (const r of rows) {
            const data = (r.data ?? {}) as Record<string, unknown>;
            const key = normalizeKey(keyField, String(r.k ?? ''));
            // Un registro sin clave no vino de la base: no se toca.
            if (key === '') continue;
            const want = present.has(key);
            // Sin valor también se escribe: así «Está en SQL = No» filtra igual
            // un registro que nunca se marcó que uno que dejó de venir.
            if (data[flagKey] !== want) out.push({ id: r.id, data, want });
        }
        return out;
    }

    /**
     * Autor de los registros que crea la sincronización: quien la armó; si esa
     * cuenta ya no existe, un admin de la empresa (la columna es obligatoria).
     */
    private async fallbackActor(tenantId: number): Promise<number> {
        const [m] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin')))
                .orderBy(asc(memberships.createdAt))
                .limit(1),
        );
        if (!m) throw new SqlSyncFatal('La empresa no tiene un administrador a quien atribuir los registros nuevos.');
        return m.userId;
    }

    // ── Estado ──────────────────────────────────────────────────────────────

    private async load(tenantId: number, syncId: number) {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(sqlSyncs).where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.id, syncId))).limit(1);
            return r ?? null;
        });
    }

    /** Mezcla en `state` (nunca pisa `settings`, que edita la persona). */
    async saveState(tenantId: number, syncId: number, patch: Record<string, unknown>, nextRunAt?: Date | null): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(sqlSyncs)
                .set({
                    state: sql`${sqlSyncs.state} || ${JSON.stringify(patch)}::jsonb`,
                    ...(nextRunAt !== undefined ? { nextRunAt } : {}),
                })
                .where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.id, syncId))),
        );
    }
}

function show(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (Array.isArray(v)) return v.map(String).join(', ');
    return String(v);
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

export type { SqlSyncSettings };
