import { TrendingUp } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ResolvedV2Block } from '@/lib/crmTemplates';
import type { RecordEntity } from '@/types/record';

interface KpiBlockViewProps {
    block: Extract<ResolvedV2Block, { type: 'kpi' }>;
    record: RecordEntity;
}

/**
 * KPI: número grande con label opcional y barra de progreso si
 * hay `goalValue`. Lee el valor del field configurado del record.
 */
export function KpiBlockView({ block, record }: KpiBlockViewProps): JSX.Element {
    const { field, label, format = 'number', prefix = '', suffix = '', goalValue } = block.config;

    if (! field) {
        return (
            <Card>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('KPI sin field configurado. Editá el bloque.')}
                </p>
            </Card>
        );
    }

    const raw = record.fields[field.slug];
    const value = parseNumeric(raw);
    const display = formatValue(value, format, prefix, suffix);
    const progress = goalValue && goalValue > 0 && value !== null
        ? Math.min(100, Math.max(0, (value / goalValue) * 100))
        : null;

    return (
        <Card>
            <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-justify-center imcrm-gap-2">
                <p className="imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {label ?? field.label}
                </p>
                <p className="imcrm-text-3xl imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
                    {display}
                </p>
                {progress !== null && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <div className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                            <div
                                className={cn(
                                    'imcrm-h-full imcrm-rounded-full imcrm-transition-all',
                                    progress >= 100 ? 'imcrm-bg-success' : 'imcrm-bg-primary',
                                )}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                            <TrendingUp className="imcrm-h-3 imcrm-w-3" aria-hidden />
                            {Math.round(progress)}% {__('de meta')} {formatValue(goalValue ?? 0, format, prefix, suffix)}
                        </p>
                    </div>
                )}
            </div>
        </Card>
    );
}

function parseNumeric(v: unknown): number | null {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function formatValue(
    value: number | null,
    format: 'number' | 'currency' | 'percent',
    prefix: string,
    suffix: string,
): string {
    if (value === null) return '—';
    let body: string;
    if (format === 'currency') {
        body = value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    } else if (format === 'percent') {
        body = `${value.toLocaleString()}%`;
    } else {
        body = value.toLocaleString();
    }
    return `${prefix}${body}${suffix}`;
}

function Card({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
            {children}
        </section>
    );
}
