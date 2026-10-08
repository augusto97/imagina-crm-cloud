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

import { HexInput } from '../../admin/template-editor-core/BlockStyleEditor';

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

/** Color compacto: muestra + selector del sistema + hex tipeable + quitar. */
export function ColorField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string | null | undefined;
    onChange: (next: string | null) => void;
    placeholder?: string;
}): JSX.Element {
    const v = value ?? undefined;
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <label
                    className="imcrm-relative imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-cursor-pointer imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-input"
                    style={{ background: v ?? 'repeating-conic-gradient(#d4d7dd 0% 25%, transparent 0% 50%) 50% / 8px 8px' }}
                    title={label}
                >
                    <input
                        type="color"
                        aria-label={`${label} — ${__('elegir color')}`}
                        value={v && v.length === 7 ? v : '#000000'}
                        onChange={(e) => onChange(e.target.value.toLowerCase())}
                        className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-cursor-pointer imcrm-opacity-0"
                    />
                </label>
                <HexInput
                    value={v}
                    onCommit={(n) => onChange(n ?? null)}
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
const BORDER_KEYS = ['border_width', 'border_style', 'border_color', 'border_sides', 'radius', 'shadow', 'bg_mode'] as const;

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

export interface BlockStylePanelProps {
    medium: DesignMedium;
    value: BlockStyle | undefined;
    onChange: (next: BlockStyle | undefined) => void;
    /** El bloque tiene texto (título, párrafo, botón, datos, firma…). */
    typography?: boolean;
    /** Margen, relleno, borde, esquinas y sombra. */
    box?: boolean;
    /** El bloque tiene un fondo elegido (habilita banda / recuadro). */
    hasBackground?: boolean;
    /** Lo que se usa si el campo queda vacío (se muestra como pista). */
    defaults?: { size?: number; lineHeight?: number; padding?: number; margin?: number };
    /** Etiqueta de "la tipografía del estilo general". */
    inheritFontLabel?: string;
}

/**
 * Tipografía + Espaciado + Borde/esquinas/sombra de un bloque, en secciones
 * plegables. Los números son px en el correo y pt en el PDF.
 */
export function BlockStylePanel(p: BlockStylePanelProps): JSX.Element {
    const st = p.value ?? {};
    const unit = UNIT[p.medium];
    const sup = STYLE_SUPPORT[p.medium];
    const set = (patch: Partial<BlockStyle>): void => p.onChange(cleanStyle({ ...st, ...patch }));
    const reset = (keys: readonly string[]): void => {
        const next: Record<string, unknown> = { ...st };
        for (const k of keys) delete next[k];
        p.onChange(cleanStyle(next as BlockStyle));
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5" data-testid="block-style-panel">
            <StyleClipboard value={p.value} onPaste={(pasted) => p.onChange(cleanStyle({ ...pasted }))} />
            {p.typography && (
                <StyleSection title={__('Tipografía')} modified={hasAny(st, TYPO_KEYS)} onReset={() => reset(TYPO_KEYS)} testId="style-typography">
                    <TypographyControls medium={p.medium} value={st} onPatch={set} defaults={p.defaults} inheritFontLabel={p.inheritFontLabel} />
                </StyleSection>
            )}
            {p.box && (
                <StyleSection title={__('Espaciado')} modified={hasAny(st, SPACE_KEYS)} onReset={() => reset(SPACE_KEYS)} testId="style-spacing">
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <NumberField label={__('Margen arriba')} unit={unit} min={0} max={160} value={st.margin_top} onChange={(v) => set({ margin_top: v })} placeholder={p.defaults?.margin != null ? String(p.defaults.margin) : undefined} />
                        <NumberField label={__('Margen abajo')} unit={unit} min={0} max={160} value={st.margin_bottom} onChange={(v) => set({ margin_bottom: v })} placeholder={p.defaults?.margin != null ? String(p.defaults.margin) : undefined} />
                    </div>
                    <PaddingControls unit={unit} value={st} onPatch={set} placeholder={p.defaults?.padding} />
                    <Hint>{__('El margen separa el bloque de los demás; el relleno es el aire entre el borde y el contenido. Vacío = automático.')}</Hint>
                </StyleSection>
            )}
            {p.box && (
                <StyleSection
                    title={sup.shadow ? __('Borde, esquinas y sombra') : __('Borde')}
                    modified={hasAny(st, BORDER_KEYS)}
                    onReset={() => reset(BORDER_KEYS)}
                    testId="style-border"
                >
                    <BorderControls medium={p.medium} value={st} onPatch={set} withSides />
                    {sup.bgMode && p.hasBackground && (
                        <Choice<'band' | 'box'>
                            label={__('El fondo ocupa')}
                            value={st.bg_mode ?? ((st.border_width ?? 0) > 0 || (st.radius ?? 0) > 0 || (st.shadow && st.shadow !== 'none') ? 'box' : 'band')}
                            options={[
                                { value: 'band', label: __('Todo el ancho'), title: __('Una banda de borde a borde del correo') },
                                { value: 'box', label: __('Un recuadro'), title: __('Una tarjeta dentro de los márgenes') },
                            ]}
                            onChange={(v) => set({ bg_mode: v })}
                        />
                    )}
                </StyleSection>
            )}
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
function StyleClipboard({ value, onPaste }: { value: BlockStyle | undefined; onPaste: (st: BlockStyle) => void }): JSX.Element {
    const toast = useToast();
    const [, bump] = useState(0);
    const clip = readClip();
    const btn =
        'imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-pointer-events-none disabled:imcrm-opacity-40';
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-pt-2.5">
            <span className="imcrm-mr-auto imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Diseño')}</span>
            <button
                type="button"
                className={btn}
                disabled={!value}
                onClick={() => {
                    try {
                        sessionStorage.setItem(CLIP_KEY, JSON.stringify(value ?? {}));
                    } catch {
                        /* sin almacenamiento: no se puede copiar */
                    }
                    bump((n) => n + 1);
                    toast.success(__('Diseño copiado: elegí otro bloque y tocá «Pegar»'));
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
                    if (clip) onPaste(clip);
                }}
            >
                <ClipboardPaste className="imcrm-h-3 imcrm-w-3" />
                {__('Pegar')}
            </button>
        </div>
    );
}

function TypographyControls({
    medium,
    value: st,
    onPatch,
    defaults,
    inheritFontLabel,
}: {
    medium: DesignMedium;
    value: BlockStyle;
    onPatch: (patch: Partial<BlockStyle>) => void;
    defaults?: BlockStylePanelProps['defaults'];
    inheritFontLabel?: string;
}): JSX.Element {
    const unit = UNIT[medium];
    const weight = st.font_weight != null ? String(st.font_weight) : 'auto';
    return (
        <>
            <FontSelect
                label={__('Fuente')}
                value={st.font ?? null}
                onChange={(f) => onPatch({ font: f })}
                medium={medium}
                inheritLabel={inheritFontLabel ?? __('La del estilo general')}
            />
            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                <NumberField label={__('Tamaño')} unit={unit} min={6} max={96} value={st.font_size} onChange={(v) => onPatch({ font_size: v })} placeholder={defaults?.size != null ? String(defaults.size) : undefined} />
                <NumberField
                    label={__('Interlineado')}
                    min={0.8}
                    max={3}
                    step={0.1}
                    value={st.line_height}
                    onChange={(v) => onPatch({ line_height: v })}
                    placeholder={defaults?.lineHeight != null ? fmt(defaults.lineHeight) : undefined}
                />
                <NumberField label={__('Entre letras')} unit={unit} min={-3} max={20} step={0.5} value={st.letter_spacing} onChange={(v) => onPatch({ letter_spacing: v })} placeholder="0" />
            </div>
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
                onChange={(v) => onPatch({ font_weight: v === 'auto' ? null : (Number(v) as BlockStyle['font_weight']) })}
            />
            {(weight === '600' || weight === '800') && <Hint>{STYLE_CAVEATS.weight}</Hint>}
            <div className="imcrm-grid imcrm-grid-cols-[auto_1fr] imcrm-items-end imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Estilo')}</span>
                    <button
                        type="button"
                        aria-pressed={!!st.italic}
                        onClick={() => onPatch({ italic: st.italic ? undefined : true })}
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
                    onChange={(v) => onPatch({ text_transform: v === 'none' ? undefined : v })}
                />
            </div>
        </>
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
}: {
    value: ElementStyle | undefined;
    onChange: (next: ElementStyle | undefined) => void;
    fullWidth: boolean;
    defaultRadius: number;
}): JSX.Element {
    const e = value ?? {};
    const set = (patch: Partial<ElementStyle>): void => onChange(cleanStyle({ ...e, ...patch }));
    const keys = ['radius', 'border_width', 'border_style', 'border_color', 'shadow', 'pad_y', 'pad_x', 'width'];
    return (
        <StyleSection title={__('Forma del botón')} modified={hasAny(e as BlockStyle, keys)} onReset={() => onChange(undefined)} defaultOpen testId="style-button">
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
}: {
    medium: DesignMedium;
    value: ElementStyle | undefined;
    onChange: (next: ElementStyle | undefined) => void;
    defaultRadius?: number;
}): JSX.Element {
    const e = value ?? {};
    const set = (patch: Partial<ElementStyle>): void => onChange(cleanStyle({ ...e, ...patch }));
    const keys = ['radius', 'border_width', 'border_style', 'border_color', 'shadow'];
    return (
        <StyleSection title={__('Marco de la imagen')} modified={hasAny(e as BlockStyle, keys)} onReset={() => onChange(undefined)} testId="style-frame">
            <BorderControls medium={medium} value={e} onPatch={(pt) => set(pt as Partial<ElementStyle>)} defaultRadius={defaultRadius} />
        </StyleSection>
    );
}
