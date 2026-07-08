import { BadRequestException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

describe('AggregateService (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let service: AggregateService;
    let tenantId: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        service = new AggregateService(tenantDb, listsService, fieldsService);

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
        await listsService.create(tenantId, { name: 'Ventas' });
        const defs: CreateFieldInput[] = [
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'ganada', label: 'Ganada' }, { value: 'perdida', label: 'Perdida' }] },
            },
            { label: 'Activo', type: 'checkbox', slug: 'activo' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'ventas', d);

        const seed = [
            { monto: 100, estado: 'ganada', activo: true },
            { monto: 300, estado: 'ganada', activo: true },
            { monto: 500, estado: 'perdida', activo: false },
        ];
        const key = (s: string) => `f${f[s]!.id}`;
        for (const r of seed) {
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(records).values({
                    tenantId,
                    listId: f.monto!.list_id,
                    createdBy: 1,
                    data: { [key('monto')]: r.monto, [key('estado')]: r.estado, [key('activo')]: r.activo },
                }),
            );
        }
    });

    it('count total', async () => {
        expect((await service.run(tenantId, 'ventas', { metric: 'count' })).value).toBe(3);
    });

    it('sum y avg sobre currency', async () => {
        expect((await service.run(tenantId, 'ventas', { metric: 'sum', field_id: f.monto!.id })).value).toBe(900);
        expect((await service.run(tenantId, 'ventas', { metric: 'avg', field_id: f.monto!.id })).value).toBe(300);
    });

    it('min/max sobre currency', async () => {
        expect((await service.run(tenantId, 'ventas', { metric: 'min', field_id: f.monto!.id })).value).toBe(100);
        expect((await service.run(tenantId, 'ventas', { metric: 'max', field_id: f.monto!.id })).value).toBe(500);
    });

    it('count_unique y count_empty', async () => {
        expect(
            (await service.run(tenantId, 'ventas', { metric: 'count_unique', field_id: f.estado!.id })).value,
        ).toBe(2);
        expect(
            (await service.run(tenantId, 'ventas', { metric: 'count_empty', field_id: f.estado!.id })).value,
        ).toBe(0);
    });

    it('count_true/count_false sobre checkbox', async () => {
        expect((await service.run(tenantId, 'ventas', { metric: 'count_true', field_id: f.activo!.id })).value).toBe(2);
        expect((await service.run(tenantId, 'ventas', { metric: 'count_false', field_id: f.activo!.id })).value).toBe(1);
    });

    it('sum con group_by estado', async () => {
        const res = await service.run(tenantId, 'ventas', {
            metric: 'sum',
            field_id: f.monto!.id,
            group_by_field_id: f.estado!.id,
        });
        expect(res.groups).toEqual([
            { group: 'ganada', value: 400 },
            { group: 'perdida', value: 500 },
        ]);
    });

    it('respeta el filter_tree', async () => {
        const res = await service.run(tenantId, 'ventas', {
            metric: 'sum',
            field_id: f.monto!.id,
            filter_tree: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: f.estado!.id, op: 'eq', value: 'ganada' }],
            },
        });
        expect(res.value).toBe(400);
    });

    it('restricciones por tipo: sum sobre select → 400', async () => {
        await expect(
            service.run(tenantId, 'ventas', { metric: 'sum', field_id: f.estado!.id }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
