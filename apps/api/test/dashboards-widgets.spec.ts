import type { CreateFieldInput, Field } from '@imagina-base/shared';
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

/** Motor honesto de widgets (v0.1.97): período, delta, tabla, bucketing. */
describe('DashboardsService — evaluación de widgets (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let service: DashboardsService;
    let tenantId: number;
    let dashId: number;
    let f: Record<string, Field>;
    const admin: DashboardViewer = { userId: 1, role: 'admin' };

    /** YYYY-MM-DD de hace N días (UTC — mismo reloj naive que los datos). */
    const daysAgo = (n: number): string =>
        new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
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
        );
        const aggregate = new AggregateService(tenantDb, listsService, fieldsService);
        service = new DashboardsService(tenantDb, aggregate, recordsService, fieldsService);

        const [t] = await pg.db.insert(tenants).values({ slug: 'wacme', name: 'WACME' }).returning();
        tenantId = t!.id;

        await listsService.create(tenantId, { name: 'Ops' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            { label: 'Fecha', type: 'date', slug: 'fecha' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'ops', d);
        const key = (s: string) => `f${f[s]!.id}`;

        // Seed: 3 registros en los últimos 30 días, 1 en la ventana anterior
        // (hace ~40 días), 1 hace ~400 días (fuera de todo período anual corto).
        const seed = [
            { nombre: 'a', monto: 100, fecha: daysAgo(1) },
            { nombre: 'b', monto: 200, fecha: daysAgo(5) },
            { nombre: 'c', monto: 300, fecha: daysAgo(20) },
            { nombre: 'd', monto: 1000, fecha: daysAgo(40) },
            { nombre: 'e', monto: 5000, fecha: daysAgo(400) },
        ];
        for (const r of seed) {
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(records).values({
                    tenantId,
                    listId: f.monto!.list_id,
                    createdBy: 1,
                    data: { [key('nombre')]: r.nombre, [key('monto')]: r.monto, [key('fecha')]: r.fecha },
                }),
            );
        }

        const dash = await service.create(tenantId, 1, { name: 'Panel', widgets: [] } as never);
        dashId = dash.id;
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

    const withWidgets = async (widgets: unknown[]): Promise<Record<string, unknown>> => {
        await service.update(tenantId, dashId, admin, { widgets: widgets as never });
        return service.widgetsData(tenantId, dashId, admin);
    };

    it('el período relativo del widget FILTRA de verdad (last_30_days)', async () => {
        const data = await withWidgets([
            {
                id: 'w1',
                type: 'kpi',
                list_id: f.monto!.list_id,
                title: 'Total',
                config: { metric: 'count' },
                layout: { x: 0, y: 0, w: 3, h: 2 },
            },
            {
                id: 'w2',
                type: 'kpi',
                list_id: f.monto!.list_id,
                title: 'Mes',
                config: { metric: 'count', period: { field_id: f.fecha!.id, preset: 'last_30_days' } },
                layout: { x: 3, y: 0, w: 3, h: 2 },
            },
        ]);
        expect((data.w1 as { value: number }).value).toBe(5);
        expect((data.w2 as { value: number }).value).toBe(3);
    });

    it('un preset de período inválido se ignora (no rompe el bundle)', async () => {
        const data = await withWidgets([
            {
                id: 'w1',
                type: 'kpi',
                list_id: f.monto!.list_id,
                title: 'X',
                config: { metric: 'count', period: { field_id: f.fecha!.id, preset: 'custom' } },
                layout: { x: 0, y: 0, w: 3, h: 2 },
            },
        ]);
        expect((data.w1 as { value: number }).value).toBe(5);
    });

    it('stat_delta compara ventanas consecutivas reales', async () => {
        const data = await withWidgets([
            {
                id: 'w1',
                type: 'stat_delta',
                list_id: f.monto!.list_id,
                title: 'Crecimiento',
                config: { metric: 'count', date_field_id: f.fecha!.id, period_days: 30 },
                layout: { x: 0, y: 0, w: 3, h: 2 },
            },
        ]);
        const d = data.w1 as { value: number; previous: number; delta_pct: number | null; period_days: number };
        // Últimos 30 días: 3 registros; los 30 anteriores: 1 (hace 40 días).
        expect(d.value).toBe(3);
        expect(d.previous).toBe(1);
        expect(d.delta_pct).toBe(200);
        expect(d.period_days).toBe(30);
    });

    it('la tabla devuelve columnas visibles + filas slug-keyed con orden y límite', async () => {
        const data = await withWidgets([
            {
                id: 'w1',
                type: 'table',
                list_id: f.monto!.list_id,
                title: 'Top montos',
                config: {
                    visible_field_ids: [f.nombre!.id, f.monto!.id],
                    sort_field_id: f.monto!.id,
                    sort_dir: 'desc',
                    limit: 2,
                },
                layout: { x: 0, y: 0, w: 6, h: 5 },
            },
        ]);
        const t = data.w1 as {
            columns: Array<{ label: string; slug: string; type: string }>;
            rows: Array<{ id: number; fields: Record<string, unknown> }>;
        };
        expect(t.columns.map((c) => c.slug)).toEqual(['nombre', 'monto']);
        expect(t.rows).toHaveLength(2);
        expect(t.rows.map((r) => r.fields.monto)).toEqual([5000, 1000]);
        expect(t.rows[0]!.fields.nombre).toBe('e');
    });

    it('v0.1.98 — widgets de contenido no evalúan datos (bundle devuelve {})', async () => {
        const data = await withWidgets([
            {
                id: 'h1',
                type: 'heading',
                list_id: 0,
                title: 'Sección ventas',
                config: { subtitle: 'KPIs del mes', style: { bg: '#0f172a', text: '#f8fafc' } },
                layout: { x: 0, y: 0, w: 12, h: 1 },
            },
            {
                id: 'k1',
                type: 'kpi',
                list_id: f.monto!.list_id,
                title: 'Total',
                config: { metric: 'count' },
                layout: { x: 0, y: 1, w: 3, h: 2 },
            },
        ]);
        expect(data.h1).toEqual({});
        expect((data.k1 as { value: number }).value).toBe(5);
    });

    it('v0.1.98 — settings del dashboard persisten (página: fondo/ancho/tipografía)', async () => {
        const page = { bg: '#f1f5f9', max_width: 1100, font: 'serif' };
        await service.update(tenantId, dashId, admin, { settings: { page } } as never);
        const got = await service.get(tenantId, dashId, admin);
        expect(got.settings).toEqual({ page });
        // Round-trip por create también.
        const d2 = await service.create(tenantId, 1, {
            name: 'Con página', widgets: [], settings: { page },
        } as never);
        const got2 = await service.get(tenantId, d2.id, admin);
        expect(got2.settings).toEqual({ page });
        await service.remove(tenantId, d2.id, admin);
    });

    it('v0.1.99 — gauge evalúa como KPI y el spark trae la serie de 30 días', async () => {
        const data = await withWidgets([
            {
                id: 'g1',
                type: 'gauge',
                list_id: f.monto!.list_id,
                title: 'Meta ventas',
                config: { metric: 'sum', metric_field_id: f.monto!.id, goal: 10000 },
                layout: { x: 0, y: 0, w: 3, h: 3 },
            },
            {
                id: 'k1',
                type: 'kpi',
                list_id: f.monto!.list_id,
                title: 'Con tendencia',
                config: { metric: 'count', spark_field_id: f.fecha!.id },
                layout: { x: 3, y: 0, w: 3, h: 2 },
            },
        ]);
        // gauge = suma total (la meta es del front)
        expect((data.g1 as { value: number }).value).toBe(6600);
        const k = data.k1 as { value: number; spark?: number[] };
        expect(k.value).toBe(5);
        // spark: solo los registros de los últimos 30 días (3), un bucket por día
        expect(Array.isArray(k.spark)).toBe(true);
        expect(k.spark!.length).toBe(3);
        expect(k.spark!.reduce((s, v) => s + v, 0)).toBe(3);
    });

    it('bucketing temporal: chart_line agrupa por mes (YYYY-MM) y respeta year', async () => {
        const data = await withWidgets([
            {
                id: 'w1',
                type: 'chart_line',
                list_id: f.monto!.list_id,
                title: 'Tendencia',
                config: { metric: 'count', date_field_id: f.fecha!.id, time_bucket: 'year' },
                layout: { x: 0, y: 0, w: 6, h: 4 },
            },
        ]);
        const groups = (data.w1 as { data: Array<{ label: string; value: number }> }).data;
        // Con bucket 'year' hay a lo sumo 3 buckets (año actual, quizá el
        // anterior por los -30/-40 días, y el de hace 400 días) — nunca 5
        // labels de fecha cruda.
        expect(groups.length).toBeLessThanOrEqual(3);
        expect(groups.every((g) => /^\d{4}$/.test(g.label))).toBe(true);
        expect(groups.reduce((s, g) => s + g.value, 0)).toBe(5);
    });
});
