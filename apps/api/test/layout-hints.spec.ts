import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAYOUT_HINTS_MAX } from '@imagina-base/shared';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AuditService } from '../src/audit/audit.service';
import { myListAccess } from '../src/lists/list-acl';
import { MeController } from '../src/me/me.controller';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.470 — «Esta lista se puede ver como ficha»: «Ahora no» y cerrar la
 * tarjeta la esconden para ESA persona y ESA lista, en el servidor, sin pisar
 * lo demás que la persona guarda en su membresía.
 */
describe('sugerencia de la ficha diseñada: «Ahora no» por persona (Postgres real, RLS)', () => {
    let pg: TestPg;
    let me: MeService;
    let ctrl: MeController;
    let tenantA: number;
    let tenantB: number;
    let ana: number;
    let beto: number;

    function req(tenantId: number, userId: number, role: string, impersonatedBy?: number): FastifyRequest {
        return { tenant: { tenantId, role }, authUserId: userId, impersonatedBy } as unknown as FastifyRequest;
    }

    async function settingsOf(tenantId: number, userId: number): Promise<Record<string, unknown>> {
        const [row] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))),
        );
        return (row?.settings ?? {}) as Record<string, unknown>;
    }

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        me = new MeService(pg.db, tenantDb, new MeRepository(), new AuditService(tenantDb));
        ctrl = new MeController(me, {} as never);
        const [a] = await pg.db.insert(tenants).values({ slug: 'hints-a', name: 'A', plan: 'trial', status: 'trialing' }).returning();
        const [b] = await pg.db.insert(tenants).values({ slug: 'hints-b', name: 'B', plan: 'trial', status: 'trialing' }).returning();
        tenantA = a!.id;
        tenantB = b!.id;
        const [u1] = await pg.db.insert(users).values({ email: 'ana-hints@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        const [u2] = await pg.db.insert(users).values({ email: 'beto-hints@acme.test', passwordHash: 'x', name: 'Beto' }).returning();
        ana = u1!.id;
        beto = u2!.id;
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([
                {
                    userId: ana,
                    tenantId: tenantA,
                    role: 'admin',
                    settings: { favorites: { lists: [7], dashboards: [], views: [] }, mobile_nav: { items: ['lists', 'search'], labels: true } },
                },
                { userId: beto, tenantId: tenantA, role: 'manager' },
            ]),
        );
        await withTenant(pg.db, tenantB, (tx) => tx.insert(memberships).values({ userId: ana, tenantId: tenantB, role: 'admin' }));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('sin nada cerrado, la lista vacía', async () => {
        expect(await ctrl.getLayoutHints(req(tenantA, ana, 'admin'))).toEqual({ dismissed_lists: [] });
    });

    it('«Ahora no» se guarda por persona y empresa, sin pisar las otras claves', async () => {
        const res = await ctrl.dismissLayoutHint(req(tenantA, ana, 'admin'), { list_id: 12 });
        expect(res.dismissed_lists).toEqual([12]);
        // Repetirlo no duplica.
        expect((await ctrl.dismissLayoutHint(req(tenantA, ana, 'admin'), { list_id: 12 })).dismissed_lists).toEqual([12]);
        expect((await ctrl.dismissLayoutHint(req(tenantA, ana, 'admin'), { list_id: 30 })).dismissed_lists).toEqual([12, 30]);

        const settings = await settingsOf(tenantA, ana);
        expect(settings.favorites).toEqual({ lists: [7], dashboards: [], views: [] });
        expect(settings.mobile_nav).toEqual({ items: ['lists', 'search'], labels: true });
        expect(settings.layout_hints).toEqual({ dismissed_lists: [12, 30] });

        // Otra persona y otra empresa no cambian.
        expect((await me.getLayoutHints(tenantA, beto)).dismissed_lists).toEqual([]);
        expect((await me.getLayoutHints(tenantB, ana)).dismissed_lists).toEqual([]);
    });

    it('impersonando no se escribe nada', async () => {
        const res = await ctrl.dismissLayoutHint(req(tenantA, beto, 'manager', ana), { list_id: 5 });
        expect(res.dismissed_lists).toEqual([]);
        expect((await settingsOf(tenantA, beto)).layout_hints).toBeUndefined();
    });

    it('tiene tope y un valor corrupto guardado cuenta como «nada cerrado»', async () => {
        await withTenant(pg.db, tenantA, (tx) =>
            tx
                .update(memberships)
                .set({ settings: { layout_hints: { dismissed_lists: Array.from({ length: LAYOUT_HINTS_MAX }, (_, i) => i + 1) } } })
                .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, beto))),
        );
        const res = await me.dismissLayoutHint(tenantA, beto, 9_999);
        expect(res.dismissed_lists).toHaveLength(LAYOUT_HINTS_MAX);
        expect(res.dismissed_lists.at(-1)).toBe(9_999);
        expect(res.dismissed_lists[0]).toBe(2);

        await withTenant(pg.db, tenantA, (tx) =>
            tx
                .update(memberships)
                .set({ settings: { layout_hints: 'basura' } })
                .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, beto))),
        );
        expect(await me.getLayoutHints(tenantA, beto)).toEqual({ dismissed_lists: [] });
    });

    it('my_access trae también los campos que quien mira no ve (para «Otros campos»)', () => {
        const settings = {
            permissions: {
                permissions: {
                    agent: { view: 'all', edit: 'all', delete: 'none', create: true, fields_hidden: ['costo', 'margen'], readonly_field_ids: [4] },
                },
                users: { [String(beto)]: { view: 'all', edit: 'all', delete: 'none', create: true, fields_hidden: ['margen'] } },
            },
        };
        expect(myListAccess(settings, 'agent')).toEqual({ readonly_field_ids: [4], hidden_field_slugs: ['costo', 'margen'] });
        expect(myListAccess(settings, 'agent', beto).hidden_field_slugs).toEqual(['margen']);
        expect(myListAccess(settings, 'admin')).toEqual({ readonly_field_ids: [], hidden_field_slugs: [] });
    });
});
