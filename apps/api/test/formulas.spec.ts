import { listRecordsQuerySchema, type CreateFieldInput, type Field, type ListRecordsQuery } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { withComputedExprs } from '../src/records/computed-sql';
import type { FilterableField } from '../src/records/query-builder';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { enterTrashMode } from '../src/trash/trash-ops';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

/**
 * Fórmulas (opción A1): el campo «Fórmula» se calcula en cada lectura con el
 * evaluador de shared, se guarda por id y, cuando compila a SQL, filtra,
 * ordena, agrupa y se suma — con EXACTAMENTE el mismo valor que en JS.
 */
describe('fórmulas (Postgres real)', () => {
    let pg: TestPg;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let aggregate: AggregateService;
    let tenantId: number;
    let listId: number;
    const f: Record<string, Field> = {};

    // Facturas: la del medio tiene cantidad 2 (la fórmula «Ratio» divide por cero).
    const seed = [
        { cliente: 'acme', precio: 25000, cantidad: 3, estado: 'pagada', emitida: '2026-10-09', vence: '2026-10-31', pagada: true, descuento: 10 },
        { cliente: 'beta', precio: 90000, cantidad: 2, estado: 'pendiente', emitida: '2026-10-15', vence: '2026-11-15', pagada: false, descuento: 0 },
        { cliente: 'gamma', precio: 4000, cantidad: 10, estado: 'pendiente', emitida: '2026-04-01', vence: null, pagada: false, descuento: null },
    ];
    const ids: number[] = [];

    const q = (query: Partial<ListRecordsQuery>): ListRecordsQuery => listRecordsQuerySchema.parse({ limit: 50, ...query });
    const key = (slug: string): string => `f${f[slug]!.id}`;
    const formula = async (label: string, slug: string, text: string, extra: Record<string, unknown> = {}): Promise<Field> => {
        f[slug] = await fieldsService.create(tenantId, 'facturas', { label, slug, type: 'formula', config: { formula: text, ...extra } } as CreateFieldInput);
        return f[slug]!;
    };
    const rows = async (query: Partial<ListRecordsQuery> = {}, actor: Actor = admin) =>
        (await recs.list(tenantId, actor, 'facturas', q(query))).data;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        const timeZones = new TenantTimeZones(tenantDb);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            timeZones,
        );
        aggregate = new AggregateService(tenantDb, lists_, fieldsService, timeZones);

        const [t] = await pg.db
            .insert(tenants)
            .values({
                slug: 'formulas',
                name: 'Fórmulas',
                settings: { format: { timezone: 'America/Bogota', number_format: 'dot_comma', date_format: 'dmy' } },
            })
            .returning();
        tenantId = t!.id;
        const list = await lists_.create(tenantId, { name: 'Facturas' });
        listId = list.id;
        const base: CreateFieldInput[] = [
            { label: 'Cliente', type: 'text', slug: 'cliente' },
            { label: 'Precio', type: 'currency', slug: 'precio', config: { currency: 'COP', precision: 0 } },
            { label: 'Cantidad', type: 'number', slug: 'cantidad' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'pagada', label: 'Pagada' }, { value: 'pendiente', label: 'Pendiente' }] },
            },
            { label: 'Emitida', type: 'date', slug: 'emitida' },
            { label: 'Vence', type: 'date', slug: 'vence' },
            { label: 'Pagada', type: 'checkbox', slug: 'pagada' },
            { label: 'Descuento', type: 'percent', slug: 'descuento' },
        ];
        for (const d of base) f[d.slug!] = await fieldsService.create(tenantId, 'facturas', d);
        for (const r of seed) {
            const data: Record<string, unknown> = {};
            for (const [slug, v] of Object.entries(r)) if (v !== null) data[key(slug)] = v;
            const rec = await recs.create(tenantId, admin, 'facturas', { data });
            ids.push(rec.id);
        }
        // Las fórmulas se escriben por NOMBRE (como en el editor).
        await formula('Total', 'total', '{Precio} * {Cantidad}');
        await formula('Neto', 'neto', '{Total} * (1 - {Descuento}%)');
        await formula('Etiqueta', 'etiqueta', 'MAYUSC({Cliente}) & " · " & {Estado}');
        await formula('Plazo', 'plazo', 'DIAS_ENTRE({Emitida}, {Vence})');
        await formula('Siguiente hábil', 'habil', 'SUMAR_DIAS_HABILES({Emitida}, 1)');
        await formula('Grande', 'grande', '{Total} > 100000');
        await formula('Ratio', 'ratio', '{Precio} / ({Cantidad} - 2)');
        await formula('Vencida', 'vencida', 'Y(NO({Pagada}), {Vence} < FECHA(2026, 11, 1))');
        await formula('Meses', 'meses', 'MESES_ENTRE({Emitida}, {Vence})');
        await formula('Cuota', 'cuota', 'REDONDEAR({Total} / 3, -2)');
    });

    afterAll(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await pg?.stop();
    });

    it('se guarda por id y se muestra por nombre, con su tipo de resultado y si compila a SQL', async () => {
        expect(f.total!.config.formula).toBe(`{#${f.precio!.id}} * {#${f.cantidad!.id}}`);
        const listed = await fieldsService.list(tenantId, 'facturas');
        const total = listed.find((x) => x.slug === 'total')!;
        expect(total.formula).toMatchObject({ display: '{Precio} * {Cantidad}', result_type: 'currency', sql: true, error: null });
        expect(total.formula!.display_config).toMatchObject({ currency: 'COP', precision: 0 });
        // De qué campos depende (la interfaz avisa al borrar uno de ellos).
        expect(total.formula!.dependencies).toEqual([f.precio!.id, f.cantidad!.id]);
        const habil = listed.find((x) => x.slug === 'habil')!;
        expect(habil.formula).toMatchObject({ result_type: 'date', sql: false });
        expect(habil.formula!.sql_reason).toMatch(/días hábiles/);
        expect(listed.find((x) => x.slug === 'grande')!.formula!.result_type).toBe('checkbox');
    });

    it('calcula cada fila como a mano (y un error no tumba la lista)', async () => {
        const data = await rows();
        const byId = new Map(data.map((r) => [r.id, r]));
        const a = byId.get(ids[0]!)!;
        const b = byId.get(ids[1]!)!;
        const c = byId.get(ids[2]!)!;
        expect(a.data[key('total')]).toBe(75000);
        expect(a.data[key('neto')]).toBe(67500);
        expect(a.data[key('etiqueta')]).toBe('ACME · Pagada');
        expect(a.data[key('plazo')]).toBe(22);
        // Viernes 9/10/2026 + 1 hábil: el lunes 12 es festivo (Día de la Raza).
        expect(a.data[key('habil')]).toBe('2026-10-13');
        // Miércoles 1/4/2026 + 1 hábil: jueves y viernes santos.
        expect(c.data[key('habil')]).toBe('2026-04-06');
        expect(b.data[key('grande')]).toBe(true);
        expect(a.data[key('grande')]).toBe(false);
        expect(a.data[key('cuota')]).toBe(25000);
        expect(c.data[key('plazo')]).toBeNull();
        // División por cero en una fila: #ERROR con el motivo, el resto intacto.
        expect(b.data[key('ratio')]).toBeNull();
        expect(b.formula_errors).toEqual({ [key('ratio')]: 'División por cero.' });
        expect(a.data[key('ratio')]).toBe(25000);
        expect(a.formula_errors).toBeUndefined();
    });

    it('el SQL da lo mismo que el evaluador JS, fila por fila', async () => {
        const data = await rows();
        const listFields = await fieldsService.listByListId(tenantId, listId);
        const sqlValues = await withTenant(pg.db, tenantId, async (tx) => {
            const map = withComputedExprs(
                new Map<number, FilterableField>(listFields.map((x) => [x.id, { id: x.id, type: x.type }])),
                listFields,
                'America/Bogota',
            );
            const out = new Map<string, Map<number, unknown>>();
            for (const x of listFields.filter((y) => y.type === 'formula')) {
                const ff = map.get(x.id)!;
                if (!ff.expr) continue;
                const res = await tx.execute(sql`SELECT ${records.id} AS id, (${ff.expr})::text AS v FROM ${records} WHERE ${and(eq(records.tenantId, tenantId), eq(records.listId, listId))}`);
                out.set(x.slug, new Map((res.rows as Array<{ id: unknown; v: unknown }>).map((r) => [Number(r.id), r.v])));
            }
            return out;
        });
        expect([...sqlValues.keys()].sort()).toEqual(['cuota', 'etiqueta', 'grande', 'meses', 'neto', 'plazo', 'ratio', 'total', 'vencida']);
        for (const [slug, byRow] of sqlValues) {
            for (const r of data) {
                const js = r.data[key(slug)];
                const raw = byRow.get(r.id);
                const sqlVal =
                    raw === null || raw === undefined
                        ? null
                        : typeof js === 'number'
                          ? Number(raw)
                          : typeof js === 'boolean'
                            ? raw === 'true'
                            : raw;
                expect({ slug, id: r.id, v: sqlVal }).toEqual({ slug, id: r.id, v: js });
            }
        }
    });

    it('filtra, ordena y se suma en el pie por una fórmula que compila a SQL', async () => {
        const big = await rows({ filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.total!.id, op: 'gt', value: 50000 }] } });
        expect(big.map((r) => r.id).sort()).toEqual([ids[0], ids[1]].sort());
        const txt = await rows({ filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.etiqueta!.id, op: 'contains', value: 'pendiente' }] } });
        expect(txt).toHaveLength(2);
        const yes = await rows({ filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.grande!.id, op: 'eq', value: true }] } });
        expect(yes.map((r) => r.id)).toEqual([ids[1]]);
        const sorted = await rows({ sort: `field_${f.total!.id}:desc` });
        expect(sorted.map((r) => r.data[key('total')])).toEqual([180000, 75000, 40000]);
        const byText = await rows({ sort: `field_${f.etiqueta!.id}:asc` });
        expect(byText.map((r) => r.data[key('etiqueta')])).toEqual(['ACME · Pagada', 'BETA · Pendiente', 'GAMMA · Pendiente']);
        // Una fórmula que NO compila no filtra (la condición se descarta) ni ordena.
        const all = await rows({ filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.habil!.id, op: 'is_null' }] } });
        expect(all).toHaveLength(3);

        const footer = await aggregate.footer(tenantId, 'facturas', { fieldIds: [f.total!.id, f.neto!.id] });
        expect(footer.totals.total).toMatchObject({ sum: 295000, max: 180000, min: 40000 });
        expect(footer.totals.neto).toMatchObject({ sum: 67500 + 180000 + 40000 });
        const grouped = await aggregate.run(tenantId, 'facturas', { metric: 'sum', field_id: f.total!.id, group_by_field_id: f.estado!.id });
        expect(grouped.groups).toEqual(
            expect.arrayContaining([
                { group: 'pagada', value: 75000 },
                { group: 'pendiente', value: 220000 },
            ]),
        );
        // Agrupar por una fórmula.
        const byGrande = await aggregate.run(tenantId, 'facturas', { metric: 'count', group_by_field_id: f.grande!.id });
        expect(byGrande.groups).toEqual(
            expect.arrayContaining([
                { group: 'false', value: 2 },
                { group: 'true', value: 1 },
            ]),
        );
        await expect(aggregate.run(tenantId, 'facturas', { metric: 'count', group_by_field_id: f.habil!.id })).rejects.toThrow(/días hábiles/);
    });

    it('renombrar un campo usado no rompe la fórmula', async () => {
        await fieldsService.update(tenantId, 'facturas', String(f.precio!.id), { label: 'Precio unitario' });
        const listed = await fieldsService.list(tenantId, 'facturas');
        expect(listed.find((x) => x.slug === 'total')!.formula!.display).toBe('{Precio unitario} * {Cantidad}');
        const data = await rows();
        expect(data.find((r) => r.id === ids[0])!.data[key('total')]).toBe(75000);
        await fieldsService.update(tenantId, 'facturas', String(f.precio!.id), { label: 'Precio' });
    });

    it('rechaza un ciclo con el camino, un error de sintaxis con la columna y un campo que no existe', async () => {
        await expect(
            fieldsService.update(tenantId, 'facturas', String(f.total!.id), { config: { formula: '{Neto} + 1' } }),
        ).rejects.toMatchObject({ response: { code: 'invalid_formula', message: expect.stringMatching(/círculo: «Total» → «Neto» → «Total»/) } });
        const syntax = fieldsService.create(tenantId, 'facturas', { label: 'Mal', type: 'formula', config: { formula: 'SI({Precio} > 0, "a"' } } as CreateFieldInput);
        await expect(syntax).rejects.toMatchObject({
            response: { code: 'invalid_formula', message: expect.stringMatching(/Falta un paréntesis de cierre \) para SI en la columna 21/) },
        });
        await expect(
            fieldsService.create(tenantId, 'facturas', { label: 'Mal', type: 'formula', config: { formula: '{Precioo} * 2' } } as CreateFieldInput),
        ).rejects.toMatchObject({ response: { message: expect.stringMatching(/No hay ningún campo «Precioo»/) } });
    });

    it('una fórmula que usa un campo oculto para el rol también se oculta', async () => {
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({ settings: { permissions: { permissions: { agent: { view: 'all', edit: 'all', delete: 'none', create: true, fields_hidden: ['precio'] } } } } })
                .where(eq(lists.id, listId)),
        );
        const agent: Actor = { userId: 1, role: 'agent' };
        const data = await rows({}, agent);
        expect(data[0]!.data[key('total')]).toBeUndefined();
        expect(data[0]!.data[key('neto')]).toBeUndefined();
        expect(data[0]!.data[key('etiqueta')]).toBeDefined();
        // Tampoco se filtra por ella (sería un oráculo sobre el precio).
        const filtered = await rows(
            { filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: f.total!.id, op: 'gt', value: 100000 }] } },
            agent,
        );
        expect(filtered).toHaveLength(3);
        await withTenant(pg.db, tenantId, (tx) => tx.update(lists).set({ settings: {} }).where(eq(lists.id, listId)));
    });

    it('un campo en la papelera da #ERROR con su nombre, y vuelve al restaurarlo', async () => {
        await fieldsService.remove(tenantId, 'facturas', String(f.cantidad!.id), { userId: 1 });
        const data = await rows();
        expect(data[0]!.data[key('total')]).toBeNull();
        expect(data[0]!.formula_errors?.[key('total')]).toBe('El campo «Cantidad» no existe (está en la papelera o se borró).');
        // Neto usa Total: el error dice cuál falló.
        expect(data[0]!.formula_errors?.[key('neto')]).toMatch(/«Total» da error/);
        const listed = await fieldsService.list(tenantId, 'facturas');
        expect(listed.find((x) => x.slug === 'total')!.formula).toMatchObject({
            display: '{Precio} * {Cantidad}',
            error: 'El campo «Cantidad» no existe (está en la papelera o se borró).',
            sql: false,
        });
        await withTenant(pg.db, tenantId, async (tx) => {
            await enterTrashMode(tx);
            await tx.update(fields).set({ deletedAt: null, deletedBy: null }).where(eq(fields.id, f.cantidad!.id));
        });
        const back = await rows();
        expect(back.find((r) => r.id === ids[0])!.data[key('total')]).toBe(75000);
    });

    it('convertir a número o texto conserva el valor calculado; un calculado pasa a fórmula', async () => {
        const cuota = await formula('Cuota texto', 'cuota_txt', '{Total} / 3');
        await fieldsService.update(tenantId, 'facturas', String(f.cuota!.id), { type: 'number', config: { precision: 0 } });
        await fieldsService.update(tenantId, 'facturas', String(cuota.id), { type: 'text', config: {} });
        const stored = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: records.id, data: records.data }).from(records).where(eq(records.id, ids[0]!)),
        );
        expect(stored[0]!.data[key('cuota')]).toBe(25000);
        expect(stored[0]!.data[`f${cuota.id}`]).toBe('COP 25.000');

        const computed = await fieldsService.create(tenantId, 'facturas', {
            label: 'Suma vieja',
            slug: 'suma_vieja',
            type: 'computed',
            config: { operation: 'sum', inputs: [f.precio!.id, f.cantidad!.id] },
        } as CreateFieldInput);
        const asFormula = await fieldsService.update(tenantId, 'facturas', String(computed.id), {
            type: 'formula',
            config: { formula: 'SUMA({Precio}, {Cantidad})' },
        });
        expect(asFormula.type).toBe('formula');
        const data = await rows();
        expect(data.find((r) => r.id === ids[0])!.data[`f${computed.id}`]).toBe(25003);
        // Un campo con datos no se vuelve fórmula (se perderían los valores).
        await expect(fieldsService.update(tenantId, 'facturas', String(f.cliente!.id), { type: 'formula', config: { formula: '1' } })).rejects.toMatchObject({
            response: { code: 'type_not_convertible' },
        });
    });
});
