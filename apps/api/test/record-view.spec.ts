import { NotFoundException } from '@nestjs/common';
import type { RichDoc } from '@imagina-base/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordViewService } from '../src/record-view/record-view.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const doc = (text: string): RichDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/**
 * Bundle de la ficha (regla de oro nº 8): todo en UN request, con el MISMO
 * ACL que los endpoints sueltos. Documentos, cobros, avisos y bloques de la
 * ficha diseñada tienen sus propios tests: aquí van con dobles simples (uno
 * que falla, para ver que la ficha se abre igual).
 */
describe('Bundle de la ficha del registro (Postgres real)', () => {
    let pg: TestPg;
    let svc: RecordViewService;
    let recs: RecordsService;
    let comments: CommentsService;
    let tenantId: number;
    let admin: Actor;
    let agent: Actor;
    let clientesId: number;
    let nombreKey: string;
    let facturaKey: string;
    let clienteRelKey: string;
    const reminderCalls: number[] = [];

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fields,
            rt,
            activity,
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        comments = new CommentsService(tenantDb, new CommentsRepository(), lists, recs, rt);
        const notifications = {
            followState: async () => ({ following: true, followers: 2 }),
            listReminders: async (_t: number, _a: Actor, opts: { recordId?: number }) => {
                reminderCalls.push(opts.recordId ?? 0);
                return [];
            },
        };
        const documents = { list: async () => [] };
        // Una pieza que se rompe: la ficha se abre igual, con esa pieza en null.
        const collections = {
            recordPayments: async () => {
                throw new Error('proveedor caído');
            },
        };
        const layoutData = { data: async () => ({}) };
        svc = new RecordViewService(
            tenantDb,
            lists,
            fields,
            recs,
            comments,
            activity,
            notifications as never,
            documents as never,
            collections as never,
            layoutData as never,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const mk = async (email: string, name: string) =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        admin = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        agent = { userId: await mk('beto@acme.test', 'Beto'), role: 'agent' };
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: admin.userId, role: 'admin' },
                { tenantId, userId: agent.userId, role: 'agent' },
            ]),
        );
        const clientes = await lists.create(tenantId, { name: 'Clientes' });
        clientesId = clientes.id;
        nombreKey = `f${(await fields.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' })).id}`;
        await lists.create(tenantId, { name: 'Facturas' });
        facturaKey = `f${(await fields.create(tenantId, 'facturas', { label: 'Número', type: 'text', slug: 'numero' })).id}`;
        clienteRelKey = `f${(
            await fields.create(tenantId, 'facturas', {
                label: 'Cliente',
                type: 'relation',
                slug: 'cliente',
                config: { target_list_id: clientes.id },
            })
        ).id}`;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('trae registro, comentarios con nombre, actividad, vinculados y subtareas en un request — con el ACL de quien mira', async () => {
        // El cliente lo crea el agente (lo ve); una factura la carga el
        // admin y otra el agente, las dos vinculadas al cliente.
        const cli = await recs.create(tenantId, agent, 'clientes', { data: { [nombreKey]: 'Acme SA' } });
        await recs.create(tenantId, admin, 'facturas', { data: { [facturaKey]: 'F-1', [clienteRelKey]: [cli.id] } });
        await recs.create(tenantId, agent, 'facturas', { data: { [facturaKey]: 'F-2', [clienteRelKey]: [cli.id] } });
        await recs.create(tenantId, agent, 'clientes', { data: { [nombreKey]: 'Sub' }, parent_id: cli.id });
        await comments.create(tenantId, admin, 'clientes', cli.id, { body: 'Llamar el lunes', kind: 'note' });
        await recs.updateDescription(tenantId, agent, 'clientes', cli.id, { description: doc('Cliente grande') });

        const asAdmin = await svc.bundle(tenantId, admin, 'clientes', cli.id);
        expect(asAdmin.record.id).toBe(cli.id);
        expect(asAdmin.list.id).toBe(clientesId);
        expect(asAdmin.fields.map((f) => f.slug)).toContain('nombre');
        expect(asAdmin.comments?.[0]).toMatchObject({ body: 'Llamar el lunes', user_name: 'Ana' });
        expect(asAdmin.description?.content?.[0]?.content?.[0]?.text).toBe('Cliente grande');
        expect(asAdmin.activity?.some((a) => 'description' in a.diff)).toBe(true);
        expect(asAdmin.follow).toEqual({ following: true, followers: 2 });
        expect(reminderCalls).toContain(cli.id);
        // La pieza rota viaja en null y el resto se ve igual.
        expect(asAdmin.payments).toBeNull();
        // «Vinculados»: la relación que vive en Facturas y apunta a Clientes.
        expect(asAdmin.relation_paths?.some((p) => p.direction === 'reverse')).toBe(true);
        expect(asAdmin.backlinks).toHaveLength(1);
        expect(asAdmin.backlinks[0]!.records.data).toHaveLength(2);
        expect(asAdmin.linked_lists.map((l) => l.list.slug)).toContain('facturas');
        expect(asAdmin.subtasks?.data.map((r) => r.data[nombreKey])).toEqual(['Sub']);

        // El agente ve SÓLO su factura en «Vinculados» (scope «solo lo suyo»).
        const asAgent = await svc.bundle(tenantId, agent, 'clientes', cli.id);
        expect(asAgent.backlinks[0]!.records.data.map((r) => r.data[facturaKey])).toEqual(['F-2']);
    });

    it('un registro que la persona no ve → 404, sin calcular nada más', async () => {
        const ajeno = await recs.create(tenantId, admin, 'clientes', { data: { [nombreKey]: 'Ajeno' } });
        await expect(svc.bundle(tenantId, agent, 'clientes', ajeno.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una subtarea no trae subtareas', async () => {
        const padre = await recs.create(tenantId, admin, 'clientes', { data: { [nombreKey]: 'Padre' } });
        const hijo = await recs.create(tenantId, admin, 'clientes', { data: { [nombreKey]: 'Hijo' }, parent_id: padre.id });
        const b = await svc.bundle(tenantId, admin, 'clientes', hijo.id);
        expect(b.record.parent_id).toBe(padre.id);
        expect(b.subtasks).toBeNull();
    });
});
