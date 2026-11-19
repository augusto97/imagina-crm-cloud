import { and, eq, isNull, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { encryptSecret } from '../src/common/secret-box';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { activity, connections, lists, memberships, plans, records, sheetSyncRows, sheetSyncs, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EventWebhookHub } from '../src/event-webhooks/event-hub';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { SheetSyncAiTools } from '../src/sheet-sync/sheet-sync-ai-tools';
import { SheetSyncEngine } from '../src/sheet-sync/sheet-sync.engine';
import { SheetSyncQueue } from '../src/sheet-sync/sheet-sync.queue';
import { SheetSyncService } from '../src/sheet-sync/sheet-sync.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { startFakeSheets, type FakeSheets } from './helpers/fake-sheets';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.459 (G3) — Sincronizar una lista con una hoja de Google Sheets, con
 * Postgres y Redis reales y la API de Sheets simulada en el borde (un servidor
 * HTTP con la forma de la API v4: celdas tipadas, RAW, append, borrar filas).
 */
const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const BOOK = 'libro_de_prueba_1234567890abcdef';

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}
class CapturingQueue extends SheetSyncQueue {
    runs: number[] = [];
    pushes: number[] = [];
    override enqueueRun(_tenantId: number, syncId: number): void {
        this.runs.push(syncId);
    }
    override enqueuePush(_tenantId: number, syncId: number): void {
        this.pushes.push(syncId);
    }
}

describe('Sincronizar una lista con Google Sheets (v0.1.459)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let sheets: FakeSheets;
    let fields: FieldsService;
    let listsService: ListsService;
    let engine: SheetSyncEngine;
    let svc: SheetSyncService;
    let dispatcher: CapturingDispatcher;
    let queue: CapturingQueue;
    let changes: RecordChangeHub;
    let events: EventWebhookHub;
    const reports: IncidentReport[] = [];
    const resolved: string[] = [];
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;
    let managerId: number;
    let connId: number;
    let managerConnId: number;
    let listId: number;
    let listSlug: string;
    const F: Record<string, number> = {};
    let syncId: number;
    const admin = () => ({ userId: adminId, role: 'admin' as const });

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(redisBox.url);
        sheets = await startFakeSheets();
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.test', GOOGLE_SHEETS_API_URL: sheets.apiBase });
        const rt = new RealtimeService();
        const audit = new AuditService(tenantDb);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const plansService = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansService, new EmailQuotaService(pg.db, plansService), new TenantSmtpService(pg.db, env));
        dispatcher = new CapturingDispatcher();
        const act = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        const incidents = new IncidentHub();
        incidents.subscribe({
            report: (r: IncidentReport) => {
                reports.push(r);
            },
            resolve: (_t: number, key: string) => {
                resolved.push(key);
            },
            resolvePrefix: () => undefined,
        } as never);
        engine = new SheetSyncEngine(tenantDb, connectors, fields, billing, act, dispatcher, rt, redis, env, incidents);
        queue = new CapturingQueue();
        changes = new RecordChangeHub();
        events = new EventWebhookHub();
        svc = new SheetSyncService(tenantDb, pg.db, connectors, listsService, fields, engine, queue, audit, changes, events);

        await pg.db.insert(plans).values({ slug: 'grande', name: 'Grande', maxRecords: null }).onConflictDoNothing();
        await pg.db.insert(plans).values({ slug: 'mini', name: 'Mini', maxRecords: 6 }).onConflictDoNothing();
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-sheets', name: 'Acme', plan: 'grande' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra-sheets', name: 'Otra', plan: 'grande' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.co', name: 'Admin', passwordHash: 'x' }).returning();
        const [m] = await pg.db.insert(users).values({ email: 'gerente@acme.co', name: 'Gerente', passwordHash: 'x' }).returning();
        adminId = u!.id;
        managerId = m!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: adminId, role: 'admin' },
                { tenantId, userId: managerId, role: 'manager' },
            ]),
        );
        const [c] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: 'google_sheets',
                    name: 'Google Sheets · ana@acme.co',
                    authType: 'oauth2',
                    visibility: 'workspace',
                    ownerUserId: adminId,
                    config: { account_label: 'ana@acme.co', oauth_state: { expiresAt: Date.now() + 3600_000, scope: '', error: null } },
                    secrets: { access_token: encryptSecret(sheets.token, KEY), refresh_token: encryptSecret('r', KEY) },
                })
                .returning({ id: connections.id }),
        );
        connId = c!.id;
        // La conexión privada del gerente: la puede editar, pero no ve todos los campos.
        const [mc] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: 'google_sheets',
                    name: 'Google Sheets · gerente@acme.co',
                    authType: 'oauth2',
                    visibility: 'private',
                    ownerUserId: managerId,
                    config: { account_label: 'gerente@acme.co', oauth_state: { expiresAt: Date.now() + 3600_000, scope: '', error: null } },
                    secrets: { access_token: encryptSecret(sheets.token, KEY), refresh_token: encryptSecret('r', KEY) },
                })
                .returning({ id: connections.id }),
        );
        managerConnId = mc!.id;

        const list = await listsService.create(tenantId, { name: 'Clientes' });
        listId = list.id;
        listSlug = list.slug;
        const mk = async (label: string, type: string, config?: Record<string, unknown>) => (await fields.create(tenantId, listSlug, { label, type: type as never, config })).id;
        F.nombre = await mk('Nombre', 'text');
        F.email = await mk('Email', 'email');
        F.monto = await mk('Monto', 'currency');
        F.estado = await mk('Estado', 'select', { options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }] });
        F.fecha = await mk('Fecha', 'date');
        F.secreto = await mk('Costo interno', 'number');
        // Un registro que ya estaba en la lista (no está en la hoja).
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, createdBy: adminId, data: { [`f${F.nombre}`]: 'Zeta SAS', [`f${F.monto}`]: 900, [`f${F.estado}`]: 'activo' } }),
        );

        sheets.setBook(BOOK, 'Clientes 2026', [
            {
                gid: 0,
                title: 'Clientes',
                rows: [
                    ['Nombre', 'Email', 'Monto', 'Estado', 'Fecha'],
                    ['Acme SAS', 'compras@acme.co', 1250.5, 'Activo', 46000],
                    ['Beta Ltda', 'hola@beta.co', 'abc', 'Inactivo', ''],
                    ['Gamma', 'gamma@gamma.co', 300, 'Nuevo cliente', '2026-07-30'],
                ],
            },
            { gid: 777, title: 'Otra pestaña', rows: [['x']] },
        ]);
    }, 240_000);

    afterAll(async () => {
        await sheets?.close();
        redis?.disconnect();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    const recordsOf = async () =>
        withTenant(pg.db, tenantId, (tx) =>
            tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(eq(records.listId, listId), isNull(records.deletedAt)))
                .orderBy(records.id),
        ).then((r) => r.map((x) => ({ id: x.id, data: x.data as Record<string, unknown> })));
    const byName = async (name: string) => (await recordsOf()).find((r) => r.data[`f${F.nombre}`] === name);
    const grid = () => sheets.grid(BOOK, 0);
    const writesSince = (from: number) => sheets.log.slice(from).filter((c) => c.method === 'POST');
    const editInApp = async (id: number, patch: Record<string, unknown>) =>
        withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(records)
                .set({ data: sql`${records.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
                .where(eq(records.id, id)),
        );

    it('«Probar» abre la planilla por su enlace: pestañas, columnas con tipo sugerido y las primeras filas', async () => {
        const p = await svc.preview(tenantId, admin(), connId, { spreadsheet: `https://docs.google.com/spreadsheets/d/${BOOK}/edit#gid=0` });
        expect(p.spreadsheet_title).toBe('Clientes 2026');
        expect(p.tabs.map((t) => t.title)).toEqual(['Clientes', 'Otra pestaña']);
        expect(p.columns.map((c) => [c.name, c.letter, c.suggested_type])).toEqual([
            ['Nombre', 'A', 'text'],
            ['Email', 'B', 'email'],
            ['Monto', 'C', 'text'],
            // Tres estados distintos en tres filas: todavía no parece una selección.
            ['Estado', 'D', 'text'],
            ['Fecha', 'E', 'date'],
        ]);
        expect(p.rows[0]).toMatchObject({ Nombre: 'Acme SAS', Monto: '1250.5' });
        expect(p.total_rows).toBe(3);
        await expect(svc.preview(tenantId, admin(), connId, { spreadsheet: 'no es un enlace' })).rejects.toMatchObject({ response: { code: 'sheet_sync_invalid' } });
    });

    it('valida la configuración: campo oculto para quien la arma, campo repetido, conexión de otra cosa', async () => {
        const base = {
            name: 'Clientes ↔ hoja',
            list_id: listId,
            spreadsheet_id: BOOK,
            sheet_gid: 0,
            direction: 'both' as const,
            columns: [
                { column: 'Nombre', field_id: F.nombre! },
                { column: 'Email', field_id: F.email! },
                { column: 'Monto', field_id: F.monto! },
                { column: 'Estado', field_id: F.estado! },
                { column: 'Fecha', field_id: F.fecha! },
            ],
            on_sheet_delete: 'trash' as const,
            on_app_delete: 'delete_row' as const,
            interval_minutes: 15,
        };
        const parsed = (await import('@imagina-base/shared')).createSheetSyncSchema.parse(base);
        // El gerente no ve «Costo interno»: no la puede mandar a la hoja.
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({ settings: { permissions: { permissions: { manager: { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: ['costo_interno'] } } } } })
                .where(eq(lists.id, listId)),
        );
        await expect(
            svc.create(tenantId, { userId: managerId, role: 'manager' }, managerConnId, { ...parsed, columns: [...parsed.columns, { column: 'Costo', field_id: F.secreto! }] }),
        ).rejects.toMatchObject({ response: { message: expect.stringMatching(/oculto/) } });
        await expect(
            svc.create(tenantId, admin(), connId, { ...parsed, columns: [...parsed.columns, { column: 'Nombre 2', field_id: F.nombre! }] }),
        ).rejects.toMatchObject({ response: { message: expect.stringMatching(/mismo campo/) } });
        await expect(svc.create(tenantId, admin(), connId, { ...parsed, sheet_gid: 999 })).rejects.toMatchObject({ response: { message: expect.stringMatching(/pestaña no existe/) } });

        const created = await svc.create(tenantId, admin(), connId, parsed);
        syncId = created.id;
        expect(created).toMatchObject({ spreadsheet_title: 'Clientes 2026', sheet_title: 'Clientes', key: { mode: 'app_id', column: 'ID' }, direction: 'both' });
        expect(created.spreadsheet_url).toContain(`/d/${BOOK}/edit#gid=0`);
        expect(queue.runs).toContain(syncId);
    });

    it('«Probar» la carga no escribe nada ni en la app ni en la hoja', async () => {
        const before = sheets.log.length;
        const dry = await svc.dryRun(tenantId, admin(), syncId);
        expect(dry.result).toMatchObject({ read: 3, created: 3, rows_added: 1, failed: 1 });
        expect(dry.sample.some((s) => s.action === 'create')).toBe(true);
        expect(writesSince(before)).toHaveLength(0);
        expect(await recordsOf()).toHaveLength(1);
    });

    it('primera carga: crea los registros, escribe la columna ID y agrega a la hoja lo que sólo estaba en la app — sin automatizaciones', async () => {
        expect(await engine.run(tenantId, syncId)).toBe(true);
        const st = (await svc.get(tenantId, admin(), syncId)).status;
        expect(st.last_error).toBeNull();
        expect(st.last_result).toMatchObject({ read: 3, created: 3, updated: 0, rows_added: 1, failed: 1 });
        // La celda inválida: el registro entra con el campo vacío y queda el aviso.
        expect(st.errors).toEqual([expect.objectContaining({ where: 'Fila 3', message: expect.stringMatching(/«Monto».*quedó vacío/) })]);
        const acme = await byName('Acme SAS');
        expect(acme!.data).toMatchObject({ [`f${F.email}`]: 'compras@acme.co', [`f${F.monto}`]: 1250.5, [`f${F.estado}`]: 'activo', [`f${F.fecha}`]: '2025-12-09' });
        expect((await byName('Beta Ltda'))!.data[`f${F.monto}`]).toBeUndefined();
        // La opción que no existía se agregó a la selección (como el import).
        const gamma = await byName('Gamma');
        const estado = (await fields.listByListId(tenantId, listId)).find((f) => f.id === F.estado)!;
        const nuevo = (estado.config as { options: Array<{ value: string; label: string }> }).options.find((o) => o.label === 'Nuevo cliente');
        expect(gamma!.data[`f${F.estado}`]).toBe(nuevo!.value);
        // La hoja: encabezado «ID», el número de cada registro y Zeta al final.
        const g = grid();
        expect(g[0]).toEqual(['Nombre', 'Email', 'Monto', 'Estado', 'Fecha', 'ID']);
        expect(g[1]![5]).toBe(acme!.id);
        expect(g[3]![5]).toBe(gamma!.id);
        const zeta = await byName('Zeta SAS');
        expect(g[4]).toEqual(['Zeta SAS', '', 900, 'Activo', '', zeta!.id]);
        // Primera carga: ni automatizaciones ni actividad.
        expect(dispatcher.events).toHaveLength(0);
        const acts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.listId, listId)));
        expect(acts).toHaveLength(0);
        expect((await svc.get(tenantId, admin(), syncId)).linked).toBe(4);
    });

    it('una segunda corrida sin cambios no escribe nada', async () => {
        const before = sheets.log.length;
        await engine.run(tenantId, syncId);
        expect((await svc.get(tenantId, admin(), syncId)).status.last_result).toMatchObject({ created: 0, updated: 0, cells_written: 0, rows_added: 0, unchanged: 4 });
        expect(writesSince(before)).toHaveLength(0);
    });

    it('un cambio en la hoja actualiza el registro, con su antes y después (actividad y automatizaciones)', async () => {
        const t = sheets.tab(BOOK, 0);
        t.rows[1]![2] = 2000;
        t.rows[1]![3] = 'Inactivo';
        await engine.run(tenantId, syncId);
        const acme = await byName('Acme SAS');
        expect(acme!.data).toMatchObject({ [`f${F.monto}`]: 2000, [`f${F.estado}`]: 'inactivo' });
        const ev = dispatcher.events.find((e) => e.recordId === acme!.id && e.trigger === 'record_updated');
        expect(ev?.before?.[`f${F.monto}`]).toBe(1250.5);
        expect(ev?.after?.[`f${F.monto}`]).toBe(2000);
        const acts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.recordId, acme!.id)));
        expect(acts.some((a) => a.action === 'record_updated')).toBe(true);
    });

    it('un cambio en la app escribe SÓLO esa celda en la hoja (y llega solo, por el aviso de cambios)', async () => {
        const gamma = (await byName('Gamma'))!;
        await editInApp(gamma.id, { [`f${F.email}`]: 'nuevo@gamma.co' });
        changes.emit({ tenantId, listId, recordId: gamma.id, before: gamma.data, after: { ...gamma.data, [`f${F.email}`]: 'nuevo@gamma.co' } });
        await new Promise((r) => setTimeout(r, 200));
        expect(queue.pushes).toContain(syncId);
        const before = sheets.log.length;
        await engine.run(tenantId, syncId);
        const posts = writesSince(before);
        expect(posts).toHaveLength(1);
        expect(posts[0]!.path).toContain('values:batchUpdate');
        expect((posts[0]!.body as { valueInputOption: string; data: unknown[] }).valueInputOption).toBe('RAW');
        expect((posts[0]!.body as { data: unknown[] }).data).toEqual([{ range: "'Clientes'!B4", values: [['nuevo@gamma.co']] }]);
        expect(grid()[3]![1]).toBe('nuevo@gamma.co');
    });

    it('un registro nuevo en la app se agrega como fila nueva con su ID; un texto con «=» queda como texto', async () => {
        const [r] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({ tenantId, listId, createdBy: adminId, data: { [`f${F.nombre}`]: '=HYPERLINK("http://malo")', [`f${F.monto}`]: 10 } })
                .returning({ id: records.id }),
        );
        await engine.run(tenantId, syncId);
        const g = grid();
        const last = g[g.length - 1]!;
        expect(last[0]).toBe('=HYPERLINK("http://malo")');
        expect(last[5]).toBe(r!.id);
        const append = sheets.log.filter((c) => c.path.includes(':append')).pop()!;
        expect(append.path).toContain('valueInputOption=RAW');
    });

    it('la misma celda cambió en los dos lados: gana la app y queda anotado', async () => {
        const zeta = (await byName('Zeta SAS'))!;
        const t = sheets.tab(BOOK, 0);
        const row = t.rows.findIndex((r) => r[5] === zeta.id);
        t.rows[row]![2] = 111;
        await editInApp(zeta.id, { [`f${F.monto}`]: 999 });
        await engine.run(tenantId, syncId);
        expect((await byName('Zeta SAS'))!.data[`f${F.monto}`]).toBe(999);
        expect(t.rows[row]![2]).toBe(999);
        const st = (await svc.get(tenantId, admin(), syncId)).status;
        expect(st.last_result!.conflicts).toBe(1);
        expect(st.conflicts).toEqual([{ where: `Fila ${row + 1}`, field: 'Monto', kept: '999', replaced: '111' }]);
    });

    it('una celda inválida en un registro que ya existe: la app conserva su valor y avisa', async () => {
        const t = sheets.tab(BOOK, 0);
        t.rows[1]![2] = 'mucho';
        await engine.run(tenantId, syncId);
        expect((await byName('Acme SAS'))!.data[`f${F.monto}`]).toBe(2000);
        const st = (await svc.get(tenantId, admin(), syncId)).status;
        expect(st.errors.some((e) => e.where === 'Fila 2' && /conserva su valor/.test(e.message))).toBe(true);
        t.rows[1]![2] = 2000;
    });

    it('fila borrada en la hoja → el registro va a la papelera; registro borrado en la app → se borra su fila', async () => {
        const beta = (await byName('Beta Ltda'))!;
        const t = sheets.tab(BOOK, 0);
        const betaRow = t.rows.findIndex((r) => r[5] === beta.id);
        t.rows.splice(betaRow, 1);
        await engine.run(tenantId, syncId);
        expect(await byName('Beta Ltda')).toBeUndefined();
        expect((await svc.get(tenantId, admin(), syncId)).status.last_result!.trashed).toBe(1);
        const trashedAct = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, beta.id), eq(activity.action, 'record_deleted'))));
        expect(trashedAct[0]!.diff).toEqual({ source_gone: { from: 'Google Sheets', to: null } });

        const gamma = (await byName('Gamma'))!;
        await withTenant(pg.db, tenantId, (tx) => tx.update(records).set({ deletedAt: new Date() }).where(eq(records.id, gamma.id)));
        events.emit({ tenantId, event: 'record.deleted', listId, recordId: gamma.id });
        await new Promise((r) => setTimeout(r, 100));
        await engine.run(tenantId, syncId);
        expect(grid().some((r) => r[5] === gamma.id)).toBe(false);
        expect((await svc.get(tenantId, admin(), syncId)).status.last_result!.rows_deleted).toBe(1);
        const links = await withTenant(pg.db, tenantId, (tx) => tx.select().from(sheetSyncRows).where(eq(sheetSyncRows.recordId, gamma.id)));
        expect(links).toHaveLength(0);
    });

    it('el plan manda: si las altas no entran, el resto sigue y se avisa (con un problema abierto)', async () => {
        await pg.db.update(tenants).set({ plan: 'mini' }).where(eq(tenants.id, tenantId));
        const t = sheets.tab(BOOK, 0);
        for (let i = 0; i < 4; i++) t.rows.push([`Nuevo ${i}`, '', 1, '', '', '']);
        await engine.run(tenantId, syncId);
        const st = (await svc.get(tenantId, admin(), syncId)).status;
        expect(st.last_result!.created).toBe(0);
        expect(st.last_error).toMatch(/No se crearon 4 registros nuevos/);
        expect(reports.some((r) => r.key === `sheet_sync:${connId}:${syncId}` && /no terminó todo/.test(r.title))).toBe(true);
        expect(await byName('Nuevo 0')).toBeUndefined();
        await pg.db.update(tenants).set({ plan: 'grande' }).where(eq(tenants.id, tenantId));
        await engine.run(tenantId, syncId);
        expect(await byName('Nuevo 3')).toBeDefined();
        expect(resolved).toContain(`sheet_sync:${connId}:${syncId}`);
        // Las filas nuevas ya tienen su ID: la próxima corrida no las duplica.
        await engine.run(tenantId, syncId);
        expect((await recordsOf()).filter((r) => String(r.data[`f${F.nombre}`]).startsWith('Nuevo '))).toHaveLength(4);
    });

    it('autorización vencida: la corrida falla con el motivo, abre un problema y no toca nada; al volver, se cierra', async () => {
        const before = await recordsOf();
        sheets.failWith = 401;
        await engine.run(tenantId, syncId);
        const st = (await svc.get(tenantId, admin(), syncId)).status;
        expect(st.last_error).toMatch(/autorización venció o se revocó/);
        expect(reports.some((r) => r.key === `sheet_sync:${connId}:${syncId}` && /Falló la sincronización/.test(r.title))).toBe(true);
        expect(await recordsOf()).toEqual(before);
        sheets.failWith = null;
        resolved.length = 0;
        await engine.run(tenantId, syncId);
        expect((await svc.get(tenantId, admin(), syncId)).status.last_error).toBeNull();
        expect(resolved).toContain(`sheet_sync:${connId}:${syncId}`);
    });

    it('dos corridas a la vez: una sola trabaja (candado)', async () => {
        const [a, b] = await Promise.all([engine.run(tenantId, syncId), engine.run(tenantId, syncId)]);
        expect([a, b].sort()).toEqual([false, true]);
    });

    it('clave por columna de la hoja + «De la hoja a la app»: empareja por email, no escribe en la hoja', async () => {
        const other = await listsService.create(tenantId, { name: 'Contactos' });
        const nombre = (await fields.create(tenantId, other.slug, { label: 'Nombre', type: 'text' })).id;
        const email = (await fields.create(tenantId, other.slug, { label: 'Correo', type: 'email' })).id;
        const [existing] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId: other.id, createdBy: adminId, data: { [`f${email}`]: 'ANA@acme.co', [`f${nombre}`]: 'Ana vieja' } }).returning({ id: records.id }),
        );
        sheets.setBook('libro_de_contactos_1234567890', 'Contactos', [{ gid: 5, title: 'Hoja 1', rows: [['Correo', 'Nombre'], ['ana@acme.co ', 'Ana'], ['luis@acme.co', 'Luis'], ['', 'Sin correo']] }]);
        const created = await svc.create(tenantId, admin(), connId, {
            name: 'Contactos',
            list_id: other.id,
            spreadsheet_id: 'libro_de_contactos_1234567890',
            sheet_gid: 5,
            header_row: 1,
            direction: 'sheet_to_app',
            key: { mode: 'field', column: 'Correo', field_id: email },
            columns: [{ column: 'Nombre', field_id: nombre }],
            on_sheet_delete: 'ignore',
            on_app_delete: 'ignore',
            interval_minutes: 60,
            enabled: true,
        });
        const before = sheets.log.length;
        await engine.run(tenantId, created.id);
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: records.id, data: records.data }).from(records).where(eq(records.listId, other.id)));
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.id === existing!.id)!.data).toMatchObject({ [`f${nombre}`]: 'Ana' });
        expect(writesSince(before)).toHaveLength(0);
        const st = (await svc.get(tenantId, admin(), created.id)).status;
        expect(st.errors).toEqual([expect.objectContaining({ where: 'Fila 4', message: expect.stringMatching(/clave «Correo» está vacía/) })]);
        // Lo editado en la app vuelve al valor de la hoja (la hoja manda).
        await editInApp(existing!.id, { [`f${nombre}`]: 'Cambio en la app' });
        await engine.run(tenantId, created.id);
        const again = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, existing!.id)));
        expect((again[0]!.data as Record<string, unknown>)[`f${nombre}`]).toBe('Ana');
    });

    it('RLS: otra empresa no ve las sincronizaciones ni sus vínculos', async () => {
        const mine = await withTenant(pg.db, tenantId, (tx) => tx.select().from(sheetSyncs));
        expect(mine.length).toBeGreaterThan(0);
        const theirs = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(sheetSyncs));
        const theirLinks = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(sheetSyncRows));
        expect(theirs).toHaveLength(0);
        expect(theirLinks).toHaveLength(0);
        await expect(svc.get(otherTenant, { userId: adminId, role: 'admin' }, syncId)).rejects.toMatchObject({ response: { code: 'sheet_sync_not_found' } });
    });

    it('el asistente y el MCP ven la sincronización (sin el token), sólo quien administra listas', async () => {
        const tools = new SheetSyncAiTools(svc);
        const extra = (await tools.schemaExtra({ tenantId, userId: adminId, role: 'admin' }, { id: listId })) as {
            google_sheets?: { items: Array<Record<string, unknown>> };
        };
        expect(extra.google_sheets!.items[0]).toMatchObject({
            id: syncId,
            spreadsheet: 'Clientes 2026',
            sheet: 'Clientes',
            direction: 'both',
            key: { column: 'ID' },
            every: 'cada 15 minutos',
        });
        expect(JSON.stringify(extra)).not.toContain(sheets.token);
        expect(await tools.schemaExtra({ tenantId, userId: managerId, role: 'agent' }, { id: listId })).toEqual({});
    });

    it('borrar la sincronización deja los datos de los dos lados', async () => {
        const count = (await recordsOf()).length;
        const rowsInSheet = grid().length;
        await svc.remove(tenantId, admin(), syncId);
        expect((await recordsOf()).length).toBe(count);
        expect(grid().length).toBe(rowsInSheet);
        const left = await withTenant(pg.db, tenantId, (tx) => tx.select().from(sheetSyncRows).where(eq(sheetSyncRows.syncId, syncId)));
        expect(left).toHaveLength(0);
    });
});
