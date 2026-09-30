import { evaluateComputed, type CreateFieldInput, type Field } from '@imagina-base/shared';
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

/**
 * v0.1.229 — campos `computed` numéricos en agregados, filtros y orden, y un
 * widget roto que no tumba al resto del tablero (reporte del usuario: el
 * tablero de inventario sumaba «Valor en inventario = stock × costo» y TODOS
 * los widgets salían en error).
 */
describe('computed numéricos en agregados + widgets aislados (Postgres real)', () => {
    let pg: TestPg;
    let service: DashboardsService;
    let aggregate: AggregateService;
    let recs: RecordsService;
    let lists_: ListsService;
    let tenantId: number;
    let dashId: number;
    let listId: number;
    let f: Record<string, Field>;
    const admin: DashboardViewer = { userId: 1, role: 'admin' };

    // Una fila SIN costo: product ignora la entrada vacía (valor = stock) y
    // subtract la propaga (margen vacío) — misma semántica que el evaluador JS.
    const seed = [
        { nombre: 'Faja A', proveedor: 'Norte', stock: 10, costo: 1000, precio: 1500 },
        { nombre: 'Faja B', proveedor: 'Norte', stock: 3, costo: 2000, precio: 1800 },
        { nombre: 'Faja C', proveedor: 'Sur', stock: 0, costo: 500, precio: 900 },
        { nombre: 'Faja D', proveedor: 'Sur', stock: 7, costo: null, precio: 1200 },
    ];

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        const fieldsService = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        aggregate = new AggregateService(tenantDb, lists_, fieldsService);
        service = new DashboardsService(tenantDb, aggregate, recs, fieldsService);

        const [t] = await pg.db.insert(tenants).values({ slug: 'cagg', name: 'CAGG' }).returning();
        tenantId = t!.id;
        await lists_.create(tenantId, { name: 'Inventario' });

        const base: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Proveedor', type: 'text', slug: 'proveedor' },
            { label: 'Stock', type: 'number', slug: 'stock' },
            { label: 'Costo', type: 'currency', slug: 'costo' },
            { label: 'Precio', type: 'currency', slug: 'precio' },
        ];
        f = {};
        for (const d of base) f[d.slug!] = await fieldsService.create(tenantId, 'inventario', d);
        const computed = async (slug: string, operation: string, inputs: string[]): Promise<void> => {
            f[slug] = await fieldsService.create(tenantId, 'inventario', {
                label: slug,
                type: 'computed',
                slug,
                config: { operation, inputs: inputs.map((s) => f[s]!.id) },
            } as CreateFieldInput);
        };
        await computed('valor', 'product', ['stock', 'costo']);
        await computed('margen', 'subtract', ['precio', 'costo']);
        // Encadenado: computed sobre computed.
        await computed('valor_doble', 'sum', ['valor', 'valor']);
        await computed('etiqueta', 'concat', ['nombre', 'proveedor']);
        listId = f.stock!.list_id;

        const key = (s: string): string => `f${f[s]!.id}`;
        for (const r of seed) {
            const data: Record<string, unknown> = {
                [key('nombre')]: r.nombre,
                [key('proveedor')]: r.proveedor,
                [key('stock')]: r.stock,
                [key('precio')]: r.precio,
            };
            if (r.costo !== null) data[key('costo')] = r.costo;
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(records).values({ tenantId, listId, createdBy: 1, data }),
            );
        }
        const dash = await service.create(tenantId, 1, { name: 'Inventario', widgets: [] } as never);
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

    /** Lo que da el evaluador JS de shared, fila por fila (la fuente de verdad). */
    const jsValues = (slug: string): Array<number | null> =>
        seed.map((r) => {
            const values: Record<number, unknown> = {
                [f.nombre!.id]: r.nombre,
                [f.proveedor!.id]: r.proveedor,
                [f.stock!.id]: r.stock,
                [f.costo!.id]: r.costo ?? undefined,
                [f.precio!.id]: r.precio,
            };
            const v = evaluateComputed(f[slug]!, Object.values(f), (id) => values[id]);
            return typeof v === 'number' ? v : null;
        });
    const jsSum = (slug: string): number => jsValues(slug).reduce<number>((a, v) => a + (v ?? 0), 0);

    it('suma, promedio, mínimo y máximo de un computed coinciden con el evaluador JS', async () => {
        // valor = 10×1000 + 3×2000 + 0×500 + 7 (sin costo: product ignora el vacío)
        expect(jsSum('valor')).toBe(16007);
        const sum = await aggregate.run(tenantId, 'inventario', { metric: 'sum', field_id: f.valor!.id });
        expect(sum.value).toBe(jsSum('valor'));
        // Encadenado computed → computed.
        const doble = await aggregate.run(tenantId, 'inventario', { metric: 'sum', field_id: f.valor_doble!.id });
        expect(doble.value).toBe(jsSum('valor_doble'));
        // subtract propaga el vacío: la fila sin costo no entra al promedio.
        const margenes = jsValues('margen').filter((v): v is number => v !== null);
        const avg = await aggregate.run(tenantId, 'inventario', { metric: 'avg', field_id: f.margen!.id });
        expect(Number(avg.value)).toBeCloseTo(margenes.reduce((a, b) => a + b, 0) / margenes.length, 6);
        const min = await aggregate.run(tenantId, 'inventario', { metric: 'min', field_id: f.margen!.id });
        expect(min.value).toBe(Math.min(...margenes));
    });

    it('filtra y agrupa por un computed', async () => {
        // "margen negativo" → sólo Faja B (1800 − 2000).
        const neg = await aggregate.run(tenantId, 'inventario', {
            metric: 'count',
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.margen!.id, op: 'lt', value: 0 }] },
        });
        expect(neg.value).toBe(1);
        // Suma del computed agrupada por proveedor (el widget "valor por proveedor").
        const byProv = await aggregate.run(tenantId, 'inventario', {
            metric: 'sum',
            field_id: f.valor!.id,
            group_by_field_id: f.proveedor!.id,
        });
        const map = Object.fromEntries((byProv.groups ?? []).map((g) => [g.group, g.value]));
        expect(map).toEqual({ Norte: 16000, Sur: 7 });
    });

    it('el listado ordena por un computed', async () => {
        const page = await recs.list(tenantId, { userId: 1, role: 'admin' }, 'inventario', {
            limit: 50,
            sort_dir: 'asc',
            sort: `field_${f.valor!.id}:desc`,
        });
        expect(page.data.map((r) => r.data[`f${f.nombre!.id}`])).toEqual(['Faja A', 'Faja B', 'Faja D', 'Faja C']);
    });

    it('un computed que no es numérico sigue sin sumarse (motivo claro)', async () => {
        await expect(
            aggregate.run(tenantId, 'inventario', { metric: 'sum', field_id: f.etiqueta!.id }),
        ).rejects.toThrow(/numéricos/);
    });

    it('con una ENTRADA oculta para el rol, el computed no se agrega (no es oráculo)', async () => {
        await lists_.updatePermissions(tenantId, 'inventario', {
            permissions: { agent: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['costo'] } },
        });
        const agent = { role: 'agent' as const, userId: 2 };
        await expect(
            aggregate.run(tenantId, 'inventario', { metric: 'sum', field_id: f.valor!.id }, { viewer: agent }),
        ).rejects.toThrow(/numéricos/);
        // Y filtrar por él se descarta (no reduce el conteo).
        const all = await aggregate.run(tenantId, 'inventario', {
            metric: 'count',
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.margen!.id, op: 'lt', value: 0 }] },
        }, { viewer: agent });
        expect(all.value).toBe(4);
        await lists_.updatePermissions(tenantId, 'inventario', { permissions: {} });
    });

    it('el bundle del tablero aísla el error: un widget roto no tumba a los demás', async () => {
        const w = (id: string, type: string, config: Record<string, unknown>) => ({
            id, type, list_id: listId, title: id, config, layout: { x: 0, y: 0, w: 3, h: 2 },
        });
        await service.update(tenantId, dashId, admin, {
            widgets: [
                w('valor', 'kpi', { metric: 'sum', metric_field_id: f.valor!.id }),
                w('roto', 'kpi', { metric: 'sum', metric_field_id: f.etiqueta!.id }),
                w('por_prov', 'chart_bar', { metric: 'sum', metric_field_id: f.valor!.id, group_by_field_id: f.proveedor!.id }),
            ] as never,
        });
        const data = await service.widgetsData(tenantId, dashId, admin);
        expect(data.valor).toMatchObject({ value: 16007 });
        expect(data.roto).toEqual({ __error: expect.stringMatching(/numéricos/) });
        expect((data.por_prov as { data: unknown[] }).data).toHaveLength(2);
    });
});
