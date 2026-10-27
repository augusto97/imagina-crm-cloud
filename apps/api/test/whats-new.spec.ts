import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { WHATS_NEW_CATALOG, type WhatsNewCatalogEntry } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memberships, tenants, users, whatsNewEntries, whatsNewViews } from '../src/db/schema';
import { withUser } from '../src/db/tenant-tx';
import { LocalFileStorage } from '../src/files/file-storage';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { FIRST_ARRIVAL_NEW, MAX_NEW_PER_SYNC, parseCatalog, planCatalogSync } from '../src/whats-new/catalog-sync';
import { sniffImage } from '../src/whats-new/image-sniff';
import { MAX_WHATS_NEW_IMAGE_BYTES, WhatsNewAdminService } from '../src/whats-new/whats-new-admin.service';
import { deleteWhatsNewViewsForUser } from '../src/whats-new/whats-new-cleanup';
import { WhatsNewSyncService } from '../src/whats-new/whats-new-sync.service';
import { WhatsNewService, type WhatsNewViewer } from '../src/whats-new/whats-new.service';
import { startPostgres, type TestPg } from './helpers/containers';

const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

function extra(version: string, over: Partial<WhatsNewCatalogEntry> = {}): WhatsNewCatalogEntry {
    return {
        key: `v${version}-prueba`,
        version,
        date: '2026-10-26',
        kind: 'improvement',
        title: `Mejora de la versión ${version}`,
        summary: 'Una mejora para probar la sincronización.',
        ...over,
    };
}

/**
 * Cuántas de la primera llegada ve como nuevas una persona con ese rol. Se
 * calcula del catálogo (no a mano): cada versión suma su novedad al final.
 */
function firstArrivalUnseenFor(role: string): number {
    const now = new Date();
    const { entries } = parseCatalog(WHATS_NEW_CATALOG, now);
    const announced = new Set(planCatalogSync({ existing: [], catalog: entries, now }).announced);
    return WHATS_NEW_CATALOG.filter((e) => announced.has(e.key) && (!e.audience?.roles?.length || e.audience.roles.includes(role as never))).length;
}

/**
 * La destacada que le toca a ese rol en la primera llegada (o null): la más
 * reciente entre las anunciadas, como la elige el servicio. Se calcula del
 * catálogo para que sumar una novedad no rompa la prueba.
 */
function firstArrivalFeaturedFor(role: string): string | null {
    const now = new Date();
    const { entries } = parseCatalog(WHATS_NEW_CATALOG, now);
    const announced = new Set(planCatalogSync({ existing: [], catalog: entries, now }).announced);
    const candidates = WHATS_NEW_CATALOG.map((e, index) => ({ e, index })).filter(
        ({ e }) => e.featured && e.kind !== 'notice' && announced.has(e.key) && (!e.audience?.roles?.length || e.audience.roles.includes(role as never)),
    );
    candidates.sort((a, b) => (a.e.date === b.e.date ? b.index - a.index : a.e.date < b.e.date ? 1 : -1));
    return candidates[0]?.e.key ?? null;
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c30000000049454e44ae426082', 'hex');

describe('Novedades — sincronización pura', () => {
    it('primera llegada: anuncia las 6 más recientes; las demás quedan como historial', () => {
        const now = new Date();
        const { entries } = parseCatalog(WHATS_NEW_CATALOG, now);
        const plan = planCatalogSync({ existing: [], catalog: entries, now });
        expect(plan.inserts).toHaveLength(WHATS_NEW_CATALOG.length);
        expect(plan.announced).toHaveLength(FIRST_ARRIVAL_NEW);
        // Las anunciadas son las de versión más alta.
        const versions = plan.inserts.filter((i) => i.announceFrom !== null).map((i) => i.version);
        const all = [...entries].map((e) => e.version).sort((a, b) => (a < b ? 1 : -1));
        expect(versions.every((v) => all.slice(0, FIRST_ARRIVAL_NEW + 1).includes(v))).toBe(true);
        expect(plan.inserts.filter((i) => i.announceFrom === null)).toHaveLength(WHATS_NEW_CATALOG.length - FIRST_ARRIVAL_NEW);
    });

    it('una actualización con muchas novedades anuncia sólo las 8 más recientes', () => {
        const now = new Date();
        const base = parseCatalog([extra('0.2.0')], now).entries;
        const existing = base.map((e, i) => ({ id: i + 1, key: e.key, edited: false, content: { ...e } }));
        const many = Array.from({ length: 12 }, (_, i) => extra(`0.3.${i}`));
        const { entries } = parseCatalog([extra('0.2.0'), ...many], now);
        const plan = planCatalogSync({ existing, catalog: entries, now });
        expect(plan.inserts).toHaveLength(12);
        expect(plan.announced).toHaveLength(MAX_NEW_PER_SYNC);
        expect(plan.announced[0]).toBe('v0.3.11-prueba');
        expect(plan.updates).toHaveLength(0);
    });

    it('una entrada inválida se descarta con su motivo (no tumba el arranque)', () => {
        const { entries, invalid } = parseCatalog([extra('0.4.0'), { ...extra('0.4.1'), title: '' }, extra('0.4.0')], new Date());
        expect(entries).toHaveLength(1);
        expect(invalid.map((i) => i.key)).toEqual(['v0.4.1-prueba', 'v0.4.0-prueba']);
    });

    it('reconoce las imágenes por sus bytes, nunca SVG', () => {
        expect(sniffImage(PNG)?.ext).toBe('png');
        expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
        expect(sniffImage(Buffer.from('GIF89a......'))?.ext).toBe('gif');
        expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
        expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
        expect(sniffImage(Buffer.from('<html>'))).toBeNull();
    });
});

describe('Novedades (Postgres real)', () => {
    let pg: TestPg;
    let sync: WhatsNewSyncService;
    let svc: WhatsNewService;
    let admin: WhatsNewAdminService;
    let uploads: string;
    let tenantId: number;
    let trialTenant: number;
    let oldAdmin: number;
    let oldAgent: number;
    let guest: number;
    let operator: number;
    let lateUser: number;

    const viewer = (userId: number, baseRole: string, t = tenantId, impersonating = false): WhatsNewViewer => ({ userId, tenantId: t, baseRole, impersonating });

    beforeAll(async () => {
        pg = await startPostgres();
        uploads = mkdtempSync(path.join(tmpdir(), 'whats-new-'));
        sync = new WhatsNewSyncService(pg.db);
        svc = new WhatsNewService(pg.db, new TenantDb(pg.db));
        admin = new WhatsNewAdminService(pg.db, new LocalFileStorage(uploads));

        const [t] = await pg.db.insert(tenants).values({ slug: 'novedades', name: 'Novedades', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'novedades-trial', name: 'Prueba', plan: 'trial' }).returning();
        trialTenant = t2!.id;
        const mk = async (email: string, role: 'admin' | 'agent' | 'guest' | 'viewer', createdAt: Date): Promise<number> => {
            const [u] = await pg.db.insert(users).values({ email, passwordHash: 'x', name: email.split('@')[0]!, createdAt }).returning();
            await pg.db.insert(memberships).values({ userId: u!.id, tenantId, role });
            return u!.id;
        };
        oldAdmin = await mk('ana@nov.test', 'admin', daysAgo(60));
        oldAgent = await mk('beto@nov.test', 'agent', daysAgo(60));
        guest = await mk('invitada@nov.test', 'guest', daysAgo(60));
        operator = await mk('operador@nov.test', 'admin', daysAgo(90));
        await pg.db.insert(memberships).values({ userId: oldAdmin, tenantId: trialTenant, role: 'admin' });
    });

    afterAll(async () => {
        await pg?.stop();
        rmSync(uploads, { recursive: true, force: true });
    });

    it('arranque: siembra el catálogo; dos nodos a la vez no duplican y un segundo arranque no cambia nada', async () => {
        const [a, b] = await Promise.all([sync.sync(WHATS_NEW_CATALOG, daysAgo(10)), sync.sync(WHATS_NEW_CATALOG, daysAgo(10))]);
        expect(a.inserted + b.inserted).toBe(WHATS_NEW_CATALOG.length);
        const [n] = await pg.db.select({ n: sql<number>`count(*)::int` }).from(whatsNewEntries);
        expect(n!.n).toBe(WHATS_NEW_CATALOG.length);
        const again = await sync.sync(WHATS_NEW_CATALOG, daysAgo(9));
        expect(again).toMatchObject({ inserted: 0, updated: 0, announced: [] });
        const announced = await pg.db.select({ key: whatsNewEntries.key }).from(whatsNewEntries).where(sql`${whatsNewEntries.announceFrom} IS NOT NULL`);
        expect(announced).toHaveLength(FIRST_ARRIVAL_NEW);
    });

    it('quien ya tenía cuenta ve como nuevo lo que llegó; quien llegó después, no; cada rol ve lo suyo', async () => {
        const adminFeed = await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100 });
        expect(adminFeed.items).toHaveLength(WHATS_NEW_CATALOG.length);
        expect(adminFeed.unseen_count).toBe(FIRST_ARRIVAL_NEW);
        expect(adminFeed.items.filter((i) => i.is_new)).toHaveLength(FIRST_ARRIVAL_NEW);
        // La destacada: la más reciente de las anunciadas que el rol puede ver.
        expect(adminFeed.featured?.key ?? null).toBe(firstArrivalFeaturedFor('admin'));

        const agentFeed = await svc.feed(viewer(oldAgent, 'agent'), { limit: 100 });
        // Un agente no ve lo que sólo configura un admin.
        expect(agentFeed.items.some((i) => i.key === 'v0.1.317-agentes-ia')).toBe(false);
        expect(agentFeed.items.every((i) => i.key !== 'v0.1.304-formulas-y-botones')).toBe(true);
        expect(agentFeed.unseen_count).toBe(firstArrivalUnseenFor('agent'));
        expect(agentFeed.featured?.key ?? null).toBe(firstArrivalFeaturedFor('agent'));

        // Un invitado no ve funciones nuevas (sólo avisos).
        const guestFeed = await svc.feed(viewer(guest, 'guest'), { limit: 100 });
        expect(guestFeed).toMatchObject({ items: [], unseen_count: 0, featured: null });

        // Alguien que se da de alta después: todo es historial.
        const [u] = await pg.db.insert(users).values({ email: 'nueva@nov.test', passwordHash: 'x', name: 'Nueva', createdAt: daysAgo(8) }).returning();
        lateUser = u!.id;
        await pg.db.insert(memberships).values({ userId: lateUser, tenantId, role: 'admin' });
        const lateFeed = await svc.feed(viewer(lateUser, 'admin'), { limit: 100 });
        expect(lateFeed.items).toHaveLength(WHATS_NEW_CATALOG.length);
        expect(lateFeed.unseen_count).toBe(0);
        expect(lateFeed.featured).toBeNull();
    });

    it('una actualización trae su novedad como nueva, aunque la versión haya salido hace semanas', async () => {
        // Destacada: la prueba de «se presenta una sola vez» la usa (no depende del catálogo).
        const res = await sync.sync([...WHATS_NEW_CATALOG, extra('9.0.0', { date: '2026-01-15', featured: true })], daysAgo(5));
        expect(res).toMatchObject({ inserted: 1, announced: ['v9.0.0-prueba'] });
        const feed = await svc.feed(viewer(lateUser, 'admin'), { limit: 5 });
        // La fecha que se muestra es la de la versión; «nueva» cuenta desde que llegó.
        const item = feed.items.find((i) => i.key === 'v9.0.0-prueba') ?? (await svc.feed(viewer(lateUser, 'admin'), { limit: 100 })).items.find((i) => i.key === 'v9.0.0-prueba');
        expect(item?.is_new).toBe(true);
        expect(item?.published_at.startsWith('2026-01-15')).toBe(true);
        expect(feed.unseen_count).toBe(1);
    });

    it('paginación por cursor y filtro por tipo', async () => {
        const p1 = await svc.feed(viewer(oldAdmin, 'admin'), { limit: 5 });
        expect(p1.items).toHaveLength(5);
        expect(p1.has_more).toBe(true);
        const p2 = await svc.feed(viewer(oldAdmin, 'admin'), { limit: 5, before: p1.next_before! });
        expect(p2.items.map((i) => i.id).some((id) => p1.items.some((x) => x.id === id))).toBe(false);
        const fixes = await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100, kind: 'improvement' });
        expect(fixes.items.every((i) => i.kind === 'improvement')).toBe(true);
    });

    it('marcar como visto: sólo lo suyo, y no mientras el operador mira como la persona', async () => {
        const before = await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100 });
        const first = before.items.find((i) => i.is_new)!;
        // Impersonando: no se escribe nada.
        await svc.markSeen(viewer(oldAdmin, 'admin', tenantId, true), { ids: [first.id] });
        await svc.event(viewer(oldAdmin, 'admin', tenantId, true), first.id, 'clicked');
        expect((await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100 })).unseen_count).toBe(before.unseen_count);

        const r = await svc.markSeen(viewer(oldAdmin, 'admin'), { ids: [first.id] });
        expect(r.unseen_count).toBe(before.unseen_count - 1);
        // Otra persona no cambia (las suyas de la primera llegada + la de la actualización).
        expect((await svc.feed(viewer(oldAgent, 'agent'), { limit: 100 })).unseen_count).toBe(firstArrivalUnseenFor('agent') + 1);

        // RLS: dentro del scope de otra persona no se ven ni se escriben sus filas.
        const visibleToAgent = await withUser(pg.db, oldAgent, (tx) => tx.select().from(whatsNewViews));
        expect(visibleToAgent).toHaveLength(0);
        await expect(
            withUser(pg.db, oldAgent, (tx) => tx.insert(whatsNewViews).values({ userId: oldAdmin, entryId: first.id, seenAt: new Date() })),
        ).rejects.toThrow();
        // Y el rol de la app no puede tocar las novedades (son de la plataforma).
        await expect(withUser(pg.db, oldAgent, (tx) => tx.update(whatsNewEntries).set({ title: 'x' }))).rejects.toThrow();

        // Una novedad que la persona no ve no se puede marcar.
        const adminOnly = before.items.find((i) => i.key === 'v0.1.317-agentes-ia')!;
        await expect(svc.event(viewer(oldAgent, 'agent'), adminOnly.id, 'clicked')).rejects.toThrow();

        const all = await svc.markSeen(viewer(oldAdmin, 'admin'), { all: true });
        expect(all.unseen_count).toBe(0);
    });

    it('la destacada se presenta una sola vez a cada persona', async () => {
        const f1 = await svc.feed(viewer(oldAgent, 'agent'), { limit: 1 });
        // La que llegó con la última actualización va primero.
        expect(f1.featured?.key).toBe('v9.0.0-prueba');
        await svc.event(viewer(oldAgent, 'agent'), f1.featured!.id, 'presented');
        const f2 = await svc.feed(viewer(oldAgent, 'agent'), { limit: 1 });
        expect(f2.featured).toBeNull();
        // Presentarla también la marca como vista.
        expect(f2.unseen_count).toBe(f1.unseen_count - 1);
    });

    it('avisos: franja hasta que se cierra o vence; un invitado los ve; público por rol y plan', async () => {
        const notice = await admin.create(
            {
                kind: 'notice',
                title: 'Mantenimiento programado',
                summary: 'El sábado de 10 a 11 p. m. la app puede estar lenta.',
                body: '',
                image_url: null,
                video_url: null,
                action: null,
                version: null,
                featured: true,
                audience: { roles: [], plans: [] },
                expires_at: new Date(Date.now() + 3 * DAY).toISOString(),
                status: 'published',
                publish_at: null,
            },
            operator,
        );
        // Un aviso nunca es destacado (va en la franja).
        expect(notice.featured).toBe(false);
        // Lo que publica el operador no es «nuevo» para él mismo.
        const own = await svc.feed(viewer(operator, 'admin'), { limit: 100 });
        expect(own.items.find((i) => i.id === notice.id)?.is_new).toBe(false);
        expect((await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100 })).items.find((i) => i.id === notice.id)?.is_new).toBe(true);
        const g = await svc.feed(viewer(guest, 'guest'), { limit: 10 });
        expect(g.notices.map((n) => n.id)).toEqual([notice.id]);
        expect(g.items.map((n) => n.id)).toEqual([notice.id]);
        await svc.event(viewer(guest, 'guest'), notice.id, 'dismissed');
        expect((await svc.feed(viewer(guest, 'guest'), { limit: 10 })).notices).toHaveLength(0);
        // Cerrarlo es de la invitada: el admin lo sigue viendo.
        expect((await svc.feed(viewer(oldAdmin, 'admin'), { limit: 10 })).notices.map((n) => n.id)).toEqual([notice.id]);

        // Vencido: desaparece de la franja y del panel.
        await pg.db.update(whatsNewEntries).set({ expiresAt: daysAgo(1), publishedAt: daysAgo(2) }).where(eq(whatsNewEntries.id, notice.id));
        const expired = await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100 });
        expect(expired.notices).toHaveLength(0);
        expect(expired.items.some((i) => i.id === notice.id)).toBe(false);

        // Público: sólo admins del plan pro.
        const pro = await admin.create(
            {
                kind: 'feature',
                title: 'Sólo para admins de pro',
                summary: 'Algo nuevo.',
                body: '',
                image_url: null,
                video_url: null,
                action: { label: 'Ver', href: '/lists' },
                version: null,
                featured: false,
                audience: { roles: ['admin'], plans: ['pro'] },
                expires_at: null,
                status: 'published',
                publish_at: null,
            },
            operator,
        );
        expect((await svc.feed(viewer(oldAdmin, 'admin'), { limit: 3 })).items[0]?.id).toBe(pro.id);
        expect((await svc.feed(viewer(oldAgent, 'agent'), { limit: 100 })).items.some((i) => i.id === pro.id)).toBe(false);
        expect((await svc.feed(viewer(oldAdmin, 'admin', trialTenant), { limit: 100 })).items.some((i) => i.id === pro.id)).toBe(false);
    });

    it('programar: no se ve antes de su fecha; borrador nunca', async () => {
        const base = {
            kind: 'feature' as const,
            title: 'Programada',
            summary: 'Sale mañana.',
            body: '',
            image_url: null,
            video_url: null,
            action: null,
            version: null,
            featured: false,
            audience: { roles: [], plans: [] },
            expires_at: null,
        };
        const later = await admin.create({ ...base, status: 'published', publish_at: new Date(Date.now() + DAY).toISOString() }, operator);
        const draft = await admin.create({ ...base, title: 'Borrador', status: 'draft', publish_at: null }, operator);
        expect(draft.published_at).toBeNull();
        let feed = await svc.feed(viewer(oldAgent, 'agent'), { limit: 100 });
        expect(feed.items.some((i) => i.id === later.id || i.id === draft.id)).toBe(false);
        // Se adelanta la fecha: aparece y es nueva para quien ya tenía cuenta.
        await admin.update(later.id, { publish_at: daysAgo(0.01).toISOString() }, operator);
        // Publicar el borrador: toma la fecha de ahora.
        const published = await admin.update(draft.id, { status: 'published' }, operator);
        expect(published.published_at).not.toBeNull();
        feed = await svc.feed(viewer(oldAgent, 'agent'), { limit: 100 });
        const both = feed.items.filter((i) => i.id === later.id || i.id === draft.id);
        expect(both).toHaveLength(2);
        expect(both.every((i) => i.is_new)).toBe(true);
        // Vencimiento antes de publicar: se rechaza.
        await expect(admin.update(later.id, { expires_at: daysAgo(30).toISOString() }, operator)).rejects.toThrow();
    });

    it('editar una novedad de versión: la sincronización la respeta; restaurar vuelve al texto original; ocultar la saca', async () => {
        const [row] = await pg.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.key, 'v0.1.296-papelera'));
        const edited = await admin.update(row!.id, { title: 'Papelera (texto del operador)' }, operator);
        expect(edited).toMatchObject({ edited: true, in_catalog: true, title: 'Papelera (texto del operador)' });
        // Una versión nueva cambia el texto del catálogo: la editada no se toca.
        const changed = WHATS_NEW_CATALOG.map((e) => (e.key === 'v0.1.296-papelera' ? { ...e, title: 'Otro título de la versión' } : e));
        await sync.sync(changed, daysAgo(1));
        const [after] = await pg.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.id, row!.id));
        expect(after!.title).toBe('Papelera (texto del operador)');
        // Las no editadas sí se actualizan.
        await sync.sync(WHATS_NEW_CATALOG.map((e) => (e.key === 'v0.1.297-kanban-ventas' ? { ...e, summary: 'Resumen corregido.' } : e)), daysAgo(1));
        const [kanban] = await pg.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.key, 'v0.1.297-kanban-ventas'));
        expect(kanban!.summary).toBe('Resumen corregido.');

        const restored = await admin.restore(row!.id, operator);
        expect(restored.edited).toBe(false);
        expect(restored.title).toBe(WHATS_NEW_CATALOG.find((e) => e.key === 'v0.1.296-papelera')!.title);

        // Ocultar no la marca como editada, y la sincronización respeta el estado.
        const hidden = await admin.update(row!.id, { status: 'hidden' }, operator);
        expect(hidden).toMatchObject({ status: 'hidden', edited: false });
        await sync.sync(WHATS_NEW_CATALOG, daysAgo(1));
        expect((await svc.feed(viewer(oldAdmin, 'admin'), { limit: 100 })).items.some((i) => i.id === row!.id)).toBe(false);
        // Una de versión no se borra ni vuelve a borrador.
        await expect(admin.remove(row!.id, operator)).rejects.toThrow();
        await expect(admin.update(row!.id, { status: 'draft' }, operator)).rejects.toThrow();
    });

    it('estadísticas: vistas, abiertas y clics por novedad', async () => {
        const [row] = await pg.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.key, 'v0.1.316-mesa-de-ayuda'));
        await svc.event(viewer(oldAgent, 'agent'), row!.id, 'opened');
        await svc.event(viewer(oldAgent, 'agent'), row!.id, 'clicked');
        await svc.event(viewer(oldAgent, 'agent'), row!.id, 'clicked');
        await svc.event(viewer(lateUser, 'admin'), row!.id, 'opened');
        const list = await admin.list();
        const entry = list.items.find((i) => i.id === row!.id)!;
        expect(entry.stats.seen).toBeGreaterThanOrEqual(2);
        expect(entry.stats).toMatchObject({ opened: 2, clicked: 1 });
        expect(list.people).toBeGreaterThanOrEqual(5);
    });

    it('imágenes: PNG se guarda y se sirve; SVG y lo que pasa de 5 MB, no', async () => {
        const { url } = await admin.uploadImage(Readable.from(PNG));
        expect(url).toMatch(/^\/api\/v1\/public\/whats-new\/images\/[a-f0-9]{32}\.png$/);
        const name = url.split('/').pop()!;
        const stream = await admin.openImage(name);
        const chunks: Buffer[] = [];
        for await (const c of stream!) chunks.push(c as Buffer);
        expect(Buffer.concat(chunks).equals(PNG)).toBe(true);
        expect(await admin.openImage('../../etc/passwd')).toBeNull();
        expect(await admin.openImage(`${'b'.repeat(32)}.png`)).toBeNull();
        await expect(admin.uploadImage(Readable.from(Buffer.from('<svg><script>alert(1)</script></svg>')))).rejects.toThrow();
        await expect(admin.uploadImage(Readable.from(Buffer.alloc(MAX_WHATS_NEW_IMAGE_BYTES + 10, 0xff)))).rejects.toThrow();

        // Una novedad con esa imagen; al borrarla, el archivo se va.
        const e = await admin.create(
            {
                kind: 'feature',
                title: 'Con imagen',
                summary: 'Mira.',
                body: '',
                image_url: url,
                video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                action: null,
                version: null,
                featured: false,
                audience: { roles: [], plans: [] },
                expires_at: null,
                status: 'draft',
                publish_at: null,
            },
            operator,
        );
        expect(e.image_url).toBe(url);
        await admin.remove(e.id, operator);
        expect(await admin.openImage(name)).toBeNull();
    });

    it('borrar la cuenta limpia lo que vio la persona (y sólo lo suyo)', async () => {
        const [mine] = await pg.db.select({ n: sql<number>`count(*)::int` }).from(whatsNewViews).where(eq(whatsNewViews.userId, oldAgent));
        expect(mine!.n).toBeGreaterThan(0);
        const [others] = await pg.db.select({ n: sql<number>`count(*)::int` }).from(whatsNewViews).where(sql`${whatsNewViews.userId} <> ${oldAgent}`);
        await deleteWhatsNewViewsForUser(pg.db, oldAgent);
        const [after] = await pg.db.select({ n: sql<number>`count(*)::int` }).from(whatsNewViews).where(eq(whatsNewViews.userId, oldAgent));
        expect(after!.n).toBe(0);
        const [othersAfter] = await pg.db.select({ n: sql<number>`count(*)::int` }).from(whatsNewViews).where(sql`${whatsNewViews.userId} <> ${oldAgent}`);
        expect(othersAfter!.n).toBe(others!.n);
    });
});
