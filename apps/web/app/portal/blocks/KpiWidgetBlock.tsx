import { useEffect, useState } from 'react';

import { usePortalPreview } from '../PreviewContext';
import type { PortalBootData } from '../types';

interface Props {
    config: {
        title?: string;
        list_slug?: string;
        field_id?: number;
        metric?: 'count' | 'sum' | 'avg' | 'min' | 'max';
        suffix?: string;
        prefix?: string;
        variant?: 'card' | 'inline';
        accent_color?: string | null;
        /** Emoji o caracter unicode mostrado como icono (ej. "💳", "📊"). */
        icon?: string;
        /** Texto del trend (ej. "+12%" o "vs mes pasado"). */
        trend_text?: string;
        /** `up` | `down` | `neutral` → controla color del trend. */
        trend_direction?: 'up' | 'down' | 'neutral';
    };
    boot: PortalBootData;
}

/**
 * Bloque `kpi_widget` (Fase 9 — 3.E). Muestra una métrica simple
 * (count/sum/avg/min/max) sobre records relacionados al cliente.
 *
 * Reusa el endpoint `/portal/lists/{slug}/aggregates` que aplica el
 * scope SQL del portal automáticamente — la métrica NUNCA incluye
 * records ajenos.
 */
export function KpiWidgetBlock({ config, boot }: Props): JSX.Element {
    const isPreview = usePortalPreview();
    const [value, setValue] = useState<string | number | null | undefined>(
        isPreview ? mockValueForMetric(config.metric ?? 'count') : undefined,
    );
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isPreview) {
            setValue(mockValueForMetric(config.metric ?? 'count'));
            return;
        }
        const listSlug = config.list_slug ?? '';
        const fieldId = config.field_id ?? 0;
        const metric = config.metric ?? 'count';
        if (listSlug === '' || (metric !== 'count' && fieldId <= 0)) {
            setError('Bloque no configurado correctamente.');
            return;
        }

        const ac = new AbortController();
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
                // El shape de totals es `{slug: {count, sum, avg, ...}}`.
                // Tomamos el PRIMER slug (solo pedimos uno) y la metric pedida.
                const firstSlug = Object.keys(totals)[0];
                const entry = firstSlug !== undefined ? totals[firstSlug] : null;
                if (entry === null || entry === undefined) {
                    setValue(null);
                    return;
                }
                const raw = entry[metric];
                if (raw === null || raw === undefined) {
                    setValue(null);
                    return;
                }
                setValue(raw as string | number);
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError('No se pudo calcular la métrica.');
            });
        return () => ac.abort();
    }, [boot, config.list_slug, config.field_id, config.metric, isPreview]);

    const variant = config.variant ?? 'card';
    const accentStyle = config.accent_color
        ? ({ '--imcrm-portal-kpi-accent': config.accent_color } as React.CSSProperties)
        : undefined;
    const variantClass =
        variant === 'inline'
            ? 'imcrm-portal-block--kpi-inline'
            : 'imcrm-portal-block--kpi-card';

    const valueNode =
        error !== null ? (
            <span className="imcrm-portal-block__error" role="alert">
                {error}
            </span>
        ) : value === undefined ? (
            <span className="imcrm-portal-block__loading">Cargando…</span>
        ) : (
            <>
                {config.prefix ?? ''}
                {value === null ? '—' : String(value)}
                {config.suffix ?? ''}
            </>
        );

    const trendDirection = config.trend_direction ?? 'neutral';
    const hasIcon = config.icon !== undefined && config.icon !== '';
    const hasTrend = config.trend_text !== undefined && config.trend_text !== '';

    return (
        <section
            className={`imcrm-portal-block imcrm-portal-block--kpi ${variantClass} ${hasIcon ? 'imcrm-portal-block--kpi-with-icon' : ''}`}
            style={accentStyle}
        >
            {hasIcon && (
                <span className="imcrm-portal-kpi__icon" aria-hidden>
                    {config.icon}
                </span>
            )}
            <div className="imcrm-portal-kpi__body">
                {config.title !== undefined && config.title !== '' ? (
                    <p className="imcrm-portal-kpi__label">{config.title}</p>
                ) : null}
                <p className="imcrm-portal-kpi__value">{valueNode}</p>
                {hasTrend && (
                    <p className={`imcrm-portal-kpi__trend imcrm-portal-kpi__trend--${trendDirection}`}>
                        <span aria-hidden>
                            {trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '·'}
                        </span>
                        {config.trend_text}
                    </p>
                )}
            </div>
        </section>
    );
}

/**
 * Valor representativo de cada métrica para el preview del editor.
 * No es aleatorio: dame un valor estable y "lindo" para que el admin
 * vea cómo se ve un KPI promedio sin tener que conectar a datos reales.
 */
function mockValueForMetric(metric: 'count' | 'sum' | 'avg' | 'min' | 'max'): number {
    switch (metric) {
        case 'count': return 42;
        case 'sum':   return 12500;
        case 'avg':   return 285.5;
        case 'min':   return 15;
        case 'max':   return 1850;
    }
}
