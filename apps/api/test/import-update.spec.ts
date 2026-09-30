import { BadRequestException } from '@nestjs/common';
import { type CreateFieldInput, type Field, type ImportUpdateInput, importUpdateSchema } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { activity, bulkEdits, fields, lists, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ImportUpdateService } from '../src/import/import-update.service';
import { ImportService } from '../src/import/import.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 0, role: 'admin' };

describe('actualizar registros desde un archivo (v0.1.219)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let updater: ImportUpdateService;
    let history: BulkHistoryService;
    let tenantId: number;
    let f: Record<string, Field>;

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
        const plans = new PlansService(pg.db);
        const billing = new BillingService(
            tenantDb,
            plans,
            new EmailQuotaService(pg.db, plans),
            new TenantSmtpService(pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' })),
        );
        const importer = new ImportService(tenantDb, lists_, fields_, new RecordsRepository(), billing, rt);
        history = new BulkHistoryService(tenantDb, lists_, recs, rt, new AuditService(tenantDb));
        updater = new ImportUpdateService(tenantDb, lists_, recs, importer, history, rt);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'a@acme.co', name: 'Ana', passwordHash: 'x' }).returning();
        admin.userId = u!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(bulkEdits).where(eq(bulkEdits.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Productos' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'SKU', type: 'text', slug: 'sku' },
            { label: 'Precio', type: 'currency', slug: 'precio', config: { precision: 0 } },
            { label: 'Stock', type: 'number', slug: 'stock' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'activo', label: 'Activo' }, { value: 'pausado', label: 'Pausado' }] },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields_.create(tenantId, 'productos', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;
    const make = (nombre: string, sku: string, precio: number, stock: number | null = 3) =>
        recs.create(tenantId, admin, 'productos', {
            data: { [key('nombre')]: nombre, [key('sku')]: sku, [key('precio')]: precio, [key('stock')]: stock, [key('estado')]: 'pausado' },
        });
    const input = (csv: string, extra: Partial<ImportUpdateInput> & { mapping: Record<string, string>; match: ImportUpdateInput['match'] }) =>
        importUpdateSchema.parse({ csv, ...extra });

    it('empareja por SKU (sin mayúsculas ni espacios), cambia sólo lo mapeado y se aplica por tramos que se pueden deshacer', async () => {
        const a = await make('Taza', 'AB-1', 100);
        const b = await make('Plato', 'ab-2', 50);
        await make('Uno', 'DUP', 1);
        await make('Otro', 'DUP', 2);
        const csv = 'SKU,Precio,Stock,Estado\n ab-1 ,150,,Activo\nAB-2,200,5,\nZZ-9,1,1,\nDUP,5,5,\nAB-1,999,,\n';
        const base = { mapping: { 1: 'precio', 2: 'stock', 3: 'estado' }, match: { column_index: 0, by: 'sku' } };

        const pv = await updater.preview(tenantId, admin, 'productos', input(csv, base));
        expect(pv).toMatchObject({ total_rows: 5, matched: 2, changed: 2, unmatched: 1, to_create: 0, error_count: 2 });
        expect(pv.unmatched_sample).toEqual([{ row: 4, key: 'ZZ-9' }]);
        expect(pv.errors.find((e) => e.row === 5)!.message).toMatch(/2 registros/);
        expect(pv.errors.find((e) => e.row === 6)!.message).toMatch(/fila 2/);
        const taza = pv.sample.find((s) => s.title === 'Taza')!;
        expect(taza.changes).toContainEqual({ label: 'Precio', before: '100', after: '150' });
        // La etiqueta de la opción, no su valor interno; y la celda vacía de Stock no cuenta.
        expect(taza.changes).toContainEqual({ label: 'Estado', before: 'Pausado', after: 'Activo' });
        expect(taza.changes.some((c) => c.label === 'Stock')).toBe(false);

        // Dos tramos de 3 filas: una sola edición en el historial.
        const r1 = await updater.apply(tenantId, admin, 'productos', input(csv, { ...base, row_offset: 0, row_limit: 3 }));
        const r2 = await updater.apply(tenantId, admin, 'productos', input(csv, { ...base, row_offset: 3, row_limit: 3, edit_id: r1.edit_id! }));
        expect(r1).toMatchObject({ updated: 2, unmatched: 1 });
        expect(r2.failed.map((x) => x.row).sort()).toEqual([5, 6]);
        expect(r2.edit_id).toBe(r1.edit_id);
        const ta = await recs.get(tenantId, admin, 'productos', a.id);
        expect(ta.data[key('precio')]).toBe(150);
        expect(ta.data[key('stock')]).toBe(3);
        expect(ta.data[key('estado')]).toBe('activo');
        expect((await recs.get(tenantId, admin, 'productos', b.id)).data[key('stock')]).toBe(5);

        const log = await history.list(tenantId, admin, 'productos');
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ item_count: 2 });
        expect(log[0]!.summary).toMatch(/Actualización desde archivo: .*Precio/);
        const rv = await history.revertPreview(tenantId, admin, 'productos', r1.edit_id!);
        const undo = await history.revertApply(tenantId, admin, 'productos', r1.edit_id!, rv.item_ids, false);
        expect(undo.reverted).toBe(2);
        const back = await recs.get(tenantId, admin, 'productos', a.id);
        expect(back.data[key('precio')]).toBe(100);
        expect(back.data[key('estado')]).toBe('pausado');
    });

    it('por ID del registro, y «vaciar si la celda está vacía»', async () => {
        const a = await make('Taza', 'AB-1', 100, 7);
        const csv = `ID,Stock,Precio\n${a.id},,120\n`;
        const pv = await updater.preview(tenantId, admin, 'productos', input(csv, { mapping: { 1: 'stock', 2: 'precio' }, match: { column_index: 0, by: '__id' }, clear_empty: true }));
        expect(pv.matched).toBe(1);
        expect(pv.sample[0]!.changes).toEqual([
            { label: 'Stock', before: '7', after: '—' },
            { label: 'Precio', before: '100', after: '120' },
        ]);
        await updater.apply(tenantId, admin, 'productos', input(csv, { mapping: { 1: 'stock', 2: 'precio' }, match: { column_index: 0, by: '__id' }, clear_empty: true }));
        const r = await recs.get(tenantId, admin, 'productos', a.id);
        expect(r.data[key('stock')] ?? null).toBeNull();
        expect(r.data[key('precio')]).toBe(120);
    });

    it('actualizar y crear lo que falta (upsert): el nuevo queda con su clave', async () => {
        await make('Taza', 'AB-1', 100);
        const csv = 'SKU,Nombre,Precio\nAB-1,Taza,110\nNEW-1,Jarra,300\n';
        const body = input(csv, { mapping: { 1: 'nombre', 2: 'precio' }, match: { column_index: 0, by: 'sku' }, mode: 'upsert' });
        const pv = await updater.preview(tenantId, admin, 'productos', body);
        expect(pv).toMatchObject({ matched: 1, changed: 1, unmatched: 1, to_create: 1 });
        const res = await updater.apply(tenantId, admin, 'productos', body);
        expect(res).toMatchObject({ updated: 1, created: 1 });
        const all = await recs.list(tenantId, admin, 'productos', { limit: 50, sort_dir: 'asc' });
        const jarra = all.data.find((r) => r.data[key('nombre')] === 'Jarra')!;
        expect(jarra.data[key('sku')]).toBe('NEW-1');
        expect(jarra.data[key('precio')]).toBe(300);
    });

    it('rechaza una columna clave que no sirve y un valor que el campo no acepta', async () => {
        await make('Taza', 'AB-1', 100);
        await expect(
            updater.preview(tenantId, admin, 'productos', input('Estado,Precio\nActivo,1\n', { mapping: { 1: 'precio' }, match: { column_index: 0, by: 'estado' } })),
        ).rejects.toBeInstanceOf(BadRequestException);
        const pv = await updater.preview(tenantId, admin, 'productos', input('SKU,Precio\nAB-1,caro\n', { mapping: { 1: 'precio' }, match: { column_index: 0, by: 'sku' } }));
        expect(pv.error_count).toBe(1);
        expect(pv.errors[0]!.message).toMatch(/^Precio:/);
    });
});
