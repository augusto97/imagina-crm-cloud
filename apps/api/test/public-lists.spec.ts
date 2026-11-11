import { NotFoundException } from '@nestjs/common';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { attachments, fields, lists, memberships, publicLists, records, savedViews, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { PUBLIC_LIST_MAX_OFFSET, PUBLIC_LIST_QUERIES_PER_MINUTE, PublicListsService, isExpired } from '../src/public-lists/public-lists.service';
import { PublicCache } from '../src/public-cache/public-cache';
import { updatePublicListSchema } from '@imagina-base/shared';
import { frameAncestors, publicListPageCsp, publicListUnavailablePage, renderPublicListPage } from '../src/public-lists/public-page';
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
            new RelationsRepository(),
        );
        pub = new PublicListsService(
            pg.db,
            tenantDb,
            lists_,
            new FilesService(
                tenantDb,
                new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-pub-'))),
                loadEnv({ FILES_SIGNING_SECRET: 'test-public-secret' }),
            ),
        );
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

    it('getMeta incluye el branding del tenant (logo por URL firmada)', async () => {
        const cfg = await publish();
        // Default: todo null.
        expect((await pub.getMeta(cfg.token)).branding).toEqual({
            primary_color: null,
            app_name: null,
            logo_url: null,
        });
        // Con branding seteado (y logo attachment del propio tenant).
        const [uploader] = await pg.db
            .insert(users)
            .values({ email: `logo-${tenantId}@acme.test`, passwordHash: 'x', name: 'Logo' })
            .returning();
        const [file] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(attachments)
                .values({
                    tenantId,
                    filename: 'logo.png',
                    mime: 'image/png',
                    sizeBytes: 5,
                    storageKey: `t${tenantId}/logo.png`,
                    createdBy: uploader!.id,
                })
                .returning(),
        );
        await pg.db
            .update(tenants)
            .set({
                settings: {
                    branding: { primary_color: '#112233', app_name: 'Acme Pública', logo_file_id: file!.id },
                },
            })
            .where(eq(tenants.id, tenantId));
        const meta = await pub.getMeta(cfg.token);
        expect(meta.branding.primary_color).toBe('#112233');
        expect(meta.branding.app_name).toBe('Acme Pública');
        expect(meta.branding.logo_url).toMatch(new RegExp(`^/api/v1/files/${file!.id}/signed\\?tenant=${tenantId}&exp=\\d+&sig=[0-9a-f]+$`));
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

    it('el enlace caduca: pasada la fecha responde 404 (como un token desconocido)', async () => {
        await seed();
        const cfg = await publish({ expires_at: '2020-01-01' });
        await expect(pub.getMeta(cfg.token)).rejects.toThrow();
        await expect(pub.getRecords(cfg.token, {})).rejects.toThrow();
        // Con una fecha futura vuelve a servir, y sin fecha también.
        const alive = await publish({ expires_at: '2999-12-31' });
        expect((await pub.getRecords(alive.token, {})).data).toHaveLength(3);
        const forever = await publish({ expires_at: null });
        expect((await pub.getRecords(forever.token, {})).data).toHaveLength(3);
    });

    it('publicar UNA vista: sus filtros acotan lo que ve el visitante', async () => {
        await seed();
        const view = await withTenant(pg.db, tenantId, async (tx) => {
            const [row] = await tx
                .insert(savedViews)
                .values({
                    tenantId,
                    listId: (await lists_.get(tenantId, 'directorio')).id,
                    name: 'Grandes',
                    type: 'table',
                    config: {
                        filter_tree: {
                            type: 'group',
                            logic: 'and',
                            children: [
                                { type: 'condition', field_id: f.monto!.id, op: 'gte', value: 200 },
                            ],
                        },
                    },
                })
                .returning();
            return row!;
        });

        const cfg = await publish({ view_id: view.id });
        const page = await pub.getRecords(cfg.token, {});
        expect(page.data.map((r) => r.data.nombre).sort()).toEqual(['Ana', 'Carla']);
        expect((await pub.getMeta(cfg.token)).view_name).toBe('Grandes');

        // SEC-25 (v0.1.226): si la vista deja de poder aplicarse, NO se muestra
        // nada (antes: vista borrada o filtro sobre un campo desconocido → la
        // lista ENTERA a la vista).
        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(savedViews).set({
                config: {
                    filter_tree: {
                        type: 'group',
                        logic: 'and',
                        children: [{ type: 'condition', field_id: 999999, op: 'gte', value: 200 }],
                    },
                },
            }).where(eq(savedViews.id, view.id)),
        );
        expect((await pub.getRecords(cfg.token, {})).data).toHaveLength(0);
        await withTenant(pg.db, tenantId, (tx) => tx.delete(savedViews).where(eq(savedViews.id, view.id)));
        expect((await pub.getRecords(cfg.token, {})).data).toHaveLength(0);

        // Sin vista publicada vuelven los tres, y el nombre de vista queda en null.
        const all = await publish({ view_id: null });
        expect((await pub.getRecords(all.token, {})).data).toHaveLength(3);
        expect((await pub.getMeta(all.token)).view_name).toBeNull();
    });

    it('si el mapeo quedó con un token viejo, al guardar se re-sincroniza', async () => {
        await seed();
        const cfg = await publish();
        // Simulamos el estado corrupto: el mapeo apunta a otro token (pasaba
        // cuando el token de settings se regeneraba y el UNIQUE por lista
        // hacía que el insert no tocara la fila vieja).
        await pg.db
            .update(publicLists)
            .set({ token: 'token-viejo' })
            .where(eq(publicLists.listId, (await lists_.get(tenantId, 'directorio')).id));
        await expect(pub.getRecords(cfg.token, {})).rejects.toThrow();

        await publish({ per_page: 25 });
        expect((await pub.getRecords(cfg.token, {})).data).toHaveLength(3);
        await expect(pub.getRecords('token-viejo', {})).rejects.toThrow();
    });

    it('los campos se guardan por ID: renombrar el slug no los saca de la página', async () => {
        await seed();
        const cfg = await publish();
        const list = await lists_.get(tenantId, 'directorio');
        const stored = list.settings.public as Record<string, unknown>;
        expect(stored.visible_field_ids).toEqual([f.nombre!.id, f.email!.id, f.monto!.id]);
        expect(stored.visible_field_slugs).toBeUndefined();
        expect(stored.cache_ttl).toBeUndefined();
        await fields_.update(tenantId, 'directorio', String(f.monto!.id), { slug: 'importe' });
        const meta = await pub.getMeta(cfg.token);
        expect(meta.fields.map((x) => x.slug)).toContain('importe');
        expect(meta.sort_allowed).toContain('importe');
        const page = await pub.getRecords(cfg.token, { sort: 'importe:desc' });
        expect(page.data.map((r) => r.data.importe)).toEqual([300, 200, 100]);
        // La config vieja (por slug) se sigue leyendo.
        const admin = await pub.getAdmin(tenantId, 'directorio');
        expect(admin.visible_field_slugs).toContain('importe');
    });

    it('config vieja por slug: se lee y se convierte a ids al guardar', async () => {
        await seed();
        const cfg = await publish();
        const list = await lists_.get(tenantId, 'directorio');
        await lists_.update(tenantId, 'directorio', {
            settings: {
                ...list.settings,
                public: { enabled: true, token: cfg.token, visible_field_slugs: ['nombre'], sort_allowed_slugs: ['nombre'], default_sort: 'nombre:desc', cache_ttl: 60 },
            },
        });
        const meta = await pub.getMeta(cfg.token);
        expect(meta.fields.map((x) => x.slug)).toEqual(['nombre']);
        expect(meta.default_sort).toBe('nombre:desc');
        await pub.updateAdmin(tenantId, 'directorio', { per_page: 10 });
        const stored = (await lists_.get(tenantId, 'directorio')).settings.public as Record<string, unknown>;
        expect(stored).toMatchObject({ visible_field_ids: [f.nombre!.id], default_sort_field_id: f.nombre!.id, default_sort_dir: 'desc' });
        expect(stored.visible_field_slugs).toBeUndefined();
        expect(stored.default_sort).toBeUndefined();
    });

    it('orden NUMÉRICO (no como texto: 9 < 10 < 100)', async () => {
        for (const n of [100, 9, 10]) {
            await recs.create(tenantId, admin, 'directorio', { data: { [key('nombre')]: `N${n}`, [key('monto')]: n } });
        }
        const cfg = await publish();
        const asc = await pub.getRecords(cfg.token, { sort: 'monto:asc' });
        expect(asc.data.map((r) => r.data.monto)).toEqual([9, 10, 100]);
        const desc = await pub.getRecords(cfg.token, { sort: 'monto:desc' });
        expect(desc.data.map((r) => r.data.monto)).toEqual([100, 10, 9]);
    });

    it('meta trae lo necesario para mostrar como la app; personas y archivos llegan legibles', async () => {
        const estado = await fields_.create(tenantId, 'directorio', {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'al_dia', label: 'Al día', color: '#16a34a' }] },
        });
        const resp = await fields_.create(tenantId, 'directorio', { label: 'Responsable', type: 'user', slug: 'resp' });
        const adj = await fields_.create(tenantId, 'directorio', { label: 'Contrato', type: 'file', slug: 'contrato' });
        const [u] = await pg.db.insert(users).values({ email: `ana-${Date.now()}@acme.test`, passwordHash: 'x', name: 'Ana Pérez' }).returning();
        const [att] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(attachments).values({ tenantId, filename: 'contrato.pdf', mime: 'application/pdf', sizeBytes: 3, storageKey: `t${tenantId}/c.pdf`, createdBy: u!.id }).returning(),
        );
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: u!.id, role: 'agent' }));
        await recs.create(tenantId, admin, 'directorio', {
            data: { [key('nombre')]: 'Con todo', [`f${estado.id}`]: 'al_dia', [`f${resp.id}`]: u!.id, [`f${adj.id}`]: [att!.id] },
        });
        // SEC — un id de alguien que NO es de la empresa (lo escribe el sistema:
        // una persona no puede) no se resuelve a su nombre en la página pública.
        const [ajeno] = await pg.db.insert(users).values({ email: `ajeno-${Date.now()}@otra.test`, passwordHash: 'x', name: 'Persona Ajena' }).returning();
        await expect(recs.create(tenantId, admin, 'directorio', { data: { [key('nombre')]: 'Ajeno', [`f${resp.id}`]: ajeno!.id } })).rejects.toMatchObject({ response: { code: 'validation_failed' } });
        await recs.create(tenantId, { userId: 0, role: 'admin' }, 'directorio', { data: { [key('nombre')]: 'Zz ajeno', [`f${resp.id}`]: ajeno!.id } });
        await pg.db.update(tenants).set({ settings: { format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24', timezone: 'America/Bogota' } } }).where(eq(tenants.id, tenantId));
        const cfg = await pub.updateAdmin(tenantId, 'directorio', {
            enabled: true,
            visible_field_ids: [f.nombre!.id, estado.id, resp.id, adj.id],
        });
        const meta = await pub.getMeta(cfg.token);
        expect(meta.format).toMatchObject({ number_format: 'dot_comma', date_format: 'dmy' });
        expect(meta.fields.find((x) => x.slug === 'estado')!.options).toEqual([{ value: 'al_dia', label: 'Al día', color: '#16a34a' }]);
        const rows = (await pub.getRecords(cfg.token, {})).data;
        const row = rows.find((r) => r.data.nombre === 'Con todo')!;
        expect(row.data.resp).toBe('Ana Pérez');
        expect(JSON.stringify(rows)).not.toContain('Persona Ajena');
        expect(row.data.contrato).toEqual([{ name: 'contrato.pdf', url: expect.stringMatching(/^\/api\/v1\/files\/\d+\/signed\?/) }]);
        await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
    });

    it('la caducidad vale hasta el final del día en la zona de la empresa', () => {
        const tarde = new Date('2026-10-21T03:00:00Z'); // 22:00 del 20 en Bogotá
        expect(isExpired('2026-10-20', 'America/Bogota', tarde)).toBe(false);
        expect(isExpired('2026-10-20', 'UTC', tarde)).toBe(true);
        expect(isExpired('2026-10-20', 'America/Bogota', new Date('2026-10-21T05:01:00Z'))).toBe(true);
    });

    it('la página no disponible es HTML amable y la CSP sólo deja correr su script', () => {
        const csp = publicListPageCsp('n0nce', ['acme.com']);
        expect(csp).toContain("script-src 'nonce-n0nce'");
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-ancestors 'self' acme.com");
        const html = publicListUnavailablePage();
        expect(html).toContain('Esta lista no está disponible');
        expect(html).not.toContain('public_list');
        expect(renderPublicListPage('tok', 'Mi lista', 'n0nce')).toContain('<script nonce="n0nce">');
    });

    describe('con la caché de lo público (como en la app)', () => {
        /** Un Redis mínimo en memoria para el tope por enlace. */
        const fakeRedis = () => {
            const m = new Map<string, number>();
            return {
                incr: async (k: string) => {
                    m.set(k, (m.get(k) ?? 0) + 1);
                    return m.get(k)!;
                },
                expire: async () => 1,
            };
        };
        const cached = () => {
            const cache = new PublicCache({ maxEntries: 100, concurrency: 4, maxQueue: 50, queueTimeoutMs: 2000 });
            const tenantDb = new TenantDb(pg.db);
            const withTenantSpy = vi.spyOn(tenantDb, 'withTenant');
            const svc = new PublicListsService(
                pg.db,
                tenantDb,
                lists_,
                new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-pubc-'))), loadEnv({ FILES_SIGNING_SECRET: 'test-public-secret' })),
                undefined,
                cache as never,
                fakeRedis() as never,
            );
            return { svc, cache, withTenantSpy };
        };

        it('meta y la primera página se arman una vez: las visitas siguientes no tocan la base', async () => {
            const cfg = await publish();
            await seed();
            const { svc, withTenantSpy } = cached();
            const first = await svc.getRecords(cfg.token, {});
            await svc.getMeta(cfg.token);
            await svc.pageBootstrap(cfg.token);
            const after = withTenantSpy.mock.calls.length;
            // 3 transacciones en total: config, registros y meta (antes: 4 + 4 + 2 por visita).
            expect(after).toBe(3);
            for (let i = 0; i < 20; i++) {
                expect(await svc.getRecords(cfg.token, {})).toEqual(first);
                await svc.getMeta(cfg.token);
                await svc.pageBootstrap(cfg.token);
            }
            expect(withTenantSpy.mock.calls.length).toBe(after);
            // Veinte visitas a la vez de otra página: UNA consulta.
            await Promise.all(Array.from({ length: 20 }, () => svc.getRecords(cfg.token, { sort: 'nombre:desc' })));
            expect(withTenantSpy.mock.calls.length).toBe(after + 1);
        });

        it('despublicar u ocultar un campo vale al instante (no espera a que venza la caché)', async () => {
            const cfg = await publish();
            await seed();
            const { svc } = cached();
            expect(Object.keys((await svc.getRecords(cfg.token, {})).data[0]!.data)).toContain('email');
            await svc.updateAdmin(tenantId, 'directorio', { visible_field_slugs: ['nombre'] });
            expect(Object.keys((await svc.getRecords(cfg.token, {})).data[0]!.data)).toEqual(['nombre']);
            expect((await svc.getMeta(cfg.token)).fields.map((x) => x.slug)).toEqual(['nombre']);
            await svc.updateAdmin(tenantId, 'directorio', { enabled: false });
            await expect(svc.getRecords(cfg.token, {})).rejects.toBeInstanceOf(NotFoundException);
            await expect(svc.getMeta(cfg.token)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('la caducidad se mira en cada pedido aunque la config esté guardada', async () => {
            const cfg = await publish();
            const { svc } = cached();
            await svc.getMeta(cfg.token);
            // Vence por fuera del servicio (sin invalidar): la fecha ya está en la config guardada…
            await svc.updateAdmin(tenantId, 'directorio', { expires_at: '2099-01-01' });
            await svc.getMeta(cfg.token);
            vi.useFakeTimers({ now: new Date('2099-06-01T00:00:00Z'), toFake: ['Date'] });
            try {
                await expect(svc.getMeta(cfg.token)).rejects.toBeInstanceOf(NotFoundException);
            } finally {
                vi.useRealTimers();
            }
        });

        it('una búsqueda de una letra no busca; el tope por enlace corta las consultas que no salen de la caché', async () => {
            const cfg = await publish();
            await seed();
            const { svc } = cached();
            // "a" coincidiría con Ana y Carla: con una letra se ignora y llegan los 3.
            expect((await svc.getRecords(cfg.token, { search: 'a' })).data).toHaveLength(3);
            expect((await svc.getRecords(cfg.token, { search: 'an' })).data.map((r) => r.data.nombre)).toEqual(['Ana']);
            // Cada búsqueda distinta llega a la base: pasado el tope, 429.
            let limited = 0;
            for (let i = 0; i < PUBLIC_LIST_QUERIES_PER_MINUTE + 5; i++) {
                await svc.getRecords(cfg.token, { search: `zz${i}` }).catch((e: { getStatus?: () => number }) => {
                    if (e.getStatus?.() === 429) limited += 1;
                    else throw e;
                });
            }
            expect(limited).toBeGreaterThanOrEqual(4);
            // Lo que ya está guardado se sigue sirviendo.
            expect((await svc.getRecords(cfg.token, { search: 'a' })).data).toHaveLength(3);
        });

        it('la paginación no pasa de la fila tope', async () => {
            const cfg = await publish();
            await seed();
            const { svc, withTenantSpy } = cached();
            await svc.getMeta(cfg.token);
            const before = withTenantSpy.mock.calls.length;
            expect(await svc.getRecords(cfg.token, { cursor: PUBLIC_LIST_MAX_OFFSET + 1 })).toEqual({ data: [], meta: { next_cursor: null } });
            expect(withTenantSpy.mock.calls.length).toBe(before);
        });
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

    it('seguridad: un dominio guardado que no es un dominio no llega a la cabecera CSP, y al guardar se rechaza', () => {
        // Lo ya guardado (antes no se validaba): se descarta lo que no es un host u origen.
        const csp = publicListPageCsp('n0nce', ["acme.com; script-src-elem 'unsafe-inline' *", 'ok.com', 'x\r\nSet-Cookie: a=b', '*.acme.com']);
        expect(csp).toContain("frame-ancestors 'self' ok.com *.acme.com");
        expect(csp).not.toContain('script-src-elem');
        expect(csp).not.toContain('Set-Cookie');
        expect(csp).not.toMatch(/[\r\n]/);
        // Si NINGUNO sirve, no se abre a cualquiera.
        expect(frameAncestors(['no es un dominio; x'])).toBe("frame-ancestors 'self'");
        // Al guardar, el esquema del PATCH lo rechaza; los válidos pasan.
        expect(updatePublicListSchema.safeParse({ allowed_domains: ["acme.com; script-src *"] }).success).toBe(false);
        expect(updatePublicListSchema.safeParse({ allowed_domains: ['acme.com', '*.acme.com', 'https://www.acme.com'] }).success).toBe(true);
        expect(updatePublicListSchema.safeParse({ enabled: true }).success).toBe(true);
    });
});
