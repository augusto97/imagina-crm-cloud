import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { CalendarRange, Check } from 'lucide-react';
import {
    isPeriodFieldType,
    readDashboardPeriodFields,
    suggestPeriodField,
    widgetPeriodField,
    writeDashboardPeriodFields,
    type WidgetPeriodField,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { fieldsKeys } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isContentWidget, type WidgetSpec } from '@/types/dashboard';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.474 — Qué FECHA usa el período del tablero en cada widget, con la misma
 * regla que el servidor (`widgetPeriodField` de shared): el campo del período
 * del widget, su fecha de tendencia, la fecha por la que agrupa, la del
 * desglose o la elegida para su lista en el tablero (`settings.period_fields`).
 */
export interface DashboardPeriodScope {
    /** `true` mientras faltan los campos de alguna lista (no avisar todavía). */
    loading: boolean;
    /** La fecha del período del widget, o `null` si no se puede filtrar. */
    fieldFor: (widget: WidgetSpec) => (WidgetPeriodField & { name: string }) | null;
    lists: PeriodList[];
}

export interface PeriodList {
    listId: number;
    name: string;
    /** Las fechas de la lista por las que se puede filtrar. */
    dates: FieldEntity[];
    /** La elegida en el tablero (o `null`). */
    choice: number | null;
    suggestion: number | null;
    /** Los widgets de la lista que dependen de la elección del tablero. */
    needChoice: WidgetSpec[];
}

export function useDashboardPeriodScope(widgets: WidgetSpec[], settings: unknown): DashboardPeriodScope {
    const listIds = useMemo(
        () => [...new Set(widgets.filter((w) => !isContentWidget(w.type) && w.list_id > 0).map((w) => w.list_id))],
        [widgets],
    );
    // Mismas keys que `useFields` (regla de oro nº 7: por el ID), así reusa lo
    // que los widgets ya pidieron.
    const queries = useQueries({
        queries: listIds.map((id) => ({
            queryKey: fieldsKeys.forList(String(id)),
            queryFn: async () => (await api.get<FieldEntity[]>(`/lists/${id}/fields`)).data,
            staleTime: 60_000,
        })),
    });
    const lists = useLists();
    const choices = useMemo(() => readDashboardPeriodFields(settings), [settings]);
    const stamp = queries.map((q) => q.dataUpdatedAt).join(',');

    return useMemo<DashboardPeriodScope>(() => {
        const fieldsByList = new Map<number, FieldEntity[]>();
        listIds.forEach((id, i) => fieldsByList.set(id, queries[i]?.data ?? []));
        const loading = queries.some((q) => q.isLoading);
        const fieldFor = (widget: WidgetSpec): (WidgetPeriodField & { name: string }) | null => {
            if (isContentWidget(widget.type)) return null;
            const fields = fieldsByList.get(widget.list_id) ?? [];
            const byId = new Map(fields.map((f) => [f.id, f]));
            const hit = widgetPeriodField(
                widget.config as Record<string, unknown>,
                (id) => byId.get(id)?.type,
                choices.get(widget.list_id) ?? null,
            );
            if (!hit) return null;
            return { ...hit, name: byId.get(hit.fieldId)?.label ?? '' };
        };
        const periodLists: PeriodList[] = listIds.map((listId) => {
            const fields = fieldsByList.get(listId) ?? [];
            const byId = new Map(fields.map((f) => [f.id, f]));
            const own = widgets.filter((w) => w.list_id === listId && !isContentWidget(w.type));
            const needChoice = own.filter(
                (w) => widgetPeriodField(w.config as Record<string, unknown>, (id) => byId.get(id)?.type, null) === null,
            );
            const dates = fields.filter((f) => isPeriodFieldType(f.type));
            const chosen = choices.get(listId) ?? null;
            return {
                listId,
                name: lists.data?.find((l) => l.id === listId)?.name ?? sprintf(__('Lista %d'), listId),
                dates,
                choice: chosen !== null && dates.some((d) => d.id === chosen) ? chosen : null,
                suggestion: suggestPeriodField(dates.map((d) => ({ id: d.id, name: d.label, type: d.type }))),
                needChoice,
            };
        });
        return { loading, fieldFor, lists: periodLists };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- los resultados de las queries cambian de identidad en cada render
    }, [listIds, widgets, choices, lists.data, stamp]);
}

/** Los widgets con datos a los que el período del tablero no llega. */
export function unfilteredWidgets(scope: DashboardPeriodScope, widgets: WidgetSpec[]): WidgetSpec[] {
    if (scope.loading) return [];
    return widgets.filter((w) => !isContentWidget(w.type) && scope.fieldFor(w) === null);
}

/** El objeto `settings.period_fields` con la elección nueva de una lista. */
export function nextPeriodFields(settings: unknown, listId: number, fieldId: number | null): Record<string, number> {
    const map = new Map<number, number | null>(readDashboardPeriodFields(settings));
    map.set(listId, fieldId);
    return writeDashboardPeriodFields(map);
}

interface ButtonProps {
    scope: DashboardPeriodScope;
    unfiltered: WidgetSpec[];
    canEdit: boolean;
    saving: boolean;
    onChoose: (changes: Array<{ listId: number; fieldId: number | null }>) => void;
}

/**
 * El botón «N sin fecha» junto al período: dice qué widgets no se filtran y
 * deja elegir, por lista, la fecha que usan (quien edita el tablero).
 */
export function PeriodFieldsButton({ scope, unfiltered, canEdit, saving, onChoose }: ButtonProps): JSX.Element | null {
    const [open, setOpen] = useState(false);
    const relevant = scope.lists.filter((l) => l.needChoice.length > 0);
    if (relevant.length === 0) return null;
    const pending = unfiltered.length;
    const suggestable = relevant.filter((l) => l.choice === null && l.suggestion !== null);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors',
                        pending > 0
                            ? 'imcrm-border-warning/50 imcrm-bg-warning/10 imcrm-text-foreground hover:imcrm-bg-warning/20'
                            : 'imcrm-border-input imcrm-bg-background imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                    )}
                    data-testid="imcrm-period-fields"
                    data-tour="dashboard-period-fields"
                >
                    <CalendarRange className="imcrm-h-3.5 imcrm-w-3.5" />
                    {pending > 0
                        ? pending === 1
                            ? __('1 widget sin fecha')
                            : sprintf(__('%d widgets sin fecha'), pending)
                        : __('Fecha de cada lista')}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="imcrm-w-[22rem] imcrm-max-w-[calc(100vw-2rem)] imcrm-p-0" data-testid="imcrm-period-fields-panel">
                <div className="imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2.5">
                    <p className="imcrm-text-sm imcrm-font-semibold">{__('¿Por qué fecha se filtra cada lista?')}</p>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('El período del tablero filtra cada gráfico por su fecha. Los que no tienen una (indicadores, donas, tablas) usan la que elijas aquí para su lista.')}
                    </p>
                </div>
                <ul className="imcrm-flex imcrm-max-h-[60vh] imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-y-auto">
                    {relevant.map((l) => (
                        <li key={l.listId} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2.5" data-testid="imcrm-period-list">
                            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                                <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-medium">{l.name}</span>
                                <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {l.needChoice.length === 1 ? __('1 widget') : sprintf(__('%d widgets'), l.needChoice.length)}
                                </span>
                            </div>
                            <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground" title={l.needChoice.map((w) => w.title || __('Sin título')).join(', ')}>
                                {l.needChoice.map((w) => w.title || __('Sin título')).join(', ')}
                            </p>
                            {l.dates.length === 0 ? (
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Esta lista no tiene ninguna fecha: sus widgets muestran todos los registros.')}
                                </p>
                            ) : canEdit ? (
                                <Select
                                    value={l.choice === null ? '' : String(l.choice)}
                                    onChange={(e) => onChoose([{ listId: l.listId, fieldId: e.target.value === '' ? null : Number(e.target.value) }])}
                                    disabled={saving}
                                    className="imcrm-h-8 imcrm-text-[13px]"
                                    aria-label={sprintf(__('Fecha para filtrar «%s»'), l.name)}
                                    data-testid="imcrm-period-field-select"
                                >
                                    <option value="">{__('No filtrar estos widgets')}</option>
                                    {l.dates.map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {d.id === l.suggestion ? sprintf(__('%s (sugerida)'), d.label) : d.label}
                                        </option>
                                    ))}
                                </Select>
                            ) : (
                                <p className="imcrm-text-xs">
                                    {l.choice !== null
                                        ? sprintf(__('Se filtran por «%s».'), l.dates.find((d) => d.id === l.choice)?.label ?? '')
                                        : __('Todavía no se eligió una fecha: pídele a quien edita el tablero que la elija.')}
                                </p>
                            )}
                            {l.choice !== null && (
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-success">
                                    <Check className="imcrm-h-3 imcrm-w-3" />
                                    {__('Se filtran con el período del tablero.')}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
                {canEdit && suggestable.length > 0 && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-2">
                        <Button
                            size="sm"
                            className="imcrm-w-full"
                            disabled={saving}
                            onClick={() => onChoose(suggestable.map((l) => ({ listId: l.listId, fieldId: l.suggestion })))}
                            data-testid="imcrm-period-fields-suggested"
                        >
                            {suggestable.length === 1
                                ? sprintf(__('Usar «%s»'), suggestable[0]!.dates.find((d) => d.id === suggestable[0]!.suggestion)?.label ?? '')
                                : __('Usar las fechas sugeridas')}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
