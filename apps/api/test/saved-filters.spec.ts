import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FilterGroup } from '@imagina-base/shared';
import { lists, savedFilters, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { SavedFiltersRepository } from '../src/saved-filters/saved-filters.repository';
import { SavedFiltersService } from '../src/saved-filters/saved-filters.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const TREE: FilterGroup = {
    type: 'group',
    logic: 'and',
    children: [{ type: 'condition', field_id: 1, op: 'is_not_null' }],
};

describe('SavedFiltersService (Postgres real + RLS)', () => {
    let pg: TestPg;
    let listsService: ListsService;
    let service: SavedFiltersService;
    let tenantA: number;
    let tenantB: number;
    let alice: number;
    let bob: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        service = new SavedFiltersService(tenantDb, new SavedFiltersRepository(), listsService);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const [a] = await pg.db.insert(users).values({ email: 'alice@acme.test', passwordHash: 'x', name: 'Alice' }).returning();
        const [b] = await pg.db.insert(users).values({ email: 'bob@acme.test', passwordHash: 'x', name: 'Bob' }).returning();
        alice = a!.id;
        bob = b!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(savedFilters).where(eq(savedFilters.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        await listsService.create(tenantA, { name: 'Clientes' });
    });

    it('personal vs shared: cada usuario ve los shared + los propios', async () => {
        await service.create(tenantA, alice, 'clientes', { name: 'Mío', scope: 'personal', filter_tree: TREE });
        await service.create(tenantA, alice, 'clientes', { name: 'Equipo', scope: 'shared', filter_tree: TREE });

        const forAlice = await service.list(tenantA, alice, 'clientes');
        expect(forAlice.map((f) => f.name).sort()).toEqual(['Equipo', 'Mío']);

        // Bob ve el shared pero NO el personal de Alice.
        const forBob = await service.list(tenantA, bob, 'clientes');
        expect(forBob.map((f) => f.name)).toEqual(['Equipo']);
    });

    it('shared → user_id null; personal → user_id del dueño', async () => {
        const shared = await service.create(tenantA, alice, 'clientes', { name: 'S', scope: 'shared', filter_tree: TREE });
        const personal = await service.create(tenantA, alice, 'clientes', { name: 'P', scope: 'personal', filter_tree: TREE });
        expect(shared.user_id).toBeNull();
        expect(personal.user_id).toBe(alice);
        expect(personal.filter_tree).toEqual(TREE);
    });

    it('borrar: un usuario NO puede borrar el filtro personal de otro', async () => {
        const p = await service.create(tenantA, alice, 'clientes', { name: 'P', scope: 'personal', filter_tree: TREE });
        // Bob intenta borrar el personal de Alice → no borra nada.
        expect(await service.remove(tenantA, bob, 'clientes', p.id)).toBe(false);
        // Alice sí lo borra.
        expect(await service.remove(tenantA, alice, 'clientes', p.id)).toBe(true);
    });

    it('borrar: cualquiera borra un filtro shared', async () => {
        const s = await service.create(tenantA, alice, 'clientes', { name: 'S', scope: 'shared', filter_tree: TREE });
        expect(await service.remove(tenantA, bob, 'clientes', s.id)).toBe(true);
    });

    it('RLS: el tenant B no ve los filtros del tenant A', async () => {
        await service.create(tenantA, alice, 'clientes', { name: 'A', scope: 'shared', filter_tree: TREE });
        await listsService.create(tenantB, { name: 'Otra' });
        const forB = await service.list(tenantB, alice, 'otra');
        expect(forB).toEqual([]);
    });
});
