import type { SqlSource } from '@imagina-base/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import {
    SqlRunError,
    type SqlConnParams,
    type SqlQueryResult,
    type SqlRunOptions,
    type SqlRunner,
    type SqlVerifyResult,
} from '../src/connectors/sqlserver/sql-runner';
import { activity, lists, memberships, plans, records, sqlSyncs, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { SqlSyncEngine } from '../src/sql-sync/sql-sync.engine';
import { SqlSyncQueue } from '../src/sql-sync/sql-sync.queue';
import { SqlSyncService } from '../src/sql-sync/sql-sync.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.243 — sincronización desde SQL Server con Postgres real. La base de la
 * empresa se simula en el borde (`SqlRunner`): devuelve columnas con su tipo y
 * filas con los valores como los entrega el driver (Date con la hora de pared
 * en UTC para `datetime`, números, booleanos, NULL).
 */
const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

const wall = (iso: string) => new Date(`${iso}Z`);

class FakeSql implements SqlRunner {
    rows: Array<Record<string, unknown>> = [];
    columns = [
        { name: 'NumeroFactura', type: 'nvarchar', length: 20 },
        { name: 'Cliente', type: 'nvarchar', length: 100 },
        { name: 'Total', type: 'decimal', length: 9 },
        { name: 'Estado', type: 'nvarchar', length: 20 },
        { name: 'Vence', type: 'date', length: 3 },
        { name: 'Emitida', type: 'datetime2', length: 8 },
    ];
    canWrite = false;
    fail: Error | null = null;
    truncate = false;
    calls: Array<{ conn: SqlConnParams; source: SqlSource; opts: SqlRunOptions }> = [];

    async verify(conn: SqlConnParams): Promise<SqlVerifyResult> {
        if (conn.password !== 'secreta') throw new SqlRunError("SQL Server rechazó el usuario o la contraseña de «lector».", 'login');
        return { login: conn.user, database: conn.database, version: '16.0', canWrite: this.canWrite };
    }

    async run(conn: SqlConnParams, source: SqlSource, opts: SqlRunOptions): Promise<SqlQueryResult> {
        this.calls.push({ conn, source, opts });
        if (this.fail) throw this.fail;
        const rows = this.rows.slice(0, opts.maxRows);
        return { columns: this.columns, rows, truncated: this.truncate || this.rows.length > opts.maxRows, elapsedMs: 3 };
    }
}

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}
class CapturingQueue extends SqlSyncQueue {
    runs: Array<{ tenantId: number; syncId: number }> = [];
    override enqueueRun(tenantId: number, syncId: number): void {
        this.runs.push({ tenantId, syncId });
    }
}

describe('Sincronización desde SQL Server (v0.1.243)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let fake: FakeSql;
    let connectors: ConnectorsService;
    let fieldsService: FieldsService;
    let listsService: ListsService;
    let engine: SqlSyncEngine;
    let svc: SqlSyncService;
    let dispatcher: CapturingDispatcher;
    let queue: CapturingQueue;
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;
    let otherAdmin: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.test' });
        const rt = new RealtimeService();
        const audit = new AuditService(tenantDb);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        fake = new FakeSql();
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps(), fake);
        const plansService = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansService, new EmailQuotaService(pg.db, plansService), new TenantSmtpService(pg.db, env));
        dispatcher = new CapturingDispatcher();
        const act = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        engine = new SqlSyncEngine(tenantDb, connectors, fieldsService, billing, act, dispatcher, rt, memoryOAuthStore() as never, fake);
        queue = new CapturingQueue();
        svc = new SqlSyncService(tenantDb, pg.db, connectors, listsService, fieldsService, engine, queue, audit, rt, fake);

        await pg.db.insert(plans).values({ slug: 'grande', name: 'Grande', maxRecords: null }).onConflictDoNothing();
        await pg.db.insert(plans).values({ slug: 'mini', name: 'Mini', maxRecords: 4 }).onConflictDoNothing();
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-sql', name: 'Acme', plan: 'grande' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra-sql', name: 'Otra', plan: 'grande' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.co', name: 'Admin', passwordHash: 'x' }).returning();
        const [u2] = await pg.db.insert(users).values({ email: 'admin@otra.co', name: 'Otra', passwordHash: 'x' }).returning();
        adminId = u!.id;
        otherAdmin = u2!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: adminId, role: 'admin' }));
        await withTenant(pg.db, otherTenant, (tx) => tx.insert(memberships).values({ tenantId: otherTenant, userId: otherAdmin, role: 'admin' }));
    }, 180_000);

    afterAll(async () => {
        await pg?.stop();
    });

    let connId: number;
    let listId: number;
    const F: Record<string, number> = {};
    let syncId: number;

    const rowsOf = async () =>
        withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.listId, listId), isNull(records.deletedAt))),
        ).then((r) => r.map((x) => ({ id: x.id, data: x.data as Record<string, unknown> })));
    const byKey = async (key: string) => (await rowsOf()).find((r) => r.data[`f${F.numero}`] === key);

    it('conectar: se prueba la base de verdad; una contraseña mala NO se guarda y un usuario que escribe avisa', async () => {
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'sqlserver', {
                fields: { server: 'tcp:acme.database.windows.net,1433', database: 'Ventas', user: 'lector', password: 'mala' },
                visibility: 'workspace',
            }),
        ).rejects.toMatchObject({ response: { code: 'integration_rejected' } });
        expect((await connectors.list(tenantId, adminId, 'admin')).filter((c) => c.integration_key === 'sqlserver')).toHaveLength(0);

        fake.canWrite = true;
        const { connection, warning } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'sqlserver', {
            fields: { server: 'tcp:acme.database.windows.net,1433', database: 'Ventas', user: 'lector', password: 'secreta' },
            visibility: 'workspace',
        });
        fake.canWrite = false;
        connId = connection.id;
        expect(warning).toMatch(/puede ESCRIBIR/);
        expect(connection.account_label).toBe('Ventas · acme.database.windows.net');
        // Lo que viaja al driver: el servidor limpio y la contraseña descifrada.
        const creds = await connectors.integrationCredsFor(tenantId, connId);
        expect(creds!.creds.fields.server).toBe('acme.database.windows.net');
        expect(creds!.creds.fields.port).toBe('1433');
        expect(creds!.creds.secret).toBe('secreta');
    });

    it('arma la lista destino y valida la configuración contra sus campos', async () => {
        const list = await listsService.create(tenantId, { name: 'Facturas SQL' });
        listId = list.id;
        const mk = async (label: string, type: string, config?: Record<string, unknown>) =>
            (await fieldsService.create(tenantId, list.slug, { label, type: type as never, config })).id;
        F.numero = await mk('Número', 'text');
        F.cliente = await mk('Cliente', 'text');
        F.total = await mk('Total', 'currency');
        F.estado = await mk('Estado', 'select', { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] });
        F.vence = await mk('Vence', 'date');
        F.emitida = await mk('Emitida', 'datetime');
        F.en_sql = await mk('Está en SQL', 'checkbox');

        const base = {
            name: 'Facturas',
            list_id: listId,
            source: { kind: 'query' as const, sql: 'SELECT * FROM dbo.Facturas' },
            key_column: 'NumeroFactura',
            key_field_id: F.numero!,
            columns: [
                { column: 'Cliente', field_id: F.cliente! },
                { column: 'Total', field_id: F.total! },
                { column: 'Estado', field_id: F.estado! },
                { column: 'Vence', field_id: F.vence! },
                { column: 'Emitida', field_id: F.emitida! },
            ],
            create_missing: true,
            null_clears: true,
            on_missing: 'ignore' as const,
            flag_field_id: null,
            date_timezone: 'America/Bogota',
            timeout_seconds: 60,
            schedule: { kind: 'interval' as const, minutes: 60 },
            enabled: true,
        };
        // Clave en un campo que no puede serlo.
        await expect(svc.create(tenantId, adminId, 'admin', connId, { ...base, key_field_id: F.estado! })).rejects.toMatchObject({
            response: { code: 'sql_sync_invalid' },
        });
        // Dos columnas al mismo campo.
        await expect(
            svc.create(tenantId, adminId, 'admin', connId, { ...base, columns: [...base.columns, { column: 'Otra', field_id: F.cliente! }] }),
        ).rejects.toMatchObject({ response: { code: 'sql_sync_invalid' } });
        // Marcar lo que falta exige una casilla.
        await expect(svc.create(tenantId, adminId, 'admin', connId, { ...base, on_missing: 'flag', flag_field_id: F.cliente! })).rejects.toMatchObject({
            response: { code: 'sql_sync_invalid' },
        });

        const created = await svc.create(tenantId, adminId, 'admin', connId, base);
        syncId = created.id;
        expect(created.status.queued).toBe(true);
        expect(queue.runs).toEqual([{ tenantId, syncId }]);
        // La lista queda marcada con las columnas que llena.
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)));
        expect((l!.settings as Record<string, unknown>).sql_sync).toEqual({
            syncs: [{ sync_id: syncId, connection_id: connId, name: 'Facturas', key_field_id: F.numero, field_ids: [F.numero, F.cliente, F.total, F.estado, F.vence, F.emitida] }],
        });
    });

    it('vista previa de la carga: qué haría, sin escribir nada', async () => {
        fake.rows = [
            { NumeroFactura: 'F-001', Cliente: 'Acme', Total: 1250.5, Estado: 'Pendiente', Vence: wall('2026-10-30T00:00:00'), Emitida: wall('2026-10-01T14:05:00') },
            { NumeroFactura: 'F-002', Cliente: 'Beta', Total: 12.345, Estado: 'Vencida', Vence: wall('2026-09-15T00:00:00'), Emitida: wall('2026-09-01T09:00:00') },
        ];
        const dry = await svc.dryRun(tenantId, adminId, 'admin', syncId);
        expect(dry.result).toMatchObject({ read: 2, created: 2, updated: 0, failed: 0 });
        expect(dry.sample.map((s) => s.action)).toEqual(['create', 'create']);
        expect(await rowsOf()).toHaveLength(0);
        // La opción nueva «Vencida» no se creó todavía.
        const estado = (await fieldsService.listByListId(tenantId, listId)).find((f) => f.id === F.estado)!;
        expect((estado.config as { options: unknown[] }).options).toHaveLength(2);
    });

    it('primera corrida: crea, convierte fechas y números, agrega opciones, reporta errores por fila y NO dispara automatizaciones', async () => {
        fake.rows.push(
            { NumeroFactura: null, Cliente: 'Sin clave', Total: 1, Estado: 'Pendiente', Vence: null, Emitida: null },
            { NumeroFactura: 'f-001 ', Cliente: 'Duplicada', Total: 1, Estado: 'Pendiente', Vence: null, Emitida: null },
            { NumeroFactura: 'F-003', Cliente: 'Gamma', Total: 'mucho', Estado: 'Pendiente', Vence: null, Emitida: null },
        );
        expect(await engine.run(tenantId, syncId)).toBe(true);
        const sync = await svc.get(tenantId, adminId, 'admin', syncId);
        expect(sync.status.last_error).toBeNull();
        expect(sync.status.last_result).toMatchObject({ read: 5, created: 2, updated: 0, failed: 3 });
        expect(sync.status.errors.map((e) => e.message).join(' | ')).toMatch(/vacía.*más de una vez.*Total/s);
        expect(sync.status.initial_done).toBe(true);
        expect(sync.status.next_run_at).not.toBeNull();

        const f1 = await byKey('F-001');
        expect(f1!.data).toMatchObject({
            [`f${F.cliente}`]: 'Acme',
            [`f${F.total}`]: 1250.5,
            [`f${F.estado}`]: 'pendiente',
            [`f${F.vence}`]: '2026-10-30',
            // 14:05 en Bogotá = 19:05 UTC.
            [`f${F.emitida}`]: '2026-10-01T19:05:00Z',
        });
        // 12.345 viene como número: no se lee como «doce mil».
        expect((await byKey('F-002'))!.data[`f${F.total}`]).toBe(12.345);
        // La opción que no existía se agregó y se usa.
        const estado = (await fieldsService.listByListId(tenantId, listId)).find((f) => f.id === F.estado)!;
        const vencida = (estado.config as { options: Array<{ value: string; label: string }> }).options.find((o) => o.label === 'Vencida');
        expect(vencida).toBeDefined();
        expect((await byKey('F-002'))!.data[`f${F.estado}`]).toBe(vencida!.value);
        // Primera carga: ni automatizaciones ni bitácora por fila.
        expect(dispatcher.events).toHaveLength(0);
        const acts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.listId, listId)));
        expect(acts).toHaveLength(0);
    });

    it('segunda corrida: actualiza SÓLO lo que cambió, empareja sin distinguir mayúsculas ni espacios y dispara automatizaciones', async () => {
        dispatcher.events = [];
        const lastSuccess = (await svc.get(tenantId, adminId, 'admin', syncId)).status.last_success_at;
        // Un registro cargado a mano con la clave en otro formato: se empareja, no se duplica.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${F.numero}`]: ' f-004 ', [`f${F.cliente}`]: 'Manual' }, createdBy: adminId }),
        );
        fake.rows = [
            { NumeroFactura: 'F-001', Cliente: 'Acme', Total: 1250.5, Estado: 'Pagada', Vence: wall('2026-10-30T00:00:00'), Emitida: wall('2026-10-01T14:05:00') },
            { NumeroFactura: 'F-002', Cliente: 'Beta', Total: 12.345, Estado: 'Vencida', Vence: wall('2026-09-15T00:00:00'), Emitida: wall('2026-09-01T09:00:00') },
            { NumeroFactura: 'F-004', Cliente: 'Delta', Total: null, Estado: 'Pendiente', Vence: null, Emitida: null },
            { NumeroFactura: 'F-005', Cliente: 'Épsilon', Total: 10, Estado: 'Pendiente', Vence: null, Emitida: null },
        ];
        await engine.run(tenantId, syncId);
        const sync = await svc.get(tenantId, adminId, 'admin', syncId);
        expect(sync.status.last_result).toMatchObject({ read: 4, created: 1, updated: 2, unchanged: 1, failed: 0 });
        // `@ultima_sincronizacion` = el inicio de la corrida anterior.
        expect(fake.calls.at(-1)!.opts.lastSync?.toISOString()).toBe(lastSuccess);

        expect((await byKey('F-001'))!.data[`f${F.estado}`]).toBe('pagada');
        const f4 = (await rowsOf()).filter((r) => String(r.data[`f${F.numero}`]).trim().toLowerCase() === 'f-004');
        expect(f4).toHaveLength(1);
        expect(f4[0]!.data[`f${F.cliente}`]).toBe('Delta');
        expect((await rowsOf()).length).toBe(4); // F-001, F-002, F-004 (la manual) y F-005

        const kinds = dispatcher.events.map((e) => e.trigger).sort();
        expect(kinds).toEqual(['record_created', 'record_updated', 'record_updated']);
        const upd = dispatcher.events.find((e) => e.trigger === 'record_updated' && e.after?.[`f${F.estado}`] === 'pagada');
        expect(upd?.before?.[`f${F.estado}`]).toBe('pendiente');
        const acts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.listId, listId)));
        expect(acts).toHaveLength(3);
    });

    it('NULL vacía el campo… salvo que se apague `null_clears`', async () => {
        // En la corrida anterior F-004 trajo Total NULL: el registro manual no tenía total → sigue vacío.
        fake.rows = [{ NumeroFactura: 'F-005', Cliente: 'Épsilon', Total: null, Estado: 'Pendiente', Vence: null, Emitida: null }];
        await svc.update(tenantId, adminId, 'admin', syncId, { null_clears: false });
        await engine.run(tenantId, syncId);
        expect((await byKey('F-005'))!.data[`f${F.total}`]).toBe(10);
        await svc.update(tenantId, adminId, 'admin', syncId, { null_clears: true });
        await engine.run(tenantId, syncId);
        expect((await byKey('F-005'))!.data[`f${F.total}`]).toBeNull();
    });

    it('marcar lo que ya no está en la base (y no tocarlo si el resultado vino cortado)', async () => {
        await svc.update(tenantId, adminId, 'admin', syncId, { on_missing: 'flag', flag_field_id: F.en_sql! });
        fake.rows = [
            { NumeroFactura: 'F-001', Cliente: 'Acme', Total: 1250.5, Estado: 'Pagada', Vence: wall('2026-10-30T00:00:00'), Emitida: wall('2026-10-01T14:05:00') },
            { NumeroFactura: 'F-002', Cliente: 'Beta', Total: 12.345, Estado: 'Vencida', Vence: wall('2026-09-15T00:00:00'), Emitida: wall('2026-09-01T09:00:00') },
        ];
        fake.truncate = true;
        await engine.run(tenantId, syncId);
        expect((await svc.get(tenantId, adminId, 'admin', syncId)).status.last_result?.flagged).toBe(0);
        expect((await byKey('F-005'))!.data[`f${F.en_sql}`]).toBeUndefined();
        expect((await svc.get(tenantId, adminId, 'admin', syncId)).status.last_error).toMatch(/más de 50/);

        fake.truncate = false;
        await engine.run(tenantId, syncId);
        const st = (await svc.get(tenantId, adminId, 'admin', syncId)).status;
        expect(st.last_result?.flagged).toBe(2); // F-004 y F-005
        expect((await byKey('F-001'))!.data[`f${F.en_sql}`]).toBe(true);
        expect((await byKey('F-005'))!.data[`f${F.en_sql}`]).toBe(false);
        // Lo que falta NO se borra.
        expect(await rowsOf()).toHaveLength(4);
        // La casilla también queda marcada como columna de SQL.
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)));
        const marker = (l!.settings as { sql_sync: { syncs: Array<{ field_ids: number[] }> } }).sql_sync;
        expect(marker.syncs[0]!.field_ids).toContain(F.en_sql);
    });

    it('el plan manda: si las altas no entran se actualiza igual y se avisa', async () => {
        await pg.db.update(tenants).set({ plan: 'mini' }).where(eq(tenants.id, tenantId));
        fake.rows = [
            { NumeroFactura: 'F-001', Cliente: 'Acme SAS', Total: 1250.5, Estado: 'Pagada', Vence: null, Emitida: null },
            { NumeroFactura: 'F-100', Cliente: 'Nueva', Total: 1, Estado: 'Pendiente', Vence: null, Emitida: null },
        ];
        await svc.update(tenantId, adminId, 'admin', syncId, { on_missing: 'ignore', flag_field_id: null });
        await engine.run(tenantId, syncId);
        const st = (await svc.get(tenantId, adminId, 'admin', syncId)).status;
        expect(st.last_result).toMatchObject({ created: 0, updated: 1 });
        expect(st.last_error).toMatch(/No se crearon 1 registros nuevos/);
        expect((await byKey('F-001'))!.data[`f${F.cliente}`]).toBe('Acme SAS');
        await pg.db.update(tenants).set({ plan: 'grande' }).where(eq(tenants.id, tenantId));
    });

    it('una base caída o una columna clave que no viene: la corrida falla con el motivo y no toca nada', async () => {
        const before = await rowsOf();
        fake.fail = new SqlRunError('No se pudo conectar a acme.database.windows.net.', 'connect');
        await engine.run(tenantId, syncId);
        expect((await svc.get(tenantId, adminId, 'admin', syncId)).status.last_error).toMatch(/No se pudo conectar/);
        fake.fail = null;
        const saved = fake.columns;
        fake.columns = saved.filter((c) => c.name !== 'NumeroFactura');
        await engine.run(tenantId, syncId);
        expect((await svc.get(tenantId, adminId, 'admin', syncId)).status.last_error).toMatch(/no devuelve la columna clave «NumeroFactura»/);
        fake.columns = saved;
        expect(await rowsOf()).toEqual(before);
    });

    it('una empresa en solo lectura no trae datos', async () => {
        await pg.db.update(tenants).set({ archivedAt: new Date() }).where(eq(tenants.id, tenantId));
        await engine.run(tenantId, syncId);
        expect((await svc.get(tenantId, adminId, 'admin', syncId)).status.last_error).toMatch(/solo lectura/);
        await pg.db.update(tenants).set({ archivedAt: null }).where(eq(tenants.id, tenantId));
    });

    it('vista previa de una consulta: columnas, tipo sugerido y valores en texto', async () => {
        fake.rows = [{ NumeroFactura: 'F-001', Cliente: 'Acme', Total: 1250.5, Estado: 'Pagada', Vence: wall('2026-10-30T00:00:00'), Emitida: wall('2026-10-01T14:05:00') }];
        const prev = await svc.preview(tenantId, adminId, 'admin', connId, { source: { kind: 'query', sql: 'SELECT 1' } });
        expect(prev.columns.find((c) => c.name === 'Total')).toMatchObject({ sql_type: 'decimal', suggested_type: 'number' });
        expect(prev.columns.find((c) => c.name === 'Emitida')?.suggested_type).toBe('datetime');
        expect(prev.rows[0]).toMatchObject({ NumeroFactura: 'F-001', Total: '1250.5', Vence: '2026-10-30' });
        expect(fake.calls.at(-1)!.opts.maxRows).toBe(50);
    });

    it('tick: encola sólo las que tocan y posterga la próxima', async () => {
        queue.runs = [];
        await withTenant(pg.db, tenantId, (tx) => tx.update(sqlSyncs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(sqlSyncs.id, syncId)));
        expect(await svc.tick()).toBeGreaterThanOrEqual(1);
        expect(queue.runs).toContainEqual({ tenantId, syncId });
        queue.runs = [];
        expect(await svc.tick()).toBe(0);
    });

    it('aislamiento: otra empresa no ve ni toca la sincronización ni la conexión', async () => {
        await expect(svc.get(otherTenant, otherAdmin, 'admin', syncId)).rejects.toMatchObject({ response: { code: 'sql_sync_not_found' } });
        await expect(svc.list(otherTenant, otherAdmin, 'admin', connId)).rejects.toBeDefined();
        const seen = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(sqlSyncs));
        expect(seen).toHaveLength(0);
    });

    it('borrar la sincronización deja los datos y saca la marca; borrar la conexión borra las suyas', async () => {
        const second = await svc.create(tenantId, adminId, 'admin', connId, {
            name: 'Otra',
            list_id: listId,
            source: { kind: 'procedure', name: 'dbo.uspFacturas', params: [{ name: '@desde', value: '{{ultima_sincronizacion}}' }] },
            key_column: 'NumeroFactura',
            key_field_id: F.numero!,
            columns: [],
            create_missing: false,
            null_clears: true,
            on_missing: 'ignore',
            flag_field_id: null,
            date_timezone: 'UTC',
            timeout_seconds: 30,
            schedule: { kind: 'daily', time: '07:30', timezone: 'America/Bogota' },
            enabled: false,
        });
        await svc.remove(tenantId, adminId, 'admin', syncId);
        expect(await rowsOf()).toHaveLength(4);
        let [l] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)));
        expect((l!.settings as { sql_sync: { syncs: unknown[] } }).sql_sync.syncs).toHaveLength(1);

        await connectors.remove(tenantId, adminId, 'admin', connId, true);
        const left = await withTenant(pg.db, tenantId, (tx) => tx.select().from(sqlSyncs).where(eq(sqlSyncs.id, second.id)));
        expect(left).toHaveLength(0);
        [l] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)));
        expect((l!.settings as Record<string, unknown>).sql_sync).toBeUndefined();
    });
});
