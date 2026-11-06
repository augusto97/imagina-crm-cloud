import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MostUsedVisit } from '@imagina-base/shared';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { AuditService } from '../src/audit/audit.service';
import { MeController } from '../src/me/me.controller';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.385 — «Más usadas» del menú de Listas: visitas anotadas en la cuenta
 * de la persona (por empresa), ordenadas por frecuencia con caducidad, con
 * interruptor y «Empezar de cero».
 */
describe('«Más usadas» (Postgres real, RLS)', () => {
    let pg: TestPg;
    let me: MeService;
    let ctrl: MeController;
    let tenantA: number;
    let tenantB: number;
    let ana: number;
    let beto: number;
    const DAY = 24 * 60 * 60_000;

    function req(tenantId: number, userId: number, role: string, impersonatedBy?: number): FastifyRequest {
        return { tenant: { tenantId, role }, authUserId: userId, impersonatedBy } as unknown as FastifyRequest;
    }
    const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    const visit = (kind: 'list' | 'dashboard', id: number, at: number): MostUsedVisit => ({ kind, id, at, day: dayOf(at) });

    async function settingsOf(tenantId: number, userId: number): Promise<Record<string, unknown>> {
        const [row] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))),
        );
        return row!.settings as Record<string, unknown>;
    }

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        me = new MeService(pg.db, tenantDb, new MeRepository(), new AuditService(tenantDb));
        ctrl = new MeController(me, {} as never);
        const [a] = await pg.db.insert(tenants).values({ slug: 'usadas-a', name: 'A', plan: 'trial', status: 'trialing' }).returning();
        const [b] = await pg.db.insert(tenants).values({ slug: 'usadas-b', name: 'B', plan: 'trial', status: 'trialing' }).returning();
        tenantA = a!.id;
        tenantB = b!.id;
        const [u1] = await pg.db.insert(users).values({ email: 'ana-usadas@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        const [u2] = await pg.db.insert(users).values({ email: 'beto-usadas@acme.test', passwordHash: 'x', name: 'Beto' }).returning();
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

    it('encendida por defecto y vacía', async () => {
        expect(await ctrl.getMostUsed(req(tenantA, ana, 'admin'))).toEqual({ enabled: true, items: [] });
    });

    it('una visita suelta no aparece; dos días distintos sí, sin pisar otras claves ni otras cuentas', async () => {
        const now = Date.now();
        let state = await ctrl.recordMostUsedVisits(req(tenantA, ana, 'admin'), { visits: [visit('list', 7, now - DAY)] });
        expect(state.items).toEqual([]);
        state = await ctrl.recordMostUsedVisits(req(tenantA, ana, 'admin'), {
            visits: [visit('list', 7, now), visit('dashboard', 3, now - 2 * DAY), visit('dashboard', 3, now - 60_000)],
        });
        expect(state.items).toEqual([
            { kind: 'list', id: 7 },
            { kind: 'dashboard', id: 3 },
        ]);
        expect((await settingsOf(tenantA, ana)).favorites).toEqual({ lists: [7], dashboards: [], views: [] });
        expect((await me.getMostUsed(tenantB, ana)).items).toEqual([]);
        expect((await me.getMostUsed(tenantA, beto)).items).toEqual([]);
    });

    it('dos dispositivos que mandan a la vez no se pisan', async () => {
        const now = Date.now();
        await Promise.all([
            ctrl.recordMostUsedVisits(req(tenantA, beto, 'agent'), { visits: [visit('list', 11, now - DAY), visit('list', 11, now)] }),
            ctrl.recordMostUsedVisits(req(tenantA, beto, 'agent'), { visits: [visit('list', 12, now - DAY), visit('list', 12, now)] }),
        ]);
        const ids = (await me.getMostUsed(tenantA, beto)).items.map((i) => i.id).sort();
        expect(ids).toEqual([11, 12]);
    });

    it('impersonando no se anota nada', async () => {
        const before = await settingsOf(tenantA, ana);
        const now = Date.now();
        await ctrl.recordMostUsedVisits(req(tenantA, ana, 'admin', 999), { visits: [visit('list', 50, now - DAY), visit('list', 50, now)] });
        await ctrl.updateMostUsed(req(tenantA, ana, 'admin', 999), { enabled: false });
        expect(await settingsOf(tenantA, ana)).toEqual(before);
    });

    it('apagada no muestra ni anota; al encenderla vuelve lo contado; empezar de cero lo borra', async () => {
        const r = req(tenantA, ana, 'admin');
        let state = await ctrl.updateMostUsed(r, { enabled: false });
        expect(state).toEqual({ enabled: false, items: [] });
        const stored = (await settingsOf(tenantA, ana)).most_used as { items: Record<string, unknown> };
        const now = Date.now();
        await ctrl.recordMostUsedVisits(r, { visits: [visit('list', 99, now - DAY), visit('list', 99, now)] });
        expect(((await settingsOf(tenantA, ana)).most_used as { items: Record<string, unknown> }).items).toEqual(stored.items);

        state = await ctrl.updateMostUsed(r, { enabled: true });
        expect(state.enabled).toBe(true);
        expect(state.items.map((i) => i.id)).toEqual([7, 3]);

        state = await ctrl.updateMostUsed(r, { reset: true });
        expect(state).toEqual({ enabled: true, items: [] });
        expect((await settingsOf(tenantA, ana)).favorites).toEqual({ lists: [7], dashboards: [], views: [] });
    });
});
