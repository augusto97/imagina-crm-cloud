import { useState } from 'react';
import { Check } from 'lucide-react';

import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Paleta curada de colores **preset** para opciones de select /
 * multi_select. 18 colores estilo ClickUp / Linear: saturados pero no
 * primarios, cubren el rango cromático sin chocar con la marca.
 *
 * Cada preset es un nombre estable que se persiste con la opción
 * (`config.options[i].color`) y se resuelve a HSL via las CSS vars
 * `--imcrm-opt-{name}` (base, para bg/border) y
 * `--imcrm-opt-{name}-text` (lightness forzada para legibilidad).
 *
 * Además de los presets, el campo `color` acepta cualquier **hex**
 * (ej. `#5a3fcc`) para casos donde el user quiera matchear una marca
 * o crear una paleta más específica. Los hex no usan CSS vars — se
 * computan bg/border/text en JS al momento de render.
 */
export type PresetColor =
    | 'gray'
    | 'slate'
    | 'rose'
    | 'red'
    | 'orange'
    | 'amber'
    | 'yellow'
    | 'lime'
    | 'green'
    | 'emerald'
    | 'teal'
    | 'cyan'
    | 'sky'
    | 'blue'
    | 'indigo'
    | 'violet'
    | 'fuchsia'
    | 'pink';

/** Cualquier valor de color válido: nombre de preset o hex (`#rrggbb`). */
export type OptionColor = PresetColor | string;

export const OPTION_COLORS: PresetColor[] = [
    'gray',
    'slate',
    'rose',
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'fuchsia',
    'pink',
];

const PRESET_SET = new Set<string>(OPTION_COLORS);

const LABELS: Record<PresetColor, string> = {
    gray:    'Gris',
    slate:   'Pizarra',
    rose:    'Rosa',
    red:     'Rojo',
    orange:  'Naranja',
    amber:   'Ámbar',
    yellow:  'Amarillo',
    lime:    'Lima',
    green:   'Verde',
    emerald: 'Esmeralda',
    teal:    'Teal',
    cyan:    'Cyan',
    sky:     'Cielo',
    blue:    'Azul',
    indigo:  'Índigo',
    violet:  'Violeta',
    fuchsia: 'Fucsia',
    pink:    'Magenta',
};

// ─── Helpers de tipo ──────────────────────────────────────────────────

export function isPresetColor(color: string): color is PresetColor {
    return PRESET_SET.has(color);
}

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
export function isHexColor(color: string): boolean {
    return HEX_RE.test(color);
}

/** Expande `#abc` a `#aabbcc` para uniformidad downstream. */
export function normalizeHex(hex: string): string {
    if (!isHexColor(hex)) return hex;
    if (hex.length === 4) {
        return '#' + hex.slice(1).split('').map((c) => c + c).join('');
    }
    return hex.toLowerCase();
}

// ─── Resolución a CSS values ──────────────────────────────────────────

/**
 * Devuelve un valor CSS color para `background-color` o similar.
 * Para presets: `hsl(var(--imcrm-opt-X))`. Para hex: el hex tal cual.
 */
export function colorVar(color: OptionColor | undefined | null): string | undefined {
    if (!color) return undefined;
    if (isPresetColor(color)) return `hsl(var(--imcrm-opt-${color}))`;
    if (isHexColor(color)) return normalizeHex(color);
    return undefined;
}

/**
 * Estilos inline para un chip "soft" — bg tinted 14%, border 32%,
 * text con contraste forzado.
 *
 * Para **preset**: usa CSS vars (`--imcrm-opt-X` para bg/border y
 * `--imcrm-opt-X-text` para text). Theme-aware automáticamente
 * (dark mode tiene sus propias variantes).
 *
 * Para **hex**: aplica el hex con alpha hex notation (`#xxxxxx24` =
 * 14%, `#xxxxxx52` = 32%). El text usa el HSL del hex forzando
 * lightness a ~28% (light mode) o ~72% (dark mode). El mode se
 * detecta al render via `data-imcrm-theme`; no es reactivo a cambios
 * de tema mid-session (el chip re-rendea cuando React lo hace).
 */
export function chipSoftStyle(color: OptionColor | undefined | null): React.CSSProperties | undefined {
    if (!color) return undefined;

    if (isPresetColor(color)) {
        const base = `var(--imcrm-opt-${color})`;
        const text = `var(--imcrm-opt-${color}-text)`;
        return {
            backgroundColor: `hsl(${base} / 0.14)`,
            borderColor:     `hsl(${base} / 0.32)`,
            color:           `hsl(${text})`,
        };
    }

    if (isHexColor(color)) {
        const normalized = normalizeHex(color);
        const isDark = isDarkTheme();
        return {
            backgroundColor: normalized + '24',
            borderColor:     normalized + '52',
            color:           textColorFromHex(normalized, isDark ? 72 : 28),
        };
    }

    return undefined;
}

// ─── Conversión hex → HSL para text color ─────────────────────────────

/**
 * Convierte un hex a un string `hsl(H S% L%)` forzando la lightness
 * pasada. Preserva hue y saturation del hex original. Garantiza
 * contraste AA contra el bg tintado del chip.
 */
function textColorFromHex(hex: string, forcedLightness: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return `hsl(${Math.round(h)} ${Math.round(s)}% ${forcedLightness}%)`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = HEX_RE.exec(hex);
    if (!m) return null;
    let h = m[1];
    if (! h) return null;
    if (h.length === 3) {
        h = h.split('').map((c) => c + c).join('');
    }
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
            case g: h = ((b - r) / d + 2); break;
            case b: h = ((r - g) / d + 4); break;
        }
        h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
}

function isDarkTheme(): boolean {
    if (typeof document === 'undefined') return false;
    // El plugin setea `data-imcrm-theme` en `#imcrm-root` (admin) o en
    // un container themed. Si no encontramos ninguno, asumimos light.
    const themed = document.querySelector('[data-imcrm-theme]');
    return themed?.getAttribute('data-imcrm-theme') === 'dark';
}

// ─── ColorPicker UI ───────────────────────────────────────────────────

interface ColorPickerProps {
    value: OptionColor | null | undefined;
    onChange: (next: OptionColor | null) => void;
    className?: string;
    /** Si `true`, no muestra la opción "sin color" (limpiar). */
    requireColor?: boolean;
}

export function ColorPicker({
    value,
    onChange,
    className,
    requireColor,
}: ColorPickerProps): JSX.Element {
    const [hexDraft, setHexDraft] = useState(
        value && isHexColor(value) ? value : '',
    );
    const [hexError, setHexError] = useState(false);

    const handleHexInput = (raw: string): void => {
        let next = raw.trim();
        if (next && !next.startsWith('#')) next = '#' + next;
        setHexDraft(next);
        if (next === '') {
            setHexError(false);
            return;
        }
        if (isHexColor(next)) {
            setHexError(false);
            onChange(normalizeHex(next));
        } else {
            setHexError(true);
        }
    };

    const swatchLabel = value
        ? isPresetColor(value)
            ? LABELS[value]
            : value
        : __('Sin color');

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={__('Elegir color')}
                    title={swatchLabel}
                    className={cn(
                        'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-transition-colors hover:imcrm-border-primary',
                        className,
                    )}
                >
                    {value ? (
                        <span
                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded-full"
                            style={{ backgroundColor: colorVar(value) }}
                            aria-hidden
                        />
                    ) : (
                        <span
                            className="imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-border imcrm-border-dashed imcrm-border-muted-foreground/50"
                            aria-hidden
                        />
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="imcrm-w-auto imcrm-p-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                        {__('Presets')}
                    </span>
                    <div className="imcrm-grid imcrm-grid-cols-6 imcrm-gap-1.5">
                        {OPTION_COLORS.map((color) => {
                            const selected = value === color;
                            return (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => onChange(color)}
                                    aria-label={LABELS[color]}
                                    title={LABELS[color]}
                                    className={cn(
                                        'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-transition-transform hover:imcrm-scale-110',
                                        selected && 'imcrm-ring-2 imcrm-ring-offset-2 imcrm-ring-offset-card',
                                    )}
                                    style={{
                                        backgroundColor: colorVar(color),
                                        boxShadow: selected ? `0 0 0 2px hsl(var(--imcrm-opt-${color}))` : undefined,
                                    }}
                                >
                                    {selected && (
                                        <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-white" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                    <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                        {__('Color personalizado')}
                    </span>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <input
                            type="color"
                            value={value && isHexColor(value) ? normalizeHex(value) : '#5a3fcc'}
                            onChange={(e) => {
                                const next = normalizeHex(e.target.value);
                                setHexDraft(next);
                                setHexError(false);
                                onChange(next);
                            }}
                            className="imcrm-h-8 imcrm-w-10 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-transparent"
                            aria-label={__('Color picker nativo')}
                        />
                        <Input
                            value={hexDraft}
                            onChange={(e) => handleHexInput(e.target.value)}
                            placeholder="#5a3fcc"
                            className={cn(
                                'imcrm-h-8 imcrm-flex-1 imcrm-font-mono imcrm-text-xs',
                                hexError && 'imcrm-border-destructive',
                            )}
                        />
                    </div>
                    {hexError && (
                        <p className="imcrm-text-[11px] imcrm-text-destructive">
                            {__('Hex inválido. Usá formato #rrggbb o #rgb.')}
                        </p>
                    )}
                </div>

                {!requireColor && (
                    <button
                        type="button"
                        onClick={() => {
                            setHexDraft('');
                            setHexError(false);
                            onChange(null);
                        }}
                        className="imcrm-mt-3 imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-[12px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    >
                        {__('Sin color')}
                    </button>
                )}
            </PopoverContent>
        </Popover>
    );
}
