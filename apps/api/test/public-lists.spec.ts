import { NotFoundException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fields, lists, publicLists, records, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { PublicListsService } from '../src/public-lists/public-lists.service';
import { frameAncestors } from '../src/public-lists/public-page';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

describe('Listas públicas embebibles', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let pub: PublicListsService;
    let tenantId: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
        );
        pub = new PublicListsService(pg.db, tenantDb, lists_);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await pg.db.delete(publicLists).where(eq(publicLists.tenantId, tenantId));
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await lists_.create(tenantId, { name: 'Directorio' });
        const defs: CreateFieldInput[] = [
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Email', type: 'email', slug: 'email' },
            { label: 'Interno', type: 'text', slug: 'interno' },
            { label: 'Monto', type: 'currency', slug: 'monto' },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields_.create(tenantId, 'directorio', d);
    });

    const key = (s: string) => `f${f[s]!.id}`;
    const seed = async () => {
        await recs.create(tenantId, admin, 'directorio', {
            data: { [key('nombre')]: 'Ana', [key('email')]: 'ana@x.com', [key('interno')]: 'SECRETO-A', [key('monto')]: 300 },
        });
        await recs.create(tenantId, admin, 'directorio', {
            data: { [key('nombre')]: 'Beto', [key('email')]: 'beto@x.com', [key('interno')]: 'SECRETO-B', [key('monto')]: 100 },
        });
        await recs.create(tenantId, admin, 'directorio', {
            data: { [key('nombre')]: 'Carla', [key('email')]: 'carla@x.com', [key('interno')]: 'SECRETO-C', [key('monto')]: 200 },
        });
    };

    const publish = (extra: Record<string, unknown> = {}) =>
        pub.updateAdmin(tenantId, 'directorio', {
            enabled: true,
            visible_field_slugs: ['nombre', 'email', 'monto'],
            sort_allowed_slugs: ['nombre', 'monto'],
            ...extra,
        });

    it('getAdmin: por defecto deshabilitada, sin token', async () => {
        const admincfg = await pub.getAdmin(tenantId, 'directorio');
        expect(admincfg.enabled).toBe(false);
        expect(admincfg.public_path).toBeNull();
    });

    it('updateAdmin habilita: genera token, mapea y expone public_path', async () => {
        const cfg = await publish();
        expect(cfg.enabled).toBe(true);
        expect(cfg.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
        expect(cfg.public_path).toBe(`/public/l/${cfg.token}`);
        const [row] = await pg.db.select().from(publicLists).where(eq(publicLists.token, cfg.token));
        expect(row?.tenantId).toBe(tenantId);
    });

    it('getMeta expone SOLO los campos visibles (no filtra internos)', async () => {
        const cfg = await publish();
        const meta = await pub.getMeta(cfg.token);
        expect(meta.fields.map((x) => x.slug).sort()).toEqual(['email', 'monto', 'nombre']);
        expect(meta.fields.some((x) => x.slug === 'interno')).toBe(false);
        expect(meta.sort_allowed.sort()).toEqual(['monto', 'nombre']);
    });

    it('getRecords devuelve solo slugs visibles, nunca el campo interno', async () => {
        await seed();
        const cfg = await publish();
        const page = await pub.getRecords(cfg.token, {});
        expect(page.data).toHaveLength(3);
        for (const r of page.data) {
            expect(r.data.interno).toBeUndefined();
            expect(r.data.nombre).toBeDefined();
        }
    });

    it('getRecords: búsqueda sobre campos de texto visibles', async () => {
        await seed();
        const cfg = await publish();
        const page = await pub.getRecords(cfg.token, { search: 'beto' });
        expect(page.data.map((r) => r.data.nombre)).toEqual(['Beto']);
    });

    it('getRecords: la búsqueda NO alcanza campos ocultos (interno)', async () => {
        await seed();
        const cfg = await publish();
        const page = await pub.getRecords(cfg.token, { search: 'SECRETO' });
        expect(page.data).toHaveLength(0);
    });

    it('getRecords: orden por slug permitido asc/desc', async () => {
        await seed();
        const cfg = await publish();
        const asc = await pub.getRecords(cfg.token, { sort: 'monto:asc' });
        expect(asc.data.map((r) => r.data.monto)).toEqual([100, 200, 300]);
        const desc = await pub.getRecords(cfg.token, { sort: 'monto:desc' });
        expect(desc.data.map((r) => r.data.monto)).toEqual([300, 200, 100]);
    });

    it('getRecords: orden por slug NO permitido se ignora (cae a id asc)', async () => {
        await seed();
        const cfg = await publish();
        const page = await pub.getRecords(cfg.token, { sort: 'interno:desc' });
        expect(page.data.map((r) => r.data.nombre)).toEqual(['Ana', 'Beto', 'Carla']);
    });

    it('getRecords: paginación por offset con next_cursor', async () => {
        await seed();
        const cfg = await publish({ per_page: 2 });
        const p1 = await pub.getRecords(cfg.token, { limit: 2 });
        expect(p1.data).toHaveLength(2);
        expect(p1.meta.next_cursor).toBe('2');
        const p2 = await pub.getRecords(cfg.token, { limit: 2, cursor: 2 });
        expect(p2.data).toHaveLength(1);
        expect(p2.meta.next_cursor).toBeNull();
    });

    it('deshabilitar quita el mapeo y las lecturas públicas fallan (404)', async () => {
        const cfg = await publish();
        await pub.updateAdmin(tenantId, 'directorio', { enabled: false });
        const [row] = await pg.db.select().from(publicLists).where(eq(publicLists.listId, f.nombre!.list_id));
        expect(row).toBeUndefined();
        await expect(pub.getMeta(cfg.token)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('token inexistente → 404', async () => {
        await expect(pub.getMeta('no-existe')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('frameAncestors: vacío = cualquiera; con dominios = restringido a self + esos', () => {
        expect(frameAncestors([])).toBe('frame-ancestors *');
        expect(frameAncestors(['example.com', 'https://foo.com/path'])).toBe(
            "frame-ancestors 'self' example.com https://foo.com",
        );
    });
});
