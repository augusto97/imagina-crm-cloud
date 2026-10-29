import { describe, expect, it } from 'vitest';
import {
    isMirrorField,
    mirrorCellAccess,
    mirrorColumnKind,
    mirrorFieldKey,
    mirrorFromPlace,
    mirrorSettingsPath,
    mirrorSourceName,
    mirrorValueError,
    readMirrorListMarker,
} from './mirror-list';
import { siteCellAccess, siteValueError } from './site-rules';
import { parseSiteResourceKey, readSiteListMarker, siteColumnKeySchema, siteCoreColumns, siteResourceKey, suggestSiteValueType, type SiteListMarker } from './site-sync';

const marker = (over: Partial<SiteListMarker> = {}): SiteListMarker => ({
    connection_id: 7,
    resource: 'post:propiedad',
    kind: 'post_type',
    object: 'propiedad',
    object_label: 'Propiedades',
    site_name: 'Mi blog',
    site_url: 'https://blog.test',
    write_back: true,
    fields: { title: 1, status: 2, wp_id: 3, 'acf:precio': 4, 'tax:zona': 5, slug: 6 },
    can_edit: ['title', 'status', 'acf:precio', 'tax:zona', 'slug'],
    editable: ['title', 'acf:precio', 'tax:zona'],
    needs_plugin: [],
    ...over,
});
const row = (status: string) => (key: string) => (key === 'status' ? status : undefined);

describe('ADR-S83 — reglas de una lista que viene de un sitio WordPress', () => {
    it('una columna propia es libre; lo que calcula WordPress no se habilita nunca', () => {
        const m = marker();
        expect(siteCellAccess(m, 99, row('publish'))).toEqual({ access: 'own' });
        const id = siteCellAccess(m, 3, row('publish'));
        expect(id.access).toBe('locked');
        expect(id.access === 'locked' && id.reason).toContain('WordPress');
    });

    it('sólo lo habilitado se edita, y sólo con «Editar desde la app»', () => {
        expect(siteCellAccess(marker(), 1, row('publish'))).toEqual({ access: 'editable' });
        expect(siteCellAccess(marker(), 4, row('publish'))).toEqual({ access: 'editable' });
        // `slug` se PUEDE habilitar pero no lo está.
        const slug = siteCellAccess(marker(), 6, row('publish'));
        expect(slug.access === 'locked' && slug.reason).toContain('habilítala');
        const off = siteCellAccess(marker({ write_back: false }), 1, row('publish'));
        expect(off.access === 'locked' && off.reason).toContain('Editar desde la app');
    });

    it('una entrada en la papelera de WordPress no se edita desde aquí', () => {
        const t = siteCellAccess(marker(), 1, row('trash'));
        expect(t.access === 'locked' && t.reason).toContain('papelera');
        const term = siteCellAccess(marker({ kind: 'taxonomy', fields: { name: 1 }, can_edit: ['name'], editable: ['name'] }), 1, row('trash'));
        expect(term.access === 'locked' && term.reason).toContain('término');
    });

    it('valores que WordPress no aceptaría se rechazan antes de guardar', () => {
        const m = marker();
        expect(siteValueError(m, 1, '  ', row('publish'))).toContain('título');
        expect(siteValueError(m, 1, 'Casa', row('publish'))).toBeNull();
        expect(siteValueError(m, 6, 'a/b', row('publish'))).toContain('«/»');
        expect(siteValueError(m, 6, 'casa-grande', row('publish'))).toBeNull();
        expect(siteValueError(m, 2, 'future', row('publish'))).toContain('WordPress');
        expect(siteValueError(m, 2, 'draft', row('publish'))).toBeNull();
        expect(siteValueError(m, 99, '', row('publish'))).toBeNull();
    });
});

describe('ADR-S83 — listas espejo: tienda y sitio por la misma puerta', () => {
    it('lee la marca de la tienda o la del sitio y la nombra bien («del sitio», no «de el sitio»)', () => {
        const site = readMirrorListMarker({ site_sync: marker() });
        expect(site?.source).toBe('site');
        expect(mirrorSourceName(site!)).toBe('WordPress');
        expect(mirrorFromPlace(site!)).toBe('del sitio Mi blog');
        expect(mirrorSettingsPath(site!)).toBe('/settings/sites/7');
        const store = readMirrorListMarker({
            store_sync: { connection_id: 3, role: 'products', store_name: 'Demo', write_back: true, fields: { nombre: 10 } },
        });
        expect(store?.source).toBe('store');
        expect(mirrorFromPlace(store!)).toBe('de la tienda Demo');
        expect(readMirrorListMarker({})).toBeNull();
        expect(readMirrorListMarker({ site_sync: { foo: 1 } })).toBeNull();
    });

    it('las mismas funciones deciden celdas, valores y el encabezado', () => {
        const m = readMirrorListMarker({ site_sync: marker() })!;
        expect(mirrorFieldKey(m, 4)).toBe('acf:precio');
        expect(isMirrorField(m, 99)).toBe(false);
        expect(mirrorCellAccess(m, 1, row('publish'))).toEqual({ access: 'editable' });
        expect(mirrorValueError(m, 1, '', row('publish'))).toContain('título');
        expect(mirrorColumnKind(m, 1)).toBe('sync');
        expect(mirrorColumnKind(m, 3)).toBe('locked');
        expect(mirrorColumnKind(m, 6)).toBe('locked');
        expect(mirrorColumnKind(m, 99)).toBe('own');
    });
});

describe('ADR-S83 — catálogo de columnas', () => {
    it('una entrada trae título/extracto/términos editables por defecto; el slug y la fecha, no', () => {
        const cols = siteCoreColumns('post_type', {
            supports: ['title', 'excerpt', 'thumbnail', 'author'],
            hierarchical: false,
            taxonomies: [{ taxonomy: 'category', label: 'Categorías', rest_base: 'categories' }],
        });
        const by = (k: string) => cols.find((c) => c.key === k)!;
        expect(by('title')).toMatchObject({ always: true, default_edit: true, can_edit: true });
        expect(by('excerpt')).toMatchObject({ default_on: true, default_edit: true });
        expect(by('tax:category')).toMatchObject({ type: 'multi_select', default_edit: true });
        expect(by('slug')).toMatchObject({ can_edit: true, default_edit: false });
        expect(by('slug').hint).toBeTruthy();
        expect(by('date').default_edit).toBe(false);
        expect(by('link').can_edit).toBe(false);
        expect(cols.some((c) => c.key === 'parent')).toBe(false);
        // Jamás el contenido completo.
        expect(cols.some((c) => c.key === 'content')).toBe(false);
    });

    it('una página jerárquica trae su página madre y el orden', () => {
        const cols = siteCoreColumns('post_type', { supports: ['title', 'page-attributes'], hierarchical: true, taxonomies: [] });
        expect(cols.map((c) => c.key)).toEqual(expect.arrayContaining(['parent', 'menu_order', 'template']));
        const tax = siteCoreColumns('taxonomy', { supports: [], hierarchical: false, taxonomies: [] });
        expect(tax.map((c) => c.key)).toEqual(expect.arrayContaining(['name', 'slug', 'description', 'count']));
        expect(tax.some((c) => c.key === 'parent')).toBe(false);
    });

    it('claves y recursos', () => {
        expect(siteColumnKeySchema.safeParse('acf:precio_final').success).toBe(true);
        expect(siteColumnKeySchema.safeParse('tax:post_tag').success).toBe(true);
        expect(siteColumnKeySchema.safeParse('acf:precio; DROP').success).toBe(false);
        expect(siteResourceKey('taxonomy', 'category')).toBe('term:category');
        expect(parseSiteResourceKey('post:propiedad')).toEqual({ kind: 'post_type', object: 'propiedad' });
        expect(parseSiteResourceKey('otra:cosa')).toBeNull();
        expect(readSiteListMarker({ site_sync: { connection_id: 'x' } })).toBeNull();
    });

    it('sugiere el tipo de un campo de ACF por su valor', () => {
        expect(suggestSiteValueType(450000000)).toBe('number');
        expect(suggestSiteValueType(true)).toBe('checkbox');
        expect(suggestSiteValueType('https://x.test/a')).toBe('url');
        expect(suggestSiteValueType('Medellín')).toBe('text');
    });
});
