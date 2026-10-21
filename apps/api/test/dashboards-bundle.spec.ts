import { BadRequestException, ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AGGREGATE_OTHERS_KEY, type CreateFieldInput, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateController } from '../src/aggregate/aggregate.controller';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { DashboardsController } from '../src/dashboards/dashboards.controller';
import { DashboardsService, type DashboardViewer } from '../src/dashboards/dashboards.service';
import { RecordLayoutController } from '../src/dashboards/record-layout.controller';
import { fillTimeBuckets, isoWeekLabel, nextBucketLabel } from '../src/dashboards/time-buckets';
import { dashboards, fields, lists, records, tenants } from '../src/db/schema';
import type { Tx } from '../src/db/client';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { relativeDateRange } from '../src/records/query-builder';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/** TenantDb que cuenta las transacciones abiertas (v0.1.286, eficiencia del bundle). */
class CountingTenantDb extends TenantDb {
    count = 0;
    override withTenant<T>(tenantId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
        this.count++;
        return super.withTenant(tenantId, fn);
    }
}

/** v0.1.286 — bundle de tableros: ventanas del delta, relleno, "Otros", subtareas, filtros, eficiencia. */
describe('Dashboards — bundle (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: CountingTenantDb;
    let service: DashboardsService;
    let aggregate: AggregateService;
    let tenantId: number;
    let listId: number;
    let dashId: number;
    let f: Record<string, Field>;
    const admin: DashboardViewer = { userId: 1, role: 'admin' };

    const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const layout = { x: 0, y: 0, w: 3, h: 2 };

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new CountingTenantDb(pg.db);
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
        aggregate = new AggregateService(tenantDb, listsService, fieldsService);
        service = new DashboardsService(tenantDb, aggregate, recordsService, fieldsService);

        const [t] = await pg.db.insert(tenants).values({ slug: 'bundle', name: 'Bundle' }).returning();
        tenantId = t!.id;
        await listsService.create(tenantId, { name: 'Ventas' });
        const defs: CreateFieldInput[] = [
            { label: 'Monto', type: 'currency', slug: 'monto' },
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'abierto', label: 'Abierto' }, { value: 'cerrado', label: 'Cerrado' }] },
            },
            { label: 'Fecha', type: 'date', slug: 'fecha' },
            { label: 'Cuándo', type: 'datetime', slug: 'cuando' },
            { label: 'Responsable', type: 'user', slug: 'resp' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'ventas', d);
        listId = f.monto!.list_id;
        const key = (s: string) => `f${f[s]!.id}`;

        const seed = [
            { nombre: 'a', monto: 100, estado: 'abierto', fecha: daysAgo(1), cuando: '2026-03-04 10:00:00', resp: 1 },
            { nombre: 'b', monto: 200, estado: 'abierto', fecha: daysAgo(5), cuando: '2026-05-06 11:30:00', resp: 2 },
            { nombre: 'c', monto: 300, estado: 'cerrado', fecha: daysAgo(12), cuando: '2026-01-02 08:00:00', resp: 1 },
            { nombre: 'd', monto: 400, estado: 'cerrado', fecha: daysAgo(40), cuando: null, resp: 2 },
        ];
        let parentId = 0;
        for (const r of seed) {
            const [row] = await withTenant(pg.db, tenantId, (tx) =>
                tx
                    .insert(records)
                    .values({
                        tenantId,
                        listId,
                        createdBy: 1,
                        data: {
                            [key('nombre')]: r.nombre,
                            [key('monto')]: r.monto,
                            [key('estado')]: r.estado,
                            [key('fecha')]: r.fecha,
                            ...(r.cuando ? { [key('cuando')]: r.cuando } : {}),
                            [key('resp')]: r.resp,
                        },
                    })
                    .returning(),
            );
            if (r.nombre === 'a') parentId = row!.id;
        }
        // Una SUBTAREA de "a": la tabla no la muestra y los KPI no la cuentan.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({
                tenantId,
                listId,
                createdBy: 1,
                parentId,
                data: { [key('nombre')]: 'a-1', [key('monto')]: 50, [key('estado')]: 'abierto', [key('fecha')]: daysAgo(1) },
            }),
        );
        const dash = await service.create(tenantId, 1, { name: 'Bundle', widgets: [] } as never);
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

    const withWidgets = async (widgets: unknown[], body: Parameters<DashboardsService['widgetsData']>[3] = {}) => {
        await service.update(tenantId, dashId, admin, { widgets: widgets as never });
        return service.widgetsData(tenantId, dashId, admin, body);
    };

    it('los KPI cuentan el PRIMER nivel por defecto; `include_subtasks` suma las subtareas', async () => {
        const data = await withWidgets([
            { id: 'k1', type: 'kpi', list_id: listId, title: 'Total', config: { metric: 'count' }, layout },
            { id: 'k2', type: 'kpi', list_id: listId, title: 'Con sub', config: { metric: 'count', include_subtasks: true }, layout },
            { id: 't1', type: 'table', list_id: listId, title: 'Tabla', config: { limit: 20 }, layout },
        ]);
        expect((data.k1 as { value: number }).value).toBe(4);
        expect((data.k2 as { value: number }).value).toBe(5);
        expect((data.t1 as { rows: unknown[] }).rows).toHaveLength(4);
    });

    it('stat_delta con período: la ventana actual ES el período y la anterior la del mismo largo', async () => {
        // Global custom: últimos 10 días (a y b) vs los 10 anteriores (c).
        const custom = `custom:${daysAgo(9)}:${daysAgo(0)}`;
        const data = await withWidgets(
            [{ id: 'd1', type: 'stat_delta', list_id: listId, title: 'Delta', config: { metric: 'count', date_field_id: f.fecha!.id, period_days: 30 }, layout }],
            { period_preset: custom },
        );
        const d = data.d1 as { value: number; previous: number; delta_pct: number; period_days: number };
        expect(d.value).toBe(2);
        expect(d.previous).toBe(1);
        expect(d.delta_pct).toBe(100);
        expect(d.period_days).toBe(10);

        // El período PROPIO del widget hace lo mismo (sin AND con las ventanas de 30 días).
        const own = await withWidgets([
            {
                id: 'd1',
                type: 'stat_delta',
                list_id: listId,
                title: 'Delta',
                config: { metric: 'sum', metric_field_id: f.monto!.id, date_field_id: f.fecha!.id, period_days: 30, period: { field_id: f.fecha!.id, preset: 'custom', from: daysAgo(9), to: daysAgo(0) } },
                layout,
            },
        ]);
        const o = own.d1 as { value: number; previous: number };
        expect(o.value).toBe(300);
        expect(o.previous).toBe(300);
    });

    it('las series temporales rellenan con 0 los buckets vacíos', async () => {
        const data = await withWidgets([
            {
                id: 'l1',
                type: 'chart_line',
                list_id: listId,
                title: 'Por día',
                config: { metric: 'count', date_field_id: f.fecha!.id, time_bucket: 'day', period: { field_id: f.fecha!.id, preset: 'last_7_days' } },
                layout,
            },
        ]);
        const rows = (data.l1 as { data: Array<{ label: string; value: number }> }).data;
        expect(rows.map((r) => r.label)).toEqual([daysAgo(5), daysAgo(4), daysAgo(3), daysAgo(2), daysAgo(1)]);
        expect(rows.map((r) => r.value)).toEqual([1, 0, 0, 0, 1]);
    });

    it('un gráfico por categoría trae el top N y el resto en "Otros" (también para promedios)', async () => {
        const data = await withWidgets([
            { id: 'b1', type: 'chart_bar', list_id: listId, title: 'Top', config: { metric: 'sum', metric_field_id: f.monto!.id, group_by_field_id: f.nombre!.id, top_n: 2 }, layout },
            { id: 'b2', type: 'chart_bar', list_id: listId, title: 'Prom', config: { metric: 'avg', metric_field_id: f.monto!.id, group_by_field_id: f.nombre!.id, top_n: 1 }, layout },
        ]);
        const top = (data.b1 as { data: Array<{ label: string; value: number; others?: number }> }).data;
        expect(top.map((r) => r.label)).toEqual(['d', 'c', AGGREGATE_OTHERS_KEY]);
        expect(top[2]).toMatchObject({ value: 300, others: 2 });
        const avg = (data.b2 as { data: Array<{ label: string; value: number; others?: number }> }).data;
        // Otros = promedio de los REGISTROS de a, b y c (100, 200, 300), no de los parciales.
        expect(avg[1]).toMatchObject({ label: AGGREGATE_OTHERS_KEY, value: 200, others: 3 });

        // El endpoint corta en MAX_GROUPS por clave (orden alfabético intacto).
        const r = await aggregate.run(tenantId, String(listId), { metric: 'count', group_by_field_id: f.nombre!.id }, { top: { limit: 3, byValue: false } });
        // Sin `rootsOnly` (motor interno) la subtarea "a-1" también cuenta.
        expect(r.groups!.map((g) => g.group)).toEqual(['a', 'a-1', 'b', AGGREGATE_OTHERS_KEY]);
        expect(r.groups![3]).toMatchObject({ value: 2, others: 2 });
    });

    it('filtros del TABLERO: por opción y "Yo" en un campo persona', async () => {
        const widgets = [{ id: 'k1', type: 'kpi', list_id: listId, title: 'Total', config: { metric: 'count' }, layout }];
        const abiertos = await withWidgets(widgets, { filters: [{ field_id: f.estado!.id, value: 'abierto' }] });
        expect((abiertos.k1 as { value: number }).value).toBe(2);
        const mios = await withWidgets(widgets, { filters: [{ field_id: f.resp!.id, value: 'me' }] });
        expect((mios.k1 as { value: number }).value).toBe(2);
        // Un campo que no es de la lista se ignora.
        const ajeno = await withWidgets(widgets, { filters: [{ field_id: 999_999, value: 'x' }] });
        expect((ajeno.k1 as { value: number }).value).toBe(4);
    });

    it('min/max de una fecha-hora sale como instante ISO; un filtro con raíz suelta funciona', async () => {
        const data = await withWidgets([
            { id: 'm1', type: 'kpi', list_id: listId, title: 'Último', config: { metric: 'max', metric_field_id: f.cuando!.id }, layout },
            { id: 'm2', type: 'kpi', list_id: listId, title: 'Primero', config: { metric: 'min', metric_field_id: f.fecha!.id }, layout },
            {
                id: 'c1',
                type: 'kpi',
                list_id: listId,
                title: 'Cerrados',
                config: { metric: 'count', filter_tree: { type: 'condition', field_id: f.estado!.id, op: 'eq', value: 'cerrado' } },
                layout,
            },
        ]);
        expect((data.m1 as { value: string }).value).toBe('2026-05-06T11:30:00.000Z');
        expect((data.m2 as { value: string }).value).toBe(daysAgo(40));
        expect((data.c1 as { value: number }).value).toBe(2);
    });

    it('la tabla sin columnas elegidas empieza por el campo TÍTULO', async () => {
        const data = await withWidgets([{ id: 't1', type: 'table', list_id: listId, title: 'T', config: {}, layout }]);
        const cols = (data.t1 as { columns: Array<{ slug: string }> }).columns;
        // Monto es el primer campo, pero el título (primer texto) va primero.
        expect(cols[0]!.slug).toBe('nombre');
        expect(cols.map((c) => c.slug)).toContain('monto');
    });

    it('eficiencia: un tablero de 9 widgets sobre una lista abre ≤ 4 transacciones', async () => {
        const ws = [
            { id: 'k1', type: 'kpi', list_id: listId, title: 'A', config: { metric: 'count' }, layout },
            { id: 'k2', type: 'kpi', list_id: listId, title: 'B', config: { metric: 'sum', metric_field_id: f.monto!.id, spark_field_id: f.fecha!.id }, layout },
            { id: 'k3', type: 'gauge', list_id: listId, title: 'C', config: { metric: 'avg', metric_field_id: f.monto!.id, goal: 10 }, layout },
            { id: 'd1', type: 'stat_delta', list_id: listId, title: 'D', config: { metric: 'count', date_field_id: f.fecha!.id }, layout },
            { id: 'b1', type: 'chart_bar', list_id: listId, title: 'E', config: { metric: 'count', group_by_field_id: f.estado!.id }, layout },
            { id: 'p1', type: 'chart_pie', list_id: listId, title: 'F', config: { metric: 'count', group_by_field_id: f.resp!.id }, layout },
            { id: 'l1', type: 'chart_line', list_id: listId, title: 'G', config: { metric: 'count', date_field_id: f.fecha!.id }, layout },
            { id: 't1', type: 'table', list_id: listId, title: 'H', config: { limit: 5 }, layout },
            { id: 'x1', type: 'kpi', list_id: listId, title: 'Roto', config: { metric: 'sum', metric_field_id: f.nombre!.id }, layout },
        ];
        await service.update(tenantId, dashId, admin, { widgets: ws as never });
        tenantDb.count = 0;
        const data = await service.widgetsData(tenantId, dashId, admin, {});
        // get del tablero (1) + contexto de la lista (1) + 2 tandas en paralelo.
        expect(tenantDb.count).toBeLessThanOrEqual(4);
        expect(Object.keys(data)).toEqual(ws.map((w) => w.id));
        // El widget roto trae SU error; los demás, sus datos.
        expect((data.x1 as { __error?: string }).__error).toMatch(/num/);
        expect((data.k1 as { value: number }).value).toBe(4);
        expect((data.k2 as { spark: number[] }).spark).toHaveLength(30);
    });

    it('vista previa de un widget sin guardar', async () => {
        const r = await service.previewWidget(tenantId, dashId, admin, {
            id: 'draft',
            type: 'kpi',
            list_id: listId,
            title: 'Borrador',
            config: { metric: 'sum', metric_field_id: f.monto!.id },
            layout,
        } as never, { filters: [{ field_id: f.estado!.id, value: 'cerrado' }] });
        expect((r as { value: number }).value).toBe(700);
    });

    it('reordenar tableros: posición por índice, desempate por id, ids inválidos rechazados', async () => {
        const a = await service.create(tenantId, 1, { name: 'A' } as never);
        const b = await service.create(tenantId, 1, { name: 'B' } as never);
        const before = (await service.list(tenantId, admin)).map((d) => d.id);
        // Todas en posición 0: orden estable por id.
        expect(before).toEqual([...before].sort((x, y) => x - y));
        const after = await service.reorder(tenantId, admin, [b.id, a.id, dashId]);
        expect(after.map((d) => d.id)).toEqual([b.id, a.id, dashId]);
        await expect(service.reorder(tenantId, admin, [a.id, a.id])).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.reorder(tenantId, admin, [a.id, 9_999_999])).rejects.toBeInstanceOf(NotFoundException);
        await service.remove(tenantId, a.id, admin);
        await service.remove(tenantId, b.id, admin);
    });
});

describe('Dashboards — piezas puras', () => {
    it('relativeDateRange: presets nuevos (próximos días, trimestres, de hoy en adelante)', () => {
        const clock = { now: new Date('2026-08-15T12:00:00Z'), timeZone: 'UTC' };
        expect(relativeDateRange('next_7_days', clock)).toEqual({ from: '2026-08-15', to: '2026-08-21' });
        expect(relativeDateRange('this_quarter', clock)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
        expect(relativeDateRange('last_quarter', clock)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
        expect(relativeDateRange('last_quarter', { ...clock, now: new Date('2026-02-01T12:00:00Z') })).toEqual({ from: '2025-10-01', to: '2025-12-31' });
        expect(relativeDateRange('last_90_days', clock)).toEqual({ from: '2026-05-18', to: '2026-08-15' });
        expect(relativeDateRange('from_today', clock)).toEqual({ from: '2026-08-15', to: '2999-12-31' });
        expect(relativeDateRange({ from: '2026-01-10', to: '2026-01-01' }, clock)).toEqual({ from: '2026-01-01', to: '2026-01-10' });
        expect(relativeDateRange('nope', clock)).toBeNull();
    });

    it('buckets temporales: siguiente label y relleno', () => {
        expect(nextBucketLabel('2026-12', 'month')).toBe('2027-01');
        expect(nextBucketLabel('2026-Q4', 'quarter')).toBe('2027-Q1');
        expect(nextBucketLabel('2026-W52', 'week')).toBe('2026-W53');
        expect(nextBucketLabel('2026-W53', 'week')).toBe('2027-W01');
        expect(isoWeekLabel('2027-01-04')).toBe('2027-W01');
        expect(nextBucketLabel('(sin valor)', 'day')).toBeNull();
        const filled = fillTimeBuckets(
            [{ label: '2026-01', value: 2 }, { label: '(sin valor)', value: 1 }, { label: '2026-04', value: 5 }],
            'month',
        );
        expect(filled).toEqual([
            { label: '2026-01', value: 2 },
            { label: '2026-02', value: 0 },
            { label: '2026-03', value: 0 },
            { label: '2026-04', value: 5 },
            { label: '(sin valor)', value: 1 },
        ]);
    });

    it('ADR-S09: las lecturas por POST valen en solo-lectura; las mutaciones no', async () => {
        const guard = new TenantGuard(
            {
                withUser: async () => ({
                    tenantId: 7,
                    role: 'admin',
                    tenantSlug: 'x',
                    status: 'past_due',
                    archivedAt: null,
                    subscriptionEndsAt: null,
                    paidUntil: null,
                }),
            } as never,
            new Reflector(),
        );
        const ctxFor = (cls: object, handler: (...args: never[]) => unknown, method = 'POST'): ExecutionContext =>
            ({
                switchToHttp: () => ({ getRequest: () => ({ authUserId: 1, headers: { 'x-tenant-id': '7' }, method }) }),
                getHandler: () => handler,
                getClass: () => cls,
            }) as unknown as ExecutionContext;
        await expect(guard.canActivate(ctxFor(DashboardsController, DashboardsController.prototype.widgetsData))).resolves.toBe(true);
        await expect(guard.canActivate(ctxFor(DashboardsController, DashboardsController.prototype.preview))).resolves.toBe(true);
        await expect(guard.canActivate(ctxFor(AggregateController, AggregateController.prototype.run))).resolves.toBe(true);
        await expect(guard.canActivate(ctxFor(RecordLayoutController, RecordLayoutController.prototype.data))).resolves.toBe(true);
        await expect(guard.canActivate(ctxFor(DashboardsController, DashboardsController.prototype.create))).rejects.toBeInstanceOf(ForbiddenException);
    });
});
