import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RecordsGroupedService } from '../src/records/records-grouped.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

describe('Subtareas (v0.1.132)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let grouped: RecordsGroupedService;
    let tenantId: number;
    let titleKey: string;

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
        grouped = new RecordsGroupedService(
            recs,
            new AggregateService(tenantDb, lists_, fields_),
            lists_,
            fields_,
        );
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Tareas' });
        const f = await fields_.create(tenantId, 'tareas', {
            label: 'Título',
            type: 'text',
            slug: 'titulo',
        });
        titleKey = `f${f.id}`;
    });

    const create = (titulo: string, parentId?: number) =>
        recs.create(tenantId, admin, 'tareas', {
            data: { [titleKey]: titulo },
            ...(parentId !== undefined ? { parent_id: parentId } : {}),
        });

    it('el listado devuelve sólo el primer nivel y cuenta las subtareas', async () => {
        const padre = await create('Mudanza');
        await create('Embalar', padre.id);
        await create('Camión', padre.id);
        await create('Otra tarea suelta');

        const page = await recs.list(tenantId, admin, 'tareas', { limit: 50, sort_dir: 'asc' });
        expect(page.data).toHaveLength(2);
        const conHijos = page.data.find((r) => r.id === padre.id)!;
        expect(conHijos.subtask_count).toBe(2);
        expect(conHijos.parent_id).toBeNull();
    });

    it('`parent` trae las subtareas de un registro', async () => {
        const padre = await create('Mudanza');
        const hija = await create('Embalar', padre.id);
        await create('Suelta');

        const page = await recs.list(tenantId, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
            parent: padre.id,
        });
        expect(page.data.map((r) => r.id)).toEqual([hija.id]);
        expect(page.data[0]!.parent_id).toBe(padre.id);
    });

    it('`include_subtasks` devuelve todo plano (lo que necesita el export)', async () => {
        const padre = await create('Mudanza');
        await create('Embalar', padre.id);
        const page = await recs.list(tenantId, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
            include_subtasks: true,
        });
        expect(page.data).toHaveLength(2);
    });

    it('una subtarea no puede tener subtareas', async () => {
        const padre = await create('Mudanza');
        const hija = await create('Embalar', padre.id);
        await expect(create('Cinta', hija.id)).rejects.toThrow(BadRequestException);
    });

    it('borrar el padre se lleva sus subtareas', async () => {
        const padre = await create('Mudanza');
        const hija = await create('Embalar', padre.id);
        await recs.remove(tenantId, admin, 'tareas', padre.id);

        const page = await recs.list(tenantId, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
            include_subtasks: true,
        });
        expect(page.data).toHaveLength(0);
        await expect(recs.get(tenantId, admin, 'tareas', hija.id)).rejects.toThrow();
    });

    it('un padre inexistente rechaza la subtarea', async () => {
        await expect(create('Huérfana', 999999)).rejects.toThrow();
    });

    it('la vista agrupada recibe las MISMAS señales que la plana (v0.1.137)', async () => {
        // El bundle armaba su propio DTO recortado: sin `subtask_count` la
        // tabla agrupada nunca dibujaba el chevron de subtareas (reporte del
        // usuario: "sólo funciona en la vista Todos").
        const estado = await fields_.create(tenantId, 'tareas', {
            label: 'Estado',
            type: 'select',
            config: { options: [{ value: 'activo', label: 'Activo' }] },
        });
        const padre = await create('Mudanza');
        await create('Embalar', padre.id);

        const bundle = (await grouped.groupedBundle(tenantId, admin, 'tareas', {
            groupBy: estado.id,
            expanded: ['__null__'],
            perPage: 20,
            aggregateFieldIds: [],
        })) as {
            expanded: Record<string, { records: { data: Array<Record<string, unknown>> } }>;
        };

        const rows = bundle.expanded['__null__']!.records.data;
        const row = rows.find((r) => r.id === padre.id)!;
        expect(row.subtask_count).toBe(1);
        expect(row).toHaveProperty('parent_id', null);
        expect(row).toHaveProperty('has_description', false);
        expect(row).toHaveProperty('relations');
        // El primer nivel sigue siendo el primer nivel: la hija no aparece
        // suelta dentro del bucket.
        expect(rows.some((r) => r.parent_id !== null)).toBe(false);
    });
});
