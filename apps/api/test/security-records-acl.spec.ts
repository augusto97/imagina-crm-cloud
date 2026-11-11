import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { bulkOperationSchema, importUpdateSchema, type BulkOperation, type Field, type ImportUpdateInput } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { PlansService } from '../src/billing/plans.service';
import { ChecklistsRepository } from '../src/checklists/checklists.repository';
import { ChecklistsService } from '../src/checklists/checklists.service';
import { loadEnv } from '../src/config/env';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { lists, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ImportUpdateService } from '../src/import/import-update.service';
import { ImportService } from '../src/import/import.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordTemplatesService } from '../src/record-templates/record-templates.service';
import { BulkEditService } from '../src/records/bulk-edit.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { memberNames } from '../src/tenancy/member-names';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * Auditoría de seguridad 2026-11 — registros, archivos y ACL por lista.
 * Cada caso falla sin su arreglo (ver los veredictos v1-files / v2-acl).
 */
describe('Seguridad: archivos y ACL por lista (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsSvc: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let files: FilesService;
    let bulk: BulkEditService;
    let updater: ImportUpdateService;
    let templates: RecordTemplatesService;
    let dashboards: DashboardsService;
    let tenantId: number;
    let otherTenant: number;
    let admin: Actor;
    let manager: Actor;
    let agent: Actor;
    let viewer: Actor;
    let guestId: number;
    let outsiderId: number;
    let f: Record<string, Field>;
    let secret: Record<string, Field>;
    let n = 0;

    const key = (slug: string): string => `f${f[slug]!.id}`;
    const code = async (p: Promise<unknown>): Promise<string> => {
        try {
            await p;
            return 'ok';
        } catch (err) {
            const body = (err as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
            return body?.code ?? String(err);
        }
    };
    const upload = async (by: Actor | number, name = 'a.pdf', mime = 'application/pdf'): Promise<number> =>
        (await files.upload(tenantId, typeof by === 'number' ? by : by.userId, name, mime, Readable.from(Buffer.from(`bytes-${n++}`)))).id;
    const setPermissions = async (slug: string, permissions: Record<string, unknown>): Promise<void> => {
        await withTenant(pg.db, tenantId, async (tx) => {
            const [row] = await tx.select({ id: lists.id, settings: lists.settings }).from(lists).where(eq(lists.slug, slug)).limit(1);
            await tx
                .update(lists)
                .set({ settings: { ...((row!.settings ?? {}) as Record<string, unknown>), permissions } })
                .where(eq(lists.id, row!.id));
        });
    };
    const role = (over: Record<string, unknown>): Record<string, unknown> => ({ view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [], ...over });
    const fileDoc = (fileId: number) => ({ type: 'doc', content: [{ type: 'fileBlock', attrs: { fileId, name: 'x.pdf' } }] });

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsSvc);
        const dispatcher = new AutomationDispatcher();
        recs = new RecordsService(tenantDb, new RecordsRepository(), listsSvc, fieldsSvc, rt, activity, dispatcher, new RelationsRepository());
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-sec-'))), loadEnv({ FILES_SIGNING_SECRET: 'test-secret' }));
        const audit = new AuditService(tenantDb);
        const history = new BulkHistoryService(tenantDb, listsSvc, recs, rt, audit);
        bulk = new BulkEditService(recs, rt, history);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(
            tenantDb,
            plans,
            new EmailQuotaService(pg.db, plans),
            new TenantSmtpService(pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' })),
        );
        updater = new ImportUpdateService(tenantDb, listsSvc, recs, new ImportService(tenantDb, listsSvc, fieldsSvc, new RecordsRepository(), billing, rt), history, rt);
        const checklists = new ChecklistsService(tenantDb, listsSvc, fieldsSvc, recs, new RecordsRepository(), new ChecklistsRepository(), activity, rt, dispatcher);
        templates = new RecordTemplatesService(tenantDb, listsSvc, fieldsSvc, recs, new RecordsRepository(), checklists, new ChecklistsRepository(), activity, rt, audit);
        dashboards = new DashboardsService(tenantDb, null as never, recs, fieldsSvc);

        const [t] = await pg.db.insert(tenants).values({ slug: 'sec', name: 'Sec SA', plan: 'enterprise' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra SA', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;
        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        const ids = {
            admin: await mk('admin@sec.test', 'Ada Admin'),
            manager: await mk('manager@sec.test', 'Manu Manager'),
            agent: await mk('agente@sec.test', 'Ari Agente'),
            viewer: await mk('lector@sec.test', 'Leo Lector'),
        };
        guestId = await mk('invitado@fuera.test', 'Ivo Invitado');
        outsiderId = await mk('ajeno@otra.test', 'Persona De Otra Empresa');
        await pg.db.insert(memberships).values([
            { tenantId, userId: ids.admin, role: 'admin' },
            { tenantId, userId: ids.manager, role: 'manager' },
            { tenantId, userId: ids.agent, role: 'agent' },
            { tenantId, userId: ids.viewer, role: 'viewer' },
            { tenantId, userId: guestId, role: 'guest' },
            { tenantId: otherTenant, userId: outsiderId, role: 'admin' },
        ]);
        admin = { userId: ids.admin, role: 'admin' };
        manager = { userId: ids.manager, role: 'manager' };
        agent = { userId: ids.agent, role: 'agent' };
        viewer = { userId: ids.viewer, role: 'viewer' };

        const main = await listsSvc.create(tenantId, { name: 'Clientes' });
        const mkf = (list: number, label: string, slug: string, type: Field['type'], config: Record<string, unknown> = {}) =>
            fieldsSvc.create(tenantId, String(list), { label, slug, type, config });
        f = {
            nombre: await mkf(main.id, 'Nombre', 'nombre', 'text'),
            nota: await mkf(main.id, 'Nota', 'nota', 'text'),
            precio: await mkf(main.id, 'Precio', 'precio', 'currency'),
            costo: await mkf(main.id, 'Costo', 'costo', 'currency'),
            adjunto: await mkf(main.id, 'Adjunto', 'adjunto', 'file'),
            responsable: await mkf(main.id, 'Responsable', 'responsable', 'user'),
        };
        f.ganancia = await mkf(main.id, 'Ganancia', 'ganancia', 'computed', { operation: 'subtract', inputs: [f.precio!.id, f.costo!.id] });
        const hiddenList = await listsSvc.create(tenantId, { name: 'Secreta' });
        secret = {
            nombre: await mkf(hiddenList.id, 'Nombre', 'nombre', 'text'),
            contrato: await mkf(hiddenList.id, 'Contrato', 'contrato', 'file'),
        };
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await setPermissions('clientes', {
            permissions: {
                manager: role({ fields_hidden: ['costo'] }),
                agent: role({ view: 'own', edit: 'own', delete: 'own', fields_hidden: ['costo'] }),
            },
        });
        await setPermissions('secreta', {
            permissions: {
                manager: role({ fields_hidden: ['contrato'] }),
                agent: role({ view: 'none', create: false, edit: 'none', delete: 'none' }),
                viewer: role({ view: 'none', create: false, edit: 'none', delete: 'none' }),
            },
        });
    });

    // ── files-acl-self-granted-by-record-reference ───────────────────────────

    it('no se puede referenciar un archivo ajeno desde un registro propio (campo, descripción, invitado)', async () => {
        const x = await upload(admin);
        await recs.create(tenantId, admin, 'secreta', { data: { [`f${secret.nombre!.id}`]: 'Contrato maestro', [`f${secret.contrato!.id}`]: [x] } });
        const own = await recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'Mío' } });

        // (1) descripción con un bloque de archivo ajeno
        expect(await code(recs.updateDescription(tenantId, agent, 'clientes', own.id, { description: fileDoc(x) } as never))).toBe('file_not_attachable');
        // (2) campo de archivo con el id ajeno (también escrito como texto)
        expect(await code(recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('adjunto')]: [x] } }))).toBe('file_not_attachable');
        expect(await code(recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('adjunto')]: [String(x)] } }))).toBe('file_not_attachable');
        expect(await code(recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'Otro', [key('adjunto')]: [x] } }))).toBe('file_not_attachable');
        expect((await recs.batchCreate(tenantId, agent, 'clientes', [{ data: { [key('nombre')]: 'Lote', [key('adjunto')]: [x] } }])).failed[0]?.code).toBe('file_not_attachable');
        expect(await files.resolve(tenantId, [x], agent)).toEqual([]);

        // (3) un invitado con el registro compartido para editar: sólo lo que él subió
        const guest: Actor = { userId: guestId, role: 'guest', shares: new Map([[own.id, { listId: own.list_id, level: 'edit' as const }]]) };
        expect(await code(recs.updateDescription(tenantId, guest, 'clientes', own.id, { description: fileDoc(x) } as never))).toBe('file_not_attachable');
        const mine = await upload(guestId);
        expect(await code(recs.updateDescription(tenantId, guest, 'clientes', own.id, { description: fileDoc(mine) } as never))).toBe('ok');
        expect(await files.resolve(tenantId, [x], guest)).toEqual([]);

        // (4) lo que ya estaba (lo puso el admin) se puede volver a guardar
        const y = await upload(admin);
        await recs.update(tenantId, admin, 'clientes', own.id, { data: { [key('adjunto')]: [y] } });
        await recs.updateDescription(tenantId, admin, 'clientes', own.id, { description: fileDoc(y) } as never);
        expect(await code(recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('adjunto')]: [y], [key('nota')]: 'ok' } }))).toBe('ok');
        expect(await code(recs.updateDescription(tenantId, agent, 'clientes', own.id, { description: fileDoc(y) } as never))).toBe('ok');

        // (5) lo que sube él: se adjunta y se resuelve
        const z = await upload(agent);
        expect(await code(recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('adjunto')]: [y, z] } }))).toBe('ok');
        expect((await files.resolve(tenantId, [z, y], agent)).map((r) => r.id).sort()).toEqual([y, z].sort());

        // El sistema y el admin: tiene que existir en la empresa.
        expect(await code(recs.update(tenantId, admin, 'clientes', own.id, { data: { [key('adjunto')]: [987654] } }))).toBe('file_not_attachable');
        expect(await code(recs.update(tenantId, { userId: 0, role: 'admin' }, 'clientes', own.id, { data: { [key('adjunto')]: [x] } }))).toBe('ok');
    });

    it('tableros y plantillas de registro: sólo imágenes y adjuntos propios o visibles', async () => {
        const x = await upload(admin, 'plano.png', 'image/png');
        await recs.create(tenantId, admin, 'secreta', { data: { [`f${secret.contrato!.id}`]: [x] } });
        const widgets = [{ id: 'w1', type: 'image', list_id: 0, layout: { x: 0, y: 0, w: 4, h: 2 }, config: { image_file_id: x } }];
        expect(await code(dashboards.create(tenantId, agent.userId, { name: 'T', widgets } as never, agent))).toBe('file_not_attachable');
        const dash = await dashboards.create(tenantId, agent.userId, { name: 'T', widgets: [] } as never, agent);
        expect(await code(dashboards.update(tenantId, dash.id, agent, { widgets } as never))).toBe('file_not_attachable');
        expect(await files.resolve(tenantId, [x], agent)).toEqual([]);
        const own = await upload(agent, 'mio.png', 'image/png');
        const mineW = [{ ...widgets[0]!, config: { image_file_id: own } }];
        expect(await code(dashboards.update(tenantId, dash.id, agent, { widgets: mineW } as never))).toBe('ok');

        const content = { values: {}, subtasks: [], checklists: [], record_description: fileDoc(x) };
        expect(await code(templates.create(tenantId, manager.userId, 'clientes', { kind: 'record', name: 'Con adjunto ajeno', content } as never, agent))).toBe('file_not_attachable');
    });

    // ── files-acl-view-records-shortcut-ignores-list-acl ─────────────────────

    it('«ve todos los registros» no salta el ACL de cada lista para los archivos', async () => {
        const inSecret = await upload(admin, 'contrato.png', 'image/png');
        const hiddenField = inSecret; // el mismo archivo: lista sin acceso (lector) y campo oculto (manager)
        const secretRec = await recs.create(tenantId, admin, 'secreta', { data: { [`f${secret.contrato!.id}`]: [inSecret] } });
        const open = await upload(admin, 'abierto.pdf');
        await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Visible', [key('adjunto')]: [open] } });
        const logo = await upload(admin, 'logo.png', 'image/png'); // de ningún registro (marca, formularios…)

        // Lector sin acceso a la lista «Secreta».
        expect((await files.resolve(tenantId, [inSecret, open, logo], viewer)).map((r) => r.id).sort()).toEqual([open, logo].sort());
        expect(await code(files.openDownload(tenantId, inSecret, viewer))).toBe('file_not_found');
        expect(await code(files.publicImageUrl(tenantId, inSecret, viewer))).toBe('file_not_found');
        expect(await code(files.remove(tenantId, inSecret, viewer))).toBe('file_not_found');
        // Manager: ve la lista pero el campo «Contrato» está oculto para su rol.
        expect((await files.resolve(tenantId, [hiddenField, open, logo], manager)).map((r) => r.id).sort()).toEqual([open, logo].sort());
        expect(await code(files.openDownload(tenantId, hiddenField, manager))).toBe('file_not_found');
        expect(await code(files.remove(tenantId, hiddenField, manager))).toBe('file_not_found');
        // El admin y el sistema, como siempre.
        expect(await files.resolve(tenantId, [inSecret], admin)).toHaveLength(1);
        expect(await files.resolve(tenantId, [inSecret])).toHaveLength(1);

        // El mismo archivo también en algo que SÍ ve → visible.
        await recs.update(tenantId, admin, 'secreta', secretRec.id, { data: { [`f${secret.contrato!.id}`]: [] } });
        expect(await files.resolve(tenantId, [inSecret], viewer)).toHaveLength(1);

        // Borrar: no alcanza la capacidad global si no puede EDITAR el registro del que cuelga.
        await setPermissions('clientes', { permissions: { manager: role({ edit: 'none', delete: 'none' }) } });
        expect(await code(files.remove(tenantId, open, manager))).toBe('file_not_yours');
        await setPermissions('clientes', { permissions: { manager: role({}) } });
        expect(await code(files.remove(tenantId, open, manager))).toBe('ok');
    });

    // ── records.service:update-create-response-not-stripped-hidden-fields ────

    it('la respuesta de crear/editar no trae campos ocultos, y no se escriben a ciegas', async () => {
        const own = await recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'Mío', [key('precio')]: 100 } });
        expect(Object.keys(own.data)).not.toContain(key('ganancia'));
        await recs.update(tenantId, admin, 'clientes', own.id, { data: { [key('costo')]: 40 } });
        const full = await recs.get(tenantId, admin, 'clientes', own.id);
        expect(full.data[key('costo')]).toBe(40);
        expect(full.data[key('ganancia')]).toBe(60);

        const seen = await recs.get(tenantId, agent, 'clientes', own.id);
        const patched = await recs.update(tenantId, agent, 'clientes', own.id, { data: {} });
        expect(Object.keys(patched.data).sort()).toEqual(Object.keys(seen.data).sort());
        expect(patched.data).not.toHaveProperty(key('costo'));
        expect(patched.data).not.toHaveProperty(key('ganancia'));
        const batch = await recs.batchUpdate(tenantId, agent, 'clientes', [{ id: own.id, data: { [key('nota')]: 'hola' } }]);
        expect(batch.updated[0]!.data).not.toHaveProperty(key('costo'));

        // Escribir en lo que no ve: 403 (alta, edición) y error de celda (lote).
        expect(await code(recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('costo')]: 1 } }))).toBe('field_hidden');
        expect(await code(recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'N', [key('costo')]: 1 } }))).toBe('field_hidden');
        expect(await code(recs.checkUpdate(tenantId, agent, 'clientes', own.id, { [key('costo')]: 1 }))).toBe('field_hidden');
        const cell = await recs.batchUpdate(tenantId, agent, 'clientes', [{ id: own.id, data: { [key('costo')]: 1, [key('nota')]: 'pasa' } }]);
        expect(cell.cell_errors.map((c) => c.key)).toEqual([key('costo')]);
        expect(cell.updated).toHaveLength(1);
        expect((await recs.get(tenantId, admin, 'clientes', own.id)).data[key('costo')]).toBe(40);
        // `expect` sobre un campo oculto no es un oráculo: se ignora.
        expect(await code(recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('nota')]: 'x' } }, { expect: { [key('costo')]: 999 } }))).toBe('ok');
        // Lo que decide el servidor (un botón, el estado tras responder) sigue pudiendo.
        const srv = await recs.update(tenantId, agent, 'clientes', own.id, { data: { [key('costo')]: 41 } }, { serverDecided: true });
        expect(srv.data).not.toHaveProperty(key('costo'));
        expect((await recs.get(tenantId, admin, 'clientes', own.id)).data[key('costo')]).toBe(41);
        // El admin y el sistema no cambian.
        expect((await recs.update(tenantId, admin, 'clientes', own.id, { data: {} })).data[key('costo')]).toBe(41);
    });

    it('un campo Persona sólo acepta gente de la empresa; los nombres se resuelven por membresía', async () => {
        const rec = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'P', [key('responsable')]: agent.userId } });
        expect(await code(recs.update(tenantId, admin, 'clientes', rec.id, { data: { [key('responsable')]: outsiderId } }))).toBe('validation_failed');
        expect(await code(recs.create(tenantId, manager, 'clientes', { data: { [key('nombre')]: 'Q', [key('responsable')]: outsiderId } }))).toBe('validation_failed');
        // Re-guardar el valor que ya tenía (aunque ya no sea miembro) no falla.
        await recs.update(tenantId, { userId: 0, role: 'admin' }, 'clientes', rec.id, { data: { [key('responsable')]: outsiderId } });
        expect(await code(recs.update(tenantId, manager, 'clientes', rec.id, { data: { [key('responsable')]: outsiderId, [key('nota')]: 'z' } }))).toBe('ok');

        const names = await memberNames(pg.db, tenantId, [agent.userId, outsiderId, guestId]);
        expect(names.get(agent.userId)?.name).toBe('Ari Agente');
        expect(names.has(outsiderId)).toBe(false);
        expect(names.has(guestId)).toBe(true);
    });

    // ── bulk-edit:derived-hidden-fields-readable-via-copy-and-filter ─────────

    it('edición masiva: un calculado sobre un campo oculto no sirve de origen ni de filtro', async () => {
        const a = await recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'A', [key('precio')]: 100 } });
        await recs.update(tenantId, admin, 'clientes', a.id, { data: { [key('costo')]: 30 } });
        const op = (o: Record<string, unknown>): BulkOperation[] => [bulkOperationSchema.parse(o)];
        const copy = op({ op: 'copy', field_id: f.nota!.id, source_field_id: f.ganancia!.id });
        expect(await code(bulk.preview(tenantId, agent, 'clientes', { ids: [a.id] }, copy))).toBe('bulk_invalid_operation');
        expect(await code(bulk.apply(tenantId, agent, 'clientes', [a.id], copy))).toBe('bulk_invalid_operation');
        expect(await code(bulk.preview(tenantId, agent, 'clientes', { ids: [a.id] }, op({ op: 'copy', field_id: f.nota!.id, source_field_id: f.costo!.id })))).toBe('bulk_invalid_operation');
        // Con el campo visible, la copia funciona (el admin).
        const ok = await bulk.preview(tenantId, admin, 'clientes', { ids: [a.id] }, copy);
        expect(String(ok.sample[0]!.changes[0]!.after)).toContain('70');

        // Las filas no traen lo oculto, y un filtro por el calculado oculto se ignora.
        const rows = await recs.bulkRows(tenantId, manager, 'clientes', { ids: [a.id] }, 10);
        expect(rows.rows[0]!.data).not.toHaveProperty(key('costo'));
        expect(rows.rows[0]!.data).not.toHaveProperty(key('ganancia'));
        expect([...rows.hiddenIds].sort()).toEqual([f.costo!.id, f.ganancia!.id].sort());
        const filter = { filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.ganancia!.id, op: 'gt', value: 1000000 }] } };
        const viaFilter = await recs.bulkRows(tenantId, manager, 'clientes', filter as never, 100);
        expect(viaFilter.rows.map((r) => r.id)).toContain(a.id);
    });

    // ── import-update:hidden-fields-not-filtered ─────────────────────────────

    it('actualizar desde un archivo: ni se mapea ni se empareja por un campo oculto', async () => {
        const a = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Taza', [key('costo')]: 55 } });
        const input = (csv: string, extra: Pick<ImportUpdateInput, 'match'> & { mapping: Record<string, string> }) => importUpdateSchema.parse({ csv, ...extra });
        const toHidden = input(`ID,Costo\n${a.id},1\n`, { mapping: { 1: 'costo' }, match: { column_index: 0, by: '__id' } });
        expect(await code(updater.preview(tenantId, manager, 'clientes', toHidden))).toBe('import_update_invalid');
        expect(await code(updater.apply(tenantId, manager, 'clientes', toHidden))).toBe('import_update_invalid');
        const byHidden = input('Costo,Nota\n55,x\n', { mapping: { 1: 'nota' }, match: { column_index: 0, by: 'costo' } });
        expect(await code(updater.preview(tenantId, manager, 'clientes', byHidden))).toBe('import_update_invalid');
        // El admin sí; y el valor sigue intacto.
        const pv = await updater.preview(tenantId, admin, 'clientes', toHidden);
        expect(pv.sample[0]!.changes[0]).toMatchObject({ label: 'Costo', before: '55' });
        expect((await recs.get(tenantId, admin, 'clientes', a.id)).data[key('costo')]).toBe(55);
    });

    // ── records.service:batch-delete-expect-oracle-before-acl ────────────────

    it('borrar en lote: fuera de alcance responde igual con `expect` correcto o equivocado', async () => {
        const foreign = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Ajeno', [key('precio')]: 7 } });
        const wrong = await recs.batchRemove(tenantId, agent, 'clientes', [{ id: foreign.id, expect: { [key('precio')]: 999 } }]);
        const right = await recs.batchRemove(tenantId, agent, 'clientes', [{ id: foreign.id, expect: { [key('precio')]: 7 } }]);
        const missing = await recs.batchRemove(tenantId, agent, 'clientes', [{ id: 99999999, expect: { [key('precio')]: 7 } }]);
        for (const r of [wrong, right, missing]) {
            expect(r.deleted).toEqual([]);
            expect(r.failed[0]!.code).toBe('record_not_found');
            expect(r.failed[0]).not.toHaveProperty('changed');
        }
        // Dentro de su alcance, el conflicto se sigue informando.
        const own = await recs.create(tenantId, agent, 'clientes', { data: { [key('nombre')]: 'Mío', [key('precio')]: 7 } });
        const conflict = await recs.batchRemove(tenantId, agent, 'clientes', [{ id: own.id, expect: { [key('precio')]: 999 } }]);
        expect(conflict.failed[0]).toMatchObject({ code: 'record_changed', changed: [key('precio')] });
    });

    // ── record-template-from-record-leaks-hidden-fields ──────────────────────

    it('plantillas de registro: sin campos ocultos, sin subtareas fuera de alcance y sin acceso → 404', async () => {
        await setPermissions('clientes', {
            permissions: {
                manager: role({ view: 'own', edit: 'own', delete: 'own', fields_hidden: ['costo'] }),
                agent: role({ view: 'none', create: false, edit: 'none', delete: 'none' }),
            },
        });
        const parent = await recs.create(tenantId, manager, 'clientes', { data: { [key('nombre')]: 'Proyecto', [key('nota')]: 'visible' } });
        await recs.update(tenantId, admin, 'clientes', parent.id, { data: { [key('costo')]: 900 } });
        await recs.create(tenantId, manager, 'clientes', { data: { [key('nombre')]: 'Sub mía' }, parent_id: parent.id });
        const foreignSub = await recs.create(tenantId, admin, 'clientes', { data: { [key('nombre')]: 'Sub ajena', [key('costo')]: 5 }, parent_id: parent.id });
        await recs.update(tenantId, admin, 'clientes', foreignSub.id, { data: { [key('nota')]: 'secreto de otro' } });

        const tpl = await templates.fromRecord(tenantId, manager, 'clientes', {
            record_id: parent.id,
            name: 'Desde registro',
            include: { values: true, subtasks: true, checklists: false, description: false },
        });
        expect(tpl.content.values).toHaveProperty(key('nota'));
        expect(tpl.content.values).not.toHaveProperty(key('costo'));
        expect(tpl.content.subtasks.map((s) => s.title)).toEqual(['Sub mía']);
        const stored = await templates.get(tenantId, 'clientes', tpl.id);
        expect(JSON.stringify(stored.content)).not.toContain('900');

        // Una plantilla del admin con el costo: quien no lo ve no lo recibe ni lo escribe al usarla.
        const adminTpl = await templates.create(tenantId, admin.userId, 'clientes', {
            kind: 'record',
            name: 'Con costo',
            content: { values: { [key('costo')]: { mode: 'fixed', value: 123 }, [key('nota')]: { mode: 'fixed', value: 'de plantilla' } }, subtasks: [], checklists: [], record_description: null },
        } as never);
        const seen = await templates.get(tenantId, 'clientes', adminTpl.id, manager);
        expect(seen.content.values).not.toHaveProperty(key('costo'));
        expect((await templates.list(tenantId, 'clientes', 'record', manager)).every((t) => !(key('costo') in t.content.values))).toBe(true);
        expect((await templates.get(tenantId, 'clientes', adminTpl.id)).content.values).toHaveProperty(key('costo'));
        // Editarla sin ver el campo conserva su valor.
        await templates.update(tenantId, manager.userId, 'clientes', adminTpl.id, { content: { ...seen.content, values: { [key('nota')]: { mode: 'fixed', value: 'cambiada' } } } } as never, manager);
        expect((await templates.get(tenantId, 'clientes', adminTpl.id)).content.values[key('costo')]).toMatchObject({ value: 123 });
        const made = await templates.createFromTemplate(tenantId, manager, 'clientes', { template_id: adminTpl.id, data: { [key('nombre')]: 'Nuevo' } } as never);
        const row = await recs.get(tenantId, admin, 'clientes', made.record_id);
        expect(row.data[key('nota')]).toBe('cambiada');
        expect(row.data[key('costo')] ?? null).toBeNull();

        // Sin acceso a la lista: 404.
        expect(await code(templates.list(tenantId, 'clientes', undefined, agent))).toBe('list_not_found');
        expect(await code(templates.get(tenantId, 'clientes', tpl.id, agent))).toBe('list_not_found');
    });
});
