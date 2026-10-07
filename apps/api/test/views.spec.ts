import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lists, savedViews, tenants, users } from '../src/db/schema';
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
    // Usuarios reales (saved_views.created_by referencia a users).
    const uid: Record<string, number> = {};

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        service = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        for (const n of ['ana', 'beto', 'carla', 'admin']) {
            const [u] = await pg.db.insert(users).values({ email: `${n}@views.test`, name: n, passwordHash: 'x' }).returning();
            uid[n] = u!.id;
        }
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

    it('v0.1.260 — privada: sólo la ve quien la creó; no puede ser la por defecto', async () => {
        const ana = { userId: uid.ana!, role: 'agent' };
        const beto = { userId: uid.beto!, role: 'admin' };
        const priv = await service.create(tenantA, 'clientes', { name: 'Mía', type: 'table', is_private: true }, ana);
        expect(priv).toMatchObject({ is_private: true, created_by: uid.ana });
        expect((await service.list(tenantA, 'clientes', ana)).map((v) => v.name)).toContain('Mía');
        // Ni otro miembro (aunque sea admin) ni un proceso interno la ven.
        expect((await service.list(tenantA, 'clientes', beto)).map((v) => v.name)).not.toContain('Mía');
        expect((await service.list(tenantA, 'clientes')).map((v) => v.name)).not.toContain('Mía');
        await expect(service.get(tenantA, 'clientes', priv.id, beto)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.update(tenantA, 'clientes', priv.id, { name: 'X' }, beto)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.remove(tenantA, 'clientes', priv.id, beto)).rejects.toBeInstanceOf(NotFoundException);
        // No puede ser la por defecto.
        await expect(service.update(tenantA, 'clientes', priv.id, { is_default: true }, ana)).rejects.toBeInstanceOf(BadRequestException);
        // Sólo su autor la comparte.
        const pub = await service.create(tenantA, 'clientes', { name: 'Equipo', type: 'table' }, ana);
        await expect(service.update(tenantA, 'clientes', pub.id, { is_private: true }, beto)).rejects.toBeInstanceOf(ForbiddenException);
        const shared = await service.update(tenantA, 'clientes', priv.id, { is_private: false }, ana);
        expect(shared.is_private).toBe(false);
        expect((await service.list(tenantA, 'clientes', beto)).map((v) => v.name)).toContain('Mía');
    });

    it('v0.1.260 — protegida: sólo su autor o un admin la cambia o la borra', async () => {
        const ana = { userId: uid.ana!, role: 'agent' };
        const carla = { userId: uid.carla!, role: 'manager' };
        const admin = { userId: uid.admin!, role: 'admin' };
        const v = await service.create(tenantA, 'clientes', { name: 'Oficial', type: 'table' }, ana);
        const locked = await service.update(tenantA, 'clientes', v.id, { is_locked: true }, ana);
        expect(locked.is_locked).toBe(true);
        await expect(service.update(tenantA, 'clientes', v.id, { config: { search: 'x' } }, carla)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.update(tenantA, 'clientes', v.id, { name: 'Otra' }, carla)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.update(tenantA, 'clientes', v.id, { is_locked: false }, carla)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.remove(tenantA, 'clientes', v.id, carla)).rejects.toBeInstanceOf(ForbiddenException);
        // Marcarla por defecto o reordenar no tocan su contenido.
        expect((await service.update(tenantA, 'clientes', v.id, { is_default: true }, carla)).is_default).toBe(true);
        expect((await service.update(tenantA, 'clientes', v.id, { autosave: true }, admin)).autosave).toBe(true);
        expect((await service.update(tenantA, 'clientes', v.id, { name: 'Oficial 2' }, admin)).name).toBe('Oficial 2');
        await service.remove(tenantA, 'clientes', v.id, ana);
        await expect(service.get(tenantA, 'clientes', v.id, ana)).rejects.toBeInstanceOf(NotFoundException);
    });
});
