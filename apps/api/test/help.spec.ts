import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { HelpService, type HelpStore } from '../src/help/help.service';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

class MemStore implements HelpStore {
    m = new Map<string, string>();
    async get(k: string) {
        return this.m.get(k) ?? null;
    }
    async set(k: string, v: string) {
        this.m.set(k, v);
        return 'OK';
    }
}

describe('ayuda de la plataforma (Plataforma → Ayuda)', () => {
    it('guarda contacto, videos y guías propias; descarta ids de guías que no existen', async () => {
        const store = new MemStore();
        const svc = new HelpService(store);
        const saved = await svc.update({
            support: { email: 'soporte@acme.co', whatsapp: '+57 300 123 4567', url: 'https://ayuda.acme.co', note: null },
            videos: { 'create-list': 'https://youtu.be/dQw4w9WgXcQ', 'no-existe': 'https://youtu.be/dQw4w9WgXcQ' },
            hidden: ['export', 'no-existe', 'export'],
        });
        expect(saved.support.email).toBe('soporte@acme.co');
        expect(Object.keys(saved.videos)).toEqual(['create-list']);
        expect(saved.hidden).toEqual(['export']);
        // Cada sección que llega reemplaza a la guardada; las demás quedan.
        const next = await svc.update({
            custom: [{ id: 'op-soporte1', title: '¿Cómo pido soporte?', category: 'account', minutes: 1, body: '1. Escríbenos', video_url: null, screens: [], roles: [] }],
        });
        expect(next.support.email).toBe('soporte@acme.co');
        expect(next.custom).toHaveLength(1);
        expect(JSON.parse(store.m.get('platform:help')!).custom[0].id).toBe('op-soporte1');
    });

    it('un miembro recibe sólo las guías propias de su rol (sin roles = todos)', async () => {
        const svc = new HelpService(new MemStore());
        await svc.update({
            custom: [
                { id: 'op-todos01', title: '¿Para todos?', category: 'start', minutes: 1, body: 'Texto', video_url: null, screens: [], roles: [] },
                { id: 'op-admin01', title: '¿Sólo admins?', category: 'team', minutes: 1, body: 'Texto', video_url: null, screens: [], roles: ['admin'] },
                { id: 'op-agent01', title: '¿Agentes y lectores?', category: 'lists', minutes: 1, body: 'Texto', video_url: null, screens: ['records'], roles: ['agent', 'viewer'] },
            ],
        });
        expect((await svc.forMember('admin')).custom.map((g) => g.id)).toEqual(['op-todos01', 'op-admin01']);
        expect((await svc.forMember('agent')).custom.map((g) => g.id)).toEqual(['op-todos01', 'op-agent01']);
        expect((await svc.forMember('manager')).custom.map((g) => g.id)).toEqual(['op-todos01']);
    });

    it('un valor corrupto o un Redis caído no tumban la ayuda', async () => {
        const store = new MemStore();
        store.m.set('platform:help', '{no es json');
        expect((await new HelpService(store).forMember('agent')).custom).toEqual([]);
        const broken: HelpStore = {
            get: async () => {
                throw new Error('ECONNREFUSED');
            },
            set: async () => 'OK',
        };
        expect((await new HelpService(broken).forMember('admin')).support.email).toBeNull();
    });
});

describe('progreso de recorridos por persona y empresa (Postgres real, RLS)', () => {
    let pg: TestPg;
    let me: MeService;
    let tenantA: number;
    let tenantB: number;
    let userId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        me = new MeService(pg.db, new TenantDb(pg.db), new MeRepository());
        const [a] = await pg.db.insert(tenants).values({ slug: 'guias-a', name: 'A', plan: 'trial', status: 'trialing' }).returning();
        const [b] = await pg.db.insert(tenants).values({ slug: 'guias-b', name: 'B', plan: 'trial', status: 'trialing' }).returning();
        tenantA = a!.id;
        tenantB = b!.id;
        const [u] = await pg.db.insert(users).values({ email: 'guias@acme.test', passwordHash: 'x', name: 'Ana' }).returning();
        userId = u!.id;
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, (tx) =>
                tx.insert(memberships).values({ userId, tenantId: t, role: 'agent', settings: { favorites: { lists: [7], dashboards: [], views: [] } } }),
            );
        }
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('arranca vacío, mezcla y no toca las otras claves de settings', async () => {
        expect(await me.getGuideProgress(tenantA, userId)).toEqual({ completed: [], dismissed: [], welcome_offered: false });
        await me.updateGuideProgress(tenantA, userId, { welcome_offered: true, dismissed: ['views'] });
        const after = await me.updateGuideProgress(tenantA, userId, { completed: ['views', 'welcome'] });
        expect(after).toEqual({ completed: ['views', 'welcome'], dismissed: [], welcome_offered: true });

        const [row] = await withTenant(pg.db, tenantA, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, userId))),
        );
        const settings = row!.settings as Record<string, unknown>;
        expect(settings.favorites).toEqual({ lists: [7], dashboards: [], views: [] });
        expect(settings.guides).toEqual(after);
    });

    it('cada empresa lleva su propio progreso', async () => {
        await me.updateGuideProgress(tenantB, userId, { completed: ['import'] });
        expect((await me.getGuideProgress(tenantB, userId)).completed).toEqual(['import']);
        expect((await me.getGuideProgress(tenantA, userId)).completed).toEqual(['views', 'welcome']);
        expect((await me.getGuideProgress(tenantB, userId)).welcome_offered).toBe(false);
    });

    it('sin membresía en la empresa no hay nada que escribir', async () => {
        const [c] = await pg.db.insert(tenants).values({ slug: 'guias-c', name: 'C', plan: 'trial', status: 'trialing' }).returning();
        await expect(me.updateGuideProgress(c!.id, userId, { completed: ['views'] })).rejects.toMatchObject({ status: 404 });
    });
});
