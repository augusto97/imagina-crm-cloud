import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    APP_BAR_NEUTRAL,
    ICON_SCALE_MAX,
    ICON_SCALE_MIN,
    iconBackgrounds,
    type IconArtKind,
    type IconDesign,
    type PlatformBrand,
} from '@imagina-base/shared';
import { AlertTriangle, ArrowRight, Check, ImageUp, Info, Loader2, Moon, RotateCcw, Sparkles, Sun, Trash2 } from 'lucide-react';

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
import { isWideArt, lowContrastWhiteArt, suggestIconDesign, type ArtworkAnalysis, type RgbaImage } from '@/lib/iconDesign';
import { cn } from '@/lib/utils';

import {
    ANDROID_DARK_SPLASH,
    chooseBgKind,
    chooseSplash,
    iconBgKind,
    lightSplashColor,
    studioSummary,
    type IconBgKind,
    type StudioNotice,
} from './iconStudioState';

/**
 * El estudio del ícono (Plataforma → Marca).
 *
 * v0.1.343 — el ícono de la app instalada deja de ser «el logo sobre un plato
 * blanco»: la app lo arma como un ícono de app (fondo de color de borde a
 * borde y el dibujo centrado) a partir del logo.
 *
 * v0.1.345 — rehecho en TRES PASOS, cada uno con su vista previa al lado:
 * 1) qué lleva encima, 2) el fondo (un color, degradado o sin fondo, con lo
 * elegido marcado) y 3) cómo abre la app en Android. Lo que se ve elegido es
 * siempre lo que se dibuja (ver `iconStudioState.ts`), y la apertura en modo
 * oscuro se muestra como la pinta Android de verdad: con su propio fondo casi
 * negro, que ninguna app instalada desde la web puede cambiar.
 * Nada se sube hasta guardar: los tamaños se generan en ese momento.
 */

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const FACTORY_ICON = '/pwa/icon-maskable-192.png';
const NEUTRAL_SWATCHES = ['#ffffff', '#18181b'];
const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const HEX_RE = /^#[0-9a-f]{6}$/i;

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

/** El dibujo preparado para cada tipo («sólo la marca», «logo completo»…), una vez por original. */
function useArt(source: Source | null): (kind: IconArtKind) => PreparedIconArt {
    const cache = useRef(new Map<IconArtKind, PreparedIconArt>());
    useEffect(() => {
        cache.current.clear();
    }, [source]);
    return (kind) => {
        let art = cache.current.get(kind);
        if (!art) {
            art = prepareIconArt(source!.pixels, source!.analysis, kind);
            cache.current.set(kind, art);
        }
        return art;
    };
}

interface Previews {
    /** El ícono de Android (de borde a borde): el inicio del teléfono y la apertura. */
    mask: string;
    /** En «Sin fondo», el de modo oscuro (fondo gris oscuro). */
    maskDark: string;
    apple: string;
    tile: string;
    favicon: string;
}

function renderPreviews(source: Source, brand: PlatformBrand, art: (k: IconArtKind) => PreparedIconArt): Previews | null {
    try {
        const design = brand.icon_design;
        if (design) {
            const a = art(design.art);
            const mask = renderDesignedIconCanvas(a, 'mask', 192, design).toDataURL('image/png');
            return {
                mask,
                maskDark: mask,
                apple: renderDesignedIconCanvas(a, 'apple', 180, design).toDataURL('image/png'),
                tile: renderDesignedIconCanvas(a, 'tile', 192, design).toDataURL('image/png'),
                favicon: renderDesignedIconCanvas(a, 'favicon', 32, design).toDataURL('image/png'),
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
    const art = useArt(source);
    const design = brand.icon_design;
    const suggestion = useMemo(() => (source ? suggestIconDesign(source.analysis) : null), [source]);
    const [notice, setNotice] = useState<StudioNotice | null>(null);

    // Lo último elegido, para volver de «Sin fondo» o de «Un color» sin perderlo.
    const lastDesign = useRef<IconDesign | null>(design);
    const lastGradientTo = useRef<string | null>(design?.bg_to ?? null);
    useEffect(() => {
        if (design) lastDesign.current = design;
        if (design?.bg_to) lastGradientTo.current = design.bg_to;
    }, [design]);

    useEffect(() => {
        if (!source || !suggestion || autoSuggestFor === null || source.url !== autoSuggestFor) return;
        onChange({ icon_design: suggestion });
        onAutoSuggested();
    }, [source, suggestion, autoSuggestFor, onChange, onAutoSuggested]);

    const previews = useMemo(
        () => (source ? renderPreviews(source, brand, art) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [source, brand.icon_design, brand.icon_background, brand.icon_background_auto],
    );

    const setDesign = (patch: Partial<IconDesign>): void => {
        if (!design) return;
        setNotice(null);
        onChange({ icon_design: { ...design, ...patch } });
    };

    const kind = iconBgKind(brand);
    const pickKind = (next: IconBgKind): void => {
        const change = chooseBgKind(brand, next, {
            suggestion,
            lastDesign: lastDesign.current,
            lastGradientTo: lastGradientTo.current,
            fallbackGradientTo: (from) => source?.analysis.palette?.to ?? shadeHex(from),
        });
        setNotice(change.notice);
        onChange(change.patch);
    };
    const pickSplash = (splash: IconDesign['splash']): void => {
        if (!design) return;
        const res = chooseSplash(design, splash);
        setNotice(res.notice);
        onChange({ icon_design: res.design });
    };

    const hasIcon = brand.icon_source_url !== null;
    const fallbackMask = brand.icons?.maskable_192 ?? FACTORY_ICON;
    const shown: Previews = previews ?? {
        mask: fallbackMask,
        maskDark: brand.icons?.maskable_dark_192 ?? fallbackMask,
        apple: brand.icons?.apple_180 ?? '/apple-touch-icon.png',
        tile: brand.icons?.icon_192 ?? '/pwa/icon-192.png',
        favicon: brand.icons?.favicon_32 ?? '/favicon-32.png',
    };

    return (
        <div className="imcrm-space-y-4" data-testid="icon-studio">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <span className="imcrm-relative imcrm-block imcrm-h-12 imcrm-w-12 imcrm-shrink-0 imcrm-overflow-hidden imcrm-rounded-[28%] imcrm-ring-1 imcrm-ring-border">
                    <img src={shown.mask} alt="" className="imcrm-absolute imcrm-left-1/2 imcrm-top-1/2 imcrm-h-[72px] imcrm-w-[72px] imcrm-max-w-none -imcrm-translate-x-1/2 -imcrm-translate-y-1/2" />
                </span>
                <PickButton busy={busy} label={hasIcon ? 'Cambiar ícono' : 'Subir ícono'} onPick={onPickIcon} />
                {hasIcon && (
                    <Button type="button" variant="ghost" size="sm" onClick={onRemoveIcon}>
                        <Trash2 className="imcrm-h-4 imcrm-w-4" /> Quitar
                    </Button>
                )}
                {error && <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>}
            </div>

            {source && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs" data-testid="icon-summary">
                    <span className="imcrm-mr-0.5 imcrm-text-muted-foreground">Elegido:</span>
                    {studioSummary(brand).map((s) => (
                        <span key={s} className="imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-font-medium">
                            {s}
                        </span>
                    ))}
                </div>
            )}

            {!source ? (
                <Step n={null} title="Así se ve hoy" description="Sube el símbolo de tu marca para armar el ícono.">
                    <HomePreviews previews={shown} name={brand.app_name} />
                </Step>
            ) : (
                <>
                    <Step
                        n={1}
                        title="Qué lleva el ícono encima"
                        description="El dibujo que va en el centro. Debajo eliges el fondo."
                        testId="icon-step-art"
                    >
                        {design ? (
                            <ArtStep design={design} source={source} art={art} onChange={setDesign} />
                        ) : (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                Con «Sin fondo» se usa tu logo tal cual, más pequeño. Para elegir el dibujo, elige «Un color» o
                                «Degradado» en el paso 2.
                            </p>
                        )}
                    </Step>

                    <Step
                        n={2}
                        title="El fondo del ícono"
                        description="Lo que llena el ícono de borde a borde."
                        testId="icon-step-bg"
                        aside={<HomePreviews previews={shown} name={brand.app_name} />}
                    >
                        <BackgroundStep
                            brand={brand}
                            kind={kind}
                            source={source}
                            art={art}
                            suggestion={suggestion}
                            lastGradientTo={lastGradientTo.current}
                            notice={notice === 'bg-to-solid' ? notice : null}
                            onKind={pickKind}
                            onChange={setDesign}
                            onLegacy={onChange}
                        />
                    </Step>

                    <Step
                        n={3}
                        title="Al abrir la app en Android"
                        description="La primera pantalla, antes de que la app cargue. La dibuja el teléfono."
                        testId="icon-step-splash"
                        aside={<SplashPreviews brand={brand} previews={shown} />}
                    >
                        <SplashStep brand={brand} notice={notice === 'splash-to-app' ? notice : null} onSplash={pickSplash} />
                    </Step>

                    {design && suggestion && JSON.stringify(suggestion) !== JSON.stringify(design) && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setNotice(null);
                                onChange({ icon_design: suggestion });
                            }}
                            data-testid="icon-reset"
                        >
                            <RotateCcw className="imcrm-h-4 imcrm-w-4" /> Volver al ícono sugerido
                        </Button>
                    )}
                    {!design && suggestion && (
                        <div
                            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-xs"
                            data-testid="icon-upgrade"
                        >
                            <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                            <span className="imcrm-min-w-[200px] imcrm-flex-1">
                                Prueba el <strong>ícono sugerido</strong>: lo armamos con los colores de tu logo, de borde a
                                borde, como el de una app nativa.
                            </span>
                            <Button type="button" size="sm" onClick={() => onChange({ icon_design: suggestion })} data-testid="icon-upgrade-btn">
                                Ver el ícono sugerido
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ─── Paso 1: el dibujo ─────────────────────────────────────────────────────

function ArtStep({
    design,
    source,
    art,
    onChange,
}: {
    design: IconDesign;
    source: Source;
    art: (k: IconArtKind) => PreparedIconArt;
    onChange: (patch: Partial<IconDesign>) => void;
}): JSX.Element {
    const a = source.analysis;
    const kinds: Array<{ value: IconArtKind; label: string; hint: string }> = [];
    if (a.shape !== 'free') kinds.push({ value: 'mark', label: 'Sólo la marca, en blanco', hint: 'El color del emblema pasa a ser el fondo' });
    kinds.push({ value: 'logo', label: 'El logo completo', hint: 'Con sus colores' });
    if (a.shape === 'free') kinds.push({ value: 'white', label: 'El logo en blanco', hint: 'Para un símbolo de un solo color' });
    const thumbs = useMemo(() => {
        const out: Partial<Record<IconArtKind, string>> = {};
        for (const k of kinds) {
            try {
                out[k.value] = renderDesignedIconCanvas(art(k.value), 'mask', 96, { ...design, art: k.value }).toDataURL('image/png');
            } catch {
                /* sin miniatura */
            }
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, design.bg_from, design.bg_to, design.bg_angle, design.splash, design.scale]);
    return (
        <div className="imcrm-space-y-4">
            <ChoiceCards
                testId="icon-art"
                label="Dibujo"
                value={design.art}
                options={kinds.map((k) => ({ ...k, visual: <Thumb src={thumbs[k.value]} /> }))}
                onChange={(v) => onChange({ art: v as IconArtKind })}
            />
            <div className="imcrm-space-y-1.5">
                <div className="imcrm-flex imcrm-max-w-sm imcrm-items-center imcrm-justify-between">
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
        </div>
    );
}

// ─── Paso 2: el fondo ──────────────────────────────────────────────────────

function BackgroundStep({
    brand,
    kind,
    source,
    art,
    suggestion,
    lastGradientTo,
    notice,
    onKind,
    onChange,
    onLegacy,
}: {
    brand: PlatformBrand;
    kind: IconBgKind;
    source: Source;
    art: (k: IconArtKind) => PreparedIconArt;
    suggestion: IconDesign | null;
    lastGradientTo: string | null;
    notice: StudioNotice | null;
    onKind: (k: IconBgKind) => void;
    onChange: (patch: Partial<IconDesign>) => void;
    onLegacy: (patch: Partial<PlatformBrand>) => void;
}): JSX.Element {
    const design = brand.icon_design;
    const base = design ?? suggestion;
    const palette = source.analysis.palette;
    const thumbs = useMemo(() => {
        if (!base) return {} as Partial<Record<IconBgKind, string>>;
        const a = art(base.art);
        const render = (d: IconDesign): string | undefined => {
            try {
                return renderDesignedIconCanvas(a, 'mask', 96, d).toDataURL('image/png');
            } catch {
                return undefined;
            }
        };
        let none: string | undefined;
        try {
            none = renderIconCanvas(source.img, 'maskable_192', APP_BAR_NEUTRAL.light).toDataURL('image/png');
        } catch {
            none = undefined;
        }
        return {
            color: render({ ...base, bg_to: null }),
            gradient: render({ ...base, splash: 'app', bg_to: base.bg_to ?? lastGradientTo ?? palette?.to ?? shadeHex(base.bg_from) }),
            none,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, base?.art, base?.bg_from, base?.bg_to, base?.bg_angle, base?.scale, lastGradientTo]);

    return (
        <div className="imcrm-space-y-4">
            <ChoiceCards
                testId="icon-bg-kind"
                label="Tipo de fondo"
                value={kind}
                columns={3}
                options={[
                    { value: 'color', label: 'Un color', hint: 'Lo más limpio', visual: <Thumb src={thumbs.color} /> },
                    { value: 'gradient', label: 'Degradado', hint: 'Dos colores', visual: <Thumb src={thumbs.gradient} /> },
                    { value: 'none', label: 'Sin fondo', hint: 'Tu logo sobre blanco', visual: <Thumb src={thumbs.none} /> },
                ]}
                onChange={(v) => onKind(v as IconBgKind)}
            />

            {notice === 'bg-to-solid' && (
                <Notice testId="icon-notice-solid">
                    Como elegiste abrir la app con el color de tu ícono (paso 3), el fondo quedó de <strong>un solo color</strong>: con un
                    degradado se notaría el borde del ícono al abrir.
                </Notice>
            )}

            {design && kind === 'color' && (
                <div className="imcrm-space-y-2" data-testid="icon-bg-color">
                    <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">Color del fondo</p>
                    <Swatches
                        value={design.bg_from}
                        colors={uniqueColors([palette?.from, palette?.to, ...NEUTRAL_SWATCHES])}
                        logoColors={uniqueColors([palette?.from, palette?.to])}
                        onChange={(c) => onChange({ bg_from: c, bg_to: null })}
                    />
                </div>
            )}

            {design && kind === 'gradient' && (
                <div className="imcrm-space-y-3" data-testid="icon-bg-gradient-controls">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-4">
                        <ColorField label="Color inicial" value={design.bg_from} onChange={(c) => onChange({ bg_from: c })} testId="icon-bg-from" />
                        <ColorField label="Color final" value={design.bg_to!} onChange={(c) => onChange({ bg_to: c })} testId="icon-bg-to" />
                        {palette?.to && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="icon-bg-from-logo"
                                onClick={() => onChange({ bg_from: palette.from, bg_to: palette.to, bg_angle: palette.angle })}
                            >
                                Usar los colores de tu logo
                            </Button>
                        )}
                    </div>
                    <div
                        className="imcrm-h-3 imcrm-w-full imcrm-max-w-sm imcrm-rounded-full imcrm-ring-1 imcrm-ring-border"
                        style={{ background: `linear-gradient(90deg, ${design.bg_from}, ${design.bg_to})` }}
                        aria-hidden
                    />
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
                </div>
            )}

            {kind === 'none' && (
                <div className="imcrm-space-y-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="icon-bg-none">
                    <p>
                        Tu logo, más pequeño, sobre blanco (y sobre gris oscuro en modo oscuro). Sirve para logos de muchos colores;
                        para la mayoría se ve mejor «Un color».
                    </p>
                    {!brand.icon_background_auto && (
                        <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5">
                                Hoy usa el fondo
                                <span className="imcrm-h-3.5 imcrm-w-3.5 imcrm-rounded-full imcrm-ring-1 imcrm-ring-border" style={{ background: brand.icon_background }} />
                                <code>{brand.icon_background}</code>
                            </span>
                            <button
                                type="button"
                                className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                onClick={() => onLegacy({ icon_background_auto: true })}
                            >
                                Usar el de la app
                            </button>
                        </p>
                    )}
                </div>
            )}

            {design && lowContrastWhiteArt(design) && (
                <Warn>El dibujo blanco casi no se ve sobre un fondo tan claro: elige un color más oscuro o «El logo completo» en el paso 1.</Warn>
            )}
        </div>
    );
}

// ─── Paso 3: la apertura ───────────────────────────────────────────────────

function SplashStep({
    brand,
    notice,
    onSplash,
}: {
    brand: PlatformBrand;
    notice: StudioNotice | null;
    onSplash: (s: IconDesign['splash']) => void;
}): JSX.Element {
    const design = brand.icon_design;
    return (
        <div className="imcrm-space-y-4">
            {design ? (
                <ChoiceCards
                    testId="icon-splash"
                    label="Fondo al abrir"
                    value={design.splash}
                    options={[
                        {
                            value: 'icon',
                            label: 'Con el color de tu ícono',
                            hint: 'En modo claro, la pantalla entera de tu color',
                            visual: <MiniPhone bg={design.bg_from} />,
                        },
                        {
                            value: 'app',
                            label: 'Sobre el fondo de la app',
                            hint: 'Tu ícono sobre blanco',
                            visual: <MiniPhone bg="#ffffff" />,
                        },
                    ]}
                    onChange={(v) => onSplash(v as IconDesign['splash'])}
                />
            ) : (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    Con «Sin fondo», la app abre sobre el fondo blanco de la app. Para abrir con un color, elige «Un color» en el paso 2.
                </p>
            )}

            {notice === 'splash-to-app' && (
                <Notice testId="icon-notice-splash">
                    Como elegiste un <strong>degradado</strong> (paso 2), la app abre sobre el fondo de la app: con un degradado se notaría
                    el borde del ícono sobre tu color.
                </Notice>
            )}

            <div
                className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/50 imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground"
                data-testid="icon-dark-note"
            >
                <Moon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                <span>
                    <strong className="imcrm-text-foreground">En modo oscuro, Android usa su propio fondo, casi negro,</strong> y pone tu
                    ícono encima. Eso no lo puede cambiar ninguna app instalada desde la web: Chrome no lo permite. Tu color se ve
                    cuando el teléfono está en <strong>modo claro</strong>.
                </span>
            </div>
        </div>
    );
}

// ─── Vistas previas ─────────────────────────────────────────────────────────

function HomePreviews({ previews, name }: { previews: Previews; name: string }): JSX.Element {
    return (
        <figure className="imcrm-space-y-2" data-testid="brand-icon-preview">
            <div
                className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-center imcrm-gap-4 imcrm-rounded-2xl imcrm-px-4 imcrm-py-5"
                style={{ background: 'linear-gradient(160deg, #5c7ba1 0%, #34465f 55%, #1c2533 100%)' }}
            >
                <HomeIcon src={previews.mask} shape="circle" label={name} testId="preview-android-circle" />
                <HomeIcon src={previews.mask} shape="squircle" label={name} testId="preview-android-squircle" />
                <HomeIcon src={previews.apple} shape="ios" label={name} testId="preview-iphone" />
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-4 imcrm-rounded-2xl imcrm-bg-muted/60 imcrm-px-4 imcrm-py-3">
                <img src={previews.tile} alt="" className="imcrm-h-12 imcrm-w-12" data-testid="preview-desktop" />
                <span className="imcrm-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-t-lg imcrm-border imcrm-border-b-0 imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-text-[11px]">
                    <img src={previews.favicon} alt="" className="imcrm-h-4 imcrm-w-4" data-testid="preview-favicon" />
                    <span className="imcrm-max-w-[96px] imcrm-truncate">{name}</span>
                </span>
            </div>
            <figcaption className="imcrm-text-xs imcrm-text-muted-foreground">
                En el inicio del teléfono (cada marca de teléfono lo recorta en círculo o cuadrado redondeado), en el computador y en la
                pestaña del navegador.
            </figcaption>
        </figure>
    );
}

function SplashPreviews({ brand, previews }: { brand: PlatformBrand; previews: Previews }): JSX.Element {
    const light = lightSplashColor(brand);
    return (
        <figure className="imcrm-space-y-2">
            <div className="imcrm-flex imcrm-items-end imcrm-justify-center imcrm-gap-5 imcrm-rounded-2xl imcrm-bg-muted/60 imcrm-px-4 imcrm-py-4">
                <PhoneSplash src={previews.mask} bg={light} label="Modo claro" icon={<Sun className="imcrm-h-3 imcrm-w-3" />} testId="preview-open-light" />
                <PhoneSplash
                    src={previews.maskDark}
                    bg={ANDROID_DARK_SPLASH}
                    label="Modo oscuro"
                    note="Fondo de Android"
                    icon={<Moon className="imcrm-h-3 imcrm-w-3" />}
                    testId="preview-open-dark"
                />
            </div>
            <figcaption className="imcrm-text-xs imcrm-text-muted-foreground">Así abre la app instalada en Android.</figcaption>
        </figure>
    );
}

/** El ícono maskable visto en el inicio: el teléfono muestra los 2/3 centrales. */
function HomeIcon({ src, shape, label, testId }: { src: string; shape: 'circle' | 'squircle' | 'ios'; label: string; testId: string }): JSX.Element {
    const radius = shape === 'circle' ? '50%' : shape === 'squircle' ? '32%' : '23%';
    return (
        <div className="imcrm-flex imcrm-w-[64px] imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
            <span
                className="imcrm-relative imcrm-block imcrm-h-12 imcrm-w-12 imcrm-overflow-hidden"
                style={{ borderRadius: radius, boxShadow: '0 4px 12px rgba(0,0,0,0.28)' }}
                data-testid={testId}
            >
                {shape === 'ios' ? (
                    <img src={src} alt="" className="imcrm-h-full imcrm-w-full" />
                ) : (
                    <img
                        src={src}
                        alt=""
                        className="imcrm-absolute imcrm-left-1/2 imcrm-top-1/2 imcrm-h-[72px] imcrm-w-[72px] imcrm-max-w-none -imcrm-translate-x-1/2 -imcrm-translate-y-1/2"
                    />
                )}
            </span>
            <span className="imcrm-w-full imcrm-truncate imcrm-text-center imcrm-text-[11px] imcrm-font-medium imcrm-text-white/95" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                {label}
            </span>
        </div>
    );
}

/** Cómo abre Android 12+ la app instalada: el ícono en un círculo sobre el fondo de apertura. */
function PhoneSplash({
    src,
    bg,
    label,
    note,
    icon,
    testId,
}: {
    src: string;
    bg: string;
    label: string;
    note?: string;
    icon: ReactNode;
    testId: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
            <div
                className="imcrm-relative imcrm-flex imcrm-h-40 imcrm-w-20 imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-[16px] imcrm-border-[3px] imcrm-border-[#1f1f23] imcrm-shadow-imcrm-md"
                style={{ background: bg }}
                data-testid={testId}
                data-bg={bg}
            >
                <span className="imcrm-absolute imcrm-left-1/2 imcrm-top-1 imcrm-h-1 imcrm-w-6 -imcrm-translate-x-1/2 imcrm-rounded-full imcrm-bg-[#1f1f23]/70" aria-hidden />
                <span className="imcrm-relative imcrm-block imcrm-h-10 imcrm-w-10 imcrm-overflow-hidden imcrm-rounded-full">
                    <img src={src} alt="" className="imcrm-absolute imcrm-left-1/2 imcrm-top-1/2 imcrm-h-[60px] imcrm-w-[60px] imcrm-max-w-none -imcrm-translate-x-1/2 -imcrm-translate-y-1/2" />
                </span>
            </div>
            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-font-medium">
                {icon}
                {label}
            </span>
            {note && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{note}</span>}
        </div>
    );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

function Step({
    n,
    title,
    description,
    aside,
    children,
    testId,
}: {
    n: number | null;
    title: string;
    description: string;
    aside?: ReactNode;
    children: ReactNode;
    testId?: string;
}): JSX.Element {
    return (
        <section className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-4" data-testid={testId}>
            <div className="imcrm-mb-3 imcrm-flex imcrm-items-start imcrm-gap-2.5">
                {n !== null && (
                    <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-xs imcrm-font-semibold imcrm-text-primary-foreground">
                        {n}
                    </span>
                )}
                <div>
                    <h4 className="imcrm-text-sm imcrm-font-semibold">{title}</h4>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{description}</p>
                </div>
            </div>
            {aside ? (
                <div className="imcrm-grid imcrm-gap-5 lg:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
                    <div className="imcrm-min-w-0">{children}</div>
                    <div className="imcrm-min-w-0">{aside}</div>
                </div>
            ) : (
                children
            )}
        </section>
    );
}

interface ChoiceOption {
    value: string;
    label: string;
    hint?: string;
    visual?: ReactNode;
}

/** Opciones excluyentes con lo elegido bien marcado (borde, fondo y un círculo con check). */
function ChoiceCards({
    value,
    options,
    onChange,
    label,
    testId,
    columns = 2,
}: {
    value: string;
    options: ChoiceOption[];
    onChange: (value: string) => void;
    label: string;
    testId: string;
    columns?: 2 | 3;
}): JSX.Element {
    return (
        <div
            className={cn('imcrm-grid imcrm-gap-2', columns === 3 ? 'sm:imcrm-grid-cols-3' : 'sm:imcrm-grid-cols-2')}
            role="radiogroup"
            aria-label={label}
            data-testid={testId}
        >
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
                            'imcrm-relative imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-transition-colors',
                            on
                                ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                : 'imcrm-border-border hover:imcrm-border-foreground/30 hover:imcrm-bg-accent',
                        )}
                    >
                        {o.visual}
                        <span className="imcrm-min-w-0 imcrm-flex-1">
                            <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{o.label}</span>
                            {o.hint && <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{o.hint}</span>}
                        </span>
                        <span
                            aria-hidden
                            className={cn(
                                'imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border',
                                on ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border',
                            )}
                        >
                            {on && <Check className="imcrm-h-3 imcrm-w-3" strokeWidth={3} />}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function Thumb({ src }: { src: string | undefined }): JSX.Element {
    return (
        <span className="imcrm-relative imcrm-block imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-overflow-hidden imcrm-rounded-[28%] imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
            {src && (
                <img src={src} alt="" className="imcrm-absolute imcrm-left-1/2 imcrm-top-1/2 imcrm-h-[60px] imcrm-w-[60px] imcrm-max-w-none -imcrm-translate-x-1/2 -imcrm-translate-y-1/2" />
            )}
        </span>
    );
}

function MiniPhone({ bg }: { bg: string }): JSX.Element {
    return (
        <span
            aria-hidden
            className="imcrm-flex imcrm-h-11 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border-2 imcrm-border-[#1f1f23]"
            style={{ background: bg }}
        >
            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-[#1f1f23]/25 imcrm-ring-1 imcrm-ring-white/60" />
        </span>
    );
}

/** Colores rápidos (los de tu logo primero) + otro color, con lo elegido marcado. */
function Swatches({
    value,
    colors,
    logoColors,
    onChange,
}: {
    value: string;
    colors: string[];
    logoColors: string[];
    onChange: (c: string) => void;
}): JSX.Element {
    const v = value.toLowerCase();
    const custom = !colors.includes(v);
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2" role="radiogroup" aria-label="Color del fondo" data-testid="icon-bg-swatches">
            {colors.map((c) => {
                const on = c === v;
                return (
                    <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${logoColors.includes(c) ? 'Color de tu logo' : c === '#ffffff' ? 'Blanco' : 'Negro'} ${c}`}
                        title={logoColors.includes(c) ? `Color de tu logo · ${c}` : c}
                        onClick={() => onChange(c)}
                        className={cn(
                            'imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-border',
                            on && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-2 imcrm-ring-offset-background',
                        )}
                        style={{ background: c }}
                    >
                        {on && <Check className="imcrm-h-4 imcrm-w-4" strokeWidth={3} style={{ color: inkOn(c) }} />}
                    </button>
                );
            })}
            <ColorField label={custom ? 'Otro color (elegido)' : 'Otro color'} value={v} onChange={onChange} testId="icon-bg-from" compact highlighted={custom} />
        </div>
    );
}

/** Un color: el cuadro para elegirlo + el código hex escribible. */
function ColorField({
    label,
    value,
    onChange,
    testId,
    compact = false,
    highlighted = false,
}: {
    label: string;
    value: string;
    onChange: (c: string) => void;
    testId: string;
    compact?: boolean;
    highlighted?: boolean;
}): JSX.Element {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    const commit = (): void => {
        const t = text.trim().toLowerCase();
        const hex = t.startsWith('#') ? t : `#${t}`;
        if (HEX_RE.test(hex)) onChange(hex);
        else setText(value);
    };
    return (
        <label
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-text-xs imcrm-text-muted-foreground',
                compact && 'imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-1',
                highlighted && 'imcrm-border-primary imcrm-ring-1 imcrm-ring-primary',
            )}
        >
            <span className={compact ? '' : 'imcrm-sr-only sm:imcrm-not-sr-only'}>{label}</span>
            <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="imcrm-h-7 imcrm-w-9 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-transparent"
                data-testid={testId}
            />
            <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                    }
                }}
                aria-label={`${label}, código`}
                spellCheck={false}
                className="imcrm-h-7 imcrm-w-[76px] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-foreground"
                data-testid={`${testId}-hex`}
            />
        </label>
    );
}

function Notice({ children, testId }: { children: ReactNode; testId: string }): JSX.Element {
    return (
        <p
            className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-2.5 imcrm-text-xs"
            role="status"
            data-testid={testId}
        >
            <Info className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
            <span>{children}</span>
        </p>
    );
}

function Warn({ children }: { children: ReactNode }): JSX.Element {
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

function uniqueColors(list: Array<string | null | undefined>): string[] {
    const out: string[] = [];
    for (const c of list) {
        const v = c?.toLowerCase();
        if (v && HEX_RE.test(v) && !out.includes(v)) out.push(v);
    }
    return out;
}

/** Tinta legible sobre un color (para el check de la muestra). */
function inkOn(hex: string): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#18181b' : '#ffffff';
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
