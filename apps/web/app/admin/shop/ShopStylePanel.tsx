import { useMemo } from 'react';
import { Check, Code2, Moon, RotateCcw, Sun, SunMoon } from 'lucide-react';
import {
    SHOP_CARD_LABELS,
    SHOP_CORNER_LABELS,
    SHOP_CUSTOM_CSS_MAX,
    SHOP_DESIGN_PRESETS,
    SHOP_HEADER_LABELS,
    SHOP_HERO_LABELS,
    applyShopDesignPreset,
    sanitizePublicCss,
    type ShopConfig,
    type ShopDesign,
    type ShopDesignPreset,
    type ShopOptions,
} from '@imagina-base/shared';

import { ColorField, FontSelect } from '@/components/design/DesignStyleControls';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/cloud/session';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ImageUpload } from '../forms/design/ImageUpload';
import { ColorChoice } from '../widgets/WidgetButtonEditor';
import { PanelBody, SubSection, SwitchRow } from '../widgets/widgetUi';
import { Field, Segmented, type Patch } from './ShopPanels';

/**
 * v0.1.422 (ADR-S103) — «Estilo»: cómo se ve la tienda. Plantillas listas,
 * colores y modo oscuro, letra, encabezado, portada, tarjetas y botones, y el
 * CSS propio (sólo administradores). Todo vive en `config.design`; la vista
 * previa lo muestra en vivo.
 */
export function StylePanel({ config, options, patch }: { config: ShopConfig; options: ShopOptions; patch: Patch }): JSX.Element {
    const toast = useToast();
    const isAdmin = useSession((st) => st.memberships.find((m) => m.tenant_id === st.activeTenantId)?.role === 'admin');
    const d = config.design;
    const accent = config.color ?? options.brand_color ?? '#0e7490';
    const setD = (p: Partial<ShopDesign>): void => patch((c) => ({ ...c, design: { ...c.design, ...p } }));
    const setColors = (p: Partial<ShopDesign['colors']>): void => patch((c) => ({ ...c, design: { ...c.design, colors: { ...c.design.colors, ...p } } }));
    const setHeader = (p: Partial<ShopDesign['header']>): void => patch((c) => ({ ...c, design: { ...c.design, header: { ...c.design.header, ...p } } }));
    const setHero = (p: Partial<ShopDesign['hero']>): void => patch((c) => ({ ...c, design: { ...c.design, hero: { ...c.design.hero, ...p } } }));
    const setT = (p: Partial<ShopConfig['texts']>): void => patch((c) => ({ ...c, texts: { ...c.texts, ...p } }));
    const cssCheck = useMemo(() => sanitizePublicCss(d.custom_css), [d.custom_css]);
    const darkBase = d.mode === 'dark';

    const applyPreset = (p: ShopDesignPreset): void => {
        patch((c) => ({ ...c, design: applyShopDesignPreset(c.design, p.id) }));
        toast.success(sprintf(__('Aplicaste «%s»'), __(p.label)), __('Ajusta lo que quieras abajo: colores, letra, encabezado y portada.'));
    };

    return (
        <PanelBody testId="shop-style">
            <SubSection title={__('Plantillas')} hint={__('Un punto de partida con colores, letra y formas que combinan. Tus fotos y textos no cambian.')} tour="shop-style-presets">
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" role="radiogroup" aria-label={__('Plantillas')} data-testid="shop-presets">
                    {SHOP_DESIGN_PRESETS.map((p) => (
                        <PresetCard key={p.id} preset={p} accent={accent} active={d.preset === p.id || (d.preset === null && p.id === 'clasica')} onClick={() => applyPreset(p)} />
                    ))}
                </div>
            </SubSection>

            <SubSection title={__('Colores')} tour="shop-style-colors">
                <Field label={__('Modo')}>
                    <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5" role="radiogroup" aria-label={__('Modo')} data-testid="shop-mode">
                        {(
                            [
                                ['light', __('Claro'), Sun],
                                ['dark', __('Oscuro'), Moon],
                                ['auto', __('Automático'), SunMoon],
                            ] as const
                        ).map(([v, label, Icon]) => (
                            <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={d.mode === v}
                                data-value={v}
                                onClick={() => setD({ mode: v })}
                                className={cn(
                                    'imcrm-flex imcrm-h-8 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-text-[12.5px]',
                                    d.mode === v ? 'imcrm-bg-card imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                )}
                            >
                                <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                {label}
                            </button>
                        ))}
                    </div>
                </Field>
                {d.mode === 'auto' && (
                    <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="shop-mode-auto-hint">
                        {__('Se ve clara u oscura según el celular o computador de cada persona. Los colores de abajo son los del modo claro. En la vista previa puedes ver las dos.')}
                    </p>
                )}
                <Field label={__('Color de la tienda')} hint={__('Botones, precios destacados y detalles.')}>
                    <ColorChoice value={config.color} fallbackLabel={__('El de tu marca')} fallbackColor={options.brand_color} onChange={(color) => patch((c) => ({ ...c, color }))} />
                </Field>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3" data-testid="shop-colors">
                    <ColorField label={__('Fondo')} value={d.colors.background} onChange={(v) => setColors({ background: v })} placeholder={darkBase ? '#0f1115' : '#f6f7f9'} />
                    <ColorField label={__('Tarjetas y ventanas')} value={d.colors.surface} onChange={(v) => setColors({ surface: v })} placeholder={darkBase ? '#171a21' : '#ffffff'} />
                    <ColorField label={__('Texto')} value={d.colors.text} onChange={(v) => setColors({ text: v })} placeholder={darkBase ? '#e8eaef' : '#111827'} />
                </div>
                {(d.colors.background || d.colors.surface || d.colors.text) && (
                    <button
                        type="button"
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-[12px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        onClick={() => setColors({ background: null, surface: null, text: null })}
                    >
                        <RotateCcw className="imcrm-h-3 imcrm-w-3" />
                        {__('Volver a los colores de siempre')}
                    </button>
                )}
            </SubSection>

            <SubSection title={__('Letra')} tour="shop-style-fonts">
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                    <FontSelect label={__('Texto')} value={d.font} onChange={(f) => setD({ font: f })} medium="web" inheritLabel={__('La del sistema')} />
                    <FontSelect label={__('Títulos')} value={d.heading_font} onChange={(f) => setD({ heading_font: f })} medium="web" inheritLabel={__('La misma del texto')} />
                </div>
                <Field label={__('Tamaño del texto')}>
                    <Segmented value={d.font_size} onChange={(font_size) => setD({ font_size })} options={[[14, __('Chico')], [15, __('Normal')], [16, __('Grande')], [17, __('Más grande')]]} testId="shop-font-size" />
                </Field>
                <Field label={__('Títulos')}>
                    <Segmented value={d.heading_weight} onChange={(heading_weight) => setD({ heading_weight })} options={[[600, __('Normales')], [700, __('En negrita')], [800, __('Muy gruesos')]]} />
                </Field>
            </SubSection>

            <SubSection title={__('Encabezado')} hint={__('La barra de arriba con tu logo, «Mis pedidos» y el carrito.')} tour="shop-style-header">
                <Field label={__('Estilo')}>
                    <Segmented value={d.header.style} onChange={(style) => setHeader({ style })} options={(Object.keys(SHOP_HEADER_LABELS) as Array<ShopDesign['header']['style']>).map((k) => [k, __(SHOP_HEADER_LABELS[k])] as const)} testId="shop-header-style" />
                </Field>
                {(d.header.style === 'brand' || d.header.style === 'dark') && (
                    <ColorField label={d.header.style === 'brand' ? __('Color del encabezado') : __('Color del encabezado oscuro')} value={d.colors.header} onChange={(v) => setColors({ header: v })} placeholder={d.header.style === 'brand' ? accent : '#111827'} />
                )}
                <SwitchRow label={__('Mostrar el logo de tu marca')} checked={config.show_logo} onChange={(v) => patch((c) => ({ ...c, show_logo: v }))} testId="shop-show-logo" />
                {config.show_logo && (
                    <Field label={sprintf(__('Tamaño del logo: %d px'), d.header.logo_size)}>
                        <input
                            type="range"
                            min={24}
                            max={96}
                            step={2}
                            value={d.header.logo_size}
                            onChange={(e) => setHeader({ logo_size: Number(e.target.value) })}
                            className="imcrm-w-full imcrm-accent-primary"
                            aria-label={__('Tamaño del logo')}
                            data-testid="shop-logo-size"
                        />
                    </Field>
                )}
                <Field label={__('Logo y nombre')}>
                    <Segmented value={d.header.align} onChange={(align) => setHeader({ align })} options={[['left', __('A la izquierda')], ['center', __('Al centro')]]} testId="shop-header-align" />
                </Field>
                <SwitchRow label={__('Queda fija arriba al bajar')} checked={d.header.sticky} onChange={(sticky) => setHeader({ sticky })} />
            </SubSection>

            <SubSection title={__('Portada')} hint={__('Lo primero que se ve: el título y la descripción de la tienda.')} tour="shop-style-hero">
                <Field label={__('Cómo se ve')}>
                    <Segmented value={d.hero.style} onChange={(style) => setHero({ style })} options={(Object.keys(SHOP_HERO_LABELS) as Array<ShopDesign['hero']['style']>).map((k) => [k, __(SHOP_HERO_LABELS[k])] as const)} testId="shop-hero-style" />
                </Field>
                {d.hero.style !== 'none' && (
                    <>
                        <Field label={__('Título de la tienda')} hint={__('Si lo dejas vacío, se usa el nombre de la tienda.')}>
                            <Input value={config.texts.title} maxLength={120} onChange={(e) => setT({ title: e.target.value })} data-testid="shop-title" />
                        </Field>
                        <Field label={__('Descripción')}>
                            <Textarea value={config.texts.description} maxLength={600} rows={3} onChange={(e) => setT({ description: e.target.value })} data-testid="shop-description" />
                        </Field>
                    </>
                )}
                {d.hero.style === 'banner' && (
                    <>
                        <ImageUpload
                            label={__('Foto de la portada')}
                            fileId={d.hero.image_file_id}
                            onChange={(id) => setHero({ image_file_id: id })}
                            maxSide={2000}
                            hint={__('Opcional. Sin foto, la portada va con el color de la tienda. Mejor una foto horizontal.')}
                            testId="shop-hero-image"
                        />
                        <Field label={__('Alto')}>
                            <Segmented value={d.hero.height} onChange={(height) => setHero({ height })} options={[['short', __('Bajo')], ['medium', __('Medio')], ['tall', __('Alto')]]} />
                        </Field>
                        {d.hero.image_file_id !== null && (
                            <Field label={sprintf(__('Oscurecer la foto: %d %%'), d.hero.overlay)} hint={__('Para que el título se lea bien sobre la foto.')}>
                                <input
                                    type="range"
                                    min={0}
                                    max={80}
                                    step={5}
                                    value={d.hero.overlay}
                                    onChange={(e) => setHero({ overlay: Number(e.target.value) })}
                                    className="imcrm-w-full imcrm-accent-primary"
                                    aria-label={__('Oscurecer la foto')}
                                    data-testid="shop-hero-overlay"
                                />
                            </Field>
                        )}
                    </>
                )}
                {d.hero.style !== 'none' && (
                    <>
                        <Field label={__('Alineación')}>
                            <Segmented value={d.hero.align} onChange={(align) => setHero({ align })} options={[['left', __('A la izquierda')], ['center', __('Al centro')]]} testId="shop-hero-align" />
                        </Field>
                        <Field label={__('Tamaño del título')}>
                            <Segmented value={d.hero.title_size} onChange={(title_size) => setHero({ title_size })} options={[['small', __('Chico')], ['normal', __('Normal')], ['large', __('Grande')]]} />
                        </Field>
                    </>
                )}
            </SubSection>

            <SubSection title={__('Tarjetas y botones')} hint={__('Cómo se ve cada producto en la vitrina.')} tour="shop-style-cards">
                <Field label={__('Tarjetas')}>
                    <Segmented value={d.cards} onChange={(cards) => setD({ cards })} options={(Object.keys(SHOP_CARD_LABELS) as Array<ShopDesign['cards']>).map((k) => [k, __(SHOP_CARD_LABELS[k])] as const)} testId="shop-cards" />
                </Field>
                <Field label={__('Esquinas')}>
                    <Segmented value={d.corners} onChange={(corners) => setD({ corners })} options={(Object.keys(SHOP_CORNER_LABELS) as Array<ShopDesign['corners']>).map((k) => [k, __(SHOP_CORNER_LABELS[k])] as const)} testId="shop-corners" />
                </Field>
                <Field label={__('Texto de la tarjeta')}>
                    <Segmented value={d.card_align} onChange={(card_align) => setD({ card_align })} options={[['left', __('A la izquierda')], ['center', __('Al centro')]]} testId="shop-card-align" />
                </Field>
                <Field label={__('Botón de la tarjeta')} hint={__('El de pagar siempre va relleno.')}>
                    <Segmented value={d.buttons} onChange={(buttons) => setD({ buttons })} options={[['solid', __('Relleno')], ['outline', __('Con contorno')]]} testId="shop-buttons" />
                </Field>
                <Field label={__('Espacio entre productos')}>
                    <Segmented value={d.gap} onChange={(gap) => setD({ gap })} options={[['compact', __('Poco')], ['normal', __('Normal')], ['airy', __('Mucho')]]} testId="shop-gap" />
                </Field>
                <Field label={__('Ancho de la página')}>
                    <Segmented value={d.width} onChange={(width) => setD({ width })} options={[['narrow', __('Angosta')], ['normal', __('Normal')], ['wide', __('Ancha')]]} testId="shop-width" />
                </Field>
            </SubSection>

            <SubSection title={__('CSS propio')} hint={__('Para retoques finos. No se permite cargar nada de afuera (url, @import).')} tour="shop-style-css">
                {isAdmin ? (
                    <>
                        <Textarea
                            rows={7}
                            spellCheck={false}
                            value={d.custom_css}
                            maxLength={SHOP_CUSTOM_CSS_MAX}
                            placeholder={'.s-title {\n  letter-spacing: .5px;\n}'}
                            onChange={(e) => setD({ custom_css: e.target.value.slice(0, SHOP_CUSTOM_CSS_MAX) })}
                            className="imcrm-font-mono imcrm-text-[11px] imcrm-leading-relaxed"
                            data-testid="shop-css"
                        />
                        {cssCheck.removed.length > 0 && (
                            <p className="imcrm-text-[11.5px] imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="shop-css-removed">
                                {sprintf(__('Al publicarlo se quita: %s.'), cssCheck.removed.join(', '))}
                            </p>
                        )}
                        <details className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-text-[11px]">
                            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-1.5 imcrm-px-2 imcrm-py-1.5 imcrm-font-medium">
                                <Code2 className="imcrm-h-3 imcrm-w-3" />
                                {__('Clases que puedes usar')}
                            </summary>
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5">
                                {CSS_CLASSES.map(([cls, what]) => (
                                    <li key={cls} className="imcrm-flex imcrm-gap-2">
                                        <code className="imcrm-shrink-0 imcrm-font-mono imcrm-text-[10.5px] imcrm-text-foreground">{cls}</code>
                                        <span className="imcrm-text-muted-foreground">{__(what)}</span>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    </>
                ) : (
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="shop-css-locked">
                        {d.custom_css.trim() ? __('Esta tienda tiene CSS propio. Lo cambia un administrador de la empresa.') : __('El CSS propio lo agrega un administrador de la empresa.')}
                    </p>
                )}
            </SubSection>
        </PanelBody>
    );
}

const CSS_CLASSES: ReadonlyArray<readonly [string, string]> = [
    ['.s-top', 'El encabezado'],
    ['.s-hero', 'La portada (título y descripción)'],
    ['.s-card', 'La tarjeta de cada producto'],
    ['.s-title', 'El nombre del producto'],
    ['.s-now', 'El precio'],
    ['.s-add', 'El botón «Agregar al carrito»'],
    ['.s-btn', 'Los botones grandes (pagar, finalizar)'],
    ['.s-foot', 'El pie de la página'],
];

/** Una plantilla con su dibujo: fondo, encabezado, portada y dos tarjetas. */
function PresetCard({ preset, accent, active, onClick }: { preset: ShopDesignPreset; accent: string; active: boolean; onClick: () => void }): JSX.Element {
    const p = preset.design;
    const dark = p.mode === 'dark';
    const bg = p.colors.background ?? (dark ? '#0f1115' : '#f6f7f9');
    const card = p.colors.surface ?? (dark ? '#171a21' : '#ffffff');
    const text = p.colors.text ?? (dark ? '#e8eaef' : '#111827');
    const head = p.header?.style ?? 'light';
    const headBg = head === 'brand' ? accent : head === 'dark' ? '#111827' : head === 'plain' ? bg : card;
    const radius = p.corners === 'square' ? 2 : p.corners === 'round' ? 7 : 4;
    const banner = (p.hero?.style ?? 'simple') === 'banner';
    const cards = p.cards ?? 'border';
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onClick}
            data-testid={`shop-preset-${preset.id}`}
            className={cn(
                'imcrm-group imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-text-left imcrm-transition-all',
                active ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/20' : 'imcrm-border-border hover:imcrm-border-primary/40',
            )}
        >
            <span aria-hidden className="imcrm-flex imcrm-h-[92px] imcrm-flex-col imcrm-gap-1.5 imcrm-p-2" style={{ background: bg }}>
                <span className="imcrm-flex imcrm-h-3 imcrm-items-center imcrm-justify-between imcrm-rounded-sm imcrm-px-1.5" style={{ background: headBg, boxShadow: head === 'light' ? `0 0 0 1px ${text}14` : undefined }}>
                    <span className="imcrm-h-1 imcrm-w-6 imcrm-rounded-full" style={{ background: head === 'brand' || head === 'dark' ? '#ffffff' : text, opacity: 0.75 }} />
                    <span className="imcrm-h-1.5 imcrm-w-3 imcrm-rounded-full" style={{ background: head === 'brand' ? '#ffffff' : accent }} />
                </span>
                {banner ? (
                    <span className="imcrm-flex imcrm-h-5 imcrm-items-center imcrm-px-1.5" style={{ background: accent, borderRadius: radius }}>
                        <span className="imcrm-h-1 imcrm-w-9 imcrm-rounded-full imcrm-bg-white/85" />
                    </span>
                ) : (
                    <span className="imcrm-flex imcrm-h-5 imcrm-flex-col imcrm-justify-center imcrm-gap-1 imcrm-px-0.5">
                        <span className="imcrm-h-1.5 imcrm-w-12 imcrm-rounded-full" style={{ background: text, opacity: 0.8 }} />
                        <span className="imcrm-h-1 imcrm-w-16 imcrm-rounded-full" style={{ background: text, opacity: 0.3 }} />
                    </span>
                )}
                <span className="imcrm-grid imcrm-flex-1 imcrm-grid-cols-3 imcrm-gap-1">
                    {[0, 1, 2].map((i) => (
                        <span
                            key={i}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-hidden imcrm-p-0.5"
                            style={{
                                background: cards === 'plain' ? 'transparent' : card,
                                borderRadius: radius,
                                boxShadow: cards === 'border' ? `0 0 0 1px ${text}1f` : cards === 'shadow' ? '0 2px 6px rgba(0,0,0,.14)' : undefined,
                            }}
                        >
                            <span className="imcrm-flex-1" style={{ background: `${text}14`, borderRadius: Math.max(1, radius - 1) }} />
                            <span className="imcrm-h-1.5" style={{ background: p.buttons === 'outline' ? 'transparent' : accent, boxShadow: p.buttons === 'outline' ? `inset 0 0 0 1px ${accent}` : undefined, borderRadius: radius }} />
                        </span>
                    ))}
                </span>
            </span>
            <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-border-t imcrm-border-border imcrm-px-2.5 imcrm-py-2">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[12.5px] imcrm-font-medium">
                    {active && <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />}
                    {__(preset.label)}
                </span>
                <span className="imcrm-line-clamp-2 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(preset.description)}</span>
            </span>
        </button>
    );
}
