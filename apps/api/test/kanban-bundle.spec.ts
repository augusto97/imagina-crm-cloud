import { BadRequestException } from '@nestjs/common';
import { kanbanCellKey } from '@imagina-base/shared';
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
import { cellLimits } from '../src/records/records-grouped.controller';
import { RecordsGroupedService, type KanbanBundle } from '../src/records/records-grouped.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/**
 * v0.1.297 — Kanban para ventas (B5): el bundle del tablero trae columnas, carriles,
 * totales (cantidad + suma/promedio de un campo) y las primeras tarjetas de
 * cada celda en UNA request, calculado sobre TODO lo que coincide con la vista.
 */
describe('Kanban para ventas — bundle del tablero (B5)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let grouped: RecordsGroupedService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let tenantId: number;
    let admin: Actor;
    let ana: Actor;
    let beto: Actor;
    const f: Record<string, number> = {};
    const key = (slug: string): string => `f${f[slug]}`;
    const ids: Record<string, number> = {};

    const bundle = async (actor: Actor, opts: Partial<Parameters<RecordsGroupedService['kanbanBundle']>[3]> = {}): Promise<KanbanBundle> =>
        grouped.kanbanBundle(tenantId, actor, 'oportunidades', { groupBy: f.etapa!, perCell: 25, ...opts });
    const names = (b: KanbanBundle, cell: string): string[] =>
        (b.cells[cell]?.records ?? []).map((r) => String((r.fields as Record<string, unknown>).nombre));

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
        const agg = new AggregateService(tenantDb, lists_, fields_);
        grouped = new RecordsGroupedService(recs, agg, lists_, fields_);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const mkUser = async (email: string, name: string): Promise<number> =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        admin = { userId: await mkUser('admin@t.local', 'Admin'), role: 'admin' };
        ana = { userId: await mkUser('ana@t.local', 'Ana'), role: 'agent' };
        beto = { userId: await mkUser('beto@t.local', 'Beto'), role: 'agent' };
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
        await lists_.create(tenantId, { name: 'Oportunidades' });
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            f[slug] = (await fields_.create(tenantId, 'oportunidades', { label: slug, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('nombre', 'text');
        // Catálogo en el orden del embudo (no alfabético).
        await mk('etapa', 'select', {
            options: [
                { value: 'prospecto', label: 'Prospecto' },
                { value: 'propuesta', label: 'Propuesta' },
                { value: 'ganado', label: 'Ganado' },
                { value: 'perdido', label: 'Perdido' },
            ],
        });
        await mk('prioridad', 'select', {
            options: [
                { value: 'alta', label: 'Alta' },
                { value: 'baja', label: 'Baja' },
            ],
        });
        await mk('monto', 'currency');
        await mk('vendedor', 'user');
        await mk('notas', 'text');
        const rows: Array<[Actor, Record<string, unknown>]> = [
            [admin, { nombre: 'A', etapa: 'prospecto', prioridad: 'alta', monto: 100, vendedor: ana.userId }],
            [admin, { nombre: 'B', etapa: 'prospecto', prioridad: 'baja', monto: 300, vendedor: beto.userId }],
            [ana, { nombre: 'C', etapa: 'prospecto', prioridad: 'alta', monto: 50, vendedor: ana.userId }],
            [ana, { nombre: 'D', etapa: 'propuesta', prioridad: 'alta', monto: 1000, vendedor: ana.userId }],
            [admin, { nombre: 'E', etapa: 'ganado', monto: 2000, vendedor: beto.userId }],
            [admin, { nombre: 'F', etapa: 'ganado', prioridad: 'baja', vendedor: beto.userId, notas: 'cliente grande' }],
            [admin, { nombre: 'G', prioridad: 'alta', monto: 7 }],
        ];
        for (const [actor, row] of rows) {
            const data: Record<string, unknown> = {};
            for (const [slug, v] of Object.entries(row)) data[key(slug)] = v;
            ids[String(row.nombre)] = (await recs.create(tenantId, actor, 'oportunidades', { data })).id;
        }
    });

    it('sin carriles: columnas en el orden del embudo con cantidad y suma calculadas sobre TODO', async () => {
        const b = await bundle(admin, { valueFieldId: f.monto, perCell: 2 });
        expect(b.meta.total_records).toBe(7);
        expect(b.meta.total_value).toBe(3457);
        expect(b.meta.value_field_id).toBe(f.monto);
        expect(b.columns).toEqual([
            { value: 'prospecto', count: 3, total: 450 },
            { value: 'propuesta', count: 1, total: 1000 },
            { value: 'ganado', count: 2, total: 2000 },
            { value: null, count: 1, total: 7 },
        ]);
        // La celda trae sólo las primeras tarjetas, pero el total es de las 3.
        const pros = b.cells[kanbanCellKey(undefined, 'prospecto')]!;
        expect(pros.count).toBe(3);
        expect(pros.total).toBe(450);
        expect(pros.records).toHaveLength(2);
        expect(pros.has_more).toBe(true);
        expect(b.cells[kanbanCellKey(undefined, null)]!.records!.map((r) => (r.fields as Record<string, unknown>).nombre)).toEqual(['G']);
        // Una columna sin tarjetas no viaja (el tablero la arma del catálogo).
        expect(b.cells.perdido).toBeUndefined();
    });

    it('«Mostrar más»: tope propio por celda, con el MISMO orden (lo actualizado hace poco primero)', async () => {
        const first = await bundle(admin, { perCell: 1 });
        // C es la última que se tocó de las tres de «prospecto».
        expect(names(first, 'prospecto')).toEqual(['C']);
        await recs.update(tenantId, admin, 'oportunidades', ids.A!, { data: { [key('notas')]: 'llamar' } });
        const after = await bundle(admin, { perCell: 1, limits: { prospecto: 3 } });
        expect(names(after, 'prospecto')).toEqual(['A', 'C', 'B']);
        expect(after.cells.prospecto!.has_more).toBe(false);
        // Las demás celdas siguen con el tope general.
        expect(after.cells.ganado!.records).toHaveLength(1);
        // Con orden por campo manda ese orden.
        const byAmount = await bundle(admin, { sort: `field_${f.monto}:desc` });
        expect(names(byAmount, 'prospecto')).toEqual(['B', 'A', 'C']);
        // El parámetro del controller ignora lo que no tiene forma.
        expect(cellLimits('{"prospecto": 50, "x": -1, "y": "a"}')).toEqual({ prospecto: 50 });
        expect(cellLimits('[1]')).toEqual({});
        expect(cellLimits('no-json')).toEqual({});
    });

    it('columnas plegadas no traen tarjetas pero cuentan; filtros, búsqueda y promedio', async () => {
        const b = await bundle(admin, { skip: ['ganado'], valueFieldId: f.monto, valueMetric: 'avg' });
        expect(b.cells.ganado!.records).toBeNull();
        expect(b.cells.ganado!.count).toBe(2);
        expect(b.cells.prospecto!.total).toBe(150);
        expect(b.meta.value_metric).toBe('avg');
        const filtered = await bundle(admin, {
            valueFieldId: f.monto,
            filterTree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.prioridad!, op: 'eq', value: 'alta' }] },
        });
        expect(filtered.meta.total_records).toBe(4);
        expect(filtered.columns.find((c) => c.value === 'prospecto')).toEqual({ value: 'prospecto', count: 2, total: 150 });
        const searched = await bundle(admin, { search: 'grande', valueFieldId: f.monto });
        expect(searched.meta.total_records).toBe(1);
        expect(searched.columns).toEqual([{ value: 'ganado', count: 1, total: 0 }]);
    });

    it('carriles por vendedor: celdas, totales por carril y por columna y el total general', async () => {
        const b = await bundle(admin, { laneBy: f.vendedor, valueFieldId: f.monto });
        expect(b.meta.lane_field_id).toBe(f.vendedor);
        expect(b.lanes!.map((l) => l.value)).toEqual([String(ana.userId), String(beto.userId), null]);
        expect(b.lanes!.find((l) => l.value === String(ana.userId))).toEqual({ value: String(ana.userId), count: 3, total: 1150 });
        expect(b.lanes!.find((l) => l.value === String(beto.userId))).toEqual({ value: String(beto.userId), count: 3, total: 2300 });
        // Columnas: los totales son de TODOS los carriles.
        expect(b.columns.find((c) => c.value === 'prospecto')).toEqual({ value: 'prospecto', count: 3, total: 450 });
        const anaPros = b.cells[kanbanCellKey(String(ana.userId), 'prospecto')]!;
        expect(anaPros).toMatchObject({ count: 2, total: 150 });
        expect(anaPros.records!.map((r) => (r.fields as Record<string, unknown>).nombre).sort()).toEqual(['A', 'C']);
        expect(b.cells[kanbanCellKey(String(beto.userId), 'ganado')]).toMatchObject({ count: 2, total: 2000 });
        expect(b.cells[kanbanCellKey(null, null)]!.records!.map((r) => (r.fields as Record<string, unknown>).nombre)).toEqual(['G']);
        // Cada tarjeta en UNA sola celda.
        const all = Object.values(b.cells).flatMap((c) => (c.records ?? []).map((r) => r.id as number));
        expect(new Set(all).size).toBe(7);
        expect(b.meta.total_value).toBe(3457);
        // Un carril plegado cuenta pero no trae tarjetas.
        const folded = await bundle(admin, { laneBy: f.vendedor, skipLanes: [String(beto.userId)] });
        expect(folded.cells[kanbanCellKey(String(beto.userId), 'ganado')]).toMatchObject({ count: 2, records: null });
        expect(folded.cells[kanbanCellKey(String(ana.userId), 'propuesta')]!.records).toHaveLength(1);
    });

    it('ACL: una agente con «sólo lo suyo» ve los totales de LO SUYO; un carril por un campo oculto se ignora', async () => {
        await lists_.updatePermissions(tenantId, 'oportunidades', {
            permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['vendedor'] } },
        });
        const b = await bundle(ana, { laneBy: f.vendedor, valueFieldId: f.monto });
        expect(b.meta.total_records).toBe(2);
        expect(b.meta.total_value).toBe(1050);
        expect(b.meta.lane_field_id).toBeUndefined();
        expect(b.lanes).toBeUndefined();
        expect(b.columns).toEqual([
            { value: 'prospecto', count: 1, total: 50 },
            { value: 'propuesta', count: 1, total: 1000 },
        ]);
        // Un campo de valor oculto (o que no es numérico) no rompe el tablero: no suma.
        const noValue = await bundle(admin, { valueFieldId: f.notas });
        expect(noValue.meta.value_field_id).toBeNull();
        expect(noValue.columns[0]!.total).toBeNull();
    });

    it('validaciones: carriles por el mismo campo o uno que no existe → 400', async () => {
        await expect(bundle(admin, { laneBy: f.etapa })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { laneBy: 999_999 })).rejects.toBeInstanceOf(BadRequestException);
    });
});
