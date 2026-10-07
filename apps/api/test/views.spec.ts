import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lists, savedViews, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime no-op para tests unitarios (sin servidor socket → no emite). */
const rt = new RealtimeService();

describe('ViewsService (Postgres real + RLS)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let service: ViewsService;
    let tenantA: number;
    let tenantB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        service = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(savedViews).where(eq(savedViews.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        await listsService.create(tenantA, { name: 'Clientes' });
    });

    it('create valida config por tipo y asigna posición', async () => {
        const table = await service.create(tenantA, 'clientes', {
            name: 'Tabla',
            type: 'table',
            config: { visible_field_ids: [1, 2], sort: [{ field_id: 1, dir: 'asc' }] },
        });
        expect(table).toMatchObject({ name: 'Tabla', type: 'table', position: 0 });
        expect(table.config).toMatchObject({ visible_field_ids: [1, 2] });

        const kanban = await service.create(tenantA, 'clientes', {
            name: 'Tablero',
            type: 'kanban',
            config: { group_by_field_id: 3 },
        });
        expect(kanban.position).toBe(1);
    });

    it('config inválida para el tipo → 400 (kanban sin group_by)', async () => {
        await expect(
            service.create(tenantA, 'clientes', { name: 'X', type: 'kanban', config: {} }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un solo default por lista: crear otro default desmarca el anterior', async () => {
        const a = await service.create(tenantA, 'clientes', {
            name: 'A',
            type: 'table',
            is_default: true,
        });
        const b = await service.create(tenantA, 'clientes', {
            name: 'B',
            type: 'table',
            is_default: true,
        });
        const all = await service.list(tenantA, 'clientes');
        const defaults = all.filter((v) => v.is_default);
        expect(defaults).toHaveLength(1);
        expect(defaults[0]!.id).toBe(b.id);
        expect((await service.get(tenantA, 'clientes', a.id)).is_default).toBe(false);
    });

    it('update: marcar default desmarca el previo; cambiar config valida', async () => {
        const a = await service.create(tenantA, 'clientes', { name: 'A', type: 'table', is_default: true });
        const b = await service.create(tenantA, 'clientes', { name: 'B', type: 'calendar', config: { date_field_id: 5 } });

        const updated = await service.update(tenantA, 'clientes', b.id, { is_default: true });
        expect(updated.is_default).toBe(true);
        expect((await service.get(tenantA, 'clientes', a.id)).is_default).toBe(false);

        await expect(
            service.update(tenantA, 'clientes', b.id, { config: {} }),
        ).rejects.toBeInstanceOf(BadRequestException); // calendar sin date_field_id
    });

    it('remove elimina la vista', async () => {
        const v = await service.create(tenantA, 'clientes', { name: 'Tmp', type: 'table' });
        await service.remove(tenantA, 'clientes', v.id);
        await expect(service.get(tenantA, 'clientes', v.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aislamiento RLS: las vistas no cruzan de tenant', async () => {
        await service.create(tenantA, 'clientes', { name: 'Secreta', type: 'table' });
        await listsService.create(tenantB, { name: 'Clientes' });
        expect(await service.list(tenantB, 'clientes')).toHaveLength(0);
    });

    it('v0.1.259 — icono/color de la pestaña: se guardan, se cambian y se quitan', async () => {
        const v = await service.create(tenantA, 'clientes', { name: 'Con icono', type: 'table', icon: 'star', color: '#ef4444' });
        expect(v).toMatchObject({ icon: 'star', color: '#ef4444' });
        const u = await service.update(tenantA, 'clientes', v.id, { icon: 'rocket' });
        expect(u).toMatchObject({ icon: 'rocket', color: '#ef4444' });
        // Guardar los cambios de la vista (config entero) no toca el icono.
        const c = await service.update(tenantA, 'clientes', v.id, { config: { search: 'x' } });
        expect(c.icon).toBe('rocket');
        const n = await service.update(tenantA, 'clientes', v.id, { icon: null, color: null });
        expect(n).toMatchObject({ icon: null, color: null });
    });

    it('v0.1.259 — reordenar: manda la posición; ids ajenos o repetidos → 400', async () => {
        const a = await service.create(tenantA, 'clientes', { name: 'A', type: 'table', is_default: true });
        await service.create(tenantA, 'clientes', { name: 'B', type: 'table' });
        const c = await service.create(tenantA, 'clientes', { name: 'C', type: 'table' });
        const out = await service.reorder(tenantA, 'clientes', [c.id, a.id]);
        // Los que no vienen quedan después, en su orden.
        expect(out.map((v) => v.name)).toEqual(['C', 'A', 'B']);
        expect((await service.list(tenantA, 'clientes')).map((v) => v.position)).toEqual([0, 1, 2]);

        await expect(service.reorder(tenantA, 'clientes', [a.id, a.id])).rejects.toBeInstanceOf(BadRequestException);
        await listsService.create(tenantA, { name: 'Otra' });
        const ajena = await service.create(tenantA, 'otra', { name: 'Z', type: 'table' });
        await expect(service.reorder(tenantA, 'clientes', [ajena.id, a.id])).rejects.toBeInstanceOf(BadRequestException);
        // Otra empresa no ve (ni reordena) estas vistas.
        await listsService.create(tenantB, { name: 'Clientes' });
        await expect(service.reorder(tenantB, 'clientes', [a.id])).rejects.toBeInstanceOf(BadRequestException);
    });
});
