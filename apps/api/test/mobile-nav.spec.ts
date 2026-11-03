import { ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AuditService } from '../src/audit/audit.service';
import { MeController } from '../src/me/me.controller';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.347 — la barra de abajo del celular, personalizable: la de cada
 * persona por empresa y la predeterminada del equipo (sólo el admin).
 */
describe('barra de abajo personalizable (Postgres real, RLS)', () => {
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

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        me = new MeService(pg.db, tenantDb, new MeRepository(), new AuditService(tenantDb));
        ctrl = new MeController(me, {} as never);
        const [a] = await pg.db.insert(tenants).values({ slug: 'barra-a', name: 'A', plan: 'trial', status: 'trialing' }).returning();
        const [b] = await pg.db.insert(tenants).values({ slug: 'barra-b', name: 'B', plan: 'trial', status: 'trialing' }).returning();
        tenantA = a!.id;
        tenantB = b!.id;
        const [u1] = await pg.db.insert(users).values({ email: 'ana-barra@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        const [u2] = await pg.db.insert(users).values({ email: 'beto-barra@acme.test', passwordHash: 'x', name: 'Beto' }).returning();
        ana = u1!.id;
        beto = u2!.id;
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([
                { userId: ana, tenantId: tenantA, role: 'admin', settings: { favorites: { lists: [7], dashboards: [], views: [] } } },
                { userId: beto, tenantId: tenantA, role: 'agent' },
            ]),
        );
        await withTenant(pg.db, tenantB, (tx) => tx.insert(memberships).values({ userId: ana, tenantId: tenantB, role: 'agent' }));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('sin nada elegido no hay barra propia ni del equipo', async () => {
        expect(await me.getMobileNav(tenantA, ana)).toEqual({ own: null, team: null });
    });

    it('guarda la barra de la persona sin pisar las otras claves de settings', async () => {
        const state = await ctrl.setMobileNav(req(tenantA, ana, 'admin'), { items: ['lists', 'dashboards', 'list:9'], labels: false });
        expect(state.own).toEqual({ items: ['lists', 'dashboards', 'list:9'], labels: false });
        const [row] = await withTenant(pg.db, tenantA, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, ana))),
        );
        const settings = row!.settings as Record<string, unknown>;
        expect(settings.favorites).toEqual({ lists: [7], dashboards: [], views: [] });
        // Cada empresa lleva la suya.
        expect((await me.getMobileNav(tenantB, ana)).own).toBeNull();
        // La de otra persona no cambia.
        expect((await me.getMobileNav(tenantA, beto)).own).toBeNull();
    });

    it('la del equipo la elige sólo el admin, queda en la bitácora y la ven todos', async () => {
        await expect(ctrl.setTeamMobileNav(req(tenantA, beto, 'agent'), { items: ['mywork', 'search'], labels: true })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        const state = await ctrl.setTeamMobileNav(req(tenantA, ana, 'admin'), { items: ['lists', 'dashboards', 'search', 'inbox'], labels: true });
        expect(state.team?.items).toEqual(['lists', 'dashboards', 'search', 'inbox']);
        // Beto no eligió la suya: ve la del equipo como `team`.
        expect(await me.getMobileNav(tenantA, beto)).toEqual({ own: null, team: { items: ['lists', 'dashboards', 'search', 'inbox'], labels: true } });
        // Otra empresa no la ve.
        expect((await me.getMobileNav(tenantB, ana)).team).toBeNull();
        const logs = await withTenant(pg.db, tenantA, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, 'workspace.mobile_nav_change')));
        expect(logs).toHaveLength(1);
        expect(logs[0]!.userId).toBe(ana);

        const cleared = await ctrl.clearTeamMobileNav(req(tenantA, ana, 'admin'));
        expect(cleared.team).toBeNull();
        // Las otras claves de la empresa siguen.
        const [t] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantA));
        expect((t!.settings as Record<string, unknown>).mobile_nav).toBeUndefined();
    });

    it('volver a la predeterminada borra sólo la propia', async () => {
        await ctrl.setTeamMobileNav(req(tenantA, ana, 'admin'), { items: ['lists', 'search'], labels: true });
        const state = await ctrl.resetMobileNav(req(tenantA, ana, 'admin'));
        expect(state).toEqual({ own: null, team: { items: ['lists', 'search'], labels: true } });
        const [row] = await withTenant(pg.db, tenantA, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, ana))),
        );
        expect((row!.settings as Record<string, unknown>).favorites).toEqual({ lists: [7], dashboards: [], views: [] });
    });

    it('impersonando no se le cambia la barra a la persona', async () => {
        const state = await ctrl.setMobileNav(req(tenantA, beto, 'agent', 999), { items: ['scan', 'search'], labels: true });
        expect(state.own).toBeNull();
        expect((await me.getMobileNav(tenantA, beto)).own).toBeNull();
    });

    it('un valor corrupto guardado cuenta como «nada elegido»', async () => {
        await withTenant(pg.db, tenantA, (tx) =>
            tx
                .update(memberships)
                .set({ settings: { mobile_nav: { items: ['nada', 'lists'] } } })
                .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, beto))),
        );
        expect((await me.getMobileNav(tenantA, beto)).own).toBeNull();
    });
});
