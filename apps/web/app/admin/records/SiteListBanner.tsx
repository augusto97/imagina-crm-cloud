import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight, ChevronDown, ChevronUp, ExternalLink, Globe, Lock, PencilLine } from 'lucide-react';
import type { SiteListMarker } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * Aviso de una lista que viene de un sitio WordPress (v0.1.333, ADR-S83). El
 * par de `StoreListBanner`: de dónde vienen los registros, dónde se crean y
 * se borran, qué se puede cambiar desde aquí (y que viaja al sitio) y qué
 * significan las marcas de las columnas.
 */
export function SiteListBanner({ marker, fields }: { marker: SiteListMarker; fields: FieldEntity[] | undefined }): JSX.Element {
    const [open, setOpen] = useState(false);
    const labelOf = (key: string): string => {
        const id = marker.fields[key];
        return (fields ?? []).find((f) => f.id === id)?.label ?? key;
    };
    const editable = marker.write_back ? marker.editable.filter((k) => marker.can_edit.includes(k) && marker.fields[k]).map((k) => lowerFirst(labelOf(k))) : [];
    const listing = joinList(editable);
    const createUrl = siteCreateUrl(marker);
    const where = marker.site_name || __('el sitio');
    const needsPlugin = marker.needs_plugin.filter((k) => marker.fields[k]).map((k) => labelOf(k));

    return (
        <div
            className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-[13px]"
            data-testid="site-list-banner"
            data-tour="site-list-banner"
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                    <Globe className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-[#21759B] dark:imcrm-text-[#5BA9D6]" aria-hidden />
                    <span className="imcrm-truncate">{sprintf(__('Sincronizada con WordPress · %s'), where)}</span>
                </span>
                <span className="imcrm-text-muted-foreground">
                    {editable.length > 0
                        ? sprintf(__('Puedes cambiar %s: el cambio viaja al sitio.'), listing)
                        : __('Sólo lectura: los cambios se hacen en WordPress.')}
                </span>
                <span className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        aria-expanded={open}
                        data-testid="site-list-banner-more"
                    >
                        {__('¿Qué puedo cambiar?')}
                        {open ? <ChevronUp className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />}
                    </button>
                    <Link
                        to={`/settings/sites/${marker.connection_id}`}
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                    >
                        {__('Ajustes del sitio')}
                    </Link>
                </span>
            </div>
            {open && (
                <div className="imcrm-mt-2 imcrm-grid imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-2 imcrm-text-muted-foreground sm:imcrm-grid-cols-2">
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <li>
                            {marker.kind === 'taxonomy'
                                ? __('Los términos se crean y se borran en WordPress, y llegan solos.')
                                : marker.kind === 'media'
                                  ? __('Las imágenes y archivos se suben en WordPress y llegan solos. Lo que se borra allá queda aquí en «Papelera»: nunca se pierde nada.')
                                  : __('Lo nuevo se crea en WordPress y llega solo. Lo que se borra allá queda aquí en «Papelera»: nunca se pierde nada.')}
                            {createUrl && (
                                <>
                                    {' '}
                                    <a href={createUrl} target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-primary hover:imcrm-underline">
                                        {marker.kind === 'media' ? __('Subir en WordPress') : __('Crear en WordPress')}
                                        <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                                    </a>
                                </>
                            )}
                        </li>
                        {needsPlugin.length > 0 && (
                            <li className="imcrm-text-warning" data-testid="site-list-banner-needs-plugin">
                                {sprintf(
                                    __('%s vienen del complemento para WordPress, que ya no está en el sitio: quedan con lo último que llegó y no se pueden editar hasta que vuelva a activarse.'),
                                    joinList(needsPlugin.map((l) => `«${l}»`)),
                                )}
                            </li>
                        )}
                        <li>
                            {editable.length > 0
                                ? sprintf(__('Desde aquí se puede cambiar: %s. El cambio se manda al sitio.'), listing)
                                : marker.write_back
                                  ? __('Todavía no habilitaste ninguna columna para editar desde aquí.')
                                  : __('Para cambiar datos desde aquí, activa «Editar desde la app» en la página del sitio.')}{' '}
                            <Link
                                to={`/settings/sites/${marker.connection_id}`}
                                className="imcrm-text-primary hover:imcrm-underline"
                                data-testid="site-list-banner-choose"
                            >
                                {__('Elegir qué columnas se editan')}
                            </Link>
                        </li>
                        <li>{__('Puedes sumar columnas propias (una nota, un responsable): son sólo de esta app y nunca viajan al sitio.')}</li>
                    </ul>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1" aria-label={__('Marcas de las columnas')}>
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <Lock className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> {__('Viene de WordPress: se edita allá.')}
                        </li>
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <ArrowLeftRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden /> {__('Se cambia desde aquí y viaja al sitio.')}
                        </li>
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <PencilLine className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" aria-hidden /> {__('Columna propia (sólo en esta app).')}
                        </li>
                    </ul>
                </div>
            )}
        </div>
    );
}

/** Dónde se crea algo nuevo de esta lista en el sitio (o null si no se sabe la dirección). */
export function siteCreateUrl(marker: Pick<SiteListMarker, 'site_url' | 'kind' | 'object'>): string | null {
    const site = marker.site_url.replace(/\/+$/, '');
    if (!site) return null;
    if (marker.kind === 'taxonomy') return `${site}/wp-admin/edit-tags.php?taxonomy=${encodeURIComponent(marker.object)}`;
    if (marker.kind === 'media') return `${site}/wp-admin/media-new.php`;
    if (marker.object === 'post') return `${site}/wp-admin/post-new.php`;
    return `${site}/wp-admin/post-new.php?post_type=${encodeURIComponent(marker.object)}`;
}

/** «Título SEO» → «título SEO» (siglas y marcas como «WordPress» quedan como están). */
export function lowerFirst(label: string): string {
    return label
        .split(' ')
        .map((w) => (/\p{Lu}/u.test(w.slice(1)) ? w : w.toLowerCase()))
        .join(' ');
}

/** «a», «a y b», «a, b y c». */
function joinList(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} ${__('y')} ${items[items.length - 1]}`;
}
