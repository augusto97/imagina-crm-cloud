import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, BookmarkPlus, ChevronRight, Paintbrush, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { useSaveStylePresets, useStylePresets, type StylePreset } from '@/hooks/useStylePresets';
import {
    blockStyleCss,
    hasBlockStyle,
    type BlockStyle,
    type StyleAlign,
    type StyleScale,
    type StyleShadow,
    type StyleSize,
    type StyleWeight,
} from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Presets built-in — siempre disponibles, no editables. */
const BUILTIN_PRESETS: StylePreset[] = [
    { name: __('Tarjeta clara'), style: { bg: '#ffffff', border: '#e2e8f0', radius: 'lg', shadow: 'sm' } },
    { name: __('Banda oscura'), style: { bg: '#0f172a', text: '#f8fafc', radius: 'lg', pad: 'lg' } },
    { name: __('Suave'), style: { bg: '#f8fafc', radius: 'md' } },
    { name: __('Destacado'), style: { bg: '#eff6ff', border: '#dbeafe', radius: 'lg', pad: 'lg' } },
    { name: __('Aviso cálido'), style: { bg: '#fefce8', border: '#fef3c7', radius: 'md' } },
];

/**
 * Sección "Diseño" del inspector — UNIVERSAL para todos los bloques de
 * ambos editores (registro CRM y portal). Edita `config.style`:
 * fondo, color de texto, borde, relleno, esquinas, sombra y alineación.
 */

/** Paleta curada: neutros + tonos suaves + acentos. Hex plano para que
 * el portal (que no comparte los CSS vars del admin) pinte idéntico. */
const SWATCHES: string[] = [
    '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#0f172a', '#1e293b',
    '#eff6ff', '#dbeafe', '#2563eb', '#ecfdf5', '#d1fae5', '#059669',
    '#fefce8', '#fef3c7', '#d97706', '#fef2f2', '#fee2e2', '#dc2626',
    '#faf5ff', '#ede9fe', '#7c3aed', '#fdf2f8', '#0e7490', '#115e59',
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface Props {
    value: BlockStyle;
    onChange: (next: BlockStyle) => void;
}

export function BlockStyleEditor({ value, onChange }: Props): JSX.Element {
    const set = (patch: Partial<BlockStyle>): void => {
        const next: BlockStyle = { ...value, ...patch };
        // Claves con undefined se eliminan para no ensuciar el JSON.
        for (const k of Object.keys(next) as Array<keyof BlockStyle>) {
            if (next[k] === undefined) delete next[k];
        }
        onChange(next);
    };

    return (
        <details
            className="imcrm-group imcrm-mt-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas [&[open]]:imcrm-bg-card [&[open]]:imcrm-shadow-imcrm-sm"
            open={hasBlockStyle(value)}
        >
            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2.5 imcrm-text-[12px] imcrm-font-semibold imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform imcrm-duration-150 group-open:imcrm-rotate-90" />
                <Paintbrush className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                {__('Diseño')}
                {hasBlockStyle(value) && (
                    <span className="imcrm-ml-auto imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-1.5 imcrm-text-[9px] imcrm-font-bold imcrm-uppercase imcrm-text-primary">
                        {__('Personalizado')}
                    </span>
                )}
            </summary>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3.5 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-3">
                <PresetsRow current={value} onApply={onChange} />

                <ColorRow
                    label={__('Fondo')}
                    value={value.bg}
                    onChange={(bg) => set({ bg })}
                />
                <ColorRow
                    label={__('Color de texto')}
                    value={value.text}
                    onChange={(text) => set({ text })}
                />
                <ColorRow
                    label={__('Borde')}
                    value={value.border}
                    onChange={(border) => set({ border })}
                />

                <Segmented<StyleScale>
                    label={__('Relleno')}
                    value={value.pad}
                    options={[
                        { v: 'none', l: __('0') },
                        { v: 'sm', l: 'S' },
                        { v: 'md', l: 'M' },
                        { v: 'lg', l: 'L' },
                        { v: 'xl', l: 'XL' },
                    ]}
                    onChange={(pad) => set({ pad })}
                />
                <Segmented<StyleScale>
                    label={__('Esquinas')}
                    value={value.radius}
                    options={[
                        { v: 'none', l: __('0') },
                        { v: 'sm', l: 'S' },
                        { v: 'md', l: 'M' },
                        { v: 'lg', l: 'L' },
                        { v: 'xl', l: 'XL' },
                    ]}
                    onChange={(radius) => set({ radius })}
                />
                <Segmented<StyleShadow>
                    label={__('Sombra')}
                    value={value.shadow}
                    options={[
                        { v: 'none', l: __('0') },
                        { v: 'sm', l: 'S' },
                        { v: 'md', l: 'M' },
                        { v: 'lg', l: 'L' },
                    ]}
                    onChange={(shadow) => set({ shadow })}
                />
                <Segmented<StyleSize>
                    label={__('Tamaño de texto')}
                    value={value.size}
                    options={[
                        { v: 'sm', l: 'A⁻' },
                        { v: 'md', l: 'A' },
                        { v: 'lg', l: 'A⁺' },
                        { v: 'xl', l: 'A²' },
                        { v: '2xl', l: 'A³' },
                    ]}
                    onChange={(size) => set({ size })}
                />
                <Segmented<StyleWeight>
                    label={__('Peso')}
                    value={value.weight}
                    options={[
                        { v: 'normal', l: __('Fino') },
                        { v: 'medium', l: __('Medio') },
                        { v: 'semibold', l: __('Semi') },
                        { v: 'bold', l: __('Bold') },
                    ]}
                    onChange={(weight) => set({ weight })}
                />

                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                        {__('Alineación')}
                    </span>
                    <div className="imcrm-inline-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5">
                        {(
                            [
                                { v: 'left', icon: AlignLeft, l: __('Izquierda') },
                                { v: 'center', icon: AlignCenter, l: __('Centro') },
                                { v: 'right', icon: AlignRight, l: __('Derecha') },
                            ] as Array<{ v: StyleAlign; icon: typeof AlignLeft; l: string }>
                        ).map((o) => (
                            <button
                                key={o.v}
                                type="button"
                                aria-label={o.l}
                                title={o.l}
                                aria-pressed={value.align === o.v}
                                onClick={() => set({ align: value.align === o.v ? undefined : o.v })}
                                className={cn(
                                    'imcrm-flex imcrm-h-6 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded',
                                    value.align === o.v
                                        ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                                        : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                )}
                            >
                                <o.icon className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        ))}
                    </div>
                </div>

                {hasBlockStyle(value) && (
                    <button
                        type="button"
                        onClick={() => onChange({})}
                        className="imcrm-self-start imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground imcrm-underline-offset-2 hover:imcrm-text-destructive hover:imcrm-underline"
                    >
                        {__('Restablecer diseño')}
                    </button>
                )}
            </div>
        </details>
    );
}

/** Fila de color: swatches curados + hex libre + limpiar. */
function ColorRow({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string | undefined;
    onChange: (next: string | undefined) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                    {label}
                </span>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <Input
                        value={value ?? ''}
                        onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === '') {
                                onChange(undefined);
                                return;
                            }
                            const hex = raw.startsWith('#') ? raw : `#${raw}`;
                            if (HEX_RE.test(hex)) onChange(hex.toLowerCase());
                        }}
                        placeholder="#hex"
                        className="imcrm-h-7 imcrm-w-20 imcrm-font-mono imcrm-text-[11px]"
                        aria-label={`${label} hex`}
                    />
                    {value !== undefined && (
                        <button
                            type="button"
                            onClick={() => onChange(undefined)}
                            className="imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                            aria-label={`${__('Quitar')} ${label}`}
                        >
                            {__('Quitar')}
                        </button>
                    )}
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {SWATCHES.map((hex) => (
                    <button
                        key={hex}
                        type="button"
                        aria-label={hex}
                        title={hex}
                        onClick={() => onChange(hex)}
                        className={cn(
                            'imcrm-h-5 imcrm-w-5 imcrm-rounded imcrm-border imcrm-transition-transform hover:imcrm-scale-110',
                            value === hex
                                ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/40'
                                : 'imcrm-border-border',
                        )}
                        style={{ backgroundColor: hex }}
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * Presets: built-ins + los guardados del workspace. Click aplica el
 * estilo completo; "Guardar actual" persiste el estilo del bloque
 * seleccionado como preset de marca (compartido por todo el equipo).
 */
function PresetsRow({
    current,
    onApply,
}: {
    current: BlockStyle;
    onApply: (style: BlockStyle) => void;
}): JSX.Element {
    const presets = useStylePresets();
    const save = useSaveStylePresets();
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');

    const custom = presets.data ?? [];

    const saveCurrent = (): void => {
        const trimmed = name.trim();
        if (trimmed === '' || !hasBlockStyle(current)) return;
        const next = [
            ...custom.filter((p) => p.name !== trimmed),
            { name: trimmed, style: current },
        ].slice(0, 24);
        save.mutate(next);
        setNaming(false);
        setName('');
    };

    const removePreset = (presetName: string): void => {
        save.mutate(custom.filter((p) => p.name !== presetName));
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                    {__('Presets')}
                </span>
                {hasBlockStyle(current) && !naming && (
                    <button
                        type="button"
                        onClick={() => setNaming(true)}
                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[10px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    >
                        <BookmarkPlus className="imcrm-h-3 imcrm-w-3" />
                        {__('Guardar actual')}
                    </button>
                )}
            </div>
            {naming && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={__('Nombre del preset')}
                        className="imcrm-h-7 imcrm-flex-1 imcrm-text-[11px]"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                saveCurrent();
                            }
                            if (e.key === 'Escape') setNaming(false);
                        }}
                    />
                    <button
                        type="button"
                        onClick={saveCurrent}
                        disabled={name.trim() === '' || save.isPending}
                        className="imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary disabled:imcrm-opacity-50"
                    >
                        {__('Guardar')}
                    </button>
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {[...BUILTIN_PRESETS, ...custom].map((p, i) => {
                    const isCustom = i >= BUILTIN_PRESETS.length;
                    return (
                        <span key={`${isCustom ? 'c' : 'b'}-${p.name}`} className="imcrm-group/preset imcrm-relative imcrm-inline-flex">
                            <button
                                type="button"
                                onClick={() => onApply({ ...p.style })}
                                title={__('Aplicar preset')}
                                className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-[10px] imcrm-font-medium imcrm-transition-transform hover:imcrm-scale-105"
                                style={blockStyleCss({ ...p.style, pad: 'none', shadow: p.style.shadow ?? 'none' })}
                            >
                                {p.name}
                            </button>
                            {isCustom && (
                                <button
                                    type="button"
                                    aria-label={`${__('Eliminar preset')} ${p.name}`}
                                    onClick={() => removePreset(p.name)}
                                    className="imcrm-absolute imcrm--right-1 imcrm--top-1 imcrm-hidden imcrm-h-3.5 imcrm-w-3.5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-muted-foreground group-hover/preset:imcrm-flex hover:imcrm-text-destructive"
                                >
                                    <X className="imcrm-h-2 imcrm-w-2" />
                                </button>
                            )}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T | undefined;
    options: Array<{ v: T; l: string }>;
    onChange: (next: T | undefined) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                {label}
            </span>
            <div className="imcrm-inline-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5">
                {options.map((o) => (
                    <button
                        key={o.v}
                        type="button"
                        aria-pressed={value === o.v}
                        onClick={() => onChange(value === o.v ? undefined : o.v)}
                        className={cn(
                            'imcrm-h-6 imcrm-min-w-[26px] imcrm-rounded imcrm-px-1.5 imcrm-text-[10px] imcrm-font-semibold',
                            value === o.v
                                ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                                : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        {o.l}
                    </button>
                ))}
            </div>
        </div>
    );
}
