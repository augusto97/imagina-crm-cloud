import { useMemo } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';

import { useFields } from '@/hooks/useFields';
import { useRecords } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { colorFromString } from '@/lib/recordCategorize';
import type { ResolvedV2Block } from '@/lib/crmTemplates';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

interface ChartBlockViewProps {
    block: Extract<ResolvedV2Block, { type: 'chart' }>;
    record: RecordEntity;
}

/**
 * Bar chart inline: distribución de records relacionados agrupados
 * por un field en la lista destino. Aggregación 100% client-side
 * sobre los records que `useRecords` ya trae para el sidebar de
 * relacionados — sin endpoint extra.
 *
 * Si el field de agrupación es select, usamos las options para los
 * labels (con su color si tiene). Si es text/number, agrupamos por
 * valor crudo.
 */
export function ChartBlockView({ block, record }: ChartBlockViewProps): JSX.Element {
    const { relationField, groupByFieldSlug, title } = block.config;

    if (! relationField) {
        return (
            <Card title={title ?? __('Gráfico')}>
                <Empty>{__('Configurá el bloque: elegí un relation field.')}</Empty>
            </Card>
        );
    }

    const targetListId = (relationField.config as { target_list_id?: number }).target_list_id ?? 0;
    const ids = record.relations?.[relationField.slug] ?? [];
    const targetFields = useFields(targetListId > 0 ? targetListId : undefined);
    const records = useRecords(
        ids.length > 0 && targetListId > 0 ? targetListId : undefined,
        { filter: { id: { in: ids.join(',') } }, per_page: ids.length || 1, page: 1 },
    );

    const groupByField = useMemo(
        () => targetFields.data?.find((f) => f.slug === groupByFieldSlug) ?? null,
        [targetFields.data, groupByFieldSlug],
    );

    const buckets = useMemo(() => {
        if (! records.data || ! groupByField) return null;
        return aggregateByField(records.data.data, groupByField);
    }, [records.data, groupByField]);

    if (targetListId === 0) {
        return (
            <Card title={title ?? __('Gráfico')}>
                <Empty>{__('Lista destino no configurada.')}</Empty>
            </Card>
        );
    }

    if (! groupByFieldSlug) {
        return (
            <Card title={title ?? __('Gráfico')}>
                <Empty>{__('Configurá el bloque: elegí un field de agrupación.')}</Empty>
            </Card>
        );
    }

    if (records.isLoading || targetFields.isLoading) {
        return (
            <Card title={title ?? __('Gráfico')}>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                    {__('Cargando…')}
                </div>
            </Card>
        );
    }

    if (! groupByField) {
        return (
            <Card title={title ?? __('Gráfico')}>
                <Empty>{sprintf(__('Field "%s" no encontrado en la lista destino.'), groupByFieldSlug)}</Empty>
            </Card>
        );
    }

    if (ids.length === 0 || ! buckets || buckets.length === 0) {
        return (
            <Card title={title ?? sprintf(__('Por %s'), groupByField.label)}>
                <Empty>{__('Sin records relacionados para graficar.')}</Empty>
            </Card>
        );
    }

    const total = buckets.reduce((s, b) => s + b.count, 0);

    return (
        <Card title={title ?? sprintf(__('Por %s'), groupByField.label)}>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                {buckets.map((b) => {
                    const pct = total > 0 ? (b.count / total) * 100 : 0;
                    const color = b.color ?? colorFromString(b.label);
                    return (
                        <li key={b.value} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-text-xs">
                                <span className="imcrm-truncate imcrm-font-medium">{b.label}</span>
                                <span className="imcrm-text-muted-foreground">
                                    {b.count} ({Math.round(pct)}%)
                                </span>
                            </div>
                            <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                <div
                                    className={cn('imcrm-h-full imcrm-rounded-full imcrm-transition-all')}
                                    style={{ width: `${pct}%`, backgroundColor: color }}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

interface Bucket {
    value: string;
    label: string;
    count: number;
    color?: string;
}

function aggregateByField(records: RecordEntity[], field: FieldEntity): Bucket[] {
    const counts = new Map<string, number>();
    for (const r of records) {
        const v = r.fields[field.slug];
        if (Array.isArray(v)) {
            for (const item of v) {
                const key = String(item ?? '');
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        } else {
            const key = v === null || v === undefined || v === '' ? '__null__' : String(v);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }

    const options = (field.config as { options?: Array<{ value: string; label: string; color?: string }> }).options ?? [];

    const buckets: Bucket[] = [];
    for (const [value, count] of counts.entries()) {
        if (value === '__null__') {
            buckets.push({ value, label: __('(Sin valor)'), count });
            continue;
        }
        const opt = options.find((o) => o.value === value);
        buckets.push({
            value,
            label: opt?.label ?? value,
            count,
            color: opt?.color,
        });
    }
    buckets.sort((a, b) => b.count - a.count);
    return buckets;
}

function Card({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
            <header className="imcrm-mb-3 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <BarChart3 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                {title}
            </header>
            <div className="imcrm-flex-1 imcrm-overflow-y-auto">{children}</div>
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <p className="imcrm-text-xs imcrm-text-muted-foreground">{children}</p>
    );
}
