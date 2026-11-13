import { useState } from 'react';
import {
    SHOP_COUPON_KIND_LABELS,
    formatShopMoney,
    normalizeCouponCode,
    type ShopConfig,
    type ShopCouponDto,
    type ShopCouponInput,
    type ShopCouponKind,
    type ShopOptions,
} from '@imagina-base/shared';
import { BadgePercent, Loader2, Pencil, Plus, Ticket, Trash2, Truck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { getTenantFormat } from '@/lib/tenantFormat';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { PanelBody, SubSection, Switch } from '../widgets/widgetUi';
import { useDeleteShopCoupon, useSaveShopCoupon, useShopCoupons, useShopProducts } from './useShops';

/**
 * v0.1.415 — Cupones de la tienda: un código que el cliente escribe al
 * comprar. El servidor los valida (fechas, usos, compra mínima, productos) y
 * cuenta cada uso con el pedido: cancelar un pedido devuelve el uso.
 */

const KIND_ICON: Record<ShopCouponKind, typeof BadgePercent> = { percent: BadgePercent, fixed: Ticket, free_shipping: Truck };
/** Nombres cortos para los botones (el panel es angosto). */
const KIND_SHORT: Record<ShopCouponKind, string> = { percent: 'Porcentaje', fixed: 'Monto fijo', free_shipping: 'Envío gratis' };

function emptyCoupon(): ShopCouponInput {
    return {
        code: '',
        description: '',
        kind: 'percent',
        value: 10,
        min_subtotal: null,
        max_uses: null,
        once_per_customer: false,
        starts_on: null,
        ends_on: null,
        product_ids: [],
        categories: [],
        active: true,
    };
}

function toInput(c: ShopCouponDto): ShopCouponInput {
    return {
        code: c.code,
        description: c.description,
        kind: c.kind,
        value: c.value,
        min_subtotal: c.min_subtotal,
        max_uses: c.max_uses,
        once_per_customer: c.once_per_customer,
        starts_on: c.starts_on,
        ends_on: c.ends_on,
        product_ids: c.product_ids,
        categories: c.categories,
        active: c.active,
    };
}

/** «12.500», «12,5», «15» → número; vacío → null. */
function parseAmount(raw: string): number | null {
    const t = raw.trim().replace(/\s/g, '');
    if (t === '') return null;
    const m = /^(.*?)[.,](\d{1,2})$/.exec(t);
    const n = m ? Number(`${m[1]!.replace(/[.,]/g, '')}.${m[2]}`) : Number(t.replace(/[.,]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000_000_000) : null;
}

function NumberField({ value, onChange, placeholder, testId, suffix }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; testId?: string; suffix?: string }): JSX.Element {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <div className="imcrm-relative">
            <Input
                inputMode="decimal"
                value={draft ?? (value === null ? '' : String(value))}
                placeholder={placeholder}
                data-testid={testId}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                    if (draft === null) return;
                    setDraft(null);
                    onChange(parseAmount(draft));
                }}
                className={suffix ? 'imcrm-pr-8' : undefined}
            />
            {suffix && <span className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2.5 imcrm-top-1/2 -imcrm-translate-y-1/2 imcrm-text-[12px] imcrm-text-muted-foreground">{suffix}</span>}
        </div>
    );
}

function Label({ children }: { children: string }): JSX.Element {
    return <span className="imcrm-text-[12.5px] imcrm-font-medium">{children}</span>;
}

export function couponValueText(c: Pick<ShopCouponDto, 'kind' | 'value'>, money: (n: number) => string): string {
    if (c.kind === 'percent') return sprintf(__('%s %% de descuento'), String(c.value));
    if (c.kind === 'fixed') return sprintf(__('%s de descuento'), money(c.value));
    return __('Envío gratis');
}

function CouponEditor({
    shopId,
    initial,
    couponId,
    options,
    money,
    onClose,
}: {
    shopId: number;
    initial: ShopCouponInput;
    couponId: number | null;
    options: ShopOptions;
    money: (n: number) => string;
    onClose: () => void;
}): JSX.Element {
    const toast = useToast();
    const save = useSaveShopCoupon(shopId);
    const [c, setC] = useState<ShopCouponInput>(initial);
    const [q, setQ] = useState('');
    const products = useShopProducts(shopId, q, true);
    const [picked, setPicked] = useState<Map<number, string>>(new Map());
    // Los avisos aparecen al intentar guardar: si salieran mientras se escribe, la página se movería bajo el mouse.
    const [tried, setTried] = useState(false);
    const set = (patch: Partial<ShopCouponInput>): void => setC((prev) => ({ ...prev, ...patch }));
    const code = normalizeCouponCode(c.code);
    const valueOk = c.kind === 'free_shipping' || (c.kind === 'percent' ? c.value > 0 && c.value <= 100 : c.value > 0);
    const datesOk = !c.starts_on || !c.ends_on || c.ends_on >= c.starts_on;
    const valid = code !== '' && valueOk && datesOk;
    const titleOf = (id: number): string => picked.get(id) ?? products.data?.find((p) => p.id === id)?.title ?? sprintf(__('Producto #%d'), id);

    const submit = (): void => {
        if (!valid) {
            setTried(true);
            return;
        }
        save.mutate(
            { couponId, input: { ...c, code } },
            {
                onSuccess: (doc) => {
                    toast.success(couponId === null ? sprintf(__('Cupón «%s» creado'), doc.code) : sprintf(__('Cupón «%s» guardado'), doc.code));
                    onClose();
                },
                onError: (err: unknown) => {
                    const msg = err instanceof Error ? err.message : __('No se pudo guardar el cupón.');
                    toast.error(__('No se pudo guardar el cupón'), msg);
                },
            },
        );
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-primary/40 imcrm-bg-card imcrm-p-3" data-testid="shop-coupon-editor">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-text-[13px] imcrm-font-semibold">{couponId === null ? __('Cupón nuevo') : sprintf(__('Editar «%s»'), initial.code)}</p>
                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={onClose} aria-label={__('Cerrar')}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Código')}</Label>
                <Input
                    value={c.code}
                    maxLength={40}
                    placeholder={__('Ej.: BIENVENIDA10')}
                    onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                    className="imcrm-font-mono imcrm-uppercase"
                    data-testid="shop-coupon-code"
                />
                <span className={cn('imcrm-text-[11.5px]', tried && code === '' ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>
                    {tried && code === '' ? __('Escribe el código: de 2 a 40 letras, números, guion o guion bajo.') : __('Letras, números, guion o guion bajo. Tu cliente lo escribe sin importar mayúsculas.')}
                </span>
            </label>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Qué da')}</Label>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1.5 sm:imcrm-grid-cols-3" role="radiogroup">
                    {(Object.keys(KIND_SHORT) as ShopCouponKind[]).map((k) => {
                        const Icon = KIND_ICON[k];
                        const on = c.kind === k;
                        return (
                            <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => set({ kind: k, value: k === 'percent' ? (c.kind === 'percent' ? c.value : 10) : k === 'fixed' ? (c.kind === 'fixed' ? c.value : 0) : 0 })}
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-[12.5px] imcrm-transition-colors',
                                    on ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-medium' : 'imcrm-border-border hover:imcrm-bg-muted/50',
                                )}
                                data-testid={`shop-coupon-kind-${k}`}
                            >
                                <Icon className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', on ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} />
                                <span title={__(SHOP_COUPON_KIND_LABELS[k])}>{__(KIND_SHORT[k])}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            {c.kind !== 'free_shipping' && (
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{c.kind === 'percent' ? __('Porcentaje') : __('Monto del descuento')}</Label>
                    <div className="imcrm-w-40">
                        <NumberField value={c.value || null} onChange={(v) => set({ value: v ?? 0 })} suffix={c.kind === 'percent' ? '%' : undefined} testId="shop-coupon-value" />
                    </div>
                    {tried && !valueOk && <span className="imcrm-text-[11.5px] imcrm-text-destructive">{c.kind === 'percent' ? __('El porcentaje va de 1 a 100.') : __('Escribe el monto del descuento.')}</span>}
                </label>
            )}
            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Cómo se ve en el carrito (opcional)')}</Label>
                <Input value={c.description} maxLength={200} placeholder={couponValueText({ kind: c.kind, value: c.value }, money)} onChange={(e) => set({ description: e.target.value })} />
            </label>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Compra mínima (opcional)')}</Label>
                    <NumberField value={c.min_subtotal} onChange={(v) => set({ min_subtotal: v !== null && v > 0 ? v : null })} placeholder={__('Sin mínimo')} testId="shop-coupon-min" />
                </label>
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Se puede usar (veces en total)')}</Label>
                    <NumberField
                        value={c.max_uses}
                        onChange={(v) => set({ max_uses: v !== null && v >= 1 ? Math.floor(v) : null })}
                        placeholder={__('Sin límite')}
                        testId="shop-coupon-max"
                    />
                </label>
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Desde (opcional)')}</Label>
                    <Input type="date" value={c.starts_on ?? ''} onChange={(e) => set({ starts_on: e.target.value || null })} data-testid="shop-coupon-from" />
                </label>
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Hasta (opcional)')}</Label>
                    <Input type="date" value={c.ends_on ?? ''} onChange={(e) => set({ ends_on: e.target.value || null })} data-testid="shop-coupon-to" />
                    {tried && !datesOk && <span className="imcrm-text-[11.5px] imcrm-text-destructive">{__('La fecha final es antes de la inicial.')}</span>}
                </label>
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <span className="imcrm-text-[12.5px]">{__('Una sola vez por cliente (por su correo)')}</span>
                <Switch checked={c.once_per_customer} onChange={(v) => set({ once_per_customer: v })} label={__('Una sola vez por cliente')} testId="shop-coupon-once" />
            </div>

            {c.kind !== 'free_shipping' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Label>{__('A qué aplica')}</Label>
                    <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                        {c.product_ids.length === 0 && c.categories.length === 0
                            ? __('A toda la tienda. Elige productos o categorías para limitarlo.')
                            : __('Sólo descuenta los productos elegidos y los de las categorías elegidas (un producto con variantes incluye todas).')}
                    </p>
                    {options.categories.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="shop-coupon-categories">
                            {options.categories.map((cat) => {
                                const on = c.categories.includes(cat);
                                return (
                                    <button
                                        key={cat}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => set({ categories: on ? c.categories.filter((x) => x !== cat) : [...c.categories, cat] })}
                                        className={cn(
                                            'imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-[12px]',
                                            on ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border hover:imcrm-bg-muted',
                                        )}
                                    >
                                        {cat}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {c.product_ids.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {c.product_ids.map((id) => (
                                <span key={id} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-muted imcrm-py-0.5 imcrm-pl-2.5 imcrm-pr-1 imcrm-text-[12px]">
                                    {titleOf(id)}
                                    <button type="button" className="imcrm-rounded-full imcrm-p-0.5 hover:imcrm-bg-background" onClick={() => set({ product_ids: c.product_ids.filter((x) => x !== id) })} aria-label={__('Quitar')}>
                                        <X className="imcrm-h-3 imcrm-w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={__('Buscar un producto para agregarlo…')} data-testid="shop-coupon-product-search" />
                    {q.trim() !== '' && (
                        <div className="imcrm-max-h-44 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                            {(products.data ?? [])
                                .filter((p) => !c.product_ids.includes(p.id))
                                .slice(0, 12)
                                .map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        className="imcrm-block imcrm-w-full imcrm-truncate imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-text-[12.5px] hover:imcrm-bg-muted"
                                        onClick={() => {
                                            setPicked((m) => new Map(m).set(p.id, p.title));
                                            set({ product_ids: [...c.product_ids, p.id] });
                                            setQ('');
                                        }}
                                        data-testid="shop-coupon-product"
                                    >
                                        {p.title}
                                    </button>
                                ))}
                            {products.data && products.data.length === 0 && <p className="imcrm-px-2.5 imcrm-py-2 imcrm-text-[12px] imcrm-text-muted-foreground">{__('No hay productos con ese nombre.')}</p>}
                        </div>
                    )}
                </div>
            )}

            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[12.5px]">
                    <Switch checked={c.active} onChange={(v) => set({ active: v })} label={__('Activo')} testId="shop-coupon-active" />
                    {c.active ? __('Activo') : __('Pausado')}
                </label>
                <div className="imcrm-flex imcrm-gap-2">
                    <Button variant="outline" size="sm" onClick={onClose}>
                        {__('Cancelar')}
                    </Button>
                    <Button size="sm" disabled={save.isPending} onClick={submit} data-testid="shop-coupon-save">
                        {save.isPending && <Loader2 className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                        {couponId === null ? __('Crear cupón') : __('Guardar')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function couponRules(c: ShopCouponDto, money: (n: number) => string): string {
    const parts: string[] = [];
    if (c.min_subtotal) parts.push(sprintf(__('desde %s'), money(c.min_subtotal)));
    if (c.once_per_customer) parts.push(__('una vez por cliente'));
    if (c.product_ids.length > 0 || c.categories.length > 0) parts.push(__('algunos productos'));
    if (c.ends_on) parts.push(sprintf(__('hasta el %s'), c.ends_on));
    return parts.join(' · ');
}

export function CouponsPanel({ shopId, config, options }: { shopId: number; config: ShopConfig; options: ShopOptions }): JSX.Element {
    const coupons = useShopCoupons(shopId);
    const remove = useDeleteShopCoupon(shopId);
    const confirm = useConfirm();
    const toast = useToast();
    const [editing, setEditing] = useState<{ id: number | null; input: ShopCouponInput } | null>(null);
    const fmt = getTenantFormat().number_format;
    const money = (n: number): string => formatShopMoney(n, config.currency, fmt);
    const list = coupons.data ?? [];

    return (
        <PanelBody testId="shop-coupons-panel" tour="shop-coupons">
            <SubSection
                title={__('Tus cupones')}
                hint={__('Tu cliente escribe el código al pagar y ve el descuento antes de confirmar. Cada uso cuenta con su pedido: si lo cancelas, el uso vuelve.')}
                action={
                    !editing && (
                        <Button variant="outline" size="sm" className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs" onClick={() => setEditing({ id: null, input: emptyCoupon() })} data-testid="shop-coupon-new">
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Nuevo cupón')}
                        </Button>
                    )
                }
            >
                {editing && <CouponEditor key={editing.id ?? 'new'} shopId={shopId} initial={editing.input} couponId={editing.id} options={options} money={money} onClose={() => setEditing(null)} />}
                {coupons.isLoading && <p className="imcrm-text-[12.5px] imcrm-text-muted-foreground">{__('Cargando…')}</p>}
                {!coupons.isLoading && list.length === 0 && !editing && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center" data-testid="shop-coupons-empty">
                        <Ticket className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" />
                        <p className="imcrm-text-[13px] imcrm-font-medium">{__('Todavía no tienes cupones')}</p>
                        <p className="imcrm-max-w-sm imcrm-text-[12px] imcrm-text-muted-foreground">{__('Crea uno para una promoción, para quien compra por primera vez o para dar el envío gratis.')}</p>
                    </div>
                )}
                {list.map((c) => {
                    const Icon = KIND_ICON[c.kind];
                    const rules = couponRules(c, money);
                    const exhausted = c.max_uses !== null && c.uses >= c.max_uses;
                    return (
                        <div key={c.id} className={cn('imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3', !c.active && 'imcrm-opacity-70')} data-testid="shop-coupon">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary" aria-hidden>
                                <Icon className="imcrm-h-4 imcrm-w-4" />
                            </span>
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                                    <span className="imcrm-font-mono imcrm-text-[13px] imcrm-font-semibold" data-testid="shop-coupon-code-text">
                                        {c.code}
                                    </span>
                                    {!c.active && <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground">{__('Pausado')}</span>}
                                    {exhausted && <span className="imcrm-rounded-full imcrm-bg-amber-100 imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-amber-800 dark:imcrm-bg-amber-500/15 dark:imcrm-text-amber-300">{__('Agotado')}</span>}
                                </div>
                                <p className="imcrm-text-[12.5px]">{c.description || couponValueText(c, money)}</p>
                                {rules && <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{rules}</p>}
                                <p className="imcrm-mt-1 imcrm-text-[11.5px] imcrm-text-muted-foreground" data-testid="shop-coupon-uses">
                                    {c.max_uses !== null ? sprintf(__('%1$d de %2$d usos'), c.uses, c.max_uses) : c.uses === 1 ? __('1 uso') : sprintf(__('%d usos'), c.uses)}
                                    {c.discounted > 0 && ` · ${sprintf(__('%s descontados'), money(c.discounted))}`}
                                </p>
                            </div>
                            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={() => setEditing({ id: c.id, input: toInput(c) })} aria-label={sprintf(__('Editar %s'), c.code)} data-testid="shop-coupon-edit">
                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="imcrm-h-7 imcrm-w-7"
                                    aria-label={sprintf(__('Eliminar %s'), c.code)}
                                    onClick={async () => {
                                        const ok = await confirm({
                                            title: sprintf(__('¿Eliminar el cupón «%s»?'), c.code),
                                            description: __('Deja de servir en la tienda. Los pedidos que ya lo usaron conservan su descuento.'),
                                            confirmLabel: __('Eliminar'),
                                            destructive: true,
                                        });
                                        if (!ok) return;
                                        remove.mutate(c.id, { onError: () => toast.error(__('No se pudo eliminar el cupón')) });
                                    }}
                                    data-testid="shop-coupon-delete"
                                >
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </SubSection>
        </PanelBody>
    );
}
