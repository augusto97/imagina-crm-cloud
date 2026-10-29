import { afterEach, describe, expect, it } from 'vitest';
import { classifyWpResponse, parseWpIndex, parseWpUser, wpAuthorizeUrl, wpRestUrl, wpSiteUrl } from '../src/connectors/wordpress/wp-api';
import type { SiteObjectSettings } from '../src/site-sync/site-sync.types';
import { buildWpWriteBack, coerceSiteValue, discoverExtraColumns, emptyLookups, mapWpItem, wpFieldsParam } from '../src/site-sync/wordpress/wp-map';

/**
 * v0.1.333 (ADR-S83) — las piezas PURAS del conector WordPress: cómo se arma
 * la dirección del sitio, qué dice cada error, qué se pide (nunca el
 * contenido) y qué viaja al editar (sólo lo que cambió).
 */

const propiedades: SiteObjectSettings = {
    kind: 'post_type',
    object: 'propiedad',
    label: 'Propiedades',
    rest_base: 'propiedades',
    rest_namespace: 'wp/v2',
    hierarchical: false,
    columns: [
        { key: 'title', label: 'Título', source: 'core', type: 'text', can_edit: true },
        { key: 'status', label: 'Estado', source: 'core', type: 'select', can_edit: true },
        { key: 'wp_id', label: 'ID', source: 'core', type: 'number', can_edit: false },
        { key: 'edit_link', label: 'Editar', source: 'core', type: 'url', can_edit: false },
        { key: 'link', label: 'Enlace', source: 'core', type: 'url', can_edit: false },
        { key: 'date', label: 'Fecha', source: 'core', type: 'datetime', can_edit: true },
        { key: 'excerpt', label: 'Extracto', source: 'core', type: 'long_text', can_edit: true },
        { key: 'featured_image', label: 'Imagen', source: 'core', type: 'url', can_edit: false },
        { key: 'tax:zona', label: 'Zonas', source: 'core', type: 'multi_select', can_edit: true },
        { key: 'acf:precio', label: 'Precio', source: 'acf', type: 'number', can_edit: true },
        { key: 'acf:destacada', label: 'Destacada', source: 'acf', type: 'checkbox', can_edit: true },
        { key: 'meta:referencia', label: 'Referencia', source: 'meta', type: 'text', can_edit: true },
    ],
    editable: ['title', 'excerpt', 'tax:zona', 'acf:precio'],
    taxonomies: [{ taxonomy: 'zona', label: 'Zonas', rest_base: 'zonas', rest_namespace: 'wp/v2' }],
};

describe('WordPress — dirección del sitio y API', () => {
    const prev = process.env.DEV_ALLOW_PRIVATE_EGRESS;
    afterEach(() => {
        if (prev === undefined) delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        else process.env.DEV_ALLOW_PRIVATE_EGRESS = prev;
    });

    it('normaliza lo que escribe la persona y exige HTTPS', () => {
        delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        expect(wpSiteUrl('mi-blog.com')).toBe('https://mi-blog.com');
        expect(wpSiteUrl('https://mi-blog.com/blog/wp-admin/')).toBe('https://mi-blog.com/blog');
        expect(wpSiteUrl('https://mi-blog.com/wp-json/wp/v2')).toBe('https://mi-blog.com');
        expect(() => wpSiteUrl('http://mi-blog.com')).toThrow(/HTTPS/);
        expect(() => wpSiteUrl('')).toThrow(/Falta/);
    });

    it('arma la URL con enlaces permanentes o con ?rest_route=', () => {
        expect(wpRestUrl('https://a.test', 'pretty', '/wp/v2/posts', [['_fields', 'id,title']])).toBe('https://a.test/wp-json/wp/v2/posts?_fields=id%2Ctitle');
        expect(wpRestUrl('https://a.test', 'plain', '/wp/v2/posts', [['page', '2']])).toBe('https://a.test/?rest_route=/wp/v2/posts&page=2');
    });

    it('lee el índice: nombre, si hay contraseñas de aplicación, y sólo una pantalla de autorización http(s)', () => {
        const ok = parseWpIndex(
            JSON.stringify({ name: 'Mi &amp; blog', namespaces: ['wp/v2'], authentication: { 'application-passwords': { endpoints: { authorization: 'https://a.test/wp-admin/authorize-application.php' } } } }),
        );
        expect(ok).toMatchObject({ name: 'Mi & blog', authorizeUrl: 'https://a.test/wp-admin/authorize-application.php' });
        const off = parseWpIndex(JSON.stringify({ name: 'x', namespaces: ['wp/v2'], authentication: [] }));
        expect(off?.authorizeUrl).toBeNull();
        const evil = parseWpIndex(JSON.stringify({ namespaces: [], authentication: { 'application-passwords': { endpoints: { authorization: 'javascript:alert(1)' } } } }));
        expect(evil?.authorizeUrl).toBeNull();
        expect(parseWpIndex('<html>')).toBeNull();
    });

    it('la pantalla «Autorizar aplicación» lleva el nombre, el id fijo y la vuelta', () => {
        const url = new URL(wpAuthorizeUrl('https://a.test/wp-admin/authorize-application.php', { appName: 'Imagina · Acme', appId: 'uuid', successUrl: 'https://app.test/cb?state=s', rejectUrl: 'https://app.test/cb?state=s&success=false' }));
        expect(url.searchParams.get('app_name')).toBe('Imagina · Acme');
        expect(url.searchParams.get('app_id')).toBe('uuid');
        expect(url.searchParams.get('success_url')).toBe('https://app.test/cb?state=s');
        expect(url.searchParams.get('reject_url')).toContain('success=false');
    });

    it('cada error en lenguaje claro: contraseña, cabecera borrada, permiso, plugin de seguridad', () => {
        expect(classifyWpResponse(401, JSON.stringify({ code: 'incorrect_password', message: 'x' }))?.kind).toBe('auth');
        const strip = classifyWpResponse(401, JSON.stringify({ code: 'rest_not_logged_in', message: 'No estás conectado' }));
        expect(strip?.kind).toBe('not_seen');
        expect(strip?.message).toContain('Authorization');
        expect(classifyWpResponse(403, JSON.stringify({ code: 'rest_cannot_edit', message: 'No puedes' }))?.kind).toBe('forbidden');
        expect(classifyWpResponse(403, '<html>Wordfence</html>')?.kind).toBe('blocked');
        expect(classifyWpResponse(200, '<html>mantenimiento</html>')?.kind).toBe('blocked');
        expect(classifyWpResponse(404, JSON.stringify({ code: 'rest_post_invalid_id' }))?.kind).toBe('gone');
        expect(classifyWpResponse(503, '')?.kind).toBe('server');
        expect(classifyWpResponse(200, '[]')).toBeNull();
    });

    it('un suscriptor no puede editar; un editor sí', () => {
        expect(parseWpUser(JSON.stringify({ id: 2, slug: 'lector', roles: ['subscriber'], capabilities: { read: true } }))?.canEdit).toBe(false);
        expect(parseWpUser(JSON.stringify({ id: 1, username: 'ana', roles: ['editor'], capabilities: { edit_posts: true, manage_categories: true } }))).toMatchObject({ login: 'ana', canEdit: true, canManageTerms: true });
    });
});

describe('WordPress — qué se trae y qué viaja', () => {
    it('pide sólo las columnas elegidas — jamás el contenido completo', () => {
        const fields = wpFieldsParam(propiedades).split(',');
        expect(fields).toEqual(expect.arrayContaining(['id', 'modified', 'status', 'title', 'excerpt', 'zonas', 'acf.precio', 'meta.referencia', 'featured_media', 'date_gmt']));
        expect(fields).not.toContain('content');
        expect(fields).not.toContain('acf');
    });

    it('mapea una entrada: términos por slug con su etiqueta, ACF con su tipo, fecha con zona', () => {
        const lookups = emptyLookups();
        lookups.terms.set('zona', new Map([[6, { slug: 'norte', name: 'Norte' }]]));
        lookups.media.set(30, 'https://a.test/foto-150x150.jpg');
        const m = mapWpItem(
            propiedades,
            {
                id: 12,
                status: 'publish',
                date_gmt: '2026-10-01T10:00:00',
                modified: '2026-10-02T10:00:00',
                title: { raw: 'Casa & jardín', rendered: 'Casa &#038; jardín' },
                excerpt: { raw: 'Linda', rendered: '<p>Linda</p>' },
                link: 'https://a.test/propiedad/casa/',
                featured_media: 30,
                zonas: [6],
                acf: { precio: '450000000', destacada: true },
                meta: { referencia: 'REF-1' },
            },
            'https://a.test',
            lookups,
        );
        expect(m.externalId).toBe('12');
        expect(m.values).toMatchObject({
            title: 'Casa & jardín',
            status: 'publish',
            wp_id: 12,
            edit_link: 'https://a.test/wp-admin/post.php?post=12&action=edit',
            date: '2026-10-01T10:00:00Z',
            excerpt: 'Linda',
            featured_image: 'https://a.test/foto-150x150.jpg',
            'tax:zona': ['norte'],
            'acf:precio': 450000000,
            'acf:destacada': true,
            'meta:referencia': 'REF-1',
        });
        expect(m.options['tax:zona']).toEqual([{ value: 'norte', label: 'Norte' }]);
        expect(coerceSiteValue('abc', 'number')).toBeUndefined();
        expect(coerceSiteValue('', 'checkbox')).toBe(false);
    });

    it('al editar viaja SÓLO lo que cambió y está habilitado (términos como ids)', () => {
        const req = buildWpWriteBack(propiedades, '12', { title: 'Casa grande', 'acf:precio': 470000000, 'tax:zona': ['norte', 'oeste'], 'acf:destacada': false }, { 'tax:zona': [6, 9] });
        expect(req).toEqual({
            route: '/wp/v2/propiedades/12',
            body: { title: 'Casa grande', acf: { precio: 470000000 }, zonas: [6, 9] },
            keys: ['title', 'acf:precio', 'tax:zona'],
        });
        // `acf:destacada` no está habilitada: no viaja.
        expect(buildWpWriteBack(propiedades, '12', { 'acf:destacada': true }, {})).toBeNull();
    });

    it('descubre campos de ACF y personalizados con ejemplo; lo interno queda afuera', () => {
        const cols = discoverExtraColumns([
            { id: 1, acf: { precio: 100, galeria: [1, 2] }, meta: { referencia: '', footnotes: '[]', _acf_changed: true, _interno: 'x' } },
            { id: 2, acf: { precio: 200 }, meta: { referencia: 'REF-2' } },
        ]);
        const by = (k: string) => cols.find((c) => c.key === k);
        expect(by('acf:precio')).toMatchObject({ type: 'number', can_edit: true, sample: '100' });
        expect(by('acf:galeria')).toMatchObject({ type: 'long_text', can_edit: false });
        expect(by('meta:referencia')?.sample).toBe('REF-2');
        expect(by('meta:footnotes')).toBeUndefined();
        expect(by('meta:_acf_changed')).toBeUndefined();
        expect(by('meta:_interno')?.private).toBe(true);
    });
});
