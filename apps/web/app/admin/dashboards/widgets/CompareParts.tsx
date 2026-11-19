import { ArrowDownRight, ArrowRight, ArrowUpRight, GitCompareArrows } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WidgetCompare } from '@/types/dashboard';

import { compareTooltip, deltaView, diffText, isReadyCompare, toneClass, type DeltaView, type ReadyCompare } from './compareView';

/**
 * v0.1.462 — Piezas de «Comparar con…» (J2) que comparten los widgets.
 *
 * - `CompareBadge`: en la cabecera, «+12 % vs. mes anterior» (o sólo
 *   «vs. mes anterior» si no hay un total que comparar). Si no se pudo
 *   comparar, un ícono con el motivo.
 * - `CompareDeltaLine`: debajo de la cifra de un KPI o un medidor.
 */

function DeltaIcon({ direction, className }: { direction: DeltaView['direction']; className?: string }): JSX.Element {
    const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
    return <Icon className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0', className)} aria-hidden />;
}

export function CompareBadge({
    compare,
    total,
    format,
}: {
    compare: WidgetCompare | null;
    /** El total de ahora y el de antes (gráficos con métrica que suma). */
    total?: { current: number; previous: number } | null;
    format?: (n: number) => string;
}): JSX.Element | null {
    if (!compare) return null;
    if (!isReadyCompare(compare)) {
        return (
            <span
                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground"
                title={compare.unavailable ?? __('No se pudo comparar.')}
                data-testid="imcrm-compare-unavailable"
            >
                <GitCompareArrows className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                <span className="imcrm-sr-only sm:imcrm-not-sr-only">{__('Sin comparar')}</span>
            </span>
        );
    }
    const delta = total ? deltaView(total.current, total.previous, compare.invert === true) : null;
    const fmt = format ?? ((n: number) => String(n));
    const title = total
        ? compareTooltip({
              compare,
              nowText: fmt(total.current),
              beforeText: fmt(total.previous),
              diff: delta ? diffText(delta.diff, fmt) : null,
              delta: delta?.text ?? null,
          })
        : `${compare.label}${compare.detail ? `\n${compare.detail}` : ''}`;
    return (
        <span
            className="imcrm-inline-flex imcrm-max-w-[16rem] imcrm-items-center imcrm-gap-1 imcrm-whitespace-nowrap imcrm-text-[11px] imcrm-text-muted-foreground"
            title={title}
            data-testid="imcrm-compare-badge"
        >
            {delta ? (
                <span className={cn('imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-font-semibold imcrm-tabular-nums', toneClass(delta.tone))}>
                    <DeltaIcon direction={delta.direction} />
                    {delta.text}
                </span>
            ) : (
                <GitCompareArrows className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            )}
            {/* En la cabecera va el rótulo entero («Este mes vs. mes anterior»):
                la etiqueta del período del widget se oculta para no taparlo. */}
            <span className="imcrm-truncate">{compare.label}</span>
        </span>
    );
}

/** «▲ +12 % vs. mes anterior ($1.200)» debajo de una cifra. */
export function CompareDeltaLine({
    compare,
    current,
    format,
    affix = (s) => s,
}: {
    compare: WidgetCompare | null;
    current: number | string;
    format: (n: number) => string;
    affix?: (s: string) => string;
}): JSX.Element | null {
    if (!compare) return null;
    if (!isReadyCompare(compare)) {
        return (
            <span className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="imcrm-compare-unavailable">
                {compare.unavailable}
            </span>
        );
    }
    const before = typeof compare.value === 'number' ? compare.value : null;
    const delta = deltaView(current, before, compare.invert === true);
    const beforeText = before === null ? '—' : affix(format(before));
    const title = compareTooltip({
        compare,
        nowText: typeof current === 'number' ? affix(format(current)) : String(current),
        beforeText,
        diff: delta ? affix(diffText(delta.diff, format)) : null,
        delta: delta?.text ?? null,
    });
    return (
        <span
            className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-1 imcrm-text-[11px] imcrm-leading-tight"
            title={title}
            data-testid="imcrm-compare-delta"
        >
            {delta && (
                <span className={cn('imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-font-semibold imcrm-tabular-nums', toneClass(delta.tone))}>
                    <DeltaIcon direction={delta.direction} />
                    {delta.text}
                </span>
            )}
            <span className="imcrm-truncate imcrm-text-muted-foreground">
                {compare.short} ({beforeText})
            </span>
        </span>
    );
}

/** La variación de una fila (barras, dona, embudo, tabla dinámica). */
export function RowDelta({
    current,
    previous,
    invert,
    className,
}: {
    current: number;
    previous: number | null | undefined;
    invert: boolean;
    className?: string;
}): JSX.Element {
    const d = previous === null || previous === undefined ? null : deltaView(current, previous, invert);
    return (
        <span className={cn('imcrm-tabular-nums imcrm-font-semibold', d ? toneClass(d.tone) : 'imcrm-text-muted-foreground', className)}>
            {d ? d.text : '—'}
        </span>
    );
}

/** El tooltip de una fila comparada (nombre, ahora, antes, diferencia). */
export function rowCompareTitle(
    compare: ReadyCompare,
    name: string,
    current: number,
    previous: number | null | undefined,
    format: (n: number) => string,
): string {
    const prev = previous ?? null;
    const d = prev === null ? null : deltaView(current, prev, compare.invert === true);
    return compareTooltip({
        compare,
        name,
        nowText: format(current),
        beforeText: prev === null ? '—' : format(prev),
        diff: d ? diffText(d.diff, format) : null,
        delta: d?.text ?? null,
    });
}

export function compareLegendText(compare: ReadyCompare): { now: string; before: string } {
    const [now, before] = compare.label.split(' vs. ');
    return {
        now: now ?? __('Ahora'),
        before: before ? sprintf(__('%s (punteado)'), before) : __('Antes (punteado)'),
    };
}
