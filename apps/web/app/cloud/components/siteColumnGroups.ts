import type { SiteColumn } from '@imagina-base/shared';

/**
 * Los grupos del selector de columnas de un sitio WordPress (v0.1.334,
 * ADR-S84): lo de WordPress, el SEO, los campos de cada plugin (los de ACF
 * lleguen por la API o por el complemento van juntos), lo que calcula el
 * complemento y, plegado, lo interno de los plugins.
 */
export interface SiteColumnGroups {
    core: SiteColumn[];
    seo: SiteColumn[];
    acf: SiteColumn[];
    metabox: SiteColumn[];
    jetengine: SiteColumn[];
    meta: SiteColumn[];
    plugin: SiteColumn[];
    internal: SiteColumn[];
}

const FIELD_PROVIDERS = new Set(['acf', 'metabox', 'jetengine', 'meta']);

export function siteColumnGroups(columns: SiteColumn[]): SiteColumnGroups {
    const pub = columns.filter((c) => !c.private);
    const fromPlugin = (provider: string) => (c: SiteColumn) => c.source === 'plugin' && c.provider === provider;
    return {
        core: pub.filter((c) => c.source === 'core'),
        seo: pub.filter((c) => c.source === 'seo'),
        acf: pub.filter((c) => c.source === 'acf' || fromPlugin('acf')(c)),
        metabox: pub.filter(fromPlugin('metabox')),
        jetengine: pub.filter(fromPlugin('jetengine')),
        meta: pub.filter((c) => c.source === 'meta' || fromPlugin('meta')(c)),
        plugin: pub.filter((c) => c.source === 'plugin' && !FIELD_PROVIDERS.has(c.provider ?? '')),
        internal: columns.filter((c) => c.private),
    };
}

/** Para el menú «Traer otra columna»: de dónde sale (vacío = de WordPress). */
export function siteColumnOrigin(c: Pick<SiteColumn, 'source' | 'provider'>): string {
    if (c.source === 'seo') return 'SEO';
    if (c.source === 'acf') return 'ACF';
    if (c.source === 'meta') return 'personalizado';
    if (c.source === 'plugin') {
        if (c.provider === 'acf') return 'ACF';
        if (c.provider === 'metabox') return 'Meta Box';
        if (c.provider === 'jetengine') return 'JetEngine';
        if (c.provider === 'meta') return 'personalizado';
        return 'complemento';
    }
    return '';
}
