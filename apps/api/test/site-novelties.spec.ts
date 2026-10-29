import type { SiteDiscovery } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { computeNovelties, dismissNovelties, MAX_NOVELTIES, pendingNovelties, readNovelties, readSeen } from '../src/site-sync/site-novelties';
import type { SiteSyncSettings } from '../src/site-sync/site-sync.types';

/**
 * v0.1.336 — novedades del sitio: lo que apareció en WordPress desde la última
 * vez que se miró. Funciones puras: sin sitio ni base.
 */
type Obj = SiteDiscovery['objects'][number];
const col = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, label, source: 'acf', provider: null, private: false, ...extra });
const object = (o: string, label: string, columns: Array<ReturnType<typeof col>>): Obj =>
    ({ kind: 'post_type', object: o, label, columns } as unknown as Obj);
const discovery = (...objects: Obj[]) => ({ objects });
const settings = (objects: Record<string, string[]>) =>
    ({ objects: Object.fromEntries(Object.entries(objects).map(([r, cols]) => [r, { columns: cols.map((key) => ({ key })) }])) }) as unknown as Pick<SiteSyncSettings, 'objects'>;

describe('v0.1.336 — novedades del sitio', () => {
    it('la primera vez no hay con qué comparar: lo de hoy es la base, sin novedades', () => {
        const d = discovery(object('post', 'Entradas', [col('title', 'Título'), col('acf:precio', 'Precio')]), object('page', 'Páginas', []));
        const r = computeNovelties(d, null, settings({ 'post:post': ['title'] }));
        expect(r.items).toEqual([]);
        expect(r.seen.objects.sort()).toEqual(['post:page', 'post:post']);
        expect(r.seen.columns['post:post']).toEqual(['title', 'acf:precio']);
    });

    it('un tipo de contenido nuevo y una columna nueva se avisan; lo que se eligió no traer al conectar, no', () => {
        const seen = { objects: ['post:post', 'post:page'], columns: { 'post:post': ['title', 'acf:precio'] } };
        const d = discovery(
            object('post', 'Entradas', [col('title', 'Título'), col('acf:precio', 'Precio'), col('acf:metraje', 'Metraje'), col('meta:_edit_lock', 'Bloqueo', { private: true })]),
            object('page', 'Páginas', []),
            object('proyecto', 'Proyectos', []),
        );
        const r = computeNovelties(d, seen, settings({ 'post:post': ['title'] }));
        expect(r.items.map((i) => [i.resource, i.column?.key ?? null])).toEqual([
            ['post:post', 'acf:metraje'],
            ['post:proyecto', null],
        ]);
        expect(r.items[1]!.object_label).toBe('Proyectos');
        // Las internas de los plugins (con `_`) nunca son novedad.
        expect(r.items.some((i) => i.column?.key === 'meta:_edit_lock')).toBe(false);
        // Lo avisado NO entra a la base hasta que la persona lo ve o lo trae.
        expect(r.seen.columns['post:post']).toEqual(['title', 'acf:precio']);
        expect(r.seen.objects).not.toContain('post:proyecto');
    });

    it('un tipo recién sumado a la sincronización toma su base sin avisar todas sus columnas', () => {
        const seen = { objects: ['post:post', 'post:proyecto'], columns: { 'post:post': ['title'] } };
        const d = discovery(object('post', 'Entradas', [col('title', 'Título')]), object('proyecto', 'Proyectos', [col('title', 'Título'), col('acf:pisos', 'Pisos')]));
        const r = computeNovelties(d, seen, settings({ 'post:post': ['title'], 'post:proyecto': ['title'] }));
        expect(r.items).toEqual([]);
        expect(r.seen.columns['post:proyecto']).toEqual(['title', 'acf:pisos']);
    });

    it('tope de novedades guardadas', () => {
        const many = Array.from({ length: MAX_NOVELTIES + 20 }, (_, i) => col(`acf:c${i}`, `C${i}`));
        const r = computeNovelties(discovery(object('post', 'Entradas', many)), { objects: ['post:post'], columns: { 'post:post': [] } }, settings({ 'post:post': [] }));
        expect(r.items).toHaveLength(MAX_NOVELTIES);
    });

    it('«Ya lo vi» pasa a la base sólo lo indicado (o todo)', () => {
        const items = computeNovelties(
            discovery(object('post', 'Entradas', [col('acf:a', 'A'), col('acf:b', 'B')]), object('proyecto', 'Proyectos', [])),
            { objects: ['post:post'], columns: { 'post:post': [] } },
            settings({ 'post:post': [] }),
        ).items;
        expect(items).toHaveLength(3);
        const one = dismissNovelties(items, { objects: ['post:post'], columns: { 'post:post': [] } }, [{ resource: 'post:post', key: 'acf:a' }]);
        expect(one.items.map((i) => i.column?.key ?? i.resource)).toEqual(['acf:b', 'post:proyecto']);
        expect(one.seen.columns['post:post']).toEqual(['acf:a']);
        const all = dismissNovelties(one.items, one.seen, undefined);
        expect(all.items).toEqual([]);
        expect(all.seen.objects).toContain('post:proyecto');
        expect(all.seen.columns['post:post']?.sort()).toEqual(['acf:a', 'acf:b']);
    });

    it('lo que ya se trae deja de mostrarse aunque estuviera guardado', () => {
        const items = computeNovelties(
            discovery(object('post', 'Entradas', [col('acf:a', 'A')]), object('proyecto', 'Proyectos', [])),
            { objects: ['post:post'], columns: { 'post:post': [] } },
            settings({ 'post:post': [] }),
        ).items;
        expect(pendingNovelties(items, settings({ 'post:post': ['acf:a'] }))).toEqual([expect.objectContaining({ resource: 'post:proyecto' })]);
        expect(pendingNovelties(items, settings({ 'post:post': [], 'post:proyecto': ['title'] })).map((i) => i.column?.key)).toEqual(['acf:a']);
    });

    it('lee lo guardado con tolerancia', () => {
        expect(readSeen({})).toBeNull();
        expect(readSeen({ seen: { objects: ['post:post', 3], columns: { 'post:post': ['title', null] } } })).toEqual({ objects: ['post:post'], columns: { 'post:post': ['title'] } });
        expect(readNovelties({})).toBeNull();
        const n = readNovelties({ novelties: { checked_at: '2026-10-29T10:00:00Z', items: [{ resource: 'post:post', object: 'post', column: { key: 'acf:a', source: 'raro' } }, { foo: 1 }], error: '' } })!;
        expect(n.items).toHaveLength(1);
        expect(n.items[0]!.column).toEqual({ key: 'acf:a', label: 'acf:a', source: 'meta', provider: null });
        expect(n.items[0]!.object_label).toBe('post');
        expect(n.error).toBeNull();
    });
});
