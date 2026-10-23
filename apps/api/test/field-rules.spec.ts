import { BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatAutonumber } from '@imagina-base/shared';
import { autonumberCounters, memberships, records as recordsTable, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.300 — ID automático (trigger + contador atómico), columnas de sistema,
 * valores por defecto y validaciones, con Postgres real y RLS.
 */
describe('Campos: ID automático, sistema, defaults y validaciones', () => {
    let pg: TestPg;
    let lists: ListsService;
    let fields: FieldsService;
    let records: RecordsService;
    let aggregate: AggregateService;
    let tenantId: number;
    let ana: Actor;
    let beto: Actor;
    const system: Actor = { userId: 0, role: 'admin' };

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const tz = new TenantTimeZones(tenantDb);
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        records = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fields,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            undefined,
            tz,
        );
        aggregate = new AggregateService(tenantDb, lists, fields, tz);
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'Acme', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        const mk = async (email: string, name: string) =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        beto = { userId: await mk('beto@acme.test', 'Beto'), role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana.userId, role: 'admin' },
                { tenantId, userId: beto.userId, role: 'admin' },
            ]),
        );
    });

    afterAll(async () => {
        await pg?.stop();
    });

    const key = (id: number) => `f${id}`;
    const badRequest = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(BadRequestException);

    describe('ID automático', () => {
        let titulo: number;
        let codigo: number;

        beforeAll(async () => {
            await lists.create(tenantId, { name: 'Tickets', slug: 'tickets' });
            titulo = (await fields.create(tenantId, 'tickets', { label: 'Título', type: 'text', slug: 'titulo' })).id;
            for (const t of ['uno', 'dos', 'tres']) {
                await records.create(tenantId, ana, 'tickets', { data: { [key(titulo)]: t } });
            }
        });

        it('al agregarlo numera lo que ya existía en orden de creación (prefijo sugerido por la lista)', async () => {
            const field = await fields.create(tenantId, 'tickets', { label: 'Código', type: 'autonumber', slug: 'codigo' });
            codigo = field.id;
            expect(field.config.prefix).toBe('TIC');
            const page = await records.list(tenantId, ana, 'tickets', { limit: 50, sort_dir: 'asc' });
            expect(page.data.map((r) => [r.data[key(titulo)], r.data[key(codigo)]])).toEqual([
                ['uno', 'TIC-0001'],
                ['dos', 'TIC-0002'],
                ['tres', 'TIC-0003'],
            ]);
            const nuevo = await records.create(tenantId, ana, 'tickets', { data: { [key(titulo)]: 'cuatro' } });
            expect(nuevo.data[key(codigo)]).toBe('TIC-0004');
        });

        it('no se escribe a mano: el alta y la edición ignoran el valor que llega', async () => {
            const r = await records.create(tenantId, ana, 'tickets', { data: { [key(titulo)]: 'cinco', [key(codigo)]: 'HACK-1' } });
            expect(r.data[key(codigo)]).toBe('TIC-0005');
            const u = await records.update(tenantId, ana, 'tickets', r.id, { data: { [key(codigo)]: 'HACK-2', [key(titulo)]: 'cinco!' } });
            expect(u.data[key(codigo)]).toBe('TIC-0005');
            // Y aunque un camino interno reescriba `data` sin la clave, el número se conserva.
            await withTenant(pg.db, tenantId, (tx) =>
                tx.update(recordsTable).set({ data: { [key(titulo)]: 'pisado' } }).where(eq(recordsTable.id, r.id)),
            );
            expect((await records.get(tenantId, ana, 'tickets', r.id)).data[key(codigo)]).toBe('TIC-0005');
        });

        it('altas en paralelo reciben números distintos y consecutivos; un alta revertida no deja hueco', async () => {
            const created = await Promise.all(
                Array.from({ length: 15 }, (_, i) => records.create(tenantId, beto, 'tickets', { data: { [key(titulo)]: `p${i}` } })),
            );
            const nums = created.map((r) => Number(String(r.data[key(codigo)]).slice(4))).sort((a, b) => a - b);
            expect(nums).toEqual(Array.from({ length: 15 }, (_, i) => 6 + i));
            const list = await lists.get(tenantId, 'tickets');
            await expect(
                withTenant(pg.db, tenantId, async (tx) => {
                    await tx.insert(recordsTable).values({ tenantId, listId: list.id, data: {}, createdBy: ana.userId });
                    throw new Error('rollback');
                }),
            ).rejects.toThrow('rollback');
            const next = await records.create(tenantId, ana, 'tickets', { data: { [key(titulo)]: 'tras rollback' } });
            expect(next.data[key(codigo)]).toBe('TIC-0021');
        });

        it('se busca y se ordena por número', async () => {
            const found = await records.list(tenantId, ana, 'tickets', { limit: 50, sort_dir: 'asc', search: 'tic-0002' });
            expect(found.data.map((r) => r.data[key(titulo)])).toEqual(['dos']);
            const desc = await records.list(tenantId, ana, 'tickets', { limit: 3, sort_dir: 'asc', sort: `field_${codigo}:desc` });
            expect(desc.data.map((r) => r.data[key(codigo)])).toEqual(['TIC-0021', 'TIC-0020', 'TIC-0019']);
            const filtered = await records.list(tenantId, ana, 'tickets', {
                limit: 50,
                sort_dir: 'asc',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: codigo, op: 'eq', value: 'TIC-0003' }] },
            });
            expect(filtered.data.map((r) => r.data[key(titulo)])).toEqual(['tres']);
        });

        it('un alta que trae el ID copiado de otro registro (duplicar, clonar, plantilla) recibe uno nuevo', async () => {
            const list = await lists.get(tenantId, 'tickets');
            const [row] = await withTenant(pg.db, tenantId, (tx) =>
                tx
                    .insert(recordsTable)
                    .values({ tenantId, listId: list.id, data: { [key(codigo)]: 'TIC-0001', [key(titulo)]: 'copia' }, createdBy: ana.userId })
                    .returning(),
            );
            expect((row!.data as Record<string, unknown>)[key(codigo)]).toBe('TIC-0022');
            // Sólo la migración de una empresa conserva el número que trae (con su marca de sesión).
            const [kept] = await withTenant(pg.db, tenantId, async (tx) => {
                await tx.execute(sql`select set_config('app.keep_autonumber', 'on', true)`);
                return tx
                    .insert(recordsTable)
                    .values({ tenantId, listId: list.id, data: { [key(codigo)]: 'TIC-0900' }, createdBy: ana.userId })
                    .returning();
            });
            expect((kept!.data as Record<string, unknown>)[key(codigo)]).toBe('TIC-0900');
        });

        it('subir el número inicial sigue desde ahí (bajarlo no repite números)', async () => {
            await fields.update(tenantId, 'tickets', String(codigo), { config: { prefix: 'SOP', start: 500 } });
            const r = await records.create(tenantId, ana, 'tickets', { data: {} });
            expect(r.data[key(codigo)]).toBe('SOP-0500');
            await fields.update(tenantId, 'tickets', String(codigo), { config: { prefix: 'SOP', start: 1 } });
            const r2 = await records.create(tenantId, ana, 'tickets', { data: {} });
            expect(r2.data[key(codigo)]).toBe('SOP-0501');
            // Lo ya emitido no cambia con el prefijo nuevo.
            const viejo = await records.list(tenantId, ana, 'tickets', { limit: 1, sort_dir: 'asc' });
            expect(viejo.data[0]!.data[key(codigo)]).toBe('TIC-0001');
        });

        it('reinicio por año en el reloj de la empresa', async () => {
            await lists.create(tenantId, { name: 'Pedidos', slug: 'pedidos' });
            const list = await lists.get(tenantId, 'pedidos');
            // 2026-01-01 03:00 UTC = 31-dic-2025 22:00 en Bogotá.
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(recordsTable).values([
                    { tenantId, listId: list.id, data: {}, createdBy: ana.userId, createdAt: new Date('2025-06-01T12:00:00Z') },
                    { tenantId, listId: list.id, data: {}, createdBy: ana.userId, createdAt: new Date('2026-01-01T03:00:00Z') },
                    { tenantId, listId: list.id, data: {}, createdBy: ana.userId, createdAt: new Date('2026-02-01T12:00:00Z') },
                ]),
            );
            const f = await fields.create(tenantId, 'pedidos', { label: 'Número', type: 'autonumber', config: { prefix: 'PED', yearly: true } });
            const page = await records.list(tenantId, ana, 'pedidos', { limit: 10, sort_dir: 'asc' });
            expect(page.data.map((r) => r.data[key(f.id)])).toEqual(['PED-2025-0001', 'PED-2025-0002', 'PED-2026-0001']);
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(recordsTable).values({ tenantId, listId: list.id, data: {}, createdBy: ana.userId, createdAt: new Date('2026-03-01T12:00:00Z') }),
            );
            const last = await records.list(tenantId, ana, 'pedidos', { limit: 10, sort_dir: 'desc' });
            expect(last.data[0]!.data[key(f.id)]).toBe('PED-2026-0002');
            const counters = await withTenant(pg.db, tenantId, (tx) =>
                tx.select().from(autonumberCounters).where(eq(autonumberCounters.fieldId, f.id)),
            );
            expect(counters.map((c) => [c.period, c.nextValue]).sort()).toEqual([[2025, 3], [2026, 3]]);
        });

        it('el texto del SQL es idéntico al de TypeScript', async () => {
            const cases: Array<[Record<string, unknown>, number, number]> = [
                [{ prefix: 'TCK' }, 1, 0],
                [{ prefix: 'PED', yearly: true }, 42, 2026],
                [{ prefix: 'A', separator: '' }, 7, 0],
                [{ prefix: '', separator: '/', digits: 6 }, 123, 0],
                [{ prefix: 'X', digits: 2 }, 12345, 0],
                [{ yearly: true, separator: '.' }, 9, 2027],
            ];
            for (const [cfg, n, year] of cases) {
                const res = await pg.db.execute(sql`select imcrm_autonumber_text(${JSON.stringify(cfg)}::jsonb, ${n}::bigint, ${year}::int) as t`);
                expect((res.rows[0] as { t: string }).t).toBe(formatAutonumber(cfg, n, year || null));
            }
        });

        it('conversión: a «ID automático» no; desde él, sólo a texto (conserva los números)', async () => {
            await badRequest(fields.update(tenantId, 'tickets', String(titulo), { type: 'autonumber' }));
            await badRequest(fields.update(tenantId, 'tickets', String(codigo), { type: 'number' }));
            await fields.update(tenantId, 'tickets', String(codigo), { type: 'text' });
            const page = await records.list(tenantId, ana, 'tickets', { limit: 1, sort_dir: 'asc' });
            expect(page.data[0]!.data[key(codigo)]).toBe('TIC-0001');
        });
    });

    describe('Columnas de sistema', () => {
        let nombre: number;
        let creadoPor: number;
        let creadoEl: number;
        let modificadoPor: number;
        let modificadoEl: number;
        let r1: number;
        let r2: number;

        beforeAll(async () => {
            await lists.create(tenantId, { name: 'Clientes', slug: 'clientes' });
            nombre = (await fields.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' })).id;
            creadoPor = (await fields.create(tenantId, 'clientes', { label: 'Creado por', type: 'created_by' })).id;
            creadoEl = (await fields.create(tenantId, 'clientes', { label: 'Creado el', type: 'created_at' })).id;
            modificadoPor = (await fields.create(tenantId, 'clientes', { label: 'Modificado por', type: 'updated_by' })).id;
            modificadoEl = (await fields.create(tenantId, 'clientes', { label: 'Modificado el', type: 'updated_at' })).id;
            r1 = (await records.create(tenantId, ana, 'clientes', { data: { [key(nombre)]: 'Zeta' } })).id;
            r2 = (await records.create(tenantId, beto, 'clientes', { data: { [key(nombre)]: 'Alfa' } })).id;
        });

        it('los valores salen de la fila: quién creó, cuándo, quién modificó', async () => {
            const a = await records.get(tenantId, ana, 'clientes', r1);
            expect(a.data[key(creadoPor)]).toBe(ana.userId);
            expect(a.data[key(modificadoPor)]).toBe(ana.userId);
            expect(a.data[key(creadoEl)]).toBe(a.created_at);
            expect(a.updated_by).toBe(ana.userId);
            const edited = await records.update(tenantId, beto, 'clientes', r1, { data: { [key(nombre)]: 'Zeta 2' } });
            expect(edited.data[key(modificadoPor)]).toBe(beto.userId);
            expect(edited.updated_by).toBe(beto.userId);
            expect(edited.data[key(modificadoEl)]).toBe(edited.updated_at);
            // Una automatización (el sistema) queda como 0.
            const bySystem = await records.update(tenantId, system, 'clientes', r2, { data: { [key(nombre)]: 'Alfa 2' } });
            expect(bySystem.updated_by).toBe(0);
            // Escribir una columna de sistema no hace nada.
            const ignored = await records.update(tenantId, ana, 'clientes', r2, { data: { [key(creadoPor)]: 999, [key(nombre)]: 'Alfa 3' } });
            expect(ignored.data[key(creadoPor)]).toBe(beto.userId);
        });

        it('se filtran, se ordenan y se agrupan', async () => {
            const byBeto = await records.list(tenantId, ana, 'clientes', {
                limit: 50,
                sort_dir: 'asc',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: creadoPor, op: 'eq', value: String(beto.userId) }] },
            });
            expect(byBeto.data.map((r) => r.id)).toEqual([r2]);
            const today = await records.list(tenantId, ana, 'clientes', {
                limit: 50,
                sort_dir: 'asc',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: creadoEl, op: 'between_relative', value: 'today' }] },
            });
            expect(today.data.length).toBe(2);
            const past = await records.list(tenantId, ana, 'clientes', {
                limit: 50,
                sort_dir: 'asc',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: creadoEl, op: 'lt', value: '2020-01-01' }] },
            });
            expect(past.data.length).toBe(0);
            // Ordenar por persona = por su nombre (Ana antes que Beto).
            const sorted = await records.list(tenantId, ana, 'clientes', { limit: 50, sort_dir: 'asc', sort: `field_${creadoPor}:desc` });
            expect(sorted.data.map((r) => r.id)).toEqual([r2, r1]);
            const grouped = await aggregate.run(tenantId, 'clientes', { metric: 'count', group_by_field_id: creadoPor });
            expect(Object.fromEntries((grouped.groups ?? []).map((g) => [g.group, g.value]))).toEqual({
                [String(ana.userId)]: 1,
                [String(beto.userId)]: 1,
            });
            const byMonth = await aggregate.run(tenantId, 'clientes', { metric: 'count', group_by_field_id: creadoEl, time_bucket: 'month' });
            expect((byMonth.groups ?? []).reduce((s, g) => s + Number(g.value), 0)).toBe(2);
            const maxDate = await aggregate.run(tenantId, 'clientes', { metric: 'max', field_id: creadoEl });
            expect(typeof maxDate.value).toBe('string');
            // El pie de la vista agrupada por «Creado por» (con las columnas de
            // sistema calculadas una vez por fila en la subconsulta).
            const foot = await aggregate.footer(tenantId, 'clientes', { fieldIds: [nombre, creadoEl, creadoPor], group_by_field_id: creadoPor });
            expect(foot.groups.map((g) => g.value).sort()).toEqual([String(ana.userId), String(beto.userId)].sort());
            expect(foot.totals.nombre?.count).toBe(2);
            const onlyAna = await aggregate.footer(tenantId, 'clientes', {
                fieldIds: [creadoEl],
                group_by_field_id: creadoPor,
                groupsOnly: true,
                groupKeys: [String(ana.userId)],
            });
            expect(onlyAna.groups.map((g) => g.value)).toEqual([String(ana.userId)]);
        });
    });

    describe('Valores por defecto', () => {
        let estado: number;
        let fecha: number;
        let responsable: number;
        let nota: number;

        beforeAll(async () => {
            await lists.create(tenantId, { name: 'Tareas', slug: 'tareas' });
            estado = (await fields.create(tenantId, 'tareas', {
                label: 'Estado',
                type: 'select',
                config: { options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'hecho', label: 'Hecho' }], default_value: { kind: 'value', value: 'nuevo' } },
            })).id;
            fecha = (await fields.create(tenantId, 'tareas', { label: 'Fecha', type: 'date', config: { default_value: { kind: 'today' } } })).id;
            responsable = (await fields.create(tenantId, 'tareas', { label: 'Responsable', type: 'user', config: { default_value: { kind: 'creator' } } })).id;
            nota = (await fields.create(tenantId, 'tareas', { label: 'Nota', type: 'text', config: { default_value: { kind: 'value', value: '  Sin revisar  ' } } })).id;
        });

        it('se aplican cuando el valor no viene; un vacío explícito se respeta', async () => {
            const r = await records.create(tenantId, beto, 'tareas', { data: {} });
            expect(r.data[key(estado)]).toBe('nuevo');
            expect(r.data[key(fecha)]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(r.data[key(responsable)]).toBe(beto.userId);
            expect(r.data[key(nota)]).toBe('  Sin revisar  ');
            const r2 = await records.create(tenantId, beto, 'tareas', { data: { [key(estado)]: null, [key(nota)]: 'otra' } });
            expect(r2.data[key(estado)]).toBeNull();
            expect(r2.data[key(nota)]).toBe('otra');
            // El sistema no es «quien lo crea».
            const r3 = await records.create(tenantId, system, 'tareas', { data: {} });
            expect(r3.data[key(responsable)]).toBeUndefined();
        });

        it('un valor por defecto inválido no se guarda', async () => {
            await badRequest(fields.update(tenantId, 'tareas', String(estado), { config: { options: [{ value: 'nuevo', label: 'Nuevo' }], default_value: { kind: 'value', value: 'inexistente' } } }));
            // Un tipo de default que no aplica se descarta.
            const f = await fields.update(tenantId, 'tareas', String(nota), { config: { default_value: { kind: 'today' } } });
            expect(f.config.default_value).toBeUndefined();
        });
    });

    describe('Validaciones', () => {
        let monto: number;
        let nit: number;
        let tipo: number;
        let codigo: number;

        beforeAll(async () => {
            await lists.create(tenantId, { name: 'Proveedores', slug: 'proveedores' });
            tipo = (await fields.create(tenantId, 'proveedores', {
                label: 'Tipo',
                type: 'select',
                slug: 'tipo',
                config: { options: [{ value: 'empresa', label: 'Empresa' }, { value: 'persona', label: 'Persona' }] },
            })).id;
            monto = (await fields.create(tenantId, 'proveedores', {
                label: 'Cupo',
                type: 'currency',
                slug: 'cupo',
                config: { currency: 'COP', validation: { min: 0, max: 1000000, range_message: 'El cupo va de 0 a un millón' } },
            })).id;
            nit = (await fields.create(tenantId, 'proveedores', {
                label: 'NIT',
                type: 'text',
                slug: 'nit',
                config: { validation: { format: 'nit', required_if: { field_id: tipo, op: 'eq', value: 'empresa' } } },
            })).id;
            codigo = (await fields.create(tenantId, 'proveedores', {
                label: 'Código',
                type: 'text',
                slug: 'codigo',
                config: { validation: { format: 'regex', pattern: 'PRV-\\d{3}', format_message: 'Usa PRV-000' } },
            })).id;
        });

        it('mínimo/máximo, formato y expresión propia con sus mensajes', async () => {
            await expect(records.create(tenantId, ana, 'proveedores', { data: { [key(monto)]: 2000000 } })).rejects.toMatchObject({
                response: { code: 'validation_failed', data: { errors: { cupo: 'El cupo va de 0 a un millón' } } },
            });
            await expect(records.create(tenantId, ana, 'proveedores', { data: { [key(nit)]: '890903938-7' } })).rejects.toMatchObject({
                response: { data: { errors: { nit: expect.stringContaining('NIT') } } },
            });
            await expect(records.create(tenantId, ana, 'proveedores', { data: { [key(codigo)]: 'PRV-12' } })).rejects.toMatchObject({
                response: { data: { errors: { codigo: 'Usa PRV-000' } } },
            });
            const ok = await records.create(tenantId, ana, 'proveedores', { data: { [key(nit)]: '890.903.938-8', [key(codigo)]: 'PRV-123', [key(monto)]: 500 } });
            expect(ok.data[key(codigo)]).toBe('PRV-123');
        });

        it('obligatorio si…: en el alta y cuando cambia la condición, no al editar otra cosa', async () => {
            await expect(records.create(tenantId, ana, 'proveedores', { data: { [key(tipo)]: 'empresa' } })).rejects.toMatchObject({
                response: { data: { errors: { nit: '«NIT» es obligatorio cuando «Tipo» es «Empresa».' } } },
            });
            const persona = await records.create(tenantId, ana, 'proveedores', { data: { [key(tipo)]: 'persona' } });
            await expect(records.update(tenantId, ana, 'proveedores', persona.id, { data: { [key(tipo)]: 'empresa' } })).rejects.toMatchObject({
                response: { data: { errors: { nit: expect.any(String) } } },
            });
            // Un registro viejo que no cumple (cargado antes de la regla) se puede editar en otra cosa.
            const list = await lists.get(tenantId, 'proveedores');
            const [legacy] = await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(recordsTable).values({ tenantId, listId: list.id, data: { [key(tipo)]: 'empresa' }, createdBy: ana.userId }).returning(),
            );
            const edited = await records.update(tenantId, ana, 'proveedores', legacy!.id, { data: { [key(monto)]: 10 } });
            expect(edited.data[key(monto)]).toBe(10);
        });

        it('una expresión regular peligrosa no se guarda', async () => {
            await badRequest(fields.update(tenantId, 'proveedores', String(codigo), { config: { validation: { format: 'regex', pattern: '(a+)+$' } } }));
            await badRequest(fields.update(tenantId, 'proveedores', String(codigo), { config: { validation: { format: 'regex', pattern: '(x)\\1' } } }));
            // "Obligatorio si" de sí mismo o de un campo ajeno, tampoco.
            await badRequest(fields.update(tenantId, 'proveedores', String(nit), { config: { validation: { required_if: { field_id: nit, op: 'not_empty' } } } }));
            await badRequest(fields.update(tenantId, 'proveedores', String(nit), { config: { validation: { required_if: { field_id: 999999, op: 'not_empty' } } } }));
            await badRequest(fields.update(tenantId, 'proveedores', String(monto), { config: { currency: 'COP', validation: { min: 10, max: 1 } } }));
        });
    });

    it('RLS: los contadores de otra empresa no se ven', async () => {
        const [other] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        const visible = await withTenant(pg.db, other!.id, (tx) => tx.select().from(autonumberCounters));
        expect(visible).toEqual([]);
        const mine = await withTenant(pg.db, tenantId, (tx) => tx.select().from(autonumberCounters));
        expect(mine.length).toBeGreaterThan(0);
    });
});
