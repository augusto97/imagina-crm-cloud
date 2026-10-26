import { customRoleKey, normalizeScanCode, pickScanField, readScanFieldId, scanCodeAsNumber, type Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { lists, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordSearchService } from '../src/records/record-search.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };
const viewer: Actor = { userId: 3, role: 'viewer' };

describe('H3 — códigos (puro)', () => {
    it('normaliza: bordes y caracteres de control fuera (GS1), el resto igual', () => {
        expect(normalizeScanCode('  7701234567890\n')).toBe('7701234567890');
        expect(normalizeScanCode('\u001d01095060001343521\u001d')).toBe('01095060001343521');
        expect(normalizeScanCode('TCK-0001')).toBe('TCK-0001');
    });

    it('número sólo si lo es de verdad (y entra en un double sin perder dígitos)', () => {
        expect(scanCodeAsNumber('0123')).toBe(123);
        expect(scanCodeAsNumber('12.5')).toBe(12.5);
        expect(scanCodeAsNumber('7701234567890')).toBe(7701234567890);
        expect(scanCodeAsNumber('12345678901234567')).toBeNull();
        expect(scanCodeAsNumber('ABC-1')).toBeNull();
    });

    it('el campo «Código»: el elegido o el que lo dice en el nombre', () => {
        const fs = [
            { id: 1, slug: 'nombre', label: 'Nombre', type: 'text' },
            { id: 2, slug: 'sku', label: 'SKU', type: 'text' },
            { id: 3, slug: 'serial', label: 'Serial', type: 'number' },
            { id: 4, slug: 'precio', label: 'Precio', type: 'currency' },
        ];
        expect(pickScanField(fs, {})?.id).toBe(2);
        expect(pickScanField(fs, { scan_field_id: 3 })?.id).toBe(3);
        // Un elegido que ya no sirve (tipo moneda) cae a la heurística.
        expect(pickScanField(fs, { scan_field_id: 4 })?.id).toBe(2);
        expect(pickScanField([fs[0]!, fs[3]!], {})).toBeNull();
        expect(readScanFieldId({ scan_field_id: '7' })).toBe(7);
        expect(readScanFieldId({ scan_field_id: 'x' })).toBeNull();
    });
});

/**
 * `GET /search/code`: el código escaneado, exacto, en las listas que la
 * persona ve — con el mismo ACL del listado y de la búsqueda global.
 */
describe('H3 — búsqueda de un código escaneado (Postgres real)', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let recs: RecordsService;
    let search: RecordSearchService;
    let tenantId: number;
    let otherTenant: number;
    const f: Record<string, Field> = {};
    const ids: Record<string, number> = {};

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
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
        search = new RecordSearchService(tenantDb);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;

        await lists_.create(tenantId, { name: 'Inventario' });
        f.nombre = await fields_.create(tenantId, 'inventario', { label: 'Producto', type: 'text', slug: 'producto' });
        f.sku = await fields_.create(tenantId, 'inventario', { label: 'SKU', type: 'text', slug: 'sku' });
        f.ean = await fields_.create(tenantId, 'inventario', { label: 'EAN', type: 'number', slug: 'ean' });
        f.costo = await fields_.create(tenantId, 'inventario', { label: 'Costo interno', type: 'text', slug: 'costo' });
        await lists_.create(tenantId, { name: 'Entradas' });
        f.asistente = await fields_.create(tenantId, 'entradas', { label: 'Asistente', type: 'text', slug: 'asistente' });
        f.boleta = await fields_.create(tenantId, 'entradas', { label: 'Código de boleta', type: 'text', slug: 'boleta' });

        const k = (x: Field): string => `f${x.id}`;
        ids.taza = (await recs.create(tenantId, admin, 'inventario', { data: { [k(f.nombre!)]: 'Taza', [k(f.sku!)]: 'TZ-001', [k(f.ean!)]: 7701234567890, [k(f.costo!)]: 'SECRETO-9' } })).id;
        ids.libreta = (await recs.create(tenantId, agent, 'inventario', { data: { [k(f.nombre!)]: 'Libreta', [k(f.sku!)]: 'LB-77', [k(f.ean!)]: 123 } })).id;
        ids.ana = (await recs.create(tenantId, admin, 'entradas', { data: { [k(f.asistente!)]: 'Ana Pérez', [k(f.boleta!)]: 'tz-001' } })).id;
        await lists_.create(otherTenant, { name: 'Inventario' });
        const other = await fields_.create(otherTenant, 'inventario', { label: 'SKU', type: 'text', slug: 'sku' });
        await recs.create(otherTenant, admin, 'inventario', { data: { [`f${other.id}`]: 'TZ-001' } });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    const find = (actor: Actor, code: string, extra: { list?: string; field?: number } = {}) =>
        search.findByCode(tenantId, actor, { code, limit: 20, ...extra });

    it('global: exacto, sin mayúsculas ni espacios, en todas las listas visibles (nunca otra empresa)', async () => {
        const r = await find(admin, '  tz-001 ');
        expect(r.code).toBe('tz-001');
        expect(r.hits.map((h) => [h.list_slug, h.title, h.field_label]).sort()).toEqual([
            ['entradas', 'Ana Pérez', 'Código de boleta'],
            ['inventario', 'Taza', 'SKU'],
        ]);
        // Exacto: un pedazo no encuentra nada.
        expect((await find(admin, 'TZ-00')).hits).toEqual([]);
    });

    it('un código numérico encuentra el número guardado (con ceros a la izquierda también)', async () => {
        expect((await find(admin, '7701234567890')).hits.map((h) => h.record_id)).toEqual([ids.taza]);
        expect((await find(admin, '000123')).hits.map((h) => [h.record_id, h.field_label])).toEqual([[ids.libreta, 'EAN']]);
    });

    it('en una lista: busca por su campo «Código» (el elegido o el que lo dice en el nombre)', async () => {
        // Entradas: «Código de boleta» se reconoce solo.
        const r = await find(admin, 'TZ-001', { list: 'entradas' });
        expect(r.field_id).toBe(f.boleta!.id);
        expect(r.hits.map((h) => h.record_id)).toEqual([ids.ana]);
        // Inventario: «SKU» por el nombre; si se elige EAN, el SKU no cuenta.
        expect((await find(admin, 'TZ-001', { list: 'inventario' })).field_id).toBe(f.sku!.id);
        await lists_.update(tenantId, 'inventario', { settings: { scan_field_id: f.ean!.id } });
        const byEan = await find(admin, 'TZ-001', { list: String((await lists_.get(tenantId, 'inventario')).id) });
        expect(byEan).toMatchObject({ field_id: f.ean!.id, hits: [] });
        expect((await find(admin, '123', { list: 'inventario' })).hits.map((h) => h.record_id)).toEqual([ids.libreta]);
        // Un campo puntual que no sirve → 400.
        await expect(find(admin, 'x', { list: 'inventario', field: f.nombre!.id + 999 })).rejects.toMatchObject({ response: { code: 'scan_field_invalid' } });
        await lists_.update(tenantId, 'inventario', { settings: {} });
    });

    it('el campo «Código» de la lista se valida al guardar', async () => {
        await expect(lists_.update(tenantId, 'entradas', { settings: { scan_field_id: f.sku!.id } })).rejects.toMatchObject({
            response: { code: 'invalid_scan_field' },
        });
        await expect(lists_.update(tenantId, 'entradas', { settings: { scan_field_id: 999999 } })).rejects.toMatchObject({
            response: { code: 'invalid_scan_field' },
        });
        await lists_.update(tenantId, 'entradas', { settings: { scan_field_id: f.boleta!.id } });
        expect(readScanFieldId((await lists_.get(tenantId, 'entradas')).settings)).toBe(f.boleta!.id);
    });

    it('ACL: el scope del rol y los campos ocultos (buscar por uno sería un oráculo)', async () => {
        // El agente sólo ve lo que creó (la taza y la boleta las creó el admin).
        expect((await find(agent, 'TZ-001')).hits).toEqual([]);
        expect((await find(agent, 'LB-77')).hits.map((h) => h.record_id)).toEqual([ids.libreta]);
        // Un campo oculto para el rol no se busca.
        expect((await find(viewer, 'SECRETO-9')).hits.map((h) => h.record_id)).toEqual([ids.taza]);
        await lists_.updatePermissions(tenantId, 'inventario', {
            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['sku', 'costo'] } },
        });
        expect((await find(viewer, 'SECRETO-9')).hits).toHaveLength(0);
        expect((await find(admin, 'SECRETO-9')).hits.map((h) => h.record_id)).toEqual([ids.taza]);
        expect((await find(viewer, 'TZ-001')).hits.map((h) => h.list_slug)).toEqual(['entradas']);
        await lists_.updatePermissions(tenantId, 'entradas', {
            permissions: { viewer: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });
        expect((await find(viewer, 'TZ-001')).hits).toEqual([]);
        // El cliente del portal no busca nada; el texto viaja bindeado.
        expect((await search.findByCode(tenantId, { userId: 9, role: 'client' }, { code: 'TZ-001', limit: 20 })).hits).toEqual([]);
        expect((await find(admin, "'; drop table records; --")).hits).toEqual([]);
        expect((await find(admin, '%')).hits).toEqual([]);
    });

    it('rol propio: su fila en el acceso de la lista manda (alcance y campos ocultos)', async () => {
        await lists_.update(tenantId, 'inventario', { settings: {} });
        const k = customRoleKey(77);
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(lists)
                .set({ settings: { permissions: { permissions: { [k]: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['sku'] } } } } })
                .where(eq(lists.slug, 'inventario')),
        );
        const propio: Actor = { userId: 2, role: 'agent', customRoleId: 77 };
        // Un agente común sólo ve lo suyo; con el rol propio ve todo el inventario…
        expect((await find(agent, '7701234567890')).hits).toEqual([]);
        expect((await find(propio, '7701234567890')).hits.map((h) => h.record_id)).toEqual([ids.taza]);
        // …pero el SKU le está oculto: buscar por él no encuentra nada en esa lista.
        expect((await find(propio, 'LB-77', { list: 'inventario' })).hits).toEqual([]);
        await lists_.update(tenantId, 'inventario', { settings: {} });
    });

    it('lo que está en la papelera no aparece (un registro o la lista entera)', async () => {
        await recs.remove(tenantId, admin, 'inventario', ids.libreta!);
        expect((await find(admin, 'LB-77')).hits).toEqual([]);
        await lists_.update(tenantId, 'entradas', { settings: {} });
        expect((await find(admin, 'TZ-001')).hits.map((h) => h.list_slug).sort()).toEqual(['entradas', 'inventario']);
        await lists_.remove(tenantId, 'entradas', { userId: 1 });
        expect((await find(admin, 'TZ-001')).hits.map((h) => h.list_slug)).toEqual(['inventario']);
        await expect(find(admin, 'TZ-001', { list: 'entradas' })).rejects.toMatchObject({ response: { code: 'list_not_found' } });
    });
});
