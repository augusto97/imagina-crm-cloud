import { ExternalLink, Mail, Phone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { colorFromString, initialsFromValue } from '@/lib/recordCategorize';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

export interface RecordHeaderData {
    titleField: FieldEntity | null;
    subtitleFields: FieldEntity[];
    statusFields: FieldEntity[];
    quickActions: Array<{ field: FieldEntity; kind: 'email' | 'phone' | 'url' }>;
}

export interface RecordHeaderStyle {
    variant: 'hero' | 'compact' | 'minimal' | 'banner';
    showAvatar: boolean;
    showIdBadge: boolean;
    showSubtitle: boolean;
    showCreatedAt: boolean;
    showStatusStrip: boolean;
    /**
     * 0.57.36 — DEPRECATED. Los botones Guardar/Eliminar ya no se
     * rendean adentro del bloque header bajo ninguna circunstancia.
     * Esas acciones viven en la toolbar del registro (RecordCrmLayout)
     * o en el drawer. La prop se conserva en el shape para no romper
     * el JSON persistido, pero el componente la ignora.
     */
    showActions?: boolean;
    accentColor: string | null;
}

interface RecordHeaderProps {
    record: RecordEntity;
    data: RecordHeaderData;
    style: RecordHeaderStyle;
}

/**
 * Header del registro CRM — bloque de presentación, solo lectura.
 * Muestra avatar, título, ID badge, subtítulo, fecha de creación y
 * pills/quick actions del record. NO renderea botones de acción —
 * esos viven en la toolbar del registro (fuera del template) y en
 * el drawer.
 *
 * Cuatro variantes visuales — switchean layout interno pero todas
 * comparten los mismos elementos (cuando están activados):
 *  - `hero`    (default) avatar 16×16 + banda decorativa + layout horizontal
 *  - `compact` una sola fila densa con avatar 10×10 + título inline
 *  - `minimal` sin avatar, solo título grande
 *  - `banner`  avatar y título centrados (estilo página de perfil)
 */
export function RecordHeader({
    record,
    data,
    style,
}: RecordHeaderProps): JSX.Element {
    const titleField = data.titleField;
    const titleValue =
        titleField && typeof record.fields[titleField.slug] === 'string'
            ? (record.fields[titleField.slug] as string)
            : '';
    const title =
        titleValue !== ''
            ? titleValue
            : sprintf(/* translators: %d id */ __('Registro #%d'), record.id);

    const initials = initialsFromValue(titleValue || String(record.id));
    const avatarColor = style.accentColor ?? colorFromString(titleValue || String(record.id));

    const subtitleParts = data.subtitleFields
        .map((f) => formatFieldValue(f, record.fields[f.slug]))
        .filter((s): s is string => s !== null && s !== '');

    const idBadge = style.showIdBadge ? (
        <Badge variant="outline" className="imcrm-font-mono imcrm-text-[10px] imcrm-font-medium">
            #{record.id}
        </Badge>
    ) : null;

    const statusStrip = style.showStatusStrip
        && (data.statusFields.length > 0 || data.quickActions.length > 0) ? (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border/60 imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2">
            {data.statusFields.map((f) => (
                <StatusPill key={f.id} field={f} value={record.fields[f.slug]} />
            ))}
            {data.statusFields.length > 0 && data.quickActions.length > 0 && (
                <span aria-hidden className="imcrm-mx-1 imcrm-h-4 imcrm-w-px imcrm-bg-border" />
            )}
            {data.quickActions.map(({ field, kind }) => {
                const v = record.fields[field.slug];
                if (typeof v !== 'string' || v === '') return null;
                return <QuickAction key={field.id} kind={kind} value={v} label={field.label} />;
            })}
        </div>
    ) : null;

    if (style.variant === 'compact') {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    {style.showAvatar && (
                        <div
                            aria-hidden
                            className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-sm imcrm-font-semibold imcrm-text-white"
                            style={{ backgroundColor: avatarColor }}
                        >
                            {initials}
                        </div>
                    )}
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                        <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold imcrm-tracking-tight">
                            <span className="imcrm-truncate">{title}</span>
                            {idBadge}
                        </h1>
                        {style.showSubtitle && subtitleParts.length > 0 && (
                            <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                {subtitleParts.join(' · ')}
                            </p>
                        )}
                    </div>
                </div>
                {statusStrip}
            </div>
        );
    }

    if (style.variant === 'minimal') {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-justify-center imcrm-gap-2 imcrm-rounded-lg imcrm-p-4">
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            <span className="imcrm-truncate">{title}</span>
                            {idBadge}
                        </h1>
                        {style.showSubtitle && subtitleParts.length > 0 && (
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                {subtitleParts.join(' · ')}
                            </p>
                        )}
                    </div>
                </div>
                {statusStrip}
            </div>
        );
    }

    if (style.variant === 'banner') {
        return (
            <div
                className={cn(
                    'imcrm-relative imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-5 imcrm-shadow-imcrm-sm',
                )}
                style={{
                    background: `linear-gradient(135deg, ${avatarColor}14 0%, ${avatarColor}05 100%)`,
                }}
            >
                {style.showAvatar && (
                    <div
                        aria-hidden
                        className="imcrm-flex imcrm-h-20 imcrm-w-20 imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-text-xl imcrm-font-semibold imcrm-text-white imcrm-shadow-imcrm-md imcrm-ring-4 imcrm-ring-card"
                        style={{ backgroundColor: avatarColor }}
                    >
                        {initials}
                    </div>
                )}
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5 imcrm-text-center">
                    <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                        <span>{title}</span>
                        {idBadge}
                    </h1>
                    {style.showSubtitle && subtitleParts.length > 0 && (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {subtitleParts.join(' · ')}
                        </p>
                    )}
                    {style.showCreatedAt && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {sprintf(
                                __('Creado %s'),
                                record.created_at
                                    ? new Date(record.created_at + 'Z').toLocaleString()
                                    : '—',
                            )}
                        </p>
                    )}
                </div>
                {statusStrip}
            </div>
        );
    }

    // variant === 'hero' (default)
    return (
        <div
            className={cn(
                'imcrm-relative imcrm-flex imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm',
            )}
        >
            <div
                aria-hidden
                className="imcrm-h-1.5 imcrm-w-full imcrm-rounded-t-xl"
                style={{
                    background: `linear-gradient(90deg, ${avatarColor} 0%, ${avatarColor}80 100%)`,
                }}
            />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-5">
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-4">
                        {style.showAvatar && (
                            <div
                                aria-hidden
                                className={cn(
                                    'imcrm-flex imcrm-h-16 imcrm-w-16 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-text-lg imcrm-font-semibold imcrm-text-white imcrm-shadow-imcrm-md',
                                    'imcrm-ring-4 imcrm-ring-card',
                                )}
                                style={{ backgroundColor: avatarColor }}
                            >
                                {initials}
                            </div>
                        )}
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1.5">
                            <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                                <span className="imcrm-truncate">{title}</span>
                                {idBadge}
                            </h1>
                            {style.showSubtitle && subtitleParts.length > 0 && (
                                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                    {subtitleParts.join(' · ')}
                                </p>
                            )}
                            {style.showCreatedAt && (
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {sprintf(
                                        /* translators: %s: localized creation date */
                                        __('Creado %s'),
                                        record.created_at
                                            ? new Date(record.created_at + 'Z').toLocaleString()
                                            : '—',
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                {statusStrip}
            </div>
        </div>
    );
}

function formatFieldValue(field: FieldEntity, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (field.type === 'date' || field.type === 'datetime') {
        const d = new Date(field.type === 'date' ? String(value) : String(value) + 'Z');
        if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
    }
    return null;
}

function StatusPill({ field, value }: { field: FieldEntity; value: unknown }): JSX.Element | null {
    if (value === null || value === undefined || value === '') return null;
    const config = field.config as { options?: Array<{ value: string; label: string; color?: string }> };
    const options = Array.isArray(config.options) ? config.options : [];

    if (field.type === 'checkbox') {
        const v = value === true || value === '1' || value === 1;
        return (
            <Badge variant={v ? 'success' : 'secondary'}>
                <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide">
                    {field.label}:
                </span>
                <span className="imcrm-ml-1 imcrm-font-semibold">{v ? __('Sí') : __('No')}</span>
            </Badge>
        );
    }

    if (field.type === 'multi_select' && Array.isArray(value)) {
        return (
            <span className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {value.map((v) => {
                    const opt = options.find((o) => o.value === v);
                    return (
                        <Badge
                            key={String(v)}
                            variant="default"
                            style={opt?.color ? styleFromColor(opt.color) : undefined}
                        >
                            {opt?.label ?? String(v)}
                        </Badge>
                    );
                })}
            </span>
        );
    }

    const opt = options.find((o) => o.value === value);
    return (
        <Badge variant="default" style={opt?.color ? styleFromColor(opt.color) : undefined}>
            <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide">
                {field.label}:
            </span>
            <span className="imcrm-ml-1 imcrm-font-semibold">{opt?.label ?? String(value)}</span>
        </Badge>
    );
}

function styleFromColor(color: string): React.CSSProperties {
    return {
        backgroundColor: color + '1a',
        borderColor: color + '40',
        color,
    };
}

function QuickAction({
    kind,
    value,
    label,
}: {
    kind: 'email' | 'phone' | 'url';
    value: string;
    label: string;
}): JSX.Element {
    const Icon = kind === 'email' ? Mail : kind === 'phone' ? Phone : ExternalLink;
    const href =
        kind === 'email'
            ? `mailto:${value}`
            : kind === 'phone'
              ? `tel:${value.replace(/[^\d+]/g, '')}`
              : value.startsWith('http')
                ? value
                : `https://${value}`;
    return (
        <a
            href={href}
            target={kind === 'url' ? '_blank' : undefined}
            rel={kind === 'url' ? 'noopener noreferrer' : undefined}
            title={`${label}: ${value}`}
            className={cn(
                'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-text-xs imcrm-font-medium imcrm-text-foreground imcrm-transition-colors',
                'hover:imcrm-border-primary/40 hover:imcrm-bg-primary/5 hover:imcrm-text-primary',
            )}
        >
            <Icon className="imcrm-h-3 imcrm-w-3" aria-hidden />
            <span className="imcrm-max-w-[180px] imcrm-truncate">{value}</span>
        </a>
    );
}
