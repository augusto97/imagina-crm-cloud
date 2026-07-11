import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ImportService } from '../src/import/import.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

describe('ImportService (Postgres real)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let importService: ImportService;
    let tenantId: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            activity,
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        importService = new ImportService(
            tenantDb,
            listsService,
            fieldsService,
            new RecordsRepository(),
            new BillingService(tenantDb, new PlansService(pg.db)),
            rt,
        );

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'ACME', plan: 'enterprise' })
            .returning();
        tenantId = t!.id;
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
        await listsService.create(tenantId, { name: 'Clientes' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }] },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fieldsService.create(tenantId, 'clientes', d);
    });

    it('importa filas válidas mapeando columnas → campos', async () => {
        const res = await importService.importRows(tenantId, admin.userId, 'clientes', {
            mapping: { Nombre: f.nombre!.id, Importe: f.monto!.id, Estado: f.estado!.id },
            rows: [
                { Nombre: 'ACME', Importe: '1000', Estado: 'activo' },
                { Nombre: 'Globex', Importe: '500', Estado: 'activo' },
            ],
        });
        expect(res).toMatchObject({ imported: 2, skipped: 0 });
        expect(res.errors).toHaveLength(0);

        const page = await recordsService.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(page.data.map((r) => r.data[`f${f.nombre!.id}`]).sort()).toEqual(['ACME', 'Globex']);
        expect(page.data[0]!.data[`f${f.monto!.id}`]).toBe(1000); // currency normalizado a number
    });

    it('reporta errores por fila y NO inserta las inválidas', async () => {
        const res = await importService.importRows(tenantId, admin.userId, 'clientes', {
            mapping: { Nombre: f.nombre!.id, Importe: f.monto!.id, Estado: f.estado!.id },
            rows: [
                { Nombre: 'Bien', Importe: '10', Estado: 'activo' },
                { Nombre: 'Mal', Importe: 'no-numero', Estado: 'activo' }, // currency inválido
                { Nombre: 'Mal2', Importe: '5', Estado: 'inexistente' }, // opción inválida
            ],
        });
        expect(res.imported).toBe(1);
        expect(res.skipped).toBe(2);
        expect(res.errors.map((e) => e.field).sort()).toEqual(['estado', 'monto']);
    });

    // --- Import CSV en dos pasos (preview + run) ----------------------------

    it('preview: cabeceras, muestra, sugerencia de mapping y tipos', async () => {
        const csv = 'Nombre,Importe,Estado\nACME,1000,Activo\nGlobex,500,Activo\n';
        const res = await importService.preview(tenantId, 'clientes', csv);
        expect(res.headers).toEqual(['Nombre', 'Importe', 'Estado']);
        expect(res.total_rows).toBe(2);
        expect(res.sample).toHaveLength(2);
        // "Nombre" matchea el campo nombre; "Estado" el select estado.
        expect(res.suggested_mapping['0']).toBe('nombre');
        expect(res.suggested_mapping['2']).toBe('estado');
        expect(res.suggested_types['1']).toBe('number');
        expect(res.fields.map((x) => x.slug)).toEqual(['nombre', 'monto', 'estado']);
    });

    it('run: importa resolviendo etiquetas de select y expandiendo opciones nuevas', async () => {
        // "Activo" existe (label de la opción `activo`); "Vencido" no → se
        // auto-añade como opción y las filas entran igual.
        const csv = 'Nombre;Importe;Estado\nACME;1.000,50;Activo\nGlobex;500;Vencido\n';
        const res = await importService.runCsv(tenantId, admin.userId, 'clientes', {
            csv,
            mapping: { '0': 'nombre', '1': 'monto', '2': 'estado' },
            new_fields: [],
        });
        expect(res.imported).toBe(2);
        expect(res.errors).toHaveLength(0);
        expect(res.expanded_options.estado).toEqual([{ value: 'vencido', label: 'Vencido' }]);

        const page = await recordsService.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        const acme = page.data.find((r) => r.data[`f${f.nombre!.id}`] === 'ACME')!;
        expect(acme.data[`f${f.monto!.id}`]).toBe(1000.5); // "1.000,50" (ES) → number
        const globex = page.data.find((r) => r.data[`f${f.nombre!.id}`] === 'Globex')!;
        expect(globex.data[`f${f.estado!.id}`]).toBe('vencido'); // etiqueta → value
    });

    it('run: crea campos nuevos on-the-fly y reporta columnas sin mapping con datos', async () => {
        const csv = 'Nombre,Email,Notas\nACME,a@x.com,algo importante\n';
        const res = await importService.runCsv(tenantId, admin.userId, 'clientes', {
            csv,
            mapping: { '0': 'nombre' },
            new_fields: [{ csv_column_index: 1, label: 'Email', type: 'email' }],
        });
        expect(res.imported).toBe(1);
        expect(res.created_fields).toEqual([{ slug: 'email', label: 'Email', type: 'email' }]);
        // La columna "Notas" quedó sin mapping y tenía datos → visible.
        expect(res.unmapped_columns_with_data).toMatchObject([
            { column_index: 2, header: 'Notas', rows_with_data: 1 },
        ]);
        const page = await recordsService.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        const created = await fieldsService.get(tenantId, 'clientes', 'email');
        expect(page.data[0]!.data[`f${created.id}`]).toBe('a@x.com');
    });

    it('run: celdas con comillas/saltos de línea y filas inválidas reportadas', async () => {
        const csv = 'Nombre,Importe\n"Linea1\nLinea2, S.A.",10\nMal,no-numero\n';
        const res = await importService.runCsv(tenantId, admin.userId, 'clientes', {
            csv,
            mapping: { '0': 'nombre', '1': 'monto' },
            new_fields: [],
        });
        expect(res.imported).toBe(1);
        expect(res.skipped).toBe(1);
        expect(res.errors).toHaveLength(1);
        expect(res.errors[0]!.row).toBe(3); // 1-indexed + header
        const page = await recordsService.list(tenantId, admin, 'clientes', { limit: 50, sort_dir: 'asc' });
        expect(page.data[0]!.data[`f${f.nombre!.id}`]).toBe('Linea1\nLinea2, S.A.');
    });

    it('mapeo a un campo inexistente → 400', async () => {
        await expect(
            importService.importRows(tenantId, admin.userId, 'clientes', {
                mapping: { X: 999999 },
                rows: [{ X: 'y' }],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    // SEC-09: el import valida el LOTE completo contra el tope del plan, no
    // solo "cabe uno más". Con 499/500 usados, importar 2 debe rechazarse.
    it('rechaza un import que supera el límite de plan (lote completo)', async () => {
        const list = await listsService.get(tenantId, 'clientes');
        // Plan con tope bajo (trial = 500) para el escenario.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId)),
        );
        // Pre-cargar 499 registros de una.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values(
                Array.from({ length: 499 }, () => ({
                    tenantId,
                    listId: list.id,
                    data: { [`f${f.nombre!.id}`]: 'x' },
                    createdBy: admin.userId,
                })),
            ),
        );
        try {
            await expect(
                importService.importRows(tenantId, admin.userId, 'clientes', {
                    mapping: { Nombre: f.nombre!.id },
                    rows: [{ Nombre: 'A' }, { Nombre: 'B' }], // 499 + 2 = 501 > 500
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);

            // No se insertó ninguna fila del lote rechazado.
            const [row] = await withTenant(pg.db, tenantId, (tx) =>
                tx
                    .select({ n: sql<number>`count(*)::int` })
                    .from(records)
                    .where(eq(records.tenantId, tenantId)),
            );
            expect(row?.n).toBe(499);
        } finally {
            await withTenant(pg.db, tenantId, (tx) =>
                tx.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantId)),
            );
        }
    });
});
