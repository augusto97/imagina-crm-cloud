import { useState } from 'react';
import { Check as CheckIcon, Copy, ExternalLink, Loader2, Megaphone } from 'lucide-react';
import { googleAdsIdFromSendTo, parseGoogleAdsSendTo, parseGoogleTagId, parseMetaPixelId, readShopConfig, type ShopConfig, type ShopDto } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

import { PanelBody, SubSection, SwitchRow } from '../widgets/widgetUi';
import { useCreateShopOriginColumns } from './useShops';

type Patch = (fn: (c: ShopConfig) => ShopConfig) => void;

const EVENTS: ReadonlyArray<{ name: string; when: string; meta: string }> = [
    { name: 'view_item', when: 'Abre un producto', meta: 'ViewContent' },
    { name: 'add_to_cart', when: 'Lo agrega al carrito', meta: 'AddToCart' },
    { name: 'begin_checkout', when: 'Empieza la compra', meta: 'InitiateCheckout' },
    { name: 'purchase', when: 'Hace el pedido (o lo paga en línea)', meta: 'Purchase' },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <label className="imcrm-text-[12.5px] imcrm-font-medium">{label}</label>
            {children}
            {hint && <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

/**
 * v0.1.418 (addendum ADR-S103) — «Medir conversiones» de la tienda: los
 * eventos de comercio electrónico que recibe el sitio (Tag Manager sin
 * configurar nada), la etiqueta de Google Ads de la compra, el píxel de Meta,
 * las etiquetas del enlace directo y las columnas de origen de los pedidos.
 */
export function ShopMeasurePanel({ shop, config, patch }: { shop: ShopDto; config: ShopConfig; patch: Patch }): JSX.Element {
    const c = config.conversion;
    const set = (p: Partial<ShopConfig['conversion']>): void => patch((x) => ({ ...x, conversion: { ...x.conversion, ...p } }));
    const toast = useToast();
    const [adsRaw, setAdsRaw] = useState(c.google_ads ?? '');
    const [gaRaw, setGaRaw] = useState(c.google_tag_id ?? '');
    const [pixelRaw, setPixelRaw] = useState(c.meta_pixel_id ?? '');
    const [copied, setCopied] = useState<string | null>(null);
    const createCols = useCreateShopOriginColumns(shop.id);

    const adsParsed = adsRaw.trim() === '' ? null : parseGoogleAdsSendTo(adsRaw);
    const adsBad = adsRaw.trim() !== '' && adsParsed === null;
    const gaParsed = gaRaw.trim() === '' ? null : parseGoogleTagId(gaRaw);
    const gaBad = gaRaw.trim() !== '' && gaParsed === null;
    const pixelParsed = pixelRaw.trim() === '' ? null : parseMetaPixelId(pixelRaw);
    const pixelBad = pixelRaw.trim() !== '' && pixelParsed === null;
    const adsId = googleAdsIdFromSendTo(c.google_ads);
    const directEmpty = c.direct_tags && !adsId && !c.google_tag_id && !c.meta_pixel_id;

    const orderFields = readShopConfig((createCols.data ?? shop).config).orders.fields;
    const hasOriginCols = typeof orderFields.source === 'number';

    const copy = (text: string): void => {
        void navigator.clipboard?.writeText(text).then(() => {
            setCopied(text);
            window.setTimeout(() => setCopied(null), 1500);
        });
    };

    return (
        <PanelBody testId="shop-measure" tour="shop-measure">
            <SubSection
                title={__('En tu sitio web')}
                hint={__('Insertada con su código (el iframe y el script), la tienda le avisa a tu sitio cada paso de la compra. Google Tag Manager los entiende sin configurar nada: son los eventos de comercio electrónico de Google.')}
            >
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="shop-measure-events">
                    {EVENTS.map((e) => (
                        <li key={e.name} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-3 imcrm-py-2 imcrm-text-[12.5px]">
                            <span className="imcrm-min-w-0 imcrm-text-muted-foreground">{__(e.when)}</span>
                            <button
                                type="button"
                                onClick={() => copy(e.name)}
                                className="imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11.5px] imcrm-text-foreground"
                                title={__('Copiar el nombre del evento')}
                            >
                                {e.name}
                                {copied === e.name ? <CheckIcon className="imcrm-h-3 imcrm-w-3" /> : <Copy className="imcrm-h-3 imcrm-w-3" />}
                            </button>
                        </li>
                    ))}
                </ul>
                <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Cada evento lleva los productos, el valor y la moneda; la compra, además, el número del pedido (así Google y Meta no la cuentan dos veces). En el navegador también se dispara el evento «imagina:shop».')}{' '}
                    <a href="/#/aprende/tienda-online" target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-primary hover:imcrm-underline">
                        {__('Cómo se usa')}
                        <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                    </a>
                </p>
            </SubSection>

            <SubSection title={__('Google Ads y Meta')} hint={__('Opcional: si tu sitio ya tiene la etiqueta de Google y el píxel de Meta, la tienda los usa directamente.')}>
                <Field
                    label={__('Etiqueta de conversión de Google Ads (la compra)')}
                    hint={
                        adsBad
                            ? __('No reconocemos ese código. Pega el fragmento del evento que te da Google Ads o el «AW-123456789/AbC…».')
                            : adsParsed
                              ? __('Se dispara al comprar, con el total del pedido. Si usas Tag Manager, mejor arma la etiqueta allá con el evento «purchase» (con las dos, la misma compra no se cuenta dos veces).')
                              : __('En Google Ads: Objetivos → Conversiones → tu acción de compra → Configurar la etiqueta. Pega el fragmento del evento (el que tiene «send_to»).')
                    }
                >
                    <Input
                        value={adsRaw}
                        placeholder="AW-123456789/AbCdEfGhIj"
                        onChange={(e) => {
                            const raw = e.target.value;
                            setAdsRaw(raw);
                            const parsed = raw.trim() === '' ? null : parseGoogleAdsSendTo(raw);
                            if (raw.trim() === '' || parsed) set({ google_ads: parsed });
                        }}
                        onBlur={() => {
                            if (adsParsed) setAdsRaw(adsParsed);
                        }}
                        aria-invalid={adsBad}
                        data-testid="shop-measure-google-ads"
                    />
                </Field>
                <SwitchRow
                    label={__('Avisar al píxel de Meta de tu sitio')}
                    hint={__('ViewContent al abrir un producto, AddToCart, InitiateCheckout y Purchase al comprar, con el valor.')}
                    checked={c.meta_event}
                    onChange={(v) => set({ meta_event: v })}
                    testId="shop-measure-meta"
                />
                <SwitchRow
                    label={__('Conversiones mejoradas')}
                    hint={__('Con la compra se manda el correo y el teléfono de quien compra (Google los cifra antes de usarlos; a un teléfono sin indicativo se le pone el del país de la moneda de la tienda). Son datos personales: actívalo sólo si tu política de datos lo contempla.')}
                    checked={c.share_contact}
                    onChange={(v) => set({ share_contact: v })}
                    testId="shop-measure-share-contact"
                />
            </SubSection>

            <SubSection
                title={__('Enlace directo')}
                hint={__('Para cuando el anuncio lleva directo al enlace de la tienda, sin tu sitio de por medio: la página carga tus etiquetas de Google y Meta por su ID. Insertada en tu sitio no se cargan (ahí mandan las de tu sitio).')}
                tour="shop-measure-direct"
            >
                <SwitchRow label={__('Cargar mis etiquetas en el enlace directo')} checked={c.direct_tags} onChange={(v) => set({ direct_tags: v })} testId="shop-measure-direct" />
                {c.direct_tags && (
                    <>
                        <p className="imcrm-text-[11.5px] imcrm-leading-snug" data-testid="shop-measure-direct-ads">
                            {adsId ? __('Google Ads: usa la etiqueta de la compra de arriba (%s).').replace('%s', adsId) : __('Google Ads: pega arriba la etiqueta de conversión para medir las campañas de Google Ads.')}
                        </p>
                        <Field
                            label={__('ID de Google Analytics (opcional)')}
                            hint={gaBad ? __('No reconocemos ese ID. Empieza con «G-» (por ejemplo, G-AB12CD34EF).') : __('Empieza con «G-». Registra la visita y los eventos de comercio electrónico (view_item, add_to_cart, begin_checkout, purchase).')}
                        >
                            <Input
                                value={gaRaw}
                                placeholder="G-AB12CD34EF"
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    setGaRaw(raw);
                                    const parsed = raw.trim() === '' ? null : parseGoogleTagId(raw);
                                    if (raw.trim() === '' || parsed) set({ google_tag_id: parsed });
                                }}
                                onBlur={() => {
                                    if (gaParsed) setGaRaw(gaParsed);
                                }}
                                aria-invalid={gaBad}
                                data-testid="shop-measure-ga"
                            />
                        </Field>
                        <Field
                            label={__('ID del píxel de Meta (opcional)')}
                            hint={pixelBad ? __('No reconocemos ese ID. Son sólo números (los encuentras en el Administrador de eventos de Meta).') : __('Sólo números. Registra la visita, ViewContent, AddToCart, InitiateCheckout y Purchase.')}
                        >
                            <Input
                                value={pixelRaw}
                                placeholder="1234567890123456"
                                inputMode="numeric"
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    setPixelRaw(raw);
                                    const parsed = raw.trim() === '' ? null : parseMetaPixelId(raw);
                                    if (raw.trim() === '' || parsed) set({ meta_pixel_id: parsed });
                                }}
                                onBlur={() => {
                                    if (pixelParsed) setPixelRaw(pixelParsed);
                                }}
                                aria-invalid={pixelBad}
                                data-testid="shop-measure-pixel"
                            />
                        </Field>
                        {directEmpty && (
                            <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-warning" data-testid="shop-measure-direct-empty">
                                {__('Pon al menos un ID (o la etiqueta de Google Ads de arriba): sin ellos la página no carga nada.')}
                            </p>
                        )}
                        <SwitchRow label={__('Mostrar el aviso «Esta página usa cookies para medir las campañas»')} checked={c.cookie_notice} onChange={(v) => set({ cookie_notice: v })} testId="shop-measure-notice" />
                        <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Por seguridad, las etiquetas sólo pueden hablar con Google y Meta: no leen nada más de la app. Menciona estas cookies en tu política de datos.')}
                        </p>
                    </>
                )}
            </SubSection>

            <SubSection title={__('De dónde llegó cada pedido')} hint={__('Cada pedido guarda de dónde llegó quien compró: la campaña (utm_source y utm_campaign), el sitio anterior o si vino de un anuncio. Se ve en el pedido y en «Estadísticas».')}>
                {hasOriginCols ? (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-[12.5px] imcrm-text-muted-foreground" data-testid="shop-measure-origin-ok">
                        <CheckIcon className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" />
                        {__('Los pedidos tienen las columnas «Llegó desde» y «Campaña»: puedes filtrarlos y agruparlos por campaña.')}
                    </p>
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3">
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-[12.5px] imcrm-text-muted-foreground">
                            <Megaphone className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            {__('Agrega a Pedidos las columnas «Llegó desde» y «Campaña» para filtrar y agrupar los pedidos por campaña. Se llenan con los pedidos nuevos.')}
                        </p>
                        <Button
                            size="sm"
                            variant="outline"
                            className="imcrm-gap-1.5"
                            disabled={createCols.isPending || shop.orders === null}
                            onClick={() =>
                                createCols.mutate(undefined, {
                                    onSuccess: () => toast.success(__('Columnas agregadas a Pedidos')),
                                    onError: (e) => toast.error(__('No se pudieron agregar'), e instanceof Error ? e.message : undefined),
                                })
                            }
                            data-testid="shop-measure-origin-add"
                        >
                            {createCols.isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Agregar las columnas')}
                        </Button>
                    </div>
                )}
            </SubSection>
        </PanelBody>
    );
}
