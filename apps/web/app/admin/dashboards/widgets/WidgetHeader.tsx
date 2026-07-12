import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

/**
 * Rojo de la línea de referencia del promedio (estilo ClickUp) — el
 * mismo tono en la línea punteada del chart y consistente entre
 * light/dark (no depende del token destructive del tema).
 */
export const AVG_LINE_COLOR = 'hsl(0 72% 51%)';

/**
 * Header compartido de los cards de widget (estilo ClickUp): título
 * chico arriba-izquierda + subtítulo muted (métrica · lista) y un
 * slot opcional a la derecha (p. ej. el badge "Promedio: N" de los
 * charts de barras/línea).
 */
export function WidgetHeader({
    title,
    subtitle,
    right,
}: {
    title: string;
    subtitle?: string | null;
    right?: React.ReactNode;
}): JSX.Element {
    return (
        <header className="imcrm-flex imcrm-shrink-0 imcrm-items-start imcrm-justify-between imcrm-gap-2">
            <div className="imcrm-min-w-0">
                <h3 className="imcrm-truncate imcrm-text-[13px] imcrm-font-semibold imcrm-leading-tight imcrm-text-foreground">
                    {title}
                </h3>
                {subtitle != null && subtitle !== '' && (
                    <p className="imcrm-mt-0.5 imcrm-truncate imcrm-text-[11px] imcrm-leading-tight imcrm-text-muted-foreground">
                        {subtitle}
                    </p>
                )}
            </div>
            {right != null && <div className="imcrm-shrink-0">{right}</div>}
        </header>
    );
}

/**
 * Badge "Promedio: N" para la esquina superior derecha del header
 * (charts de barras / línea / área — paridad ClickUp).
 */
export function AverageBadge({ value }: { value: number }): JSX.Element {
    return (
        <span className="imcrm-whitespace-nowrap imcrm-text-[12px] imcrm-text-muted-foreground">
            {__('Promedio')}:{' '}
            <span className="imcrm-font-bold imcrm-tabular-nums imcrm-text-foreground">
                {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
        </span>
    );
}

/** Label humano de una métrica de agregación (mismo set que el backend). */
export function metricLabel(metric: string): string {
    switch (metric) {
        case 'count':         return __('Conteo');
        case 'count_unique':  return __('Únicos');
        case 'count_empty':   return __('Vacíos');
        case 'count_true':    return __('Sí');
        case 'count_false':   return __('No');
        case 'sum':           return __('Suma');
        case 'avg':           return __('Promedio');
        case 'min':           return __('Mínimo');
        case 'max':           return __('Máximo');
        default:              return metric;
    }
}

/**
 * Subtítulo del card: "Métrica · Lista" (o la parte que exista).
 * Usa el cache de `useLists` (el sidebar ya lo tiene caliente) — no
 * agrega requests nuevos en la práctica.
 */
export function useWidgetSubtitle(widget: WidgetSpec): string | null {
    const lists = useLists();
    const parts: string[] = [];
    if (widget.config.metric) parts.push(metricLabel(widget.config.metric));
    const listName = lists.data?.find((l) => l.id === widget.list_id)?.name;
    if (listName) parts.push(listName);
    return parts.length > 0 ? parts.join(' · ') : null;
}
