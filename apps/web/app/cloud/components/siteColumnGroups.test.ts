import { describe, expect, it } from 'vitest';
import type { SiteColumn } from '@imagina-base/shared';

import { lowerFirst, siteCreateUrl } from '@/admin/records/SiteListBanner';
import { siteKitBlocked, siteKitFor } from './SiteKits';
import { siteColumnGroups, siteColumnOrigin } from './siteColumnGroups';

const col = (key: string, source: SiteColumn['source'], provider: string | null = null, extra: Partial<SiteColumn> = {}): SiteColumn => ({
    key,
    label: key,
    source,
    type: 'text',
    can_edit: false,
    default_on: false,
    default_edit: false,
    always: false,
    hint: null,
    sample: null,
    private: false,
    options: null,
    image: false,
    provider,
    ...extra,
});

describe('v0.1.334 — columnas del sitio con el complemento', () => {
    it('agrupa por origen: WordPress, SEO, cada plugin de campos y lo del complemento', () => {
        const g = siteColumnGroups([
            col('title', 'core'),
            col('seo:title', 'seo', 'seo'),
            col('acf:precio', 'acf'),
            col('cf:acf.asesor', 'plugin', 'acf'),
            col('cf:mb.estrato', 'plugin', 'metabox'),
            col('cf:je.precio', 'plugin', 'jetengine'),
            col('meta:ref', 'meta'),
            col('cf:meta.otro', 'plugin', 'meta'),
            col('plugin:words', 'plugin', 'plugin'),
            col('meta:_interno', 'meta', null, { private: true }),
        ]);
        expect(g.core.map((c) => c.key)).toEqual(['title']);
        expect(g.seo.map((c) => c.key)).toEqual(['seo:title']);
        expect(g.acf.map((c) => c.key)).toEqual(['acf:precio', 'cf:acf.asesor']);
        expect(g.metabox.map((c) => c.key)).toEqual(['cf:mb.estrato']);
        expect(g.jetengine.map((c) => c.key)).toEqual(['cf:je.precio']);
        expect(g.meta.map((c) => c.key)).toEqual(['meta:ref', 'cf:meta.otro']);
        expect(g.plugin.map((c) => c.key)).toEqual(['plugin:words']);
        expect(g.internal.map((c) => c.key)).toEqual(['meta:_interno']);
        expect(siteColumnOrigin(col('cf:mb.estrato', 'plugin', 'metabox'))).toBe('Meta Box');
        expect(siteColumnOrigin(col('title', 'core'))).toBe('');
        expect(siteColumnOrigin(col('plugin:words', 'plugin', 'plugin'))).toBe('complemento');
    });

    it('el kit de cada lista y cuándo no se puede armar', () => {
        expect(siteKitFor({ kind: 'media' })).toBe('alt_text');
        expect(siteKitFor({ kind: 'post_type' })).toBe('seo_audit');
        expect(siteKitBlocked('alt_text', { plugin: null })).toBeNull();
        expect(siteKitBlocked('seo_audit', { plugin: null })).toMatch(/complemento/);
        expect(siteKitBlocked('seo_audit', { plugin: { installed: true, version: '1.0.0', seo_name: null, checked_at: null, missing_since: null } })).toMatch(/plugin de SEO/);
        expect(siteKitBlocked('seo_audit', { plugin: { installed: true, version: '1.0.0', seo_name: 'Yoast SEO', checked_at: null, missing_since: null } })).toBeNull();
    });

    it('el aviso de la lista: dónde se crea cada cosa y las etiquetas en minúscula sin romper siglas', () => {
        expect(siteCreateUrl({ site_url: 'https://blog.test/', kind: 'media', object: 'attachment' })).toBe('https://blog.test/wp-admin/media-new.php');
        expect(siteCreateUrl({ site_url: 'https://blog.test', kind: 'taxonomy', object: 'category' })).toBe('https://blog.test/wp-admin/edit-tags.php?taxonomy=category');
        expect(siteCreateUrl({ site_url: 'https://blog.test', kind: 'post_type', object: 'post' })).toBe('https://blog.test/wp-admin/post-new.php');
        expect(siteCreateUrl({ site_url: '', kind: 'post_type', object: 'post' })).toBeNull();
        expect(lowerFirst('Título SEO')).toBe('título SEO');
        expect(lowerFirst('ID en WordPress')).toBe('ID en WordPress');
        expect(lowerFirst('Texto alternativo')).toBe('texto alternativo');
    });
});
