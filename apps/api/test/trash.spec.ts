import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Field } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import type { BillingService } from '../src/billing/billing.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { attachments, auditLog, automationRuns, lists, memberships, records, relations, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { PublicListsService } from '../src/public-lists/public-lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { enterTrashMode } from '../src/trash/trash-ops';
import { TrashService } from '../src/trash/trash.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';
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

const rt = new RealtimeService();

describe('Papelera', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsSvc: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let views: ViewsService;
    let autos: AutomationsService;
    let dashboards: DashboardsService;
    let files: FilesService;
    let publicLists: PublicListsService;
    let trash: TrashService;
    let tenantA: number;
    let tenantB: number;
    const admin: Actor = { userId: 0, role: 'admin' };
    const agent: Actor = { userId: 0, role: 'agent' };
    const otherAdmin: Actor = { userId: 0, role: 'admin' };
    let planRoom = Infinity;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', TRASH_RETENTION_DAYS: '30' });
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsSvc,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsSvc),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        views = new ViewsService(tenantDb, new ViewsRepository(), listsSvc, rt);
        const audit = new AuditService(tenantDb);
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsSvc,
            new AutomationScheduler(),
            new FakeHookStore(),
            new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps()),
        );
        dashboards = new DashboardsService(tenantDb, null as never, recs, fieldsSvc);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-trash-'))), env);
        publicLists = new PublicListsService(pg.db, tenantDb, listsSvc, files);
        const billing = {
            assertCanCreateRecords: async (_t: number, n: number) => {
                if (n > planRoom) throw new ForbiddenException({ code: 'plan_limit_reached', message: 'Límite del plan' });
            },
            assertCanActivateAutomation: async () => undefined,
        } as unknown as BillingService;
        trash = new TrashService(tenantDb, pg.db, env, rt, audit, files, new AutomationScheduler(), new AutomationDispatcher(), billing);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const [u1, u2, u3] = await pg.db
            .insert(users)
            .values([
                { email: 'ana@acme.co', name: 'Ana Admin', passwordHash: 'x' },
                { email: 'beto@acme.co', name: 'Beto Agente', passwordHash: 'x' },
                { email: 'caro@acme.co', name: 'Caro Admin', passwordHash: 'x' },
            ])
            .returning();
        admin.userId = u1!.id;
        agent.userId = u2!.id;
        otherAdmin.userId = u3!.id;
        await pg.db.insert(memberships).values([
            { userId: u1!.id, tenantId: tenantA, role: 'admin' },
            { userId: u2!.id, tenantId: tenantA, role: 'agent' },
            { userId: u3!.id, tenantId: tenantA, role: 'admin' },
        ]);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    /** Una lista con Nombre (texto) y Cliente (relación a `targetSlug`), y N registros. */
    async function makeList(name: string): Promise<{ id: number; slug: string; nombre: Field }> {
        const l = await listsSvc.create(tenantA, { name });
        const nombre = await fieldsSvc.create(tenantA, String(l.id), { label: 'Nombre', type: 'text', slug: 'nombre' });
        return { id: l.id, slug: l.slug, nombre };
    }

    const countRaw = async (table: string, where: string): Promise<number> => {
        const r = await pg.db.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`));
        return Number(r.rows[0]?.n ?? 0);
    };

    it('lo borrado no se ve en la app (RLS) y sí en la papelera; otra empresa no la ve', async () => {
        const l = await makeList('Proveedores');
        const extra = await fieldsSvc.create(tenantA, String(l.id), { label: 'Código', type: 'text', slug: 'codigo' });
        const view = await views.create(tenantA, String(l.id), { name: 'Todos', type: 'table', config: {} }, { userId: admin.userId, role: 'admin' });
        await fieldsSvc.remove(tenantA, String(l.id), 'codigo', { userId: admin.userId });
        await views.remove(tenantA, String(l.id), view.id, { userId: admin.userId, role: 'admin' });

        // La app: el campo y la vista "no existen".
        expect((await fieldsSvc.list(tenantA, String(l.id))).map((f) => f.slug)).toEqual(['nombre']);
        await expect(views.get(tenantA, String(l.id), view.id, { userId: admin.userId, role: 'admin' })).rejects.toBeInstanceOf(NotFoundException);
        // Con el modo papelera, sí.
        const seen = await withTenant(pg.db, tenantA, async (tx) => {
            await enterTrashMode(tx);
            return tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM fields WHERE id = ${extra.id}`);
        });
        expect(Number(seen.rows[0]?.n)).toBe(1);

        const page = await trash.list(tenantA, admin, { page: 1, limit: 50 });
        expect(page.data.map((i) => `${i.type}:${i.name}`)).toEqual(expect.arrayContaining(['field:Código', 'view:Todos']));
        expect(page.data.find((i) => i.type === 'field')?.subtype).toBe('text');
        expect(page.data.find((i) => i.type === 'field')?.deleted_by_name).toBe('Ana Admin');
        // La otra empresa no ve nada de esto.
        const b = await trash.list(tenantB, { userId: admin.userId, role: 'admin' }, { page: 1, limit: 50 });
        expect(b.meta.total).toBe(0);
        // Y desde la otra empresa no se restaura.
        await expect(trash.restore(tenantB, { userId: admin.userId, role: 'admin' }, 'field', extra.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una lista va a la papelera con todo lo de adentro y vuelve igual (lo borrado antes queda en la papelera)', async () => {
        const l = await makeList('Clientes');
        const v = await views.create(tenantA, String(l.id), { name: 'Tabla', type: 'table', config: {} }, { userId: admin.userId, role: 'admin' });
        const auto = await autos.create(tenantA, String(l.id), {
            name: 'Aviso',
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [{ type: 'update_field', config: { values: { nombre: 'x' } } }],
            is_active: true,
        } as never);
        const key = `f${l.nombre.id}`;
        const r1 = await recs.create(tenantA, admin, String(l.id), { data: { [key]: 'Acme' } });
        const r2 = await recs.create(tenantA, admin, String(l.id), { data: { [key]: 'Globex' } });
        // Borrado ANTES (con su propia fecha): no vuelve con la lista.
        await recs.remove(tenantA, admin, String(l.id), r2.id);

        const gone = await listsSvc.remove(tenantA, String(l.id), { userId: admin.userId });
        expect(gone.automationIds).toEqual([auto.id]);
        await expect(listsSvc.get(tenantA, 'clientes')).rejects.toBeInstanceOf(NotFoundException);
        // El slug quedó libre: otra lista puede usarlo.
        const nueva = await listsSvc.create(tenantA, { name: 'Clientes' });
        expect(nueva.slug).toBe('clientes');
        // Los registros de la lista borrada no cuentan (ni para el plan).
        expect(await countRaw('records', `list_id = ${l.id} AND deleted_at IS NULL`)).toBe(0);
        // La URL del webhook / los horarios no la ven.
        expect(await autos.resolveHookToken('x'.repeat(20))).toBeNull();

        // En la papelera: UNA entrada (la lista), no sus registros ni campos.
        const page = await trash.list(tenantA, admin, { page: 1, limit: 50, list_id: undefined });
        const entry = page.data.find((i) => i.type === 'list' && i.id === l.id);
        expect(entry?.children).toBe(1);
        expect(page.data.some((i) => i.list_id === l.id)).toBe(false);

        const res = await trash.restore(tenantA, admin, 'list', l.id);
        expect(res.renamed_slug).toBe('clientes_2');
        expect(res.message).toContain('clientes_2');
        const back = await listsSvc.get(tenantA, String(l.id));
        expect(back.slug).toBe('clientes_2');
        expect((await fieldsSvc.list(tenantA, String(l.id))).map((f) => f.slug)).toEqual(['nombre']);
        expect((await views.list(tenantA, String(l.id), { userId: admin.userId, role: 'admin' })).map((x) => x.id)).toEqual([v.id]);
        expect((await autos.list(tenantA, String(l.id))).map((a) => a.id)).toEqual([auto.id]);
        const rows = await recs.list(tenantA, admin, String(l.id), { limit: 50 } as never);
        expect(rows.data.map((r) => r.id)).toEqual([r1.id]);
        // El que se había borrado antes sigue en la papelera, ahora visible como registro suelto.
        const after = await trash.list(tenantA, admin, { page: 1, limit: 50, type: 'record' });
        expect(after.data.map((i) => i.id)).toContain(r2.id);
    });

    it('una lista de una tienda no va a la papelera mientras se sincroniza', async () => {
        const l = await listsSvc.create(tenantA, { name: 'Productos tienda' });
        await withTenant(pg.db, tenantA, (tx) =>
            tx.update(lists).set({ settings: { store_sync: { connection_id: 1, role: 'products', store_name: 'Mi tienda' } } }).where(eq(lists.id, l.id)),
        );
        await expect(listsSvc.remove(tenantA, String(l.id), { userId: admin.userId })).rejects.toBeInstanceOf(ConflictException);
    });

    it('un registro: los vínculos y las subtareas vuelven; mientras tanto no cuentan', async () => {
        const clientes = await makeList('Empresas');
        const facturas = await makeList('Facturas');
        const rel = await fieldsSvc.create(tenantA, String(facturas.id), {
            label: 'Empresa',
            type: 'relation',
            slug: 'empresa',
            config: { target_list_id: clientes.id },
        });
        const total = await fieldsSvc.create(tenantA, String(clientes.id), {
            label: 'Facturas',
            type: 'rollup',
            slug: 'n_facturas',
            config: { relation_field_id: rel.id, operation: 'count' },
        } as never);
        const c = await recs.create(tenantA, admin, String(clientes.id), { data: { [`f${clientes.nombre.id}`]: 'Acme' } });
        const f1 = await recs.create(tenantA, admin, String(facturas.id), {
            data: { [`f${facturas.nombre.id}`]: 'F-1', [`f${rel.id}`]: [c.id] },
        });
        const sub = await recs.create(tenantA, admin, String(facturas.id), { data: { [`f${facturas.nombre.id}`]: 'F-1 detalle' }, parent_id: f1.id });

        const rollupOf = async () => (await recs.get(tenantA, admin, String(clientes.id), c.id)).data[`f${total.id}`];
        expect(Number(await rollupOf())).toBe(1);

        await recs.remove(tenantA, admin, String(facturas.id), f1.id);
        // El vínculo sigue guardado, pero no cuenta (el registro está en la papelera).
        expect(await countRaw('relations', `source_record_id = ${f1.id}`)).toBe(1);
        expect(Number(await rollupOf() ?? 0)).toBe(0);
        // La subtarea se fue con él y no aparece suelta en la papelera.
        const page = await trash.list(tenantA, admin, { page: 1, limit: 50, type: 'record', list_id: facturas.id });
        expect(page.data.map((i) => i.id)).toEqual([f1.id]);
        expect(page.data[0]!.children).toBe(1);
        expect(page.data[0]!.name).toBe('F-1');

        const res = await trash.restore(tenantA, admin, 'record', f1.id);
        expect(res.message).toBe('Se restauró «F-1» con 1 subtarea.');
        expect(Number(await rollupOf())).toBe(1);
        const kid = await recs.get(tenantA, admin, String(facturas.id), sub.id);
        expect(kid.parent_id).toBe(f1.id);
        const got = await recs.get(tenantA, admin, String(facturas.id), f1.id);
        expect(got.relations?.[`f${rel.id}`]).toEqual([c.id]);

        // Un registro de una lista que está en la papelera: primero la lista.
        await recs.remove(tenantA, admin, String(facturas.id), sub.id);
        await listsSvc.remove(tenantA, String(facturas.id), { userId: admin.userId });
        await expect(trash.restore(tenantA, admin, 'record', sub.id)).rejects.toBeInstanceOf(ConflictException);
        await trash.restore(tenantA, admin, 'list', facturas.id);
    });

    it('el límite del plan aplica al restaurar', async () => {
        const l = await makeList('Plan');
        const r = await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'Uno' } });
        await recs.remove(tenantA, admin, String(l.id), r.id);
        planRoom = 0;
        try {
            await expect(trash.restore(tenantA, admin, 'record', r.id)).rejects.toBeInstanceOf(ForbiddenException);
        } finally {
            planRoom = Infinity;
        }
        await trash.restore(tenantA, admin, 'record', r.id);
    });

    it('un campo vuelve con sus valores; borrado para siempre se lleva los valores', async () => {
        const l = await makeList('Contactos');
        const tel = await fieldsSvc.create(tenantA, String(l.id), { label: 'Ciudad', type: 'text', slug: 'ciudad' });
        const r = await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'Ana', [`f${tel.id}`]: 'Bogotá' } });
        await fieldsSvc.remove(tenantA, String(l.id), 'ciudad', { userId: admin.userId });
        const res = await trash.restore(tenantA, admin, 'field', tel.id);
        expect(res.renamed_slug).toBeNull();
        expect((await recs.get(tenantA, admin, String(l.id), r.id)).data[`f${tel.id}`]).toBe('Bogotá');

        await fieldsSvc.remove(tenantA, String(l.id), 'ciudad', { userId: admin.userId });
        expect(await trash.purge(tenantA, admin, 'field', tel.id)).toEqual({ purged: 1 });
        expect(await countRaw('fields', `id = ${tel.id}`)).toBe(0);
        expect(await countRaw('records', `id = ${r.id} AND data ? 'f${tel.id}'`)).toBe(0);
    });

    it('permisos: el agente ve lo suyo y los registros que alcanza; restaura sólo lo que borró', async () => {
        const l = await makeList('Tareas agente');
        await withTenant(pg.db, tenantA, (tx) =>
            tx
                .update(lists)
                .set({ settings: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'own', fields_hidden: [] } } } })
                .where(eq(lists.id, l.id)),
        );
        const key = `f${l.nombre.id}`;
        const mine = await recs.create(tenantA, agent, String(l.id), { data: { [key]: 'Mía' } });
        const ajena = await recs.create(tenantA, admin, String(l.id), { data: { [key]: 'Del admin' } });
        await recs.remove(tenantA, agent, String(l.id), mine.id);
        await recs.remove(tenantA, admin, String(l.id), ajena.id);

        const seen = await trash.list(tenantA, agent, { page: 1, limit: 50, list_id: l.id });
        expect(seen.data.map((i) => i.id)).toEqual([mine.id]);
        expect(seen.data[0]!.can_restore).toBe(true);
        expect(seen.meta.can_empty).toBe(false);
        await expect(trash.restore(tenantA, agent, 'record', ajena.id)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(trash.empty(tenantA, agent)).rejects.toBeInstanceOf(ForbiddenException);
        // Un admin restaura lo que borró otro.
        await trash.restore(tenantA, otherAdmin, 'record', ajena.id);
        await trash.restore(tenantA, agent, 'record', mine.id);
    });

    it('automatizaciones y tableros: dejan de existir hacia afuera y vuelven', async () => {
        const l = await makeList('Hooks');
        const auto = await autos.create(tenantA, String(l.id), {
            name: 'Entrante',
            trigger_type: 'incoming_webhook',
            trigger_config: {},
            actions: [{ type: 'update_field', config: { values: { nombre: 'x' } } }],
            is_active: true,
        } as never);
        const token = String((auto.trigger_config as { webhook_token?: string }).webhook_token);
        expect(await autos.resolveHookToken(token)).not.toBeNull();
        // Una espera en curso se cancela al borrarla.
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(automationRuns).values({ tenantId: tenantA, automationId: auto.id, status: 'waiting', resumeAt: new Date(Date.now() + 3_600_000) }),
        );
        await autos.remove(tenantA, String(l.id), auto.id, admin.userId);
        expect(await autos.resolveHookToken(token)).toBeNull();
        expect(await countRaw('automation_runs', `automation_id = ${auto.id} AND status = 'waiting'`)).toBe(0);
        await trash.restore(tenantA, admin, 'automation', auto.id);
        expect(await autos.resolveHookToken(token)).not.toBeNull();

        const d = await dashboards.create(tenantA, admin.userId, { name: 'Ventas', widgets: [], is_default: true } as never);
        await dashboards.remove(tenantA, d.id, { userId: admin.userId, role: 'admin' });
        expect((await dashboards.list(tenantA, { userId: admin.userId, role: 'admin' })).map((x) => x.id)).not.toContain(d.id);
        // Mientras estaba borrado se eligió otro por defecto: vuelve sin serlo.
        const otro = await dashboards.create(tenantA, admin.userId, { name: 'Otro', widgets: [], is_default: true } as never);
        await trash.restore(tenantA, admin, 'dashboard', d.id);
        const list = await dashboards.list(tenantA, { userId: admin.userId, role: 'admin' });
        expect(list.find((x) => x.id === d.id)?.is_default).toBe(false);
        expect(list.find((x) => x.id === otro.id)?.is_default).toBe(true);
    });

    it('la lista pública de una lista borrada responde 404 y vuelve al restaurarla', async () => {
        const l = await makeList('Catálogo');
        const admin_ = await publicLists.updateAdmin(tenantA, String(l.id), { enabled: true, visible_field_ids: [l.nombre.id] } as never);
        const token = String(admin_.token);
        await expect(publicLists.getMeta(token)).resolves.toBeTruthy();
        await listsSvc.remove(tenantA, String(l.id), { userId: admin.userId });
        await expect(publicLists.getMeta(token)).rejects.toBeInstanceOf(NotFoundException);
        await trash.restore(tenantA, admin, 'list', l.id);
        await expect(publicLists.getMeta(token)).resolves.toBeTruthy();
    });

    it('borrar para siempre: el archivo que ya no usa nadie se va (con sus bytes); el que se usa, queda', async () => {
        const l = await makeList('Adjuntos');
        const doc = await fieldsSvc.create(tenantA, String(l.id), { label: 'Documento', type: 'file', slug: 'documento' });
        const solo = await files.upload(tenantA, admin.userId, 'solo.txt', 'text/plain', Readable.from([Buffer.from('uno')]));
        const comp = await files.upload(tenantA, admin.userId, 'compartido.txt', 'text/plain', Readable.from([Buffer.from('dos')]));
        const r1 = await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'A', [`f${doc.id}`]: [solo.id, comp.id] } });
        await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'B', [`f${doc.id}`]: [comp.id] } });
        await recs.remove(tenantA, admin, String(l.id), r1.id);
        // Mientras está en la papelera el archivo sigue (se puede restaurar).
        expect(await countRaw('attachments', `id = ${solo.id}`)).toBe(1);
        await trash.purge(tenantA, admin, 'record', r1.id);
        expect(await countRaw('records', `id = ${r1.id}`)).toBe(0);
        expect(await countRaw('attachments', `id = ${solo.id}`)).toBe(0);
        expect(await countRaw('attachments', `id = ${comp.id}`)).toBe(1);
        await expect(files.openDownload(tenantA, solo.id)).rejects.toBeTruthy();
    });

    it('vaciado automático: purga lo que pasó el plazo, deja lo nuevo y deja rastro en la bitácora', async () => {
        const l = await makeList('Vieja');
        const r = await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'Viejo' } });
        const nuevo = await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'Nuevo' } });
        await recs.remove(tenantA, admin, String(l.id), r.id);
        await recs.remove(tenantA, admin, String(l.id), nuevo.id);
        await pg.db.update(records).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(records.id, r.id));
        const purged = await trash.purgeExpired();
        expect(purged).toBeGreaterThanOrEqual(1);
        expect(await countRaw('records', `id = ${r.id}`)).toBe(0);
        expect(await countRaw('records', `id = ${nuevo.id}`)).toBe(1);
        const logs = await pg.db.select().from(auditLog).where(eq(auditLog.action, 'trash.purge'));
        expect(logs.some((x) => (x.meta as { auto?: boolean }).auto === true)).toBe(true);
    });

    it('vaciar la papelera (admin) borra todo lo que hay, también una lista entera', async () => {
        const l = await makeList('Para vaciar');
        await recs.create(tenantA, admin, String(l.id), { data: { [`f${l.nombre.id}`]: 'x' } });
        await listsSvc.remove(tenantA, String(l.id), { userId: admin.userId });
        const res = await trash.empty(tenantA, admin);
        expect(res.purged).toBeGreaterThan(0);
        expect((await trash.list(tenantA, admin, { page: 1, limit: 50 })).meta.total).toBe(0);
        expect(await countRaw('lists', `id = ${l.id}`)).toBe(0);
        expect(await countRaw('records', `list_id = ${l.id}`)).toBe(0);
        expect(await countRaw('relations', `tenant_id = ${tenantA} AND NOT EXISTS (SELECT 1 FROM records r WHERE r.id = relations.source_record_id)`)).toBe(0);
        // Nada de otra empresa se tocó.
        expect(await countRaw('attachments', `tenant_id = ${tenantB}`)).toBe(0);
        void attachments;
        void relations;
    });
});
