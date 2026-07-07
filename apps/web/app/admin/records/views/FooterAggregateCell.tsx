import { ChevronDown } from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AggregateBag } from '@/hooks/useAggregates';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

/**
 * Slug de cada cálculo posible. Lo persistimos en
 * `view.config.footer_aggregates[columnId]` (el user elige uno por
 * columna, opcionalmente — por default no hay nada y la cell muestra
 * "Calcular").
 */
export type AggregateKind =
    | 'count'
    | 'count_unique'
    | 'count_empty'
    | 'pct_empty'
    | 'pct_filled'
    | 'sum'
    | 'avg'
    | 'min'
    | 'max'
    | 'range'
    | 'date_min'
    | 'date_max'
    | 'date_range';

interface FooterAggregateCellProps {
    field: FieldEntity | null;
    /** Total de records (para porcentajes). */
    totalCount: number;
    /** Datos crudos del endpoint para esta columna. */
    agg: AggregateBag | undefined;
    /** Kind elegido por el user (o `undefined` = sin cálculo). */
    kind: AggregateKind | undefined;
    /** Cuando el user elige un kind o lo quita. */
    onChange: (kind: AggregateKind | undefined) => void;
}

/**
 * Cell del footer estilo ClickUp: por defecto muestra "Calcular ▾"
 * (clickable, casi-invisible). Cuando el user elige un kind, la
 * cell muestra el resultado calculado. La opción persiste por
 * columna en el saved view.
 *
 * El menú se agrupa en categorías (Recuento / Porcentual /
 * Numéricos / Fechas) según el tipo del field. Los items
 * disponibles dependen del tipo:
 *  - number/currency → Recuento, Porcentual, Numéricos
 *  - date/datetime   → Recuento, Porcentual, Fechas
 *  - select/text/etc → Recuento, Porcentual
 *  - checkbox        → Recuento (true/false), Porcentual
 *
 * Para columnas no-field (id, updated_at) o tipo `relation`/
 * `computed` no mostramos nada — esa cell del footer queda vacía.
 */
export function FooterAggregateCell({
    field,
    totalCount,
    agg,
    kind,
    onChange,
}: FooterAggregateCellProps): JSX.Element | null {
    if (field === null) {
        // Columna fija (ID, updated_at): sin agregaciones aquí.
        return null;
    }

    const formatted = formatAggregate(field, agg, totalCount, kind);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-1.5 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-transition-opacity',
                        kind === undefined
                            // Sin kind: invisible por default, aparece on
                            // hover de la fila completa del footer (estilo
                            // ClickUp). Al hover individual del trigger
                            // se opaca a foreground completo.
                            ? 'imcrm-opacity-0 group-hover/footer:imcrm-opacity-60 imcrm-text-muted-foreground hover:imcrm-bg-accent/40 hover:imcrm-text-foreground hover:imcrm-opacity-100'
                            : 'imcrm-text-foreground hover:imcrm-bg-accent/40',
                    )}
                    title={kind ? labelForKind(kind) : __('Elegir cálculo')}
                >
                    <span className="imcrm-truncate">
                        {formatted ?? __('Calcular')}
                    </span>
                    <ChevronDown className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-opacity-60" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="imcrm-min-w-[200px]" align="start">
                <DropdownMenuLabel>{__('Calcular')}</DropdownMenuLabel>

                {/* Categoría: Recuento — siempre disponible */}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{__('Recuento')}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => onChange('count')}>
                            {__('Valores del recuento')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onChange('count_unique')}>
                            {__('Contar valores únicos')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onChange('count_empty')}>
                            {__('Recuento vacío')}
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Categoría: Porcentual — siempre disponible */}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{__('Porcentual')}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => onChange('pct_empty')}>
                            {__('Porcentaje vacío')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onChange('pct_filled')}>
                            {__('Porcentaje no vacío')}
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Categoría: Numéricos — solo number / currency */}
                {(field.type === 'number' || field.type === 'currency') && (
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{__('Números')}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem onSelect={() => onChange('sum')}>
                                {__('Suma')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onChange('avg')}>
                                {__('Promedio')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onChange('min')}>
                                {__('Mínimo')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onChange('max')}>
                                {__('Máximo')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onChange('range')}>
                                {__('Intervalo')}
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                )}

                {/* Categoría: Fechas — solo date / datetime */}
                {(field.type === 'date' || field.type === 'datetime') && (
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{__('Fechas')}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem onSelect={() => onChange('date_range')}>
                                {__('Intervalo')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onChange('date_min')}>
                                {__('Fecha más antigua')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onChange('date_max')}>
                                {__('Fecha más reciente')}
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                )}

                {kind !== undefined && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onChange(undefined)} danger>
                            {__('Quitar cálculo')}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * Formatea el resultado del agregado seleccionado para mostrar en
 * la cell. Devuelve null cuando no hay kind o no hay datos del
 * endpoint todavía (loading) — en ese caso la cell muestra
 * "Calcular".
 */
function formatAggregate(
    field: FieldEntity,
    agg: AggregateBag | undefined,
    totalCount: number,
    kind: AggregateKind | undefined,
): string | null {
    if (kind === undefined) return null;
    if (agg === undefined) return null;

    const num = (n: number | null | undefined): string => {
        if (n === null || n === undefined) return '—';
        const decimals = field.type === 'currency' ? 2 : (field.type === 'number' ? 4 : 0);
        return n.toLocaleString(undefined, {
            minimumFractionDigits: field.type === 'currency' ? 2 : 0,
            maximumFractionDigits: decimals,
        });
    };
    const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

    switch (kind) {
        case 'count':
            return num(agg.count ?? 0);
        case 'count_unique':
            return num(agg.count_unique ?? 0);
        case 'count_empty': {
            // Para text/select/etc el endpoint trae count_empty; para
            // checkbox/number/date lo derivamos de total - count.
            const empty = agg.count_empty ?? Math.max(0, totalCount - (agg.count ?? 0));
            return num(empty);
        }
        case 'pct_empty': {
            if (totalCount === 0) return '0%';
            const empty = agg.count_empty ?? Math.max(0, totalCount - (agg.count ?? 0));
            return pct(empty / totalCount);
        }
        case 'pct_filled': {
            if (totalCount === 0) return '0%';
            return pct((agg.count ?? 0) / totalCount);
        }
        case 'sum':
            return num(agg.sum ?? null);
        case 'avg':
            return num(agg.avg ?? null);
        case 'min':
            return num(typeof agg.min === 'number' ? agg.min : (agg.min === null ? null : Number(agg.min)));
        case 'max':
            return num(typeof agg.max === 'number' ? agg.max : (agg.max === null ? null : Number(agg.max)));
        case 'range': {
            const mn = typeof agg.min === 'number' ? agg.min : (agg.min === null ? null : Number(agg.min));
            const mx = typeof agg.max === 'number' ? agg.max : (agg.max === null ? null : Number(agg.max));
            if (mn === null || mx === null) return '—';
            return num(mx - mn);
        }
        case 'date_min':
            return agg.min ? String(agg.min).slice(0, 10) : '—';
        case 'date_max':
            return agg.max ? String(agg.max).slice(0, 10) : '—';
        case 'date_range': {
            if (! agg.min || ! agg.max) return '—';
            const a = new Date(String(agg.min));
            const b = new Date(String(agg.max));
            const days = Math.round((b.getTime() - a.getTime()) / 86400000);
            return `${days} ${__('días')}`;
        }
    }
}

/** Etiqueta humana del kind para tooltips. */
function labelForKind(kind: AggregateKind): string {
    const map: Record<AggregateKind, string> = {
        count:        __('Valores del recuento'),
        count_unique: __('Contar valores únicos'),
        count_empty:  __('Recuento vacío'),
        pct_empty:    __('Porcentaje vacío'),
        pct_filled:   __('Porcentaje no vacío'),
        sum:          __('Suma'),
        avg:          __('Promedio'),
        min:          __('Mínimo'),
        max:          __('Máximo'),
        range:        __('Intervalo'),
        date_min:     __('Fecha más antigua'),
        date_max:     __('Fecha más reciente'),
        date_range:   __('Intervalo de fechas'),
    };
    return map[kind];
}
