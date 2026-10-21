import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService, groupKeyExpr } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { orderBuckets, RecordsGroupedService } from '../src/records/records-grouped.service';
import { datetimeFilterRange } from '../src/records/query-builder';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import type { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

/**
 * v0.1.286 — búsqueda sin acentos y por palabras, pie con la búsqueda, vista
 * agrupada en tres consultas (orden por campo, grupos en el orden del
 * catálogo) y filtros de fecha y hora en la zona de la empresa.
 */
describe('Búsqueda, orden y vista agrupada (v0.1.286)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let agg: AggregateService;
    let grouped: RecordsGroupedService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let tenantId: number;
    let ana: number;
    let zoe: number;
    const f: Record<string, number> = {};
    const key = (slug: string): string => `f${f[slug]}`;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        // La empresa trabaja en Bogotá (UTC-5): un filtro sin zona se lee ahí.
        const tz = { orUtc: async () => 'America/Bogota' } as unknown as TenantTimeZones;
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            tz,
        );
        agg = new AggregateService(tenantDb, lists_, fields_, tz);
        grouped = new RecordsGroupedService(recs, agg, lists_, fields_);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u1] = await pg.db.insert(users).values({ email: 'zoe@t.local', name: 'Zoe', passwordHash: 'x' }).returning();
        const [u2] = await pg.db.insert(users).values({ email: 'ana@t.local', name: 'Ana', passwordHash: 'x' }).returning();
        zoe = u1!.id;
        ana = u2!.id;
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
        await lists_.create(tenantId, { name: 'Clientes' });
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            const created = await fields_.create(tenantId, 'clientes', { label: slug, slug, type, ...(config ? { config } : {}) } as never);
            f[slug] = created.id;
        };
        await mk('nombre', 'text');
        await mk('telefono', 'phone');
        // Valores internos en orden alfabético DISTINTO al del catálogo.
        await mk('estado', 'select', {
            options: [
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'en_curso', label: 'En curso' },
                { value: 'hecho', label: 'Hecho' },
            ],
        });
        await mk('monto', 'currency');
        await mk('cuando', 'datetime');
        await mk('responsable', 'user');
    });

    const create = (data: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [slug, v] of Object.entries(data)) out[key(slug)] = v;
        return recs.create(tenantId, admin, 'clientes', { data: out });
    };
    const search = async (q: string) =>
        (await recs.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc', search: q })).data.map((r) => r.data[key('nombre')]);

    it('la búsqueda ignora acentos y mayúsculas y exige TODAS las palabras', async () => {
        await create({ nombre: 'Álvaro Pérez', estado: 'pendiente', monto: 100 });
        await create({ nombre: 'alvaro gómez', estado: 'hecho', monto: 50 });
        await create({ nombre: 'Pedro Muñoz', telefono: '+573001112233', estado: 'hecho', monto: 7 });

        expect((await search('alvaro')).sort()).toEqual(['alvaro gómez', 'Álvaro Pérez']);
        expect(await search('ÁLVARO perez')).toEqual(['Álvaro Pérez']);
        // El orden de las palabras no importa; cada una en cualquier lugar.
        expect(await search('perez alvaro')).toEqual(['Álvaro Pérez']);
        expect(await search('munoz')).toEqual(['Pedro Muñoz']);
        expect(await search('alvaro medellin')).toEqual([]);
        // Teléfono: con o sin separadores.
        expect(await search('300-111-2233')).toEqual(['Pedro Muñoz']);
        expect(await search('3001112233')).toEqual(['Pedro Muñoz']);
        expect(await search('(300) 111-2233')).toEqual(['Pedro Muñoz']);
        // Un código con signos es UNA palabra (no «p» y «1» sueltas).
        expect(await search('pérez-x')).toEqual([]);
        // Sin letras ni números: la cadena tal cual (no revienta).
        expect(await search('%%')).toEqual([]);

        // El PIE suma lo que la tabla muestra: con la búsqueda activa.
        const footer = await agg.footer(tenantId, 'clientes', { fieldIds: [f.monto!], search: 'alvaro', viewer: admin });
        expect(footer.totals.monto?.sum).toBe(150);
        expect(footer.totals.monto?.count).toBe(2);
    });

    it('ordena una selección por su catálogo y una persona por su nombre', async () => {
        await create({ nombre: 'A', estado: 'hecho', responsable: zoe });
        await create({ nombre: 'B', estado: 'pendiente', responsable: ana });
        await create({ nombre: 'C', estado: 'en_curso' });
        const byEstado = await recs.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc', sort: `field_${f.estado}:asc` });
        expect(byEstado.data.map((r) => r.data[key('estado')])).toEqual(['pendiente', 'en_curso', 'hecho']);
        const byUser = await recs.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc', sort: `field_${f.responsable}:asc` });
        // Ana antes que Zoe (por nombre, no por id); sin asignar al final.
        expect(byUser.data.map((r) => r.data[key('nombre')])).toEqual(['B', 'A', 'C']);
    });

    it('vista agrupada: grupos en el orden del catálogo, filas ordenadas y pie por grupo — en pocas consultas', async () => {
        await create({ nombre: 'h1', estado: 'hecho', monto: 10 });
        await create({ nombre: 'h2', estado: 'hecho', monto: 30 });
        await create({ nombre: 'p1', estado: 'pendiente', monto: 5 });
        await create({ nombre: 'p2', estado: 'pendiente', monto: 20 });
        await create({ nombre: 'p3', estado: 'pendiente', monto: 15 });
        await create({ nombre: 'n1' });

        type Bundle = {
            buckets: Array<{ value: string | null; count: number }>;
            expanded: Record<string, { records: { data: Array<{ fields: Record<string, unknown> }>; meta: { total: number } }; aggregates?: { totals: Record<string, { sum?: number }> } }>;
        };
        const bundle = (await grouped.groupedBundle(tenantId, admin, 'clientes', {
            groupBy: f.estado!,
            expanded: [],
            expandAll: true,
            collapsed: [],
            perPage: 2,
            sort: `field_${f.monto}:desc`,
            aggregateFieldIds: [f.monto!],
        })) as Bundle;
        // El catálogo manda (antes: en_curso/hecho/pendiente, por el valor interno).
        expect(bundle.buckets.map((b) => b.value)).toEqual(['pendiente', 'hecho', null]);
        // Filas por monto descendente, cortadas en `perPage` por grupo.
        expect(bundle.expanded.pendiente?.records.data.map((r) => r.fields.nombre)).toEqual(['p2', 'p3']);
        expect(bundle.expanded.pendiente?.records.meta.total).toBe(3);
        expect(bundle.expanded.hecho?.records.data.map((r) => r.fields.nombre)).toEqual(['h2', 'h1']);
        expect(bundle.expanded.__null__?.records.data.map((r) => r.fields.nombre)).toEqual(['n1']);
        // Pie de cada grupo (todo el grupo, no sólo lo que viaja).
        expect(bundle.expanded.pendiente?.aggregates?.totals.monto?.sum).toBe(40);
        expect(bundle.expanded.hecho?.aggregates?.totals.monto?.sum).toBe(40);

        // Con búsqueda: sólo los grupos de esa consulta.
        const hit = (await grouped.groupedBundle(tenantId, admin, 'clientes', {
            groupBy: f.estado!,
            expanded: [],
            expandAll: true,
            collapsed: ['hecho'],
            search: 'P2',
            perPage: 50,
            aggregateFieldIds: [f.monto!],
        })) as Bundle;
        expect(hit.buckets).toEqual([{ value: 'pendiente', count: 1 }]);
        expect(hit.expanded.pendiente?.records.data.map((r) => r.fields.nombre)).toEqual(['p2']);
        expect(hit.expanded.pendiente?.aggregates?.totals.monto?.sum).toBe(20);
    });

    it('multi_select: el atajo de 1-2 opciones da la MISMA clave que el camino general', async () => {
        const [list] = await pg.db.select({ id: lists.id }).from(lists).where(eq(lists.tenantId, tenantId));
        const fieldId = 987_654;
        const k = `f${fieldId}`;
        const cases: unknown[] = [
            ['b'],
            ['a', 'b'],
            ['b', 'a'],
            ['a', 'a'],
            ['B', 'a'],
            ['Ñu', 'nu'],
            ['ab', 'a'],
            ['c', 'a', 'b'],
            ['x"q', 'y\\z'],
            [1],
            [1, 'a'],
            ['a', null],
            [],
            null,
            'suelto',
            { a: 1 },
        ];
        await withTenant(pg.db, tenantId, async (tx) => {
            for (const v of cases) {
                await tx.insert(records).values({ tenantId, listId: list!.id, createdBy: zoe, data: { [k]: v } });
            }
            await tx.insert(records).values({ tenantId, listId: list!.id, createdBy: zoe, data: {} });
        });
        const field = { id: fieldId, type: 'multi_select', config: {} } as unknown as Parameters<typeof groupKeyExpr>[0];
        const col = sql`(${records.data} -> ${k})`;
        const slow = sql`(CASE WHEN jsonb_typeof(${col}) = 'array' AND jsonb_array_length(${col}) > 0 THEN (SELECT jsonb_agg(e ORDER BY e)::text FROM jsonb_array_elements_text(${col}) AS e) ELSE NULL END)`;
        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .select({ raw: sql<string | null>`${col}::text`, fast: sql<string | null>`${groupKeyExpr(field, new Map())}`, slow: sql<string | null>`${slow}` })
                .from(records)
                .where(eq(records.listId, list!.id)),
        );
        expect(rows).toHaveLength(cases.length + 1);
        for (const r of rows) expect({ raw: r.raw, key: r.fast }).toEqual({ raw: r.raw, key: r.slow });
        const byRaw = new Map(rows.map((r) => [r.raw, r.fast]));
        expect(byRaw.get('["b", "a"]')).toBe('["a", "b"]');
        expect(byRaw.get('["a", "a"]')).toBe('["a", "a"]');
        expect(byRaw.get('[]')).toBeNull();
        expect(byRaw.get('"suelto"')).toBeNull();
    });

    it('orden de grupos: catálogo, números como números y «sin valor» al final', () => {
        const sel = { type: 'select' as const, config: { options: [{ value: 'b' }, { value: 'a' }] } };
        expect(orderBuckets(sel, [{ value: null, count: 1 }, { value: 'a', count: 1 }, { value: 'zz', count: 1 }, { value: 'b', count: 1 }]).map((b) => b.value)).toEqual(['b', 'a', 'zz', null]);
        const num = { type: 'number' as const, config: {} };
        expect(orderBuckets(num, [{ value: '10', count: 1 }, { value: '9', count: 1 }]).map((b) => b.value)).toEqual(['9', '10']);
    });

    it('fecha y hora: «es» abarca el minuto (o el día) y sin zona se lee en la de la empresa', async () => {
        // 14:30 en Bogotá = 19:30 UTC.
        await create({ nombre: 'justo', cuando: '2026-10-21T19:30:45Z' });
        await create({ nombre: 'minuto siguiente', cuando: '2026-10-21T19:31:00Z' });
        await create({ nombre: 'otro dia', cuando: '2026-10-22T06:00:00Z' }); // 1 am del 22 en Bogotá
        const at = async (op: 'eq' | 'neq' | 'gte' | 'lte', value: string) =>
            (await recs.list(tenantId, admin, 'clientes', {
                limit: 50,
                sort_dir: 'asc',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.cuando!, op, value }] },
            })).data.map((r) => r.data[key('nombre')]).sort();
        // Lo que mandaba el selector (sin zona) = hora de Bogotá.
        expect(await at('eq', '2026-10-21T14:30')).toEqual(['justo']);
        // Con zona explícita: el mismo minuto.
        expect(await at('eq', '2026-10-21T19:30:00.000Z')).toEqual(['justo']);
        expect(await at('neq', '2026-10-21T14:30')).toEqual(['minuto siguiente', 'otro dia']);
        // Sólo fecha: el día entero EN BOGOTÁ (la 1 am del 22 no es del 21).
        expect(await at('eq', '2026-10-21')).toEqual(['justo', 'minuto siguiente']);
        expect(await at('lte', '2026-10-21')).toEqual(['justo', 'minuto siguiente']);
        expect(await at('gte', '2026-10-22')).toEqual(['otro dia']);
        expect(datetimeFilterRange('basura', 'UTC')).toBeNull();
    });
});
