import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportBundleSchema } from '@imagina-base/shared';
import { tenants } from '../src/db/schema';
import { ExportService } from '../src/export/export.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

describe('ExportService (Postgres real)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let viewsService: ViewsService;
    let exportService: ExportService;
    let tenantId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        viewsService = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);
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
        exportService = new ExportService(tenantDb, listsService, fieldsService, viewsService, recordsService);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('exporta el bundle completo (list + fields + views + records) y valida el schema', async () => {
        const list = await listsService.create(tenantId, { name: 'Clientes' });
        const f = await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        await viewsService.create(tenantId, 'clientes', { name: 'Tabla', type: 'table', is_default: true });
        for (const n of ['A', 'B', 'C']) {
            await recordsService.create(tenantId, admin, 'clientes', { data: { [`f${f.id}`]: n } });
        }

        const bundle = await exportService.exportList(tenantId, 'clientes', '2026-07-08T00:00:00.000Z');

        expect(exportBundleSchema.parse(bundle)).toBeTruthy();
        expect(bundle.version).toBe(1);
        expect(bundle.list.id).toBe(list.id);
        expect(bundle.fields.map((x) => x.slug)).toEqual(['nombre']);
        expect(bundle.views).toHaveLength(1);
        expect(bundle.records.map((r) => r.data[`f${f.id}`])).toEqual(['A', 'B', 'C']);
    });

    it('streamCsvExport: CSV con seleccion de campos, delimiter, BOM y filtro', async () => {
        await listsService.create(tenantId, { name: 'Ventas' });
        const nombre = await fieldsService.create(tenantId, 'ventas', { label: 'Nombre', type: 'text', slug: 'nombre' });
        const monto = await fieldsService.create(tenantId, 'ventas', { label: 'Monto', type: 'number', slug: 'monto' });
        await recordsService.create(tenantId, admin, 'ventas', {
            data: { [`f${nombre.id}`]: 'Acme, S.A.', [`f${monto.id}`]: 10 },
        });
        await recordsService.create(tenantId, admin, 'ventas', {
            data: { [`f${nombre.id}`]: 'Globex', [`f${monto.id}`]: 99 },
        });

        let filename = '';
        let out = '';
        await exportService.streamCsvExport(
            tenantId,
            admin,
            'ventas',
            { fieldIds: [monto.id, nombre.id], delimiter: ',', withBom: true },
            (f) => { filename = f; },
            (c) => { out += c; },
        );
        expect(filename).toBe('ventas.csv');
        expect(out.startsWith('\uFEFF')).toBe(true);
        const lines = out.replace('\uFEFF', '').trimEnd().split('\r\n');
        // Orden de columnas = orden pedido (monto primero); quoting RFC-4180.
        expect(lines[0]).toBe('Monto,Nombre');
        expect(lines[1]).toBe('10,"Acme, S.A."');
        expect(lines[2]).toBe('99,Globex');

        // Con filter_tree solo salen las filas que matchean.
        let filtered = '';
        await exportService.streamCsvExport(
            tenantId,
            admin,
            'ventas',
            {
                fieldIds: [nombre.id],
                delimiter: ';',
                withBom: false,
                filterTree: {
                    type: 'group',
                    logic: 'and',
                    children: [
                        { type: 'condition', field_id: monto.id, op: 'gt', value: 50 },
                    ],
                },
            },
            () => {},
            (c) => { filtered += c; },
        );
        expect(filtered.trimEnd().split('\r\n')).toEqual(['Nombre', 'Globex']);
    });

    // SEC-10: el streaming produce EXACTAMENTE el mismo bundle JSON.
    it('streamExport produce el mismo bundle JSON válido', async () => {
        const list = await listsService.create(tenantId, { name: 'Stream' });
        const f = await fieldsService.create(tenantId, 'stream', {
            label: 'Nombre',
            type: 'text',
            slug: 'nombre',
        });
        for (const n of ['X', 'Y']) {
            await recordsService.create(tenantId, admin, 'stream', { data: { [`f${f.id}`]: n } });
        }

        let out = '';
        await exportService.streamExport(tenantId, 'stream', '2026-07-08T00:00:00.000Z', (c) => {
            out += c;
        });
        const parsed = exportBundleSchema.parse(JSON.parse(out));
        expect(parsed.version).toBe(1);
        expect(parsed.list.id).toBe(list.id);
        expect(parsed.fields.map((x) => x.slug)).toEqual(['nombre']);
        expect(parsed.records.map((r) => r.data[`f${f.id}`])).toEqual(['X', 'Y']);
    });

    it('paginación keyset: exporta más de 1000 records', async () => {
        const list = await listsService.create(tenantId, { name: 'Grande' });
        const f = await fieldsService.create(tenantId, 'grande', { label: 'N', type: 'number', slug: 'n' });
        // Inserta 1500 records por lote (evita 1500 round-trips).
        const key = `f${f.id}`;
        await pg.db.transaction(async (tx) => {
            const { sql } = await import('drizzle-orm');
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);
            await tx.execute(sql`set local role imagina_app`);
            const { records } = await import('../src/db/schema');
            await tx.insert(records).values(
                Array.from({ length: 1500 }, (_v, i) => ({
                    tenantId,
                    listId: list.id,
                    createdBy: 0,
                    data: { [key]: i },
                })),
            );
        });

        const bundle = await exportService.exportList(tenantId, 'grande', '2026-07-08T00:00:00.000Z');
        expect(bundle.records).toHaveLength(1500);
    });
});
