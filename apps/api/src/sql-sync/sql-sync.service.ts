import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    SQL_SYNC_FIELD_TYPES,
    SQL_SYNC_KEY_TYPES,
    SQL_SYNC_DEFAULT_TIMEOUT,
    SQL_SYNC_PREVIEW_ROWS,
    nextSqlSyncRun,
    readSqlSyncSettings,
    readStoreListMarker,
    validTimeZone,
    type CreateSqlSyncInput,
    type Field,
    type Role,
    type SqlListSource,
    type SqlPreviewInput,
    type SqlPreviewResult,
    type SqlSync,
    type SqlSyncDryRun,
    type SqlSyncSettings,
    type SqlSyncStatus,
    type UpdateSqlSyncInput,
} from '@imagina-base/shared';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ConnectorsService } from '../connectors/connectors.service';
import { SQL_RUNNER, sqlConnParams, type SqlRunner } from '../connectors/sqlserver/sql-runner';
import { sqlCellToText, suggestFieldType } from '../connectors/sqlserver/sql-values';
import { DRIZZLE, type Db } from '../db/client';
import { lists, sqlSyncs, type SqlSyncRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SqlSyncEngine } from './sql-sync.engine';
import { SqlSyncQueue } from './sql-sync.queue';

/**
 * Sincronizaciones desde SQL Server (v0.1.243): alta, cambios, estado, vista
 * previa de la consulta y de la carga, y el tick que encola las que tocan.
 *
 * Quién: `manage_lists` (lo exige el controller) y, acá, poder EDITAR la
 * conexión — la misma puerta que la sincronización de la tienda: trae datos
 * de afuera a nombre de la empresa.
 */
@Injectable()
export class SqlSyncService {
    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly connectors: ConnectorsService,
        private readonly listsService: ListsService,
        private readonly fields: FieldsService,
        private readonly engine: SqlSyncEngine,
        private readonly queue: SqlSyncQueue,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeService,
        @Inject(SQL_RUNNER) private readonly runner: SqlRunner,
    ) {
        // Borrar la conexión borra sus sincronizaciones (cascada): antes se
        // quita la marca de las listas, si no quedarían diciendo «viene de SQL».
        this.connectors.onBeforeRemove(async (tenantId, connectionId) => {
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.select({ listId: sqlSyncs.listId }).from(sqlSyncs).where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.connectionId, connectionId))),
            );
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.delete(sqlSyncs).where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.connectionId, connectionId))),
            );
            for (const listId of new Set(rows.map((r) => r.listId))) await this.markList(tenantId, listId);
        });
    }

    // ── Lectura ─────────────────────────────────────────────────────────────

    async list(tenantId: number, userId: number, role: Role, connectionId: number): Promise<SqlSync[]> {
        const conn = await this.requireSqlConnection(tenantId, userId, role, connectionId);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(sqlSyncs)
                .where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.connectionId, connectionId)))
                .orderBy(asc(sqlSyncs.id)),
        );
        return Promise.all(rows.map((r) => this.toDto(tenantId, r, conn.name)));
    }

    async get(tenantId: number, userId: number, role: Role, syncId: number): Promise<SqlSync> {
        const { row, conn } = await this.requireSync(tenantId, userId, role, syncId);
        return this.toDto(tenantId, row, conn.name);
    }

    // ── Alta / cambios / baja ───────────────────────────────────────────────

    async create(tenantId: number, userId: number, role: Role, connectionId: number, input: CreateSqlSyncInput): Promise<SqlSync> {
        await this.requireSqlConnection(tenantId, userId, role, connectionId);
        const settings = settingsOf(input);
        await this.validate(tenantId, input.list_id, settings);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(sqlSyncs)
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
                    createdBy: userId,
                })
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'sql_sync.create',
                targetType: 'list',
                targetId: input.list_id,
                targetLabel: input.name,
                meta: { connection_id: connectionId, source: settings.source.kind, key_column: settings.key_column },
            });
            return created!;
        });
        await this.markList(tenantId, row.listId);
        if (row.enabled) {
            await this.engine.saveState(tenantId, row.id, { queued: true });
            this.queue.enqueueRun(tenantId, row.id);
        }
        return this.get(tenantId, userId, role, row.id);
    }

    async update(tenantId: number, userId: number, role: Role, syncId: number, input: UpdateSqlSyncInput): Promise<SqlSync> {
        const { row } = await this.requireSync(tenantId, userId, role, syncId);
        const current = readSqlSyncSettings(row.settings);
        const merged: SqlSyncSettings = {
            source: input.source ?? current.source,
            key_column: input.key_column ?? current.key_column,
            key_field_id: input.key_field_id ?? current.key_field_id,
            columns: input.columns ?? current.columns,
            create_missing: input.create_missing ?? current.create_missing,
            null_clears: input.null_clears ?? current.null_clears,
            on_missing: input.on_missing ?? current.on_missing,
            flag_field_id: input.flag_field_id !== undefined ? input.flag_field_id : current.flag_field_id,
            date_timezone: input.date_timezone ?? current.date_timezone,
            timeout_seconds: input.timeout_seconds ?? current.timeout_seconds,
            schedule: input.schedule ?? current.schedule,
        };
        const listId = input.list_id ?? row.listId;
        await this.validate(tenantId, listId, merged);
        const enabled = input.enabled ?? row.enabled;
        // Cambió el horario o se reactivó: se recalcula la próxima corrida.
        const scheduleChanged = input.schedule !== undefined || (input.enabled === true && !row.enabled);
        const nextRunAt = !enabled ? null : scheduleChanged || !row.nextRunAt ? nextSqlSyncRun(merged.schedule, new Date()) : row.nextRunAt;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(sqlSyncs)
                .set({
                    name: input.name ?? row.name,
                    listId,
                    settings: merged as unknown as Record<string, unknown>,
                    enabled,
                    nextRunAt,
                    updatedAt: new Date(),
                })
                .where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.id, syncId)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'sql_sync.update',
                targetType: 'list',
                targetId: listId,
                targetLabel: input.name ?? row.name,
                meta: { sync_id: syncId, changed: Object.keys(input) },
            });
        });
        await this.markList(tenantId, listId);
        if (listId !== row.listId) await this.markList(tenantId, row.listId);
        return this.get(tenantId, userId, role, syncId);
    }

    async remove(tenantId: number, userId: number, role: Role, syncId: number): Promise<void> {
        const { row } = await this.requireSync(tenantId, userId, role, syncId);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx.delete(sqlSyncs).where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.id, syncId)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'sql_sync.delete',
                targetType: 'list',
                targetId: row.listId,
                targetLabel: row.name,
                // Lo traído queda: dejar de sincronizar no borra datos (ADR-S09).
                meta: { sync_id: syncId },
            });
        });
        await this.markList(tenantId, row.listId);
    }

    // ── Ejecutar / probar ───────────────────────────────────────────────────

    async runNow(tenantId: number, userId: number, role: Role, syncId: number): Promise<SqlSync> {
        const { row } = await this.requireSync(tenantId, userId, role, syncId);
        await this.engine.saveState(tenantId, syncId, { queued: true });
        this.queue.enqueueRun(tenantId, row.id);
        return this.get(tenantId, userId, role, syncId);
    }

    /** Qué haría una corrida con la configuración GUARDADA, sin escribir nada. */
    async dryRun(tenantId: number, userId: number, role: Role, syncId: number): Promise<SqlSyncDryRun> {
        await this.requireSync(tenantId, userId, role, syncId);
        return this.engine.dryRun(tenantId, syncId);
    }

    /** Probar una consulta: columnas, tipos sugeridos y las primeras filas. */
    async preview(tenantId: number, userId: number, role: Role, connectionId: number, input: SqlPreviewInput): Promise<SqlPreviewResult> {
        await this.requireSqlConnection(tenantId, userId, role, connectionId);
        const found = await this.connectors.integrationCredsFor(tenantId, connectionId);
        if (!found) throw new NotFoundException({ code: 'connection_not_found', message: 'La conexión ya no existe.', data: { status: 404 } });
        const res = await this.runner
            .run(sqlConnParams(found.creds.fields, found.creds.secret), input.source, {
                maxRows: SQL_SYNC_PREVIEW_ROWS,
                timeoutMs: (input.timeout_seconds ?? SQL_SYNC_DEFAULT_TIMEOUT) * 1000,
                lastSync: null,
            })
            .catch((err: unknown) => {
                throw new BadRequestException({
                    code: 'sql_error',
                    message: err instanceof Error ? err.message : String(err),
                    data: { status: 400 },
                });
            });
        const typeOf = new Map(res.columns.map((c) => [c.name, c.type]));
        return {
            columns: res.columns.map((c) => ({ name: c.name, sql_type: c.type, suggested_type: suggestFieldType(c.type, c.length) })),
            rows: res.rows.map((r) => {
                const out: Record<string, string | null> = {};
                for (const c of res.columns) out[c.name] = sqlCellToText(r[c.name], typeOf.get(c.name) ?? '', 'text', 'UTC');
                return out;
            }),
            more: res.truncated,
            elapsed_ms: res.elapsedMs,
        };
    }

    // ── Cola ────────────────────────────────────────────────────────────────

    /**
     * Tick global (cada minuto): encola las que tocan. Corre con la conexión
     * base (cross-tenant, como la tienda); cada corrida trabaja en su tenant.
     */
    async tick(): Promise<number> {
        const due = await this.db
            .select({ id: sqlSyncs.id, tenantId: sqlSyncs.tenantId })
            .from(sqlSyncs)
            .where(and(eq(sqlSyncs.enabled, true), lte(sqlSyncs.nextRunAt, new Date())))
            .orderBy(asc(sqlSyncs.nextRunAt))
            .limit(100);
        for (const d of due) {
            // Provisorio: evita re-encolar mientras espera; el motor pone la
            // próxima de verdad al terminar.
            await this.db
                .update(sqlSyncs)
                .set({ nextRunAt: new Date(Date.now() + 10 * 60_000) })
                .where(eq(sqlSyncs.id, d.id));
            this.queue.enqueueRun(d.tenantId, d.id);
        }
        return due.length;
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    /**
     * La configuración tiene que tener sentido contra la lista de HOY: la
     * clave en un campo de texto/número/email/teléfono/enlace, cada columna en
     * un campo que se pueda llenar desde SQL, sin dos columnas al mismo campo,
     * y la casilla de «está en SQL» si se pidió marcar lo que falta.
     */
    private async validate(tenantId: number, listId: number, s: SqlSyncSettings): Promise<void> {
        let list;
        try {
            list = await this.listsService.get(tenantId, String(listId));
        } catch {
            throw bad('La lista elegida no existe.');
        }
        if (readStoreListMarker(list.settings)) {
            throw bad('Esa lista es de una tienda sincronizada: sus datos los trae WooCommerce. Elegí otra lista.');
        }
        const fields: Field[] = await this.fields.listByListId(tenantId, list.id);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const key = byId.get(s.key_field_id);
        if (!key) throw bad('El campo clave no es de esa lista.');
        if (!(SQL_SYNC_KEY_TYPES as readonly string[]).includes(key.type)) {
            throw bad(`«${key.label}» no puede ser la clave: elegí un campo de texto, número, email, teléfono o enlace.`);
        }
        if (s.key_column.trim() === '') throw bad('Elegí la columna clave del resultado.');
        const seen = new Set<number>([key.id]);
        for (const m of s.columns) {
            const f = byId.get(m.field_id);
            if (!f) throw bad(`La columna «${m.column}» apunta a un campo que no es de esa lista.`);
            if (!(SQL_SYNC_FIELD_TYPES as readonly string[]).includes(f.type)) {
                throw bad(`«${f.label}» no se puede llenar desde SQL (es un campo de tipo ${f.type}).`);
            }
            if (seen.has(f.id)) throw bad(`Dos columnas van al mismo campo «${f.label}».`);
            seen.add(f.id);
        }
        if (s.on_missing === 'flag') {
            const flag = s.flag_field_id ? byId.get(s.flag_field_id) : undefined;
            if (!flag || flag.type !== 'checkbox') throw bad('Para marcar lo que ya no está en SQL elegí un campo de tipo casilla.');
            if (seen.has(flag.id)) throw bad(`«${flag.label}» ya recibe una columna: elegí otra casilla para marcar lo que falta.`);
        }
        if (!validTimeZone(s.date_timezone)) throw bad('La zona horaria de las fechas no es válida.');
        if (s.schedule.kind === 'daily' && !validTimeZone(s.schedule.timezone)) throw bad('La zona horaria del horario no es válida.');
    }

    /**
     * `lists.settings.sql_sync`: qué sincronizaciones escriben en la lista y
     * qué columnas llenan (la interfaz las marca). Se recalcula desde la tabla.
     */
    async markList(tenantId: number, listId: number): Promise<void> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(sqlSyncs).where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.listId, listId))).orderBy(asc(sqlSyncs.id)),
        );
        const syncs: SqlListSource[] = rows.map((r) => {
            const s = readSqlSyncSettings(r.settings);
            return {
                sync_id: r.id,
                connection_id: r.connectionId,
                name: r.name,
                key_field_id: s.key_field_id,
                field_ids: [s.key_field_id, ...s.columns.map((c) => c.field_id), ...(s.on_missing === 'flag' && s.flag_field_id ? [s.flag_field_id] : [])],
            };
        });
        await this.tenantDb.withTenant(tenantId, (tx) =>
            syncs.length === 0
                ? tx
                      .update(lists)
                      .set({ settings: sql`${lists.settings} - 'sql_sync'` })
                      .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
                : tx
                      .update(lists)
                      .set({ settings: sql`${lists.settings} || ${JSON.stringify({ sql_sync: { syncs } })}::jsonb` })
                      .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId))),
        );
        // Las pestañas abiertas vuelven a leer la marca (columnas, aviso).
        this.realtime.lists(tenantId);
    }

    private async requireSqlConnection(tenantId: number, userId: number, role: Role, connectionId: number) {
        const conn = await this.connectors.editableConnection(tenantId, userId, role, connectionId);
        if (conn.provider !== 'sqlserver') {
            throw bad('Esa conexión no es una base de datos SQL Server.');
        }
        return conn;
    }

    private async requireSync(tenantId: number, userId: number, role: Role, syncId: number) {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(sqlSyncs).where(and(eq(sqlSyncs.tenantId, tenantId), eq(sqlSyncs.id, syncId))).limit(1);
            return r ?? null;
        });
        if (!row) throw new NotFoundException({ code: 'sql_sync_not_found', message: 'Esa sincronización no existe.', data: { status: 404 } });
        const conn = await this.requireSqlConnection(tenantId, userId, role, row.connectionId);
        return { row, conn };
    }

    private async toDto(tenantId: number, row: SqlSyncRow, connectionName: string): Promise<SqlSync> {
        const s = readSqlSyncSettings(row.settings);
        const st = (row.state ?? {}) as Record<string, unknown>;
        const list = await this.listsService.get(tenantId, String(row.listId)).catch(() => null);
        const status: SqlSyncStatus = {
            running: st.running === true,
            queued: st.queued === true,
            initial_done: st.initial_done === true,
            last_run_at: str(st.last_run_at),
            last_success_at: str(st.last_success_at),
            next_run_at: row.enabled && row.nextRunAt ? row.nextRunAt.toISOString() : null,
            last_error: str(st.last_error),
            last_result: st.last_result && typeof st.last_result === 'object' ? (st.last_result as SqlSyncStatus['last_result']) : null,
            errors: Array.isArray(st.errors) ? (st.errors as SqlSyncStatus['errors']) : [],
        };
        return {
            id: row.id,
            connection_id: row.connectionId,
            connection_name: connectionName,
            name: row.name,
            list_id: row.listId,
            list_name: list?.name ?? null,
            list_slug: list?.slug ?? null,
            ...s,
            enabled: row.enabled,
            status,
            created_at: row.createdAt.toISOString(),
        };
    }
}

function settingsOf(input: CreateSqlSyncInput): SqlSyncSettings {
    return {
        source: input.source,
        key_column: input.key_column,
        key_field_id: input.key_field_id,
        columns: input.columns,
        create_missing: input.create_missing,
        null_clears: input.null_clears,
        on_missing: input.on_missing,
        flag_field_id: input.flag_field_id,
        date_timezone: input.date_timezone,
        timeout_seconds: input.timeout_seconds,
        schedule: input.schedule,
    };
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : null;
}

function bad(message: string): BadRequestException {
    return new BadRequestException({ code: 'sql_sync_invalid', message, data: { status: 400 } });
}
