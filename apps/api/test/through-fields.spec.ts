import { BadRequestException } from '@nestjs/common';
import type { Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

/**
 * Campos lookup / rollup a través de una relación (v0.1.170, ADR-S19).
 * Escenario: Clientes ← Facturas.cliente. Un lookup HACIA AFUERA en Facturas
 * (teléfono del cliente) y rollups HACIA ADENTRO en Clientes (cantidad de
 * facturas, total facturado, deuda = suma de las pendientes, última fecha).
 */
describe('lookup / rollup a través de relation (Postgres real)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let records_: RecordsService;
    let aggregate: AggregateService;
    let tenantA: number;
    let tenantB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        records_ = new RecordsService(
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
        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        await pg.db.insert(users).values({ email: 'a@acme.test', passwordHash: 'x', name: 'Ana' });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    interface Setup {
        clientes: { id: number; nombre: Field; telefono: Field };
        facturas: { id: number; numero: Field; monto: Field; estado: Field; fecha: Field; cliente: Field };
        c1: number;
        c2: number;
    }

    async function setup(): Promise<Setup> {
        await listsService.create(tenantA, { name: 'Clientes' });
        await listsService.create(tenantA, { name: 'Facturas' });
        const clientes = await listsService.get(tenantA, 'clientes');
        const facturas = await listsService.get(tenantA, 'facturas');
        const nombre = await fieldsService.create(tenantA, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        const telefono = await fieldsService.create(tenantA, 'clientes', { label: 'Teléfono', type: 'phone', slug: 'telefono' });
        const numero = await fieldsService.create(tenantA, 'facturas', { label: 'Número', type: 'text', slug: 'numero' });
        const monto = await fieldsService.create(tenantA, 'facturas', { label: 'Monto', type: 'currency', slug: 'monto' });
        const estado = await fieldsService.create(tenantA, 'facturas', {
            label: 'Estado', type: 'select', slug: 'estado',
            config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] },
        });
        const fecha = await fieldsService.create(tenantA, 'facturas', { label: 'Fecha', type: 'date', slug: 'fecha' });
        const cliente = await fieldsService.create(tenantA, 'facturas', {
            label: 'Cliente', type: 'relation', slug: 'cliente', config: { target_list_id: clientes.id },
        });
        const c1 = await records_.create(tenantA, admin, 'clientes', {
            data: { [`f${nombre.id}`]: 'Acme', [`f${telefono.id}`]: '+573001112233' },
        });
        const c2 = await records_.create(tenantA, admin, 'clientes', {
            data: { [`f${nombre.id}`]: 'Globex', [`f${telefono.id}`]: '+573009998877' },
        });
        const inv = async (n: string, m: number, e: string, f: string, c: number) =>
            records_.create(tenantA, admin, 'facturas', {
                data: {
                    [`f${numero.id}`]: n, [`f${monto.id}`]: m, [`f${estado.id}`]: e, [`f${fecha.id}`]: f, [`f${cliente.id}`]: [c],
                },
            });
        await inv('F-1', 100, 'pagada', '2026-01-10', c1.id);
        await inv('F-2', 250, 'pendiente', '2026-02-15', c1.id);
        await inv('F-3', 50, 'pendiente', '2026-03-01', c1.id);
        await inv('F-4', 900, 'pagada', '2026-01-20', c2.id);
        return {
            clientes: { id: clientes.id, nombre, telefono },
            facturas: { id: facturas.id, numero, monto, estado, fecha, cliente },
            c1: c1.id,
            c2: c2.id,
        };
    }

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(records).where(eq(records.tenantId, t));
                await tx.delete(fields).where(eq(fields.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
    });

    it('lookup hacia afuera: la factura muestra el teléfono de su cliente (y no se escribe)', async () => {
        const s = await setup();
        const lk = await fieldsService.create(tenantA, 'facturas', {
            label: 'Teléfono del cliente', type: 'lookup', slug: 'tel_cliente',
            config: { relation_field_id: s.facturas.cliente.id, target_field_id: s.clientes.telefono.id },
        });
        const page = await records_.list(tenantA, admin, 'facturas', { limit: 50, sort_dir: 'asc' });
        const byNumero = new Map(page.data.map((r) => [r.data[`f${s.facturas.numero.id}`], r]));
        expect(byNumero.get('F-1')!.data[`f${lk.id}`]).toEqual(['+573001112233']);
        expect(byNumero.get('F-4')!.data[`f${lk.id}`]).toEqual(['+573009998877']);
        // Lectura individual, igual.
        const one = await records_.get(tenantA, admin, 'facturas', byNumero.get('F-2')!.id);
        expect(one.data[`f${lk.id}`]).toEqual(['+573001112233']);
        // No se escribe.
        await expect(
            records_.update(tenantA, admin, 'facturas', one.id, { data: { [`f${lk.id}`]: ['x'] } }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // El DTO de campos trae la relación resuelta para que la UI formatee.
        const dto = (await fieldsService.list(tenantA, 'facturas')).find((f) => f.id === lk.id)!;
        expect(dto.through?.direction).toBe('forward');
        expect(dto.through?.other_list_name).toBe('Clientes');
        expect(dto.through?.target_field?.type).toBe('phone');
    });

    it('rollup hacia adentro: cuenta, suma, suma filtrada (deuda) y última fecha; filtra y ordena por el rollup', async () => {
        const s = await setup();
        const mk = (label: string, slug: string, config: Record<string, unknown>) =>
            fieldsService.create(tenantA, 'clientes', { label, type: 'rollup', slug, config });
        const rel = s.facturas.cliente.id;
        const nFact = await mk('Facturas', 'n_facturas', { relation_field_id: rel, operation: 'count' });
        const total = await mk('Total', 'total', { relation_field_id: rel, target_field_id: s.facturas.monto.id, operation: 'sum' });
        const deuda = await mk('Deuda', 'deuda', {
            relation_field_id: rel, target_field_id: s.facturas.monto.id, operation: 'sum',
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: s.facturas.estado.id, op: 'eq', value: 'pendiente' }] },
        });
        const ultima = await mk('Última', 'ultima', { relation_field_id: rel, target_field_id: s.facturas.fecha.id, operation: 'max' });

        const page = await records_.list(tenantA, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        const acme = page.data.find((r) => r.id === s.c1)!;
        const globex = page.data.find((r) => r.id === s.c2)!;
        expect(acme.data[`f${nFact.id}`]).toBe(3);
        expect(acme.data[`f${total.id}`]).toBe(400);
        expect(acme.data[`f${deuda.id}`]).toBe(300);
        expect(acme.data[`f${ultima.id}`]).toBe('2026-03-01');
        expect(globex.data[`f${nFact.id}`]).toBe(1);
        expect(globex.data[`f${deuda.id}`]).toBe(0);

        // Filtrar por el rollup: sólo quien debe.
        const deudores = await records_.list(tenantA, admin, 'clientes', {
            limit: 50, sort_dir: 'asc',
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: deuda.id, op: 'gt', value: 0 }] },
        });
        expect(deudores.data.map((r) => r.id)).toEqual([s.c1]);
        // Ordenar por el rollup (desc): Globex (900) antes que Acme (400).
        const sorted = await records_.list(tenantA, admin, 'clientes', { limit: 50, sort_dir: 'asc', sort: `field_${total.id}:desc` });
        expect(sorted.data.map((r) => r.id)).toEqual([s.c2, s.c1]);

        // El pie de la tabla suma la columna rollup.
        const footer = await aggregate.footer(tenantA, 'clientes', { fieldIds: [deuda.id, total.id] });
        expect(footer.totals.deuda?.sum).toBe(300);
        expect(footer.totals.total?.sum).toBe(1300);

        // El DTO trae la dirección y el campo destino (moneda) para formatear.
        const dto = (await fieldsService.list(tenantA, 'clientes')).find((f) => f.id === total.id)!;
        expect(dto.through?.direction).toBe('reverse');
        expect(dto.through?.target_field?.type).toBe('currency');

        // Una factura soft-borrada deja de contar.
        const f3 = (await records_.list(tenantA, admin, 'facturas', { limit: 50, sort_dir: 'asc' })).data
            .find((r) => r.data[`f${s.facturas.numero.id}`] === 'F-3')!;
        await records_.remove(tenantA, admin, 'facturas', f3.id);
        const after = await records_.get(tenantA, admin, 'clientes', s.c1);
        expect(after.data[`f${nFact.id}`]).toBe(2);
        expect(after.data[`f${deuda.id}`]).toBe(250);
    });

    it('un computed puede usar el rollup como entrada (cobrado = total − deuda)', async () => {
        const s = await setup();
        const rel = s.facturas.cliente.id;
        const total = await fieldsService.create(tenantA, 'clientes', {
            label: 'Total', type: 'rollup', slug: 'total',
            config: { relation_field_id: rel, target_field_id: s.facturas.monto.id, operation: 'sum' },
        });
        const deuda = await fieldsService.create(tenantA, 'clientes', {
            label: 'Deuda', type: 'rollup', slug: 'deuda',
            config: {
                relation_field_id: rel, target_field_id: s.facturas.monto.id, operation: 'sum',
                filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: s.facturas.estado.id, op: 'eq', value: 'pendiente' }] },
            },
        });
        const cobrado = await fieldsService.create(tenantA, 'clientes', {
            label: 'Cobrado', type: 'computed', slug: 'cobrado',
            config: { operation: 'subtract', inputs: [total.id, deuda.id] },
        });
        const acme = await records_.get(tenantA, admin, 'clientes', s.c1);
        expect(acme.data[`f${cobrado.id}`]).toBe(100);
    });

    it('caminos de relación: la lista ofrece las relaciones propias y las que apuntan a ella', async () => {
        const s = await setup();
        const fromClientes = await fieldsService.relationPaths(tenantA, 'clientes');
        expect(fromClientes).toEqual([
            expect.objectContaining({ relation_field_id: s.facturas.cliente.id, direction: 'reverse', other_list_name: 'Facturas' }),
        ]);
        const fromFacturas = await fieldsService.relationPaths(tenantA, 'facturas');
        expect(fromFacturas).toEqual([
            expect.objectContaining({ relation_field_id: s.facturas.cliente.id, direction: 'forward', other_list_name: 'Clientes' }),
        ]);
    });

    it('valida la config: relación ajena, destino de otra lista, tipo incompatible; y un lookup roto sale vacío', async () => {
        const s = await setup();
        await listsService.create(tenantB, { name: 'Otra' });
        const otra = await listsService.get(tenantB, 'otra');
        const relB = await fieldsService.create(tenantB, 'otra', {
            label: 'R', type: 'relation', slug: 'r', config: { target_list_id: otra.id },
        });
        // Relación de otro tenant → no existe para este.
        await expect(
            fieldsService.create(tenantA, 'clientes', {
                label: 'X', type: 'rollup', slug: 'x', config: { relation_field_id: relB.id, operation: 'count' },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // Destino que no es de la lista del otro lado.
        await expect(
            fieldsService.create(tenantA, 'clientes', {
                label: 'X', type: 'lookup', slug: 'x2',
                config: { relation_field_id: s.facturas.cliente.id, target_field_id: s.clientes.nombre.id },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // Sumar un texto.
        await expect(
            fieldsService.create(tenantA, 'clientes', {
                label: 'X', type: 'rollup', slug: 'x3',
                config: { relation_field_id: s.facturas.cliente.id, target_field_id: s.facturas.numero.id, operation: 'sum' },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // Lookup que luego pierde su relación: sale vacío, no rompe el listado.
        const lk = await fieldsService.create(tenantA, 'facturas', {
            label: 'Tel', type: 'lookup', slug: 'tel',
            config: { relation_field_id: s.facturas.cliente.id, target_field_id: s.clientes.telefono.id },
        });
        await fieldsService.remove(tenantA, 'facturas', String(s.facturas.cliente.id));
        const page = await records_.list(tenantA, admin, 'facturas', { limit: 50, sort_dir: 'asc' });
        expect(page.data[0]!.data[`f${lk.id}`]).toEqual([]);
        const dto = (await fieldsService.list(tenantA, 'facturas')).find((f) => f.id === lk.id)!;
        expect(dto.through).toBeNull();
    });
});
