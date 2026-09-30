import { useState } from 'react';
import { Check, Copy, ExternalLink, Mail, Phone } from 'lucide-react';
import { formatDuration, resolveDisplay } from '@imagina-base/shared';

import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';
import { OptionChip, renderCellValue } from '@/admin/records/renderCellValue';
import { FieldValueDisplay } from '@/admin/records/crm/FieldValueDisplay';
import { formatFieldNumber } from '@/lib/fieldNumberFormat';
import { __ } from '@/lib/i18n';
import { formatDateStr, formatNumber } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';
import { extractFieldOptions, type FieldOption } from '@/admin/records/fieldOptions';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.230 — Un valor mostrado con la FORMA elegida para su tipo (catálogo
 * `FIELD_DISPLAYS` de shared): un porcentaje como anillo, una fecha como
 * cuenta regresiva, un importe como cifra grande o como barra hacia una
 * meta. Una forma que el tipo no admite cae a la de siempre, así un campo
 * que cambió de tipo no rompe la ficha.
 */
export interface FieldDisplayProps {
    field: FieldEntity;
    value: unknown;
    display?: string;
    /** Meta para barra / anillo / medidor de números e importes. */
    goal?: number;
    prefix?: string;
    suffix?: string;
    /** Acento de la plantilla (CSS color). */
    accent?: string;
    size?: 'sm' | 'md' | 'lg';
}

export function FieldDisplay(props: FieldDisplayProps): JSX.Element {
    const { field, value } = props;
    const display = resolveDisplay(field.type, props.display);
    const accent = props.accent ?? 'hsl(var(--imcrm-primary))';

    if (isEmpty(value) && !['check', 'badge', 'stars', 'bar', 'ring', 'gauge'].includes(display)) {
        return <span className="imcrm-text-muted-foreground">—</span>;
    }

    switch (display) {
        case 'big':
            return <BigValue {...props} />;
        case 'bar':
            return <ProgressBar pct={pctOf(field, value, props.goal)} label={numberLabel(field, value, props)} accent={accent} />;
        case 'ring':
            return <Ring pct={pctOf(field, value, props.goal)} label={field.type === 'percent' ? '' : numberLabel(field, value, props)} accent={accent} />;
        case 'gauge':
            return <Gauge pct={pctOf(field, value, props.goal)} label={field.type === 'percent' ? '' : numberLabel(field, value, props)} accent={accent} />;
        case 'stars': {
            const cfg = field.config as { max?: number; icon?: RatingIcon };
            return <RatingControl value={typeof value === 'number' ? value : null} max={cfg.max ?? 5} icon={cfg.icon ?? 'star'} size="md" />;
        }
        case 'relative':
            return <span className="imcrm-text-sm">{relativeLabel(value) ?? '—'}</span>;
        case 'countdown':
            return <Countdown value={value} />;
        case 'calendar':
            return <CalendarTile value={value} accent={accent} />;
        case 'badge':
            return <BadgeValue field={field} value={value} />;
        case 'copy':
            return <CopyValue text={String(value)} />;
        case 'quote':
            return (
                <blockquote className="imcrm-border-l-2 imcrm-pl-3 imcrm-text-sm imcrm-italic imcrm-text-foreground/85" style={{ borderColor: accent }}>
                    <span className="imcrm-whitespace-pre-wrap">{String(value)}</span>
                </blockquote>
            );
        case 'clamp':
            return <ClampText text={String(value)} />;
        case 'button':
            return <LinkButton field={field} value={String(value)} />;
        case 'image':
            return (
                <img
                    src={String(value)}
                    alt={field.label}
                    className="imcrm-max-h-56 imcrm-w-full imcrm-rounded-lg imcrm-object-cover"
                />
            );
        case 'stages':
            return <StagesStrip field={field} value={value} accent={accent} />;
        case 'name':
        case 'avatar':
        case 'chip':
        case 'chips':
        case 'list':
        case 'link':
        case 'date':
        case 'number':
        case 'text':
        case 'check':
        case 'auto':
        default:
            return <FieldValueDisplay field={field} value={value} />;
    }
}

// ── Piezas ───────────────────────────────────────────────────────────────

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function asNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

/** Porcentaje 0-100 que representa el valor (percent es ya un %; el resto, contra la meta). */
export function pctOf(field: FieldEntity, value: unknown, goal?: number): number {
    const n = asNumber(value) ?? 0;
    if (field.type === 'percent') return clamp(n, 0, 100);
    if (field.type === 'rating') {
        const max = (field.config as { max?: number }).max ?? 5;
        return clamp((n / max) * 100, 0, 100);
    }
    const target = goal ?? asNumber((field.config as { max?: unknown }).max);
    if (target === null || target === undefined || target <= 0) return n > 0 ? 100 : 0;
    return clamp((n / target) * 100, 0, 100);
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

/** Texto de un número con el formato de su campo (moneda, %, duración…). */
export function formatFieldValueText(field: FieldEntity, value: unknown): string {
    const n = asNumber(value);
    if (n === null) return typeof value === 'string' ? value : '—';
    switch (field.type) {
        case 'percent':
            return `${formatNumber(n, { maxFrac: 1 })} %`;
        case 'duration':
            return formatDuration(n, ((field.config as { format?: 'hm' | 'clock' }).format) ?? 'hm');
        case 'rating':
            return `${formatNumber(n, { maxFrac: 1 })} / ${(field.config as { max?: number }).max ?? 5}`;
        case 'currency':
        case 'number':
            return formatFieldNumber(field, n);
        default:
            return formatNumber(n, { maxFrac: 2 });
    }
}

function numberLabel(field: FieldEntity, value: unknown, p: FieldDisplayProps): string {
    return `${p.prefix ?? ''}${formatFieldValueText(field, value)}${p.suffix ?? ''}`;
}

function BigValue({ field, value, prefix, suffix, size = 'lg' }: FieldDisplayProps): JSX.Element {
    const cls = size === 'lg' ? 'imcrm-text-[28px]' : size === 'md' ? 'imcrm-text-xl' : 'imcrm-text-base';
    if (field.type === 'select') {
        const opt = optionsOf(field).find((o) => o.value === value);
        return (
            <span className="imcrm-inline-flex imcrm-scale-110 imcrm-origin-left">
                <OptionChip opt={opt} fallback={String(value)} />
            </span>
        );
    }
    const n = asNumber(value);
    const text = n !== null || ['currency', 'number', 'percent', 'duration', 'rating', 'rollup', 'computed'].includes(field.type)
        ? formatFieldValueText(field, value)
        : null;
    if (text !== null) {
        return (
            <span className={cn(cls, 'imcrm-font-semibold imcrm-leading-none imcrm-tracking-tight imcrm-tabular-nums imcrm-text-foreground')}>
                {prefix}
                {text}
                {suffix && <span className="imcrm-ml-0.5 imcrm-text-[0.55em] imcrm-font-medium imcrm-text-muted-foreground">{suffix}</span>}
            </span>
        );
    }
    return <span className={cn(size === 'lg' ? 'imcrm-text-xl' : 'imcrm-text-base', 'imcrm-font-semibold imcrm-text-foreground')}>{renderCellValue(field, value)}</span>;
}

function ProgressBar({ pct, label, accent }: { pct: number; label: string; accent: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-text-lg imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">{label}</span>
                <span className="imcrm-text-xs imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">{Math.round(pct)}%</span>
            </div>
            <div className="imcrm-h-2 imcrm-w-full imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="imcrm-h-full imcrm-rounded-full imcrm-transition-[width] imcrm-duration-500" style={{ width: `${pct}%`, background: accent }} />
            </div>
        </div>
    );
}

function Ring({ pct, label, accent }: { pct: number; label: string; accent: string }): JSX.Element {
    const r = 30;
    const c = 2 * Math.PI * r;
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
            <svg viewBox="0 0 76 76" className="imcrm-h-[76px] imcrm-w-[76px] imcrm-shrink-0 imcrm--rotate-90" aria-hidden>
                <circle cx="38" cy="38" r={r} fill="none" stroke="hsl(var(--imcrm-muted))" strokeWidth="8" />
                <circle
                    cx="38"
                    cy="38"
                    r={r}
                    fill="none"
                    stroke={accent}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * c} ${c}`}
                    className="imcrm-transition-[stroke-dasharray] imcrm-duration-500"
                />
            </svg>
            <div className="imcrm-flex imcrm-flex-col">
                <span className="imcrm-text-2xl imcrm-font-semibold imcrm-leading-none imcrm-tabular-nums imcrm-text-foreground">{Math.round(pct)}%</span>
                {label && <span className="imcrm-mt-1 imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">{label}</span>}
            </div>
        </div>
    );
}

function Gauge({ pct, label, accent }: { pct: number; label: string; accent: string }): JSX.Element {
    const len = Math.PI * 40;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center">
            <svg viewBox="0 0 100 56" className="imcrm-h-[72px] imcrm-w-[128px]" aria-hidden>
                <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--imcrm-muted))" strokeWidth="9" strokeLinecap="round" />
                <path
                    d="M10 50 A40 40 0 0 1 90 50"
                    fill="none"
                    stroke={accent}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * len} ${len}`}
                />
            </svg>
            <span className="imcrm--mt-3 imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">{Math.round(pct)}%</span>
            {label && <span className="imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">{label}</span>}
        </div>
    );
}

/** Días enteros entre hoy y la fecha (negativo = ya pasó). */
export function daysFromToday(value: unknown): number | null {
    if (typeof value !== 'string' || value === '') return null;
    const d = value.length <= 10 ? new Date(`${value}T00:00:00`) : parseUtcDate(value);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    return Math.round((day.getTime() - today.getTime()) / 86_400_000);
}

export function relativeLabel(value: unknown): string | null {
    const d = daysFromToday(value);
    if (d === null) return null;
    if (d === 0) return __('Hoy');
    if (d === 1) return __('Mañana');
    if (d === -1) return __('Ayer');
    const abs = Math.abs(d);
    const unit = abs >= 60 ? `${Math.round(abs / 30)} ${__('meses')}` : `${abs} ${__('días')}`;
    return d > 0 ? `${__('En')} ${unit}` : `${__('Hace')} ${unit}`;
}

function Countdown({ value }: { value: unknown }): JSX.Element {
    const d = daysFromToday(value);
    if (d === null) return <span className="imcrm-text-muted-foreground">—</span>;
    const tone = d < 0 ? 'imcrm-bg-rose-500/10 imcrm-text-rose-700 dark:imcrm-text-rose-300' : d <= 3 ? 'imcrm-bg-amber-500/15 imcrm-text-amber-800 dark:imcrm-text-amber-300' : 'imcrm-bg-emerald-500/10 imcrm-text-emerald-800 dark:imcrm-text-emerald-300';
    const text = d < 0 ? `${__('Vencido hace')} ${-d} ${-d === 1 ? __('día') : __('días')}` : d === 0 ? __('Vence hoy') : `${__('Faltan')} ${d} ${d === 1 ? __('día') : __('días')}`;
    return (
        <span className="imcrm-inline-flex imcrm-flex-col imcrm-gap-0.5">
            <span className={cn('imcrm-inline-flex imcrm-w-fit imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-sm imcrm-font-semibold', tone)}>{text}</span>
            <span className="imcrm-text-xs imcrm-text-muted-foreground">{formatDateStr(String(value).slice(0, 10))}</span>
        </span>
    );
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function CalendarTile({ value, accent }: { value: unknown; accent: string }): JSX.Element {
    const s = String(value);
    const d = s.length <= 10 ? new Date(`${s}T00:00:00`) : parseUtcDate(s);
    if (Number.isNaN(d.getTime())) return <span className="imcrm-text-muted-foreground">—</span>;
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-3">
            <span className="imcrm-flex imcrm-w-14 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-center imcrm-shadow-imcrm-sm">
                <span className="imcrm-py-0.5 imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wide imcrm-text-white" style={{ background: accent }}>
                    {MONTHS[d.getMonth()]}
                </span>
                <span className="imcrm-py-1 imcrm-text-xl imcrm-font-semibold imcrm-leading-none imcrm-tabular-nums imcrm-text-foreground">{d.getDate()}</span>
            </span>
            <span className="imcrm-flex imcrm-flex-col">
                <span className="imcrm-text-sm imcrm-font-medium imcrm-capitalize imcrm-text-foreground">{WEEKDAYS[d.getDay()]}</span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{relativeLabel(value)}</span>
            </span>
        </span>
    );
}

function BadgeValue({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element {
    if (field.type === 'checkbox') {
        const on = value === true;
        return (
            <span className={cn('imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-semibold', on ? 'imcrm-bg-emerald-500/10 imcrm-text-emerald-800 dark:imcrm-text-emerald-300' : 'imcrm-bg-muted imcrm-text-muted-foreground')}>
                {on && <Check className="imcrm-h-3 imcrm-w-3" />}
                {on ? __('Sí') : __('No')}
            </span>
        );
    }
    if (isEmpty(value)) return <span className="imcrm-text-muted-foreground">—</span>;
    return <span className="imcrm-inline-flex imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-semibold imcrm-text-foreground">{String(value)}</span>;
}

function CopyValue({ text }: { text: string }): JSX.Element {
    const [done, setDone] = useState(false);
    return (
        <span className="imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-1.5">
            <code className="imcrm-truncate imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[12.5px]">{text}</code>
            <button
                type="button"
                className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                onClick={(e) => {
                    e.stopPropagation();
                    void navigator.clipboard?.writeText(text).then(() => {
                        setDone(true);
                        window.setTimeout(() => setDone(false), 1400);
                    });
                }}
                aria-label={__('Copiar')}
                title={__('Copiar')}
            >
                {done ? <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-emerald-600" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
            </button>
        </span>
    );
}

function ClampText({ text }: { text: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    const long = text.length > 220;
    return (
        <span className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1">
            <span className={cn('imcrm-whitespace-pre-wrap imcrm-text-sm', !open && long && 'imcrm-line-clamp-3')}>{text}</span>
            {long && (
                <button type="button" className="imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
                    {open ? __('Ver menos') : __('Ver más')}
                </button>
            )}
        </span>
    );
}

function LinkButton({ field, value }: { field: FieldEntity; value: string }): JSX.Element {
    const href = field.type === 'email' ? `mailto:${value}` : field.type === 'phone' ? `tel:${value}` : value;
    const Icon = field.type === 'email' ? Mail : field.type === 'phone' ? Phone : ExternalLink;
    const label = field.type === 'email' ? __('Enviar correo') : field.type === 'phone' ? __('Llamar') : __('Abrir enlace');
    return (
        <a
            href={href}
            target={field.type === 'url' ? '_blank' : undefined}
            rel="noreferrer"
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-foreground hover:imcrm-bg-accent"
            onClick={(e) => e.stopPropagation()}
            title={value}
        >
            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
            {label}
        </a>
    );
}

export function optionsOf(field: FieldEntity): FieldOption[] {
    return extractFieldOptions(field);
}

/** Etapas de un select en modo lectura (el bloque `stages` es el editable). */
function StagesStrip({ field, value, accent }: { field: FieldEntity; value: unknown; accent: string }): JSX.Element {
    const opts = optionsOf(field);
    const idx = opts.findIndex((o) => o.value === value);
    return (
        <div className="imcrm-flex imcrm-w-full imcrm-gap-1">
            {opts.map((o, i) => (
                <span
                    key={o.value}
                    className="imcrm-h-1.5 imcrm-flex-1 imcrm-rounded-full"
                    style={{ background: i <= idx ? accent : 'hsl(var(--imcrm-muted))' }}
                    title={o.label}
                />
            ))}
        </div>
    );
}
