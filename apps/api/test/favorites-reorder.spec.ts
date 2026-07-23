import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { memberships, tenants, users } from '../src/db/schema';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** v0.1.107 — favoritos por usuario+tenant y reorden del menú de listas. */
describe('Favoritos + reorden de listas (Postgres real)', () => {
    let pg: TestPg;
    let me: MeService;
    let lists: ListsService;
    let tenantId: number;
    let userA: number;
    let userB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        me = new MeService(pg.db, tenantDb, new MeRepository());
        lists = new ListsService(tenantDb, new ListsRepository(), new RealtimeService());

        const [t] = await pg.db.insert(tenants).values({ slug: 'favws', name: 'FavWS' }).returning();
        tenantId = t!.id;
        const mkUser = async (email: string): Promise<number> => {
            const [u] = await pg.db
                .insert(users)
                .values({ email, passwordHash: 'x', name: email })
                .returning();
            await pg.db.insert(memberships).values({ userId: u!.id, tenantId, role: 'admin' });
            return u!.id;
        };
        userA = await mkUser('a@fav.test');
        userB = await mkUser('b@fav.test');
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('favoritos: default vacío, PATCH parcial persiste y es POR USUARIO', async () => {
        expect(await me.getFavorites(tenantId, userA)).toEqual({ lists: [], dashboards: [] });

        const set = await me.setFavorites(tenantId, userA, { lists: [10, 20] });
        expect(set).toEqual({ lists: [10, 20], dashboards: [] });

        // Parcial: dashboards no pisa lists.
        const set2 = await me.setFavorites(tenantId, userA, { dashboards: [5] });
        expect(set2).toEqual({ lists: [10, 20], dashboards: [5] });
        expect(await me.getFavorites(tenantId, userA)).toEqual(set2);

        // Otro usuario del MISMO tenant: sus favoritos son independientes.
        expect(await me.getFavorites(tenantId, userB)).toEqual({ lists: [], dashboards: [] });
    });

    it('reorder: aplica position por índice y valida ids del workspace', async () => {
        const a = await lists.create(tenantId, { name: 'Alpha' });
        const b = await lists.create(tenantId, { name: 'Beta' });
        const c = await lists.create(tenantId, { name: 'Gamma' });

        // Orden inicial: por position de creación (a, b, c).
        const before = await lists.list(tenantId);
        expect(before.map((l) => l.id)).toEqual([a.id, b.id, c.id]);

        // Nuevo orden: c, a, b — el listado lo respeta y PERSISTE.
        const after = await lists.reorder(tenantId, [c.id, a.id, b.id]);
        expect(after.map((l) => l.id)).toEqual([c.id, a.id, b.id]);
        expect((await lists.list(tenantId)).map((l) => l.id)).toEqual([c.id, a.id, b.id]);

        // Ids duplicados o ajenos → 400.
        await expect(lists.reorder(tenantId, [c.id, c.id, a.id])).rejects.toThrow();
        await expect(lists.reorder(tenantId, [c.id, a.id, 999_999])).rejects.toThrow();
    });
});
