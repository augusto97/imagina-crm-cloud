import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { bulkOperationSchema, type BulkOperationInput, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { activity, fields, lists, records, relations, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkEditService } from '../src/records/bulk-edit.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };

describe('edición masiva (v0.1.216)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let bulk: BulkEditService;
    let tenantId: number;
    let f: Record<string, Field>;
    const ops = (list: BulkOperationInput[]) => list.map((o) => bulkOperationSchema.parse(o));

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
        bulk = new BulkEditService(recs, rt);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(relations).where(eq(relations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Productos' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Precio', type: 'currency', slug: 'precio', config: { precision: 0 } },
            { label: 'Costo', type: 'currency', slug: 'costo', config: { precision: 0 } },
            { label: 'Stock', type: 'number', slug: 'stock' },
            {
                label: 'Etiquetas',
                type: 'multi_select',
                slug: 'etiquetas',
                config: { options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'oferta', label: 'Oferta' }] },
            },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'pausado', label: 'Pausado' }] },
                is_required: true,
            },
            { label: 'Margen', type: 'computed', slug: 'margen', config: { operation: 'subtract', inputs: [] } },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields_.create(tenantId, 'productos', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;
    const create = (actor: Actor, nombre: string, precio: number | null, extra: Record<string, unknown> = {}) =>
        recs.create(tenantId, actor, 'productos', {
            data: { [key('nombre')]: nombre, [key('precio')]: precio, [key('estado')]: 'activo', ...extra },
        });

    it('vista previa y aplicación por selección: cada fila parte de SU valor', async () => {
        const a = await create(admin, 'Taza', 20_000, { [key('costo')]: 9_000 });
        const b = await create(admin, 'Plato', 12_345, { [key('costo')]: 5_000 });
        const c = await create(admin, 'Vaso', null);
        const operations = ops([
            { op: 'percent', field_id: f.precio!.id, percent: 10 },
            { op: 'round', field_id: f.precio!.id, multiple: 1000, mode: 'up', adjust: -100 },
            { op: 'add_options', field_id: f.etiquetas!.id, values: ['oferta'] },
        ]);
        const preview = await bulk.preview(tenantId, admin, 'productos', { ids: [a.id, b.id, c.id] }, operations);
        expect(preview.total).toBe(3);
        expect(preview.ids.sort()).toEqual([a.id, b.id, c.id].sort());
        const taza = preview.sample.find((s) => s.id === a.id)!;
        expect(taza.title).toBe('Taza');
        // 20.000 × 1,1 = 22.000 → el PRÓXIMO terminado en 900: 22.900 (hacia arriba nunca baja).
        expect(taza.changes).toContainEqual({ field_id: f.precio!.id, before: 20_000, after: 22_900 });
        // El vaso no tiene precio: sólo cambian sus etiquetas.
        const vaso = preview.sample.find((s) => s.id === c.id)!;
        expect(vaso.changes.map((ch) => ch.field_id)).toEqual([f.etiquetas!.id]);

        const res = await bulk.apply(tenantId, admin, 'productos', preview.ids, operations);
        expect(res.failed).toEqual([]);
        expect(res.succeeded).toHaveLength(3);
        const after = await recs.get(tenantId, admin, 'productos', b.id);
        // 12.345 × 1,1 = 13.580 (precisión 0) → próximo terminado en 900: 13.900.
        expect(after.data[key('precio')]).toBe(13_900);
        expect(after.data[key('etiquetas')]).toEqual(['oferta']);
        // Pasa por la bitácora como una edición común.
        const log = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(eq(activity.recordId, b.id)));
        expect(log.some((l) => l.action === 'record_updated')).toBe(true);
    });

    it('por filtro: abarca todo lo que coincide (no sólo la página) y calcula entre columnas', async () => {
        for (let i = 0; i < 7; i++) await create(admin, `Item ${i}`, 1000, { [key('costo')]: 400 + i, [key('estado')]: i < 5 ? 'activo' : 'pausado' });
        const operations = ops([
            { op: 'calc', field_id: f.precio!.id, left: { field_id: f.costo!.id }, operator: '*', right: { value: 2 } },
        ]);
        const preview = await bulk.preview(
            tenantId,
            admin,
            'productos',
            {
                filter_tree: {
                    type: 'group',
                    logic: 'and',
                    children: [{ type: 'condition', field_id: f.estado!.id, op: 'eq', value: 'activo' }],
                },
                include_subtasks: false,
            },
            operations,
        );
        expect(preview.total).toBe(5);
        expect(preview.ids).toHaveLength(5);
        await bulk.apply(tenantId, admin, 'productos', preview.ids, operations);
        const all = await recs.list(tenantId, admin, 'productos', { limit: 50, sort_dir: 'asc' });
        const precios = all.data.map((r) => r.data[key('precio')]);
        expect(precios).toEqual([800, 802, 804, 806, 808, 1000, 1000]);
    });

    it('filas con error no se escriben y se reportan; sin cambios no se toca nada', async () => {
        const a = await create(admin, 'Con costo', 100, { [key('costo')]: 50 });
        const b = await create(admin, 'Sin costo', 100);
        const operations = ops([
            { op: 'calc', field_id: f.precio!.id, left: { field_id: f.costo!.id }, operator: '+', right: { value: 10 } },
        ]);
        const preview = await bulk.preview(tenantId, admin, 'productos', { ids: [a.id, b.id] }, operations);
        expect(preview.ids).toEqual([a.id]);
        expect(preview.error_count).toBe(1);
        expect(preview.errors[0]).toMatchObject({ id: b.id, title: 'Sin costo' });
        expect(preview.errors[0]!.message).toMatch(/Costo.*vacío/);

        const same = await bulk.preview(tenantId, admin, 'productos', { ids: [a.id] }, ops([{ op: 'set', field_id: f.estado!.id, value: 'activo' }]));
        expect(same.ids).toEqual([]);
        expect(same.unchanged).toBe(1);

        // Aplicar sobre un id que cambió de estado entre medio: se recalcula y se informa.
        const res = await bulk.apply(tenantId, admin, 'productos', [a.id, b.id, 999_999], operations);
        expect(res.succeeded).toEqual([a.id]);
        expect(res.failed.map((x) => x.id).sort()).toEqual([b.id, 999_999].sort());
    });

    it('permisos: el alcance de EDICIÓN manda, y un agente no edita por filtro', async () => {
        const mine = await create(agent, 'Mío', 100);
        const theirs = await create(admin, 'Ajeno', 100);
        const operations = ops([{ op: 'add', field_id: f.stock!.id, amount: 5 }]);
        const preview = await bulk.preview(tenantId, agent, 'productos', { ids: [mine.id, theirs.id] }, operations);
        // Lo ajeno no entra: el agente sólo edita lo suyo.
        expect(preview.total).toBe(1);
        expect(preview.ids).toEqual([mine.id]);
        await expect(
            bulk.preview(tenantId, agent, 'productos', { include_subtasks: false }, operations),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza columnas calculadas y operaciones que el tipo no admite', async () => {
        const a = await create(admin, 'X', 1);
        await expect(
            bulk.preview(tenantId, admin, 'productos', { ids: [a.id] }, ops([{ op: 'set', field_id: f.margen!.id, value: 1 }])),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            bulk.preview(tenantId, admin, 'productos', { ids: [a.id] }, ops([{ op: 'percent', field_id: f.nombre!.id, percent: 5 }])),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
