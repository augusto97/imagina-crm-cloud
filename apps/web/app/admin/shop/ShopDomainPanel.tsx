import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Globe, Info, Search } from 'lucide-react';
import { SHOP_SEO_DESCRIPTION_MAX, SHOP_SEO_TITLE_MAX, shopProductPath, type ShopConfig, type ShopDto } from '@imagina-base/shared';

import { DomainPanel } from '@/cloud/components/DomainPanel';
import { useSession } from '@/cloud/session';
import { PlanModuleGate } from '@/components/PlanModuleNotice';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __, sprintf } from '@/lib/i18n';

import { PanelBody, SubSection, SwitchRow } from '../widgets/widgetUi';
import { shopKeys } from './useShops';

type Patch = (fn: (c: ShopConfig) => ShopConfig) => void;

/**
 * v0.1.423 (addendum ADR-S103) — «Dominio y Google»: la tarjeta del dominio
 * propio de la tienda (el mismo ciclo que el dominio de la empresa: pedirlo,
 * probar que es tuyo con un TXT y apuntarlo con un CNAME) y cómo se ve en
 * Google. La dirección de la plataforma nunca se indexa: sólo el dominio propio.
 */
export function ShopDomainPanel({ shop, config, patch }: { shop: ShopDto; config: ShopConfig; patch: Patch }): JSX.Element {
    const qc = useQueryClient();
    const admin = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin');
    const seo = config.seo;
    const set = (p: Partial<ShopConfig['seo']>): void => patch((c) => ({ ...c, seo: { ...c.seo, ...p } }));
    const domain = shop.custom_domain ?? null;
    const site = shop.site_url ?? null;

    const title = seo.title || config.texts.title || shop.name;
    const description = seo.description || config.texts.description || '';
    const sample = shop.custom_domain ? `${shop.custom_domain}` : 'tienda.tuempresa.com';

    return (
        <PlanModuleGate module="custom_domain">
            <PanelBody testId="shop-domain-panel">
                <SubSection
                    title={__('Tu dominio')}
                    hint={__('La dirección de la plataforma sigue funcionando siempre: el dominio propio se suma, no la reemplaza.')}
                    tour="shop-domain"
                >
                    {admin ? (
                        <DomainPanel shop={{ id: shop.id, name: shop.name }} onChanged={() => void qc.invalidateQueries({ queryKey: shopKeys.one(shop.id) })} />
                    ) : (
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-text-[12.5px]" data-testid="shop-domain-readonly">
                            <Info className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <p className="imcrm-leading-snug imcrm-text-muted-foreground">
                                {domain
                                    ? sprintf(__('La tienda usa el dominio %s. El dominio lo configura un administrador de la empresa.'), domain)
                                    : __('El dominio propio lo configura un administrador de la empresa.')}
                            </p>
                        </div>
                    )}
                    {site && (
                        <a
                            href={`${site}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-text-[12.5px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                            data-testid="shop-domain-open"
                        >
                            <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {sprintf(__('Abrir %s'), domain ?? site)}
                        </a>
                    )}
                </SubSection>

                <SubSection
                    title={__('Aparecer en Google')}
                    hint={
                        site
                            ? __('Tu tienda ya abre en tu dominio: así es como la puede mostrar Google.')
                            : __('Se aplica cuando la tienda abre en tu dominio. La dirección de la plataforma nunca aparece en Google.')
                    }
                    tour="shop-seo"
                    testId="shop-seo"
                >
                    <SwitchRow
                        label={__('Dejar que Google muestre la tienda')}
                        hint={__('Apagado, la tienda sigue abriendo en tu dominio, pero le pide a Google y a los demás buscadores que no la muestren.')}
                        checked={seo.index}
                        onChange={(v) => set({ index: v })}
                        testId="shop-seo-index"
                    />

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <label className="imcrm-text-[12.5px] imcrm-font-medium" htmlFor="shop-seo-title">
                            {__('Título en Google')}
                        </label>
                        <Input
                            id="shop-seo-title"
                            value={seo.title}
                            maxLength={SHOP_SEO_TITLE_MAX}
                            placeholder={config.texts.title || shop.name}
                            onChange={(e) => set({ title: e.target.value })}
                            data-testid="shop-seo-title"
                        />
                        <Counter value={seo.title} max={SHOP_SEO_TITLE_MAX} hint={__('Vacío, usa el título de la tienda.')} />
                    </div>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <label className="imcrm-text-[12.5px] imcrm-font-medium" htmlFor="shop-seo-description">
                            {__('Descripción en Google')}
                        </label>
                        <Textarea
                            id="shop-seo-description"
                            rows={3}
                            value={seo.description}
                            maxLength={SHOP_SEO_DESCRIPTION_MAX}
                            placeholder={config.texts.description || __('Qué vendes, en una o dos frases.')}
                            onChange={(e) => set({ description: e.target.value })}
                            data-testid="shop-seo-description"
                        />
                        <Counter value={seo.description} max={SHOP_SEO_DESCRIPTION_MAX} hint={__('Vacío, usa la descripción de la tienda.')} />
                    </div>

                    <GooglePreview host={sample} title={title} description={description} hidden={!seo.index} />
                </SubSection>

                <SubSection title={__('Lo que se arma solo')} hint={__('Con el dominio activo, la tienda trae lo que Google necesita para leerla bien.')}>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-[12.5px]" data-testid="shop-seo-features">
                        <Feature
                            title={__('Una dirección por producto')}
                            text={sprintf(__('Cada producto tiene la suya, con su nombre: %s'), `${sample}${shopProductPath(__('Camiseta azul'), 12)}`)}
                        />
                        <Feature title={__('Precio y disponibilidad para Google')} text={__('Cada producto le dice a Google su precio, su moneda y si hay stock, para mostrarlo en los resultados de compras.')} />
                        <Feature title={__('Mapa del sitio')} text={__('Una lista de todos tus productos que Google lee para encontrarlos, en /sitemap.xml.')} />
                        <Feature title={__('Vista al compartir')} text={__('Al pegar el enlace en WhatsApp o en redes se ve la foto, el nombre y el precio.')} />
                    </ul>
                    {site && seo.index && (
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-3 imcrm-text-[12px] imcrm-leading-snug imcrm-text-muted-foreground">
                            <Search className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            <p>
                                {__('Para que Google la encuentre antes: agrega tu dominio en Google Search Console y envía el mapa del sitio:')}{' '}
                                <a href={`${site}/sitemap.xml`} target="_blank" rel="noreferrer" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline" data-testid="shop-seo-sitemap">
                                    {`${domain ?? ''}/sitemap.xml`}
                                </a>
                            </p>
                        </div>
                    )}
                </SubSection>
            </PanelBody>
        </PlanModuleGate>
    );
}

function Counter({ value, max, hint }: { value: string; max: number; hint: string }): JSX.Element {
    const n = value.length;
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-[11.5px] imcrm-text-muted-foreground">
            <span>{hint}</span>
            <span className={n > max * 0.9 ? 'imcrm-text-amber-700 dark:imcrm-text-amber-400' : undefined}>
                {n}/{max}
            </span>
        </div>
    );
}

function Feature({ title, text }: { title: string; text: string }): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-items-start imcrm-gap-2">
            <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" aria-hidden />
            <span className="imcrm-min-w-0">
                <span className="imcrm-font-medium">{title}</span>
                <span className="imcrm-block imcrm-break-words imcrm-text-muted-foreground">{text}</span>
            </span>
        </li>
    );
}

/** Cómo se vería el resultado en Google (aproximado). */
function GooglePreview({ host, title, description, hidden }: { host: string; title: string; description: string; hidden: boolean }): JSX.Element {
    const shortTitle = title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
    const shortDesc = description.length > 160 ? `${description.slice(0, 159).trimEnd()}…` : description;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <span className="imcrm-text-[12.5px] imcrm-font-medium">{__('Así se vería en Google')}</span>
            <div
                className={`imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-white imcrm-p-3 imcrm-text-left imcrm-shadow-sm dark:imcrm-bg-[#202124] ${hidden ? 'imcrm-opacity-50' : ''}`}
                data-testid="shop-seo-preview"
            >
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-[#f1f3f4] dark:imcrm-bg-[#303134]">
                        <Globe className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-[#5f6368] dark:imcrm-text-[#9aa0a6]" aria-hidden />
                    </span>
                    <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[12px] imcrm-text-[#202124] dark:imcrm-text-[#dadce0]">{`https://${host}`}</span>
                </div>
                <div className="imcrm-mt-1.5 imcrm-break-words imcrm-text-[17px] imcrm-leading-snug imcrm-text-[#1a0dab] dark:imcrm-text-[#8ab4f8]">{shortTitle}</div>
                {shortDesc ? (
                    <div className="imcrm-mt-0.5 imcrm-break-words imcrm-text-[13px] imcrm-leading-snug imcrm-text-[#4d5156] dark:imcrm-text-[#bdc1c6]">{shortDesc}</div>
                ) : (
                    <div className="imcrm-mt-0.5 imcrm-text-[13px] imcrm-italic imcrm-text-[#70757a]">{__('Sin descripción: Google mostrará un pedazo de la página.')}</div>
                )}
            </div>
            {hidden && <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Con «Dejar que Google muestre la tienda» apagado, no aparece.')}</p>}
        </div>
    );
}
