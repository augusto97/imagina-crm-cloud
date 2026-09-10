import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listGroups, lists, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListGroupsService } from '../src/lists/list-groups.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

describe('Carpetas de listas (v0.1.130)', () => {
    let pg: TestPg;
    let groups: ListGroupsService;
    let listsSvc: ListsService;
    let tenantA: number;
    let tenantB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        groups = new ListGroupsService(tenantDb);
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
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
                await tx.delete(lists).where(eq(lists.tenantId, t));
                await tx.delete(listGroups).where(eq(listGroups.tenantId, t));
            });
        }
    });

    it('crea carpetas con posición incremental y las lista ordenadas', async () => {
        const a = await groups.create(tenantA, { name: 'Ventas' });
        const b = await groups.create(tenantA, { name: 'Soporte' });
        expect(b.position).toBe(a.position + 1);
        expect((await groups.list(tenantA)).map((g) => g.name)).toEqual(['Ventas', 'Soporte']);
    });

    it('v0.1.173 — icono y color de la carpeta: alta, cambio y limpieza', async () => {
        const g = await groups.create(tenantA, { name: 'Ventas', icon: 'briefcase', color: '#22c55e' });
        expect(g.icon).toBe('briefcase');
        expect(g.color).toBe('#22c55e');
        // Sin elegir → null (el front muestra el icono genérico de carpeta).
        const plain = await groups.create(tenantA, { name: 'Soporte' });
        expect(plain.icon).toBeNull();
        expect(plain.color).toBeNull();
        // Cambiar sólo el icono conserva el color; `null` limpia.
        const changed = await groups.update(tenantA, g.id, { icon: 'rocket' });
        expect(changed.icon).toBe('rocket');
        expect(changed.color).toBe('#22c55e');
        const cleared = await groups.update(tenantA, g.id, { icon: null, color: null });
        expect(cleared.icon).toBeNull();
        expect(cleared.color).toBeNull();
        expect((await groups.list(tenantA)).map((x) => x.icon)).toEqual([null, null]);
    });

    it('v0.1.173 — una lista puede NACER dentro de una carpeta (y no de una ajena)', async () => {
        const g = await groups.create(tenantA, { name: 'Ventas' });
        const inside = await listsSvc.create(tenantA, { name: 'Clientes', group_id: g.id });
        expect(inside.group_id).toBe(g.id);
        const ajena = await groups.create(tenantB, { name: 'De Globex' });
        await expect(
            listsSvc.create(tenantA, { name: 'Intrusa', group_id: ajena.id }),
        ).rejects.toThrow(NotFoundException);
    });

    it('una lista entra y sale de la carpeta', async () => {
        const g = await groups.create(tenantA, { name: 'Ventas' });
        const list = await listsSvc.create(tenantA, { name: 'Clientes' });
        expect(list.group_id).toBeNull();

        const moved = await listsSvc.update(tenantA, String(list.id), { group_id: g.id });
        expect(moved.group_id).toBe(g.id);

        const out = await listsSvc.update(tenantA, String(list.id), { group_id: null });
        expect(out.group_id).toBeNull();
    });

    it('borrar la carpeta NO borra sus listas: vuelven a la raíz', async () => {
        const g = await groups.create(tenantA, { name: 'Ventas' });
        const list = await listsSvc.create(tenantA, { name: 'Clientes' });
        await listsSvc.update(tenantA, String(list.id), { group_id: g.id });

        await groups.remove(tenantA, g.id);

        const after = await listsSvc.get(tenantA, String(list.id));
        expect(after.group_id).toBeNull();
        expect(await groups.list(tenantA)).toHaveLength(0);
    });

    it('no se puede mover una lista a la carpeta de OTRA empresa', async () => {
        const ajena = await groups.create(tenantB, { name: 'Carpeta de Globex' });
        const list = await listsSvc.create(tenantA, { name: 'Clientes' });
        await expect(
            listsSvc.update(tenantA, String(list.id), { group_id: ajena.id }),
        ).rejects.toThrow(NotFoundException);
        expect((await listsSvc.get(tenantA, String(list.id))).group_id).toBeNull();
    });

    it('las carpetas no se cruzan entre empresas', async () => {
        await groups.create(tenantA, { name: 'De ACME' });
        await groups.create(tenantB, { name: 'De Globex' });
        expect((await groups.list(tenantA)).map((g) => g.name)).toEqual(['De ACME']);
        expect((await groups.list(tenantB)).map((g) => g.name)).toEqual(['De Globex']);
        // Y una carpeta ajena no se puede renombrar ni borrar.
        const [ajena] = await groups.list(tenantB);
        await expect(groups.update(tenantA, ajena!.id, { name: 'hack' })).rejects.toThrow(
            NotFoundException,
        );
        await expect(groups.remove(tenantA, ajena!.id)).rejects.toThrow(NotFoundException);
    });
});
