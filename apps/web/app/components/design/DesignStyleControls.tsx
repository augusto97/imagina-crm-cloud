import { useEffect, useMemo, useState } from 'react';
import { Check as CheckIcon, ChevronDown, ClipboardPaste, Copy, Info, Link2, Link2Off, RotateCcw } from 'lucide-react';
import {
    BORDER_SIDES,
    DESIGN_FONTS,
    DESIGN_FONT_DEFS,
    STYLE_CAVEATS,
    STYLE_SUPPORT,
    fontStack,
    selfHostedFontFaces,
    type BlockStyle,
    type BorderSide,
    type BorderStyle,
    type DesignFont,
    type DesignMedium,
    type ElementStyle,
    type Shadow,
    type TextTransform,
} from '@imagina-base/shared';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { HexInput, SWATCHES } from '../../admin/template-editor-core/BlockStyleEditor';

/**
 * v0.1.272 — Controles de diseño compartidos por el editor de correos y el
 * de documentos PDF (ADR-S37): tipografía, espaciado, borde, esquinas y
 * sombra con valores NUMÉRICOS tipeables. Escriben sobre `style` del bloque
 * (`blockStyleSchema`) o sobre el estilo de un elemento (`btn` del botón,
 * `frame` de la imagen). Lo que el medio no sabe dibujar no se ofrece
 * (`STYLE_SUPPORT`): en el PDF no hay esquinas redondeadas ni sombras.
 */

const UNIT: Record<DesignMedium, string> = { email: 'px', pdf: 'pt' };

// ---------------------------------------------------------------------------
// Fuentes web en la interfaz (para que cada opción se vea en SU fuente)
// ---------------------------------------------------------------------------

let fontsInjected = false;

/** Carga UNA vez las fuentes web servidas por la app (`/email-fonts/`). */
export function useDesignFontFaces(): void {
    useEffect(() => {
        if (fontsInjected || typeof document === 'undefined') return;
        fontsInjected = true;
        const el = document.createElement('style');
        el.id = 'imcrm-design-fonts';
        el.textContent = selfHostedFontFaces(DESIGN_FONTS, window.location.origin);
        document.head.appendChild(el);
    }, []);
}

// ---------------------------------------------------------------------------
// Piezas chicas
// ---------------------------------------------------------------------------

export function parseNum(raw: string): number | null | 'invalid' {
    const t = raw.trim().replace(',', '.');
    if (t === '') return null;
    if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.?$/.test(t)) return 'invalid';
    const n = Number(t);
    return Number.isFinite(n) ? n : 'invalid';
}

function fmt(n: number | null | undefined): string {
    if (n == null) return '';
    return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * Número tipeable con unidad. Vacío = automático (el `placeholder` dice qué
 * valor se usa). Flechas ↑/↓ suman el paso (con Shift, ×10). Lo que se sale
 * del rango se ajusta al salir del campo.
 */
export function NumberField({
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    unit,
    placeholder,
    className,
    hideLabel,
}: {
    label: string;
    value: number | null | undefined;
    onChange: (next: number | null) => void;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    placeholder?: string;
    className?: string;
    hideLabel?: boolean;
}): JSX.Element {
    const [draft, setDraft] = useState(fmt(value));
    const [focused, setFocused] = useState(false);
    useEffect(() => {
        if (!focused) setDraft(fmt(value));
    }, [value, focused]);
    const clamp = (n: number): number => Math.min(max, Math.max(min, n));
    const commit = (raw: string, final: boolean): void => {
        const n = parseNum(raw);
        if (n === 'invalid') return;
        if (n === null) {
            onChange(null);
            return;
        }
        if (final) {
            const c = clamp(n);
            onChange(c);
            setDraft(fmt(c));
        } else if (n >= min && n <= max) onChange(n);
    };
    const invalid = (() => {
        const n = parseNum(draft);
        return n === 'invalid' || (typeof n === 'number' && (n < min || n > max));
    })();
    return (
        <label className={cn('imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1', className)}>
            {!hideLabel && <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>}
            <span
                className={cn(
                    'imcrm-flex imcrm-h-7 imcrm-items-center imcrm-rounded-md imcrm-border imcrm-bg-card imcrm-pr-1.5 focus-within:imcrm-border-primary focus-within:imcrm-ring-2 focus-within:imcrm-ring-primary/15',
                    invalid ? 'imcrm-border-destructive' : 'imcrm-border-input',
                )}
            >
                <input
                    type="text"
                    inputMode="decimal"
                    aria-label={label}
                    value={draft}
                    placeholder={placeholder ?? __('auto')}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                        setFocused(false);
                        commit(draft, true);
                    }}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        commit(e.target.value, false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            const cur = parseNum(draft);
                            const base = typeof cur === 'number' ? cur : (parseNum(placeholder ?? '') as number) || 0;
                            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
                            const next = clamp(Math.round((base + delta) * 100) / 100);
                            setDraft(fmt(next));
                            onChange(next);
                        } else if (e.key === 'Enter') {
                            commit(draft, true);
                        }
                    }}
                    className="imcrm-h-full imcrm-w-full imcrm-min-w-0 imcrm-bg-transparent imcrm-px-2 imcrm-text-xs imcrm-tabular-nums imcrm-text-foreground placeholder:imcrm-text-muted-foreground/70 focus:imcrm-outline-none"
                />
                {unit && <span className="imcrm-shrink-0 imcrm-text-[10px] imcrm-text-muted-foreground">{unit}</span>}
            </span>
        </label>
    );
}

/**
 * Color compacto: muestra (abre colores rápidos + «Otro color…» del sistema
 * + «Sin color») y hex tipeable. v0.1.273 — el ÚNICO control de color de los
 * editores de correo y PDF (antes convivían dos con aspectos distintos).
 */
export function ColorField({
    label,
    value,
    onChange,
    placeholder,
    allowEmpty = true,
}: {
    label: string;
    value: string | null | undefined;
    onChange: (next: string | null) => void;
    placeholder?: string;
    /** false = un color obligatorio (no se ofrece «Sin color»). */
    allowEmpty?: boolean;
}): JSX.Element {
    const v = value ?? undefined;
    const [open, setOpen] = useState(false);
    const inherited = placeholder && /^#[0-9a-f]{3,8}$/i.test(placeholder) ? placeholder : null;
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1" data-testid="color-field">
            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-rounded-md imcrm-border',
                                // Sin color propio: muestra el que se usa (el de la pista), punteado.
                                v ? 'imcrm-border-input' : 'imcrm-border-dashed imcrm-border-muted-foreground/50',
                            )}
                            style={{ background: v ?? (inherited ? `${inherited} content-box` : 'repeating-conic-gradient(#d4d7dd 0% 25%, transparent 0% 50%) 50% / 8px 8px'), padding: v ? undefined : 3 }}
                            title={label}
                            aria-label={`${label} — ${__('elegir color')}`}
                        />
                    </PopoverTrigger>
                    <PopoverContent className="imcrm-w-[13.5rem] imcrm-p-2" align="start">
                        <div className="imcrm-grid imcrm-grid-cols-6 imcrm-gap-1">
                            {SWATCHES.map((hex) => (
                                <button
                                    key={hex}
                                    type="button"
                                    aria-label={hex}
                                    title={hex}
                                    onClick={() => {
                                        onChange(hex);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        'imcrm-h-7 imcrm-w-7 imcrm-rounded imcrm-border imcrm-border-border hover:imcrm-scale-110',
                                        v?.toLowerCase() === hex && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-1',
                                    )}
                                    style={{ background: hex }}
                                />
                            ))}
                        </div>
                        <div className="imcrm-mt-2 imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-2">
                            <label className="imcrm-relative imcrm-cursor-pointer imcrm-text-[11px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                {__('Otro color…')}
                                <input
                                    type="color"
                                    aria-label={`${label} — ${__('otro color')}`}
                                    value={v && v.length === 7 ? v : '#000000'}
                                    onChange={(e) => onChange(e.target.value.toLowerCase())}
                                    className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-cursor-pointer imcrm-opacity-0"
                                />
                            </label>
                            {allowEmpty && v && (
                                <button
                                    type="button"
                                    className="imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                    onClick={() => {
                                        onChange(null);
                                        setOpen(false);
                                    }}
                                >
                                    {__('Sin color')}
                                </button>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
                <HexInput
                    value={v}
                    onCommit={(n) => (n || allowEmpty ? onChange(n ?? null) : undefined)}
                    placeholder={placeholder ?? '#hex'}
                    ariaLabel={`${label} hex`}
                    className="imcrm-h-7 imcrm-min-w-0 imcrm-flex-1 imcrm-px-2 imcrm-font-mono imcrm-text-[11px]"
                />
            </div>
        </div>
    );
}

/** Botonera compacta de opciones (con una opción "auto" opcional). */
export function Choice<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: Array<{ value: T; label: string; title?: string }>;
    onChange: (v: T) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>
            <div role="group" aria-label={label} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5">
                {options.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        aria-pressed={o.value === value}
                        title={o.title ?? o.label}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            'imcrm-flex imcrm-h-6 imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-truncate imcrm-rounded imcrm-px-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground',
                            o.value === value && 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm',
                        )}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Hint({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <p className="imcrm-flex imcrm-gap-1 imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
            <Info className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
            <span>{children}</span>
        </p>
    );
}

/** Sección plegable con un punto cuando tiene valores propios y "Restablecer". */
export function StyleSection({
    title,
    modified,
    onReset,
    defaultOpen,
    children,
    testId,
}: {
    title: string;
    modified?: boolean;
    onReset?: () => void;
    defaultOpen?: boolean;
    children: React.ReactNode;
    testId?: string;
}): JSX.Element {
    const [open, setOpen] = useState(defaultOpen ?? false);
    return (
        <div className="imcrm-border-t imcrm-border-border imcrm-pt-2.5" data-testid={testId}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((o) => !o)}
                    className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform', !open && '-imcrm-rotate-90')} />
                    {title}
                    {modified && <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary" aria-label={__('con cambios')} />}
                </button>
                {modified && onReset && (
                    <button
                        type="button"
                        onClick={onReset}
                        title={__('Restablecer')}
                        aria-label={`${__('Restablecer')} ${title}`}
                        className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    >
                        <RotateCcw className="imcrm-h-3 imcrm-w-3" />
                    </button>
                )}
            </div>
            {open && <div className="imcrm-mt-2.5 imcrm-flex imcrm-flex-col imcrm-gap-2.5">{children}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Selector de tipografía
// ---------------------------------------------------------------------------

/**
 * Tipografías agrupadas (del sistema / web) y cada una escrita en SU fuente.
 * `inheritLabel` agrega la opción "la del estilo general" (valor null).
 */
export function FontSelect({
    label,
    value,
    onChange,
    medium,
    inheritLabel,
}: {
    label: string;
    value: DesignFont | null | undefined;
    onChange: (next: DesignFont | null) => void;
    medium: DesignMedium;
    inheritLabel?: string;
}): JSX.Element {
    useDesignFontFaces();
    const [open, setOpen] = useState(false);
    const groups = useMemo(
        () => [
            { title: medium === 'email' ? __('Del sistema — se ven igual en todos lados') : __('Clásicas'), fonts: DESIGN_FONTS.filter((f) => DESIGN_FONT_DEFS[f].kind === 'system') },
            {
                title: medium === 'email' ? __('Web — con fuente de respaldo') : __('Modernas'),
                fonts: DESIGN_FONTS.filter((f) => DESIGN_FONT_DEFS[f].kind === 'web'),
            },
        ],
        [medium],
    );
    const def = value ? DESIGN_FONT_DEFS[value] : null;
    const pick = (f: DesignFont | null): void => {
        onChange(f);
        setOpen(false);
    };
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={label}
                        data-testid="font-select"
                        className="imcrm-flex imcrm-h-8 imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-2 imcrm-text-left imcrm-text-sm hover:imcrm-border-input/80"
                    >
                        <span className="imcrm-truncate" style={value ? { fontFamily: fontStack(value) } : undefined}>
                            {def ? def.label : (inheritLabel ?? __('Automática'))}
                        </span>
                        <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="imcrm-w-[min(18rem,var(--radix-popover-trigger-width))] imcrm-min-w-[15rem] imcrm-p-1" align="start">
                    {inheritLabel && (
                        <FontOption label={inheritLabel} selected={value == null} onClick={() => pick(null)} />
                    )}
                    {groups.map((g) => (
                        <div key={g.title} className="imcrm-mt-1">
                            <p className="imcrm-px-2 imcrm-py-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                {g.title}
                            </p>
                            {g.fonts.map((f) => (
                                <FontOption
                                    key={f}
                                    label={DESIGN_FONT_DEFS[f].label}
                                    font={f}
                                    selected={value === f}
                                    onClick={() => pick(f)}
                                />
                            ))}
                        </div>
                    ))}
                </PopoverContent>
            </Popover>
            {def?.kind === 'web' && medium === 'email' && <Hint>{STYLE_CAVEATS.webFont}</Hint>}
            {def?.pdfLabel && medium === 'pdf' && (
                <Hint>
                    {__('En el PDF se usa')} {def.pdfLabel}.
                </Hint>
            )}
        </div>
    );
}

function FontOption({ label, font, selected, onClick }: { label: string; font?: DesignFont; selected: boolean; onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent',
                selected && 'imcrm-bg-accent/60',
            )}
        >
            <span className="imcrm-truncate" style={font ? { fontFamily: fontStack(font) } : undefined}>
                {label}
            </span>
            {selected && <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-primary" />}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Estilo de un bloque
// ---------------------------------------------------------------------------

/** Quita las claves vacías; un estilo sin nada vuelve a `undefined`. */
export function cleanStyle<T extends Record<string, unknown>>(st: T): T | undefined {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(st)) {
        if (v === null || v === undefined || v === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
    }
    return Object.keys(out).length ? (out as T) : undefined;
}

const TYPO_KEYS = ['font', 'font_size', 'font_weight', 'italic', 'line_height', 'letter_spacing', 'text_transform'] as const;
const SPACE_KEYS = ['margin_top', 'margin_bottom', 'padding_top', 'padding_right', 'padding_bottom', 'padding_left'] as const;

function hasAny(st: BlockStyle | undefined, keys: readonly string[]): boolean {
    if (!st) return false;
    return keys.some((k) => {
        const v = (st as Record<string, unknown>)[k];
        if (v == null || v === '') return false;
        if (k === 'text_transform' && v === 'none') return false;
        if (k === 'shadow' && v === 'none') return false;
        if (k === 'italic' && v === false) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
    });
}

// ---------------------------------------------------------------------------
// v0.1.273 — Secciones componibles del panel «Estilo»
// ---------------------------------------------------------------------------
//
// Cada ajuste vive en UN solo lugar: el tamaño rápido de un título (Grande /
// Mediano / Chico) y el tamaño exacto en px están en la MISMA fila; el color
// del texto y la alineación, dentro de «Texto»; el color de fondo y si ocupa
// todo el ancho o es un recuadro, juntos en «Fondo»; el espacio rápido (Poco /
// Medio / Mucho) y los márgenes exactos, juntos en «Espaciado». Los
// inspectores de correo y PDF componen estas secciones en el orden que les
// sirve; los valores rápidos que viven en el bloque (nivel, tamaño, padding)
// los resuelve el inspector con un solo `onPatch` (un paso de deshacer).

export interface StyleEditor {
    medium: DesignMedium;
    st: BlockStyle;
    /** Mezcla y limpia (vacío = automático). */
    set: (patch: Partial<BlockStyle>) => void;
    /** El estilo SIN estas claves (para armar un patch combinado). */
    without: (keys: readonly string[]) => BlockStyle | undefined;
}

export function styleEditor(medium: DesignMedium, value: BlockStyle | undefined, onChange: (next: BlockStyle | undefined) => void): StyleEditor {
    const st = value ?? {};
    const without = (keys: readonly string[]): BlockStyle | undefined => {
        const next: Record<string, unknown> = { ...st };
        for (const k of keys) delete next[k];
        return cleanStyle(next as BlockStyle);
    };
    return { medium, st, set: (patch) => onChange(cleanStyle({ ...st, ...patch })), without };
}

export const STYLE_KEYS = {
    typography: TYPO_KEYS,
    spacing: SPACE_KEYS,
    border: ['border_width', 'border_style', 'border_color', 'border_sides', 'radius', 'shadow'] as const,
    verticalSpace: ['margin_top', 'margin_bottom', 'padding_top', 'padding_bottom'] as const,
    padding: ['padding_top', 'padding_right', 'padding_bottom', 'padding_left'] as const,
} as const;

/** ¿El estilo tiene algún valor propio en estas claves? */
export function styleHasAny(st: BlockStyle | undefined, keys: readonly string[]): boolean {
    return hasAny(st, keys);
}

/** Atajo de valores rápidos («Grande / Mediano / Chico», «Poco / Medio / Mucho»). */
export interface QuickPreset {
    label: string;
    options: Array<{ value: string; label: string; title?: string }>;
    /** null = hay un valor exacto propio (ningún atajo marcado). */
    current: string | null;
    onPick: (value: string) => void;
}

function QuickRow({ preset, children }: { preset: QuickPreset; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-grid-cols-[minmax(0,1fr)_4.75rem] imcrm-items-end imcrm-gap-2">
            <Choice<string> label={preset.label} value={preset.current ?? '__custom'} options={preset.options} onChange={preset.onPick} />
            {children}
        </div>
    );
}

/**
 * «Texto»: fuente, tamaño (atajo + exacto), lo que el bloque agregue (color,
 * alineación), grosor, interlineado, letras, itálica y mayúsculas.
 */
export function TypographySection({
    editor,
    defaults,
    inheritFontLabel,
    sizePreset,
    children,
    footer,
    modified,
    onReset,
    defaultOpen,
    title,
}: {
    editor: StyleEditor;
    defaults?: { size?: number; lineHeight?: number };
    inheritFontLabel?: string;
    sizePreset?: QuickPreset;
    /** Va después del tamaño: color del texto, alineación… */
    children?: React.ReactNode;
    /** Va al final: espacio entre párrafos… */
    footer?: React.ReactNode;
    modified?: boolean;
    onReset?: () => void;
    defaultOpen?: boolean;
    title?: string;
}): JSX.Element {
    const { medium, st, set } = editor;
    const unit = UNIT[medium];
    const weight = st.font_weight != null ? String(st.font_weight) : 'auto';
    const size = (
        <NumberField
            label={sizePreset ? __('Exacto') : __('Tamaño')}
            unit={unit}
            min={6}
            max={96}
            value={st.font_size}
            onChange={(v) => set({ font_size: v })}
            placeholder={defaults?.size != null ? fmt(defaults.size) : undefined}
        />
    );
    return (
        <StyleSection
            title={title ?? __('Texto')}
            modified={modified ?? hasAny(st, TYPO_KEYS)}
            onReset={onReset ?? (() => editor.set(Object.fromEntries(TYPO_KEYS.map((k) => [k, undefined])) as Partial<BlockStyle>))}
            defaultOpen={defaultOpen}
            testId="style-typography"
        >
            <FontSelect
                label={__('Fuente')}
                value={st.font ?? null}
                onChange={(f) => set({ font: f })}
                medium={medium}
                inheritLabel={inheritFontLabel ?? __('La del estilo general')}
            />
            {sizePreset ? <QuickRow preset={sizePreset}>{size}</QuickRow> : size}
            {children}
            <Choice<string>
                label={__('Grosor')}
                value={weight}
                options={[
                    { value: 'auto', label: __('Auto') },
                    { value: '400', label: __('Normal') },
                    { value: '600', label: __('Semi') },
                    { value: '700', label: __('Negrita') },
                    { value: '800', label: __('Extra') },
                ]}
                onChange={(v) => set({ font_weight: v === 'auto' ? null : (Number(v) as BlockStyle['font_weight']) })}
            />
            {(weight === '600' || weight === '800') && medium === 'email' && <Hint>{STYLE_CAVEATS.weight}</Hint>}
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <NumberField
                    label={__('Interlineado')}
                    min={0.8}
                    max={3}
                    step={0.1}
                    value={st.line_height}
                    onChange={(v) => set({ line_height: v })}
                    placeholder={defaults?.lineHeight != null ? fmt(defaults.lineHeight) : undefined}
                />
                <NumberField label={__('Entre letras')} unit={unit} min={-3} max={20} step={0.5} value={st.letter_spacing} onChange={(v) => set({ letter_spacing: v })} placeholder="0" />
            </div>
            <div className="imcrm-grid imcrm-grid-cols-[auto_1fr] imcrm-items-end imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Estilo')}</span>
                    <button
                        type="button"
                        aria-pressed={!!st.italic}
                        onClick={() => set({ italic: st.italic ? undefined : true })}
                        className={cn(
                            'imcrm-flex imcrm-h-7 imcrm-items-center imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-text-xs imcrm-italic',
                            st.italic ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-input imcrm-text-muted-foreground',
                        )}
                    >
                        {__('Itálica')}
                    </button>
                </div>
                <Choice<TextTransform>
                    label={__('Mayúsculas')}
                    value={st.text_transform ?? 'none'}
                    options={[
                        { value: 'none', label: 'Aa', title: __('Como está escrito') },
                        { value: 'uppercase', label: 'AA', title: __('TODO EN MAYÚSCULAS') },
                        { value: 'lowercase', label: 'aa', title: __('todo en minúsculas') },
                        { value: 'capitalize', label: 'Aa Aa', title: __('Cada Palabra Con Mayúscula') },
                    ]}
                    onChange={(v) => set({ text_transform: v === 'none' ? undefined : v })}
                />
            </div>
            {footer}
        </StyleSection>
    );
}

/**
 * «Fondo»: el color (vive en el bloque) y, en el correo, si ocupa todo el
 * ancho (banda) o es un recuadro dentro de los márgenes.
 */
export function BackgroundSection({
    editor,
    background,
    onBackground,
    onReset,
    defaultOpen,
}: {
    editor: StyleEditor;
    background: string | null | undefined;
    onBackground: (next: string | null) => void;
    /** Quita el color y el modo en un solo paso. */
    onReset: () => void;
    defaultOpen?: boolean;
}): JSX.Element {
    const { medium, st, set } = editor;
    const sup = STYLE_SUPPORT[medium];
    const boxy = (st.border_width ?? 0) > 0 || (st.radius ?? 0) > 0 || (!!st.shadow && st.shadow !== 'none');
    return (
        <StyleSection title={__('Fondo')} modified={!!background || st.bg_mode != null} onReset={onReset} defaultOpen={defaultOpen} testId="style-background">
            <ColorField label={__('Color de fondo')} value={background} onChange={onBackground} placeholder={__('sin fondo')} />
            {sup.bgMode && background && (
                <Choice<'band' | 'box'>
                    label={__('El fondo ocupa')}
                    value={st.bg_mode ?? (boxy ? 'box' : 'band')}
                    options={[
                        { value: 'band', label: __('Todo el ancho'), title: __('Una banda de borde a borde del correo') },
                        { value: 'box', label: __('Un recuadro'), title: __('Una tarjeta dentro de los márgenes') },
                    ]}
                    onChange={(v) => set({ bg_mode: v })}
                />
            )}
        </StyleSection>
    );
}

/**
 * «Espaciado»: un atajo rápido opcional (vive en el bloque) + márgenes y
 * relleno exactos. Un valor exacto pisa al atajo; elegir un atajo borra los
 * exactos de arriba y abajo (eso lo resuelve `preset.onPick`).
 */
export function SpacingSection({
    editor,
    defaults,
    preset,
    modified,
    onReset,
    defaultOpen,
}: {
    editor: StyleEditor;
    defaults?: { padding?: number; margin?: number };
    preset?: QuickPreset;
    modified?: boolean;
    onReset?: () => void;
    defaultOpen?: boolean;
}): JSX.Element {
    const { medium, st, set } = editor;
    const unit = UNIT[medium];
    const mph = defaults?.margin != null ? String(defaults.margin) : undefined;
    return (
        <StyleSection
            title={__('Espaciado')}
            modified={modified ?? hasAny(st, SPACE_KEYS)}
            onReset={onReset ?? (() => set(Object.fromEntries(SPACE_KEYS.map((k) => [k, undefined])) as Partial<BlockStyle>))}
            defaultOpen={defaultOpen}
            testId="style-spacing"
        >
            {preset && <Choice<string> label={preset.label} value={preset.current ?? '__custom'} options={preset.options} onChange={preset.onPick} />}
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <NumberField label={__('Margen arriba')} unit={unit} min={0} max={160} value={st.margin_top} onChange={(v) => set({ margin_top: v })} placeholder={mph} />
                <NumberField label={__('Margen abajo')} unit={unit} min={0} max={160} value={st.margin_bottom} onChange={(v) => set({ margin_bottom: v })} placeholder={mph} />
            </div>
            <PaddingControls unit={unit} value={st} onPatch={set} placeholder={defaults?.padding} />
            <Hint>
                {preset
                    ? __('El margen separa el bloque de los demás; el relleno es el aire entre el borde y el contenido. Un número exacto manda sobre el atajo de arriba.')
                    : __('El margen separa el bloque de los demás; el relleno es el aire entre el borde y el contenido. Vacío = automático.')}
            </Hint>
        </StyleSection>
    );
}

/** «Borde, esquinas y sombra» del bloque (en el PDF, sólo «Borde»). */
export function BorderSection({ editor, title, defaultOpen }: { editor: StyleEditor; title?: string; defaultOpen?: boolean }): JSX.Element {
    const { medium, st, set } = editor;
    const sup = STYLE_SUPPORT[medium];
    const keys = STYLE_KEYS.border;
    return (
        <StyleSection
            title={title ?? (sup.shadow ? __('Borde, esquinas y sombra') : __('Borde'))}
            modified={hasAny(st, keys)}
            onReset={() => set(Object.fromEntries(keys.map((k) => [k, undefined])) as Partial<BlockStyle>)}
            defaultOpen={defaultOpen}
            testId="style-border"
        >
            <BorderControls medium={medium} value={st} onPatch={set} withSides />
        </StyleSection>
    );
}

/**
 * Sección propia de un bloque (Botón, Imagen, Línea, Disposición…) con el
 * mismo aspecto plegable que las demás.
 */
export function ElementSection({
    title,
    children,
    defaultOpen = true,
    modified,
    onReset,
    testId,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    modified?: boolean;
    onReset?: () => void;
    testId?: string;
}): JSX.Element {
    return (
        <StyleSection title={title} defaultOpen={defaultOpen} modified={modified} onReset={onReset} testId={testId}>
            {children}
        </StyleSection>
    );
}

export interface BlockStylePanelProps {
    medium: DesignMedium;
    value: BlockStyle | undefined;
    onChange: (next: BlockStyle | undefined) => void;
    /** El bloque tiene texto (título, párrafo, botón, datos, firma…). */
    typography?: boolean;
    /** Margen, relleno, borde, esquinas y sombra. */
    box?: boolean;
    /** Lo que se usa si el campo queda vacío (se muestra como pista). */
    defaults?: { size?: number; lineHeight?: number; padding?: number; margin?: number };
    /** Etiqueta de "la tipografía del estilo general". */
    inheritFontLabel?: string;
}

/**
 * Tipografía + Espaciado + Borde de una caja sin controles propios (el fondo
 * y recuadro de UNA columna). Los bloques componen las secciones de arriba.
 */
export function BlockStylePanel(p: BlockStylePanelProps): JSX.Element {
    const editor = styleEditor(p.medium, p.value, p.onChange);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5" data-testid="block-style-panel">
            {p.typography && <TypographySection editor={editor} defaults={p.defaults} inheritFontLabel={p.inheritFontLabel} />}
            {p.box && <SpacingSection editor={editor} defaults={p.defaults} />}
            {p.box && <BorderSection editor={editor} />}
        </div>
    );
}

const CLIP_KEY = 'imcrm:design-style-clip';

function readClip(): BlockStyle | null {
    try {
        const raw = sessionStorage.getItem(CLIP_KEY);
        return raw ? (JSON.parse(raw) as BlockStyle) : null;
    } catch {
        return null;
    }
}

/**
 * Copiar el diseño de un bloque y pegarlo en otro (también entre el editor
 * de correos y el de PDF: es el mismo formato; lo que el PDF no dibuja se
 * ignora). Vive en la sesión del navegador.
 */
export function DesignClipboard({ value, onPaste }: { value: BlockStyle | undefined; onPaste: (st: BlockStyle | undefined) => void }): JSX.Element {
    const toast = useToast();
    const [, bump] = useState(0);
    const clip = readClip();
    const btn =
        'imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-pointer-events-none disabled:imcrm-opacity-40';
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1" data-testid="design-clipboard">
            <span className="imcrm-mr-auto imcrm-text-[11px] imcrm-text-muted-foreground">{__('Mismo estilo en otro bloque:')}</span>
            <button
                type="button"
                className={btn}
                disabled={!value}
                title={__('Copia el texto, el espaciado y el borde de este bloque')}
                onClick={() => {
                    try {
                        sessionStorage.setItem(CLIP_KEY, JSON.stringify(value ?? {}));
                    } catch {
                        /* sin almacenamiento: no se puede copiar */
                    }
                    bump((n) => n + 1);
                    toast.success(__('Estilo copiado: elegí otro bloque y tocá «Pegar»'));
                }}
            >
                <Copy className="imcrm-h-3 imcrm-w-3" />
                {__('Copiar')}
            </button>
            <button
                type="button"
                className={btn}
                disabled={!clip}
                onClick={() => {
                    if (clip) onPaste(cleanStyle({ ...clip }));
                }}
            >
                <ClipboardPaste className="imcrm-h-3 imcrm-w-3" />
                {__('Pegar')}
            </button>
        </div>
    );
}

/** Relleno en los cuatro lados, con un candado para cambiarlos juntos. */
function PaddingControls({
    unit,
    value: st,
    onPatch,
    placeholder,
}: {
    unit: string;
    value: BlockStyle;
    onPatch: (patch: Partial<BlockStyle>) => void;
    placeholder?: number;
}): JSX.Element {
    const sides = [st.padding_top, st.padding_right, st.padding_bottom, st.padding_left];
    const allSame = sides.every((s) => s === sides[0]);
    const [linked, setLinked] = useState(allSame);
    const ph = placeholder != null ? String(placeholder) : undefined;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Relleno')}</span>
                <button
                    type="button"
                    onClick={() => setLinked((l) => !l)}
                    aria-pressed={linked}
                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10.5px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                >
                    {linked ? <Link2 className="imcrm-h-3 imcrm-w-3" /> : <Link2Off className="imcrm-h-3 imcrm-w-3" />}
                    {linked ? __('Igual en los 4 lados') : __('Por lado')}
                </button>
            </div>
            {linked ? (
                <NumberField
                    label={__('Relleno (los 4 lados)')}
                    hideLabel
                    unit={unit}
                    min={0}
                    max={160}
                    value={allSame ? sides[0] : null}
                    placeholder={ph}
                    onChange={(v) => onPatch({ padding_top: v, padding_right: v, padding_bottom: v, padding_left: v })}
                />
            ) : (
                <div className="imcrm-grid imcrm-grid-cols-4 imcrm-gap-1.5">
                    <NumberField label={__('Arriba')} unit={unit} min={0} max={160} value={st.padding_top} placeholder={ph} onChange={(v) => onPatch({ padding_top: v })} />
                    <NumberField label={__('Derecha')} unit={unit} min={0} max={160} value={st.padding_right} placeholder={ph} onChange={(v) => onPatch({ padding_right: v })} />
                    <NumberField label={__('Abajo')} unit={unit} min={0} max={160} value={st.padding_bottom} placeholder={ph} onChange={(v) => onPatch({ padding_bottom: v })} />
                    <NumberField label={__('Izquierda')} unit={unit} min={0} max={160} value={st.padding_left} placeholder={ph} onChange={(v) => onPatch({ padding_left: v })} />
                </div>
            )}
        </div>
    );
}

const SIDE_LABEL: Record<BorderSide, string> = { top: 'Arriba', right: 'Derecha', bottom: 'Abajo', left: 'Izquierda' };

/** Grosor, tipo, color, lados, esquinas y sombra (lo que el medio soporte). */
function BorderControls({
    medium,
    value: st,
    onPatch,
    withSides,
    defaultRadius,
}: {
    medium: DesignMedium;
    value: BlockStyle | ElementStyle;
    onPatch: (patch: Partial<BlockStyle>) => void;
    withSides?: boolean;
    defaultRadius?: number;
}): JSX.Element {
    const unit = UNIT[medium];
    const sup = STYLE_SUPPORT[medium];
    const has = (st.border_width ?? 0) > 0;
    const sides = ('border_sides' in st ? st.border_sides : undefined) ?? [];
    const toggleSide = (s: BorderSide): void => {
        const cur = sides.length ? sides : [...BORDER_SIDES];
        const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
        onPatch({ border_sides: next.length === 4 || next.length === 0 ? undefined : (BORDER_SIDES.filter((x) => next.includes(x)) as BorderSide[]) });
    };
    return (
        <>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <NumberField label={__('Grosor del borde')} unit={unit} min={0} max={16} step={0.5} value={st.border_width} onChange={(v) => onPatch({ border_width: v })} placeholder="0" />
                <Choice<BorderStyle>
                    label={__('Tipo de línea')}
                    value={st.border_style ?? 'solid'}
                    options={[
                        { value: 'solid', label: '———', title: __('Continua') },
                        { value: 'dashed', label: '– – –', title: __('Rayada') },
                        { value: 'dotted', label: '·····', title: __('Punteada') },
                    ]}
                    onChange={(v) => onPatch({ border_style: v === 'solid' ? undefined : v })}
                />
            </div>
            {has && (
                <>
                    <ColorField label={__('Color del borde')} value={st.border_color} onChange={(v) => onPatch({ border_color: v })} placeholder="#e5e7eb" />
                    {withSides && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Lados con borde')}</span>
                            <div className="imcrm-grid imcrm-grid-cols-4 imcrm-gap-1">
                                {BORDER_SIDES.map((s) => {
                                    const on = sides.length === 0 || sides.includes(s);
                                    return (
                                        <button
                                            key={s}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() => toggleSide(s)}
                                            className={cn(
                                                'imcrm-h-6 imcrm-rounded imcrm-border imcrm-text-[10.5px]',
                                                on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-input imcrm-text-muted-foreground',
                                            )}
                                        >
                                            {__(SIDE_LABEL[s])}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}
            {sup.radius && (
                <>
                    <NumberField
                        label={__('Esquinas redondeadas')}
                        unit={unit}
                        min={0}
                        max={60}
                        value={st.radius}
                        onChange={(v) => onPatch({ radius: v })}
                        placeholder={defaultRadius != null ? String(defaultRadius) : '0'}
                    />
                    {(st.radius ?? 0) > 0 && <Hint>{STYLE_CAVEATS.radius}</Hint>}
                </>
            )}
            {sup.shadow && (
                <>
                    <Choice<Shadow>
                        label={__('Sombra')}
                        value={st.shadow ?? 'none'}
                        options={[
                            { value: 'none', label: __('Sin') },
                            { value: 'sm', label: __('Suave') },
                            { value: 'md', label: __('Media') },
                            { value: 'lg', label: __('Fuerte') },
                        ]}
                        onChange={(v) => onPatch({ shadow: v === 'none' ? undefined : v })}
                    />
                    {st.shadow && st.shadow !== 'none' && <Hint>{STYLE_CAVEATS.shadow}</Hint>}
                </>
            )}
            {!sup.radius && <Hint>{__('El PDF dibuja esquinas rectas y sin sombra.')}</Hint>}
        </>
    );
}

// ---------------------------------------------------------------------------
// Elementos: el botón y el marco de la imagen
// ---------------------------------------------------------------------------

/** La caja de color del botón: relleno, ancho, esquinas, borde y sombra. */
export function ButtonStylePanel({
    value,
    onChange,
    fullWidth,
    defaultRadius,
    children,
    modified,
    onReset,
}: {
    value: ElementStyle | undefined;
    onChange: (next: ElementStyle | undefined) => void;
    fullWidth: boolean;
    defaultRadius: number;
    /** v0.1.273 — alineación, ancho y colores del botón, en la misma sección. */
    children?: React.ReactNode;
    modified?: boolean;
    onReset?: () => void;
}): JSX.Element {
    const e = value ?? {};
    const set = (patch: Partial<ElementStyle>): void => onChange(cleanStyle({ ...e, ...patch }));
    const keys = ['radius', 'border_width', 'border_style', 'border_color', 'shadow', 'pad_y', 'pad_x', 'width'];
    return (
        <StyleSection
            title={__('Botón')}
            modified={(modified ?? false) || hasAny(e as BlockStyle, keys)}
            onReset={onReset ?? (() => onChange(undefined))}
            defaultOpen
            testId="style-button"
        >
            {children}
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <NumberField label={__('Relleno vertical')} unit="px" min={0} max={60} value={e.pad_y} onChange={(v) => set({ pad_y: v })} placeholder="12" />
                <NumberField label={__('Relleno lateral')} unit="px" min={0} max={120} value={e.pad_x} onChange={(v) => set({ pad_x: v })} placeholder="26" />
                {!fullWidth && <NumberField label={__('Ancho fijo')} unit="px" min={40} max={720} value={e.width} onChange={(v) => set({ width: v })} placeholder={__('auto')} />}
            </div>
            <BorderControls medium="email" value={e} onPatch={(pt) => set(pt as Partial<ElementStyle>)} defaultRadius={defaultRadius} />
        </StyleSection>
    );
}

/** El marco de una imagen: borde, esquinas y sombra (en el PDF, sólo borde). */
export function ImageFramePanel({
    medium,
    value,
    onChange,
    defaultRadius,
    children,
}: {
    medium: DesignMedium;
    value: ElementStyle | undefined;
    onChange: (next: ElementStyle | undefined) => void;
    defaultRadius?: number;
    /** v0.1.273 — ancho y alineación de la imagen, en la misma sección. */
    children?: React.ReactNode;
}): JSX.Element {
    const e = value ?? {};
    const set = (patch: Partial<ElementStyle>): void => onChange(cleanStyle({ ...e, ...patch }));
    const keys = ['radius', 'border_width', 'border_style', 'border_color', 'shadow'];
    return (
        <StyleSection title={__('Imagen')} modified={hasAny(e as BlockStyle, keys)} onReset={() => onChange(undefined)} defaultOpen testId="style-frame">
            {children}
            {children && <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Marco')}</p>}
            <BorderControls medium={medium} value={e} onPatch={(pt) => set(pt as Partial<ElementStyle>)} defaultRadius={defaultRadius} />
        </StyleSection>
    );
}
