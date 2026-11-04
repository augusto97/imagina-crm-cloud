import { useMemo } from 'react';
import { Check, Moon, SunMoon } from 'lucide-react';
import {
    fontStack,
    mixHex,
    publicThemePresets,
    resolvePublicPalettes,
    type PublicTheme,
    type PublicThemePreset,
} from '@imagina-base/shared';

import { useDesignFontFaces } from '@/components/design/DesignStyleControls';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.351 (ADR-S94) — Galería de plantillas de diseño. Cada miniatura se
 * DIBUJA con CSS a partir del tema (fondo, tarjeta, título, dos campos y el
 * botón con el acento), así se ve el estilo real sin pedir imágenes.
 */

const SHADOW: Record<string, string> = {
    none: 'none',
    sm: '0 1px 2px rgba(16,24,40,.12)',
    md: '0 2px 8px rgba(16,24,40,.14)',
    lg: '0 6px 16px rgba(16,24,40,.22)',
};

/** Esquinas de la miniatura (la escala es ~1/3 de la página real). */
function mini(r: number, max = 8): number {
    return Math.max(0, Math.min(max, Math.round(r / 3)));
}

export function ThemeThumb({ theme, brand, className }: { theme: PublicTheme; brand: string; className?: string }): JSX.Element {
    const p = resolvePublicPalettes(theme, brand).main;
    const plain = theme.layout.container === 'plain';
    const bg = theme.background;
    const layers: string[] = [];
    const ink = p.text;
    if (bg.pattern === 'dots') layers.push(`radial-gradient(${mixHex(p.background, ink, 0.22)} 0.8px, transparent 1px) 0 0/6px 6px`);
    if (bg.pattern === 'grid')
        layers.push(
            `linear-gradient(${mixHex(p.background, ink, 0.14)} 1px, transparent 1px) 0 0/8px 8px`,
            `linear-gradient(90deg, ${mixHex(p.background, ink, 0.14)} 1px, transparent 1px) 0 0/8px 8px`,
        );
    if (bg.pattern === 'diagonal') layers.push(`repeating-linear-gradient(45deg, ${mixHex(p.background, ink, 0.14)} 0 1px, transparent 1px 5px)`);
    if (bg.kind === 'gradient') layers.push(`linear-gradient(${bg.gradient_angle}deg, ${p.background}, ${bg.gradient_to ?? mixHex(p.background, p.accent, 0.35)})`);
    else if (bg.kind === 'image') layers.push(`linear-gradient(160deg, ${mixHex(p.background, p.accent, 0.25)}, ${mixHex(p.background, '#000000', 0.25)})`);
    else layers.push(p.background);

    const inputStyle = theme.inputs.style;
    const inputRadius = inputStyle === 'pill' ? 999 : mini(theme.inputs.radius, 6);
    const field = (key: number) => (
        <div key={key} className="imcrm-flex imcrm-flex-col imcrm-gap-[2px]">
            <span className="imcrm-block imcrm-h-[2px] imcrm-w-[34%] imcrm-rounded-full" style={{ background: p.muted, opacity: 0.8 }} />
            <span
                className="imcrm-block imcrm-h-[7px] imcrm-w-full"
                style={{
                    background: inputStyle === 'filled' ? mixHex(p.card, p.text, 0.08) : inputStyle === 'underline' ? 'transparent' : p.input_bg,
                    border: inputStyle === 'underline' ? 'none' : `1px solid ${inputStyle === 'filled' ? 'transparent' : p.input_border}`,
                    borderBottom: `1px solid ${inputStyle === 'filled' ? 'transparent' : p.input_border}`,
                    borderRadius: inputStyle === 'underline' ? 0 : inputRadius,
                }}
            />
        </div>
    );
    const btn = theme.button;
    const btnBg = btn.style === 'filled' ? p.accent : btn.style === 'soft' ? mixHex(p.card, p.accent, 0.2) : 'transparent';
    const btnRadius = btn.radius >= 20 ? 999 : mini(btn.radius, 6);
    const center = theme.layout.header_align === 'center';

    const card = (
        <div
            className="imcrm-relative imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-[5px] imcrm-overflow-hidden"
            style={{
                background: plain ? 'transparent' : p.card,
                border: plain || theme.card.border_width === 0 ? 'none' : `1px solid ${p.border}`,
                borderRadius: plain ? 0 : mini(theme.card.radius),
                boxShadow: plain ? 'none' : SHADOW[theme.card.shadow] ?? SHADOW.md,
                padding: theme.cover.enabled ? '0 7px 7px' : '7px',
            }}
        >
            {theme.cover.enabled && (
                <span
                    className="-imcrm-mx-[7px] imcrm-block imcrm-h-[14px]"
                    style={{ background: `linear-gradient(135deg, ${p.accent}, ${mixHex(p.accent, '#000000', 0.35)})` }}
                />
            )}
            {!plain && theme.layout.band && !theme.cover.enabled && (
                <span className="imcrm-absolute imcrm-inset-x-0 imcrm-top-0 imcrm-h-[2px]" style={{ background: p.accent }} />
            )}
            <span
                className={cn('imcrm-block imcrm-truncate imcrm-text-[10px] imcrm-leading-none', center && 'imcrm-text-center')}
                style={{
                    color: p.text,
                    fontFamily: fontStack(theme.typography.heading_font ?? theme.typography.font),
                    fontWeight: theme.typography.title_weight,
                    textTransform: 'none',
                }}
            >
                Aa
            </span>
            {field(1)}
            {field(2)}
            <span
                className={cn('imcrm-mt-[1px] imcrm-block imcrm-h-[7px]', btn.full_width ? 'imcrm-w-full' : 'imcrm-w-[40%]')}
                style={{
                    background: btn.style === 'text' ? 'transparent' : btnBg,
                    border: btn.style === 'outline' ? `1px solid ${p.accent}` : 'none',
                    borderBottom: btn.style === 'text' ? `2px solid ${p.accent}` : undefined,
                    borderRadius: btnRadius,
                    alignSelf: btn.full_width ? undefined : btn.align === 'center' || center ? 'center' : btn.align === 'right' ? 'flex-end' : 'flex-start',
                }}
            />
        </div>
    );

    return (
        <div
            className={cn('imcrm-relative imcrm-flex imcrm-aspect-[4/3] imcrm-w-full imcrm-overflow-hidden', className)}
            style={{ background: layers.join(',') }}
            aria-hidden
        >
            {theme.split.enabled && (
                <span
                    className={cn('imcrm-block imcrm-h-full imcrm-w-[42%] imcrm-shrink-0', theme.split.side === 'right' && 'imcrm-order-2')}
                    style={{ background: `linear-gradient(160deg, ${theme.split.color ?? p.accent}, ${mixHex(theme.split.color ?? p.accent, '#000000', 0.3)})` }}
                />
            )}
            <div className={cn('imcrm-flex imcrm-flex-1 imcrm-justify-center', theme.layout.vertical_center || theme.split.enabled ? 'imcrm-items-center' : 'imcrm-items-start imcrm-pt-[9%]', 'imcrm-px-[12%]')}>
                {card}
            </div>
            {theme.mode !== 'light' && (
                <span
                    className="imcrm-absolute imcrm-right-1 imcrm-top-1 imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-black/45 imcrm-text-white"
                    title={theme.mode === 'dark' ? __('Oscuro') : __('Según el dispositivo')}
                >
                    {theme.mode === 'dark' ? <Moon className="imcrm-h-2.5 imcrm-w-2.5" /> : <SunMoon className="imcrm-h-2.5 imcrm-w-2.5" />}
                </span>
            )}
        </div>
    );
}

export function ThemeGallery({
    brand,
    activeId,
    onApply,
    columns = 2,
}: {
    brand: string;
    /** 3 en el celular (a todo el ancho); 2 en el panel angosto de escritorio. */
    columns?: 2 | 3;
    /** Plantilla marcada (null = un diseño propio). */
    activeId: string | null;
    onApply: (preset: PublicThemePreset) => void;
}): JSX.Element {
    useDesignFontFaces();
    const presets = useMemo(() => publicThemePresets(brand), [brand]);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="form-design-gallery" data-testid="form-design-gallery">
            <div>
                <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Plantillas')}</p>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Toman el color de tu marca. Elige una y después retoca lo que quieras: se deshace como cualquier cambio.')}
                </p>
            </div>
            <div className={cn('imcrm-grid imcrm-gap-2', columns === 3 ? 'imcrm-grid-cols-3' : 'imcrm-grid-cols-2')}>
                {presets.map((p) => {
                    const active = activeId === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => onApply(p)}
                            title={p.description}
                            aria-pressed={active}
                            data-preset={p.id}
                            className={cn(
                                'imcrm-group imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-text-left imcrm-transition-shadow focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
                                active ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/30' : 'imcrm-border-border hover:imcrm-shadow-imcrm-sm',
                            )}
                        >
                            <ThemeThumb theme={p.theme} brand={brand} />
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-font-medium">
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{__(p.name)}</span>
                                {active && <Check className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-primary" aria-label={__('En uso')} />}
                            </span>
                        </button>
                    );
                })}
            </div>
            {activeId === null && (
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('El formulario tiene un diseño propio (ajustado a mano).')}</p>
            )}
        </div>
    );
}
