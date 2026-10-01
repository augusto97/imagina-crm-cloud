import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from 'lucide-react';

import { HexInput } from '@/admin/template-editor-core/BlockStyleEditor';
import { Select } from '@/components/ui/select';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.231 — Piezas chicas del inspector del editor de la ficha: grupos
 * plegables, filas con etiqueta, selectores de campo (uno o varios, con
 * orden), segmentados y color. Todo controlado: el inspector escribe en la
 * plantilla con cada cambio (y el historial agrupa lo que se tipea).
 */

export function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }): JSX.Element {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="imcrm-border-b imcrm-border-border last:imcrm-border-b-0">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground hover:imcrm-text-foreground"
                aria-expanded={open}
            >
                {title}
                <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform', !open && 'imcrm--rotate-90')} />
            </button>
            {open && <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-px-3 imcrm-pb-3">{children}</div>}
        </section>
    );
}

/** La etiqueta de la fila, para nombrar al control de adentro (una fila puede tener varios botones: no es un `<label>`). */
const RowLabel = createContext<string | undefined>(undefined);
function useRowLabel(own?: string): string | undefined {
    const ctx = useContext(RowLabel);
    return own ?? ctx;
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
    const id = useId();
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" role="group" aria-labelledby={id}>
            <span id={id} className="imcrm-text-xs imcrm-font-medium imcrm-text-foreground">
                {label}
            </span>
            <RowLabel.Provider value={label}>{children}</RowLabel.Provider>
            {hint && <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</span>}
        </div>
    );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
            <input type="checkbox" className="imcrm-mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span className="imcrm-flex imcrm-flex-col">
                <span className="imcrm-text-xs imcrm-font-medium">{label}</span>
                {hint && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>}
            </span>
        </label>
    );
}

export function Segmented<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
}: {
    value: T;
    options: Array<{ value: T; label: string; icon?: ReactNode }>;
    onChange: (v: T) => void;
    ariaLabel: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-0.5" role="radiogroup" aria-label={ariaLabel}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-whitespace-nowrap imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-[11px] [&>svg]:imcrm-h-3.5 [&>svg]:imcrm-w-3.5',
                        value === o.value ? 'imcrm-bg-card imcrm-font-semibold imcrm-text-foreground imcrm-shadow-imcrm-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                    )}
                >
                    {o.icon}
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** Un campo (o ninguno). `allow` filtra por tipo. */
export function FieldSelect({
    fields,
    value,
    onChange,
    allow,
    emptyLabel = __('— Elegí un campo —'),
    ariaLabel,
}: {
    fields: FieldEntity[];
    value: number | undefined;
    onChange: (id: number | undefined) => void;
    allow?: (f: FieldEntity) => boolean;
    emptyLabel?: string;
    ariaLabel?: string;
}): JSX.Element {
    const eligible = allow ? fields.filter(allow) : fields;
    const label = useRowLabel(ariaLabel);
    return (
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className="imcrm-h-8 imcrm-text-sm" aria-label={label}>
            <option value="">{emptyLabel}</option>
            {eligible.map((f) => (
                <option key={f.id} value={f.id}>
                    {f.label}
                </option>
            ))}
        </Select>
    );
}

/** Varios campos, en orden: los elegidos arriba (con subir/bajar/quitar) y un "+ Agregar". */
export function FieldChecklist({
    fields,
    value,
    onChange,
    allow,
    max,
    addLabel = __('Agregar campo'),
}: {
    fields: FieldEntity[];
    value: number[];
    onChange: (ids: number[]) => void;
    allow?: (f: FieldEntity) => boolean;
    max?: number;
    addLabel?: string;
}): JSX.Element {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const chosen = value.map((id) => byId.get(id)).filter((f): f is FieldEntity => f !== undefined);
    const available = (allow ? fields.filter(allow) : fields).filter((f) => !value.includes(f.id));
    const move = (i: number, d: -1 | 1): void => {
        const next = [...value];
        const j = i + d;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange(next);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            {chosen.length === 0 && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Ninguno elegido.')}</p>}
            {chosen.map((f, i) => {
                const Icon = fieldTypeIcon(f.type);
                return (
                    <div key={f.id} className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-py-1">
                        <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-xs">{f.label}</span>
                        <Mini label={__('Subir')} onClick={() => move(i, -1)} disabled={i === 0}>
                            <ArrowUp />
                        </Mini>
                        <Mini label={__('Bajar')} onClick={() => move(i, 1)} disabled={i === chosen.length - 1}>
                            <ArrowDown />
                        </Mini>
                        <Mini label={__('Quitar')} onClick={() => onChange(value.filter((x) => x !== f.id))}>
                            <X />
                        </Mini>
                    </div>
                );
            })}
            {available.length > 0 && (max === undefined || value.length < max) && (
                <div className="imcrm-relative">
                    <Plus className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 imcrm--translate-y-1/2 imcrm-text-muted-foreground" />
                    <Select value="" onChange={(e) => e.target.value && onChange([...value, Number(e.target.value)])} className="imcrm-h-8 imcrm-pl-7 imcrm-text-xs" aria-label={addLabel}>
                        <option value="">{addLabel}</option>
                        {available.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                </div>
            )}
        </div>
    );
}

function Mini({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-30 [&>svg]:imcrm-h-3 [&>svg]:imcrm-w-3"
        >
            {children}
        </button>
    );
}

const SWATCHES = ['#2a5bd7', '#0e7490', '#0f9f6e', '#65a30d', '#d97706', '#d9622b', '#dc2626', '#db2777', '#7c3aed', '#475569', '#0f172a'];

/** Color hex de 6 dígitos (el schema no acepta el corto) o ninguno. */
export function ColorField({ value, onChange, noneLabel = __('Automático') }: { value: string | null | undefined; onChange: (v: string | null) => void; noneLabel?: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    className={cn('imcrm-rounded-md imcrm-border imcrm-px-1.5 imcrm-text-[10px]', !value ? 'imcrm-border-primary imcrm-text-foreground' : 'imcrm-border-border imcrm-text-muted-foreground')}
                >
                    {noneLabel}
                </button>
                {SWATCHES.map((c) => (
                    <button
                        key={c}
                        type="button"
                        title={c}
                        aria-label={c}
                        onClick={() => onChange(c)}
                        className={cn('imcrm-h-5 imcrm-w-5 imcrm-rounded-full imcrm-ring-offset-1 imcrm-ring-offset-card', value === c && 'imcrm-ring-2 imcrm-ring-primary')}
                        style={{ background: c }}
                    />
                ))}
            </div>
            <HexInput
                value={value ?? undefined}
                onCommit={(hex) => onChange(hex ? expandHex(hex) : null)}
                className="imcrm-h-8 imcrm-font-mono imcrm-text-xs"
                ariaLabel={__('Color en hexadecimal')}
            />
        </div>
    );
}

export function expandHex(hex: string): string {
    const h = hex.toLowerCase();
    return /^#[0-9a-f]{3}$/.test(h) ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

export function NumberInput({ value, onChange, min, max, placeholder, ariaLabel }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; placeholder?: string; ariaLabel?: string }): JSX.Element {
    const label = useRowLabel(ariaLabel);
    return (
        <input
            type="number"
            value={value ?? ''}
            min={min}
            max={max}
            placeholder={placeholder}
            aria-label={label}
            onChange={(e) => {
                if (e.target.value === '') return onChange(undefined);
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
            }}
            className="imcrm-h-8 imcrm-w-full imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-2.5 imcrm-text-sm"
        />
    );
}

export function TextInput({ value, onChange, placeholder, ariaLabel, multiline = false }: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; multiline?: boolean }): JSX.Element {
    const label = useRowLabel(ariaLabel);
    const cls = 'imcrm-w-full imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-2.5 imcrm-text-sm';
    return multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} rows={4} className={cn(cls, 'imcrm-py-1.5 imcrm-leading-relaxed')} />
    ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className={cn(cls, 'imcrm-h-8')} />
    );
}
