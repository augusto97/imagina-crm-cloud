import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

/**
 * Casts tolerantes del query builder: un valor basura guardado en `data`
 * (una fecha «mañana» que escribió una automatización vieja, un número con
 * formato humano) no puede tirar con 500 el listado, el orden, los filtros
 * de fecha ni los agregados de TODA la lista.
 */
describe('QueryBuilder — casts tolerantes a datos basura', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let service: RecordsService;
    let tenantId: number;
    let listId: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        service = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
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
        listId = (await listsService.create(tenantId, { name: 'Tareas' })).id;
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Vence', type: 'date', slug: 'vence' },
            { label: 'Cita', type: 'datetime', slug: 'cita' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'tareas', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;

    /** Escribe `data` crudo (sin validar), como lo dejaba una automatización vieja. */
    async function rawInsert(data: Record<string, unknown>): Promise<number> {
        return withTenant(pg.db, tenantId, async (tx) => {
            const [row] = await tx
                .insert(records)
                .values({ tenantId, listId, data, createdBy: 1 })
                .returning({ id: records.id });
            return row!.id;
        });
    }

    it('ordenar y filtrar por fecha/número con una fila basura no responde 500', async () => {
        await service.create(tenantId, admin, 'tareas', {
            data: { [key('nombre')]: 'Buena', [key('vence')]: '2026-03-01', [key('cita')]: '2026-03-01T10:00:00Z', [key('monto')]: 10 },
        });
        await rawInsert({ [key('nombre')]: 'Basura', [key('vence')]: 'mañana', [key('cita')]: 'pronto', [key('monto')]: 'mucho' });

        const sorted = await service.list(tenantId, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
            sort: `field_${f.vence!.id}:asc`,
        });
        // La basura cuenta como vacío: NULLS LAST.
        expect(sorted.data.map((r) => r.data[key('nombre')])).toEqual(['Buena', 'Basura']);

        for (const [slug, op, value] of [
            ['vence', 'lte', '2026-12-31'],
            ['cita', 'gte', '2026-01-01T00:00:00Z'],
            ['monto', 'gt', 1],
        ] as const) {
            const page = await service.list(tenantId, admin, 'tareas', {
                limit: 50,
                sort_dir: 'asc',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f[slug]!.id, op, value }] } as never,
            });
            expect(page.data.map((r) => r.data[key('nombre')])).toEqual(['Buena']);
        }

        const byPreset = await service.list(tenantId, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: f.vence!.id, op: 'between_relative', value: 'this_year' }],
            } as never,
        });
        expect(byPreset.data.every((r) => r.data[key('nombre')] !== 'Basura')).toBe(true);
    });

    it('los agregados (suma, mín. de fecha) ignoran la fila basura', async () => {
        await service.create(tenantId, admin, 'tareas', { data: { [key('nombre')]: 'A', [key('monto')]: 40, [key('vence')]: '2026-05-01' } });
        await rawInsert({ [key('nombre')]: 'B', [key('monto')]: '1.000,5 pesos', [key('vence')]: '31/02/2026' });
        const agg = new AggregateService(tenantDb, listsService, fieldsService);
        const sum = await agg.run(tenantId, 'tareas', { metric: 'sum', field_id: f.monto!.id });
        expect(Number((sum as { value: unknown }).value)).toBe(40);
        const min = await agg.run(tenantId, 'tareas', { metric: 'min', field_id: f.vence!.id });
        expect(String((min as { value: unknown }).value)).toContain('2026-05-01');
    });
});
