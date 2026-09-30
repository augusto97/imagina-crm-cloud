import { ForbiddenException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import type { BillingService } from '../src/billing/billing.service';
import { activity, bulkEdits, fields, lists, records, relations, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { BulkStructureService } from '../src/records/bulk-structure.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 0, role: 'admin' };
const agent: Actor = { userId: 0, role: 'agent' };
const viewer: Actor = { userId: 0, role: 'viewer' };

describe('estructura en lote: mover, duplicar y borrar (v0.1.220)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let history: BulkHistoryService;
    let svc: BulkStructureService;
    let tenantId: number;
    let f: Record<string, Field>;
    let planRoom = Infinity;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        history = new BulkHistoryService(tenantDb, lists_, recs, rt, new AuditService(tenantDb));
        // Plan: sólo interesa que el duplicado lo consulte con el lote ENTERO.
        const billing = {
            assertCanCreateRecords: async (_t: number, n: number) => {
                if (n > planRoom) throw new ForbiddenException({ code: 'plan_limit_reached', message: 'Límite del plan' });
            },
        } as unknown as BillingService;
        svc = new BulkStructureService(tenantDb, recs, history, billing, rt);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u1, u2, u3] = await pg.db
            .insert(users)
            .values([
                { email: 'admin@acme.co', name: 'Ana Admin', passwordHash: 'x' },
                { email: 'agente@acme.co', name: 'Beto Agente', passwordHash: 'x' },
                { email: 'lector@acme.co', name: 'Ceci Lectora', passwordHash: 'x' },
            ])
            .returning();
        admin.userId = u1!.id;
        agent.userId = u2!.id;
        viewer.userId = u3!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        planRoom = Infinity;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(bulkEdits).where(eq(bulkEdits.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Tareas' });
        await lists_.create(tenantId, { name: 'Clientes' });
        await fields_.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        const defs: CreateFieldInput[] = [
            { label: 'Título', type: 'text', slug: 'titulo' },
            { label: 'Horas', type: 'number', slug: 'horas' },
            { label: 'Total', type: 'computed', slug: 'total', config: { operation: 'sum', inputs: [] } },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields_.create(tenantId, 'tareas', d);
        const clientes = await lists_.get(tenantId, 'clientes');
        f.cliente = await fields_.create(tenantId, 'tareas', {
            label: 'Cliente',
            type: 'relation',
            slug: 'cliente',
            config: { target_list_id: clientes.id },
        });
    });

    const key = (s: string) => `f${f[s]!.id}`;
    const task = (actor: Actor, titulo: string, extra: Record<string, unknown> = {}, parent_id?: number) =>
        recs.create(tenantId, actor, 'tareas', { data: { [key('titulo')]: titulo, [key('horas')]: 2, ...extra }, parent_id });

    it('mover como subtareas y sacarlas al primer nivel, con deshacer', async () => {
        const padre = await task(admin, 'Proyecto');
        const a = await task(admin, 'A');
        const b = await task(admin, 'B');
        const conHijas = await task(admin, 'Con hijas');
        await task(admin, 'Hija', {}, conHijas.id);

        const preview = await svc.preview(tenantId, admin, 'tareas', 'move', { ids: [a.id, b.id, conHijas.id, padre.id] }, padre.id, false);
        expect(preview.parent_title).toBe('Proyecto');
        expect(preview.ids.sort()).toEqual([a.id, b.id].sort());
        expect(preview.error_count).toBe(2);
        expect(preview.errors.map((e) => e.title).sort()).toEqual(['Con hijas', 'Proyecto']);

        const res = await svc.apply(tenantId, admin, 'tareas', 'move', preview.ids, padre.id, false);
        expect(res.succeeded.sort()).toEqual([a.id, b.id].sort());
        expect((await recs.get(tenantId, admin, 'tareas', a.id)).parent_id).toBe(padre.id);

        // Un padre que es subtarea no sirve.
        await expect(svc.preview(tenantId, admin, 'tareas', 'move', { ids: [b.id] }, a.id, false)).rejects.toThrow(/primer nivel/);

        // Sacar al primer nivel.
        const out = await svc.apply(tenantId, admin, 'tareas', 'move', [b.id], null, false);
        expect(out.succeeded).toEqual([b.id]);
        expect((await recs.get(tenantId, admin, 'tareas', b.id)).parent_id).toBeNull();

        // Deshacer el primer movimiento: A vuelve al primer nivel; B ya se movió
        // otra vez → conflicto, salvo que se fuerce.
        const rev = await history.revertPreview(tenantId, admin, 'tareas', res.edit_id!);
        expect(rev.item_ids).toHaveLength(1);
        expect(rev.conflict_ids).toHaveLength(1);
        const done = await history.revertApply(tenantId, admin, 'tareas', res.edit_id!, rev.item_ids, false);
        expect(done.reverted).toBe(1);
        expect((await recs.get(tenantId, admin, 'tareas', a.id)).parent_id).toBeNull();
        const log = await history.list(tenantId, admin, 'tareas');
        expect(log.find((e) => e.id === res.edit_id)).toMatchObject({ kind: 'move', summary: 'Mover como subtareas de «Proyecto»' });
    });

    it('borrar por filtro se lleva las subtareas y deshacer trae todo de vuelta (vínculos incluidos)', async () => {
        const cli = await recs.create(tenantId, admin, 'clientes', { data: {} });
        const p = await task(admin, 'Borrar padre', { [key('cliente')]: [cli.id] });
        const hija = await task(admin, 'Hija del padre', {}, p.id);
        const otra = await task(admin, 'Borrar suelta');
        const queda = await task(admin, 'Queda');
        const filter = {
            filter_tree: { type: 'group' as const, logic: 'and' as const, children: [{ type: 'condition' as const, field_id: f.titulo!.id, op: 'contains' as const, value: 'Borrar' }] },
            search: '',
            include_subtasks: false,
        };
        const preview = await svc.preview(tenantId, admin, 'tareas', 'delete', filter, undefined, false);
        expect(preview.ids.sort()).toEqual([p.id, otra.id].sort());
        expect(preview.subtasks).toBe(1);

        const res = await svc.apply(tenantId, admin, 'tareas', 'delete', preview.ids, undefined, false);
        expect(res.succeeded.sort()).toEqual([p.id, otra.id].sort());
        await expect(recs.get(tenantId, admin, 'tareas', hija.id)).rejects.toThrow();
        expect((await recs.get(tenantId, admin, 'tareas', queda.id)).id).toBe(queda.id);

        const rev = await history.revertPreview(tenantId, admin, 'tareas', res.edit_id!);
        expect(rev.item_ids).toHaveLength(2);
        const done = await history.revertApply(tenantId, admin, 'tareas', res.edit_id!, rev.item_ids, false);
        expect(done.reverted).toBe(2);
        const back = await recs.get(tenantId, admin, 'tareas', p.id);
        expect(back.relations?.[key('cliente')]).toEqual([cli.id]);
        expect((await recs.get(tenantId, admin, 'tareas', hija.id)).parent_id).toBe(p.id);
        // Ya recuperado: no se deshace dos veces.
        expect((await history.revertPreview(tenantId, admin, 'tareas', res.edit_id!)).total).toBe(0);
    });

    it('duplicar con subtareas copia lo escribible y deshacer borra las copias no tocadas', async () => {
        const p = await task(admin, 'Original', { [key('horas')]: 5 });
        await task(admin, 'Sub 1', {}, p.id);
        await task(admin, 'Sub 2', {}, p.id);
        const suelta = await task(admin, 'Suelta');

        // Seleccionar al padre Y a su hija no la duplica dos veces.
        const all = await recs.list(tenantId, admin, 'tareas', { limit: 50, include_subtasks: true } as never);
        const sub1 = all.data.find((r) => r.data[key('titulo')] === 'Sub 1')!;
        const preview = await svc.preview(tenantId, admin, 'tareas', 'duplicate', { ids: [p.id, sub1.id, suelta.id] }, undefined, true);
        expect(preview.ids.sort()).toEqual([p.id, suelta.id].sort());
        expect(preview.subtasks).toBe(2);

        // El plan se consulta con el lote entero (2 + 2 subtareas).
        planRoom = 3;
        await expect(svc.apply(tenantId, admin, 'tareas', 'duplicate', preview.ids, undefined, true)).rejects.toThrow(/Límite/);
        planRoom = Infinity;

        const res = await svc.apply(tenantId, admin, 'tareas', 'duplicate', preview.ids, undefined, true);
        expect(res.created).toBe(4);
        const after = await recs.list(tenantId, admin, 'tareas', { limit: 50, include_subtasks: true } as never);
        const copies = after.data.filter((r) => r.data[key('titulo')] === 'Original');
        expect(copies).toHaveLength(2);
        const copy = copies.find((r) => r.id !== p.id)!;
        expect(copy.data[key('horas')]).toBe(5);
        expect(after.data.filter((r) => r.parent_id === copy.id)).toHaveLength(2);

        // Se edita una de las copias: esa se respeta al deshacer.
        const copiaSuelta = after.data.find((r) => r.data[key('titulo')] === 'Suelta' && r.id !== suelta.id)!;
        await recs.update(tenantId, admin, 'tareas', copiaSuelta.id, { data: { [key('horas')]: 9 } });
        const rev = await history.revertPreview(tenantId, admin, 'tareas', res.edit_id!);
        expect(rev.item_ids).toHaveLength(1);
        expect(rev.conflict_ids).toHaveLength(1);
        await history.revertApply(tenantId, admin, 'tareas', res.edit_id!, rev.item_ids, false);
        const final = await recs.list(tenantId, admin, 'tareas', { limit: 50, include_subtasks: true } as never);
        expect(final.data.filter((r) => r.data[key('titulo')] === 'Original')).toHaveLength(1);
        // Las subtareas de la copia se fueron con ella.
        expect(final.data.filter((r) => r.parent_id === copy.id)).toHaveLength(0);
        expect(final.data.some((r) => r.id === copiaSuelta.id)).toBe(true);
    });

    it('permisos y listas de la tienda', async () => {
        const mine = await task(agent, 'Del agente');
        const theirs = await task(admin, 'Del admin');
        // El lector no hace nada de esto.
        await expect(svc.preview(tenantId, viewer, 'tareas', 'delete', { ids: [mine.id] }, undefined, false)).rejects.toBeInstanceOf(ForbiddenException);
        // El agente no actúa por filtro.
        await expect(
            svc.preview(tenantId, agent, 'tareas', 'duplicate', { search: '', include_subtasks: false }, undefined, false),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // Sólo borra lo suyo: lo ajeno ni aparece.
        const preview = await svc.preview(tenantId, agent, 'tareas', 'delete', { ids: [mine.id, theirs.id] }, undefined, false);
        expect(preview.ids).toEqual([mine.id]);

        // Una lista de la tienda no se reestructura desde la app.
        const list = await lists_.get(tenantId, 'tareas');
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({ settings: { ...list.settings, store_sync: { connection_id: 1, role: 'products' } } })
                .where(eq(lists.id, list.id)),
        );
        await expect(svc.preview(tenantId, admin, 'tareas', 'delete', { ids: [theirs.id] }, undefined, false)).rejects.toThrow(/tienda/);
    });
});
