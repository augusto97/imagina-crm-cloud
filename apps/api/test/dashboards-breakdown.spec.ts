import { AGGREGATE_OTHERS_KEY, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { DashboardsService, type DashboardViewer } from '../src/dashboards/dashboards.service';
import { dashboards, fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const layout = { x: 0, y: 0, w: 6, h: 4 };

type Breakdown = {
    data: Array<{ label: string; value: number; others?: number; segments?: Array<{ series: string; value: number }> }>;
    series: Array<{ key: string; value: number; others?: number }>;
};
type Pivot = {
    pivot: {
        rows: Array<{ key: string; value: number | null; others?: number }>;
        cols: Array<{ key: string; value: number | null; others?: number }>;
        cells: Array<{ row: string; col: string; value: number | null }>;
        total: number | null;
    };
};

/**
 * v0.1.291 — Barras apiladas ("Desglosar por") y tabla dinámica: valores
 * exactos sobre Postgres real, con multi_select, «sin valor», un campo
 * calculado como métrica, "Otros" en los dos niveles y el ACL de quien mira.
 */
describe('Tableros — desglose y tabla dinámica (Postgres real)', () => {
    let pg: TestPg;
    let service: DashboardsService;
    let listsService: ListsService;
    let tenantId: number;
    let listId: number;
    let dashId: number;
    let f: Record<string, Field>;
    const admin: DashboardViewer = { userId: 1, role: 'admin' };
    const viewer: DashboardViewer = { userId: 2, role: 'viewer' };

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        const aggregate = new AggregateService(tenantDb, listsService, fieldsService);
        service = new DashboardsService(tenantDb, aggregate, recordsService, fieldsService);

        const [t] = await pg.db.insert(tenants).values({ slug: 'apilado', name: 'Apilado' }).returning();
        tenantId = t!.id;
        await listsService.create(tenantId, { name: 'Ventas' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pendiente', label: 'Pendiente', color: 'amber' }, { value: 'hecho', label: 'Hecho', color: 'green' }] },
            },
            {
                label: 'Región',
                type: 'select',
                slug: 'region',
                config: { options: [{ value: 'norte', label: 'Norte' }, { value: 'centro', label: 'Centro' }, { value: 'sur', label: 'Sur' }] },
            },
            { label: 'Etiquetas', type: 'multi_select', slug: 'tags', config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'promo', label: 'Promo' }] } },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            { label: 'Cantidad', type: 'number', slug: 'cantidad' },
            { label: 'Precio', type: 'number', slug: 'precio' },
            { label: 'Cuándo', type: 'date', slug: 'cuando' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'ventas', d);
        f.total = await fieldsService.create(tenantId, 'ventas', {
            label: 'Total',
            type: 'computed',
            slug: 'total',
            config: { operation: 'product', inputs: [f.cantidad!.id, f.precio!.id] },
        } as CreateFieldInput);
        listId = f.nombre!.list_id;
        const key = (s: string) => `f${f[s]!.id}`;
        const seed: Array<Record<string, unknown>> = [
            { nombre: 'A', estado: 'pendiente', region: 'norte', tags: ['vip'], monto: 100, cantidad: 2, precio: 10, cuando: '2026-01-10' },
            { nombre: 'B', estado: 'pendiente', region: 'norte', tags: ['promo', 'vip'], monto: 300, cantidad: 1, precio: 5, cuando: '2026-01-20' },
            { nombre: 'C', estado: 'pendiente', region: 'centro', tags: ['vip', 'promo'], monto: 50, cantidad: 3, precio: 2, cuando: '2026-03-05' },
            { nombre: 'D', estado: 'hecho', region: 'centro', monto: 1000, cantidad: 4, precio: 25, cuando: '2026-03-11' },
            { nombre: 'E', estado: 'hecho', region: 'sur', monto: 10, cuando: '2026-03-15' },
            { nombre: 'F', estado: 'hecho', monto: 7, cuando: '2026-01-02' },
            { nombre: 'G', region: 'norte', monto: 40 },
        ];
        for (const r of seed) {
            const data: Record<string, unknown> = {};
            for (const [s, v] of Object.entries(r)) data[key(s)] = v;
            await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId, createdBy: 1, data }));
        }
        dashId = (await service.create(tenantId, 1, { name: 'Apilado', widgets: [] } as never)).id;
    });

    afterAll(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(dashboards).where(eq(dashboards.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await pg?.stop();
    });

    const run = async (widgets: unknown[], who: DashboardViewer = admin) => {
        await service.update(tenantId, dashId, admin, { widgets: widgets as never });
        return service.widgetsData(tenantId, dashId, who, {});
    };
    const segs = (row: Breakdown['data'][number] | undefined) => Object.fromEntries((row?.segments ?? []).map((s) => [s.series, s.value]));

    it('barras apiladas: cada grupo con su total y el valor de cada serie; las series con su total', async () => {
        const data = await run([
            {
                id: 'b1',
                type: 'chart_bar',
                list_id: listId,
                title: 'Monto por estado y región',
                config: { metric: 'sum', metric_field_id: f.monto!.id, group_by_field_id: f.estado!.id, sub_group_by_field_id: f.region!.id, stack_mode: 'stacked' },
                layout,
            },
        ]);
        const b = data.b1 as Breakdown;
        const byLabel = new Map(b.data.map((r) => [r.label, r]));
        expect(byLabel.get('hecho')!.value).toBe(1017);
        expect(segs(byLabel.get('hecho'))).toEqual({ centro: 1000, sur: 10, '(sin valor)': 7 });
        expect(byLabel.get('pendiente')!.value).toBe(450);
        expect(segs(byLabel.get('pendiente'))).toEqual({ norte: 400, centro: 50 });
        expect(segs(byLabel.get('(sin valor)'))).toEqual({ norte: 40 });
        // Series: las mayores primero, con su total sobre todos los registros.
        expect(b.series).toEqual([
            { key: 'centro', value: 1050 },
            { key: 'norte', value: 440 },
            { key: 'sur', value: 10 },
            { key: '(sin valor)', value: 7 },
        ]);
    });

    it('top de series: el resto va a «Otros», calculado sobre SUS registros (también en promedios)', async () => {
        const data = await run([
            {
                id: 's1',
                type: 'chart_bar',
                list_id: listId,
                title: 'Suma',
                config: { metric: 'sum', metric_field_id: f.monto!.id, group_by_field_id: f.estado!.id, sub_group_by_field_id: f.region!.id, series_top_n: 1 },
                layout,
            },
            {
                id: 's2',
                type: 'chart_bar',
                list_id: listId,
                title: 'Promedio',
                config: { metric: 'avg', metric_field_id: f.monto!.id, group_by_field_id: f.estado!.id, sub_group_by_field_id: f.region!.id, series_top_n: 1, stack_mode: 'grouped' },
                layout,
            },
        ]);
        const s1 = data.s1 as Breakdown;
        expect(s1.series).toEqual([
            { key: 'centro', value: 1050 },
            { key: AGGREGATE_OTHERS_KEY, value: 457, others: 3 },
        ]);
        expect(segs(s1.data.find((r) => r.label === 'pendiente'))).toEqual({ centro: 50, [AGGREGATE_OTHERS_KEY]: 400 });
        const s2 = data.s2 as Breakdown;
        // El "Otros" del promedio: (100 + 300 + 10 + 7 + 40) / 5, no el promedio de los promedios.
        expect(s2.series[1]).toEqual({ key: AGGREGATE_OTHERS_KEY, value: 91.4, others: 3 });
        expect(segs(s2.data.find((r) => r.label === 'hecho'))).toEqual({ centro: 1000, [AGGREGATE_OTHERS_KEY]: 8.5 });
    });

    it('desglose por multi_select (combinación normalizada) y un CALCULADO como métrica', async () => {
        const data = await run([
            {
                id: 'm1',
                type: 'chart_bar',
                list_id: listId,
                title: 'Etiquetas',
                config: { metric: 'sum', metric_field_id: f.total!.id, group_by_field_id: f.estado!.id, sub_group_by_field_id: f.tags!.id },
                layout,
            },
        ]);
        const m = data.m1 as Breakdown;
        // ["vip","promo"] y ["promo","vip"] son la MISMA serie; total = cantidad × precio.
        expect(segs(m.data.find((r) => r.label === 'pendiente'))).toEqual({ '["promo", "vip"]': 11, '["vip"]': 20 });
        expect(segs(m.data.find((r) => r.label === 'hecho'))).toEqual({ '(sin valor)': 100 });
    });

    it('área por mes desglosada: los meses vacíos se rellenan con 0 (sin segmentos)', async () => {
        const data = await run([
            {
                id: 'a1',
                type: 'chart_area',
                list_id: listId,
                title: 'Por mes',
                config: { metric: 'count', date_field_id: f.cuando!.id, time_bucket: 'month', sub_group_by_field_id: f.estado!.id },
                layout,
            },
        ]);
        const a = data.a1 as Breakdown;
        expect(a.data.map((r) => r.label)).toEqual(['2026-01', '2026-02', '2026-03', '(sin valor)']);
        expect(segs(a.data[0])).toEqual({ pendiente: 2, hecho: 1 });
        expect(a.data[1]).toEqual({ label: '2026-02', value: 0 });
        expect(segs(a.data[2])).toEqual({ pendiente: 1, hecho: 2 });
    });

    it('tabla dinámica: cruces, totales por fila y columna, y el general', async () => {
        const data = await run([
            {
                id: 'p1',
                type: 'pivot',
                list_id: listId,
                title: 'Monto',
                config: { metric: 'sum', metric_field_id: f.monto!.id, group_by_field_id: f.estado!.id, sub_group_by_field_id: f.region!.id },
                layout,
            },
        ]);
        const p = (data.p1 as Pivot).pivot;
        expect(p.rows).toEqual([
            { key: 'hecho', value: 1017 },
            { key: 'pendiente', value: 450 },
            { key: '(sin valor)', value: 40 },
        ]);
        expect(p.cols).toEqual([
            { key: 'centro', value: 1050 },
            { key: 'norte', value: 440 },
            { key: 'sur', value: 10 },
            { key: '(sin valor)', value: 7 },
        ]);
        const cell = (r: string, c: string) => p.cells.find((x) => x.row === r && x.col === c)?.value ?? null;
        expect(cell('pendiente', 'norte')).toBe(400);
        expect(cell('hecho', '(sin valor)')).toBe(7);
        expect(cell('(sin valor)', 'norte')).toBe(40);
        expect(cell('pendiente', 'sur')).toBeNull();
        expect(p.total).toBe(1507);
    });

    it('tabla dinámica con promedio: los totales son promedios de los REGISTROS; "Otros" en filas y columnas', async () => {
        const data = await run([
            {
                id: 'p2',
                type: 'pivot',
                list_id: listId,
                title: 'Promedio',
                config: { metric: 'avg', metric_field_id: f.monto!.id, group_by_field_id: f.region!.id, sub_group_by_field_id: f.estado!.id, top_n: 1, col_top_n: 1 },
                layout,
            },
        ]);
        const p = (data.p2 as Pivot).pivot;
        // Fila mayor: centro (promedio 525); el resto (norte, sur, sin región) en "Otros".
        expect(p.rows).toEqual([
            { key: 'centro', value: 525 },
            { key: AGGREGATE_OTHERS_KEY, value: 91.4, others: 3 },
        ]);
        // Columna mayor por promedio: hecho (339); el resto en "Otros".
        expect(p.cols.map((c) => c.key)).toEqual(['hecho', AGGREGATE_OTHERS_KEY]);
        expect(p.cols[0]!.value).toBe(339);
        expect(p.cols[1]).toEqual({ key: AGGREGATE_OTHERS_KEY, value: 122.5, others: 2 });
        // Promedio general de los 7 registros.
        expect(p.total).toBeCloseTo(215.2857, 3);
        const cell = (r: string, c: string) => p.cells.find((x) => x.row === r && x.col === c)?.value ?? null;
        expect(cell(AGGREGATE_OTHERS_KEY, AGGREGATE_OTHERS_KEY)).toBeCloseTo(146.6667, 3);
    });

    it('tabla dinámica sin columnas → el motivo; un campo oculto para el rol no se desglosa', async () => {
        const bad = await run([
            { id: 'x1', type: 'pivot', list_id: listId, title: 'Mal', config: { metric: 'count', group_by_field_id: f.estado!.id }, layout },
        ]);
        expect((bad.x1 as { __error: string }).__error).toMatch(/filas y otro distinto para las columnas/);

        await listsService.updatePermissions(tenantId, String(listId), {
            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['region'] } },
        });
        const data = await run(
            [
                {
                    id: 'v1',
                    type: 'chart_bar',
                    list_id: listId,
                    title: 'Oculto',
                    config: { metric: 'count', group_by_field_id: f.estado!.id, sub_group_by_field_id: f.region!.id },
                    layout,
                },
                {
                    id: 'v2',
                    type: 'pivot',
                    list_id: listId,
                    title: 'Oculto',
                    config: { metric: 'count', group_by_field_id: f.estado!.id, sub_group_by_field_id: f.region!.id },
                    layout,
                },
            ],
            viewer,
        );
        expect((data.v1 as { __error: string }).__error).toMatch(/no pertenece/);
        expect((data.v2 as { __error: string }).__error).toMatch(/no pertenece/);
    });
});
