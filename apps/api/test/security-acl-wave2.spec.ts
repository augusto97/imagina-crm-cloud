import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService } from '../src/automations/automations.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { attachments, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ExportService } from '../src/export/export.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { memberListSettings, renameHiddenFieldSlug, withDependentComputed } from '../src/lists/list-acl';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import type { RolePermissions } from '@imagina-base/shared';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/**
 * SEC (auditoría 2026-11, segunda tanda) — el ACL por lista en los caminos
 * que lo salteaban: títulos de vinculados en el export, campos ocultos tras
 * renombrar su nombre interno, derivados de un campo oculto (campo con IA),
 * el directorio de personas, automatizaciones con la lista recortada, los
 * ajustes de la lista para quien no la administra y las imágenes del diseño.
 */
describe('ACL por lista — segunda tanda (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let exportService: ExportService;
    let tenantId: number;
    let admin: Actor;
    let agent: Actor;
    let seq = 0;

    async function makeUser(name: string, role: 'admin' | 'agent' | 'viewer' | 'client' | 'guest'): Promise<number> {
        seq += 1;
        const [u] = await pg.db.insert(users).values({ email: `${name}-${seq}@acme.test`, passwordHash: 'x', name }).returning();
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: u!.id, tenantId, role }));
        return u!.id;
    }

    async function csv(actor: Actor, list: string): Promise<string> {
        let out = '';
        await exportService.streamCsvExport(tenantId, actor, list, { fieldIds: [], delimiter: ',', withBom: false }, () => undefined, (c) => {
            out += c;
        });
        return out;
    }

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            activity,
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        exportService = new ExportService(tenantDb, listsService, fieldsService, views, recordsService);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'pro' }).returning();
        tenantId = t!.id;
        admin = { userId: await makeUser('Ada', 'admin'), role: 'admin' };
        agent = { userId: await makeUser('Gus', 'agent'), role: 'agent' };
    }, 180_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('export: el título de un vinculado sólo sale si quien exporta puede leerlo en SU lista', async () => {
        await listsService.create(tenantId, { name: 'Contratos' });
        const titulo = await fieldsService.create(tenantId, 'contratos', { label: 'Titulo', type: 'text', slug: 'titulo' });
        const contratos = await listsService.get(tenantId, 'contratos');
        await listsService.create(tenantId, { name: 'Tareas' });
        const nombre = await fieldsService.create(tenantId, 'tareas', { label: 'Nombre', type: 'text', slug: 'nombre' });
        const rel = await fieldsService.create(tenantId, 'tareas', {
            label: 'Contrato',
            type: 'relation',
            slug: 'contrato',
            config: { target_list_id: contratos.id },
        });
        const secreto = await recordsService.create(tenantId, admin, 'contratos', { data: { [`f${titulo.id}`]: 'SECRETO-NOMINA' } });
        await recordsService.create(tenantId, admin, 'tareas', { data: { [`f${nombre.id}`]: 'Revisar', [`f${rel.id}`]: [secreto.id] } });

        const full: RolePermissions = { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] };
        await listsService.updatePermissions(tenantId, 'tareas', { permissions: { agent: full } });
        await listsService.updatePermissions(tenantId, 'contratos', { permissions: { agent: full } });
        // Con acceso a las dos listas, el título sale.
        expect(await csv(agent, 'tareas')).toContain('SECRETO-NOMINA');

        // Sin acceso a Contratos: el id, nunca el título.
        const none: RolePermissions = { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
        await listsService.updatePermissions(tenantId, 'contratos', { permissions: { agent: { ...none } } });
        const sinAcceso = await csv(agent, 'tareas');
        expect(sinAcceso).not.toContain('SECRETO-NOMINA');
        expect(sinAcceso).toContain(`#${secreto.id}`);
        expect(await csv(admin, 'tareas')).toContain('SECRETO-NOMINA');

        // «Sólo lo suyo»: el contrato de otra persona tampoco.
        await listsService.updatePermissions(tenantId, 'contratos', { permissions: { agent: { ...none, view: 'own' } } });
        expect(await csv(agent, 'tareas')).not.toContain('SECRETO-NOMINA');

        // Ve la lista entera pero con el título oculto.
        await listsService.updatePermissions(tenantId, 'contratos', {
            permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['titulo'] } },
        });
        expect(await csv(agent, 'tareas')).not.toContain('SECRETO-NOMINA');
    });

    it('un campo oculto sigue oculto después de cambiarle el nombre interno (rol, persona y equipo)', async () => {
        await listsService.create(tenantId, { name: 'Empleados' });
        const nombre = await fieldsService.create(tenantId, 'empleados', { label: 'Nombre', type: 'text', slug: 'nombre' });
        const salario = await fieldsService.create(tenantId, 'empleados', { label: 'Salario', type: 'number', slug: 'salario' });
        const hide: RolePermissions = { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['salario'] };
        await listsService.updatePermissions(tenantId, 'empleados', {
            permissions: { agent: { ...hide } },
            users: { [String(agent.userId)]: { ...hide } },
        });
        const rec = await recordsService.create(tenantId, admin, 'empleados', { data: { [`f${nombre.id}`]: 'Ana', [`f${salario.id}`]: 9000 } });
        expect((await recordsService.get(tenantId, agent, 'empleados', rec.id)).data).not.toHaveProperty(`f${salario.id}`);

        await fieldsService.update(tenantId, 'empleados', String(salario.id), { slug: 'sueldo_mensual' });

        const after = await recordsService.get(tenantId, agent, 'empleados', rec.id);
        expect(after.data).not.toHaveProperty(`f${salario.id}`);
        const doc = await listsService.getPermissions(tenantId, 'empleados');
        expect(doc.permissions.agent?.fields_hidden).toEqual(['sueldo_mensual']);
        expect(JSON.stringify((await listsService.get(tenantId, 'empleados')).settings)).not.toContain('"salario"');
        expect(await csv(agent, 'empleados')).not.toContain('9000');
    });

    it('renameHiddenFieldSlug: reescribe roles, personas y equipos; al restaurar con sufijo conserva el viejo', () => {
        const settings = {
            title_field_id: 3,
            permissions: {
                permissions: { agent: { view: 'all', fields_hidden: ['a', 'x'] }, 'custom:7': { view: 'own', fields_hidden: ['x'] } },
                users: { '5': { view: 'all', fields_hidden: ['x'] } },
                teams: { '2': { view: 'all', fields_hidden: ['b'] } },
                assignment_field_id: 9,
            },
        };
        const next = renameHiddenFieldSlug(settings, 'x', 'y') as typeof settings;
        expect(next.permissions.permissions.agent.fields_hidden).toEqual(['a', 'y']);
        expect(next.permissions.permissions['custom:7'].fields_hidden).toEqual(['y']);
        expect(next.permissions.users['5'].fields_hidden).toEqual(['y']);
        expect(next.permissions.teams['2'].fields_hidden).toEqual(['b']);
        expect(next.permissions.assignment_field_id).toBe(9);
        expect(next.title_field_id).toBe(3);
        expect(renameHiddenFieldSlug(settings, 'nadie', 'z')).toBeNull();
        const kept = renameHiddenFieldSlug(settings, 'x', 'x_2', { keepOld: true }) as typeof settings;
        expect(kept.permissions.users['5'].fields_hidden).toEqual(['x', 'x_2']);
    });

    it('un campo con IA que lee de un campo oculto queda oculto también (y los que dependen de él)', async () => {
        const fields = [
            { id: 1, type: 'text', config: {} },
            { id: 2, type: 'ai', config: { task: 'custom', inputs: [1] } },
            { id: 3, type: 'computed', config: { operation: 'concat', inputs: [2] } },
            { id: 4, type: 'ai', config: { task: 'custom', inputs: [5] } },
            { id: 5, type: 'text', config: {} },
        ];
        expect([...withDependentComputed(fields, new Set([1]))].sort()).toEqual([1, 2, 3]);

        await listsService.create(tenantId, { name: 'Casos' });
        const nota = await fieldsService.create(tenantId, 'casos', { label: 'Nota interna', type: 'long_text', slug: 'nota' });
        const resumen = await fieldsService.create(tenantId, 'casos', {
            label: 'Resumen',
            type: 'ai',
            slug: 'resumen',
            config: { task: 'summarize', inputs: [nota.id] },
        });
        await listsService.updatePermissions(tenantId, 'casos', {
            permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['nota'] } },
        });
        const list = await listsService.get(tenantId, 'casos');
        const all = await fieldsService.listByListId(tenantId, list.id);
        const hidden = await fieldsService.hiddenSlugsFor(tenantId, list, all, agent);
        expect([...hidden].sort()).toEqual(['nota', 'resumen']);
        expect((await fieldsService.hiddenSlugsFor(tenantId, list, all, admin)).size).toBe(0);

        const rec = await recordsService.create(tenantId, admin, 'casos', { data: { [`f${nota.id}`]: 'El cliente debe 3 meses' } });
        // El valor lo escribe el sistema (como el worker de los campos con IA).
        await withTenant(pg.db, tenantId, (tx) =>
            new RecordsRepository().updateData(tx, tenantId, list.id, rec.id, { [`f${nota.id}`]: 'El cliente debe 3 meses', [`f${resumen.id}`]: 'Debe 3 meses' }),
        );
        expect((await recordsService.get(tenantId, admin, 'casos', rec.id)).data[`f${resumen.id}`]).toBe('Debe 3 meses');
        expect((await recordsService.get(tenantId, agent, 'casos', rec.id)).data).not.toHaveProperty(`f${resumen.id}`);
        expect(await csv(agent, 'casos')).not.toContain('Debe 3 meses');
    });

    it('directorio: los clientes del portal sólo los ve quien administra las listas; un invitado no ve a otros invitados', async () => {
        const me = new MeService(pg.db, tenantDb, new MeRepository());
        const client = await makeUser('cliente@externo.test', 'client');
        const guestA = await makeUser('Invitada A', 'guest');
        const guestB = await makeUser('Invitado B', 'guest');
        const ids = [client, guestA, guestB, admin.userId];

        const asAgent = await me.getUsers(tenantId, ids, { role: 'agent', userId: agent.userId });
        expect(asAgent.map((u) => u.id).sort()).toEqual([guestA, guestB, admin.userId].sort());
        await expect(me.getUser(tenantId, client, { role: 'agent', userId: agent.userId })).rejects.toMatchObject({ status: 404 });

        const asAdmin = await me.getUsers(tenantId, ids, { role: 'admin', userId: admin.userId });
        expect(asAdmin.map((u) => u.id)).toContain(client);

        const asGuest = await me.getUsers(tenantId, ids, { role: 'guest', userId: guestA });
        expect(asGuest.map((u) => u.id).sort()).toEqual([guestA, admin.userId].sort());
        expect(asGuest.every((u) => u.login === '')).toBe(true);
        await expect(me.getUser(tenantId, client, { role: 'guest', userId: guestA })).rejects.toMatchObject({ status: 404 });
        // Sin quién (llamada interna): sólo el equipo.
        expect((await me.getUsers(tenantId, ids)).map((u) => u.id)).not.toContain(client);
    });

    it('automatizaciones: con la lista recortada no se arman ni se leen (corren como sistema)', async () => {
        const autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            undefined as never,
            undefined as never,
        );
        await listsService.create(tenantId, { name: 'Cartera' });
        await fieldsService.create(tenantId, 'cartera', { label: 'Monto', type: 'number', slug: 'monto' });
        // Por defecto el agente ve sólo lo suyo: aunque tenga «automatizaciones», no.
        await expect(autos.assertWholeList(tenantId, 'cartera', { ...agent, capabilities: ['manage_automations'] })).rejects.toMatchObject({ status: 403 });
        await listsService.updatePermissions(tenantId, 'cartera', {
            permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
        });
        // Con la lista entera a la vista: puede.
        await expect(autos.assertWholeList(tenantId, 'cartera', { ...agent, capabilities: ['manage_automations'] })).resolves.toBeUndefined();
        await expect(autos.assertWholeList(tenantId, 'cartera', admin)).resolves.toBeUndefined();

        await listsService.updatePermissions(tenantId, 'cartera', {
            permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: [] } },
        });
        await expect(autos.assertWholeList(tenantId, 'cartera', agent)).rejects.toMatchObject({
            status: 403,
            response: { code: 'automation_list_forbidden' },
        });
        expect(await autos.seesWholeList(tenantId, 'cartera', agent)).toBe(false);

        await listsService.updatePermissions(tenantId, 'cartera', {
            permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['monto'] } },
        });
        await expect(autos.assertWholeList(tenantId, 'cartera', agent)).rejects.toMatchObject({ status: 403 });
        await expect(autos.assertWholeList(tenantId, 'cartera', admin)).resolves.toBeUndefined();
    });

    it('ajustes de la lista: quien no la administra no recibe permisos, enlace público, portal ni conexiones', () => {
        const settings = {
            title_field_id: 4,
            record_layout: 'crm',
            store_sync: { connection_id: 1 },
            permissions: { permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['x'] } }, users: { '99': {} } },
            public: { enabled: true, token: 'tok_secreto' },
            portal: { enabled: true, related_lists: [3] },
            portal_layout_v3: { pages: [] },
            portal_template: { blocks: [] },
            collections: { fields: { link: 7 }, connection_id: 12 },
            subscriptions: { fields: { status: 8 }, connection_id: 12 },
        };
        const member = memberListSettings(settings, { userId: 5, role: 'agent' }, false);
        expect(member).toEqual({
            title_field_id: 4,
            record_layout: 'crm',
            store_sync: { connection_id: 1 },
            portal: { enabled: true },
            collections: { fields: { link: 7 } },
            subscriptions: { fields: { status: 8 } },
        });
        expect(JSON.stringify(member)).not.toContain('tok_secreto');
        // Quien administra las listas (o el admin) los recibe enteros.
        expect(memberListSettings(settings, { userId: 5, role: 'manager' }, true)).toBe(settings);
        expect(memberListSettings(settings, { userId: 1, role: 'admin' }, false)).toBe(settings);
        // Sin acceso a la lista: nada de su configuración.
        const closed = { ...settings, permissions: { permissions: { agent: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } } } };
        expect(memberListSettings(closed, { userId: 5, role: 'agent' }, false)).toEqual({});
    });

    it('diseño de la ficha: una imagen NUEVA tiene que ser un archivo que quien guarda puede usar', async () => {
        await listsService.create(tenantId, { name: 'Fichas' });
        const [ajeno] = await pg.db
            .insert(attachments)
            .values({ tenantId, filename: 'nomina.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/ajeno', createdBy: admin.userId })
            .returning();
        const [propio] = await pg.db
            .insert(attachments)
            .values({ tenantId, filename: 'logo.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/propio', createdBy: agent.userId })
            .returning();
        const layout = (fileId: number) => ({ custom_design: { blocks: [{ type: 'image', file_id: fileId }] } });
        const manager: Actor = { ...agent, capabilities: ['manage_lists', 'view_own_records'] };

        await expect(listsService.update(tenantId, 'fichas', { settings: layout(ajeno!.id) }, { actor: manager })).rejects.toMatchObject({
            status: 400,
            response: { code: 'file_not_attachable' },
        });
        await expect(listsService.update(tenantId, 'fichas', { settings: layout(propio!.id) }, { actor: manager })).resolves.toBeTruthy();
        // El admin (y el sistema, sin actor) sí; y lo que ya estaba no se vuelve a revisar.
        await listsService.update(tenantId, 'fichas', { settings: layout(ajeno!.id) }, { actor: admin });
        await expect(
            listsService.update(tenantId, 'fichas', { settings: { ...layout(ajeno!.id), record_layout: 'crm' } }, { actor: manager }),
        ).resolves.toBeTruthy();
    });
});
