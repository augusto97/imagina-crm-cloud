import type { Field } from '@imagina-base/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { RecordLayoutDataService } from '../src/dashboards/record-layout-data.service';
import { tenants, users } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

/**
 * v0.1.230 — datos de los bloques de la ficha (plantillas v3): gráficos y
 * tablas acotados a los registros VINCULADOS al registro abierto, en los dos
 * sentidos de la relación, con el ACL de quien mira y cada bloque aislado.
 *
 * Escenario: Clientes ← Facturas.cliente (hacia adentro) y
 * Clientes.contactos → Contactos (hacia afuera).
 */
describe('datos de la ficha v3 (Postgres real)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let service: RecordLayoutDataService;
    let tenantId: number;
    let f: Record<string, Field>;
    let c1: number;
    let c2: number;
    let contact1: number;

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
        const aggregate = new AggregateService(tenantDb, lists_, fields_);
        const dashboards = new DashboardsService(tenantDb, aggregate, recs, fields_);
        service = new RecordLayoutDataService(tenantDb, lists_, fields_, recs, dashboards);

        const [t] = await pg.db.insert(tenants).values({ slug: 'lay', name: 'Layout' }).returning();
        tenantId = t!.id;
        await pg.db.insert(users).values({ email: 'a@lay.test', passwordHash: 'x', name: 'Ana' });

        await lists_.create(tenantId, { name: 'Clientes' });
        await lists_.create(tenantId, { name: 'Facturas' });
        await lists_.create(tenantId, { name: 'Contactos' });
        await lists_.create(tenantId, { name: 'Otra' });
        const clientes = await lists_.get(tenantId, 'clientes');
        const contactos = await lists_.get(tenantId, 'contactos');
        const otra = await lists_.get(tenantId, 'otra');
        f = {};
        const mk = async (list: string, def: Parameters<FieldsService['create']>[2]): Promise<void> => {
            f[`${list}.${def.slug}`] = await fields_.create(tenantId, list, def);
        };
        await mk('clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        await mk('contactos', { label: 'Nombre', type: 'text', slug: 'nombre' });
        await mk('clientes', { label: 'Contactos', type: 'relation', slug: 'contactos', config: { target_list_id: contactos.id } });
        await mk('facturas', { label: 'Número', type: 'text', slug: 'numero' });
        await mk('facturas', { label: 'Total', type: 'currency', slug: 'total' });
        await mk('facturas', {
            label: 'Estado', type: 'select', slug: 'estado',
            config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] },
        });
        await mk('facturas', { label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientes.id } });
        // Una relación que NO toca Clientes.
        await mk('facturas', { label: 'Otra', type: 'relation', slug: 'otra', config: { target_list_id: otra.id } });

        const k = (key: string): string => `f${f[key]!.id}`;
        const ct1 = await recs.create(tenantId, admin, 'contactos', { data: { [k('contactos.nombre')]: 'Ana' } });
        const ct2 = await recs.create(tenantId, admin, 'contactos', { data: { [k('contactos.nombre')]: 'Beto' } });
        await recs.create(tenantId, admin, 'contactos', { data: { [k('contactos.nombre')]: 'Carla (de nadie)' } });
        contact1 = ct1.id;
        c1 = (await recs.create(tenantId, admin, 'clientes', {
            data: { [k('clientes.nombre')]: 'Acme', [k('clientes.contactos')]: [ct1.id, ct2.id] },
        })).id;
        c2 = (await recs.create(tenantId, admin, 'clientes', { data: { [k('clientes.nombre')]: 'Globex' } })).id;
        const inv = (n: string, total: number, estado: string, cliente: number) =>
            recs.create(tenantId, admin, 'facturas', {
                data: { [k('facturas.numero')]: n, [k('facturas.total')]: total, [k('facturas.estado')]: estado, [k('facturas.cliente')]: [cliente] },
            });
        await inv('F-1', 100, 'pagada', c1);
        await inv('F-2', 250, 'pendiente', c1);
        await inv('F-3', 50, 'pendiente', c1);
        await inv('F-4', 900, 'pagada', c2);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    const viewer = { userId: 1, role: 'admin' };
    const facturasDe = { kind: 'related', field_id: 0 } as { kind: 'related'; field_id: number };

    it('gráficos hacia adentro: sólo las facturas de ESTE cliente', async () => {
        const src = { ...facturasDe, field_id: f['facturas.cliente']!.id };
        const data = await service.data(tenantId, viewer, 'clientes', c1, {
            blocks: [
                { id: 'count', type: 'chart', config: { source: src, kind: 'kpi', metric: 'count' } },
                { id: 'sum', type: 'chart', config: { source: src, kind: 'kpi', metric: 'sum', metric_field_id: f['facturas.total']!.id } },
                { id: 'pie', type: 'chart', config: { source: src, kind: 'pie', metric: 'sum', metric_field_id: f['facturas.total']!.id, group_by_field_id: f['facturas.estado']!.id } },
                // Plantilla convertida de la v2: agrupación por slug de la otra lista.
                { id: 'legacy', type: 'chart', config: { source: src, kind: 'bar', metric: 'count', group_by_field_slug: 'estado' } },
            ],
        });
        expect(data.count).toMatchObject({ value: 3 });
        expect(data.sum).toMatchObject({ value: 400 });
        const pie = Object.fromEntries((data.pie as { data: Array<{ label: string; value: number }> }).data.map((d) => [d.label, d.value]));
        expect(pie).toEqual({ pagada: 100, pendiente: 300 });
        expect((data.legacy as { data: unknown[] }).data).toHaveLength(2);
        // El otro cliente ve lo suyo.
        const other = await service.data(tenantId, viewer, 'clientes', c2, {
            blocks: [{ id: 'sum', type: 'chart', config: { source: src, kind: 'kpi', metric: 'sum', metric_field_id: f['facturas.total']!.id } }],
        });
        expect(other.sum).toMatchObject({ value: 900 });
    });

    it('tabla de vinculados en los dos sentidos, con total y orden', async () => {
        const data = await service.data(tenantId, viewer, 'clientes', c1, {
            blocks: [
                {
                    id: 'facturas',
                    type: 'related',
                    config: {
                        source: { kind: 'related', field_id: f['facturas.cliente']!.id },
                        view: 'table',
                        sort_field_id: f['facturas.total']!.id,
                        sort_dir: 'desc',
                        limit: 2,
                    },
                },
                { id: 'contactos', type: 'related', config: { source: { kind: 'related', field_id: f['clientes.contactos']!.id } } },
            ],
        });
        const facturas = data.facturas as { list: { slug: string }; total: number; rows: Array<{ data: Record<string, unknown> }>; fields: Field[] };
        expect(facturas.list.slug).toBe('facturas');
        expect(facturas.total).toBe(3);
        expect(facturas.rows.map((r) => r.data[`f${f['facturas.numero']!.id}`])).toEqual(['F-2', 'F-1']);
        expect(facturas.fields.map((x) => x.slug)).toContain('total');
        const contactos = data.contactos as { total: number; rows: Array<{ id: number }> };
        expect(contactos.total).toBe(2);
        expect(contactos.rows.map((r) => r.id)).toContain(contact1);
    });

    it('cada bloque aislado: fuente inválida o config rota no tumban al resto', async () => {
        const data = await service.data(tenantId, viewer, 'clientes', c1, {
            blocks: [
                { id: 'ajena', type: 'chart', config: { source: { kind: 'related', field_id: f['facturas.otra']!.id }, kind: 'kpi' } },
                { id: 'no_rel', type: 'chart', config: { source: { kind: 'related', field_id: f['clientes.nombre']!.id }, kind: 'kpi' } },
                { id: 'rota', type: 'chart', config: { kind: 'kpi' } },
                { id: 'record', type: 'related', config: { source: { kind: 'record' } } },
                { id: 'ok', type: 'chart', config: { source: { kind: 'related', field_id: f['facturas.cliente']!.id }, kind: 'kpi' } },
            ],
        });
        expect(data.ajena).toEqual({ __error: expect.stringMatching(/no está vinculada/) });
        expect(data.no_rel).toEqual({ __error: expect.stringMatching(/relación/) });
        expect(data.rota).toEqual({ __error: expect.any(String) });
        expect(data.record).toEqual({ __error: expect.any(String) });
        expect(data.ok).toMatchObject({ value: 3 });
    });

    it('el ACL de quien mira: campos ocultos y registro base fuera de su alcance', async () => {
        await lists_.updatePermissions(tenantId, 'facturas', {
            permissions: { agent: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['total'] } },
        });
        // Por defecto el agente ve sólo lo suyo; acá ve todos los clientes.
        await lists_.updatePermissions(tenantId, 'clientes', {
            permissions: { agent: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });
        const agent = { userId: 2, role: 'agent' };
        const src = { kind: 'related', field_id: f['facturas.cliente']!.id };
        const data = await service.data(tenantId, agent, 'clientes', c1, {
            blocks: [
                { id: 'sum', type: 'chart', config: { source: src, kind: 'kpi', metric: 'sum', metric_field_id: f['facturas.total']!.id } },
                { id: 'rows', type: 'related', config: { source: src } },
            ],
        });
        expect(data.sum).toHaveProperty('__error');
        const rows = data.rows as { fields: Field[]; rows: Array<{ data: Record<string, unknown> }> };
        expect(rows.fields.map((x) => x.slug)).not.toContain('total');
        expect(rows.rows.every((r) => !(`f${f['facturas.total']!.id}` in r.data))).toBe(true);
        await lists_.updatePermissions(tenantId, 'facturas', { permissions: {} });

        // Registro base que el rol no ve → 404, como abrir la ficha.
        await lists_.updatePermissions(tenantId, 'clientes', {
            permissions: { agent: { view: 'own', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });
        await expect(service.data(tenantId, agent, 'clientes', c1, { blocks: [] })).rejects.toThrow();
        await lists_.updatePermissions(tenantId, 'clientes', { permissions: {} });
    });

    it('la lista rechaza un diseño v3 inválido y guarda uno válido', async () => {
        const good = {
            v: 3,
            pages: [{ id: 'p', name: 'Resumen', sections: [{ id: 's', columns: [8, 4], blocks: [[{ id: 'd', type: 'description' }], []] }] }],
        };
        const saved = await lists_.update(tenantId, 'clientes', { settings: { record_layout_v3: good } });
        expect((saved.settings.record_layout_v3 as { v: number }).v).toBe(3);
        const bad = { ...good, pages: [{ ...good.pages[0]!, sections: [{ id: 's', columns: [8, 3], blocks: [[], []] }] }] };
        await expect(lists_.update(tenantId, 'clientes', { settings: { record_layout_v3: bad } })).rejects.toThrow(/sumar 12/);
    });
});
