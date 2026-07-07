import { useEffect, useState } from 'react';

import { usePortalPreview } from '../PreviewContext';
import type { PortalBootData } from '../types';

interface StatItem {
    label: string;
    value?: string;
    metric: 'static' | 'count' | 'sum' | 'avg' | 'min' | 'max';
    list_slug?: string;
    field_id?: number;
    prefix?: string;
    suffix?: string;
}

interface Props {
    config: {
        title?: string;
        items?: StatItem[];
        columns?: 2 | 3 | 4;
    };
    boot: PortalBootData;
}

/**
 * Bloque `stats_grid`. Renderea N (2-4) mini-KPIs en un solo bloque.
 *
 * Cada item puede ser:
 *  - `static`: valor hardcodeado (string).
 *  - métrica (`count`/`sum`/`avg`/`min`/`max`): se consulta vía
 *    `/portal/lists/{slug}/aggregates` con el scope del cliente.
 *
 * Las métricas dinámicas se resuelven en paralelo on-mount.
 */
export function StatsGridBlock({ config, boot }: Props): JSX.Element {
    const items = config.items ?? [];
    const columns = config.columns ?? 3;
    const isPreview = usePortalPreview();
    const [resolved, setResolved] = useState<Record<number, string | null>>(() => {
        if (! isPreview) return {};
        const mock: Record<number, string | null> = {};
        items.forEach((it, idx) => {
            if (it.metric !== 'static') mock[idx] = mockValueForMetric(it.metric);
        });
        return mock;
    });

    useEffect(() => {
        if (isPreview) return;
        const ac = new AbortController();
        items.forEach((it, idx) => {
            if (it.metric === 'static') return;
            const listSlug = it.list_slug ?? '';
            const fieldId = it.field_id ?? 0;
            if (listSlug === '' || (it.metric !== 'count' && fieldId <= 0)) {
                setResolved((r) => ({ ...r, [idx]: null }));
                return;
            }
            const url =
                `${boot.rest_root.replace(/\/$/, '')}/portal/lists/${encodeURIComponent(listSlug)}/aggregates` +
                `?fields=${fieldId > 0 ? fieldId : ''}`;
            fetch(url, {
                signal: ac.signal,
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'X-WP-Nonce': boot.rest_nonce },
            })
                .then(async (res) => {
                    if (!res.ok) throw new Error(`http-${res.status}`);
                    const body = (await res.json()) as {
                        data: { totals: Record<string, Record<string, unknown>> };
                    };
                    const totals = body.data.totals;
                    const firstSlug = Object.keys(totals)[0];
                    const entry = firstSlug !== undefined ? totals[firstSlug] : null;
                    const raw = entry === null || entry === undefined ? null : entry[it.metric];
                    setResolved((r) => ({ ...r, [idx]: raw === null || raw === undefined ? null : String(raw) }));
                })
                .catch((err: unknown) => {
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    setResolved((r) => ({ ...r, [idx]: null }));
                });
        });
        return () => ac.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boot, JSON.stringify(items), isPreview]);

    if (items.length === 0) return <></>;

    return (
        <section className={`imcrm-portal-block imcrm-portal-block--stats-grid imcrm-portal-stats--cols-${columns}`}>
            {config.title !== undefined && config.title !== '' && (
                <h2 className="imcrm-portal-block__title">{config.title}</h2>
            )}
            <div className="imcrm-portal-stats__grid">
                {items.map((it, i) => {
                    const display =
                        it.metric === 'static'
                            ? (it.value ?? '')
                            : resolved[i] === undefined
                                ? '…'
                                : resolved[i] === null
                                    ? '—'
                                    : (resolved[i] as string);
                    return (
                        <div key={i} className="imcrm-portal-stats__item">
                            <p className="imcrm-portal-stats__label">{it.label || `Stat ${i + 1}`}</p>
                            <p className="imcrm-portal-stats__value">
                                {it.prefix ?? ''}
                                {display}
                                {it.suffix !== undefined && it.suffix !== '' ? ` ${it.suffix}` : ''}
                            </p>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function mockValueForMetric(metric: 'count' | 'sum' | 'avg' | 'min' | 'max'): string {
    switch (metric) {
        case 'count': return '42';
        case 'sum':   return '12500';
        case 'avg':   return '285.5';
        case 'min':   return '15';
        case 'max':   return '1850';
    }
}
