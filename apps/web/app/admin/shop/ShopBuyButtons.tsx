import { useState } from 'react';
import { AppWindow, CheckIcon, ChevronDown, Copy, Link2, Loader2, Maximize2, PanelRight, Search, ShoppingBag, X } from 'lucide-react';
import type { ShopVariantProductDto } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { CodeBlock, Segmented } from '@/admin/forms/EmbedCodePicker';
import { embedCode, safeHex, shopCartLinkUrl, shopProductUrl, withEmbedOrigin, type EmbedOpen } from '@/admin/forms/embedCode';
import { useShopProductVariants, useShopProducts } from './useShops';

/** v0.1.421 — Qué hace el botón (o el enlace): abrir el producto, o agregarlo y llevar al pago o al carrito. */
type BuyAction = 'open' | 'buy' | 'add';
const ACTIONS: Array<{ id: BuyAction; label: string }> = [
    { id: 'open', label: 'Abre la tienda en el producto' },
    { id: 'buy', label: 'Lo agrega y lleva directo al pago' },
    { id: 'add', label: 'Lo agrega y abre el carrito' },
];

const OPENS: Array<{ id: EmbedOpen; label: string; icon: typeof AppWindow }> = [
    { id: 'window', label: 'Ventana', icon: AppWindow },
    { id: 'side', label: 'Panel', icon: PanelRight },
    { id: 'full', label: 'Completa', icon: Maximize2 },
];

/**
 * v0.1.419 (ADR-S103) — Un botón «Comprar» por producto para el sitio de la
 * empresa: abre la tienda YA en ese producto (`?producto=<id>`), en una
 * ventana, un panel o a pantalla completa, listo para agregarlo al carrito.
 * También da el enlace directo al producto (para WhatsApp o redes).
 */
export function ShopBuyButtons({
    shopId,
    url,
    origin,
    embedOrigin,
    accent,
    variantAttributes = [],
}: {
    shopId: number;
    /** La dirección pública de la tienda (absoluta). */
    url: string;
    /** El origen de la app (de donde sale el script). */
    origin: string;
    /** La dirección rápida (por Cloudflare), si la plataforma tiene una. */
    embedOrigin?: string | null;
    accent: string;
    /** Los atributos de las variantes (para elegir cuál agrega el enlace). */
    variantAttributes?: number[];
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [product, setProduct] = useState<ShopVariantProductDto | null>(null);
    const [label, setLabel] = useState('Comprar');
    const [color, setColor] = useState(safeHex(accent));
    const [how, setHow] = useState<EmbedOpen>('window');
    const [side, setSide] = useState<'right' | 'left'>('right');
    const [copied, setCopied] = useState<'code' | 'link' | null>(null);
    const [action, setAction] = useState<BuyAction>('open');
    const [qty, setQty] = useState(1);
    const [variantId, setVariantId] = useState<number | null>(null);
    const products = useShopProducts(shopId, q.trim(), open && product === null);
    const needsVariant = !!product && product.variants > 0 && action !== 'open';
    const variants = useShopProductVariants(shopId, needsVariant ? product!.id : null, variantAttributes);

    const copy = (text: string, which: 'code' | 'link'): void => {
        void navigator.clipboard.writeText(text).then(() => {
            setCopied(which);
            window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
        });
    };

    const itemId = product ? (product.variants > 0 ? variantId : product.id) : null;
    const productUrl = !product
        ? ''
        : action === 'open' || itemId === null
          ? shopProductUrl(url, product.id)
          : shopCartLinkUrl(url, [{ id: itemId, qty }], action === 'buy' ? 'buy' : 'add');
    const linkLabel = action === 'open' || itemId === null ? __('Enlace directo al producto') : action === 'buy' ? __('Enlace que lo agrega y lleva al pago') : __('Enlace que lo agrega al carrito');
    const code = product
        ? embedCode(withEmbedOrigin({ url: productUrl, origin, title: product.title, kind: 'shop' }, embedOrigin), 'popup', { label: label.trim() || 'Comprar', color, position: side, open: how })
        : '';

    return (
        <div className="imcrm-rounded-xl imcrm-border imcrm-border-border" data-testid="shop-buy" data-tour="shop-buy-buttons">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-px-3 imcrm-py-2.5 imcrm-text-left hover:imcrm-bg-muted/50"
                data-testid="shop-buy-toggle"
            >
                <ShoppingBag className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                <span className="imcrm-min-w-0 imcrm-flex-1">
                    <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{__('Botón «Comprar» de un producto')}</span>
                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Al lado de cada producto de tu sitio: abre la tienda en ese producto, o lo agrega y lleva al pago.')}</span>
                </span>
                <ChevronDown className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform', open && 'imcrm-rotate-180')} />
            </button>
            {open && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-3">
                    {product === null ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <div className="imcrm-relative">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" />
                                <Input
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder={__('Busca el producto')}
                                    aria-label={__('Busca el producto')}
                                    className="imcrm-h-9 imcrm-pl-8"
                                    data-testid="shop-buy-search"
                                />
                            </div>
                            <div className="imcrm-flex imcrm-max-h-56 imcrm-flex-col imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border" role="listbox" aria-label={__('Productos')} data-testid="shop-buy-products">
                                {products.isLoading ? (
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                                        <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                        {__('Cargando…')}
                                    </p>
                                ) : (products.data ?? []).length === 0 ? (
                                    <p className="imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">{q.trim() ? __('Ningún producto coincide.') : __('La tienda todavía no tiene productos.')}</p>
                                ) : (
                                    (products.data ?? []).map((p) => (
                                        <button
                                            key={p.id}
                                            type="button"
                                            role="option"
                                            aria-selected={false}
                                            onClick={() => setProduct(p)}
                                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-sm last:imcrm-border-b-0 hover:imcrm-bg-muted/60"
                                            data-testid={`shop-buy-product-${p.id}`}
                                        >
                                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{p.title || __('Sin nombre')}</span>
                                            <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                                                {p.variants > 0 ? __('con opciones') : p.price !== null ? `$ ${formatNumber(p.price)}` : ''}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2" data-testid="shop-buy-picked">
                                <ShoppingBag className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-medium">{product.title || __('Sin nombre')}</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-xs"
                                    onClick={() => {
                                        setProduct(null);
                                        setVariantId(null);
                                    }}
                                    data-testid="shop-buy-change"
                                >
                                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Cambiar')}
                                </Button>
                            </div>

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <label className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground" htmlFor="shop-buy-action">
                                    {__('Al hacer clic')}
                                </label>
                                <Select id="shop-buy-action" value={action} onChange={(e) => setAction(e.target.value as BuyAction)} className="imcrm-h-9" data-testid="shop-buy-action">
                                    {ACTIONS.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {__(a.label)}
                                        </option>
                                    ))}
                                </Select>
                                {action !== 'open' && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-2">
                                        {product.variants > 0 && (
                                            <label className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                                                <span className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Opción')}</span>
                                                <Select
                                                    value={variantId === null ? '' : String(variantId)}
                                                    onChange={(e) => setVariantId(e.target.value === '' ? null : Number(e.target.value))}
                                                    className="imcrm-h-9"
                                                    data-testid="shop-buy-variant"
                                                >
                                                    <option value="">{variants.isLoading ? __('Cargando…') : __('Elige una opción')}</option>
                                                    {(variants.data?.variants ?? []).map((v) => (
                                                        <option key={v.id} value={v.id}>
                                                            {v.label}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </label>
                                        )}
                                        <label className="imcrm-flex imcrm-w-24 imcrm-flex-col imcrm-gap-1">
                                            <span className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Cantidad')}</span>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={99}
                                                value={qty}
                                                onChange={(e) => setQty(Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1))))}
                                                className="imcrm-h-9"
                                                data-testid="shop-buy-qty"
                                            />
                                        </label>
                                    </div>
                                )}
                                {needsVariant && variantId === null && (
                                    <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground" data-testid="shop-buy-variant-hint">
                                        {__('Este producto tiene opciones: elige cuál se agrega. Si no, el enlace abre el producto para que la persona la elija.')}
                                    </p>
                                )}
                            </div>

                            <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                                <label className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                                    <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Texto del botón')}</span>
                                    <Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="imcrm-h-9" data-testid="shop-buy-label" />
                                </label>
                                <label
                                    className="imcrm-relative imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-lg imcrm-shadow-sm imcrm-ring-1 imcrm-ring-inset imcrm-ring-black/10"
                                    style={{ background: safeHex(color) }}
                                    title={__('Color del botón')}
                                >
                                    <input
                                        type="color"
                                        value={safeHex(color)}
                                        onChange={(e) => setColor(e.target.value)}
                                        className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-cursor-pointer imcrm-opacity-0"
                                        aria-label={__('Color del botón')}
                                    />
                                </label>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Se abre como')}</span>
                                <Segmented
                                    ariaLabel={__('Cómo se abre')}
                                    value={how}
                                    onChange={setHow}
                                    options={OPENS.map((o) => ({ id: o.id, label: __(o.label), icon: o.icon, testId: `shop-buy-open-${o.id}` }))}
                                />
                                {how === 'side' && (
                                    <Segmented
                                        ariaLabel={__('Lado del panel')}
                                        value={side}
                                        onChange={setSide}
                                        options={[
                                            { id: 'left', label: __('Izquierda') },
                                            { id: 'right', label: __('Derecha') },
                                        ]}
                                    />
                                )}
                            </div>

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('El código del botón')}</span>
                                    <Button size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => copy(code, 'code')} data-testid="shop-buy-copy">
                                        {copied === 'code' ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                                        {copied === 'code' ? __('Copiado') : __('Copiar código')}
                                    </Button>
                                </div>
                                <CodeBlock code={code} testId="shop-buy-code" />
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Pégalo junto a la foto o el precio del producto en tu sitio. Si pones varios botones en la misma página, el script basta una vez.')}
                                </p>
                            </div>

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{linkLabel}</span>
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-py-1 imcrm-pl-2.5 imcrm-pr-1">
                                    <Link2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    <input
                                        readOnly
                                        value={productUrl}
                                        onFocus={(e) => e.currentTarget.select()}
                                        aria-label={linkLabel}
                                        className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-bg-transparent imcrm-text-xs imcrm-outline-none"
                                        data-testid="shop-buy-link"
                                    />
                                    <Button variant="outline" size="sm" className="imcrm-h-7 imcrm-shrink-0 imcrm-gap-1 imcrm-text-xs" onClick={() => copy(productUrl, 'link')} data-testid="shop-buy-link-copy">
                                        {copied === 'link' ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                                        {copied === 'link' ? __('Copiado') : __('Copiar')}
                                    </Button>
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {action === 'open' || itemId === null
                                        ? __('Para WhatsApp o tus redes: abre la tienda en ese producto.')
                                        : action === 'buy'
                                          ? __('Para un anuncio, un correo o una landing: quien lo abre ya tiene el producto en el carrito y está en el pago.')
                                          : __('Para un anuncio, un correo o una landing: quien lo abre ya tiene el producto en el carrito.')}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
