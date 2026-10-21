import { useState } from 'react';

import { __ } from '@/lib/i18n';

import { BreakdownTooltip, SeriesLegend } from './BreakdownChart';
import { groupStackSum, type BreakdownModel } from './breakdownModel';
import { useElementSize } from './useElementSize';
import type { SegmentNav } from './useSegmentNav';

const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 6;

/**
 * v0.1.291 — Área/línea DESGLOSADA: una serie por valor del segundo campo.
 * Apiladas (cada banda arriba de la anterior; también al 100 %) o
 * superpuestas (cada serie su línea). SVG a la medida real del contenedor
 * (como la línea simple). Al pasar el mouse, una guía vertical y el desglose
 * de ese período; click → la lista filtrada por el período Y la serie.
 */
export function BreakdownLines({
    model,
    area,
    mode,
    percent,
    format,
    onSegment,
    showLegend,
}: {
    model: BreakdownModel;
    area: boolean;
    mode: 'stacked' | 'grouped';
    percent: boolean;
    format: (n: number) => string;
    onSegment: SegmentNav | null;
    showLegend: boolean;
}): JSX.Element {
    const { ref, width, height } = useElementSize();
    const [hover, setHover] = useState<number | null>(null);
    const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const n = model.groups.length;
    const innerW = Math.max(width - PAD_X * 2, 0);
    const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 0);
    const xAt = (i: number): number => (n === 1 ? PAD_X + innerW / 2 : PAD_X + (i / (n - 1)) * innerW);

    // Valor de cada serie en cada punto: acumulado (apiladas) o propio.
    const stacks = model.groups.map((g) => {
        const sum = groupStackSum(g);
        let acc = 0;
        return model.series.map((s) => {
            const raw = Math.max(0, g.values.get(s.key) ?? 0);
            const v = percent ? (sum > 0 ? (raw / sum) * 100 : 0) : raw;
            const low = mode === 'stacked' ? acc : 0;
            acc = mode === 'stacked' ? acc + v : acc;
            return { low, high: mode === 'stacked' ? acc : v, raw };
        });
    });
    let max = 0;
    for (const col of stacks) for (const p of col) max = Math.max(max, p.high);
    if (percent) max = 100;
    if (max <= 0) max = 1;
    const yFor = (v: number): number => PAD_TOP + innerH - (v / max) * innerH;

    const nearest = (x: number): number => {
        if (n <= 1) return 0;
        const i = Math.round(((x - PAD_X) / Math.max(innerW, 1)) * (n - 1));
        return Math.max(0, Math.min(n - 1, i));
    };
    const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - box.left;
        setHover(nearest(x));
        setPointer({ x, y: e.clientY - box.top });
    };
    const onClick = (e: React.MouseEvent<SVGSVGElement>): void => {
        if (onSegment === null || n === 0) return;
        const box = e.currentTarget.getBoundingClientRect();
        const i = nearest(e.clientX - box.left);
        const y = e.clientY - box.top;
        const g = model.groups[i];
        if (!g || !g.navigable) return;
        // La serie bajo el cursor: la banda que lo contiene (apiladas) o la
        // línea más cercana (superpuestas).
        let best = -1;
        let bestDist = Infinity;
        stacks[i]!.forEach((p, si) => {
            const top = yFor(p.high);
            const bottom = yFor(p.low);
            const inside = mode === 'stacked' && y >= top && y <= bottom;
            const dist = inside ? 0 : Math.abs(y - top);
            if (dist < bestDist) {
                bestDist = dist;
                best = si;
            }
        });
        const s = model.series[best];
        if (s && s.navigable) onSegment(g.key, s.key);
    };

    const pathFor = (si: number, edge: 'high' | 'low'): string =>
        stacks.map((col, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)},${yFor(col[si]![edge]).toFixed(1)}`).join(' ');
    const bandFor = (si: number): string => {
        const top = stacks.map((col, i) => `${xAt(i).toFixed(1)},${yFor(col[si]!.high).toFixed(1)}`);
        const bottom = stacks.map((col, i) => `${xAt(i).toFixed(1)},${yFor(col[si]!.low).toFixed(1)}`).reverse();
        return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
    };

    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
            {showLegend && <SeriesLegend series={model.series} format={format} />}
            <div ref={ref} className="imcrm-relative imcrm-min-h-0 imcrm-w-full imcrm-flex-1" onMouseLeave={() => setHover(null)}>
                {width > 0 && height > 0 && (
                    <svg
                        width={width}
                        height={height}
                        viewBox={`0 0 ${width} ${height}`}
                        className="imcrm-absolute imcrm-inset-0"
                        role="img"
                        aria-label={__('Tendencia por serie')}
                        data-testid="imcrm-breakdown-lines"
                        onMouseMove={onMove}
                        onClick={onClick}
                        style={{ cursor: onSegment !== null ? 'pointer' : undefined }}
                    >
                        {[0.25, 0.5, 0.75].map((f) => (
                            <line key={f} x1={PAD_X} x2={width - PAD_X} y1={yFor(max * f)} y2={yFor(max * f)} stroke="hsl(var(--imcrm-border))" strokeWidth="1" opacity="0.45" />
                        ))}
                        <text x={width - PAD_X} y={PAD_TOP - 3} textAnchor="end" className="imcrm-fill-muted-foreground" style={{ fontSize: 9 }}>
                            {percent ? '100%' : format(max)}
                        </text>
                        {model.series.map((s, si) => (
                            <g key={s.key} data-series={s.key}>
                                {(area || mode === 'stacked') && n > 1 && (
                                    <path d={bandFor(si)} fill={s.color} fillOpacity={mode === 'stacked' ? 0.45 : 0.12} />
                                )}
                                <path d={pathFor(si, 'high')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                            </g>
                        ))}
                        {hover !== null && n > 0 && (
                            <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD_TOP} y2={PAD_TOP + innerH} stroke="hsl(var(--imcrm-muted-foreground))" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
                        )}
                    </svg>
                )}
                {hover !== null && model.groups[hover] && (
                    <BreakdownTooltip
                        group={model.groups[hover]!}
                        series={model.series}
                        format={format}
                        mode={mode}
                        x={pointer.x}
                        y={pointer.y}
                        boxWidth={width}
                    />
                )}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-justify-between imcrm-text-[10px] imcrm-text-muted-foreground">
                <span>{model.groups[0]?.label ?? null}</span>
                {n > 1 && <span>{model.groups[n - 1]!.label}</span>}
            </div>
        </div>
    );
}
