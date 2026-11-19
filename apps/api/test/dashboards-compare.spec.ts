import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const layout = { x: 0, y: 0, w: 6, h: 4 };

type Cmp = Record<string, unknown> & { unavailable?: string; label?: string; detail?: string; value?: number };

/**
 * v0.1.462 — «Comparar con…» (J2) y el pronóstico ponderado (J3) sobre
 * Postgres real. Hoy es el 19 de noviembre de 2026 en Bogotá (en UTC ya es
 * el 20): los números de cada caso están hechos a mano en la tabla de abajo.
 *
 * | reg | monto | etapa       | fecha      | cierre     | cuando (UTC)          | creó |
 * | A   | 100   | ganado      | 2026-11-05 | 2026-11-05 |                       | 1    |
 * | B   | 200   | propuesta   | 2026-11-19 | 2026-11-18 |                       | 2    |
 * | C   | 400   | negociacion |            | 2026-11-25 |                       | 1    |
 * | D   | 300   | ganado      | 2026-10-10 | 2026-10-10 |                       | 2    |
 * | E   | 50    | nuevo       | 2026-10-19 | 2026-10-19 |                       | 1    |
 * | F   | 1000  | perdido     | 2026-10-20 | 2026-10-25 |                       | 1    |
 * | G   | 70    | ganado      | 2025-11-12 |            |                       | 2    |
 * | I   | 5     | nuevo       | 2025-11-25 |            |                       | 1    |
 * | H   | 30    | nuevo       |            | 2026-12-03 |                       | 1    |
 * | N   | 80    | propuesta   |            | 2026-08-15 |                       | 1    |
 * | O   | 60    | ganado      |            | 2026-07-02 |                       | 1    |
 * | P   | 25    | (sin etapa) |            | 2026-11-10 |                       | 1    |
 * | J   |       |             |            |            | 2026-10-20T03:30Z     | 1    |  ← 19-oct 22:30 en Bogotá
 * | K   |       |             |            |            | 2026-11-01T04:00Z     | 1    |  ← 31-oct 23:00 en Bogotá
 * | L   |       |             |            |            | 2026-11-19T23:00Z     | 1    |
 * | M   |       |             |            |            | 2026-10-02T02:00Z     | 1    |  ← 1-oct 21:00 en Bogotá
 * | Q   | 7     |             | 2028-02-29 |            |                       | 1    |
 * | R   | 11    |             | 2027-02-28 |            |                       | 1    |
 * | S   | 13    |             | 2027-03-01 |            |                       | 1    |
 * | T   | 17    |             | 2028-01-31 |            |                       | 1    |
 */
describe('Tableros — comparar períodos y pronóstico (Postgres real)', () => {
    let pg: TestPg;
    let service: DashboardsService;
    let tenantId: number;
    let listId: number;
    let dashId: number;
    let f: Record<string, Field>;
    const admin: DashboardViewer = { userId: 1, role: 'admin' };
    const agent: DashboardViewer = { userId: 2, role: 'agent' };

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const tz = new TenantTimeZones(tenantDb);
        const listsService = new ListsService(tenantDb, new ListsRepository(), rt);
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
            undefined,
            undefined,
            undefined,
            tz,
        );
        const aggregate = new AggregateService(tenantDb, listsService, fieldsService, tz);
        service = new DashboardsService(tenantDb, aggregate, recordsService, fieldsService);

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'comparar', name: 'Comparar', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        await listsService.create(tenantId, { name: 'Negocios' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Etapa',
                type: 'select',
                slug: 'etapa',
                config: {
                    options: [
                        { value: 'nuevo', label: 'Nuevo' },
                        { value: 'propuesta', label: 'Propuesta' },
                        { value: 'negociacion', label: 'Negociación' },
                        { value: 'ganado', label: 'Ganado' },
                        { value: 'perdido', label: 'Perdido' },
                    ],
                },
            },
            { label: 'Fecha', type: 'date', slug: 'fecha' },
            { label: 'Cierre', type: 'date', slug: 'cierre' },
            { label: 'Cuándo', type: 'datetime', slug: 'cuando' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'negocios', d);
        listId = f.nombre!.list_id;
        const key = (s: string) => `f${f[s]!.id}`;
        const seed: Array<[string, number | null, string | null, string | null, string | null, string | null, number]> = [
            ['A', 100, 'ganado', '2026-11-05', '2026-11-05', null, 1],
            ['B', 200, 'propuesta', '2026-11-19', '2026-11-18', null, 2],
            ['C', 400, 'negociacion', null, '2026-11-25', null, 1],
            ['D', 300, 'ganado', '2026-10-10', '2026-10-10', null, 2],
            ['E', 50, 'nuevo', '2026-10-19', '2026-10-19', null, 1],
            ['F', 1000, 'perdido', '2026-10-20', '2026-10-25', null, 1],
            ['G', 70, 'ganado', '2025-11-12', null, null, 2],
            ['I', 5, 'nuevo', '2025-11-25', null, null, 1],
            ['H', 30, 'nuevo', null, '2026-12-03', null, 1],
            ['N', 80, 'propuesta', null, '2026-08-15', null, 1],
            ['O', 60, 'ganado', null, '2026-07-02', null, 1],
            ['P', 25, null, null, '2026-11-10', null, 1],
            ['J', null, null, null, null, '2026-10-20T03:30:00.000Z', 1],
            ['K', null, null, null, null, '2026-11-01T04:00:00.000Z', 1],
            ['L', null, null, null, null, '2026-11-19T23:00:00.000Z', 1],
            ['M', null, null, null, null, '2026-10-02T02:00:00.000Z', 1],
            ['Q', 7, null, '2028-02-29', null, null, 1],
            ['R', 11, null, '2027-02-28', null, null, 1],
            ['S', 13, null, '2027-03-01', null, null, 1],
            ['T', 17, null, '2028-01-31', null, null, 1],
        ];
        for (const [nombre, monto, etapa, fecha, cierre, cuando, createdBy] of seed) {
            const data: Record<string, unknown> = { [key('nombre')]: nombre };
            if (monto !== null) data[key('monto')] = monto;
            if (etapa !== null) data[key('etapa')] = etapa;
            if (fecha !== null) data[key('fecha')] = fecha;
            if (cierre !== null) data[key('cierre')] = cierre;
            if (cuando !== null) data[key('cuando')] = cuando;
            await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId, createdBy, data }));
        }
        dashId = (await service.create(tenantId, 1, { name: 'Ventas', widgets: [] } as never)).id;
        // Hoy: 19-nov-2026 22:00 en Bogotá (en UTC ya es el 20).
        vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T03:00:00Z') });
    });

    afterAll(async () => {
        vi.useRealTimers();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(dashboards).where(eq(dashboards.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await pg?.stop();
    });

    const run = async (widgets: unknown[], who: DashboardViewer = admin, body: Record<string, unknown> = {}) => {
        await service.update(tenantId, dashId, admin, { widgets: widgets as never });
        return service.widgetsData(tenantId, dashId, who, body as never);
    };
    const kpi = (id: string, config: Record<string, unknown>) => ({
        id,
        type: 'kpi',
        list_id: listId,
        title: id,
        config: { metric: 'sum', metric_field_id: f.monto!.id, period: { field_id: f.fecha!.id, preset: 'this_month' }, ...config },
        layout,
    });
    const cmpOf = (d: unknown): Cmp => (d as { compare: Cmp }).compare;

    it('KPI: este mes (hasta hoy) vs. el mes anterior hasta el mismo día, completo y el año pasado', async () => {
        const data = await run([
            kpi('toDate', { compare: { mode: 'previous', to_date: true } }),
            kpi('full', { compare: { mode: 'previous', to_date: false } }),
            kpi('lastYear', { compare: { mode: 'last_year', to_date: true } }),
            kpi('lastYearFull', { compare: { mode: 'last_year', to_date: false } }),
            kpi('plain', {}),
        ]);
        // Noviembre: A + B = 300. Del 1 al 19 de octubre: D + E = 350 (F es del 20).
        expect((data.toDate as { value: number }).value).toBe(300);
        expect(cmpOf(data.toDate)).toMatchObject({
            mode: 'previous',
            label: 'Este mes vs. mes anterior',
            detail: '1–19 nov 2026 vs. 1–19 oct 2026',
            value: 350,
            previous: { from: '2026-10-01', to: '2026-10-19' },
        });
        // Octubre completo: D + E + F.
        expect(cmpOf(data.full)).toMatchObject({ value: 1350, previous: { from: '2026-10-01', to: '2026-10-31' } });
        // 1-19 nov 2025: sólo G. Noviembre de 2025 completo: G + I.
        expect(cmpOf(data.lastYear)).toMatchObject({ value: 70, label: 'Noviembre 2026 vs. noviembre 2025' });
        expect(cmpOf(data.lastYearFull)).toMatchObject({ value: 75 });
        expect('compare' in (data.plain as object)).toBe(false);
    });

    it('el filtro del widget y el ACL de quien mira valen igual en el período anterior', async () => {
        const widgets = [
            kpi('filtered', {
                compare: { mode: 'previous', to_date: true },
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.etapa!.id, op: 'eq', value: 'ganado' }] },
            }),
            kpi('mine', { compare: { mode: 'previous', to_date: true } }),
        ];
        const asAdmin = await run(widgets);
        expect((asAdmin.filtered as { value: number }).value).toBe(100);
        expect(cmpOf(asAdmin.filtered).value).toBe(300);
        // La agente sólo ve lo que creó: B ahora, D antes.
        const asAgent = await run(widgets, agent);
        expect((asAgent.mine as { value: number }).value).toBe(200);
        expect(cmpOf(asAgent.mine).value).toBe(300);
    });

    it('fecha y hora en la zona de la empresa (no en UTC)', async () => {
        const data = await run([
            {
                id: 'tz',
                type: 'kpi',
                list_id: listId,
                title: 'Contactos',
                config: { metric: 'count', period: { field_id: f.cuando!.id, preset: 'this_month' }, compare: { mode: 'previous', to_date: true } },
                layout,
            },
        ]);
        // Noviembre en Bogotá: sólo L (K es el 31 de octubre allá). En UTC serían 2.
        expect((data.tz as { value: number }).value).toBe(1);
        // 1-19 de octubre en Bogotá: M y J. En UTC J caería el 20 y M igual entraría: 1.
        expect(cmpOf(data.tz).value).toBe(2);
    });

    it('febrero de un año bisiesto: el anterior es enero; el del año pasado termina el 28', async () => {
        const widgets = [kpi('leap', { compare: { mode: 'previous', to_date: true } })];
        const prev = await run(widgets, admin, { period_preset: 'custom:2028-02-01:2028-02-29' });
        expect((prev.leap as { value: number }).value).toBe(7);
        expect(cmpOf(prev.leap)).toMatchObject({ value: 17, previous: { from: '2028-01-01', to: '2028-01-31' } });
        // El tablero pide «mismo período del año pasado» (pisa el del widget).
        const ly = await run(widgets, admin, { period_preset: 'custom:2028-02-01:2028-02-29', compare: 'last_year' });
        expect(cmpOf(ly.leap)).toMatchObject({ value: 11, previous: { from: '2027-02-01', to: '2027-02-28' }, label: 'feb 2028 vs. feb 2027' });
        // «Sin comparar» desde el tablero.
        const none = await run(widgets, admin, { compare: 'none' });
        expect('compare' in (none.leap as object)).toBe(false);
        // Un rango propio desde el tablero.
        const custom = await run(widgets, admin, { compare: 'custom:2027-02-01:2027-03-01' });
        expect(cmpOf(custom.leap)).toMatchObject({ value: 24, previous: { from: '2027-02-01', to: '2027-03-01' } });
    });

    it('barras por etapa: el valor de antes de los MISMOS grupos; una serie diaria alineada día a día', async () => {
        const data = await run([
            {
                id: 'bars',
                type: 'chart_bar',
                list_id: listId,
                title: 'Por etapa',
                config: { metric: 'sum', metric_field_id: f.monto!.id, group_by_field_id: f.etapa!.id, period: { field_id: f.fecha!.id, preset: 'this_month' }, compare: { mode: 'previous', to_date: true } },
                layout,
            },
            {
                id: 'line',
                type: 'chart_line',
                list_id: listId,
                title: 'Por día',
                config: { metric: 'sum', metric_field_id: f.monto!.id, date_field_id: f.fecha!.id, time_bucket: 'day', period: { field_id: f.fecha!.id, preset: 'this_month' }, compare: { mode: 'previous', to_date: true } },
                layout,
            },
        ]);
        const bars = data.bars as { data: Array<{ label: string; value: number }>; compare: Cmp };
        expect(Object.fromEntries(bars.data.map((r) => [r.label, r.value]))).toEqual({ ganado: 100, propuesta: 200 });
        expect(Object.fromEntries((bars.compare.values as Array<{ label: string; value: number }>).map((r) => [r.label, r.value]))).toEqual({ ganado: 300, propuesta: 0 });
        // El total de antes cuenta TODOS sus grupos (E «nuevo» = 50 cae en «Otros»):
        // 300 + 50 = 350, lo mismo que el indicador con los mismos filtros.
        expect(bars.compare.total).toBe(350);
        const line = (data.line as { compare: Cmp }).compare;
        // La serie: los dos meses COMPLETOS, el actual hasta hoy (19 puntos) y octubre con sus 31 días.
        expect(line.detail).toBe('nov 2026 vs. oct 2026');
        const points = line.points as Array<{ label: string | null; prev_label: string | null; value: number | null; previous: number | null }>;
        expect(points).toHaveLength(31);
        expect(points[4]).toEqual({ label: '2026-11-05', prev_label: '2026-10-05', value: 100, previous: 0 });
        expect(points[9]).toEqual({ label: '2026-11-10', prev_label: '2026-10-10', value: 0, previous: 300 });
        expect(points[18]).toEqual({ label: '2026-11-19', prev_label: '2026-10-19', value: 200, previous: 50 });
        expect(points[19]).toEqual({ label: null, prev_label: '2026-10-20', value: null, previous: 1000 });
        expect(points[30]).toEqual({ label: null, prev_label: '2026-10-31', value: null, previous: 0 });
    });

    it('tabla: el pie compara registros y sumas; tabla dinámica: antes por fila', async () => {
        const data = await run([
            {
                id: 'tbl',
                type: 'table',
                list_id: listId,
                title: 'Ventas',
                config: { visible_field_ids: [f.nombre!.id, f.monto!.id, f.fecha!.id], period: { field_id: f.fecha!.id, preset: 'this_month' }, compare: { mode: 'previous', to_date: true } },
                layout,
            },
            {
                id: 'pv',
                type: 'pivot',
                list_id: listId,
                title: 'Etapa por nombre',
                config: {
                    metric: 'sum',
                    metric_field_id: f.monto!.id,
                    group_by_field_id: f.etapa!.id,
                    sub_group_by_field_id: f.nombre!.id,
                    period: { field_id: f.fecha!.id, preset: 'this_month' },
                    compare: { mode: 'previous', to_date: true },
                },
                layout,
            },
        ]);
        const tbl = data.tbl as { rows: unknown[]; compare: Cmp };
        expect(tbl.rows).toHaveLength(2);
        expect(tbl.compare.totals).toEqual([
            { key: '__count', label: 'Registros', field_id: null, value: 2, previous: 2 },
            { key: 'monto', label: 'Monto', field_id: f.monto!.id, value: 300, previous: 350 },
        ]);
        const pv = (data.pv as { compare: Cmp }).compare;
        expect(Object.fromEntries((pv.rows as Array<{ key: string; value: number }>).map((r) => [r.key, r.value]))).toEqual({ ganado: 300, propuesta: 0 });
        expect(pv.total).toBe(350);
    });

    it('cuando no se puede comparar, lo dice (sin período o con «Desglosar por»)', async () => {
        const data = await run([
            { id: 'noPeriod', type: 'kpi', list_id: listId, title: 'x', config: { metric: 'count', compare: { mode: 'previous' } }, layout },
            {
                id: 'stacked',
                type: 'chart_bar',
                list_id: listId,
                title: 'x',
                config: { group_by_field_id: f.etapa!.id, sub_group_by_field_id: f.nombre!.id, period: { field_id: f.fecha!.id, preset: 'this_month' }, compare: { mode: 'previous' } },
                layout,
            },
        ]);
        expect(cmpOf(data.noPeriod)).toEqual({ unavailable: 'Elige un período para comparar.' });
        expect(cmpOf(data.stacked)).toEqual({ unavailable: 'La comparación no está disponible con «Desglosar por».' });
    });

    it('pronóstico: ganado, ponderado (monto × probabilidad) y abierto por mes del trimestre', async () => {
        const widget = (config: Record<string, unknown> = {}) => ({
            id: 'fc',
            type: 'forecast',
            list_id: listId,
            title: 'Pronóstico',
            config: {
                metric_field_id: f.monto!.id,
                stage_field_id: f.etapa!.id,
                date_field_id: f.cierre!.id,
                time_bucket: 'month',
                period: { field_id: f.cierre!.id, preset: 'this_quarter' },
                compare: { mode: 'previous', to_date: false },
                ...config,
            },
            layout,
        });
        const data = await run([widget()]);
        type Fc = { forecast: { buckets: Array<Record<string, unknown>>; totals: Record<string, number>; stages: Array<{ key: string; probability: number; amount: number }> }; compare: Cmp };
        const fc = data.fc as Fc;
        // Sugeridas por el nombre: nuevo 25, propuesta 50, negociación 75, ganado 100, perdido 0.
        expect(Object.fromEntries(fc.forecast.stages.map((s) => [s.key, s.probability]))).toEqual({ nuevo: 25, propuesta: 50, negociacion: 75, ganado: 100, perdido: 0 });
        // Octubre: D ganado 300; E nuevo 50 → 12,5. Noviembre: A 100 ganado; B 200 → 100; C 400 → 300. Diciembre: H 30 → 7,5.
        expect(fc.forecast.buckets).toEqual([
            { key: '2026-10', won: 300, weighted: 12.5, open: 50, lost: 1000, forecast: 312.5, unassigned: 0 },
            { key: '2026-11', won: 100, weighted: 400, open: 600, lost: 0, forecast: 500, unassigned: 25 },
            { key: '2026-12', won: 0, weighted: 7.5, open: 30, lost: 0, forecast: 7.5, unassigned: 0 },
        ]);
        expect(fc.forecast.totals).toEqual({ won: 400, weighted: 420, open: 680, lost: 1000, forecast: 820, unassigned: 25 });
        // El trimestre anterior COMPLETO: O ganado 60 + N propuesta 80 × 50 % = 100.
        expect(fc.compare).toMatchObject({ label: 'Este trimestre vs. trimestre anterior', totals: { won: 60, weighted: 40, forecast: 100 } });

        // Probabilidades propias; y lo que ve la agente (sólo B y D).
        const own = await run([widget({ stage_probabilities: { propuesta: 10 } })], agent);
        expect((own.fc as Fc).forecast.totals).toEqual({ won: 300, weighted: 20, open: 200, lost: 0, forecast: 320, unassigned: 0 });
    });

    it('un pronóstico sin monto o sin etapa se explica; la vista previa del widget compara igual', async () => {
        const data = await run([{ id: 'bad', type: 'forecast', list_id: listId, title: 'x', config: { metric_field_id: f.monto!.id, stage_field_id: f.nombre!.id }, layout }]);
        expect(data.bad).toMatchObject({ __error: 'El pronóstico necesita un campo de monto y un campo de etapa (selección).' });
        const preview = await service.previewWidget(tenantId, dashId, admin, kpi('pre', { compare: { mode: 'previous', to_date: true } }) as never, {});
        expect(cmpOf(preview).value).toBe(350);
    });
});
