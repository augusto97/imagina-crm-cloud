import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight, ChevronDown, ChevronUp, ExternalLink, Lock, PencilLine, Store } from 'lucide-react';
import { STORE_EDITABLE_CATALOG, storeEditableSlugs, type StoreListMarker } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';

/**
 * Aviso de una lista sincronizada con WooCommerce (v0.1.213): qué es esta
 * lista, dónde se crean y borran sus registros, qué se puede cambiar desde
 * acá (y que viaja a la tienda) y qué significan las marcas de las columnas.
 * La duda que resuelve es la que planteó el usuario: «¿si cambio esto, lo
 * manda a WooCommerce? ¿la tienda lo acepta?».
 */
export function StoreListBanner({ marker }: { marker: StoreListMarker }): JSX.Element {
    const [open, setOpen] = useState(false);
    const where = marker.store_name || __('la tienda');
    // v0.1.214 — lo que la empresa habilitó en esta lista (o lo de por defecto).
    const chosen = storeEditableSlugs(marker);
    const editable = STORE_EDITABLE_CATALOG[marker.role].filter((c) => chosen.includes(c.slug)).map((c) => __(c.label).toLowerCase());
    const metaCount = chosen.filter((s) => s.startsWith('meta:') && marker.meta_fields.includes(Number(s.slice(5)))).length;
    if (metaCount > 0) editable.push(metaCount === 1 ? __('un campo de otro plugin') : sprintf(__('%d campos de otros plugins'), metaCount));
    const canChoose = STORE_EDITABLE_CATALOG[marker.role].length > 0 || marker.meta_fields.length > 0;
    const listing = joinList(editable);
    const children =
        marker.role === 'products'
            ? __('Las variaciones (talla, color…) están dentro de cada producto: desplegalo con la flechita.')
            : marker.role === 'orders'
              ? __('Lo que se compró en cada pedido está dentro del pedido: desplegalo con la flechita.')
              : null;
    const storeUrl = marker.store_url.replace(/\/+$/, '');
    const createUrl =
        storeUrl && marker.role === 'products'
            ? `${storeUrl}/wp-admin/post-new.php?post_type=product`
            : storeUrl && marker.role === 'orders'
              ? `${storeUrl}/wp-admin/admin.php?page=wc-orders&action=new`
              : null;

    return (
        <div
            className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-[13px]"
            data-testid="store-list-banner"
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                    <Store className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-[#7F54B3]" aria-hidden />
                    <span className="imcrm-truncate">{sprintf(__('Sincronizada con WooCommerce · %s'), where)}</span>
                </span>
                <span className="imcrm-text-muted-foreground">
                    {marker.write_back && editable.length > 0
                        ? sprintf(__('Podés cambiar %s: el cambio viaja a la tienda.'), listing)
                        : canChoose
                          ? __('Sólo lectura: los cambios se hacen en WooCommerce.')
                          : __('Los datos se editan en WooCommerce.')}
                </span>
                <span className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        aria-expanded={open}
                        data-testid="store-list-banner-more"
                    >
                        {__('¿Qué puedo cambiar?')}
                        {open ? <ChevronUp className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />}
                    </button>
                    <Link
                        to={`/settings/stores/${marker.connection_id}`}
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                    >
                        {__('Ajustes de la tienda')}
                    </Link>
                </span>
            </div>
            {open && (
                <div className="imcrm-mt-2 imcrm-grid imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-2 imcrm-text-muted-foreground sm:imcrm-grid-cols-2">
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <li>
                            {__('Los registros se crean y se borran en WooCommerce, y llegan solos.')}
                            {createUrl && (
                                <>
                                    {' '}
                                    <a href={createUrl} target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-primary hover:imcrm-underline">
                                        {__('Crear en WooCommerce')}
                                        <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                                    </a>
                                </>
                            )}
                        </li>
                        {children && <li>{children}</li>}
                        {canChoose && (
                            <li>
                                {marker.write_back && editable.length > 0
                                    ? sprintf(__('Desde acá se puede cambiar: %s. El cambio se manda a la tienda.'), listing)
                                    : marker.write_back
                                      ? __('Todavía no habilitaste ninguna columna para editar desde acá.')
                                      : __('Para cambiar datos desde acá, activá «Editar desde la app» en los ajustes de la tienda.')}{' '}
                                <Link
                                    to={`/settings/stores/${marker.connection_id}?seccion=editar`}
                                    className="imcrm-text-primary hover:imcrm-underline"
                                    data-testid="store-list-banner-choose"
                                >
                                    {__('Elegir qué columnas se editan')}
                                </Link>
                            </li>
                        )}
                        <li>{__('Podés sumar columnas propias (una nota, un responsable): son sólo de Imagina y nunca viajan a la tienda.')}</li>
                    </ul>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1" aria-label={__('Marcas de las columnas')}>
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <Lock className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> {__('Viene de WooCommerce: se edita allá.')}
                        </li>
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <ArrowLeftRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden /> {__('Se cambia desde acá y viaja a la tienda.')}
                        </li>
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <PencilLine className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" aria-hidden /> {__('Columna sólo de Imagina.')}
                        </li>
                    </ul>
                </div>
            )}
        </div>
    );
}

/** «a», «a y b», «a, b y c». */
function joinList(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} ${__('y')} ${items[items.length - 1]}`;
}
