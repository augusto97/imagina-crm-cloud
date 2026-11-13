import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
    AlertTriangle,
    Bell,
    CalendarDays,
    Download,
    ArrowDown,
    ArrowUp,
    Banknote,
    Check,
    Code2,
    Copy,
    CreditCard,
    ExternalLink,
    Home,
    Layers,
    LayoutDashboard,
    Loader2,
    MessageCircle,
    PanelRight,
    Plus,
    QrCode,
    RefreshCw,
    Repeat,
    ShieldCheck,
    ShoppingCart,
    Trash2,
    Truck,
    Wallet,
} from 'lucide-react';
import {
    COLLECTION_PROVIDER_LABEL,
    SHOP_AFTER_ADD,
    SHOP_AFTER_ADD_LABELS,
    SHOP_CATALOG_FIELD_TYPES,
    SHOP_CATALOG_ROLE_LABELS,
    SHOP_DOWNLOAD_FIELD_TYPES,
    SHOP_KIND_FIELD_TYPES,
    SHOP_COD_DEFAULT,
    SHOP_DEFAULT_DELIVERY_TIME,
    SHOP_DEFAULT_RETURNS,
    SHOP_DEFAULT_REVERSAL,
    SHOP_MAX_DELIVERY_METHODS,
    SHOP_MAX_DELIVERY_ZONES,
    SHOP_MAX_VARIANT_ATTRIBUTES,
    SHOP_SORTS,
    SHOP_SORT_LABELS,
    SHOP_TRANSFER_DEFAULT,
    SHOP_VARIANT_ATTRIBUTE_TYPES,
    collectionCurrencyError,
    formatShopMoney,
    newShopItemId,
    shopPerUnit,
    shopQtyLabel,
    shopQtyRuleText,
    shopUnitFrom,
    shopPlanFor,
    shopServiceFor,
    subscriptionFrequencyText,
    subscriptionPlanExtras,
    type ShopAfterAdd,
    type ShopCatalogFields,
    type ShopConfig,
    type ShopDeliveryMethod,
    type ShopDeliveryZone,
    type ShopDto,
    type ShopOptions,
    type ShopProblem,
    type ShopSection,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { PanelBody, SubSection, Switch, SwitchRow } from '../widgets/widgetUi';
import { ShopVariantsSheet } from './ShopVariantsSheet';
import { useCreateShopKindColumn, useCreateShopUnitColumns } from './useShops';
import { SHOP_SECTION_INFO } from './shopEditor';

export type Patch = (fn: (c: ShopConfig) => ShopConfig) => void;

export function Field({ label, hint, children, htmlFor, tour }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; tour?: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-tour={tour}>
            <label htmlFor={htmlFor} className="imcrm-text-[12.5px] imcrm-font-medium">
                {label}
            </label>
            {children}
            {hint && <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

export function Segmented<T extends string | number>({ value, onChange, options, testId }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string]>; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-inline-flex imcrm-flex-wrap imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5" role="radiogroup" data-testid={testId}>
            {options.map(([v, label]) => (
                <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={v === value}
                    data-value={String(v)}
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
export function MoneyInput({ value, onChange, testId, placeholder }: { value: number | null; onChange: (v: number | null) => void; testId?: string; placeholder?: string }): JSX.Element {
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

const ROLE_ORDER: Array<keyof ShopCatalogFields> = ['name', 'price', 'compare_price', 'images', 'summary', 'description', 'category', 'stock', 'sku', 'active'];
/** v0.1.429 — Las columnas de las unidades de venta (en su propia sección). */
const UNIT_ROLES: Array<'unit' | 'qty_min' | 'qty_max' | 'qty_step'> = ['unit', 'qty_min', 'qty_max', 'qty_step'];

const ROLE_HINT: Partial<Record<keyof ShopCatalogFields, string>> = {
    name: 'Si no eliges uno, se usa el título de cada registro.',
    price: 'Un campo de moneda o número. Sin precio, el producto no se puede comprar.',
    compare_price: 'Opcional: si es mayor que el precio, se muestra tachado con el descuento.',
    images: 'Un campo de archivos (fotos subidas) o un enlace mostrado como imagen.',
    summary: 'Opcional: una o dos frases junto al precio (y en las tarjetas). También es lo que muestra Google del producto.',
    category: 'Arma los filtros de categoría de la tienda.',
    stock: 'Un número: cada venta lo descuenta y cancelar un pedido lo devuelve. Vacío en un producto = sin límite.',
    active: 'Una casilla: sólo se venden los marcados. Sin elegirla, se venden todos.',
    unit: 'Texto o selección: «hora», «año», «kg», «licencia». El plural se arma solo; si es especial, escríbelo así: «mes/meses». Vacía = por unidad.',
    qty_min: 'Lo mínimo que se puede comprar de ese producto (2 horas, 0,5 kg). Vacía = lo de «De a cuánto», o 1.',
    qty_max: 'Lo máximo por compra (40 horas). Vacía = sin tope, salvo el stock.',
    qty_step: 'Cuánto sube o baja la cantidad: 1, 0,5, 5… Vacía = de a 1. Con decimales, se puede comprar 1,5 kg.',
};

/**
 * v0.1.414 — Productos con variantes (talla, color…): cada variante es una
 * subtarea del producto en la lista. Aquí se eligen los atributos y se abre
 * el generador de combinaciones.
 */
function VariantsSection({ shopId, config, options, patch, onCatalogChanged }: { shopId: number; config: ShopConfig; options: ShopOptions; patch: Patch; onCatalogChanged: () => void }): JSX.Element {
    const [open, setOpen] = useState(false);
    const v = config.variants;
    const roleIds = new Set(Object.values(config.catalog).filter((x): x is number => x !== null));
    const usable = options.fields.filter((f) => (SHOP_VARIANT_ATTRIBUTE_TYPES as readonly string[]).includes(f.type) && !roleIds.has(f.id));
    const setAttrs = (attributes: number[]): void => patch((c) => ({ ...c, variants: { ...c.variants, attributes } }));
    return (
        <SubSection
            tour="shop-variants"
            title={__('Variantes')}
            hint={__('Para vender un mismo producto en varias tallas, colores o materiales. Cada variante es una subtarea del producto en la lista, con su propio precio, stock, referencia y fotos (vacíos = los del producto).')}
        >
            <SwitchRow
                label={__('Productos con variantes')}
                hint={__('Un producto con subtareas se compra eligiendo una: el precio del catálogo es el más bajo y el stock, la suma.')}
                checked={v.enabled}
                onChange={(enabled) => patch((c) => ({ ...c, variants: { ...c.variants, enabled } }))}
                testId="shop-variants-on"
            >
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="shop-variant-attrs">
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Los campos que distinguen una variante de otra (selección o texto). Sin atributos, la opción que se elige es el nombre de la subtarea.')}
                    </p>
                    {v.attributes.map((fid, i) => (
                        <div key={`${fid}-${i}`} className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Select
                                value={String(fid)}
                                onChange={(e) => setAttrs(v.attributes.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                                aria-label={sprintf(__('Atributo %d'), i + 1)}
                                data-testid="shop-variant-attr"
                            >
                                {usable
                                    .filter((f) => f.id === fid || !v.attributes.includes(f.id))
                                    .map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                            </Select>
                            <Button variant="ghost" size="icon" aria-label={__('Quitar atributo')} onClick={() => setAttrs(v.attributes.filter((_, j) => j !== i))}>
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>
                    ))}
                    {v.attributes.length < SHOP_MAX_VARIANT_ATTRIBUTES && usable.some((f) => !v.attributes.includes(f.id)) && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="imcrm-self-start"
                            onClick={() => {
                                const next = usable.find((f) => !v.attributes.includes(f.id));
                                if (next) setAttrs([...v.attributes, next.id]);
                            }}
                            data-testid="shop-variant-attr-add"
                        >
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('Agregar atributo')}
                        </Button>
                    )}
                    {usable.length === 0 && (
                        <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('La lista no tiene campos de selección o de texto libres para usar como atributo (Talla, Color…). Créalos en Configuración → Campos.')}</p>
                    )}
                    <Button variant="outline" size="sm" className="imcrm-mt-1 imcrm-self-start" onClick={() => setOpen(true)} data-testid="shop-variants-open">
                        <Layers className="imcrm-h-4 imcrm-w-4" />
                        {__('Crear variantes de un producto')}
                    </Button>
                </div>
            </SwitchRow>
            <ShopVariantsSheet shopId={shopId} attributes={v.attributes} open={open} onOpenChange={setOpen} onCreated={onCatalogChanged} />
        </SubSection>
    );
}

/**
 * v0.1.416 — Tipos de producto: físicos (lo de siempre), digitales (un
 * archivo que se descarga al pagar) y servicios (se agendan en la agenda de
 * la empresa, con el servicio ya elegido).
 */
/**
 * v0.1.429 — Unidades de venta: cada producto dice en qué se vende (hora,
 * año, kg) y cuánto se puede comprar, en sus propias columnas de la lista.
 */
function UnitsSection({
    shopId,
    config,
    roleField,
    onUnitColumns,
}: {
    shopId: number;
    config: ShopConfig;
    roleField: (role: keyof ShopCatalogFields) => JSX.Element;
    onUnitColumns: (catalog: Partial<ShopCatalogFields>) => void;
}): JSX.Element {
    const toast = useToast();
    const create = useCreateShopUnitColumns(shopId);
    const missing = UNIT_ROLES.filter((r) => config.catalog[r] === null);
    const fmt = getTenantFormat().number_format;
    // Así se ve un producto por horas: el ejemplo usa las mismas funciones que la tienda.
    const unit = shopUnitFrom('hora');
    const rule = { min: 2, max: 40, step: 1 };
    const money = (n: number): string => formatShopMoney(n, config.currency, fmt);
    const addColumns = (): void =>
        create.mutate(undefined, {
            onSuccess: (doc) => {
                const cat = ((doc.config as { catalog?: Partial<ShopCatalogFields> }).catalog ?? {}) as Partial<ShopCatalogFields>;
                onUnitColumns({ unit: cat.unit ?? null, qty_min: cat.qty_min ?? null, qty_max: cat.qty_max ?? null, qty_step: cat.qty_step ?? null });
                toast.success(__('Agregamos las columnas de unidades'), __('Llénalas en cada producto de la lista: lo que dejes vacío queda como siempre.'));
            },
            onError: (e) => toast.error(__('No se pudieron crear las columnas'), e instanceof Error ? e.message : undefined),
        });
    return (
        <SubSection
            title={__('Unidades y cantidades')}
            hint={__('Para vender por hora, por año, por kg o por licencia. Cada producto decide su unidad, su mínimo, su máximo y de a cuánto se compra en sus propias columnas de la lista. Lo que quede vacío es lo de siempre: por unidad, desde 1 y de a 1. En una variante, vacío = lo de su producto.')}
            testId="shop-units"
            tour="shop-units"
        >
            {missing.length > 0 && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-2.5">
                    <p className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-[12px] imcrm-text-muted-foreground">
                        {missing.length === UNIT_ROLES.length
                            ? __('Crea las columnas «Unidad de venta», «Cantidad mínima», «Cantidad máxima» y «De a cuánto» en la lista y quedan elegidas aquí.')
                            : __('Crea en la lista las columnas que faltan y quedan elegidas aquí.')}
                    </p>
                    <Button size="sm" variant="outline" onClick={addColumns} disabled={create.isPending} data-testid="shop-units-create">
                        {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {missing.length === UNIT_ROLES.length ? __('Crear las columnas') : __('Crear las que faltan')}
                    </Button>
                </div>
            )}
            {UNIT_ROLES.map((r) => roleField(r))}
            {unit && (
                <div className="imcrm-rounded-lg imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2.5 imcrm-text-[12px]" data-testid="shop-units-example">
                    <p className="imcrm-mb-1 imcrm-font-medium">{__('Así se ve un producto con «hora», mínimo 2 y máximo 40:')}</p>
                    <p>
                        <strong>{money(50000)}</strong>
                        <span className="imcrm-text-muted-foreground">{shopPerUnit(unit)}</span>
                        {' · '}
                        {shopQtyLabel(unit)}: 2
                    </p>
                    <p className="imcrm-text-muted-foreground">{shopQtyRuleText(rule, unit, fmt)}</p>
                </div>
            )}
        </SubSection>
    );
}

function KindsSection({
    shopId,
    config,
    options,
    patch,
    onKindColumn,
}: {
    shopId: number;
    config: ShopConfig;
    options: ShopOptions;
    patch: Patch;
    onKindColumn: (role: 'kind' | 'download', fieldId: number | null) => void;
}): JSX.Element {
    const toast = useToast();
    const k = config.kinds;
    const setK = (p: Partial<ShopConfig['kinds']>): void => patch((c) => ({ ...c, kinds: { ...c.kinds, ...p } }));
    const create = useCreateShopKindColumn(shopId);
    const roleIds = new Set<number>([...Object.values(config.catalog).filter((x): x is number => x !== null), ...config.variants.attributes]);
    const kindFields = options.fields.filter((f) => (SHOP_KIND_FIELD_TYPES as readonly string[]).includes(f.type) && (!roleIds.has(f.id) || f.id === k.kind_field));
    const fileFields = options.fields.filter((f) => (SHOP_DOWNLOAD_FIELD_TYPES as readonly string[]).includes(f.type) && (!roleIds.has(f.id) || f.id === k.download_field));
    const counts = options.kind_counts;
    const page = options.booking_pages.find((p) => p.id === k.booking_page_id) ?? null;
    const services = page?.services.filter((sv) => sv.active) ?? [];
    const addColumn = (role: 'kind' | 'download'): void =>
        create.mutate(role, {
            onSuccess: (doc) => {
                const kinds = (doc.config as { kinds?: { kind_field?: number | null; download_field?: number | null } }).kinds ?? {};
                onKindColumn(role, (role === 'kind' ? kinds.kind_field : kinds.download_field) ?? null);
                toast.success(role === 'kind' ? __('Agregamos la columna «Tipo de producto»') : __('Agregamos la columna «Archivo para descargar»'), __('Complétala en la lista de productos.'));
            },
            onError: (e) => toast.error(__('No se pudo crear la columna'), e instanceof Error ? e.message : undefined),
        });
    const summary = [
        counts.physical > 0 ? (counts.physical === 1 ? __('1 físico') : sprintf(__('%d físicos'), counts.physical)) : '',
        counts.digital > 0 ? (counts.digital === 1 ? __('1 digital') : sprintf(__('%d digitales'), counts.digital)) : '',
        counts.service > 0 ? (counts.service === 1 ? __('1 servicio') : sprintf(__('%d servicios'), counts.service)) : '',
        counts.subscription > 0 ? (counts.subscription === 1 ? __('1 suscripción') : sprintf(__('%d suscripciones'), counts.subscription)) : '',
    ].filter(Boolean);
    // v0.1.417 — Los planes que sirven: los de la moneda de la tienda.
    const plans = options.subscription_plans.filter((pl) => pl.currency.toUpperCase() === config.currency.toUpperCase());
    const otherCurrency = options.subscription_plans.length - plans.length;
    const fmtPlan = (pl: (typeof plans)[number]): string => {
        const extras = subscriptionPlanExtras({ trial_days: pl.trial_days, cycles: pl.cycles });
        return `${subscriptionFrequencyText(pl.frequency, pl.frequency_type)}${extras ? ` · ${extras}` : ''} · ${pl.provider === 'paypal' ? 'PayPal' : 'Mercado Pago'}`;
    };
    return (
        <SubSection
            title={__('Tipos de producto')}
            hint={__('Además de productos físicos, puedes vender descargas (un PDF, una plantilla, un curso), servicios que se agendan y suscripciones que se cobran solas cada mes.')}
            testId="shop-kinds"
            tour="shop-kinds"
        >
            {summary.length > 0 && <p className="imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="shop-kind-counts">{summary.join(' · ')}</p>}
            <Field
                label={__('Columna con el tipo')}
                htmlFor="shop-kind-field"
                hint={__('Una selección con Físico, Digital, Servicio y Suscripción. Sin columna, todo es físico salvo lo que tenga un archivo para descargar.')}
            >
                <Select id="shop-kind-field" value={k.kind_field === null ? '' : String(k.kind_field)} onChange={(e) => setK({ kind_field: e.target.value === '' ? null : Number(e.target.value) })} data-testid="shop-kind-field">
                    <option value="">{__('Ninguna')}</option>
                    {kindFields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                {k.kind_field === null && (
                    <Button variant="outline" size="sm" className="imcrm-self-start" onClick={() => addColumn('kind')} disabled={create.isPending} data-testid="shop-kind-create">
                        {create.isPending && create.variables === 'kind' ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Plus className="imcrm-h-4 imcrm-w-4" />}
                        {__('Crear la columna «Tipo de producto»')}
                    </Button>
                )}
            </Field>
            <Field label={__('Archivo para descargar')} htmlFor="shop-download-field" hint={__('Lo que recibe quien compra al confirmarse el pago: le llega por correo y lo baja desde su pedido.')}>
                <Select id="shop-download-field" value={k.download_field === null ? '' : String(k.download_field)} onChange={(e) => setK({ download_field: e.target.value === '' ? null : Number(e.target.value) })} data-testid="shop-download-field">
                    <option value="">{__('Ninguno')}</option>
                    {fileFields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                {k.download_field === null && (
                    <Button variant="outline" size="sm" className="imcrm-self-start" onClick={() => addColumn('download')} disabled={create.isPending} data-testid="shop-download-create">
                        {create.isPending && create.variables === 'download' ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Download className="imcrm-h-4 imcrm-w-4" />}
                        {__('Crear la columna «Archivo para descargar»')}
                    </Button>
                )}
            </Field>
            {(k.download_field !== null || counts.digital > 0) && (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2" data-testid="shop-download-rules">
                    <Field label={__('Días para descargar')} htmlFor="shop-download-days" hint={__('Contados desde el pago.')}>
                        <Input
                            id="shop-download-days"
                            type="number"
                            min={1}
                            max={365}
                            value={k.download_days}
                            onChange={(e) => setK({ download_days: Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1))) })}
                            className="imcrm-w-28"
                            data-testid="shop-download-days"
                        />
                    </Field>
                    <Field label={__('Descargas por archivo')} htmlFor="shop-max-downloads" hint={__('Para que el enlace no se reparta.')}>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                            <Input
                                id="shop-max-downloads"
                                type="number"
                                min={1}
                                max={100}
                                disabled={k.max_downloads === null}
                                value={k.max_downloads ?? ''}
                                onChange={(e) => setK({ max_downloads: Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))) })}
                                className="imcrm-w-24"
                                data-testid="shop-max-downloads"
                            />
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[12.5px]">
                                <input
                                    type="checkbox"
                                    checked={k.max_downloads === null}
                                    onChange={(e) => setK({ max_downloads: e.target.checked ? null : 5 })}
                                    className="imcrm-accent-[hsl(var(--imcrm-primary))]"
                                    data-testid="shop-unlimited-downloads"
                                />
                                {__('Sin límite')}
                            </label>
                        </div>
                    </Field>
                </div>
            )}
            <Field
                label={__('Agenda de los servicios')}
                htmlFor="shop-booking-page"
                hint={__('Un producto de tipo servicio no va al carrito: su botón «Agendar» lleva a esta agenda con el servicio ya elegido. Ahí se cobra, si la agenda cobra.')}
            >
                <Select id="shop-booking-page" value={k.booking_page_id === null ? '' : String(k.booking_page_id)} onChange={(e) => setK({ booking_page_id: e.target.value === '' ? null : Number(e.target.value) })} data-testid="shop-booking-page">
                    <option value="">{__('Ninguna')}</option>
                    {options.booking_pages.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                            {p.enabled ? '' : ` · ${__('sin publicar')}`}
                        </option>
                    ))}
                </Select>
                {options.booking_pages.length === 0 && <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('No tienes agendas. Créala desde la configuración de una lista → Agenda.')}</p>}
                {page && !page.enabled && (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11.5px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        {__('Esa agenda no está publicada: los servicios se verán sin el botón para agendar.')}
                    </p>
                )}
            </Field>
            {counts.service > 0 && !page && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[12px] imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="shop-services-no-agenda">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {__('Tienes servicios en el catálogo: elige la agenda donde se reservan.')}
                </p>
            )}
            {page && options.service_products.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="shop-service-links">
                    <p className="imcrm-text-[12px] imcrm-font-medium">{__('Qué servicio de la agenda es cada producto')}</p>
                    {options.service_products.map((sp) => {
                        const linked = k.service_links[String(sp.id)] ?? '';
                        const resolved = shopServiceFor({ id: sp.id, title: sp.title }, k.service_links, services);
                        const byName = linked === '' && resolved ? services.find((sv) => sv.id === resolved)?.name : null;
                        return (
                            <div key={sp.id} className="imcrm-grid imcrm-grid-cols-1 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2 sm:imcrm-grid-cols-[1fr_1fr]">
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-[12.5px]">
                                    <CalendarDays className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    <span className="imcrm-truncate">{sp.title || `#${sp.id}`}</span>
                                </span>
                                <Select
                                    value={linked}
                                    aria-label={sprintf(__('Servicio de «%s»'), sp.title)}
                                    onChange={(e) =>
                                        patch((c) => {
                                            const links = { ...c.kinds.service_links };
                                            if (e.target.value === '') delete links[String(sp.id)];
                                            else links[String(sp.id)] = e.target.value;
                                            return { ...c, kinds: { ...c.kinds, service_links: links } };
                                        })
                                    }
                                    className={cn(!resolved && 'imcrm-border-amber-500/60')}
                                    data-testid="shop-service-link"
                                >
                                    <option value="">{byName ? sprintf(__('El del mismo nombre: %s'), byName) : __('Sin servicio (elige uno)')}</option>
                                    {services.map((sv) => (
                                        <option key={sv.id} value={sv.id}>
                                            {sv.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        );
                    })}
                </div>
            )}
            {(counts.subscription > 0 || options.subscription_products.length > 0) && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="shop-subscription-links">
                    <p className="imcrm-text-[12px] imcrm-font-medium">{__('Qué plan de suscripción usa cada producto')}</p>
                    <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Una suscripción no va al carrito: «Suscribirme» la contrata y se cobra sola con débito automático. Lo que se cobra cada período es el precio del producto; del plan salen cada cuánto, los días gratis y la cantidad de cobros.')}
                    </p>
                    {plans.length === 0 && (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11.5px] imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="shop-subscription-no-plans">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            <span>
                                {otherCurrency > 0
                                    ? sprintf(__('Tus planes de suscripción no están en %s, la moneda de la tienda.'), config.currency)
                                    : __('No tienes planes de suscripción activos de una cuenta de Mercado Pago o PayPal del equipo.')}{' '}
                                <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                    {__('Créalos en Ajustes → Integraciones → Cobros')}
                                </Link>
                            </span>
                        </p>
                    )}
                    {options.subscription_products.map((sp) => {
                        const linked = k.subscription_links[String(sp.id)] ?? null;
                        const resolved = shopPlanFor({ id: sp.id, title: sp.title }, k.subscription_links, plans, config.currency);
                        const plan = plans.find((pl) => pl.id === resolved) ?? null;
                        const byName = linked === null && plan ? plan.name : null;
                        return (
                            <div
                                key={sp.id}
                                className="imcrm-grid imcrm-grid-cols-1 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2 sm:imcrm-grid-cols-[1fr_1fr]"
                                data-testid="shop-subscription-row"
                            >
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-[12.5px]">
                                        <Repeat className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                        <span className="imcrm-truncate">{sp.title || `#${sp.id}`}</span>
                                    </span>
                                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {sp.price === null ? __('Sin precio') : formatShopMoney(sp.price, config.currency, getTenantFormat().number_format)}
                                        {plan ? ` ${fmtPlan(plan)}` : ''}
                                    </span>
                                </span>
                                <Select
                                    value={linked === null ? '' : String(linked)}
                                    aria-label={sprintf(__('Plan de «%s»'), sp.title)}
                                    onChange={(e) =>
                                        patch((c) => {
                                            const links = { ...c.kinds.subscription_links };
                                            if (e.target.value === '') delete links[String(sp.id)];
                                            else links[String(sp.id)] = Number(e.target.value);
                                            return { ...c, kinds: { ...c.kinds, subscription_links: links } };
                                        })
                                    }
                                    className={cn(!plan && 'imcrm-border-amber-500/60')}
                                    data-testid="shop-subscription-link"
                                >
                                    <option value="">{byName ? sprintf(__('El del mismo nombre: %s'), byName) : __('Sin plan (elige uno)')}</option>
                                    {plans.map((pl) => (
                                        <option key={pl.id} value={pl.id}>
                                            {pl.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        );
                    })}
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-[12.5px]">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                            checked={k.subscription_address}
                            onChange={(e) => setK({ subscription_address: e.target.checked })}
                            data-testid="shop-subscription-address"
                        />
                        <span>
                            {__('Pedir la dirección de entrega al suscribirse')}
                            <span className="imcrm-block imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Para una caja o un producto que llega cada período.')}</span>
                        </span>
                    </label>
                </div>
            )}
        </SubSection>
    );
}

export function CatalogPanel({
    shopId,
    config,
    options,
    patch,
    onCatalogChanged,
    onKindColumn,
    onUnitColumns,
}: {
    shopId: number;
    config: ShopConfig;
    options: ShopOptions;
    patch: Patch;
    onCatalogChanged: () => void;
    onKindColumn: (role: 'kind' | 'download', fieldId: number | null) => void;
    onUnitColumns: (catalog: Partial<ShopCatalogFields>) => void;
}): JSX.Element {
    const set = (role: keyof ShopCatalogFields, id: number | null): void => patch((c) => ({ ...c, catalog: { ...c.catalog, [role]: id } }));
    const taken = new Map<number, keyof ShopCatalogFields>();
    for (const r of [...ROLE_ORDER, ...UNIT_ROLES]) {
        const v = config.catalog[r];
        if (v !== null) taken.set(v, r);
    }
    const roleField = (role: keyof ShopCatalogFields): JSX.Element => {
                const types = SHOP_CATALOG_FIELD_TYPES[role];
                const fields = options.fields.filter((f) => (types as readonly string[]).includes(f.type));
                const value = config.catalog[role];
                const missingPrice = role === 'price' && value === null;
                // v0.1.420 — La descripción también puede ser el documento del registro.
                const fromDoc = role === 'description' && config.description_from === 'record';
                return (
                    <Field
                        key={role}
                        label={__(SHOP_CATALOG_ROLE_LABELS[role])}
                        hint={
                            fromDoc
                                ? __('Se muestra con su formato: títulos, listas, tablas e imágenes. La editas en la «Descripción» de cada registro.')
                                : ROLE_HINT[role]
                                  ? __(ROLE_HINT[role]!)
                                  : undefined
                        }
                        htmlFor={`shop-role-${role}`}
                        tour={`shop-role-${role}`}
                    >
                        <Select
                            id={`shop-role-${role}`}
                            value={fromDoc ? 'record' : value === null ? '' : String(value)}
                            onChange={(e) => {
                                if (role !== 'description') return set(role, e.target.value === '' ? null : Number(e.target.value));
                                const v = e.target.value;
                                patch((c) => ({
                                    ...c,
                                    description_from: v === 'record' ? 'record' : 'field',
                                    catalog: { ...c.catalog, description: v === '' || v === 'record' ? null : Number(v) },
                                }));
                            }}
                            className={cn(missingPrice && 'imcrm-border-destructive/60')}
                            data-testid={`shop-role-${role}`}
                        >
                            <option value="">{role === 'name' ? __('El título del registro') : role === 'active' ? __('Se venden todos') : role === 'stock' ? __('Sin control de stock') : __('Ninguno')}</option>
                            {role === 'description' && <option value="record">{__('La descripción del registro (con formato)')}</option>}
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
                        {fields.length === 0 && role !== 'name' && role !== 'description' && (
                            <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                                {sprintf(__('La lista no tiene un campo de este tipo. Créalo en Configuración → Campos.'))}
                            </p>
                        )}
                    </Field>
                );
            };
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
            {ROLE_ORDER.map((role) => roleField(role))}
            <VariantsSection shopId={shopId} config={config} options={options} patch={patch} onCatalogChanged={onCatalogChanged} />
            <UnitsSection shopId={shopId} config={config} roleField={roleField} onUnitColumns={onUnitColumns} />
            <KindsSection shopId={shopId} config={config} options={options} patch={patch} onKindColumn={onKindColumn} />
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

const AFTER_ADD_INFO: Record<ShopAfterAdd, { icon: typeof Bell; hint: string }> = {
    toast: { icon: Bell, hint: 'Sale un aviso con «Ver carrito» y la persona sigue viendo productos.' },
    drawer: { icon: PanelRight, hint: 'El carrito se abre al costado con lo que agregó marcado. Recomendado.' },
    cart: { icon: ShoppingCart, hint: 'Pasa a una página con el carrito completo y el total.' },
    checkout: { icon: CreditCard, hint: 'Pasa directo a pagar: para tiendas de un producto o compras rápidas.' },
};

/** v0.1.421 — Qué pasa al agregar al carrito. */
function AfterAddChoice({ value, onChange }: { value: ShopAfterAdd; onChange: (v: ShopAfterAdd) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" role="radiogroup" aria-label={__('Al agregar al carrito')} data-testid="shop-after-add">
            {SHOP_AFTER_ADD.map((v) => {
                const info = AFTER_ADD_INFO[v];
                const Icon = info.icon;
                const on = v === value;
                return (
                    <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(v)}
                        data-testid={`shop-after-add-${v}`}
                        className={cn(
                            'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-transition-colors',
                            on ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-muted/50',
                        )}
                    >
                        <span className={cn('imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg', on ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-bg-muted imcrm-text-muted-foreground')}>
                            <Icon className="imcrm-h-4 imcrm-w-4" />
                        </span>
                        <span className="imcrm-min-w-0">
                            <span className="imcrm-block imcrm-text-[13px] imcrm-font-medium">{__(SHOP_AFTER_ADD_LABELS[v])}</span>
                            <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{__(info.hint)}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

export function DesignPanel({ config, patch, onJump }: { config: ShopConfig; options?: ShopOptions; patch: Patch; onJump?: (section: ShopSection, tour: string) => void }): JSX.Element {
    const d = config.display;
    const setD = (p: Partial<ShopConfig['display']>): void => patch((c) => ({ ...c, display: { ...c.display, ...p } }));
    const setT = (p: Partial<ShopConfig['texts']>): void => patch((c) => ({ ...c, texts: { ...c.texts, ...p } }));
    return (
        <PanelBody testId="shop-design">
            <SubSection title={__('Productos')} tour="shop-design-grid">
                <Field label={__('Por fila (en computador)')} hint={__('En el celular siempre van de a dos.')}>
                    <Segmented value={d.columns} onChange={(columns) => setD({ columns })} options={[[2, '2'], [3, '3'], [4, '4']]} testId="shop-columns" />
                </Field>
                {/* v0.1.428 — La forma, las esquinas y el borde de las fotos viven en Estilo. */}
                <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="shop-design-images-moved">
                    {__('La forma, las esquinas y el borde de las fotos están en Estilo → Fotos de los productos.')}{' '}
                    {onJump && (
                        <button type="button" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline" onClick={() => onJump('style', 'shop-style-images')} data-testid="shop-design-images-go">
                            {__('Ir ahí')}
                        </button>
                    )}
                </p>
                <Field label={__('Cuántas quedan')} tour="shop-design-stock">
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
                <SwitchRow
                    label={__('Descripción corta en las tarjetas')}
                    hint={config.catalog.summary === null ? __('Elige la columna de la descripción corta en Productos.') : __('Dos renglones bajo el nombre.')}
                    checked={d.show_summary}
                    disabled={config.catalog.summary === null}
                    onChange={(v) => setD({ show_summary: v })}
                    testId="shop-show-summary"
                />
                <SwitchRow label={__('Mostrar la referencia (SKU)')} checked={d.show_sku} onChange={(v) => setD({ show_sku: v })} />
                <SwitchRow label={__('Ocultar los agotados')} hint={__('Si no, se ven apagados con «Agotado».')} checked={d.hide_sold_out} onChange={(v) => setD({ hide_sold_out: v })} />
            </SubSection>
            <SubSection title={__('Buscar y ordenar')} tour="shop-design-browse">
                <Field label={__('Orden')}>
                    <Select value={d.sort} onChange={(e) => setD({ sort: e.target.value as ShopConfig['display']['sort'] })} data-testid="shop-sort">
                        {SHOP_SORTS.map((s) => (
                            <option key={s} value={s}>
                                {__(SHOP_SORT_LABELS[s])}
                            </option>
                        ))}
                    </Select>
                </Field>
                <SwitchRow label={__('Buscador')} checked={d.show_search} onChange={(v) => setD({ show_search: v })} />
                <SwitchRow label={__('Filtros por categoría')} hint={__('Salen del campo de categoría de los productos.')} checked={d.show_categories} onChange={(v) => setD({ show_categories: v })} />
            </SubSection>
            <SubSection title={__('Al agregar al carrito')} hint={__('Qué ve la persona después de tocar «Agregar al carrito».')} tour="shop-design-after-add">
                <AfterAddChoice value={d.after_add} onChange={(after_add) => setD({ after_add })} />
                {d.after_add === 'checkout' && config.texts.add_to_cart === 'Agregar al carrito' && (
                    <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground" data-testid="shop-after-add-hint">
                        {__('Como va directo al pago, quizás quieras que el botón diga «Comprar».')}{' '}
                        <button type="button" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline" onClick={() => setT({ add_to_cart: 'Comprar' })}>
                            {__('Cambiarlo')}
                        </button>
                    </p>
                )}
                <SwitchRow
                    label={__('Botón «Comprar ahora» en el producto')}
                    hint={d.after_add === 'checkout' ? __('No hace falta: agregar ya lleva al pago.') : __('Al lado de «Agregar al carrito»: lo agrega y va directo a pagar.')}
                    checked={d.buy_now && d.after_add !== 'checkout'}
                    disabled={d.after_add === 'checkout'}
                    onChange={(v) => setD({ buy_now: v })}
                    testId="shop-buy-now-toggle"
                />
            </SubSection>
            <SubSection title={__('Textos de los botones')} tour="shop-design-texts">
                <Field label={__('Agregar al carrito')}>
                    <Input value={config.texts.add_to_cart} maxLength={40} onChange={(e) => setT({ add_to_cart: e.target.value })} data-testid="shop-text-add" />
                </Field>
                {d.buy_now && d.after_add !== 'checkout' && (
                    <Field label={__('Comprar ahora')}>
                        <Input value={config.texts.buy_now} maxLength={40} onChange={(e) => setT({ buy_now: e.target.value })} />
                    </Field>
                )}
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
            <div className="imcrm-mt-2 imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <Input value={d.eta} maxLength={80} placeholder={__('Tiempo de entrega (ej.: 2 a 4 días hábiles)')} onChange={(e) => onChange({ ...d, eta: e.target.value })} aria-label={__('Tiempo de entrega')} data-testid="shop-delivery-eta" />
                <MoneyInput value={d.free_over} onChange={(v) => onChange({ ...d, free_over: v !== null && v > 0 ? v : null })} placeholder={__('Envío gratis desde (opcional)')} testId="shop-delivery-free" />
            </div>
            {d.needs_address && <ZonesEditor d={d} onChange={onChange} />}
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

/** v0.1.415 — Zonas de envío: cada una con su costo (y su «gratis desde»). */
function ZonesEditor({ d, onChange }: { d: ShopDeliveryMethod; onChange: (d: ShopDeliveryMethod) => void }): JSX.Element {
    const setZones = (zones: ShopDeliveryZone[]): void => onChange({ ...d, zones });
    const add = (): void =>
        setZones([...d.zones, { id: newShopItemId(d.zones.map((z) => z.id)), name: '', price: d.price, free_over: null, eta: '', active: true }]);
    return (
        <div className="imcrm-mt-3 imcrm-rounded-lg imcrm-bg-muted/40 imcrm-p-2.5" data-testid="shop-zones">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-text-[12.5px] imcrm-font-medium">{__('Zonas de envío')}</p>
                    <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">
                        {d.zones.length === 0
                            ? __('Opcional: cobra distinto según a dónde se envía (tu ciudad, el área metropolitana, el resto del país).')
                            : __('Tu cliente elige a dónde enviamos y paga el costo de esa zona.')}
                    </p>
                </div>
                <Button variant="outline" size="sm" className="imcrm-h-7 imcrm-shrink-0 imcrm-gap-1 imcrm-text-xs" disabled={d.zones.length >= SHOP_MAX_DELIVERY_ZONES} onClick={add} data-testid="shop-zone-add">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar zona')}
                </Button>
            </div>
            {d.zones.length > 0 && (
                <div className="imcrm-mt-2 imcrm-space-y-2">
                    {d.zones.map((z) => {
                        const setZ = (patch: Partial<ShopDeliveryZone>): void => setZones(d.zones.map((x) => (x.id === z.id ? { ...x, ...patch } : x)));
                        return (
                            <div key={z.id} className={cn('imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2', !z.active && 'imcrm-opacity-70')} data-testid="shop-zone">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <Input value={z.name} maxLength={80} placeholder={__('Zona (ej.: Bogotá)')} onChange={(e) => setZ({ name: e.target.value })} aria-label={__('Nombre de la zona')} data-testid="shop-zone-name" />
                                    <div className="imcrm-w-28 imcrm-shrink-0">
                                        <MoneyInput value={z.price} onChange={(v) => setZ({ price: v ?? 0 })} placeholder={__('Costo')} testId="shop-zone-price" />
                                    </div>
                                    <Switch checked={z.active} onChange={(active) => setZ({ active })} label={__('Activa')} />
                                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0" onClick={() => setZones(d.zones.filter((x) => x.id !== z.id))} aria-label={__('Quitar la zona')}>
                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </Button>
                                </div>
                                <div className="imcrm-mt-1.5 imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                                    <Input value={z.eta} maxLength={80} placeholder={__('Tiempo de entrega (opcional)')} onChange={(e) => setZ({ eta: e.target.value })} aria-label={__('Tiempo de entrega de la zona')} />
                                    <MoneyInput value={z.free_over} onChange={(v) => setZ({ free_over: v !== null && v > 0 ? v : null })} placeholder={__('Gratis desde (opcional)')} />
                                </div>
                            </div>
                        );
                    })}
                    <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Con zonas, el costo de arriba deja de usarse: vale el de la zona que elija tu cliente.')}</p>
                </div>
            )}
        </div>
    );
}

/** Cuánto queda apartado el stock mientras quien compra paga en línea. */
const SHOP_HOLD_OPTIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

function holdLabel(m: number): string {
    if (m < 60) return sprintf(__('%d minutos'), m);
    const h = m / 60;
    return h === 1 ? __('1 hora') : Number.isInteger(h) ? sprintf(__('%d horas'), h) : sprintf(__('%d minutos'), m);
}

/** «PayPal · Prueba (sandbox)» ya dice el proveedor: no se repite. */
function connectionLabel(name: string, provider: string, test: boolean): string {
    const lower = name.toLowerCase();
    let label = lower.includes(provider.toLowerCase()) ? name : `${name} · ${provider}`;
    if (test && !lower.includes('prueba')) label += ` (${__('prueba')})`;
    return label;
}

/**
 * v0.1.420 — ¿Hay algo que se entrega? Con tipos de producto y sólo digitales,
 * servicios o suscripciones, la tienda no pide formas de entrega (lo mismo
 * decide el servidor al publicar). Sin productos o sin tipos: sí.
 */
export function catalogNeedsDelivery(options: ShopOptions): boolean {
    const k = options.kind_counts;
    const total = k.physical + k.digital + k.service + k.subscription;
    return total === 0 || k.physical > 0;
}

export function PaymentPanel({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const p = config.payments;
    const setP = <K extends keyof ShopConfig['payments']>(k: K, v: Partial<ShopConfig['payments'][K]>): void =>
        patch((c) => ({ ...c, payments: { ...c.payments, [k]: { ...c.payments[k], ...v } } }));
    const setDelivery = (fn: (d: ShopDeliveryMethod[]) => ShopDeliveryMethod[]): void => patch((c) => ({ ...c, delivery: fn(c.delivery) }));
    const team = options.payment_connections ?? [];
    const conn = team.find((c) => c.id === p.online.connection_id) ?? null;
    const currencyProblem = conn ? collectionCurrencyError(conn.provider, config.currency) : null;
    const holds = SHOP_HOLD_OPTIONS.includes(p.online.hold_minutes) ? SHOP_HOLD_OPTIONS : [...SHOP_HOLD_OPTIONS, p.online.hold_minutes].sort((a, b) => a - b);
    return (
        <PanelBody testId="shop-payment">
            <SubSection title={__('Cómo te pagan')} hint={__('Puedes activar varias: quien compra elige una.')} tour="shop-payments">
                <SwitchRow
                    boxed
                    icon={CreditCard}
                    label={__('Pago en línea')}
                    hint={__('Con tarjeta, PSE, Nequi o PayPal, con la cuenta de cobro de la empresa: el dinero llega a esa cuenta y el pedido queda pagado solo.')}
                    checked={p.online.enabled}
                    onChange={(enabled) =>
                        setP('online', { enabled, ...(enabled && p.online.connection_id === null && team.length === 1 ? { connection_id: team[0]!.id } : {}) })
                    }
                    testId="shop-pay-online"
                >
                    {team.length === 0 ? (
                        <p className="imcrm-text-[12px] imcrm-leading-snug imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="shop-online-no-connection">
                            {__('No hay una cuenta de cobro del equipo (Mercado Pago, Wompi o PayPal).')}{' '}
                            <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                {__('Conéctala en Ajustes → Integraciones')}
                            </Link>
                        </p>
                    ) : (
                        <Field label={__('Con qué cuenta se cobra')} hint={__('Sólo las cuentas del equipo. Una cuenta privada de alguien no aparece aquí.')}>
                            <Select
                                value={p.online.connection_id ?? ''}
                                onChange={(e) => setP('online', { connection_id: e.target.value ? Number(e.target.value) : null })}
                                data-testid="shop-online-connection"
                            >
                                <option value="">{__('Elige una cuenta…')}</option>
                                {team.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {connectionLabel(c.name, COLLECTION_PROVIDER_LABEL[c.provider], c.test_mode)}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                    {currencyProblem && (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[12px] imcrm-leading-snug imcrm-text-destructive" data-testid="shop-online-currency">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            {sprintf(__('%s Cambia la moneda en Catálogo o elige otra cuenta.'), currencyProblem)}
                        </p>
                    )}
                    <Field
                        label={__('Cuánto tiempo tiene para pagar')}
                        hint={__('Mientras tanto el stock queda apartado. Si no paga a tiempo, el pedido se cancela solo y el stock vuelve. Si el pago llega tarde y queda stock, el pedido se reactiva.')}
                    >
                        <Select value={p.online.hold_minutes} onChange={(e) => setP('online', { hold_minutes: Number(e.target.value) })} data-testid="shop-online-hold">
                            {holds.map((m) => (
                                <option key={m} value={m}>
                                    {holdLabel(m)}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </SwitchRow>
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
                tour="shop-delivery"
                title={__('Cómo reciben el pedido')}
                hint={__('El costo de cada una se suma al total; con «Envío gratis desde» no se cobra cuando la compra llega a ese monto. Una entrega a domicilio pide la dirección; recoger en el local, no.')}
                action={
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs"
                        disabled={config.delivery.length >= SHOP_MAX_DELIVERY_METHODS}
                        onClick={() =>
                            setDelivery((list) => [
                                ...list,
                                { id: newShopItemId(list.map((d) => d.id)), name: '', description: '', price: 0, needs_address: true, active: true, eta: '', free_over: null, zones: [] },
                            ])
                        }
                        data-testid="shop-delivery-add"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar')}
                    </Button>
                }
            >
                {!catalogNeedsDelivery(options) ? (
                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="shop-delivery-not-needed">
                        {__('Tus productos son digitales, servicios o suscripciones: no se envían, así que no hace falta configurar la entrega. Si después agregas productos físicos, configura aquí cómo se entregan.')}
                    </p>
                ) : (
                    config.delivery.length === 0 && <p className="imcrm-text-[12px] imcrm-text-destructive">{__('Agrega al menos una forma de entrega.')}</p>
                )}
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
            <SubSection title={__('Quién vende')} tour="shop-seller">
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
            <SubSection title={__('Políticas')} tour="shop-policies">
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
    onShare,
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
    /** v0.1.419 — Abre «Compartir» (el enlace y el QR, o insertar en tu sitio). */
    onShare: (tab: 'link' | 'embed' | 'qr') => void;
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
            <SubSection title={__('Compartir e insertar')} hint={__('El código QR para imprimir, y el código para ponerla en tu sitio web: dentro de una página, en una ventana al tocar un botón o con un botón flotante. También botones «Comprar» de cada producto.')}>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                    <Button variant="outline" size="sm" className="imcrm-justify-start imcrm-gap-1.5" onClick={() => onShare('qr')} data-testid="shop-open-qr">
                        <QrCode className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Código QR')}
                    </Button>
                    <Button variant="outline" size="sm" className="imcrm-justify-start imcrm-gap-1.5" onClick={() => onShare('embed')} data-testid="shop-open-embed">
                        <Code2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Insertar en tu sitio')}
                    </Button>
                </div>
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
