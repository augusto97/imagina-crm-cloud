import { BadRequestException } from '@nestjs/common';
import { aggregateRequestSchema, AGGREGATE_OTHERS_KEY } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsGroupedService } from '../src/records/records-grouped.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, subGroupPairKey, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const viewer: Actor = { userId: 2, role: 'viewer' };

type Bundle = {
    buckets: Array<{ value: string | null; count: number; sub_buckets?: Array<{ value: string | null; count: number }> }>;
    meta: { total_records: number; sub_group_by_slug?: string };
    expanded: Record<string, { records: { data: Array<{ id: number; fields: Record<string, unknown> }>; meta: { total: number } }; aggregates?: { totals: Record<string, { sum?: number }> } }>;
};

/**
 * v0.1.287 — Agrupado en DOS niveles: capacidad general del motor de
 * agregados (vista agrupada «y luego por…», barras apiladas, tabla dinámica)
 * y bundle de la vista agrupada con subgrupos en la misma request.
 */
describe('Agrupado en dos niveles (v0.1.287)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let agg: AggregateService;
    let grouped: RecordsGroupedService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let tenantId: number;
    const f: Record<string, number> = {};
    const key = (slug: string): string => `f${f[slug]}`;

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
        agg = new AggregateService(tenantDb, lists_, fields_);
        grouped = new RecordsGroupedService(recs, agg, lists_, fields_);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        await pg.db.insert(users).values({ email: 'a@t.local', name: 'A', passwordHash: 'x' });
        await pg.db.insert(users).values({ email: 'b@t.local', name: 'B', passwordHash: 'x' });
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
        await lists_.create(tenantId, { name: 'Ventas' });
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            f[slug] = (await fields_.create(tenantId, 'ventas', { label: slug, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('nombre', 'text');
        // Catálogo en orden DISTINTO al alfabético de los valores.
        await mk('estado', 'select', {
            options: [
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'hecho', label: 'Hecho' },
            ],
        });
        await mk('region', 'select', {
            options: [
                { value: 'norte', label: 'Norte' },
                { value: 'centro', label: 'Centro' },
            ],
        });
        await mk('tags', 'multi_select', {
            options: [
                { value: 'vip', label: 'VIP' },
                { value: 'promo', label: 'Promo' },
            ],
        });
        await mk('monto', 'currency');
        await mk('cuando', 'date');
        await mk('adjunto', 'file');
        const rows: Array<Record<string, unknown>> = [
            { nombre: 'A', estado: 'pendiente', region: 'norte', tags: ['vip'], monto: 100, cuando: '2026-01-10' },
            { nombre: 'B', estado: 'pendiente', region: 'norte', tags: ['promo', 'vip'], monto: 300, cuando: '2026-01-20' },
            { nombre: 'C', estado: 'pendiente', region: 'centro', tags: ['vip', 'promo'], monto: 50, cuando: '2026-02-05' },
            { nombre: 'D', estado: 'hecho', region: 'centro', monto: 1000, cuando: '2026-02-11' },
            { nombre: 'E', estado: 'hecho', monto: 10, cuando: '2026-03-01' },
            { nombre: 'F', region: 'norte', monto: 7 },
        ];
        for (const row of rows) {
            const data: Record<string, unknown> = {};
            for (const [slug, v] of Object.entries(row)) data[key(slug)] = v;
            await recs.create(tenantId, admin, 'ventas', { data });
        }
    });

    it('run: (grupo, subgrupo) → métrica, con el valor del GRUPO calculado sobre sus registros', async () => {
        const res = await agg.run(tenantId, 'ventas', {
            metric: 'avg',
            field_id: f.monto,
            group_by_field_id: f.estado,
            sub_group_by_field_id: f.region,
        });
        const pend = res.groups!.find((g) => g.group === 'pendiente')!;
        // Promedio del grupo entero (150), no la suma de los promedios de los subgrupos.
        expect(pend.value).toBe(150);
        expect(pend.sub_groups).toEqual([
            { group: 'centro', value: 50 },
            { group: 'norte', value: 200 },
        ]);
        // «(sin valor)» en los dos niveles: E no tiene región; F no tiene estado.
        const hecho = res.groups!.find((g) => g.group === 'hecho')!;
        expect(hecho.sub_groups).toEqual([
            { group: 'centro', value: 1000 },
            { group: null, value: 10 },
        ]);
        expect(res.groups!.at(-1)).toEqual({ group: null, value: 7, sub_groups: [{ group: 'norte', value: 7 }] });
    });

    it('run: el segundo nivel por multi_select agrupa por COMBINACIÓN normalizada, y por fecha con bucket', async () => {
        const res = await agg.run(tenantId, 'ventas', { metric: 'count', group_by_field_id: f.estado, sub_group_by_field_id: f.tags });
        const pend = res.groups!.find((g) => g.group === 'pendiente')!;
        // ["promo","vip"] y ["vip","promo"] son el MISMO subgrupo.
        expect(pend.sub_groups).toEqual([
            { group: '["promo", "vip"]', value: 2 },
            { group: '["vip"]', value: 1 },
        ]);
        const byMonth = await agg.run(tenantId, 'ventas', {
            metric: 'sum',
            field_id: f.monto,
            group_by_field_id: f.region,
            sub_group_by_field_id: f.cuando,
            sub_time_bucket: 'month',
        });
        expect(byMonth.groups!.find((g) => g.group === 'norte')!.sub_groups).toEqual([
            { group: '2026-01', value: 400 },
            { group: null, value: 7 },
        ]);
    });

    it('run: con tope, los grupos que no entran caen en «Otros» también en el desglose', async () => {
        const res = await agg.run(
            tenantId,
            'ventas',
            { metric: 'sum', field_id: f.monto, group_by_field_id: f.region, sub_group_by_field_id: f.estado },
            { top: { limit: 1, byValue: true } },
        );
        expect(res.groups!.map((g) => g.group)).toEqual(['centro', AGGREGATE_OTHERS_KEY]);
        const others = res.groups!.find((g) => g.group === AGGREGATE_OTHERS_KEY)!;
        // Otros = norte (A, B, F) + sin región (E).
        expect(others.value).toBe(417);
        expect(others.sub_groups).toEqual([
            { group: 'hecho', value: 10 },
            { group: 'pendiente', value: 400 },
            { group: null, value: 7 },
        ]);
    });

    it('run: mismas reglas que el primer nivel (archivo/relación no agrupan, otro campo, ACL)', async () => {
        await expect(
            agg.run(tenantId, 'ventas', { metric: 'count', group_by_field_id: f.estado, sub_group_by_field_id: f.adjunto }),
        ).rejects.toThrow(/no forman grupos/);
        await expect(
            agg.run(tenantId, 'ventas', { metric: 'count', group_by_field_id: f.estado, sub_group_by_field_id: f.estado }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(aggregateRequestSchema.safeParse({ metric: 'count', sub_group_by_field_id: 3 }).success).toBe(false);
        await lists_.updatePermissions(tenantId, 'ventas', {
            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['region'] } },
        });
        // Un campo oculto para el rol no se agrupa: sus grupos serían los valores ocultos.
        await expect(
            agg.run(tenantId, 'ventas', { metric: 'count', group_by_field_id: f.estado, sub_group_by_field_id: f.region }, { viewer }),
        ).rejects.toThrow(/no pertenece/);
    });

    it('bundle: subgrupos en la MISMA request, en el orden del catálogo, con sus filas y su pie', async () => {
        const bundle = (await grouped.groupedBundle(tenantId, admin, 'ventas', {
            groupBy: f.estado!,
            subGroupBy: f.region!,
            expanded: [],
            expandAll: true,
            perPage: 50,
            aggregateFieldIds: [f.monto!],
        })) as Bundle;
        expect(bundle.meta.sub_group_by_slug).toBe('region');
        expect(bundle.meta.total_records).toBe(6);
        // Catálogo: pendiente antes que hecho; norte antes que centro; «sin valor» al final.
        expect(bundle.buckets.map((b) => b.value)).toEqual(['pendiente', 'hecho', null]);
        expect(bundle.buckets[0]!.sub_buckets).toEqual([
            { value: 'norte', count: 2 },
            { value: 'centro', count: 1 },
        ]);
        expect(bundle.buckets[1]!.sub_buckets).toEqual([
            { value: 'centro', count: 1 },
            { value: null, count: 1 },
        ]);
        const pendNorte = bundle.expanded[subGroupPairKey('pendiente', 'norte')]!;
        expect(pendNorte.records.data.map((r) => r.fields.nombre).sort()).toEqual(['A', 'B']);
        expect(pendNorte.records.meta.total).toBe(2);
        expect(pendNorte.aggregates?.totals.monto?.sum).toBe(400);
        const hechoSin = bundle.expanded[subGroupPairKey('hecho', null)]!;
        expect(hechoSin.records.data.map((r) => r.fields.nombre)).toEqual(['E']);
        expect(hechoSin.aggregates?.totals.monto?.sum).toBe(10);
        // Cada registro aparece en UN solo subgrupo.
        const all = Object.values(bundle.expanded).flatMap((e) => e.records.data.map((r) => r.id));
        expect(new Set(all).size).toBe(all.length);
        expect(all).toHaveLength(6);
    });

    it('bundle: grupos y subgrupos cerrados no traen filas; la búsqueda aplica igual', async () => {
        const bundle = (await grouped.groupedBundle(tenantId, admin, 'ventas', {
            groupBy: f.estado!,
            subGroupBy: f.region!,
            expanded: [],
            expandAll: true,
            collapsed: ['hecho'],
            collapsedSub: [['pendiente', 'centro']],
            perPage: 50,
            aggregateFieldIds: [],
        })) as Bundle;
        expect(Object.keys(bundle.expanded).sort()).toEqual(
            [subGroupPairKey('pendiente', 'norte'), subGroupPairKey(null, 'norte')].sort(),
        );
        const found = (await grouped.groupedBundle(tenantId, admin, 'ventas', {
            groupBy: f.estado!,
            subGroupBy: f.region!,
            expanded: [],
            expandAll: true,
            search: 'B',
            perPage: 50,
            aggregateFieldIds: [],
        })) as Bundle;
        expect(found.meta.total_records).toBe(1);
        expect(found.buckets).toEqual([{ value: 'pendiente', count: 1, sub_buckets: [{ value: 'norte', count: 1 }] }]);
    });
});
