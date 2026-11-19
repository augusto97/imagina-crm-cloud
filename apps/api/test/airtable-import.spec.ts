import { and, eq, inArray, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AirtableImportStatus, AirtablePlan } from '@imagina-base/shared';
import { AirtableClient } from '../src/airtable-import/airtable-client';
import { AirtableImportService, airtableLockKey, airtableSessionKey, airtableTokenKey } from '../src/airtable-import/airtable-import.service';
import { ProposalsStore } from '../src/ai/proposals.store';
import type { AiToolContext } from '../src/ai/tools/registry';
import { StructureTools } from '../src/ai/tools/structure-tools';
import { AuditService } from '../src/audit/audit.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import {
    activity,
    attachments,
    auditLog,
    automationRuns,
    fields as fieldsTable,
    listGroups,
    lists as listsTable,
    memberships,
    plans,
    records,
    relations,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { FilesService } from '../src/files/files.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { ListGroupsService } from '../src/lists/list-groups.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { loadFakeAirtable, type FakeAirtable } from './helpers/fake-airtable';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class FakeHookStore implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

describe('v0.1.458 — cliente de Airtable (ritmo y reintentos)', () => {
    it('respeta Retry-After ante un 429 y reintenta; un 401 se explica en palabras', async () => {
        const sleeps: number[] = [];
        let calls = 0;
        const client = new AirtableClient({
            baseUrl: 'https://api.airtable.test',
            token: 'patSecreto',
            minIntervalMs: 0,
            sleep: async (ms) => {
                sleeps.push(ms);
            },
            fetch: async () => {
                calls++;
                if (calls <= 2) return { status: 429, body: '{}', headers: { 'retry-after': '3' } };
                return { status: 200, body: JSON.stringify({ id: 'usr1', scopes: ['data.records:read'] }) };
            },
        });
        const who = await client.whoami();
        expect(who.scopes).toEqual(['data.records:read']);
        expect(sleeps).toEqual([3000, 3000]);
        expect(client.stats).toEqual({ requests: 3, rate_limited: 2 });
        expect(AirtableClient.missingScopes(who.scopes)).toEqual(['schema.bases:read']);

        const bad = new AirtableClient({ baseUrl: 'https://api.airtable.test', token: 'x', minIntervalMs: 0, fetch: async () => ({ status: 401, body: '{"error":{"type":"AUTHENTICATION_REQUIRED"}}' }) });
        await expect(bad.whoami()).rejects.toMatchObject({ code: 'airtable_token_invalid' });
        // El token nunca aparece en el mensaje.
        await expect(bad.whoami()).rejects.not.toThrow(/x$/);
    });

    it('deja al menos el intervalo entre pedidos (5 por segundo por base)', async () => {
        const at: number[] = [];
        const client = new AirtableClient({
            baseUrl: 'https://api.airtable.test',
            token: 't',
            minIntervalMs: 60,
            fetch: async () => {
                at.push(Date.now());
                return { status: 200, body: '{"bases":[]}' };
            },
        });
        await client.bases();
        await client.bases();
        await client.bases();
        expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(55);
        expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(55);
    });
});

describe('v0.1.458 — «Importar de Airtable» (Postgres + Redis reales, Airtable falso)', () => {
    let pg: TestPg;
    let rc: TestRedis;
    let redis: Redis;
    let fake: FakeAirtable;
    let mod: Awaited<ReturnType<typeof loadFakeAirtable>>;
    let tenantDb: TenantDb;
    let svc: AirtableImportService;
    let billing: BillingService;
    let tenantId: number;
    let adminId: number;
    let admin: AiToolContext;
    const ADMIN_EMAIL = 'ana@agencia.test';

    beforeAll(async () => {
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        [pg, rc] = await Promise.all([startPostgres(), startRedis()]);
        mod = await loadFakeAirtable();
        fake = await mod.startFakeAirtable({ port: 0, memberEmail: ADMIN_EMAIL });
        redis = new Redis(rc.url);
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', AIRTABLE_API_URL: fake.url, FILES_SIGNING_SECRET: 'firma' });
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), lists, rt);
        const audit = new AuditService(tenantDb);
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const autos = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), lists, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plansSvc = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plansSvc, new EmailQuotaService(pg.db, plansSvc), new TenantSmtpService(pg.db, env));
        const dash = new DashboardsService(tenantDb, null as never, null as never, null as never);
        const blueprint = new BlueprintService(tenantDb, lists, fields, views, autos, new RecordsRepository(), new RelationsRepository(), billing, rt, dash);
        const structure = new StructureTools(tenantDb, lists, fields, views, autos, dash, blueprint, new ProposalsStore(redis), connectors, null as never, null as never);
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-airtable-'))), env);
        svc = new AirtableImportService(tenantDb, lists, new ListGroupsService(tenantDb), fields, blueprint, structure, billing, files, rt, audit, redis, env);
        svc.clientOptions = { minIntervalMs: 5 };
        const [a] = await pg.db.insert(users).values([{ email: ADMIN_EMAIL, name: 'Ana', passwordHash: 'x' }]).returning();
        adminId = a!.id;
        // Un plan chico para probar los límites (registros y almacenamiento).
        await pg.db.insert(plans).values({ slug: 'mini', name: 'Mini', maxRecords: 100, maxUsers: 5, maxAutomations: 5, maxStorageMb: 0 }).onConflictDoNothing();
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await fake?.stop();
        await Promise.all([pg?.stop(), rc?.stop()]);
    });

    let n = 0;
    beforeEach(async () => {
        n += 1;
        const [t] = await pg.db.insert(tenants).values({ slug: `airtable-${n}`, name: `Airtable ${n}`, plan: 'pro', status: 'active' }).returning();
        tenantId = t!.id;
        await pg.db.insert(memberships).values([{ tenantId, userId: adminId, role: 'admin' }]);
        admin = { tenantId, userId: adminId, role: 'admin' };
        await redis.flushdb();
        fake.control({ rate_limit: 0, retry_after: null });
    });

    async function ready(ctx: AiToolContext = admin): Promise<AirtableImportStatus> {
        const connected = await svc.connect(ctx, mod.FULL_TOKEN);
        await svc.chooseBase(ctx, connected.id, mod.AGENCY_BASE);
        const status = await svc.waitFor(ctx, connected.id);
        expect(status.stage).toBe('ready');
        return status;
    }

    async function imported(plan?: AirtablePlan, extra: { max_records?: number } = {}): Promise<AirtableImportStatus> {
        const st = await ready();
        await svc.apply(admin, st.id, { plan: plan ?? st.plan!, ...extra });
        return svc.waitFor(admin, st.id);
    }

    async function listByName(name: string) {
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(listsTable).where(and(eq(listsTable.tenantId, tenantId), eq(listsTable.name, name))));
        return l!;
    }
    async function fieldsOf(listId: number) {
        const fs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.listId, listId)));
        return new Map(fs.map((f) => [f.label, f]));
    }
    async function rowsOf(listId: number) {
        return withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)).orderBy(records.id));
    }

    it('un token inválido o sin permisos se rechaza con el motivo en palabras', async () => {
        await expect(svc.connect(admin, 'patNoExiste00000.0123456789abcdef0123456789abcdef')).rejects.toMatchObject({ response: { code: 'airtable_token_invalid' } });
        const err = await svc.connect(admin, mod.DATA_ONLY_TOKEN).catch((e: { response: { code: string; message: string } }) => e.response);
        expect(err).toMatchObject({ code: 'airtable_missing_scope' });
        expect((err as { message: string }).message).toContain('schema.bases:read');
        // Ningún token quedó guardado.
        expect(await redis.keys('airtable:t:*')).toEqual([]);
    });

    it('la vista previa: tipos, título, vínculos de un solo lado, personas y adjuntos medidos', async () => {
        const st = await ready();
        expect(st.bases.map((b) => b.name)).toEqual(['Agencia Creativa', 'Inventario']);
        expect(st.scan.map((s) => [s.table_id, s.records])).toEqual([
            ['tblClientes000001', 8],
            ['tblProyectos00001', 12],
            ['tblTareas00000001', 130],
        ]);
        const tareas = st.scan[2]!;
        expect(tareas.attachments.fldTarArchivos001).toMatchObject({ files: 7, too_big: 1 });
        expect(st.scan[1]!.autonumber_max.fldProCodigo00001).toBe(12);
        // El correo de alguien de afuera no se guarda.
        expect(st.scan[1]!.people.fldProLider000001).toEqual(
            expect.arrayContaining([
                { email: ADMIN_EMAIL, name: 'Persona del equipo', member: true },
                { email: null, name: 'Luis Freelance', member: false },
            ]),
        );
        expect(st.limit).toMatchObject({ storage_external: false });
        const plan = st.plan!;
        expect(plan.attachments).toBe(true);
        expect(plan.folder_name).toBe('Agencia Creativa');
        const fieldsOfTable = (tid: string) => plan.tables.find((t) => t.table_id === tid)!.fields;
        const typeOf = (tid: string, fid: string) => fieldsOfTable(tid).find((f) => f.field_id === fid)!;
        expect(typeOf('tblClientes000001', 'fldCliProyectos01').include).toBe(false); // la otra cara
        expect(typeOf('tblProyectos00001', 'fldProCliente0001')).toMatchObject({ include: true, type: 'relation' });
        expect(typeOf('tblProyectos00001', 'fldProMargen00001')).toMatchObject({ include: true, type: 'currency' });
        expect(typeOf('tblProyectos00001', 'fldProLider000001')).toMatchObject({ type: 'text' });
        expect(typeOf('tblClientes000001', 'fldCliEjecutivo01')).toMatchObject({ type: 'user' });
        expect(typeOf('tblProyectos00001', 'fldProBoton000001').include).toBe(false);
        expect(typeOf('tblTareas00000001', 'fldTarNuevo000001').include).toBe(false);
        // El token vive cifrado en Redis mientras dura la importación (nunca en claro).
        const raw = await redis.get(airtableTokenKey(tenantId, adminId, st.id));
        expect(raw).toBeTruthy();
        expect(raw).not.toContain(mod.FULL_TOKEN);
    });

    it('importa la base: listas en una carpeta, una relación por vínculo, opciones con color, fechas, personas, fórmulas fijas y adjuntos', async () => {
        const roomBefore = await billing.storageRoomBytes(tenantId);
        const st = await imported();
        expect(st.stage).toBe('done');
        const res = st.result!;
        expect(res.lists.map((l) => [l.name, l.records])).toEqual([
            ['Clientes', 8],
            ['Proyectos', 12],
            ['Tareas', 130],
        ]);
        expect(res).toMatchObject({ imported: 150, left_out: 0, linked: 142, unmatched_links: 0, files: 7, files_skipped: 1 });
        expect(res.cell_warnings.some((w) => w.field === 'Margen estimado')).toBe(true); // el NaN de la fórmula
        expect(res.cell_warnings.some((w) => w.field === 'Correo')).toBe(true); // el correo inválido

        const [folder] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(listGroups).where(eq(listGroups.id, res.group_id!)));
        expect(folder!.name).toBe('Agencia Creativa');

        const clientes = await listByName('Clientes');
        const proyectos = await listByName('Proyectos');
        const tareas = await listByName('Tareas');
        const cf = await fieldsOf(clientes.id);
        const pf = await fieldsOf(proyectos.id);
        const tf = await fieldsOf(tareas.id);
        // UN solo campo relación por vínculo (en el lado que apunta a un solo registro).
        expect([...cf.values()].filter((f) => f.type === 'relation')).toHaveLength(0);
        expect([...pf.values()].filter((f) => f.type === 'relation').map((f) => f.label)).toEqual(['Cliente']);
        expect([...tf.values()].filter((f) => f.type === 'relation').map((f) => f.label)).toEqual(['Proyecto']);
        expect(cf.get('Segmento')!.config).toMatchObject({
            options: [
                { label: 'Pyme', value: 'pyme', color: 'blue' },
                { label: 'Corporativo', value: 'corporativo', color: 'violet' },
                { label: 'Gobierno', value: 'gobierno', color: 'green' },
            ],
        });
        expect(pf.has('Abrir en Drive')).toBe(false);
        expect(tf.has('Campo nuevo de Airtable')).toBe(false);

        const k = (f: { id: number }) => `f${f.id}`;
        const cRows = await rowsOf(clientes.id);
        expect(cRows[0]!.data[k(cf.get('Segmento')!)]).toBe('pyme');
        expect(cRows[0]!.data[k(cf.get('Ejecutivo')!)]).toBe(adminId); // miembro → Persona
        expect(cRows[0]!.data[k(cf.get('Etiquetas')!)]).toEqual(['vip', 'recurrente']);
        // La fecha de creación del registro es la de Airtable.
        expect(cRows[0]!.createdAt.toISOString()).toBe('2025-01-10T14:30:00.000Z');

        const pRows = await rowsOf(proyectos.id);
        expect(pRows[0]!.data[k(pf.get('Presupuesto')!)]).toBe(4_000_000);
        expect(pf.get('Presupuesto')!.config).toMatchObject({ currency: 'COP', precision: 0 });
        expect(pRows[1]!.data[k(pf.get('Avance')!)]).toBe(9); // 0,09 → 9 %
        expect(pRows[0]!.data[k(pf.get('Inicio')!)]).toBe('2026-01-01');
        expect(pRows[0]!.data[k(pf.get('Entrega')!)]).toBe('2026-10-10T20:30:00.000Z');
        expect(pRows[0]!.data[k(pf.get('Tiempo estimado')!)]).toBe(90); // 5400 s → 90 min
        expect(pRows[0]!.data[k(pf.get('Líder')!)]).toBe('Persona del equipo'); // texto: hay gente de afuera
        expect(pRows[1]!.data[k(pf.get('Líder')!)]).toBe('Luis Freelance');
        expect(pRows[0]!.data[k(pf.get('Margen estimado')!)]).toBe(1_200_000); // fórmula: dato fijo
        expect(pRows[11]!.data[k(pf.get('Margen estimado')!)]).toBeUndefined();
        expect(pRows.map((r) => r.data[k(pf.get('Código')!)])).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));

        // El número automático sigue desde el último de Airtable.
        const [nuevo] = await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId: proyectos.id, data: {}, createdBy: adminId }).returning());
        expect(nuevo!.data[k(pf.get('Código')!)]).toBe('13');

        // Vínculos: cada tarea apunta a su proyecto.
        const rels = await withTenant(pg.db, tenantId, (tx) => tx.select().from(relations).where(eq(relations.fieldId, tf.get('Proyecto')!.id)));
        expect(rels).toHaveLength(130);
        // Adjuntos: archivos de la app que cuentan para el almacenamiento.
        const tRows = await rowsOf(tareas.id);
        const fileIds = tRows[0]!.data[k(tf.get('Archivos')!)] as number[];
        expect(fileIds).toHaveLength(2);
        const atts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(attachments).where(eq(attachments.tenantId, tenantId)));
        expect(atts).toHaveLength(7);
        const bytes = atts.reduce((s, a) => s + a.sizeBytes, 0);
        const roomAfter = await billing.storageRoomBytes(tenantId);
        if (roomBefore !== null && roomAfter !== null) expect(roomBefore - roomAfter).toBe(bytes);

        // La primera carga no dispara automatizaciones ni escribe actividad.
        const runs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.tenantId, tenantId)));
        expect(runs).toHaveLength(0);
        const acts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(inArray(activity.listId, [clientes.id, proyectos.id, tareas.id])));
        expect(acts).toHaveLength(0);

        // El token se borró y no quedó en ningún lado.
        expect(await redis.get(airtableTokenKey(tenantId, adminId, st.id))).toBeNull();
        expect(await redis.get(airtableLockKey(tenantId))).toBeNull();
        for (const key of await redis.keys('*')) {
            const type = await redis.type(key);
            if (type === 'string') expect(await redis.get(key)).not.toContain(mod.FULL_TOKEN);
        }
        let found = 0;
        for (const table of ['audit_log', 'lists', 'fields', 'records', 'list_groups', 'attachments', 'users', 'tenants', 'memberships']) {
            const r = await pg.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table} t WHERE t::text LIKE '%patDemoAgencia0001%'`));
            found += Number((r as unknown as { rows: Array<{ n: number }> }).rows?.[0]?.n ?? 0);
        }
        expect(found).toBe(0);
        // La bitácora dice qué se importó (sin el token).
        for (let i = 0; i < 40; i++) {
            const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'airtable_import.apply'))));
            if (rows.length > 0) {
                expect(rows[0]!.meta).toMatchObject({ records: 150, linked: 142, files: 7 });
                break;
            }
            await new Promise((r) => setTimeout(r, 25));
        }

        // RLS: otra empresa no ve nada de lo importado.
        const [other] = await pg.db.insert(tenants).values({ slug: `otra-${n}`, name: 'Otra', plan: 'pro', status: 'active' }).returning();
        const seen = await withTenant(pg.db, other!.id, (tx) => tx.select().from(records).where(eq(records.listId, tareas.id)));
        expect(seen).toHaveLength(0);
        const seenLists = await withTenant(pg.db, other!.id, (tx) => tx.select().from(listsTable).where(eq(listsTable.id, tareas.id)));
        expect(seenLists).toHaveLength(0);
    });

    it('ante un 429 de Airtable espera y sigue', async () => {
        fake.control({ rate_limit: 2, retry_after: 0 });
        const before = fake.state.rateLimited;
        const st = await ready();
        expect(fake.state.rateLimited - before).toBe(2);
        expect(st.scan.reduce((s, x) => s + x.records, 0)).toBe(150);
    });

    it('el límite del plan: avisa antes de crear y deja importar sólo lo que entra; los adjuntos que no entran tampoco', async () => {
        await pg.db.update(tenants).set({ plan: 'mini' }).where(eq(tenants.id, tenantId));
        const st = await ready();
        expect(st.limit).toMatchObject({ records_remaining: 100, storage_room: 0 });
        // Sin lugar en el almacenamiento, el borrador ya viene sin adjuntos.
        expect(st.plan!.attachments).toBe(false);
        await expect(svc.apply(admin, st.id, { plan: st.plan! })).rejects.toMatchObject({ response: { code: 'plan_limit_reached' } });
        const withFiles = structuredClone(st.plan!);
        withFiles.attachments = true;
        withFiles.tables[2]!.fields.find((f) => f.field_id === 'fldTarArchivos001')!.include = true;
        withFiles.tables[2]!.fields.find((f) => f.field_id === 'fldTarArchivos001')!.type = 'file';
        await expect(svc.apply(admin, st.id, { plan: withFiles, max_records: 100 })).rejects.toMatchObject({ response: { code: 'storage_limit_reached' } });
        await svc.apply(admin, st.id, { plan: st.plan!, max_records: 100 });
        const done = await svc.waitFor(admin, st.id);
        expect(done.stage).toBe('done');
        expect(done.result).toMatchObject({ imported: 100, left_out: 50, files: 0 });
        expect(done.result!.warnings[0]).toContain('50 registros no se importaron');
    });

    it('una importación a la vez por empresa, permisos y solo lectura', async () => {
        const st = await ready();
        await redis.set(airtableLockKey(tenantId), 'otra', 'EX', 60);
        await expect(svc.apply(admin, st.id, { plan: st.plan! })).rejects.toMatchObject({ response: { code: 'airtable_import_busy' } });
        await redis.del(airtableLockKey(tenantId));

        const viewer: AiToolContext = { tenantId, userId: adminId, role: 'viewer' };
        await expect(svc.apply(viewer, st.id, { plan: st.plan! })).rejects.toMatchObject({ response: { code: 'forbidden' } });

        await pg.db.update(tenants).set({ archivedAt: new Date() }).where(eq(tenants.id, tenantId));
        await expect(svc.apply(admin, st.id, { plan: st.plan! })).rejects.toMatchObject({ response: { code: 'read_only' } });
        await pg.db.update(tenants).set({ archivedAt: null }).where(eq(tenants.id, tenantId));

        // Un plan con un error (el título fuera) no crea nada.
        const bad = structuredClone(st.plan!);
        bad.tables[0]!.fields.find((f) => f.field_id === 'fldCliNombre00001')!.include = false;
        await expect(svc.apply(admin, st.id, { plan: bad })).rejects.toMatchObject({ response: { code: 'airtable_invalid_plan' } });
        const created = await withTenant(pg.db, tenantId, (tx) => tx.select().from(listsTable).where(eq(listsTable.tenantId, tenantId)));
        expect(created).toHaveLength(0);
    });

    it('cancelar antes de importar borra el token', async () => {
        const connected = await svc.connect(admin, mod.FULL_TOKEN);
        const res = await svc.cancel(admin, connected.id);
        expect(res.stage).toBe('cancelled');
        expect(await redis.get(airtableTokenKey(tenantId, adminId, connected.id))).toBeNull();
    });

    it('una corrida cortada por un reinicio no deja la pantalla esperando para siempre', async () => {
        const connected = await svc.connect(admin, mod.FULL_TOKEN);
        // Simula lo que deja un proceso que se reinició a mitad: la etapa quieta hace 11 minutos.
        const key = airtableSessionKey(tenantId, adminId, connected.id);
        const raw = JSON.parse((await redis.get(key))!);
        await redis.set(key, JSON.stringify({ ...raw, stage: 'importing', updated_at: new Date(Date.now() - 11 * 60_000).toISOString() }), 'EX', 600);
        const st = await svc.get(admin, connected.id);
        expect(st.stage).toBe('error');
        expect(st.error?.code).toBe('airtable_import_interrupted');
        expect(await redis.get(airtableTokenKey(tenantId, adminId, connected.id))).toBeNull();

        // Uno reciente (todavía puede estar corriendo en otro lado) no se toca.
        const other = await svc.connect(admin, mod.FULL_TOKEN);
        const k2 = airtableSessionKey(tenantId, adminId, other.id);
        const raw2 = JSON.parse((await redis.get(k2))!);
        await redis.set(k2, JSON.stringify({ ...raw2, stage: 'scanning', updated_at: new Date().toISOString() }), 'EX', 600);
        expect((await svc.get(admin, other.id)).stage).toBe('scanning');
    });
});
