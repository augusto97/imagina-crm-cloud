import { useEffect, useMemo, useRef, useState } from 'react';
import {
    APP_BAR_NEUTRAL,
    ICON_SCALE_MAX,
    ICON_SCALE_MIN,
    iconBackgrounds,
    type IconArtKind,
    type IconDesign,
    type PlatformBrand,
} from '@imagina-base/shared';
import { AlertTriangle, ArrowRight, ImageUp, Loader2, RotateCcw, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    analyzeIconImage,
    loadImageUrl,
    prepareIconArt,
    renderDesignedIconCanvas,
    renderIconCanvas,
    type PreparedIconArt,
} from '@/lib/brandAssets';
import {
    isWideArt,
    lowContrastWhiteArt,
    suggestIconDesign,
    type ArtworkAnalysis,
    type RgbaImage,
} from '@/lib/iconDesign';
import { cn } from '@/lib/utils';

/**
 * v0.1.343 — El estudio del ícono (Plataforma → Marca). El ícono de la app
 * instalada deja de ser «el logo sobre un plato blanco»: la app lo arma como
 * un ícono de app —fondo de color de borde a borde y el dibujo centrado— a
 * partir del logo, con una sugerencia automática y vistas previas en vivo de
 * cómo se ve en el inicio del teléfono, al abrir la app y en el computador.
 * Nada se sube hasta guardar: los tamaños se generan en ese momento.
 */

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const FACTORY_ICON = '/pwa/icon-maskable-192.png';
const LEGACY_BG_PRESETS = ['#ffffff', '#f4f4f5', '#18181b', '#000000'];
const SOLID_PRESETS = ['#ffffff', '#18181b'];
const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];

interface Source {
    url: string;
    img: HTMLImageElement;
    pixels: RgbaImage;
    analysis: ArtworkAnalysis;
}

/** Carga y analiza el original del ícono (una vez por URL). */
function useIconSource(url: string | null): { source: Source | null; error: string | null } {
    const [state, setState] = useState<{ source: Source | null; error: string | null }>({ source: null, error: null });
    useEffect(() => {
        if (!url) {
            setState({ source: null, error: null });
            return;
        }
        let alive = true;
        loadImageUrl(url)
            .then((img) => {
                if (!alive) return;
                const { pixels, analysis } = analyzeIconImage(img);
                setState({ source: { url, img, pixels, analysis }, error: null });
            })
            .catch((err: unknown) => alive && setState({ source: null, error: err instanceof Error ? err.message : String(err) }));
        return () => {
            alive = false;
        };
    }, [url]);
    return state.source?.url === url || !url ? state : { source: null, error: state.error };
}

interface Previews {
    mask: string;
    apple: string;
    tile: string;
    favicon: string;
    /** Sólo en el estilo de antes: el maskable con el fondo oscuro. */
    maskDark?: string;
}

function usePreviews(source: Source | null, brand: PlatformBrand): Previews | null {
    const artCache = useRef(new Map<string, PreparedIconArt>());
    useEffect(() => {
        artCache.current.clear();
    }, [source]);
    return useMemo(() => {
        if (!source) return null;
        try {
            const design = brand.icon_design;
            if (design) {
                const cacheKey = design.art;
                let art = artCache.current.get(cacheKey);
                if (!art) {
                    art = prepareIconArt(source.pixels, source.analysis, design.art);
                    artCache.current.set(cacheKey, art);
                }
                return {
                    mask: renderDesignedIconCanvas(art, 'mask', 192, design).toDataURL('image/png'),
                    apple: renderDesignedIconCanvas(art, 'apple', 180, design).toDataURL('image/png'),
                    tile: renderDesignedIconCanvas(art, 'tile', 192, design).toDataURL('image/png'),
                    favicon: renderDesignedIconCanvas(art, 'favicon', 32, design).toDataURL('image/png'),
                };
            }
            const bg = iconBackgrounds(brand);
            return {
                mask: renderIconCanvas(source.img, 'maskable_192', bg.light).toDataURL('image/png'),
                maskDark: renderIconCanvas(source.img, 'maskable_dark_192', bg.dark).toDataURL('image/png'),
                apple: renderIconCanvas(source.img, 'apple_180', bg.light).toDataURL('image/png'),
                tile: renderIconCanvas(source.img, 'icon_192', bg.light).toDataURL('image/png'),
                favicon: renderIconCanvas(source.img, 'favicon_32', bg.light).toDataURL('image/png'),
            };
        } catch {
            return null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, brand.icon_design, brand.icon_background, brand.icon_background_auto]);
}

export interface IconStudioProps {
    brand: PlatformBrand;
    onChange: (patch: Partial<PlatformBrand>) => void;
    busy: boolean;
    onPickIcon: (file: File) => void;
    onRemoveIcon: () => void;
    /** Un original recién subido: cuando carga, arranca con el diseño sugerido. */
    autoSuggestFor: string | null;
    onAutoSuggested: () => void;
}

export function IconStudio({ brand, onChange, busy, onPickIcon, onRemoveIcon, autoSuggestFor, onAutoSuggested }: IconStudioProps): JSX.Element {
    const { source, error } = useIconSource(brand.icon_source_url);
    const previews = usePreviews(source, brand);
    const design = brand.icon_design;
    const suggestion = useMemo(() => (source ? suggestIconDesign(source.analysis) : null), [source]);

    useEffect(() => {
        if (!source || !suggestion || autoSuggestFor === null || source.url !== autoSuggestFor) return;
        onChange({ icon_design: suggestion });
        onAutoSuggested();
    }, [source, suggestion, autoSuggestFor, onChange, onAutoSuggested]);

    const setDesign = (patch: Partial<IconDesign>): void => {
        if (!design) return;
        onChange({ icon_design: { ...design, ...patch } });
    };

    const hasIcon = brand.icon_source_url !== null;
    const name = brand.app_name;

    return (
        <div className="imcrm-space-y-5" data-testid="icon-studio">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <PickButton busy={busy} label={hasIcon ? 'Cambiar ícono' : 'Subir ícono'} onPick={onPickIcon} />
                {hasIcon && (
                    <Button type="button" variant="ghost" size="sm" onClick={onRemoveIcon}>
                        <Trash2 className="imcrm-h-4 imcrm-w-4" /> Quitar
                    </Button>
                )}
                {error && <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>}
            </div>

            {source && !design && suggestion && (
                <div
                    className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-xs"
                    data-testid="icon-upgrade"
                >
                    <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                    <span className="imcrm-min-w-[200px] imcrm-flex-1">
                        Hoy tu ícono es el logo sobre un fondo liso. Prueba el <strong>ícono de app</strong>: lo armamos con los
                        colores de tu logo, de borde a borde, como el de una app nativa.
                    </span>
                    <Button type="button" size="sm" onClick={() => onChange({ icon_design: suggestion })} data-testid="icon-upgrade-btn">
                        Ver el ícono sugerido
                    </Button>
                </div>
            )}

            <IconPreviews brand={brand} previews={previews} name={name} />

            {source && (
                <div className="imcrm-space-y-5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-4">
                    <div className="imcrm-space-y-1.5">
                        <Label>Estilo</Label>
                        <Segmented
                            testId="icon-style"
                            value={design ? 'design' : 'plain'}
                            options={[
                                { value: 'design', label: 'Ícono de app', hint: 'Fondo de color de borde a borde' },
                                { value: 'plain', label: 'Logo sobre el fondo de la app', hint: 'Blanco o gris oscuro' },
                            ]}
                            onChange={(v) => onChange({ icon_design: v === 'design' ? (design ?? suggestion) : null })}
                        />
                    </div>

                    {design ? (
                        <DesignControls
                            design={design}
                            source={source}
                            suggestion={suggestion}
                            onChange={setDesign}
                            onReset={() => suggestion && onChange({ icon_design: suggestion })}
                        />
                    ) : (
                        <LegacyBackground brand={brand} onChange={onChange} />
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Controles ──────────────────────────────────────────────────────────────

function DesignControls({
    design,
    source,
    suggestion,
    onChange,
    onReset,
}: {
    design: IconDesign;
    source: Source;
    suggestion: IconDesign | null;
    onChange: (patch: Partial<IconDesign>) => void;
    onReset: () => void;
}): JSX.Element {
    const a = source.analysis;
    const artOptions: Array<{ value: IconArtKind; label: string; hint: string }> = [];
    if (a.shape !== 'free') artOptions.push({ value: 'mark', label: 'Sólo la marca, en blanco', hint: 'El color del logo pasa a ser el fondo' });
    artOptions.push({ value: 'logo', label: 'El logo completo', hint: 'Con sus colores' });
    if (a.shape === 'free') artOptions.push({ value: 'white', label: 'El logo en blanco', hint: 'Para un símbolo de un color' });
    const gradient = design.bg_to !== null;
    const isSuggested = suggestion !== null && JSON.stringify(suggestion) === JSON.stringify(design);
    const solidSplash = design.splash === 'icon';
    const palette = a.palette;
    return (
        <>
            <div className="imcrm-space-y-1.5">
                <Label>Dibujo</Label>
                <Segmented testId="icon-art" value={design.art} options={artOptions} onChange={(v) => onChange({ art: v as IconArtKind })} />
            </div>

            <div className="imcrm-space-y-2">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <Label>Fondo</Label>
                    {palette && (
                        <button
                            type="button"
                            className="imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                            data-testid="icon-bg-from-logo"
                            onClick={() => onChange({ bg_from: palette.from, bg_to: palette.to, bg_angle: palette.angle })}
                        >
                            Usar los colores de tu logo
                        </button>
                    )}
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                    <ColorInput label="Color" value={design.bg_from} onChange={(c) => onChange({ bg_from: c })} testId="icon-bg-from" />
                    {gradient && !solidSplash ? (
                        <>
                            <ColorInput label="Hasta" value={design.bg_to!} onChange={(c) => onChange({ bg_to: c })} testId="icon-bg-to" />
                            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ bg_to: null })}>
                                Un solo color
                            </Button>
                        </>
                    ) : (
                        !solidSplash && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="icon-bg-gradient"
                                onClick={() => onChange({ bg_to: palette?.to ?? shadeHex(design.bg_from) })}
                            >
                                Agregar degradado
                            </Button>
                        )
                    )}
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        {SOLID_PRESETS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                aria-label={c === '#ffffff' ? 'Fondo blanco' : 'Fondo negro'}
                                onClick={() => onChange({ bg_from: c, bg_to: null })}
                                className={cn(
                                    'imcrm-h-6 imcrm-w-6 imcrm-rounded-full imcrm-border imcrm-border-border',
                                    !gradient && design.bg_from.toLowerCase() === c && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-2 imcrm-ring-offset-background',
                                )}
                                style={{ background: c }}
                            />
                        ))}
                    </span>
                </div>
                {gradient && !solidSplash && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1" role="group" aria-label="Dirección del degradado">
                        <span className="imcrm-mr-1 imcrm-text-xs imcrm-text-muted-foreground">Dirección</span>
                        {DIRECTIONS.map((deg) => (
                            <button
                                key={deg}
                                type="button"
                                aria-label={`Degradado hacia ${deg}°`}
                                aria-pressed={design.bg_angle === deg}
                                onClick={() => onChange({ bg_angle: deg })}
                                className={cn(
                                    'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                    design.bg_angle === deg && 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary',
                                )}
                            >
                                <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" style={{ transform: `rotate(${deg}deg)` }} />
                            </button>
                        ))}
                    </div>
                )}
                {lowContrastWhiteArt(design) && (
                    <Warn>El dibujo blanco casi no se ve sobre un fondo tan claro: elige un color más oscuro o «El logo completo».</Warn>
                )}
            </div>

            <div className="imcrm-space-y-1.5">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <Label htmlFor="icon-scale">Tamaño del dibujo</Label>
                    <span className="imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">{Math.round(design.scale * 100)} %</span>
                </div>
                <input
                    id="icon-scale"
                    type="range"
                    min={ICON_SCALE_MIN}
                    max={ICON_SCALE_MAX}
                    step={0.02}
                    value={design.scale}
                    onChange={(e) => onChange({ scale: Number(e.target.value) })}
                    className="imcrm-w-full imcrm-max-w-sm imcrm-accent-[hsl(var(--imcrm-primary))]"
                    data-testid="icon-scale"
                />
                {isWideArt(a) && (
                    <Warn>Tu ícono es muy alargado y dentro de un cuadrado se ve pequeño. Si tienes una versión cuadrada (sólo el símbolo), súbela.</Warn>
                )}
            </div>

            <div className="imcrm-space-y-1.5">
                <Label>Al abrir la app en Android</Label>
                <Segmented
                    testId="icon-splash"
                    value={design.splash}
                    options={[
                        { value: 'app', label: 'Sobre el fondo de la app', hint: 'Tu ícono en un círculo, como las apps nativas' },
                        { value: 'icon', label: 'Con el color de tu ícono', hint: 'Sólo la marca, a pantalla completa' },
                    ]}
                    onChange={(v) => onChange({ splash: v as IconDesign['splash'] })}
                />
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {solidSplash
                        ? 'La app abre con tu color de pantalla completa y tu marca en el centro. Para que no se vea el borde de un círculo, el fondo del ícono queda de un solo color. En algunos teléfonos la barra de abajo de la app también toma ese color.'
                        : 'Android abre la app con tu ícono en un círculo sobre el fondo de la app (blanco o gris oscuro según el modo). Las barras del teléfono quedan neutras.'}
                </p>
            </div>

            {!isSuggested && suggestion && (
                <Button type="button" variant="ghost" size="sm" onClick={onReset} data-testid="icon-reset">
                    <RotateCcw className="imcrm-h-4 imcrm-w-4" /> Volver a la sugerencia
                </Button>
            )}
        </>
    );
}

function LegacyBackground({ brand, onChange }: { brand: PlatformBrand; onChange: (patch: Partial<PlatformBrand>) => void }): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5">
            <Label htmlFor="brand-icon-bg">Fondo del ícono</Label>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <button
                    type="button"
                    aria-pressed={brand.icon_background_auto}
                    data-testid="brand-icon-bg-auto"
                    onClick={() => onChange({ icon_background_auto: true })}
                    className={cn(
                        'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-text-xs',
                        brand.icon_background_auto && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-2 imcrm-ring-offset-background',
                    )}
                >
                    <span
                        aria-hidden
                        className="imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded-full imcrm-border imcrm-border-border"
                        style={{ background: `linear-gradient(135deg, ${APP_BAR_NEUTRAL.light} 50%, ${APP_BAR_NEUTRAL.dark} 50%)` }}
                    />
                    Igual al de la app
                </button>
                {LEGACY_BG_PRESETS.map((c) => {
                    const on = !brand.icon_background_auto && brand.icon_background === c;
                    return (
                        <button
                            key={c}
                            type="button"
                            aria-label={`Fondo ${c}`}
                            aria-pressed={on}
                            onClick={() => onChange({ icon_background: c, icon_background_auto: false })}
                            className={cn(
                                'imcrm-h-7 imcrm-w-7 imcrm-rounded-full imcrm-border imcrm-border-border',
                                on && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-2 imcrm-ring-offset-background',
                            )}
                            style={{ background: c }}
                        />
                    );
                })}
                <input
                    id="brand-icon-bg"
                    type="color"
                    aria-label="Otro color de fondo"
                    value={brand.icon_background}
                    onChange={(e) => onChange({ icon_background: e.target.value, icon_background_auto: false })}
                    className="imcrm-h-7 imcrm-w-10 imcrm-cursor-pointer imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-transparent"
                />
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {brand.icon_background_auto
                    ? 'Tu logo, pequeño, sobre blanco en modo claro y gris oscuro en modo oscuro. Sirve para logos de varios colores; para la mayoría se ve mejor «Ícono de app».'
                    : 'Rellena el ícono en el teléfono. Al abrir la app, Android lo muestra como un círculo de este color.'}
            </p>
        </div>
    );
}

// ─── Vistas previas ─────────────────────────────────────────────────────────

function IconPreviews({ brand, previews, name }: { brand: PlatformBrand; previews: Previews | null; name: string }): JSX.Element {
    const mask = previews?.mask ?? brand.icons?.maskable_192 ?? FACTORY_ICON;
    const maskDark = previews?.maskDark ?? (previews ? previews.mask : brand.icons?.maskable_dark_192 ?? mask);
    const apple = previews?.apple ?? brand.icons?.apple_180 ?? '/apple-touch-icon.png';
    const tile = previews?.tile ?? brand.icons?.icon_192 ?? '/pwa/icon-192.png';
    const fav = previews?.favicon ?? brand.icons?.favicon_32 ?? '/favicon-32.png';
    const design = brand.icon_design;
    const splashColor = design && design.splash === 'icon' ? design.bg_from : null;
    return (
        <div className="imcrm-grid imcrm-gap-4 lg:imcrm-grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" data-testid="brand-icon-preview">
            <figure className="imcrm-space-y-2">
                <div
                    className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-center imcrm-gap-5 imcrm-rounded-2xl imcrm-px-5 imcrm-py-6"
                    style={{ background: 'linear-gradient(160deg, #5c7ba1 0%, #34465f 55%, #1c2533 100%)' }}
                >
                    <HomeIcon src={mask} shape="circle" label={name} testId="preview-android-circle" />
                    <HomeIcon src={mask} shape="squircle" label={name} testId="preview-android-squircle" />
                    <HomeIcon src={apple} shape="ios" label={name} testId="preview-iphone" />
                </div>
                <figcaption className="imcrm-text-xs imcrm-text-muted-foreground">
                    En el inicio del teléfono (Android lo recorta en círculo o cuadrado redondeado según la marca del teléfono; iPhone, en cuadrado).
                </figcaption>
            </figure>
            <figure className="imcrm-space-y-2">
                <div className="imcrm-flex imcrm-items-end imcrm-justify-center imcrm-gap-4 imcrm-rounded-2xl imcrm-bg-muted/60 imcrm-px-4 imcrm-py-4">
                    <PhoneSplash src={mask} bg={splashColor ?? APP_BAR_NEUTRAL.light} label="Claro" testId="preview-open-light" />
                    <PhoneSplash src={maskDark} bg={splashColor ?? APP_BAR_NEUTRAL.dark} label="Oscuro" testId="preview-open-dark" />
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-pb-5">
                        <img src={tile} alt="" className="imcrm-h-14 imcrm-w-14" data-testid="preview-desktop" />
                        <span className="imcrm-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-t-lg imcrm-border imcrm-border-b-0 imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-text-[11px]">
                            <img src={fav} alt="" className="imcrm-h-4 imcrm-w-4" data-testid="preview-favicon" />
                            <span className="imcrm-max-w-[72px] imcrm-truncate">{brand.app_name}</span>
                        </span>
                    </div>
                </div>
                <figcaption className="imcrm-text-xs imcrm-text-muted-foreground">
                    Al abrir la app en Android, en el computador y en la pestaña del navegador.
                </figcaption>
            </figure>
        </div>
    );
}

/**
 * El ícono maskable visto en el inicio: el teléfono muestra los 2/3 centrales
 * (por eso la imagen va a 1,5 veces el tamaño del recorte).
 */
function HomeIcon({ src, shape, label, testId }: { src: string; shape: 'circle' | 'squircle' | 'ios'; label: string; testId: string }): JSX.Element {
    const radius = shape === 'circle' ? '50%' : shape === 'squircle' ? '32%' : '23%';
    return (
        <div className="imcrm-flex imcrm-w-[72px] imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
            <span
                className="imcrm-relative imcrm-block imcrm-h-14 imcrm-w-14 imcrm-overflow-hidden"
                style={{ borderRadius: radius, boxShadow: '0 4px 12px rgba(0,0,0,0.28)' }}
                data-testid={testId}
            >
                {shape === 'ios' ? (
                    <img src={src} alt="" className="imcrm-h-full imcrm-w-full" />
                ) : (
                    <img
                        src={src}
                        alt=""
                        className="imcrm-absolute imcrm-left-1/2 imcrm-top-1/2 imcrm-h-[84px] imcrm-w-[84px] imcrm-max-w-none -imcrm-translate-x-1/2 -imcrm-translate-y-1/2"
                    />
                )}
            </span>
            <span className="imcrm-w-full imcrm-truncate imcrm-text-center imcrm-text-[11px] imcrm-font-medium imcrm-text-white/95" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                {label}
            </span>
        </div>
    );
}

/** Cómo abre Android 12+ la app instalada: el ícono en un círculo sobre el color de apertura. */
function PhoneSplash({ src, bg, label, testId }: { src: string; bg: string; label: string; testId: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
            <div
                className="imcrm-flex imcrm-h-36 imcrm-w-[72px] imcrm-items-center imcrm-justify-center imcrm-rounded-[14px] imcrm-border-[3px] imcrm-border-[#1f1f23] imcrm-shadow-imcrm-md"
                style={{ background: bg }}
                data-testid={testId}
                data-bg={bg}
            >
                <span className="imcrm-relative imcrm-block imcrm-h-9 imcrm-w-9 imcrm-overflow-hidden imcrm-rounded-full">
                    <img src={src} alt="" className="imcrm-absolute imcrm-left-1/2 imcrm-top-1/2 imcrm-h-[54px] imcrm-w-[54px] imcrm-max-w-none -imcrm-translate-x-1/2 -imcrm-translate-y-1/2" />
                </span>
            </div>
            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>
        </div>
    );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

function Segmented({
    value,
    options,
    onChange,
    testId,
}: {
    value: string;
    options: Array<{ value: string; label: string; hint?: string }>;
    onChange: (value: string) => void;
    testId: string;
}): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-[repeat(auto-fit,minmax(170px,1fr))]" role="radiogroup" data-testid={testId}>
            {options.map((o) => {
                const on = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-value={o.value}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            'imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                            on ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                        )}
                    >
                        <span className="imcrm-text-sm imcrm-font-medium">{o.label}</span>
                        {o.hint && <span className="imcrm-text-xs imcrm-text-muted-foreground">{o.hint}</span>}
                    </button>
                );
            })}
        </div>
    );
}

function ColorInput({ label, value, onChange, testId }: { label: string; value: string; onChange: (c: string) => void; testId: string }): JSX.Element {
    return (
        <label className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
            {label}
            <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-h-8 imcrm-w-11 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-transparent"
                data-testid={testId}
            />
        </label>
    );
}

function Warn({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-warning-foreground">
            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
            <span>{children}</span>
        </p>
    );
}

function PickButton({ label, busy, onPick }: { label: string; busy: boolean; onPick: (file: File) => void }): JSX.Element {
    const ref = useRef<HTMLInputElement>(null);
    return (
        <>
            <input
                ref={ref}
                type="file"
                accept={ACCEPT}
                className="imcrm-hidden"
                data-testid="brand-icon-input"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onPick(file);
                }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
                {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ImageUp className="imcrm-h-4 imcrm-w-4" />}
                {busy ? 'Preparando…' : label}
            </Button>
        </>
    );
}

/** Un segundo color para el degradado: el mismo, un poco más oscuro. */
function shadeHex(hex: string): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const k = 0.78;
    const r = Math.round(((n >> 16) & 255) * k);
    const g = Math.round(((n >> 8) & 255) * k);
    const b = Math.round((n & 255) * k);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
