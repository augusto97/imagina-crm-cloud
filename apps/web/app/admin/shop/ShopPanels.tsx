import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    Banknote,
    Check,
    Copy,
    ExternalLink,
    Home,
    LayoutDashboard,
    Loader2,
    MessageCircle,
    Plus,
    RefreshCw,
    ShieldCheck,
    Trash2,
    Truck,
    Wallet,
} from 'lucide-react';
import {
    SHOP_CATALOG_FIELD_TYPES,
    SHOP_CATALOG_ROLE_LABELS,
    SHOP_COD_DEFAULT,
    SHOP_DEFAULT_DELIVERY_TIME,
    SHOP_DEFAULT_RETURNS,
    SHOP_DEFAULT_REVERSAL,
    SHOP_MAX_DELIVERY_METHODS,
    SHOP_SORTS,
    SHOP_SORT_LABELS,
    SHOP_TRANSFER_DEFAULT,
    newShopItemId,
    type ShopCatalogFields,
    type ShopConfig,
    type ShopDeliveryMethod,
    type ShopDto,
    type ShopOptions,
    type ShopProblem,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { DomainChips } from '../forms/DomainChips';
import { PublicQrCard } from '../forms/PublicQrCard';
import { ColorChoice } from '../widgets/WidgetButtonEditor';
import { PanelBody, SubSection, Switch, SwitchRow } from '../widgets/widgetUi';
import { SHOP_SECTION_INFO, shopEmbedCode } from './shopEditor';

type Patch = (fn: (c: ShopConfig) => ShopConfig) => void;

function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <label htmlFor={htmlFor} className="imcrm-text-[12.5px] imcrm-font-medium">
                {label}
            </label>
            {children}
            {hint && <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

function Segmented<T extends string | number>({ value, onChange, options, testId }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string]>; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-inline-flex imcrm-flex-wrap imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5" role="radiogroup" data-testid={testId}>
            {options.map(([v, label]) => (
                <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={v === value}
                    onClick={() => onChange(v)}
                    className={cn(
                        'imcrm-h-7 imcrm-rounded-md imcrm-px-2.5 imcrm-text-[12.5px] imcrm-transition-colors',
                        v === value ? 'imcrm-bg-card imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

/** El monto en la moneda de la tienda, con los separadores que use la persona («12.500»). */
function MoneyInput({ value, onChange, testId, placeholder }: { value: number | null; onChange: (v: number | null) => void; testId?: string; placeholder?: string }): JSX.Element {
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? (value === null ? '' : String(value));
    return (
        <Input
            inputMode="decimal"
            value={shown}
            placeholder={placeholder}
            data-testid={testId}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                if (draft === null) return;
                const t = draft.trim();
                setDraft(null);
                if (t === '') return onChange(null);
                // «12.500» o «12,500» (miles) y «12,50» (decimal): el último separador con dos dígitos es decimal.
                const m = /^(.*?)[.,](\d{1,2})$/.exec(t.replace(/\s/g, ''));
                const n = m ? Number(`${m[1]!.replace(/[.,]/g, '')}.${m[2]}`) : Number(t.replace(/[.,\s]/g, ''));
                onChange(Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000_000_000) : value);
            }}
        />
    );
}

// ── Productos ──────────────────────────────────────────────────────────

const ROLE_ORDER: Array<keyof ShopCatalogFields> = ['name', 'price', 'compare_price', 'images', 'description', 'category', 'stock', 'sku', 'active'];

const ROLE_HINT: Partial<Record<keyof ShopCatalogFields, string>> = {
    name: 'Si no eliges uno, se usa el título de cada registro.',
    price: 'Un campo de moneda o número. Sin precio, el producto no se puede comprar.',
    compare_price: 'Opcional: si es mayor que el precio, se muestra tachado con el descuento.',
    images: 'Un campo de archivos (fotos subidas) o un enlace mostrado como imagen.',
    category: 'Arma los filtros de categoría de la tienda.',
    stock: 'Un número: cada venta lo descuenta y cancelar un pedido lo devuelve. Vacío en un producto = sin límite.',
    active: 'Una casilla: sólo se venden los marcados. Sin elegirla, se venden todos.',
};

export function CatalogPanel({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const set = (role: keyof ShopCatalogFields, id: number | null): void => patch((c) => ({ ...c, catalog: { ...c.catalog, [role]: id } }));
    const taken = new Map<number, keyof ShopCatalogFields>();
    for (const r of ROLE_ORDER) {
        const v = config.catalog[r];
        if (v !== null) taken.set(v, r);
    }
    return (
        <PanelBody testId="shop-catalog">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-[12.5px]">
                <span>
                    {options.products_count === 1 ? __('1 producto en') : sprintf(__('%d productos en'), options.products_count)} <strong>{options.list.name}</strong>
                </span>
                <Link to={`/lists/${options.list.slug}/records`} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-primary hover:imcrm-underline">
                    {__('Editar productos')}
                    <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                </Link>
            </div>
            <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                {__('Para agregar un producto, crea un registro en la lista. Lo que cambies ahí se ve en la tienda en menos de un minuto.')}
            </p>
            {ROLE_ORDER.map((role) => {
                const types = SHOP_CATALOG_FIELD_TYPES[role];
                const fields = options.fields.filter((f) => (types as readonly string[]).includes(f.type));
                const value = config.catalog[role];
                const missingPrice = role === 'price' && value === null;
                return (
                    <Field key={role} label={__(SHOP_CATALOG_ROLE_LABELS[role])} hint={ROLE_HINT[role] ? __(ROLE_HINT[role]!) : undefined} htmlFor={`shop-role-${role}`}>
                        <Select
                            id={`shop-role-${role}`}
                            value={value === null ? '' : String(value)}
                            onChange={(e) => set(role, e.target.value === '' ? null : Number(e.target.value))}
                            className={cn(missingPrice && 'imcrm-border-destructive/60')}
                            data-testid={`shop-role-${role}`}
                        >
                            <option value="">{role === 'name' ? __('El título del registro') : role === 'active' ? __('Se venden todos') : role === 'stock' ? __('Sin control de stock') : __('Ninguno')}</option>
                            {fields.map((f) => {
                                const other = taken.get(f.id);
                                return (
                                    <option key={f.id} value={f.id} disabled={other !== undefined && other !== role}>
                                        {f.label}
                                        {other !== undefined && other !== role ? ` · ${__(SHOP_CATALOG_ROLE_LABELS[other])}` : ''}
                                    </option>
                                );
                            })}
                        </Select>
                        {fields.length === 0 && role !== 'name' && (
                            <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                {sprintf(__('La lista no tiene un campo de este tipo. Créalo en Configuración → Campos.'))}
                            </p>
                        )}
                    </Field>
                );
            })}
            <SubSection title={__('Moneda')} hint={__('La de los precios de la lista. Todos los productos de la tienda se venden en la misma.')}>
                <Select value={config.currency} onChange={(e) => patch((c) => ({ ...c, currency: e.target.value }))} data-testid="shop-currency">
                    {['COP', 'USD', 'MXN', 'CLP', 'PEN', 'ARS', 'EUR', 'BRL'].map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </Select>
            </SubSection>
        </PanelBody>
    );
}

// ── Apariencia ─────────────────────────────────────────────────────────

export function DesignPanel({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const d = config.display;
    const setD = (p: Partial<ShopConfig['display']>): void => patch((c) => ({ ...c, display: { ...c.display, ...p } }));
    const setT = (p: Partial<ShopConfig['texts']>): void => patch((c) => ({ ...c, texts: { ...c.texts, ...p } }));
    return (
        <PanelBody testId="shop-design">
            <SubSection title={__('Encabezado')}>
                <Field label={__('Título de la tienda')} hint={__('Si lo dejas vacío, se usa el nombre de la tienda.')}>
                    <Input value={config.texts.title} maxLength={120} onChange={(e) => setT({ title: e.target.value })} data-testid="shop-title" />
                </Field>
                <Field label={__('Descripción')}>
                    <Textarea value={config.texts.description} maxLength={600} rows={3} onChange={(e) => setT({ description: e.target.value })} data-testid="shop-description" />
                </Field>
                <SwitchRow label={__('Mostrar el logo de tu marca')} checked={config.show_logo} onChange={(v) => patch((c) => ({ ...c, show_logo: v }))} testId="shop-show-logo" />
                <Field label={__('Color')}>
                    <ColorChoice value={config.color} fallbackLabel={__('El de tu marca')} fallbackColor={options.brand_color} onChange={(color) => patch((c) => ({ ...c, color }))} />
                </Field>
            </SubSection>
            <SubSection title={__('Productos')}>
                <Field label={__('Por fila (en computador)')} hint={__('En el celular siempre van de a dos.')}>
                    <Segmented value={d.columns} onChange={(columns) => setD({ columns })} options={[[2, '2'], [3, '3'], [4, '4']]} testId="shop-columns" />
                </Field>
                <Field label={__('Forma de la foto')}>
                    <Segmented
                        value={d.image_ratio}
                        onChange={(image_ratio) => setD({ image_ratio })}
                        options={[
                            ['square', __('Cuadrada')],
                            ['portrait', __('Vertical')],
                            ['landscape', __('Horizontal')],
                        ]}
                    />
                </Field>
                <Field label={__('Cómo se ajusta la foto')}>
                    <Segmented
                        value={d.image_fit}
                        onChange={(image_fit) => setD({ image_fit })}
                        options={[
                            ['cover', __('Llena el espacio')],
                            ['contain', __('Se ve entera')],
                        ]}
                    />
                </Field>
                <Field label={__('Orden')}>
                    <Select value={d.sort} onChange={(e) => setD({ sort: e.target.value as ShopConfig['display']['sort'] })} data-testid="shop-sort">
                        {SHOP_SORTS.map((s) => (
                            <option key={s} value={s}>
                                {__(SHOP_SORT_LABELS[s])}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={__('Cuántas quedan')}>
                    <Segmented
                        value={d.show_stock}
                        onChange={(show_stock) => setD({ show_stock })}
                        options={[
                            ['never', __('No decirlo')],
                            ['low', __('Cuando quedan pocas')],
                            ['always', __('Siempre')],
                        ]}
                    />
                </Field>
                {d.show_stock === 'low' && (
                    <Field label={__('«Pocas» es')}>
                        <Input type="number" min={1} max={1000} value={d.low_stock_at} onChange={(e) => setD({ low_stock_at: Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))) })} className="imcrm-w-28" />
                    </Field>
                )}
                <SwitchRow label={__('Buscador')} checked={d.show_search} onChange={(v) => setD({ show_search: v })} />
                <SwitchRow label={__('Filtros por categoría')} hint={__('Salen del campo de categoría de los productos.')} checked={d.show_categories} onChange={(v) => setD({ show_categories: v })} />
                <SwitchRow label={__('Mostrar la referencia (SKU)')} checked={d.show_sku} onChange={(v) => setD({ show_sku: v })} />
                <SwitchRow label={__('Ocultar los agotados')} hint={__('Si no, se ven apagados con «Agotado».')} checked={d.hide_sold_out} onChange={(v) => setD({ hide_sold_out: v })} />
            </SubSection>
            <SubSection title={__('Textos de los botones')}>
                <Field label={__('Agregar al carrito')}>
                    <Input value={config.texts.add_to_cart} maxLength={40} onChange={(e) => setT({ add_to_cart: e.target.value })} />
                </Field>
                <Field label={__('Finalizar compra')}>
                    <Input value={config.texts.checkout} maxLength={40} onChange={(e) => setT({ checkout: e.target.value })} />
                </Field>
            </SubSection>
        </PanelBody>
    );
}

// ── Pago y entrega ─────────────────────────────────────────────────────

function DeliveryRow({ d, index, count, onChange, onMove, onRemove }: { d: ShopDeliveryMethod; index: number; count: number; onChange: (d: ShopDeliveryMethod) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void }): JSX.Element {
    return (
        <div className={cn('imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3', !d.active && 'imcrm-opacity-70')} data-shop-delivery={d.id}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-text-muted-foreground" aria-hidden>
                    {d.needs_address ? <Truck className="imcrm-h-4 imcrm-w-4" /> : <Home className="imcrm-h-4 imcrm-w-4" />}
                </span>
                <Input value={d.name} maxLength={80} placeholder={__('Nombre (ej.: Envío a domicilio)')} onChange={(e) => onChange({ ...d, name: e.target.value })} aria-label={__('Nombre de la entrega')} />
                <Switch checked={d.active} onChange={(active) => onChange({ ...d, active })} label={__('Activa')} />
            </div>
            <div className="imcrm-mt-2 imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
                <Input value={d.description} maxLength={240} placeholder={__('Detalle (opcional): zonas, tiempos…')} onChange={(e) => onChange({ ...d, description: e.target.value })} aria-label={__('Detalle')} />
                <div className="imcrm-w-32">
                    <MoneyInput value={d.price} onChange={(v) => onChange({ ...d, price: v ?? 0 })} placeholder={__('Costo')} />
                </div>
            </div>
            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[12.5px]">
                    <input type="checkbox" checked={d.needs_address} onChange={(e) => onChange({ ...d, needs_address: e.target.checked })} className="imcrm-accent-[hsl(var(--imcrm-primary))]" />
                    {__('Pide dirección y ciudad')}
                </label>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label={__('Subir')}>
                        <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={__('Bajar')}>
                        <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={onRemove} aria-label={__('Quitar')}>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function PaymentPanel({ config, patch }: { config: ShopConfig; patch: Patch }): JSX.Element {
    const p = config.payments;
    const setP = <K extends keyof ShopConfig['payments']>(k: K, v: Partial<ShopConfig['payments'][K]>): void =>
        patch((c) => ({ ...c, payments: { ...c.payments, [k]: { ...c.payments[k], ...v } } }));
    const setDelivery = (fn: (d: ShopDeliveryMethod[]) => ShopDeliveryMethod[]): void => patch((c) => ({ ...c, delivery: fn(c.delivery) }));
    return (
        <PanelBody testId="shop-payment">
            <SubSection title={__('Cómo te pagan')} hint={__('Puedes activar varias: quien compra elige una. El pago en línea con tarjeta llega en la próxima versión.')}>
                <SwitchRow
                    boxed
                    icon={MessageCircle}
                    label={__('Por WhatsApp')}
                    hint={__('Al terminar, la persona te manda el pedido armado a tu WhatsApp y acuerdan el pago por chat.')}
                    checked={p.whatsapp.enabled}
                    onChange={(enabled) => setP('whatsapp', { enabled })}
                    testId="shop-pay-whatsapp"
                >
                    <Field label={__('Tu número de WhatsApp')} hint={__('Con el indicativo del país. No se muestra en la página.')}>
                        <Input value={p.whatsapp.phone} placeholder="+57 300 111 2233" inputMode="tel" maxLength={20} onChange={(e) => setP('whatsapp', { phone: e.target.value })} data-testid="shop-wa-phone" />
                    </Field>
                    <Field label={__('Cómo empieza el mensaje')}>
                        <Input value={p.whatsapp.intro} maxLength={200} onChange={(e) => setP('whatsapp', { intro: e.target.value })} />
                    </Field>
                </SwitchRow>
                <SwitchRow
                    boxed
                    icon={Banknote}
                    label={__('Transferencia o consignación')}
                    hint={__('Se muestran tus datos para transferir; marcas el pedido como pagado cuando llegue el dinero.')}
                    checked={p.transfer.enabled}
                    onChange={(enabled) => setP('transfer', { enabled })}
                    testId="shop-pay-transfer"
                >
                    <Field label={__('Datos para transferir')} hint={__('Banco, tipo y número de cuenta, titular, Nequi o Daviplata… Se muestran al comprar y van en el correo de confirmación.')}>
                        <Textarea value={p.transfer.instructions} rows={4} maxLength={1500} placeholder={SHOP_TRANSFER_DEFAULT} onChange={(e) => setP('transfer', { instructions: e.target.value })} data-testid="shop-transfer-text" />
                    </Field>
                </SwitchRow>
                <SwitchRow
                    boxed
                    icon={Wallet}
                    label={__('Contra entrega')}
                    hint={__('Te pagan cuando reciben el pedido.')}
                    checked={p.cod.enabled}
                    onChange={(enabled) => setP('cod', { enabled })}
                    testId="shop-pay-cod"
                >
                    <Field label={__('Indicaciones')}>
                        <Textarea value={p.cod.instructions} rows={2} maxLength={600} placeholder={SHOP_COD_DEFAULT} onChange={(e) => setP('cod', { instructions: e.target.value })} />
                    </Field>
                </SwitchRow>
            </SubSection>
            <SubSection
                title={__('Cómo reciben el pedido')}
                hint={__('El costo de cada una se suma al total. Una entrega a domicilio pide la dirección; recoger en el local, no.')}
                action={
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs"
                        disabled={config.delivery.length >= SHOP_MAX_DELIVERY_METHODS}
                        onClick={() =>
                            setDelivery((list) => [...list, { id: newShopItemId(list.map((d) => d.id)), name: '', description: '', price: 0, needs_address: true, active: true }])
                        }
                        data-testid="shop-delivery-add"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar')}
                    </Button>
                }
            >
                {config.delivery.length === 0 && <p className="imcrm-text-[12px] imcrm-text-destructive">{__('Agrega al menos una forma de entrega.')}</p>}
                {config.delivery.map((d, i) => (
                    <DeliveryRow
                        key={d.id}
                        d={d}
                        index={i}
                        count={config.delivery.length}
                        onChange={(next) => setDelivery((list) => list.map((x) => (x.id === d.id ? next : x)))}
                        onMove={(dir) =>
                            setDelivery((list) => {
                                const out = [...list];
                                const j = i + dir;
                                if (j < 0 || j >= out.length) return out;
                                [out[i], out[j]] = [out[j]!, out[i]!];
                                return out;
                            })
                        }
                        onRemove={() => setDelivery((list) => list.filter((x) => x.id !== d.id))}
                    />
                ))}
            </SubSection>
        </PanelBody>
    );
}

// ── Datos y avisos ─────────────────────────────────────────────────────

export function CheckoutPanel({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const ch = config.checkout;
    const setC = (p: Partial<ShopConfig['checkout']>): void => patch((c) => ({ ...c, checkout: { ...c.checkout, ...p } }));
    const setT = (p: Partial<ShopConfig['texts']>): void => patch((c) => ({ ...c, texts: { ...c.texts, ...p } }));
    const toggleNotify = (id: number, on: boolean): void =>
        setC({ notify_user_ids: on ? [...ch.notify_user_ids.filter((x) => x !== id), id].slice(0, 20) : ch.notify_user_ids.filter((x) => x !== id) });
    return (
        <PanelBody testId="shop-checkout">
            <SubSection title={__('Lo que se pide al comprar')} hint={__('Nombre, correo y celular siempre. La dirección, sólo si la entrega la necesita.')}>
                <Field label={__('Cédula o NIT')}>
                    <Segmented
                        value={ch.ask_document}
                        onChange={(ask_document) => setC({ ask_document })}
                        options={[
                            ['hidden', __('No pedirla')],
                            ['optional', __('Opcional')],
                            ['required', __('Obligatoria')],
                        ]}
                        testId="shop-ask-document"
                    />
                </Field>
                <SwitchRow label={__('Notas para el pedido')} hint={__('Un espacio para indicaciones (talla, color, horario de entrega…).')} checked={ch.ask_notes} onChange={(v) => setC({ ask_notes: v })} />
                <SwitchRow
                    label={__('Aceptar los términos')}
                    hint={__('Una casilla obligatoria con el enlace a tus términos y a la política de cambios y devoluciones.')}
                    checked={ch.require_terms}
                    onChange={(v) => setC({ require_terms: v })}
                />
                <SwitchRow
                    label={__('Verificación anti-robots')}
                    hint={__('Usa la que configuraste en Ajustes → Portal y formularios. Sin llaves, no se muestra.')}
                    checked={ch.captcha}
                    onChange={(v) => setC({ captcha: v })}
                />
                <Field label={__('Compra mínima')} hint={__('Vacío = sin mínimo. Se compara con el subtotal (sin el envío).')}>
                    <div className="imcrm-w-40">
                        <MoneyInput value={ch.min_order} onChange={(min_order) => setC({ min_order: min_order && min_order > 0 ? min_order : null })} placeholder={__('Sin mínimo')} testId="shop-min-order" />
                    </div>
                </Field>
            </SubSection>
            <SubSection title={__('Después de comprar')}>
                <SwitchRow
                    label={__('Correo de confirmación a quien compra')}
                    hint={__('Con el detalle del pedido, cómo pagar y el enlace para ver su estado. Sale por el correo de tu empresa.')}
                    checked={ch.send_confirmation}
                    onChange={(v) => setC({ send_confirmation: v })}
                />
                <Field label={__('Título del mensaje de gracias')}>
                    <Input value={config.texts.success_title} maxLength={120} onChange={(e) => setT({ success_title: e.target.value })} />
                </Field>
                <Field label={__('Mensaje de gracias')}>
                    <Textarea value={config.texts.success_message} maxLength={600} rows={3} onChange={(e) => setT({ success_message: e.target.value })} />
                </Field>
            </SubSection>
            <SubSection title={__('A quién le avisa cada pedido')} hint={__('Les llega en la campana, al correo y al celular. Si no eliges a nadie, le llega a quien creó la tienda.')}>
                {options.members.length === 0 ? (
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('No hay personas en el equipo.')}</p>
                ) : (
                    <ul className="imcrm-flex imcrm-max-h-60 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto" data-testid="shop-notify">
                        {options.members.map((m) => {
                            const on = ch.notify_user_ids.includes(m.id);
                            return (
                                <li key={m.id}>
                                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-[13px] hover:imcrm-bg-muted">
                                        <input type="checkbox" checked={on} onChange={(e) => toggleNotify(m.id, e.target.checked)} />
                                        {m.name}
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </SubSection>
        </PanelBody>
    );
}

// ── Quién vende y políticas ────────────────────────────────────────────

export function SellerPanel({ config, patch }: { config: ShopConfig; patch: Patch }): JSX.Element {
    const s = config.seller;
    const setS = (p: Partial<ShopConfig['seller']>): void => patch((c) => ({ ...c, seller: { ...c.seller, ...p } }));
    const setPol = (p: Partial<ShopConfig['policies']>): void => patch((c) => ({ ...c, policies: { ...c.policies, ...p } }));
    return (
        <PanelBody testId="shop-seller">
            <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-[12px] imcrm-leading-snug imcrm-text-muted-foreground">
                <ShieldCheck className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />
                <p>
                    {__('El Estatuto del Consumidor (Ley 1480) pide que, antes de comprar, se vea quién vende, cómo contactarlo, el precio total y las condiciones de cambios y devoluciones. Sin estos datos la tienda no se puede publicar. Los textos de abajo son un punto de partida: revísalos con tu abogado.')}
                </p>
            </div>
            <SubSection title={__('Quién vende')}>
                <Field label={__('Nombre o razón social')}>
                    <Input value={s.legal_name} maxLength={160} onChange={(e) => setS({ legal_name: e.target.value })} data-testid="shop-seller-name" />
                </Field>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                    <Field label={__('NIT o cédula')}>
                        <Input value={s.document} maxLength={40} onChange={(e) => setS({ document: e.target.value })} data-testid="shop-seller-document" />
                    </Field>
                    <Field label={__('Ciudad')}>
                        <Input value={s.city} maxLength={80} onChange={(e) => setS({ city: e.target.value })} data-testid="shop-seller-city" />
                    </Field>
                </div>
                <Field label={__('Dirección')}>
                    <Input value={s.address} maxLength={200} onChange={(e) => setS({ address: e.target.value })} data-testid="shop-seller-address" />
                </Field>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                    <Field label={__('Correo')}>
                        <Input type="email" value={s.email} maxLength={200} onChange={(e) => setS({ email: e.target.value })} data-testid="shop-seller-email" />
                    </Field>
                    <Field label={__('Teléfono')}>
                        <Input value={s.phone} maxLength={40} onChange={(e) => setS({ phone: e.target.value })} data-testid="shop-seller-phone" />
                    </Field>
                </div>
            </SubSection>
            <SubSection title={__('Políticas')}>
                <Field label={__('Tiempos de entrega')}>
                    <Textarea value={config.policies.delivery_time} rows={2} maxLength={600} placeholder={SHOP_DEFAULT_DELIVERY_TIME} onChange={(e) => setPol({ delivery_time: e.target.value })} />
                </Field>
                <Field label={__('Cambios, devoluciones y retracto')}>
                    <Textarea value={config.policies.returns} rows={5} maxLength={3000} placeholder={SHOP_DEFAULT_RETURNS} onChange={(e) => setPol({ returns: e.target.value })} data-testid="shop-returns" />
                </Field>
                <Field label={__('Reversión del pago')}>
                    <Textarea value={config.policies.reversal} rows={4} maxLength={3000} placeholder={SHOP_DEFAULT_REVERSAL} onChange={(e) => setPol({ reversal: e.target.value })} />
                </Field>
                <Field label={__('Términos y condiciones (opcional)')} hint={__('Lo propio de tu tienda: garantías, horarios, cobertura…')}>
                    <Textarea value={config.policies.terms} rows={5} maxLength={8000} onChange={(e) => setPol({ terms: e.target.value })} />
                </Field>
            </SubSection>
        </PanelBody>
    );
}

// ── Pedidos ────────────────────────────────────────────────────────────

export function OrdersPanel({ shop }: { shop: ShopDto }): JSX.Element {
    const o = shop.orders;
    return (
        <PanelBody testId="shop-orders">
            {o ? (
                <>
                    <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
                        <p className="imcrm-text-[13px] imcrm-font-medium">{o.list_name}</p>
                        <p className="imcrm-mt-0.5 imcrm-text-[12px] imcrm-text-muted-foreground">
                            {shop.orders_count === 1 ? __('1 pedido hasta ahora.') : sprintf(__('%d pedidos hasta ahora.'), shop.orders_count)}{' '}
                            {__('Cada compra es un registro con su número, estado, forma de pago, total, el cliente y sus productos como líneas.')}
                        </p>
                        <Button size="sm" variant="outline" className="imcrm-mt-2 imcrm-gap-1.5" asChild>
                            <Link to={`/lists/${o.list_slug}/records`} data-testid="shop-open-orders">
                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Ver los pedidos')}
                            </Link>
                        </Button>
                    </div>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-[12.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                        <li className="imcrm-flex imcrm-gap-2">
                            <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" />
                            {__('El estado del pedido (Nuevo, En preparación, Enviado, Entregado) lo mueves tú, como cualquier registro: en tabla, kanban o con automatizaciones.')}
                        </li>
                        <li className="imcrm-flex imcrm-gap-2">
                            <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" />
                            {__('Pasarlo a «Cancelado» devuelve el stock de sus productos; sacarlo de «Cancelado» lo vuelve a descontar.')}
                        </li>
                        <li className="imcrm-flex imcrm-gap-2">
                            <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" />
                            {__('Cuando llegue una transferencia o un pago contra entrega, abre el pedido y toca «Marcar como pagado».')}
                        </li>
                        <li className="imcrm-flex imcrm-gap-2">
                            <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" />
                            {__('Las columnas que llena la tienda (total, cliente, productos…) no se editan a mano. Puedes agregar las tuyas.')}
                        </li>
                    </ul>
                    <Link to="/dashboards" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[12.5px] imcrm-text-primary hover:imcrm-underline">
                        <LayoutDashboard className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Ver el tablero de ventas')}
                    </Link>
                </>
            ) : (
                <p className="imcrm-flex imcrm-gap-2 imcrm-text-[12.5px] imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {__('La lista de pedidos de esta tienda ya no existe (se borró). Crea la tienda de nuevo para que vuelva a tener dónde guardar los pedidos.')}
                </p>
            )}
        </PanelBody>
    );
}

// ── Publicar ───────────────────────────────────────────────────────────

export function PublishPanel({
    shop,
    url,
    enabled,
    busy,
    problems,
    onTogglePublish,
    onFix,
    domains,
    onDomains,
    onRegenerate,
    regenerating,
    onDelete,
    deleting,
}: {
    shop: ShopDto;
    url: string;
    enabled: boolean;
    busy: boolean;
    problems: ShopProblem[];
    onTogglePublish: () => void;
    onFix: (p: ShopProblem) => void;
    domains: string[];
    onDomains: (v: string[]) => void;
    onRegenerate: () => void;
    regenerating: boolean;
    onDelete: () => void;
    deleting: boolean;
}): JSX.Element {
    const toast = useToast();
    const copy = (text: string, ok: string): void => {
        void navigator.clipboard.writeText(text).then(
            () => toast.success(ok),
            () => toast.error(__('No se pudo copiar')),
        );
    };
    const code = shopEmbedCode(url, shop.name);
    return (
        <PanelBody testId="shop-publish">
            {shop.suspended && (
                <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-[12.5px] imcrm-text-destructive" data-testid="shop-suspended">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <p>
                        {__('La plataforma suspendió esta tienda y no se puede publicar.')}
                        {shop.suspended_reason ? ` ${__('Motivo:')} ${shop.suspended_reason}` : ''}
                    </p>
                </div>
            )}
            <div className={cn('imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-p-3', enabled ? 'imcrm-border-success/30 imcrm-bg-success/5' : 'imcrm-border-border imcrm-bg-card')}>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-text-[13px] imcrm-font-medium">{enabled ? __('La tienda está publicada') : __('La tienda no está publicada')}</p>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{enabled ? __('Cualquiera con el enlace puede comprar.') : __('Nadie la ve todavía: el enlace muestra «no disponible».')}</p>
                </div>
                <Button size="sm" variant={enabled ? 'outline' : 'default'} onClick={onTogglePublish} disabled={busy || shop.suspended} data-testid="shop-publish-toggle">
                    {busy && <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {enabled ? __('Dejar de publicar') : __('Publicar')}
                </Button>
            </div>
            {problems.length > 0 && (
                <SubSection title={__('Lo que falta para publicarla')}>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="shop-problems">
                        {problems.map((p, i) => (
                            <li key={i}>
                                <button
                                    type="button"
                                    onClick={() => onFix(p)}
                                    className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/5 imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[12.5px] hover:imcrm-bg-warning/10"
                                >
                                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-warning" />
                                    <span className="imcrm-flex-1">{p.text}</span>
                                    <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">{__(SHOP_SECTION_INFO[p.section].label)} ›</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </SubSection>
            )}
            <SubSection title={__('Enlace de la tienda')} hint={__('Compártelo por WhatsApp, en tus redes o en tu sitio.')}>
                <div className="imcrm-flex imcrm-gap-1.5">
                    <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="imcrm-font-mono imcrm-text-[12px]" data-testid="shop-url" aria-label={__('Enlace de la tienda')} />
                    <Button variant="outline" size="icon" onClick={() => copy(url, __('Enlace copiado'))} aria-label={__('Copiar enlace')} data-testid="shop-copy-url">
                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" asChild aria-label={__('Abrir la tienda')}>
                        <a href={url} target="_blank" rel="noreferrer">
                            <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                        </a>
                    </Button>
                </div>
            </SubSection>
            <PublicQrCard url={url} name={shop.name} kind="shop" />
            <SubSection title={__('Insertar en tu sitio web')} hint={__('Pega este código en una página de tu sitio (WordPress: bloque «HTML personalizado»). La tienda se ve completa dentro de esa página.')}>
                <div className="imcrm-relative">
                    <pre className="imcrm-max-h-28 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded-lg imcrm-bg-muted imcrm-p-3 imcrm-pr-10 imcrm-font-mono imcrm-text-[11.5px]" data-testid="shop-embed-code">
                        {code}
                    </pre>
                    <Button variant="ghost" size="icon" className="imcrm-absolute imcrm-right-1 imcrm-top-1 imcrm-h-7 imcrm-w-7" onClick={() => copy(code, __('Código copiado'))} aria-label={__('Copiar el código')}>
                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
                <Field label={__('Sitios que pueden insertarla')} hint={__('Vacío = cualquier sitio. Escribe el dominio (ej.: tutienda.com) y Enter.')}>
                    <DomainChips value={domains} onChange={onDomains} testId="shop-domains" autoFocus={false} max={20} />
                </Field>
            </SubSection>
            <SubSection title={__('Zona de cuidado')}>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={onRegenerate} disabled={regenerating} data-testid="shop-regenerate">
                        {regenerating ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Cambiar el enlace')}
                    </Button>
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive" onClick={onDelete} disabled={deleting} data-testid="shop-delete">
                        {deleting ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Eliminar la tienda')}
                    </Button>
                </div>
                <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Eliminarla no borra los productos ni los pedidos: quedan en sus listas.')}</p>
            </SubSection>
        </PanelBody>
    );
}
