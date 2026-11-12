import { useMemo, useState } from 'react';
import { Check, ChevronLeft, Layers, Loader2, Search } from 'lucide-react';
import { SHOP_MAX_GENERATED_VARIANTS, missingVariantCombos, type ShopVariantAttributeDto, type ShopVariantProductDto } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { useGenerateShopVariants, useShopProductVariants, useShopProducts } from './useShops';

/** Los valores escritos de un atributo de texto: «S, M, L» o uno por renglón. */
export function parseVariantValues(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.split(/[,\n;]/)) {
        const v = raw.trim().slice(0, 80);
        if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    }
    return out;
}

function money(n: number | null): string {
    return n === null ? '—' : `$ ${formatNumber(n)}`;
}

/**
 * v0.1.414 — Crear las variantes de un producto: se eligen los valores de
 * cada atributo (Talla: S, M, L × Color: Rojo, Azul) y se crean como
 * subtareas las combinaciones que falten, con el precio y el stock que se
 * pongan (vacío = el precio del producto y sin límite).
 */
export function ShopVariantsSheet({
    shopId,
    attributes,
    open,
    onOpenChange,
    onCreated,
}: {
    shopId: number;
    attributes: number[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}): JSX.Element {
    const [q, setQ] = useState('');
    const [product, setProduct] = useState<ShopVariantProductDto | null>(null);
    const products = useShopProducts(shopId, q.trim(), open && product === null);
    const detail = useShopProductVariants(shopId, product?.id ?? null, attributes);
    const generate = useGenerateShopVariants(shopId);
    const toast = useToast();
    const [chosen, setChosen] = useState<Record<number, string[]>>({});
    const [texts, setTexts] = useState<Record<number, string>>({});
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('');

    const attrs: ShopVariantAttributeDto[] = detail.data?.attributes ?? [];
    const values = attrs.map((a) => (a.type === 'select' ? (chosen[a.field_id] ?? []) : parseVariantValues(texts[a.field_id] ?? '')));
    const plan = useMemo(
        () => missingVariantCombos(values, (detail.data?.variants ?? []).map((v) => v.values)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(values), detail.data],
    );

    const reset = (): void => {
        setProduct(null);
        setChosen({});
        setTexts({});
        setPrice('');
        setStock('');
    };

    const toggle = (fieldId: number, v: string): void =>
        setChosen((c) => {
            const cur = c[fieldId] ?? [];
            return { ...c, [fieldId]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
        });

    const parsedPrice = (): number | null => {
        const t = price.trim().replace(/\s/g, '');
        if (!t) return null;
        const m = /^(.*?)[.,](\d{1,2})$/.exec(t);
        const n = m ? Number(`${m[1]!.replace(/[.,]/g, '')}.${m[2]}`) : Number(t.replace(/[.,]/g, ''));
        return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const submit = (): void => {
        if (!product || plan.combos.length === 0) return;
        const st = stock.trim() === '' ? null : Math.max(0, Math.floor(Number(stock)));
        generate.mutate(
            {
                product_id: product.id,
                attributes: attrs.map((a) => a.field_id),
                values,
                price: parsedPrice(),
                stock: st !== null && Number.isFinite(st) ? st : null,
            },
            {
                onSuccess: (out) => {
                    if (out.error) toast.error(out.created > 0 ? sprintf(__('Se crearon %d variantes, pero no todas'), out.created) : __('No se crearon las variantes'), out.error);
                    else toast.success(out.created === 1 ? __('Se creó 1 variante') : sprintf(__('Se crearon %d variantes'), out.created));
                    setChosen({});
                    setTexts({});
                    onCreated();
                },
                onError: (e: unknown) => toast.error(__('No se crearon las variantes'), e instanceof Error ? e.message : undefined),
            },
        );
    };

    return (
        <Sheet
            open={open}
            onOpenChange={(o) => {
                if (!o) reset();
                onOpenChange(o);
            }}
        >
            <SheetContent className="sm:imcrm-w-[520px]" data-testid="shop-variants-sheet">
                <SheetHeader>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <SheetTitle>{__('Crear variantes')}</SheetTitle>
                        <SheetDescription>{__('Cada combinación se crea como una subtarea del producto en la lista, con su propio precio, stock y referencia.')}</SheetDescription>
                    </div>
                    <SheetCloseButton />
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    {product === null ? (
                        <>
                            <label className="imcrm-relative imcrm-block">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={__('Buscar el producto')} className="imcrm-pl-8" autoFocus data-testid="shop-variants-search" />
                            </label>
                            <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                                {products.isLoading && <p className="imcrm-p-4 imcrm-text-[12.5px] imcrm-text-muted-foreground">{__('Cargando…')}</p>}
                                {products.data?.length === 0 && <p className="imcrm-p-4 imcrm-text-[12.5px] imcrm-text-muted-foreground">{__('No hay productos con ese nombre.')}</p>}
                                {products.data?.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setProduct(p)}
                                        className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-3 imcrm-py-2.5 imcrm-text-left hover:imcrm-bg-accent"
                                        data-testid="shop-variants-product"
                                    >
                                        <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[13px] imcrm-font-medium">{p.title}</span>
                                        <span className="imcrm-flex-none imcrm-text-[12px] imcrm-text-muted-foreground">
                                            {p.variants === 0 ? __('Sin variantes') : p.variants === 1 ? __('1 variante') : sprintf(__('%d variantes'), p.variants)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Button variant="ghost" size="sm" onClick={reset} data-testid="shop-variants-back">
                                    <ChevronLeft className="imcrm-h-4 imcrm-w-4" />
                                    {__('Otro producto')}
                                </Button>
                                <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[13.5px] imcrm-font-semibold">{product.title}</span>
                            </div>
                            {detail.isLoading && <p className="imcrm-text-[12.5px] imcrm-text-muted-foreground">{__('Cargando…')}</p>}
                            {detail.data && (
                                <>
                                    <div>
                                        <p className="imcrm-mb-1.5 imcrm-text-[12.5px] imcrm-font-medium">
                                            {detail.data.variants.length === 0 ? __('Todavía no tiene variantes.') : sprintf(__('Ya tiene %d:'), detail.data.variants.length)}
                                        </p>
                                        {detail.data.variants.length > 0 && (
                                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="shop-variants-existing">
                                                {detail.data.variants.slice(0, 40).map((v) => (
                                                    <span key={v.id} className="imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1 imcrm-text-[12px]">
                                                        {v.label}
                                                        {v.price !== null && <span className="imcrm-text-muted-foreground"> · {money(v.price)}</span>}
                                                        {v.stock !== null && <span className="imcrm-text-muted-foreground"> · {sprintf(__('%d u.'), v.stock)}</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {attrs.length === 0 ? (
                                        <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3 imcrm-text-[12.5px] imcrm-text-muted-foreground">
                                            {__('Elige primero los atributos (Talla, Color…) en «Variantes» para poder crear las combinaciones.')}
                                        </p>
                                    ) : (
                                        attrs.map((a) => (
                                            <div key={a.field_id} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                <p className="imcrm-text-[12.5px] imcrm-font-medium">{a.label}</p>
                                                {a.type === 'select' ? (
                                                    a.values.length === 0 ? (
                                                        <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('El campo no tiene opciones: agrégalas en Configuración → Campos.')}</p>
                                                    ) : (
                                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                                                            {a.values.map((v) => {
                                                                const on = (chosen[a.field_id] ?? []).includes(v);
                                                                return (
                                                                    <button
                                                                        key={v}
                                                                        type="button"
                                                                        aria-pressed={on}
                                                                        onClick={() => toggle(a.field_id, v)}
                                                                        className={cn(
                                                                            'imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-text-[12.5px]',
                                                                            on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-border-border hover:imcrm-bg-accent',
                                                                        )}
                                                                        data-testid="shop-variants-value"
                                                                    >
                                                                        {on && <Check className="imcrm-h-3.5 imcrm-w-3.5" />}
                                                                        {v}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )
                                                ) : (
                                                    <>
                                                        <Input
                                                            value={texts[a.field_id] ?? ''}
                                                            onChange={(e) => setTexts((t) => ({ ...t, [a.field_id]: e.target.value }))}
                                                            placeholder={a.values.length > 0 ? a.values.slice(0, 4).join(', ') : __('Ej.: S, M, L')}
                                                            data-testid="shop-variants-text"
                                                        />
                                                        <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Separa los valores con comas.')}</p>
                                                    </>
                                                )}
                                            </div>
                                        ))
                                    )}
                                    {attrs.length > 0 && (
                                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                <label className="imcrm-text-[12.5px] imcrm-font-medium" htmlFor="shop-variants-price">
                                                    {__('Precio')}
                                                </label>
                                                <Input
                                                    id="shop-variants-price"
                                                    inputMode="decimal"
                                                    value={price}
                                                    onChange={(e) => setPrice(e.target.value)}
                                                    placeholder={detail.data.product.price !== null ? sprintf(__('El del producto (%s)'), money(detail.data.product.price)) : __('El del producto')}
                                                    data-testid="shop-variants-price"
                                                />
                                            </div>
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                                <label className="imcrm-text-[12.5px] imcrm-font-medium" htmlFor="shop-variants-stock">
                                                    {__('Unidades de cada una')}
                                                </label>
                                                <Input
                                                    id="shop-variants-stock"
                                                    inputMode="numeric"
                                                    value={stock}
                                                    onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ''))}
                                                    placeholder={__('Sin límite')}
                                                    data-testid="shop-variants-stock"
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {attrs.length > 0 && values.every((v) => v.length > 0) && (
                                        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3" data-testid="shop-variants-plan">
                                            <p className="imcrm-text-[12.5px] imcrm-font-medium">
                                                {plan.combos.length === 0
                                                    ? __('Ya tiene todas esas combinaciones.')
                                                    : plan.combos.length === 1
                                                      ? __('Se va a crear 1 variante:')
                                                      : sprintf(__('Se van a crear %d variantes:'), plan.combos.length)}
                                            </p>
                                            {plan.combos.length > 0 && (
                                                <p className="imcrm-mt-1 imcrm-text-[12px] imcrm-text-muted-foreground">
                                                    {plan.combos
                                                        .slice(0, 12)
                                                        .map((c) => c.join(' / '))
                                                        .join(' · ')}
                                                    {plan.combos.length > 12 ? ` · ${sprintf(__('y %d más'), plan.combos.length - 12)}` : ''}
                                                </p>
                                            )}
                                            {plan.existing > 0 && (
                                                <p className="imcrm-mt-1 imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                                    {plan.existing === 1 ? __('1 ya existe y no se toca.') : sprintf(__('%d ya existen y no se tocan.'), plan.existing)}
                                                </p>
                                            )}
                                            {plan.truncated && (
                                                <p className="imcrm-mt-1 imcrm-text-[11.5px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                                    {sprintf(__('Se crean hasta %d de una vez: vuelve a crear para las que falten.'), SHOP_MAX_GENERATED_VARIANTS)}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </SheetBody>
                {product !== null && attrs.length > 0 && (
                    <SheetFooter>
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>
                            {__('Cerrar')}
                        </Button>
                        <Button onClick={submit} disabled={plan.combos.length === 0 || generate.isPending} data-testid="shop-variants-create">
                            {generate.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Layers className="imcrm-h-4 imcrm-w-4" />}
                            {plan.combos.length === 1 ? __('Crear 1 variante') : sprintf(__('Crear %d variantes'), plan.combos.length)}
                        </Button>
                    </SheetFooter>
                )}
            </SheetContent>
        </Sheet>
    );
}
