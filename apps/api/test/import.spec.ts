import { BadRequestException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { BillingService } from '../src/billing/billing.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ImportService } from '../src/import/import.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
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
        );
        importService = new ImportService(
            tenantDb,
            listsService,
            fieldsService,
            new RecordsRepository(),
            new BillingService(tenantDb),
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

    it('mapeo a un campo inexistente → 400', async () => {
        await expect(
            importService.importRows(tenantId, admin.userId, 'clientes', {
                mapping: { X: 999999 },
                rows: [{ X: 'y' }],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
