import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertTriangle, ExternalLink, Link2, Loader2, Pencil, Plus, ShoppingBag } from 'lucide-react';
import { readMirrorListMarker, readShopListMarker } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

import { useEmbedOrigin } from '../forms/useEmbedOrigin';
import { shopPublicUrl, useCreateShop, useShops } from './useShops';

/**
 * v0.1.412 (ADR-S103) — Configuración de la lista → Tienda. La lista es el
 * catálogo: cada registro es un producto. Crear la tienda arma tres listas
 * nuevas (Pedidos, Líneas de pedido y Clientes) donde caen las compras, y el
 * editor a pantalla completa decide qué campo es el precio, la foto, el stock,
 * cómo se paga y cómo se entrega.
 */
export function ShopsPanel({ listId, listName, listSettings }: { listId: number; listName: string; listSettings: unknown }): JSX.Element {
    const shops = useShops(listId);
    const create = useCreateShop();
    const toast = useToast();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const origin = useEmbedOrigin(shops.data?.[0]?.embed_origin ?? null);

    if (readMirrorListMarker(listSettings)) {
        return (
            <Card>
                <CardContent className="imcrm-pt-5 imcrm-text-sm imcrm-text-muted-foreground" data-testid="shop-mirror">
                    {__('Esta lista la llena una tienda o un sitio web sincronizado: para vender sus productos, usa la tienda de donde vienen.')}
                </CardContent>
            </Card>
        );
    }
    if (readShopListMarker(listSettings)) {
        return (
            <Card>
                <CardContent className="imcrm-pt-5 imcrm-text-sm imcrm-text-muted-foreground" data-testid="shop-orders-list">
                    {__('En esta lista caen los pedidos de una tienda: no puede ser el catálogo de otra. Configura la tienda desde la lista de sus productos.')}
                </CardContent>
            </Card>
        );
    }

    const list = shops.data ?? [];
    const createNew = (): void => {
        const finalName = name.trim() || (list.length === 0 ? listName : `${listName} ${list.length + 1}`);
        create.mutate(
            { list_id: listId, name: finalName.slice(0, 120) },
            {
                onSuccess: (doc) => navigate(`/shops/${doc.id}`),
                onError: (err) => toast.error(__('No se pudo crear la tienda'), err instanceof Error ? err.message : String(err)),
            },
        );
    };
    const copy = (url: string): void => {
        void navigator.clipboard.writeText(url).then(
            () => toast.success(__('Enlace copiado')),
            () => toast.error(__('No se pudo copiar')),
        );
    };

    return (
        <Card>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-5" data-testid="shops-panel" data-tour="list-shop">
                {shops.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </p>
                ) : list.length === 0 ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center">
                        <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary">
                            <ShoppingBag className="imcrm-h-5 imcrm-w-5" />
                        </span>
                        <div className="imcrm-space-y-1">
                            <p className="imcrm-text-sm imcrm-font-medium">{__('Vende los productos de esta lista')}</p>
                            <p className="imcrm-mx-auto imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Cada registro es un producto. Tus clientes eligen, arman su carrito y te hacen el pedido: llega como un registro en una lista de Pedidos, con sus productos y el cliente, y el stock se descuenta solo.')}
                            </p>
                        </div>
                        <div className="imcrm-flex imcrm-w-full imcrm-max-w-sm imcrm-flex-col imcrm-gap-2 sm:imcrm-flex-row">
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={listName}
                                aria-label={__('Nombre de la tienda')}
                                maxLength={120}
                                data-testid="shop-new-name"
                            />
                            <Button onClick={createNew} disabled={create.isPending} className="imcrm-gap-1.5" data-testid="shop-new">
                                {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {__('Crear la tienda')}
                            </Button>
                        </div>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se crean las listas de Pedidos, Líneas de pedido y Clientes, y un tablero de ventas.')}</p>
                    </div>
                ) : (
                    <>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                            {list.map((s) => {
                                const url = shopPublicUrl(s, origin);
                                return (
                                    <li key={s.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-shop={s.id}>
                                        <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                                            <ShoppingBag className="imcrm-h-4 imcrm-w-4" />
                                        </span>
                                        <div className="imcrm-min-w-0 imcrm-flex-1">
                                            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                                <span className="imcrm-truncate">{s.name}</span>
                                                <span
                                                    className={
                                                        s.suspended
                                                            ? 'imcrm-shrink-0 imcrm-rounded imcrm-bg-destructive/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-destructive'
                                                            : s.enabled
                                                              ? 'imcrm-shrink-0 imcrm-rounded imcrm-bg-success/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-success'
                                                              : 'imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground'
                                                    }
                                                    data-shop-status
                                                >
                                                    {s.suspended ? __('Suspendida') : s.enabled ? __('Publicada') : __('Sin publicar')}
                                                </span>
                                                {s.problems.length > 0 && !s.enabled && (
                                                    <span title={s.problems.map((p) => p.text).join(' ')} className="imcrm-text-warning">
                                                        <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5" aria-label={__('Le falta algo para publicarla')} />
                                                    </span>
                                                )}
                                            </p>
                                            <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                                {s.orders_count} {s.orders_count === 1 ? __('pedido') : __('pedidos')}
                                                {s.orders && (
                                                    <>
                                                        {' · '}
                                                        <Link className="imcrm-underline-offset-2 hover:imcrm-underline" to={`/lists/${s.orders.list_slug}/records`}>
                                                            {__('Ver los pedidos')}
                                                        </Link>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" asChild>
                                                <Link to={`/shops/${s.id}`} data-shop-edit>
                                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Editar')}
                                                </Link>
                                            </Button>
                                            {s.enabled && (
                                                <>
                                                    <Button variant="ghost" size="icon" aria-label={__('Copiar enlace')} title={__('Copiar enlace')} onClick={() => copy(url)}>
                                                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" aria-label={__('Abrir la tienda')} title={__('Abrir la tienda')} asChild>
                                                        <a href={url} target="_blank" rel="noreferrer">
                                                            <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                                        </a>
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        <div>
                            <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={createNew} disabled={create.isPending} data-testid="shop-new-another">
                                {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {__('Otra tienda con estos productos')}
                            </Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
