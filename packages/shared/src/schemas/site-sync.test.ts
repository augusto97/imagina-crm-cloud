import { describe, expect, it } from 'vitest';
import {
    isMirrorField,
    mirrorCellAccess,
    mirrorColumnKind,
    mirrorFieldKey,
    mirrorFromPlace,
    mirrorGoneFieldId,
    mirrorGoneReason,
    mirrorRecordGone,
    mirrorRowFromData,
    mirrorSettingsPath,
    mirrorSourceName,
    mirrorValueError,
    readMirrorListMarker,
} from './mirror-list';
import { siteCellAccess, siteValueError } from './site-rules';
import { isSitePluginColumn, parseSiteResourceKey, readSiteListMarker, siteColumnKeySchema, siteCoreColumns, siteResourceKey, suggestSiteValueType, type SiteListMarker } from './site-sync';
import { unzipText, zipFiles } from '../zip-files';

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
    new_columns: [],
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

describe('v0.1.336 — lo que la fuente ya borró', () => {
    it('una fila está borrada si su estado dice «trash», o si su padre lo dice (variación, línea)', () => {
        const site = readMirrorListMarker({ site_sync: marker() })!;
        expect(mirrorGoneFieldId(site)).toBe(2);
        expect(mirrorRecordGone(site, row('trash'))).toBe(true);
        expect(mirrorRecordGone(site, row('publish'))).toBe(false);
        expect(mirrorRecordGone(site, row('draft'))).toBe(false);
        const store = readMirrorListMarker({
            store_sync: { connection_id: 3, role: 'products', store_name: 'Demo', write_back: true, fields: { nombre: 10, estado: 11 } },
        })!;
        expect(mirrorGoneFieldId(store)).toBe(11);
        const fromData = mirrorRowFromData(store, { f11: 'publish' });
        expect(fromData('estado')).toBe('publish');
        expect(mirrorRecordGone(store, fromData)).toBe(false);
        expect(mirrorRecordGone(store, fromData, mirrorRowFromData(store, { f11: 'trash' }))).toBe(true);
        expect(mirrorRecordGone(store, mirrorRowFromData(store, null))).toBe(false);
    });

    it('sin columna de estado (clientes de la tienda) nada cuenta como borrado', () => {
        const customers = readMirrorListMarker({
            store_sync: { connection_id: 3, role: 'customers', store_name: 'Demo', write_back: true, fields: { nombre: 10 } },
        })!;
        expect(mirrorGoneFieldId(customers)).toBeNull();
        expect(mirrorRecordGone(customers, () => 'trash')).toBe(false);
    });

    it('el motivo dice dónde se borra y que después se puede quitar', () => {
        const site = readMirrorListMarker({ site_sync: marker() })!;
        expect(mirrorGoneReason(site)).toMatch(/^Sigue en WordPress: se borra allá/);
        expect(mirrorGoneReason(site)).toContain('quitarlo de aquí');
    });

    it('la marca del sitio trae las columnas nuevas que avisa (vacío si no hay)', () => {
        expect(readSiteListMarker({ site_sync: marker() })!.new_columns).toEqual([]);
        expect(readSiteListMarker({ site_sync: marker({ new_columns: ['Metraje'] }) })!.new_columns).toEqual(['Metraje']);
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

describe('ADR-S84 — el complemento: columnas, medios y lo que queda sin él', () => {
    const pm = (over: Partial<SiteListMarker> = {}) =>
        marker({
            fields: { title: 1, status: 2, 'seo:title': 10, 'seo:google_title': 11, 'seo:canonical': 12, 'cf:acf.asesor': 13, 'plugin:words': 14 },
            can_edit: ['title', 'status', 'seo:title', 'seo:canonical', 'cf:acf.asesor'],
            editable: ['title', 'seo:title', 'seo:canonical', 'cf:acf.asesor'],
            ...over,
        });

    it('lo que calcula el plugin de SEO y el complemento nunca se edita', () => {
        const g = siteCellAccess(pm(), 11, row('publish'));
        expect(g.access === 'locked' && g.reason).toMatch(/Google|SEO/);
        const w = siteCellAccess(pm(), 14, row('publish'));
        expect(w.access).toBe('locked');
        expect(siteCellAccess(pm(), 10, row('publish'))).toEqual({ access: 'editable' });
        expect(siteCellAccess(pm(), 13, row('publish'))).toEqual({ access: 'editable' });
    });

    it('sin el complemento: sus columnas quedan bloqueadas con el motivo; lo de WordPress, no', () => {
        const m = pm({ needs_plugin: ['seo:title', 'cf:acf.asesor', 'plugin:words'] });
        const s = siteCellAccess(m, 10, row('publish'));
        expect(s.access === 'locked' && s.reason).toContain('complemento');
        expect(siteValueError(m, 13, 'Ana', row('publish'))).toContain('complemento');
        expect(siteCellAccess(m, 1, row('publish'))).toEqual({ access: 'editable' });
        expect(mirrorColumnKind({ source: 'site', marker: m }, 10)).toBe('locked');
    });

    it('la URL canónica tiene que ser una dirección completa', () => {
        expect(siteValueError(pm(), 12, 'no es url', row('publish'))).toMatch(/dirección|https/i);
        expect(siteValueError(pm(), 12, 'https://blog.test/casa/', row('publish'))).toBeNull();
        expect(siteValueError(pm(), 12, '', row('publish'))).toBeNull();
    });

    it('la biblioteca de medios: su catálogo, su recurso y sus reglas', () => {
        expect(siteResourceKey('media', 'attachment')).toBe('media:attachment');
        expect(parseSiteResourceKey('media:attachment')).toEqual({ kind: 'media', object: 'attachment' });
        const cols = siteCoreColumns('media', { supports: [], hierarchical: false, taxonomies: [] });
        expect(cols.find((c) => c.key === 'thumbnail')).toMatchObject({ image: true, default_on: true });
        expect(cols.find((c) => c.key === 'alt_text')).toMatchObject({ can_edit: true, default_edit: true });
        expect(cols.filter((c) => c.always).map((c) => c.key)).toEqual(['title', 'status', 'wp_id', 'edit_link']);
        const m = marker({ kind: 'media', object: 'attachment', resource: 'media:attachment', fields: { title: 1, alt_text: 2, status: 3 }, can_edit: ['title', 'alt_text'], editable: ['title', 'alt_text'] });
        // Un medio puede quedar sin título (WordPress usa el nombre del archivo).
        expect(siteValueError(m, 1, '', row('publish'))).toBeNull();
        expect(siteValueError(m, 2, 'x'.repeat(501), row('publish'))).toMatch(/demasiado largo/);
        const trashed = siteCellAccess(m, 2, row('trash'));
        expect(trashed.access === 'locked' && trashed.reason).toMatch(/medio|WordPress/);
    });

    it('claves del complemento', () => {
        expect(siteColumnKeySchema.safeParse('seo:google_title').success).toBe(true);
        expect(siteColumnKeySchema.safeParse('cf:acf.precio_final').success).toBe(true);
        expect(siteColumnKeySchema.safeParse('cf:mb.mb-estrato').success).toBe(true);
        expect(isSitePluginColumn('seo:title')).toBe(true);
        expect(isSitePluginColumn('cf:je.precio')).toBe(true);
        expect(isSitePluginColumn('plugin:words')).toBe(true);
        expect(isSitePluginColumn('acf:precio')).toBe(false);
        expect(isSitePluginColumn('title')).toBe(false);
    });

    it('un zip armado en memoria: rutas seguras y el mismo contenido da los mismos bytes', () => {
        const a = zipFiles([{ path: 'plugin/a.php', data: '<?php echo 1;' }, { path: 'plugin/inc/b.php', data: new Uint8Array([1, 2]) }]);
        const b = zipFiles([{ path: 'plugin/a.php', data: '<?php echo 1;' }, { path: 'plugin/inc/b.php', data: new Uint8Array([1, 2]) }]);
        expect(Array.from(a)).toEqual(Array.from(b));
        expect(unzipText(a)['plugin/a.php']).toBe('<?php echo 1;');
        expect(() => zipFiles([{ path: '../x.php', data: '' }])).toThrow(/Ruta inválida/);
        expect(() => zipFiles([{ path: '/etc/x', data: '' }])).toThrow(/Ruta inválida/);
        expect(() => zipFiles([{ path: 'a//b', data: '' }])).toThrow(/Ruta inválida/);
    });
});
