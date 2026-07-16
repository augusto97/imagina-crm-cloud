import { Check, ExternalLink, Mail, Minus, Paperclip, User as UserIcon } from 'lucide-react';

import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { useWpUser } from '@/hooks/useWpUsers';
import { fieldPrecision, formatFieldNumber } from '@/lib/fieldNumberFormat';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

interface FieldValueDisplayProps {
    field: FieldEntity;
    value: unknown;
}

/**
 * Render visual de un valor de campo para el layout CRM. Más rico que
 * `renderCellValue` (que vive en TableView y prioriza densidad): acá
 * mostramos íconos, símbolos de moneda, tiempo relativo en fechas,
 * `mailto:` / `tel:` links — para que la ficha del registro se sienta
 * como una página de detalle y no una fila de tabla disfrazada.
 */
export function FieldValueDisplay({ field, value }: FieldValueDisplayProps): JSX.Element {
    if (value === null || value === undefined || value === '') {
        return <span className="imcrm-text-muted-foreground/60">—</span>;
    }

    switch (field.type) {
        case 'checkbox':
            return <CheckboxDisplay value={value} />;
        case 'currency':
            return <CurrencyDisplay field={field} value={value} />;
        case 'number':
            return <NumberDisplay field={field} value={value} />;
        case 'date':
            return <DateDisplay value={value} kind="date" />;
        case 'datetime':
            return <DateDisplay value={value} kind="datetime" />;
        case 'select':
            return <SelectDisplay field={field} value={value} />;
        case 'multi_select':
            return <MultiSelectDisplay field={field} value={value} />;
        case 'email':
            return <EmailDisplay value={value} />;
        case 'url':
            return <UrlDisplay value={value} />;
        case 'user':
            return <UserDisplay value={value} />;
        case 'file':
            return <FileDisplay value={value} />;
        case 'long_text':
            return <LongTextDisplay value={value} />;
        case 'computed':
            return <ComputedDisplay field={field} value={value} />;
        default:
            return <span className="imcrm-truncate">{String(value)}</span>;
    }
}

// ─── Tipos específicos ─────────────────────────────────────────────────

function CheckboxDisplay({ value }: { value: unknown }): JSX.Element {
    const v = value === true || value === '1' || value === 1;
    return v ? (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-success">
            <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            <span className="imcrm-text-xs">{__('Sí')}</span>
        </span>
    ) : (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
            <Minus className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            <span className="imcrm-text-xs">{__('No')}</span>
        </span>
    );
}

function CurrencyDisplay({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element {
    const cfg = field.config as { currency?: string };
    const currency = cfg.currency || 'COP';
    const decimals = fieldPrecision(field);
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return <span>{String(value)}</span>;
    let formatted: string;
    try {
        formatted = new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(num);
    } catch {
        // Currency code inválido (ej. usuario puso "X"); fallback a número plano.
        formatted = formatFieldNumber(field, num);
    }
    return <span className="imcrm-font-medium imcrm-tabular-nums">{formatted}</span>;
}

function NumberDisplay({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return <span>{String(value)}</span>;
    return <span className="imcrm-tabular-nums">{formatFieldNumber(field, num)}</span>;
}

function DateDisplay({ value, kind }: { value: unknown; kind: 'date' | 'datetime' }): JSX.Element {
    if (typeof value !== 'string') return <span>{String(value)}</span>;
    // `date` viene como `YYYY-MM-DD`; `datetime` como `YYYY-MM-DD HH:MM:SS` UTC.
    const iso = kind === 'datetime' ? value.replace(' ', 'T') + 'Z' : value;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return <span>{value}</span>;

    const absolute = kind === 'date' ? d.toLocaleDateString() : d.toLocaleString();
    const rel = relativeTimeFrom(d);

    return (
        <span title={absolute} className="imcrm-inline-flex imcrm-items-baseline imcrm-gap-1.5">
            <span className="imcrm-tabular-nums">{absolute}</span>
            {rel !== null && (
                <span className="imcrm-text-xs imcrm-text-muted-foreground">({rel})</span>
            )}
        </span>
    );
}

function SelectDisplay({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element {
    const opts = extractFieldOptions(field);
    const opt = opts.find((o) => o.value === value);
    return (
        <OptionChip
            color={opt?.color as OptionColor | undefined}
            label={opt?.label ?? String(value)}
        />
    );
}

function MultiSelectDisplay({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element {
    if (!Array.isArray(value)) return <span>{String(value)}</span>;
    const opts = extractFieldOptions(field);
    const map = new Map(opts.map((o) => [o.value, o]));
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
            {value.map((v, i) => {
                const o = map.get(String(v));
                return (
                    <OptionChip
                        key={i}
                        color={o?.color as OptionColor | undefined}
                        label={o?.label ?? String(v)}
                    />
                );
            })}
        </div>
    );
}

function EmailDisplay({ value }: { value: unknown }): JSX.Element {
    if (typeof value !== 'string') return <span>{String(value)}</span>;
    return (
        <a
            href={`mailto:${value}`}
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-primary hover:imcrm-underline"
            onClick={(e) => e.stopPropagation()}
        >
            <Mail className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            <span className="imcrm-truncate">{value}</span>
        </a>
    );
}

function UrlDisplay({ value }: { value: unknown }): JSX.Element {
    if (typeof value !== 'string') return <span>{String(value)}</span>;
    const href = value.startsWith('http') ? value : `https://${value}`;
    const display = value.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-primary hover:imcrm-underline"
            onClick={(e) => e.stopPropagation()}
        >
            <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
            <span className="imcrm-truncate">{display}</span>
        </a>
    );
}

function UserDisplay({ value }: { value: unknown }): JSX.Element {
    // Resuelve el user via API (cacheado 5min en useWpUser). Mientras
    // carga muestra un placeholder; si el user no existe muestra el
    // #ID con marca de borrado.
    const id = typeof value === 'number' ? value : Number(value);
    const { data: user, isLoading } = useWpUser(Number.isFinite(id) && id > 0 ? id : null);

    if (isLoading) {
        return (
            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                <UserIcon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                <span className="imcrm-text-xs">{__('Cargando…')}</span>
            </span>
        );
    }
    if (! user) {
        return (
            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                <UserIcon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                <span className="imcrm-tabular-nums">#{String(value)}</span>
                <span className="imcrm-text-[10px]">({__('borrado')})</span>
            </span>
        );
    }
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5">
            {user.avatar_url ? (
                <img
                    src={user.avatar_url}
                    alt=""
                    aria-hidden
                    className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-rounded-full"
                />
            ) : (
                <UserIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
            )}
            <span className="imcrm-truncate">
                {user.display_name || user.login}
            </span>
        </span>
    );
}

function FileDisplay({ value }: { value: unknown }): JSX.Element {
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
            <Paperclip className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            <span className="imcrm-tabular-nums">#{String(value)}</span>
        </span>
    );
}

function LongTextDisplay({ value }: { value: unknown }): JSX.Element {
    const text = String(value);
    return (
        <span className="imcrm-line-clamp-3 imcrm-whitespace-pre-wrap imcrm-text-sm imcrm-leading-relaxed">
            {text}
        </span>
    );
}

function ComputedDisplay({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element {
    if (typeof value === 'number') {
        const cfg = field.config as { operation?: string; decimals?: number };
        if (cfg.operation === 'date_diff_days' || cfg.operation === 'date_diff_months') {
            return <span className="imcrm-tabular-nums">{value}</span>;
        }
        const decimals = cfg.decimals ?? 2;
        return (
            <span className="imcrm-tabular-nums">
                {value.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: decimals,
                })}
            </span>
        );
    }
    return <span>{String(value)}</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function OptionChip({
    color,
    label,
}: {
    color: OptionColor | undefined;
    label: string;
}): JSX.Element {
    const style = chipSoftStyle(color);
    return (
        <span
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium"
            style={style ?? {
                backgroundColor: 'hsl(var(--imcrm-muted))',
                borderColor: 'hsl(var(--imcrm-border))',
                color: 'hsl(var(--imcrm-foreground))',
            }}
        >
            {color && (
                <span
                    aria-hidden
                    className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-current imcrm-opacity-90"
                />
            )}
            {label}
        </span>
    );
}

/**
 * Formato relativo simple ("hace 3 días", "en 2 semanas", "hoy").
 * Devuelve `null` si la diferencia es < 1 día y kind=date — para
 * datetime sigue formateando "hace X minutos / horas".
 */
function relativeTimeFrom(d: Date): string | null {
    const now = Date.now();
    const diffMs = d.getTime() - now;
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHour = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHour / 24);

    if (Math.abs(diffDay) === 0) return __('hoy');
    if (diffDay === 1) return __('mañana');
    if (diffDay === -1) return __('ayer');
    if (Math.abs(diffDay) < 7) {
        return diffDay > 0
            ? sprintf(__('en %d días'), diffDay)
            : sprintf(__('hace %d días'), -diffDay);
    }
    if (Math.abs(diffDay) < 30) {
        const weeks = Math.round(diffDay / 7);
        return weeks > 0
            ? sprintf(__('en %d sem.'), weeks)
            : sprintf(__('hace %d sem.'), -weeks);
    }
    if (Math.abs(diffDay) < 365) {
        const months = Math.round(diffDay / 30);
        return months > 0
            ? sprintf(__('en %d meses'), months)
            : sprintf(__('hace %d meses'), -months);
    }
    const years = Math.round(diffDay / 365);
    return years > 0
        ? sprintf(__('en %d años'), years)
        : sprintf(__('hace %d años'), -years);
}

function sprintf(template: string, n: number): string {
    return template.replace('%d', String(n));
}
