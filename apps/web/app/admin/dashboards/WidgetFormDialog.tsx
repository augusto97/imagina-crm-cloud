import { useEffect, useMemo, useRef, useState } from 'react';
import { readCompareConfig, resolveStageProbabilities, stageOptionsOf } from '@imagina-base/shared';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { KPI_ICON_OPTIONS } from '@/admin/dashboards/widgets/KpiWidget';
import { WidgetRenderer } from '@/admin/dashboards/widgets/WidgetRenderer';
import {
    DashboardBundleContext,
    WidgetDataOverrideContext,
    useWidgetPreview,
    type DashboardBundleScope,
    type WidgetDataOverride,
} from '@/hooks/useDashboards';
import { BlockStyleEditor } from '@/admin/template-editor-core/BlockStyleEditor';
import { ImageBlockForm } from '@/admin/template-editor-core/ImageBlockForm';
import { hasBlockStyle, readBlockStyle, type BlockStyle } from '@/lib/blockStyle';
import { displayTypeOf } from '@/lib/fieldTypeCatalog';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
    defaultLayoutForType,
    isContentWidget,
    type ChartTimeBucket,
    type KpiMetric,
    type WidgetPeriod,
    type WidgetSpec,
    type WidgetType,
} from '@/types/dashboard';
import {
    DATE_RANGE_PRESETS,
    type DateRangePresetId,
} from '@/admin/records/dateRangePresets';
import type { ListGroup, ListSummary } from '@/types/list';
import type { FilterTree } from '@/types/record';

import { FiltersPanel } from '@/admin/records/FiltersPanel';
import { useReportWidgetPreview, type ReportScope } from '@/admin/reports/useReports';
import {
    isFlatAndTree,
    treeFromActiveFilters,
} from '@/admin/records/filterTree';

interface WidgetFormDialogProps {
    initial: WidgetSpec | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (widget: WidgetSpec) => void;
    /** v0.1.286 — para la vista previa EN VIVO del widget que se configura. */
    dashboardId?: number;
    scope?: DashboardBundleScope;
    /**
     * v0.1.464 (J1) — El diálogo dentro del editor de un informe: sólo tipos
     * de DATOS (sin título, texto ni imagen: el informe tiene sus propios
     * bloques), sin la capa de estilo de la tarjeta, y la vista previa
     * calculada por la del informe con su período y su comparación.
     */
    report?: ReportScope;
}

/**
 * Tipos por los que se puede agrupar. v0.1.286 — también persona, números
 * (cada valor es un grupo), calificación, porcentaje y los campos a través de
 * una relación (lookup/rollup): el motor ya los agrupaba, el diálogo no los
 * ofrecía.
 */
const GROUPABLE_TYPES = [
    'select', 'multi_select',
    'text', 'email', 'url', 'phone',
    'date', 'datetime',
    'checkbox',
    'user',
    // C1 — por equipo.
    'team',
    'number', 'currency', 'rating', 'percent', 'duration',
    'lookup', 'rollup', 'time_tracked', 'checklist_progress',
    // C5 — el estado de la aprobación (pendientes / aprobadas / rechazadas).
    'approval',
    // v0.1.300 — columnas de sistema: por día/mes de creación, por quien creó…
    'created_at', 'updated_at', 'created_by', 'updated_by',
];

/** v0.1.300 — Fechas reales de un registro: las del usuario y las de sistema. */
const DATE_LIKE_TYPES: ReadonlySet<string> = new Set(['date', 'datetime', 'created_at', 'updated_at']);

/**
 * v0.1.286 — Default REAL de cada interruptor de "Mostrar" por tipo (el que
 * usa el widget cuando la clave no está). El diálogo arrancaba en `false` y
 * guardaba sólo los `true`: un interruptor encendido por defecto no se podía
 * apagar.
 */
export function presentationDefaults(type: WidgetType): { average: boolean; labels: boolean; legend: boolean } {
    return {
        // La línea de promedio tiene lectura en una TENDENCIA; en categorías es opt-in.
        average: type === 'chart_line' || type === 'chart_area',
        // El donut muestra los % y la leyenda salvo que se apaguen.
        labels: type === 'chart_pie',
        legend: type === 'chart_pie',
    };
}

export function WidgetFormDialog({
    initial,
    open,
    onOpenChange,
    onSave,
    dashboardId,
    scope,
    report,
}: WidgetFormDialogProps): JSX.Element {
    const lists = useLists();
    const groups = useListGroups();

    const [title, setTitle] = useState('');
    const [type, setType] = useState<WidgetType>('kpi');
    // v0.1.98 — estilo del card (capa compartida del editor de plantillas)
    // y config libre de los widgets de CONTENIDO (texto/imagen…).
    const [style, setStyle] = useState<BlockStyle>({});
    const [contentConfig, setContentConfig] = useState<Record<string, unknown>>({});
    // v0.1.99 — KPI premium + gauge: icono, prefijo/sufijo, meta y sparkline.
    const [kpiIcon, setKpiIcon] = useState('');
    const [kpiPrefix, setKpiPrefix] = useState('');
    const [kpiSuffix, setKpiSuffix] = useState('');
    const [kpiGoal, setKpiGoal] = useState('');
    const [sparkFieldId, setSparkFieldId] = useState<number>(0);
    // v0.1.102 — ocultar grupos con valor 0/vacío en los charts agrupados.
    const [hideZeroGroups, setHideZeroGroups] = useState(false);
    const [listId, setListId] = useState<number>(0);
    const [metric, setMetric] = useState<KpiMetric>('count');
    const [metricFieldId, setMetricFieldId] = useState<number>(0);
    const [groupByFieldId, setGroupByFieldId] = useState<number>(0);
    const [dateFieldId, setDateFieldId] = useState<number>(0);
    const [periodDays, setPeriodDays] = useState<number>(30);
    const [sortFieldId, setSortFieldId] = useState<number>(0);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [tableLimit, setTableLimit] = useState<number>(10);
    const [visibleFieldIds, setVisibleFieldIds] = useState<number[]>([]);
    const [showAverageLine, setShowAverageLine] = useState<boolean>(false);
    const [showDataLabels, setShowDataLabels] = useState<boolean>(false);
    const [showLegend, setShowLegend] = useState<boolean>(false);
    const [timeBucket, setTimeBucket] = useState<ChartTimeBucket>('month');
    const [periodFieldId, setPeriodFieldId] = useState<number>(0);
    const [periodPreset, setPeriodPreset] = useState<DateRangePresetId | ''>('');
    // v0.1.105 — extremos del período personalizado (preset 'custom').
    const [periodFrom, setPeriodFrom] = useState<string>('');
    const [periodTo, setPeriodTo] = useState<string>('');
    // v0.1.105 — etiqueta del centro del donut (default "Total").
    const [centerLabel, setCenterLabel] = useState<string>('');
    // v0.1.286 — contar también las subtareas, orden y tope de categorías.
    const [includeSubtasks, setIncludeSubtasks] = useState(false);
    const [chartSort, setChartSort] = useState<string>('');
    const [topN, setTopN] = useState<number>(0);
    // v0.1.292 — "Desglosar por" un segundo campo (barras/área/línea) y
    // tabla dinámica (filas × columnas).
    const [subGroupByFieldId, setSubGroupByFieldId] = useState<number>(0);
    const [subTimeBucket, setSubTimeBucket] = useState<ChartTimeBucket>('month');
    const [stackMode, setStackMode] = useState<'stacked' | 'grouped'>('stacked');
    const [stackPercent, setStackPercent] = useState(false);
    const [seriesTopN, setSeriesTopN] = useState<number>(0);
    const [barOrientation, setBarOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
    // v0.1.474 — «Columnas» elegido a mano (o guardado): al agrupar por una
    // fecha, un gráfico de barras NUEVO pasa solo a columnas (ventas por mes).
    const orientationChosen = useRef(false);
    const [colTopN, setColTopN] = useState<number>(0);
    const [colSort, setColSort] = useState<string>('');
    const [heatmap, setHeatmap] = useState(false);
    const [showTotals, setShowTotals] = useState(true);
    // v0.1.462 — «Comparar con…» (J2) y pronóstico de ventas (J3).
    const [compareMode, setCompareMode] = useState<CompareModeChoice>('');
    const [compareToDate, setCompareToDate] = useState(true);
    const [compareFrom, setCompareFrom] = useState('');
    const [compareTo, setCompareTo] = useState('');
    const [compareInvert, setCompareInvert] = useState(false);
    const [stageFieldId, setStageFieldId] = useState<number>(0);
    const [stageProbabilities, setStageProbabilities] = useState<Record<string, number>>({});
    const [filterTree, setFilterTree] = useState<FilterTree>({
        type: 'group',
        logic: 'and',
        children: [],
    });

    const fields = useFields(listId === 0 ? undefined : listId);

    // Si cambia la lista (excepto en mount/edit), los filtros referenciaban
    // campos de la lista anterior y ya no aplican — los reseteamos.
    const previousListIdRef = useRef<number>(listId);
    useEffect(() => {
        if (previousListIdRef.current !== listId && previousListIdRef.current !== 0) {
            setFilterTree({ type: 'group', logic: 'and', children: [] });
            // El field_id del período referenciaba un campo de la
            // lista anterior — invalidamos para que el usuario lo
            // re-seleccione si lo quiere mantener.
            setPeriodFieldId(0);
            setPeriodPreset('');
        }
        previousListIdRef.current = listId;
    }, [listId]);
    const groupableFields = useMemo(
        () => (fields.data ?? []).filter(
            (f) =>
                GROUPABLE_TYPES.includes(f.type)
                // Fórmulas (A1): las que el servidor compila a SQL.
                || (f.type === 'formula' && f.formula?.sql === true),
        ),
        [fields.data],
    );
    const dateFields = useMemo(
        () => (fields.data ?? []).filter((f) => DATE_LIKE_TYPES.has(f.type)),
        [fields.data],
    );
    const allUsableFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type !== 'relation' && f.type !== 'button'),
        [fields.data],
    );
    // 0.36.9: cualquier field excepto relation/computed se puede usar
    // como metric en KPI/Charts/StatDelta — RecordAggregator soporta
    // count/count_unique/count_empty para todos, sum/avg/min/max/etc
    // según tipo. El picker filtra qué cálculos se ofrecen.
    // v0.1.229 — un computed ARITMÉTICO (suma, resta, producto, división,
    // valor absoluto) ya se agrega en el servidor como un número: se ofrece
    // como tal. Los de fecha/concat siguen afuera.
    const aggregatableFields = useMemo<FieldOpt[]>(
        () => (fields.data ?? [])
            .filter((f) => f.type !== 'relation' && f.type !== 'lookup' && f.type !== 'button' && (f.type !== 'computed' || isNumericComputedOp(f.config)))
            // Fórmulas (A1): sólo las que compilan a SQL, medidas como el tipo de su resultado.
            .filter((f) => f.type !== 'formula' || f.formula?.sql === true)
            .map((f) => ({
                id: f.id,
                label: f.label,
                type: f.type === 'computed' ? 'number' : f.type === 'formula' ? (f.formula?.result_type ?? 'text') : f.type,
            })),
        [fields.data],
    );

    useEffect(() => {
        if (!open) return;
        if (initial) {
            setTitle(initial.title);
            setType(initial.type);
            setStyle(readBlockStyle(initial.config));
            setContentConfig({ ...initial.config });
            setKpiIcon(typeof initial.config.icon === 'string' ? initial.config.icon : '');
            setKpiPrefix(typeof initial.config.prefix === 'string' ? initial.config.prefix : '');
            setKpiSuffix(typeof initial.config.suffix === 'string' ? initial.config.suffix : '');
            setKpiGoal(typeof initial.config.goal === 'number' ? String(initial.config.goal) : '');
            setSparkFieldId(typeof initial.config.spark_field_id === 'number' ? initial.config.spark_field_id : 0);
            setListId(initial.list_id);
            setMetric((initial.config.metric as KpiMetric) ?? 'count');
            setMetricFieldId((initial.config.metric_field_id as number) ?? 0);
            setGroupByFieldId((initial.config.group_by_field_id as number) ?? 0);
            setDateFieldId((initial.config.date_field_id as number) ?? 0);
            setPeriodDays((initial.config.period_days as number) ?? 30);
            setSortFieldId((initial.config.sort_field_id as number) ?? 0);
            setSortDir((initial.config.sort_dir as 'asc' | 'desc') ?? 'desc');
            setTableLimit((initial.config.limit as number) ?? 10);
            setVisibleFieldIds(
                Array.isArray(initial.config.visible_field_ids)
                    ? (initial.config.visible_field_ids as number[])
                    : [],
            );
            setHideZeroGroups(Boolean(initial.config.hide_zero_groups));
            const defs = presentationDefaults(initial.type);
            const flag = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
            setShowAverageLine(flag(initial.config.show_average_line, defs.average));
            setShowDataLabels(flag(initial.config.show_data_labels, defs.labels));
            setShowLegend(flag(initial.config.show_legend, defs.legend));
            setIncludeSubtasks(initial.config.include_subtasks === true);
            setChartSort(typeof initial.config.sort === 'string' ? initial.config.sort : '');
            setTopN(typeof initial.config.top_n === 'number' ? initial.config.top_n : 0);
            setSubGroupByFieldId(typeof initial.config.sub_group_by_field_id === 'number' ? initial.config.sub_group_by_field_id : 0);
            setSubTimeBucket(isTimeBucket(initial.config.sub_time_bucket) ? initial.config.sub_time_bucket : 'month');
            setStackMode(initial.config.stack_mode === 'grouped' ? 'grouped' : 'stacked');
            setStackPercent(initial.config.stack_percent === true);
            setSeriesTopN(typeof initial.config.series_top_n === 'number' ? initial.config.series_top_n : 0);
            setBarOrientation(initial.config.bar_orientation === 'vertical' ? 'vertical' : 'horizontal');
            orientationChosen.current = true;
            setColTopN(typeof initial.config.col_top_n === 'number' ? initial.config.col_top_n : 0);
            setColSort(typeof initial.config.col_sort === 'string' ? initial.config.col_sort : '');
            setHeatmap(initial.config.heatmap === true);
            setShowTotals(initial.config.show_totals !== false);
            {
                const cmp = readCompareConfig(initial.config.compare);
                setCompareMode(cmp ? cmp.mode : '');
                setCompareToDate(cmp ? cmp.to_date : true);
                setCompareFrom(cmp?.from ?? '');
                setCompareTo(cmp?.to ?? '');
                setCompareInvert(initial.config.compare_invert === true);
            }
            setStageFieldId(typeof initial.config.stage_field_id === 'number' ? initial.config.stage_field_id : 0);
            setStageProbabilities(readProbabilities(initial.config.stage_probabilities));
            setTimeBucket(
                isTimeBucket(initial.config.time_bucket)
                    ? initial.config.time_bucket
                    : 'month',
            );
            const period = initial.config.period;
            if (period && typeof period === 'object' && period.field_id > 0) {
                setPeriodFieldId(period.field_id);
                setPeriodPreset(period.preset as DateRangePresetId);
                setPeriodFrom(period.from ?? '');
                setPeriodTo(period.to ?? '');
            } else {
                setPeriodFieldId(0);
                setPeriodPreset('');
                setPeriodFrom('');
                setPeriodTo('');
            }
            setCenterLabel(
                typeof (initial.config as { center_label?: unknown }).center_label === 'string'
                    ? ((initial.config as { center_label?: string }).center_label as string)
                    : '',
            );
            setFilterTree(decodeWidgetFilters(initial.config));
        } else {
            setTitle('');
            setType('kpi');
            setStyle({});
            setContentConfig({});
            setKpiIcon('');
            setKpiPrefix('');
            setKpiSuffix('');
            setKpiGoal('');
            setSparkFieldId(0);
            setListId(lists.data?.[0]?.id ?? 0);
            setMetric('count');
            setMetricFieldId(0);
            setGroupByFieldId(0);
            setDateFieldId(0);
            setPeriodDays(30);
            setSortFieldId(0);
            setSortDir('desc');
            setTableLimit(10);
            setVisibleFieldIds([]);
            setHideZeroGroups(false);
            setShowAverageLine(presentationDefaults('kpi').average);
            setShowDataLabels(false);
            setShowLegend(false);
            setIncludeSubtasks(false);
            setChartSort('');
            setTopN(0);
            setSubGroupByFieldId(0);
            setSubTimeBucket('month');
            setStackMode('stacked');
            setStackPercent(false);
            setSeriesTopN(0);
            setBarOrientation('horizontal');
            orientationChosen.current = false;
            setColTopN(0);
            setColSort('');
            setHeatmap(false);
            setShowTotals(true);
            setCompareMode('');
            setCompareToDate(true);
            setCompareFrom('');
            setCompareTo('');
            setCompareInvert(false);
            setStageFieldId(0);
            setStageProbabilities({});
            setTimeBucket('month');
            setPeriodFieldId(0);
            setPeriodPreset('');
            setPeriodFrom('');
            setPeriodTo('');
            setCenterLabel('');
            setFilterTree({ type: 'group', logic: 'and', children: [] });
        }
        if (!initial) draftId.current = generateWidgetId();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initial?.id]);

    // v0.1.286 — al cambiar el TIPO, los interruptores de "Mostrar" vuelven
    // al default de ese tipo (un donut muestra leyenda; unas barras, no la
    // línea de promedio).
    const changeType = (next: WidgetType): void => {
        setType(next);
        const defs = presentationDefaults(next);
        setShowAverageLine(defs.average);
        setShowDataLabels(defs.labels);
        setShowLegend(defs.legend);
    };

    // v0.1.292 — al elegir un desglose, la leyenda de las series se enciende
    // (sin ella no se sabe qué color es cada serie).
    const changeBreakdown = (id: number): void => {
        if (id > 0 && subGroupByFieldId === 0) setShowLegend(true);
        setSubGroupByFieldId(id);
    };

    // v0.1.474 — agrupar por una fecha en un gráfico de barras nuevo lo pasa a
    // columnas (la lectura natural de «ventas por mes»), salvo que la persona
    // ya haya elegido la orientación.
    const changeGroupBy = (id: number): void => {
        setGroupByFieldId(id);
        if (type === 'chart_bar' && !orientationChosen.current && isDateField(fields.data ?? [], id)) {
            setBarOrientation('vertical');
        }
    };

    const chooseOrientation = (next: 'horizontal' | 'vertical'): void => {
        orientationChosen.current = true;
        setBarOrientation(next);
    };

    /** El valor del selector de tipo: «Columnas» es un gráfico de barras vertical. */
    const typeSelectValue = type === 'chart_bar' && barOrientation === 'vertical' ? 'chart_columns' : type;
    const changeTypeSelect = (value: string): void => {
        if (value === 'chart_columns') {
            if (type !== 'chart_bar') changeType('chart_bar');
            chooseOrientation('vertical');
            return;
        }
        if (value === 'chart_bar' && type === 'chart_bar') {
            chooseOrientation('horizontal');
            return;
        }
        changeType(value as WidgetType);
        if (value === 'chart_bar' && isDateField(fields.data ?? [], groupByFieldId) && !orientationChosen.current) {
            setBarOrientation('vertical');
        }
    };

    /** El widget tal como quedaría guardado (también alimenta la vista previa). */
    const buildWidget = (): WidgetSpec => {
        const isContent = isContentWidget(type);
        const config: WidgetSpec['config'] = isContent
            ? ({ ...contentConfig } as WidgetSpec['config'])
            : buildConfig(type, {
                metric,
                metricFieldId,
                groupByFieldId,
                dateFieldId,
                periodDays,
                sortFieldId,
                sortDir,
                tableLimit,
                visibleFieldIds,
                filterTree,
                showAverageLine,
                showDataLabels,
                showLegend,
                timeBucket,
                period:
                    periodFieldId > 0 && periodPreset !== ''
                        ? periodPreset === 'custom'
                            ? (periodFrom !== '' && periodTo !== ''
                                ? { field_id: periodFieldId, preset: 'custom', from: periodFrom, to: periodTo }
                                : null)
                            : { field_id: periodFieldId, preset: periodPreset }
                        : null,
            });
        // La capa de estilo viaja en config.style para TODOS los tipos.
        delete config.style;
        if (hasBlockStyle(style)) config.style = style;
        if (type === 'chart_bar' || type === 'chart_pie' || type === 'funnel') {
            delete config.hide_zero_groups;
            if (hideZeroGroups) config.hide_zero_groups = true;
        }
        // v0.1.105 — etiqueta del centro del donut (vacía = "Total").
        if (type === 'chart_pie') {
            delete (config as { center_label?: string }).center_label;
            if (centerLabel.trim() !== '') (config as { center_label?: string }).center_label = centerLabel.trim();
        }
        // v0.1.99 — extras del KPI/gauge (icono, prefijo/sufijo, meta, spark).
        if (type === 'kpi' || type === 'gauge') {
            if (kpiIcon !== '') config.icon = kpiIcon;
            if (kpiPrefix !== '') config.prefix = kpiPrefix;
            if (kpiSuffix !== '') config.suffix = kpiSuffix;
            const g = Number(kpiGoal);
            if (kpiGoal.trim() !== '' && Number.isFinite(g) && g > 0) config.goal = g;
            if (type === 'kpi' && sparkFieldId > 0) config.spark_field_id = sparkFieldId;
        }
        if (!isContent) {
            // v0.1.286 — por defecto cuentan el PRIMER nivel (como la tabla).
            delete config.include_subtasks;
            if (includeSubtasks) config.include_subtasks = true;
        }
        if (type === 'chart_bar' || type === 'chart_pie' || type === 'funnel' || type === 'pivot') {
            delete config.sort;
            delete config.top_n;
            if (chartSort !== '') config.sort = chartSort;
            if (topN > 0) config.top_n = topN;
        }
        // v0.1.292 — desglose por un segundo campo (barras, área, línea).
        for (const k of ['sub_group_by_field_id', 'sub_time_bucket', 'stack_mode', 'stack_percent', 'series_top_n', 'bar_orientation', 'col_top_n', 'col_sort', 'heatmap', 'show_totals']) {
            delete config[k];
        }
        if (type === 'chart_bar' && barOrientation === 'vertical') config.bar_orientation = 'vertical';
        const mainGroup = type === 'chart_line' || type === 'chart_area' ? dateFieldId : groupByFieldId;
        if (isBreakdownType(type) && subGroupByFieldId > 0 && subGroupByFieldId !== mainGroup) {
            config.sub_group_by_field_id = subGroupByFieldId;
            if (isDateField(fields.data ?? [], subGroupByFieldId)) config.sub_time_bucket = subTimeBucket;
            config.stack_mode = stackMode;
            if (stackMode === 'stacked' && stackPercent && isStackableMetric(metric)) config.stack_percent = true;
            if (seriesTopN > 0) config.series_top_n = seriesTopN;
            config.show_legend = showLegend;
        }
        // v0.1.292 — tabla dinámica.
        if (type === 'pivot') {
            if (subGroupByFieldId > 0) config.sub_group_by_field_id = subGroupByFieldId;
            if (isDateField(fields.data ?? [], subGroupByFieldId)) config.sub_time_bucket = subTimeBucket;
            if (colTopN > 0) config.col_top_n = colTopN;
            if (colSort !== '') config.col_sort = colSort;
            if (heatmap) config.heatmap = true;
            if (!showTotals) config.show_totals = false;
        }
        // v0.1.462 — pronóstico de ventas (J3): monto, etapa, fecha de cierre.
        if (type === 'forecast') {
            config.metric = 'sum';
            if (metricFieldId > 0) config.metric_field_id = metricFieldId;
            delete config.group_by_field_id;
            if (stageFieldId > 0) config.stage_field_id = stageFieldId;
            if (dateFieldId > 0) config.date_field_id = dateFieldId;
            else delete config.date_field_id;
            config.time_bucket = timeBucket === 'week' || timeBucket === 'quarter' ? timeBucket : 'month';
            const stageField = (fields.data ?? []).find((f) => f.id === stageFieldId);
            if (stageField) {
                config.stage_probabilities = resolveStageProbabilities(stageOptionsOf(stageField.config as Record<string, unknown>), stageProbabilities);
            }
            const g = Number(kpiGoal);
            if (kpiGoal.trim() !== '' && Number.isFinite(g) && g > 0) config.goal = g;
        }
        // v0.1.462 — «Comparar con…» (J2).
        delete config.compare;
        delete config.compare_invert;
        if (isComparableType(type) && compareMode !== '') {
            if (compareMode === 'custom') {
                if (compareFrom !== '' && compareTo !== '') config.compare = { mode: 'custom', from: compareFrom, to: compareTo };
            } else {
                config.compare = { mode: compareMode, to_date: compareToDate };
            }
            if (config.compare && compareInvert) config.compare_invert = true;
        }
        return {
            id: initial?.id ?? draftId.current,
            type,
            list_id: isContent ? 0 : listId,
            title: title.trim(),
            config,
            // 0.57.42 — tamaño inicial según el tipo (KPI compacto,
            // tabla ancha…) y posicionado al FINAL del dashboard.
            layout: initial?.layout ?? defaultLayoutForType(type),
        };
    };

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        onSave(buildWidget());
        onOpenChange(false);
    };

    // 0.36.9: con la matriz expandida, cualquier métrica que NO sea
    // count sobre todos los registros requiere un field_id. La única
    // configuración válida sin campo es metric=count + field_id=0
    // (= COUNT(*)).
    const metricNeedsField = metric !== 'count' || metricFieldId > 0
        ? metricFieldId > 0
        : true;

    const draftId = useRef<string>(generateWidgetId());

    const canSubmit = useMemo(() => {
        if (isContentWidget(type)) return true;
        if (listId <= 0) return false;
        if (type === 'kpi' || type === 'gauge') {
            return metricNeedsField;
        }
        if (type === 'chart_bar' || type === 'chart_pie' || type === 'funnel') {
            if (groupByFieldId <= 0) return false;
            return metricNeedsField;
        }
        if (type === 'chart_line' || type === 'chart_area') {
            if (dateFieldId <= 0) return false;
            return metricNeedsField;
        }
        if (type === 'stat_delta') {
            if (dateFieldId <= 0) return false;
            return metricNeedsField;
        }
        if (type === 'table') return true;
        if (type === 'pivot') {
            if (groupByFieldId <= 0 || subGroupByFieldId <= 0 || groupByFieldId === subGroupByFieldId) return false;
            return metricNeedsField;
        }
        if (type === 'forecast') return metricFieldId > 0 && stageFieldId > 0;
        return false;
    }, [type, listId, metricNeedsField, metricFieldId, groupByFieldId, dateFieldId, subGroupByFieldId, stageFieldId]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                    )}
                />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                        'imcrm-max-h-[90vh] imcrm-overflow-y-auto',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                            {initial ? __('Editar widget') : __('Nuevo widget')}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="w-title">{__('Título')}</Label>
                            <Input
                                id="w-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder={__('Ej. Leads activos')}
                            />
                        </div>

                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="w-type">{__('Tipo')}</Label>
                                <Select
                                    id="w-type"
                                    value={typeSelectValue}
                                    onChange={(e) => changeTypeSelect(e.target.value)}
                                    data-testid="imcrm-widget-type"
                                >
                                    <option value="kpi">{__('KPI · Número')}</option>
                                    <option value="stat_delta">{__('KPI · Delta vs período')}</option>
                                    <option value="gauge">{__('Medidor · Progreso vs meta')}</option>
                                    <option value="chart_bar">{__('Gráfico de barras (horizontales)')}</option>
                                    <option value="chart_columns">{__('Gráfico de columnas (verticales)')}</option>
                                    <option value="chart_pie">{__('Gráfico de torta')}</option>
                                    <option value="funnel">{__('Embudo (etapas de pipeline)')}</option>
                                    <option value="chart_line">{__('Línea (tendencia mensual)')}</option>
                                    <option value="chart_area">{__('Área (tendencia mensual)')}</option>
                                    <option value="table">{__('Tabla · Top N')}</option>
                                    <option value="pivot">{__('Tabla dinámica · Filas × columnas')}</option>
                                    <option value="forecast">{__('Pronóstico de ventas · Embudo ponderado')}</option>
                                    {!report && (
                                        <>
                                            <option value="heading">{__('Contenido · Título de sección')}</option>
                                            <option value="text">{__('Contenido · Texto')}</option>
                                            <option value="image">{__('Contenido · Imagen')}</option>
                                            <option value="divider">{__('Contenido · Separador')}</option>
                                            <option value="spacer">{__('Contenido · Espaciador')}</option>
                                        </>
                                    )}
                                </Select>
                            </div>
                            {! isContentWidget(type) && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="w-list">{__('Lista')}</Label>
                                <Select
                                    id="w-list"
                                    value={listId}
                                    onChange={(e) => {
                                        setListId(Number(e.target.value));
                                        setMetricFieldId(0);
                                        setGroupByFieldId(0);
                                        setDateFieldId(0);
                                        setSortFieldId(0);
                                        setVisibleFieldIds([]);
                                        setSubGroupByFieldId(0);
                                        setStageFieldId(0);
                                        setStageProbabilities({});
                                    }}
                                >
                                    <option value={0}>{__('Elige…')}</option>
                                    {(lists.data ?? []).map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {listOptionLabel(l, lists.data ?? [], groups.data ?? [])}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                            )}
                        </div>

                        {/* 0.36.7: la config específica del tipo viene PRIMERO,
                            antes del período y los filtros. Así cuando el usuario
                            elige "KPI" o "Gráfico de barras" ve inmediatamente las
                            opciones que más importan (métrica, agrupar por, etc.)
                            sin tener que scrollear pasando el panel de filtros que
                            ocupa mucho espacio cuando se expande. */}

                        {(type === 'kpi' || type === 'gauge') && (
                            <>
                                <KpiConfig
                                    metric={metric}
                                    metricFieldId={metricFieldId}
                                    aggregatableFields={aggregatableFields}
                                    onMetricChange={setMetric}
                                    onMetricFieldChange={setMetricFieldId}
                                />
                                {/* v0.1.99 — extras premium del KPI/medidor. */}
                                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                                    {type === 'kpi' && (
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                            <Label htmlFor="w-icon">{__('Icono')}</Label>
                                            <Select id="w-icon" value={kpiIcon} onChange={(e) => setKpiIcon(e.target.value)}>
                                                {KPI_ICON_OPTIONS.map((o) => (
                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    )}
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="w-goal">{type === 'gauge' ? __('Meta (requerida)') : __('Meta (opcional)')}</Label>
                                        <Input
                                            id="w-goal"
                                            type="number"
                                            min={0}
                                            step="any"
                                            value={kpiGoal}
                                            onChange={(e) => setKpiGoal(e.target.value)}
                                            placeholder={__('Ej. 100000')}
                                        />
                                    </div>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="w-prefix">{__('Prefijo')}</Label>
                                        <Input id="w-prefix" value={kpiPrefix} onChange={(e) => setKpiPrefix(e.target.value)} placeholder="$" />
                                    </div>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="w-suffix">{__('Sufijo')}</Label>
                                        <Input id="w-suffix" value={kpiSuffix} onChange={(e) => setKpiSuffix(e.target.value)} placeholder="%" />
                                    </div>
                                </div>
                                {type === 'kpi' && dateFields.length > 0 && (
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="w-spark">{__('Mini-tendencia (campo de fecha)')}</Label>
                                        <Select
                                            id="w-spark"
                                            value={sparkFieldId}
                                            onChange={(e) => setSparkFieldId(Number(e.target.value))}
                                        >
                                            <option value={0}>{__('— Sin tendencia —')}</option>
                                            {dateFields.map((f) => (
                                                <option key={f.id} value={f.id}>{f.label}</option>
                                            ))}
                                        </Select>
                                        <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                            {__('Dibuja la misma métrica día a día (últimos 30 días) bajo el número.')}
                                        </p>
                                    </div>
                                )}
                            </>
                        )}

                        {(type === 'chart_bar' || type === 'chart_pie' || type === 'funnel') && (
                            <>
                                <ChartMetricConfig
                                    metric={metric}
                                    metricFieldId={metricFieldId}
                                    aggregatableFields={aggregatableFields}
                                    onMetricChange={setMetric}
                                    onMetricFieldChange={setMetricFieldId}
                                />
                                <FieldPicker
                                    label={__('Agrupar por')}
                                    value={groupByFieldId}
                                    fields={groupableFields}
                                    onChange={changeGroupBy}
                                    emptyHint={__('La lista no tiene campos agrupables (select, multi_select, text, email, url, date, datetime, checkbox).')}
                                />
                                {isDateField(fields.data ?? [], groupByFieldId) && (
                                    <TimeBucketPicker
                                        value={timeBucket}
                                        onChange={setTimeBucket}
                                    />
                                )}
                                {type === 'chart_bar' && (
                                    <OrientationChoice value={barOrientation} onChange={chooseOrientation} />
                                )}
                                {type === 'chart_bar' && (
                                    <BreakdownConfig
                                        type={type}
                                        fields={groupableFields.filter((f) => f.id !== groupByFieldId)}
                                        allFields={fields.data ?? []}
                                        metric={metric}
                                        subGroupByFieldId={subGroupByFieldId}
                                        subTimeBucket={subTimeBucket}
                                        stackMode={stackMode}
                                        stackPercent={stackPercent}
                                        seriesTopN={seriesTopN}
                                        onSubGroupChange={changeBreakdown}
                                        onSubTimeBucketChange={setSubTimeBucket}
                                        onStackModeChange={setStackMode}
                                        onStackPercentChange={setStackPercent}
                                        onSeriesTopNChange={setSeriesTopN}
                                    />
                                )}
                            </>
                        )}

                        {type === 'pivot' && (
                            <PivotConfig
                                metric={metric}
                                metricFieldId={metricFieldId}
                                aggregatableFields={aggregatableFields}
                                onMetricChange={setMetric}
                                onMetricFieldChange={setMetricFieldId}
                                groupableFields={groupableFields}
                                allFields={fields.data ?? []}
                                rowFieldId={groupByFieldId}
                                colFieldId={subGroupByFieldId}
                                rowBucket={timeBucket}
                                colBucket={subTimeBucket}
                                rowsTop={topN}
                                colsTop={colTopN}
                                rowSort={chartSort}
                                colSort={colSort}
                                heatmap={heatmap}
                                totals={showTotals}
                                onRowFieldChange={setGroupByFieldId}
                                onColFieldChange={setSubGroupByFieldId}
                                onRowBucketChange={setTimeBucket}
                                onColBucketChange={setSubTimeBucket}
                                onRowsTopChange={setTopN}
                                onColsTopChange={setColTopN}
                                onRowSortChange={setChartSort}
                                onColSortChange={setColSort}
                                onHeatmapChange={setHeatmap}
                                onTotalsChange={setShowTotals}
                            />
                        )}

                        {type === 'forecast' && (
                            <ForecastConfig
                                fields={fields.data ?? []}
                                amountFields={aggregatableFields.filter((f) => FORECAST_AMOUNT_TYPES.has(f.type))}
                                amountFieldId={metricFieldId}
                                stageFieldId={stageFieldId}
                                closeFieldId={dateFieldId}
                                bucket={timeBucket}
                                probabilities={stageProbabilities}
                                goal={kpiGoal}
                                onAmountChange={setMetricFieldId}
                                onStageChange={(id) => {
                                    setStageFieldId(id);
                                    setStageProbabilities({});
                                }}
                                onCloseChange={setDateFieldId}
                                onBucketChange={setTimeBucket}
                                onProbabilitiesChange={setStageProbabilities}
                                onGoalChange={setKpiGoal}
                            />
                        )}

                        {(type === 'chart_line' || type === 'chart_area') && (
                            <>
                                <ChartMetricConfig
                                    metric={metric}
                                    metricFieldId={metricFieldId}
                                    aggregatableFields={aggregatableFields}
                                    onMetricChange={setMetric}
                                    onMetricFieldChange={setMetricFieldId}
                                />
                                <FieldPicker
                                    label={__('Campo de fecha')}
                                    value={dateFieldId}
                                    fields={dateFields}
                                    onChange={setDateFieldId}
                                    emptyHint={__('La lista no tiene campos Date/DateTime.')}
                                />
                                <TimeBucketPicker
                                    value={timeBucket}
                                    onChange={setTimeBucket}
                                />
                                <BreakdownConfig
                                    type={type}
                                    fields={groupableFields.filter((f) => f.id !== dateFieldId)}
                                    allFields={fields.data ?? []}
                                    metric={metric}
                                    subGroupByFieldId={subGroupByFieldId}
                                    subTimeBucket={subTimeBucket}
                                    stackMode={stackMode}
                                    stackPercent={stackPercent}
                                    seriesTopN={seriesTopN}
                                    onSubGroupChange={changeBreakdown}
                                    onSubTimeBucketChange={setSubTimeBucket}
                                    onStackModeChange={setStackMode}
                                    onStackPercentChange={setStackPercent}
                                    onSeriesTopNChange={setSeriesTopN}
                                />
                            </>
                        )}

                        {(type === 'chart_bar' || type === 'chart_pie' || type === 'funnel'
                            || type === 'chart_line' || type === 'chart_area') && (
                            <PresentationToggles
                                type={type}
                                breakdown={isBreakdownType(type) && subGroupByFieldId > 0}
                                showAverageLine={showAverageLine}
                                showDataLabels={showDataLabels}
                                showLegend={showLegend}
                                hideZeroGroups={hideZeroGroups}
                                onShowAverageLineChange={setShowAverageLine}
                                onShowDataLabelsChange={setShowDataLabels}
                                onShowLegendChange={setShowLegend}
                                onHideZeroGroupsChange={setHideZeroGroups}
                            />
                        )}

                        {(type === 'chart_bar' || type === 'chart_pie' || type === 'funnel') && (
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <Label htmlFor="w-sort">{__('Orden')}</Label>
                                    <Select id="w-sort" value={chartSort} onChange={(e) => setChartSort(e.target.value)}>
                                        <option value="">{type === 'funnel' ? __('Etapas del campo (automático)') : __('Automático')}</option>
                                        <option value="value_desc">{__('Mayor valor primero')}</option>
                                        <option value="value_asc">{__('Menor valor primero')}</option>
                                        <option value="label">{__('Alfabético')}</option>
                                        <option value="options">{__('Orden de las opciones del campo')}</option>
                                    </Select>
                                </div>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <Label htmlFor="w-top">{__('Categorías a mostrar')}</Label>
                                    <Select id="w-top" value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
                                        <option value={0}>{__('Hasta 50 (el resto en «Otros»)')}</option>
                                        <option value={5}>{__('Las 5 mayores')}</option>
                                        <option value={10}>{__('Las 10 mayores')}</option>
                                        <option value={20}>{__('Las 20 mayores')}</option>
                                    </Select>
                                </div>
                            </div>
                        )}

                        {type === 'chart_pie' && (
                            <div className="imcrm-grid imcrm-gap-1.5">
                                <Label htmlFor="pie-center-label" className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Etiqueta del centro')}
                                </Label>
                                <Input
                                    id="pie-center-label"
                                    value={centerLabel}
                                    onChange={(e) => setCenterLabel(e.target.value)}
                                    placeholder={__('Total')}
                                    maxLength={24}
                                />
                            </div>
                        )}

                        {type === 'stat_delta' && (
                            <StatDeltaConfig
                                metric={metric}
                                metricFieldId={metricFieldId}
                                dateFieldId={dateFieldId}
                                periodDays={periodDays}
                                aggregatableFields={aggregatableFields}
                                dateFields={dateFields}
                                onMetricChange={setMetric}
                                onMetricFieldChange={setMetricFieldId}
                                onDateFieldChange={setDateFieldId}
                                onPeriodDaysChange={setPeriodDays}
                            />
                        )}

                        {type === 'table' && (
                            <TableConfig
                                fields={allUsableFields}
                                sortFieldId={sortFieldId}
                                sortDir={sortDir}
                                limit={tableLimit}
                                visibleFieldIds={visibleFieldIds}
                                onSortFieldChange={setSortFieldId}
                                onSortDirChange={setSortDir}
                                onLimitChange={setTableLimit}
                                onVisibleFieldsChange={setVisibleFieldIds}
                            />
                        )}

                        {type === 'heading' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="w-sub">{__('Subtítulo (opcional)')}</Label>
                                <Input
                                    id="w-sub"
                                    value={typeof contentConfig.subtitle === 'string' ? contentConfig.subtitle : ''}
                                    onChange={(e) => setContentConfig((c) => ({ ...c, subtitle: e.target.value }))}
                                    placeholder={__('Texto secundario bajo el título')}
                                />
                            </div>
                        )}

                        {type === 'text' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="w-text">{__('Texto')}</Label>
                                <textarea
                                    id="w-text"
                                    value={typeof contentConfig.text === 'string' ? contentConfig.text : ''}
                                    onChange={(e) => setContentConfig((c) => ({ ...c, text: e.target.value }))}
                                    rows={5}
                                    className="imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-sm focus:imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-primary"
                                    placeholder={__('Notas, contexto del tablero, instrucciones…')}
                                />
                            </div>
                        )}

                        {type === 'image' && (
                            <ImageBlockForm config={contentConfig} onConfigChange={setContentConfig} />
                        )}

                        {! isContentWidget(type) && listId > 0 && dateFields.length > 0 && (
                            <PeriodPicker
                                fields={dateFields}
                                fieldId={periodFieldId}
                                preset={periodPreset}
                                from={periodFrom}
                                to={periodTo}
                                onFieldChange={setPeriodFieldId}
                                onPresetChange={setPeriodPreset}
                                onFromChange={setPeriodFrom}
                                onToChange={setPeriodTo}
                            />
                        )}

                        {isComparableType(type) && listId > 0 && (
                            <CompareConfig
                                mode={compareMode}
                                toDate={compareToDate}
                                from={compareFrom}
                                to={compareTo}
                                invert={compareInvert}
                                hasPeriod={periodFieldId > 0 && periodPreset !== ''}
                                globalPeriod={(scope?.period ?? '') !== ''}
                                breakdown={isBreakdownType(type) && subGroupByFieldId > 0}
                                series={type === 'chart_line' || type === 'chart_area' || type === 'forecast'}
                                onModeChange={setCompareMode}
                                onToDateChange={setCompareToDate}
                                onFromChange={setCompareFrom}
                                onToChange={setCompareTo}
                                onInvertChange={setCompareInvert}
                            />
                        )}

                        {! isContentWidget(type) && listId > 0 && fields.data && fields.data.length > 0 && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
                                <FiltersPanel
                                    listId={listId}
                                    fields={fields.data}
                                    tree={filterTree}
                                    onChange={setFilterTree}
                                    inline
                                />
                                <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                    {__('Limitan los registros que cuenta el widget. Puedes pedir que se cumplan todas las condiciones o cualquiera de ellas, y agruparlas; para fechas hay rangos rápidos como «este mes».')}
                                </p>
                            </div>
                        )}

                        {! isContentWidget(type) && listId > 0 && (
                            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                <input
                                    type="checkbox"
                                    checked={includeSubtasks}
                                    onChange={(e) => setIncludeSubtasks(e.target.checked)}
                                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4"
                                />
                                <span>
                                    <span className="imcrm-font-medium imcrm-text-foreground">{__('Incluir subtareas')}</span>
                                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__('Sin marcar, el widget cuenta lo mismo que la tabla: sólo los registros de primer nivel.')}
                                    </span>
                                </span>
                            </label>
                        )}

                        {/* v0.1.286 — la vista previa aparece apenas hay lista: lo
                            que falte (agrupar, fecha, campo a calcular) se dice
                            DENTRO del recuadro en vez de dejarlo vacío. */}
                        {open && (report !== undefined || (dashboardId !== undefined && dashboardId > 0)) && ! isContentWidget(type) && listId > 0 && (
                            <WidgetPreview
                                dashboardId={dashboardId ?? 0}
                                report={report}
                                widget={buildWidget()}
                                scope={scope ?? { period: '', filters: [] }}
                                blockedHint={canSubmit ? null : __('Completa los datos del widget para ver la vista previa.')}
                            />
                        )}

                        {/* v0.1.98 — capa de estilo del card (misma del editor
                            de plantillas: fondo/texto/borde/tipografía + presets
                            de marca). Aplica a TODOS los tipos de widget. */}
                        {!report && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                                <BlockStyleEditor value={style} onChange={setStyle} />
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-5">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={!canSubmit}>
                                {initial ? __('Guardar cambios') : __('Añadir widget')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * 0.36.9: dos dropdowns. PRIMERO el campo (cualquier tipo), DESPUÉS
 * el cálculo — filtrado por tipo del campo. Antes el picker estaba
 * limitado a num/currency con sum/avg/count; ahora soporta todas las
 * agregaciones que ya calcula `RecordAggregator` per-tipo:
 *
 *   - number/currency → sum, avg, min, max, count, count_unique, count_empty
 *   - date/datetime   → min (más antiguo), max (más reciente), count, count_unique, count_empty
 *   - checkbox        → count_true (sí), count_false (no), count
 *   - text/select/multi_select/email/url/user/file → count, count_unique, count_empty
 *
 * El campo "(Todos los registros)" es un caso especial: field_id = 0 con
 * metric = 'count' → COUNT(*) sin filtrar columna.
 */
/** Operaciones de `computed` con valor numérico en SQL (espejo de `computed-sql.ts`). */
const NUMERIC_COMPUTED_OPS = new Set(['sum', 'product', 'subtract', 'divide', 'abs']);

function isNumericComputedOp(config: unknown): boolean {
    const op = typeof config === 'object' && config !== null ? (config as { operation?: unknown }).operation : undefined;
    return typeof op === 'string' && NUMERIC_COMPUTED_OPS.has(op);
}

interface FieldOpt {
    id: number;
    label: string;
    type: string;
}

interface MetricOpt {
    value: KpiMetric;
    label: string;
}

/**
 * Catálogo de métricas válidas por tipo de campo. Espejo de
 * `RecordAggregator::aggregateExprs()` en PHP — si actualizas uno,
 * actualiza el otro.
 */
function metricsForFieldType(rawType: string): MetricOpt[] {
    // v0.1.300 — las columnas de sistema miden como fecha y hora o persona; el ID
    // automático, como texto.
    const type = displayTypeOf(rawType);
    switch (type) {
        case 'number':
        case 'currency':
        case 'rating':
        case 'percent':
        case 'duration':
            // v0.1.158 — sumar las horas de un proyecto o promediar la
            // satisfacción es justamente para lo que existen estos tipos.
            return [
                { value: 'sum',          label: __('Suma') },
                { value: 'avg',          label: __('Promedio') },
                { value: 'min',          label: __('Mínimo') },
                { value: 'max',          label: __('Máximo') },
                { value: 'count',        label: __('Contar valores') },
                { value: 'count_unique', label: __('Valores únicos') },
                { value: 'count_empty',  label: __('Vacíos') },
            ];
        case 'date':
        case 'datetime':
            return [
                { value: 'min',          label: __('Más antiguo') },
                { value: 'max',          label: __('Más reciente') },
                { value: 'count',        label: __('Contar valores') },
                { value: 'count_unique', label: __('Valores únicos') },
                { value: 'count_empty',  label: __('Vacíos') },
            ];
        case 'checkbox':
            return [
                { value: 'count_true',  label: __('Cantidad de sí') },
                { value: 'count_false', label: __('Cantidad de no') },
                { value: 'count',       label: __('Contar valores') },
            ];
        default:
            // text / select / multi_select / email / url / user / file
            return [
                { value: 'count',        label: __('Contar valores') },
                { value: 'count_unique', label: __('Valores únicos') },
                { value: 'count_empty',  label: __('Vacíos') },
            ];
    }
}

interface FlatMetricPickerProps {
    label: string;
    metric: KpiMetric;
    metricFieldId: number;
    aggregatableFields: FieldOpt[];
    onChange: (metric: KpiMetric, fieldId: number) => void;
}

function FlatMetricPicker({
    label,
    metric,
    metricFieldId,
    aggregatableFields,
    onChange,
}: FlatMetricPickerProps): JSX.Element {
    const selectedField = aggregatableFields.find((f) => f.id === metricFieldId) ?? null;

    // Métricas válidas para el campo elegido. Si no hay campo (field_id=0)
    // sólo queda "Contar registros".
    const metricsForField: MetricOpt[] =
        selectedField === null
            ? [{ value: 'count', label: __('Contar registros') }]
            : metricsForFieldType(selectedField.type);

    // Si la métrica actual no aplica al campo elegido (cambio de tipo),
    // caemos a la primera válida — el usuario ve un default sensato sin
    // estados rotos.
    const effectiveMetric: KpiMetric = metricsForField.some((m) => m.value === metric)
        ? metric
        : metricsForField[0]!.value;

    const handleFieldChange = (idStr: string): void => {
        const id = Number(idStr) || 0;
        const newField = aggregatableFields.find((f) => f.id === id) ?? null;
        // Default sensato según el tipo del nuevo campo.
        const defaultMetric: KpiMetric =
            newField === null ? 'count' : metricsForFieldType(newField.type)[0]!.value;
        onChange(defaultMetric, id);
    };

    const handleMetricChange = (next: KpiMetric): void => {
        onChange(next, metricFieldId);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="w-metric-field">{label}</Label>
                <Select
                    id="w-metric-field"
                    value={metricFieldId}
                    onChange={(e) => handleFieldChange(e.target.value)}
                >
                    <option value={0}>{__('(Todos los registros)')}</option>
                    {aggregatableFields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="w-metric-kind">{__('Cálculo')}</Label>
                <Select
                    id="w-metric-kind"
                    value={effectiveMetric}
                    onChange={(e) => handleMetricChange(e.target.value as KpiMetric)}
                >
                    {metricsForField.map((m) => (
                        <option key={m.value} value={m.value}>
                            {m.label}
                        </option>
                    ))}
                </Select>
            </div>
        </div>
    );
}

interface KpiConfigProps {
    metric: KpiMetric;
    metricFieldId: number;
    aggregatableFields: FieldOpt[];
    onMetricChange: (metric: KpiMetric) => void;
    onMetricFieldChange: (id: number) => void;
}

function KpiConfig({
    metric,
    metricFieldId,
    aggregatableFields,
    onMetricChange,
    onMetricFieldChange,
}: KpiConfigProps): JSX.Element {
    return (
        <FlatMetricPicker
            label={__('Campo')}
            metric={metric}
            metricFieldId={metricFieldId}
            aggregatableFields={aggregatableFields}
            onChange={(m, id) => {
                onMetricChange(m);
                onMetricFieldChange(id);
            }}
        />
    );
}

/**
 * Métrica para charts (bar/pie/line/area). Mismo dropdown plano que
 * KpiConfig — wrapper que adapta los handlers separados a la API
 * unificada de FlatMetricPicker.
 */
interface ChartMetricConfigProps {
    metric: KpiMetric;
    metricFieldId: number;
    aggregatableFields: FieldOpt[];
    onMetricChange: (metric: KpiMetric) => void;
    onMetricFieldChange: (id: number) => void;
}

function ChartMetricConfig({
    metric,
    metricFieldId,
    aggregatableFields,
    onMetricChange,
    onMetricFieldChange,
}: ChartMetricConfigProps): JSX.Element {
    return (
        <FlatMetricPicker
            label={__('Campo a medir')}
            metric={metric}
            metricFieldId={metricFieldId}
            aggregatableFields={aggregatableFields}
            onChange={(m, id) => {
                onMetricChange(m);
                onMetricFieldChange(id);
            }}
        />
    );
}

interface StatDeltaConfigProps {
    metric: KpiMetric;
    metricFieldId: number;
    dateFieldId: number;
    periodDays: number;
    aggregatableFields: FieldOpt[];
    dateFields: Array<{ id: number; label: string }>;
    onMetricChange: (metric: KpiMetric) => void;
    onMetricFieldChange: (id: number) => void;
    onDateFieldChange: (id: number) => void;
    onPeriodDaysChange: (n: number) => void;
}

function StatDeltaConfig({
    metric,
    metricFieldId,
    dateFieldId,
    periodDays,
    aggregatableFields,
    dateFields,
    onMetricChange,
    onMetricFieldChange,
    onDateFieldChange,
    onPeriodDaysChange,
}: StatDeltaConfigProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <FlatMetricPicker
                label={__('Campo')}
                metric={metric}
                metricFieldId={metricFieldId}
                aggregatableFields={aggregatableFields}
                onChange={(m, id) => {
                    onMetricChange(m);
                    onMetricFieldChange(id);
                }}
            />
            <FieldPicker
                label={__('Campo de fecha (define períodos)')}
                value={dateFieldId}
                fields={dateFields}
                onChange={onDateFieldChange}
                emptyHint={__('La lista no tiene campos Date/DateTime.')}
            />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="w-sd-period">{__('Período actual (días)')}</Label>
                <Select
                    id="w-sd-period"
                    value={periodDays}
                    onChange={(e) => onPeriodDaysChange(Number(e.target.value))}
                >
                    <option value={7}>{__('Últimos 7 días')}</option>
                    <option value={14}>{__('Últimos 14 días')}</option>
                    <option value={30}>{__('Últimos 30 días')}</option>
                    <option value={90}>{__('Últimos 90 días')}</option>
                    <option value={180}>{__('Últimos 180 días')}</option>
                </Select>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Compara contra el período anterior de la misma duración.')}
                </p>
            </div>
        </div>
    );
}

interface TableConfigProps {
    fields: Array<{ id: number; label: string }>;
    sortFieldId: number;
    sortDir: 'asc' | 'desc';
    limit: number;
    visibleFieldIds: number[];
    onSortFieldChange: (id: number) => void;
    onSortDirChange: (dir: 'asc' | 'desc') => void;
    onLimitChange: (n: number) => void;
    onVisibleFieldsChange: (ids: number[]) => void;
}

function TableConfig({
    fields,
    sortFieldId,
    sortDir,
    limit,
    visibleFieldIds,
    onSortFieldChange,
    onSortDirChange,
    onLimitChange,
    onVisibleFieldsChange,
}: TableConfigProps): JSX.Element {
    const toggleField = (id: number): void => {
        if (visibleFieldIds.includes(id)) {
            onVisibleFieldsChange(visibleFieldIds.filter((x) => x !== id));
        } else {
            onVisibleFieldsChange([...visibleFieldIds, id]);
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-tb-sort">{__('Ordenar por')}</Label>
                    <Select
                        id="w-tb-sort"
                        value={sortFieldId}
                        onChange={(e) => onSortFieldChange(Number(e.target.value))}
                    >
                        <option value={0}>{__('Más reciente')}</option>
                        {fields.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-tb-dir">{__('Dirección')}</Label>
                    <Select
                        id="w-tb-dir"
                        value={sortDir}
                        onChange={(e) => onSortDirChange(e.target.value as 'asc' | 'desc')}
                    >
                        <option value="desc">{__('Descendente')}</option>
                        <option value="asc">{__('Ascendente')}</option>
                    </Select>
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="w-tb-limit">{__('Cantidad')}</Label>
                <Select
                    id="w-tb-limit"
                    value={limit}
                    onChange={(e) => onLimitChange(Number(e.target.value))}
                >
                    <option value={5}>{__('Top 5')}</option>
                    <option value={10}>{__('Top 10')}</option>
                    <option value={20}>{__('Top 20')}</option>
                    <option value={50}>{__('Top 50')}</option>
                </Select>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <Label>{__('Columnas visibles')}</Label>
                {fields.length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-warning">{__('Esta lista no tiene campos.')}</p>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                        {fields.map((f) => {
                            const checked = visibleFieldIds.includes(f.id);
                            return (
                                <label
                                    key={f.id}
                                    className={cn(
                                        'imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-[12px] imcrm-transition-colors',
                                        checked
                                            ? 'imcrm-border-primary/40 imcrm-bg-primary/10 imcrm-text-primary'
                                            : 'imcrm-border-border imcrm-bg-card hover:imcrm-bg-canvas',
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleField(f.id)}
                                    />
                                    {f.label}
                                </label>
                            );
                        })}
                    </div>
                )}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Si no eliges ninguna, se muestra el campo del título y los 7 siguientes.')}
                </p>
            </div>
        </div>
    );
}

interface FieldPickerProps {
    label: string;
    value: number;
    fields: Array<{ id: number; label: string }>;
    onChange: (id: number) => void;
    emptyHint: string;
}

interface PeriodPickerProps {
    fields: Array<{ id: number; label: string }>;
    fieldId: number;
    preset: DateRangePresetId | '';
    from: string;
    to: string;
    onFieldChange: (id: number) => void;
    onPresetChange: (id: DateRangePresetId | '') => void;
    onFromChange: (v: string) => void;
    onToChange: (v: string) => void;
}

/**
 * Atajo dedicado para limitar el widget a un rango temporal relativo
 * (este mes / últimos 7 días / este año / etc.) sin abrir el panel
 * de filtros. Estilo ClickUp: dos selects compactos arriba del bloque
 * de filtros, opt-in por widget.
 *
 * Si el usuario activa un preset y elige el campo, el backend
 * (`WidgetEvaluator`) inyecta automáticamente la condición
 * `between_relative` cuando ejecuta la query — los datos se
 * recalculan en cada carga sin tocar fechas.
 */
function PeriodPicker({
    fields,
    fieldId,
    preset,
    from,
    to,
    onFieldChange,
    onPresetChange,
    onFromChange,
    onToChange,
}: PeriodPickerProps): JSX.Element {
    // v0.1.105 — 'Personalizado' habilitado: rango fijo con fecha
    // inicio/fin (antes se filtraba de la lista).
    const presets = DATE_RANGE_PRESETS;
    const enabled = fieldId > 0 && preset !== '';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Período')}
                </Label>
                {enabled && (
                    <button
                        type="button"
                        onClick={() => {
                            onFieldChange(0);
                            onPresetChange('');
                        }}
                        className="imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                    >
                        {__('Quitar')}
                    </button>
                )}
            </div>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Select
                    value={fieldId}
                    onChange={(e) => onFieldChange(Number(e.target.value))}
                >
                    <option value={0}>{__('— Campo de fecha —')}</option>
                    {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                <Select
                    value={preset}
                    onChange={(e) => onPresetChange(e.target.value as DateRangePresetId | '')}
                >
                    <option value="">{__('— Rango —')}</option>
                    {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </Select>
            </div>
            {preset === 'custom' && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => onFromChange(e.target.value)}
                        aria-label={__('Desde')}
                        className="imcrm-h-8 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">→</span>
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => onToChange(e.target.value)}
                        aria-label={__('Hasta')}
                        className="imcrm-h-8 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    />
                </div>
            )}
            <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                {preset === 'custom'
                    ? __('Rango fijo: el widget muestra solo los registros entre esas dos fechas (inclusive).')
                    : __('Limita el widget a un rango relativo. Se recalcula en cada carga del dashboard — "este mes" será siempre el mes actual.')}
            </p>
        </div>
    );
}

interface TimeBucketPickerProps {
    value: ChartTimeBucket;
    onChange: (next: ChartTimeBucket) => void;
}

function TimeBucketPicker({ value, onChange }: TimeBucketPickerProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor="w-bucket">{__('Granularidad temporal')}</Label>
            <Select
                id="w-bucket"
                value={value}
                onChange={(e) => onChange(e.target.value as ChartTimeBucket)}
            >
                <option value="day">{__('Día')}</option>
                <option value="week">{__('Semana')}</option>
                <option value="month">{__('Mes')}</option>
                <option value="quarter">{__('Trimestre')}</option>
                <option value="year">{__('Año')}</option>
            </Select>
        </div>
    );
}

interface PresentationTogglesProps {
    type: WidgetType;
    /** v0.1.292 — con desglose: la leyenda de las series. */
    breakdown?: boolean;
    showAverageLine: boolean;
    showDataLabels: boolean;
    showLegend: boolean;
    hideZeroGroups: boolean;
    onShowAverageLineChange: (next: boolean) => void;
    onShowDataLabelsChange: (next: boolean) => void;
    onShowLegendChange: (next: boolean) => void;
    onHideZeroGroupsChange: (next: boolean) => void;
}

function PresentationToggles({
    type,
    breakdown = false,
    showAverageLine,
    showDataLabels,
    showLegend,
    hideZeroGroups,
    onShowAverageLineChange,
    onShowDataLabelsChange,
    onShowLegendChange,
    onHideZeroGroupsChange,
}: PresentationTogglesProps): JSX.Element {
    // v0.1.286 — sólo lo que cada gráfico SABE dibujar. La línea de promedio
    // en barras y tendencias; las etiquetas (los valores sobre el gráfico) en
    // el donut y las tendencias — las barras y el embudo ya muestran su
    // número siempre —, y la leyenda sólo en el donut.
    const supportsAverage = !breakdown && (type === 'chart_bar' || type === 'chart_line' || type === 'chart_area');
    const supportsLabels = !breakdown && (type === 'chart_pie' || type === 'chart_line' || type === 'chart_area');
    const supportsLegend = type === 'chart_pie' || breakdown;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Mostrar')}
            </Label>
            {supportsAverage && (
                <ToggleRow
                    label={__('Línea de promedio')}
                    checked={showAverageLine}
                    onChange={onShowAverageLineChange}
                />
            )}
            {supportsLabels && (
                <ToggleRow
                    label={__('Etiquetas de datos')}
                    checked={showDataLabels}
                    onChange={onShowDataLabelsChange}
                />
            )}
            {supportsLegend && (
                <ToggleRow
                    label={__('Leyenda')}
                    checked={showLegend}
                    onChange={onShowLegendChange}
                />
            )}
            {(type === 'chart_pie' || type === 'chart_bar' || type === 'funnel') && (
                // v0.1.102 — condición sobre el RESULTADO del gráfico (no
                // sobre los registros): los grupos cuya métrica da 0 o vacío
                // no se dibujan ni aparecen en la leyenda.
                <ToggleRow
                    label={__('Ocultar grupos en cero')}
                    checked={hideZeroGroups}
                    onChange={onHideZeroGroupsChange}
                />
            )}
        </div>
    );
}

function ToggleRow({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
}): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-justify-between imcrm-text-xs">
            <span className="imcrm-text-foreground">{label}</span>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="imcrm-h-4 imcrm-w-4"
            />
        </label>
    );
}

function isDateField(
    fields: ReadonlyArray<{ id: number; type: string }>,
    fieldId: number,
): boolean {
    if (fieldId <= 0) return false;
    const f = fields.find((x) => x.id === fieldId);
    return f !== undefined && DATE_LIKE_TYPES.has(f.type);
}

function FieldPicker({ label, value, fields, onChange, emptyHint }: FieldPickerProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{label}</Label>
            {fields.length === 0 ? (
                <p className="imcrm-text-xs imcrm-text-warning">{emptyHint}</p>
            ) : (
                <Select value={value} onChange={(e) => onChange(Number(e.target.value))}>
                    <option value={0}>{__('Elige…')}</option>
                    {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
            )}
        </div>
    );
}

function buildConfig(
    type: WidgetType,
    state: {
        metric: KpiMetric;
        metricFieldId: number;
        groupByFieldId: number;
        dateFieldId: number;
        periodDays: number;
        sortFieldId: number;
        sortDir: 'asc' | 'desc';
        tableLimit: number;
        visibleFieldIds: number[];
        filterTree: FilterTree;
        showAverageLine: boolean;
        showDataLabels: boolean;
        showLegend: boolean;
        timeBucket: ChartTimeBucket;
        period: WidgetPeriod | null;
    },
): WidgetSpec['config'] {
    const base = (): WidgetSpec['config'] => {
        const c: WidgetSpec['config'] = {};
        if (state.period !== null) {
            c.period = state.period;
        }
        if (state.filterTree.children.length > 0) {
            // Para árboles AND-planos persistimos también la forma
            // legacy `filters` (espejo) para que builds anteriores
            // del backend la sigan leyendo. Para árboles con OR/nested
            // solo guardamos `filter_tree`.
            c.filter_tree = state.filterTree;
            if (isFlatAndTree(state.filterTree)) {
                const filters: Record<string, Record<string, unknown>> = {};
                for (const cnd of state.filterTree.children) {
                    if (cnd.type !== 'condition') continue;
                    const key = `field_${cnd.field_id}`;
                    const existing = filters[key] ?? {};
                    existing[cnd.op] = cnd.value;
                    filters[key] = existing;
                }
                c.filters = filters;
            }
        }
        return c;
    };

    // v0.1.286 — booleanos EXPLÍCITOS (también los `false`): guardar sólo los
    // `true` hacía imposible apagar lo que viene encendido por defecto.
    const presentation = (c: WidgetSpec['config']): WidgetSpec['config'] => {
        if (type === 'chart_bar' || type === 'chart_line' || type === 'chart_area') {
            c.show_average_line = state.showAverageLine;
        }
        if (type === 'chart_pie' || type === 'chart_line' || type === 'chart_area') {
            c.show_data_labels = state.showDataLabels;
        }
        if (type === 'chart_pie') c.show_legend = state.showLegend;
        return c;
    };

    if (type === 'kpi' || type === 'gauge') {
        const c = base();
        c.metric = state.metric;
        if (state.metricFieldId > 0) {
            c.metric_field_id = state.metricFieldId;
        }
        return c;
    }
    if (type === 'chart_bar' || type === 'chart_pie' || type === 'funnel') {
        const c: WidgetSpec['config'] = {
            ...base(),
            group_by_field_id: state.groupByFieldId,
            time_bucket: state.timeBucket,
            metric: state.metric,
        };
        if (state.metricFieldId > 0) {
            c.metric_field_id = state.metricFieldId;
        }
        return presentation(c);
    }
    if (type === 'chart_line' || type === 'chart_area') {
        const c: WidgetSpec['config'] = {
            ...base(),
            date_field_id: state.dateFieldId,
            time_bucket: state.timeBucket,
            metric: state.metric,
        };
        if (state.metricFieldId > 0) {
            c.metric_field_id = state.metricFieldId;
        }
        return presentation(c);
    }
    if (type === 'stat_delta') {
        const c: WidgetSpec['config'] = {
            ...base(),
            metric: state.metric,
            date_field_id: state.dateFieldId,
            period_days: state.periodDays,
        };
        if (state.metricFieldId > 0) {
            c.metric_field_id = state.metricFieldId;
        }
        return c;
    }
    if (type === 'table') {
        const c: WidgetSpec['config'] = {
            ...base(),
            limit: state.tableLimit,
            sort_dir: state.sortDir,
            visible_field_ids: state.visibleFieldIds,
        };
        if (state.sortFieldId > 0) {
            c.sort_field_id = state.sortFieldId;
        }
        return c;
    }
    return base();
}

/**
 * Lee filtros del config de un widget en cualquiera de las dos formas:
 * - `filter_tree` (forma nueva, ClickUp-style con AND/OR/nesting).
 * - `filters` (legacy plano `{field_<id>: {op: val}}`).
 *
 * Si ninguna está, devuelve un árbol vacío.
 */
export function decodeWidgetFilters(config: WidgetSpec['config']): FilterTree {
    const tree = config.filter_tree;
    if (tree && typeof tree === 'object' && (tree as FilterTree).type === 'group') {
        return tree as FilterTree;
    }
    // v0.1.286 — una raíz que es una CONDICIÓN suelta (la guardaban
    // plantillas viejas): se envuelve en un grupo AND. Antes se descartaba y
    // al abrir y guardar el widget el filtro se BORRABA.
    if (tree && typeof tree === 'object' && (tree as { type?: unknown }).type === 'condition') {
        return { type: 'group', logic: 'and', children: [tree as FilterTree['children'][number]] };
    }
    const flat = config.filters;
    if (flat && typeof flat === 'object') {
        return treeFromActiveFilters(
            Object.entries(flat as Record<string, unknown>).flatMap(([key, opMap]) => {
                if (!key.startsWith('field_') || typeof opMap !== 'object' || opMap === null) {
                    return [];
                }
                const fieldId = Number(key.slice(6));
                if (!Number.isFinite(fieldId) || fieldId <= 0) return [];
                return Object.entries(opMap as Record<string, unknown>).map(([op, value]) => ({
                    field_id: fieldId,
                    op: op as FilterTree['children'][number] extends { op: infer O } ? O : never,
                    value,
                }));
            }) as Parameters<typeof treeFromActiveFilters>[0],
        );
    }
    return { type: 'group', logic: 'and', children: [] };
}

function generateWidgetId(): string {
    return 'w_' + Math.random().toString(36).slice(2, 10);
}

function isTimeBucket(value: unknown): value is ChartTimeBucket {
    return value === 'day' || value === 'week' || value === 'month'
        || value === 'quarter' || value === 'year';
}

/**
 * v0.1.286 — Nombre de una lista en el selector del widget: si hay OTRAS con
 * el mismo nombre (pasa con plantillas aplicadas varias veces) se distingue
 * por su carpeta o, sin carpeta, por su nombre interno.
 */
export function listOptionLabel(
    list: Pick<ListSummary, 'id' | 'name' | 'slug' | 'group_id'>,
    all: ReadonlyArray<Pick<ListSummary, 'id' | 'name'>>,
    groups: ReadonlyArray<Pick<ListGroup, 'id' | 'name'>>,
): string {
    const dup = all.some((l) => l.id !== list.id && l.name.trim().toLowerCase() === list.name.trim().toLowerCase());
    if (!dup) return list.name;
    const folder = list.group_id !== null ? groups.find((g) => g.id === list.group_id)?.name : undefined;
    return `${list.name} · ${folder ?? list.slug}`;
}

/**
 * v0.1.286 — ¿Le falta algo al widget para que la vista previa dibuje algo?
 * Un gráfico de barras sin «Agrupar por» salía en blanco, sin pista de por
 * qué. Devuelve el texto a mostrar en su lugar, o `null` si ya se puede.
 */
export function widgetPreviewHint(widget: Pick<WidgetSpec, 'type' | 'config'>): string | null {
    const id = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
    if (widget.type === 'chart_bar' || widget.type === 'chart_pie' || widget.type === 'funnel') {
        return id(widget.config.group_by_field_id) > 0 ? null : __('Elige cómo agrupar para ver el gráfico.');
    }
    if (widget.type === 'chart_line' || widget.type === 'chart_area' || widget.type === 'stat_delta') {
        return id(widget.config.date_field_id) > 0 ? null : __('Elige el campo de fecha para ver el gráfico.');
    }
    if (widget.type === 'pivot') {
        return id(widget.config.group_by_field_id) > 0 && id(widget.config.sub_group_by_field_id) > 0
            ? null
            : __('Elige el campo de las filas y el de las columnas para ver la tabla.');
    }
    if (widget.type === 'forecast') {
        return id(widget.config.metric_field_id) > 0 && id(widget.config.stage_field_id) > 0
            ? null
            : __('Elige el campo del monto y el de la etapa para ver el pronóstico.');
    }
    return null;
}

/** v0.1.462 — Widgets que aceptan «Comparar con…» (espejo de `COMPARABLE_TYPES` del servidor). */
export function isComparableType(type: WidgetType): boolean {
    return type === 'kpi' || type === 'gauge' || type === 'chart_bar' || type === 'chart_pie' || type === 'chart_line'
        || type === 'chart_area' || type === 'funnel' || type === 'table' || type === 'pivot' || type === 'forecast';
}

type CompareModeChoice = '' | 'previous' | 'last_year' | 'custom';

/** Las probabilidades guardadas de un pronóstico (0-100), leídas con tolerancia. */
function readProbabilities(raw: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            const n = typeof v === 'number' ? v : Number(v);
            if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(100, Math.round(n)));
        }
    }
    return out;
}

/** Tipos de campo que sirven de monto del pronóstico. */
const FORECAST_AMOUNT_TYPES: ReadonlySet<string> = new Set(['currency', 'number', 'rollup', 'percent']);

/**
 * v0.1.462 — «Comparar con…» (J2): el período anterior, el mismo del año
 * pasado o un rango elegido. Lo calcula el servidor con los mismos filtros.
 */
function CompareConfig(p: {
    mode: CompareModeChoice;
    toDate: boolean;
    from: string;
    to: string;
    invert: boolean;
    hasPeriod: boolean;
    globalPeriod: boolean;
    breakdown: boolean;
    series: boolean;
    onModeChange: (m: CompareModeChoice) => void;
    onToDateChange: (v: boolean) => void;
    onFromChange: (v: string) => void;
    onToChange: (v: string) => void;
    onInvertChange: (v: boolean) => void;
}): JSX.Element {
    return (
        <div
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-3"
            data-tour="widget-compare"
        >
            <Label htmlFor="w-compare" className="imcrm-text-xs imcrm-text-muted-foreground">{__('Comparar con…')}</Label>
            <Select id="w-compare" value={p.mode} onChange={(e) => p.onModeChange(e.target.value as CompareModeChoice)}>
                <option value="">{__('No comparar')}</option>
                <option value="previous">{__('El período anterior (misma duración)')}</option>
                <option value="last_year">{__('El mismo período del año pasado')}</option>
                <option value="custom">{__('Un rango que elijas')}</option>
            </Select>
            {p.mode === 'custom' && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <input
                        type="date"
                        value={p.from}
                        onChange={(e) => p.onFromChange(e.target.value)}
                        aria-label={__('Comparar desde')}
                        className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">→</span>
                    <input
                        type="date"
                        value={p.to}
                        onChange={(e) => p.onToChange(e.target.value)}
                        aria-label={__('Comparar hasta')}
                        className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    />
                </div>
            )}
            {p.mode !== '' && (
                <>
                    {p.mode !== 'custom' && !p.series && (
                        <ToggleRow
                            label={__('Hasta el mismo día (si el período no terminó, el anterior se corta en el mismo punto)')}
                            checked={p.toDate}
                            onChange={p.onToDateChange}
                        />
                    )}
                    <ToggleRow label={__('Menos es mejor (una baja se pinta en verde: costos, tickets abiertos)')} checked={p.invert} onChange={p.onInvertChange} />
                    {p.breakdown ? (
                        <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">{__('Con «Desglosar por» no se compara: quítalo para ver la variación.')}</p>
                    ) : !p.hasPeriod && !p.globalPeriod ? (
                        <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                            {__('Para comparar hace falta un período: elígelo arriba (o en el selector de período del tablero).')}
                        </p>
                    ) : null}
                </>
            )}
            <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                {p.series
                    ? __('El período anterior se dibuja punteado, alineado día con día (el 1 con el 1).')
                    : __('Muestra la variación junto al valor: «+12 % vs. mes anterior». Usa los mismos filtros del widget.')}
            </p>
        </div>
    );
}

/** v0.1.462 — Configuración del pronóstico de ventas (J3). */
function ForecastConfig(p: {
    fields: ReadonlyArray<{ id: number; label: string; type: string; config?: unknown }>;
    amountFields: FieldOpt[];
    amountFieldId: number;
    stageFieldId: number;
    closeFieldId: number;
    bucket: ChartTimeBucket;
    probabilities: Record<string, number>;
    goal: string;
    onAmountChange: (id: number) => void;
    onStageChange: (id: number) => void;
    onCloseChange: (id: number) => void;
    onBucketChange: (b: ChartTimeBucket) => void;
    onProbabilitiesChange: (p: Record<string, number>) => void;
    onGoalChange: (v: string) => void;
}): JSX.Element {
    const stageFields = p.fields.filter((f) => f.type === 'select');
    const closeFields = p.fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    const stageField = p.fields.find((f) => f.id === p.stageFieldId);
    const options = stageField ? stageOptionsOf(stageField.config as Record<string, unknown>) : [];
    const resolved = resolveStageProbabilities(options, p.probabilities);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-tour="widget-forecast">
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <FieldPicker
                    label={__('Monto del negocio')}
                    value={p.amountFieldId}
                    fields={p.amountFields}
                    onChange={p.onAmountChange}
                    emptyHint={__('La lista no tiene un campo de moneda o número.')}
                />
                <FieldPicker
                    label={__('Etapa (campo de selección)')}
                    value={p.stageFieldId}
                    fields={stageFields}
                    onChange={p.onStageChange}
                    emptyHint={__('La lista no tiene un campo de selección con las etapas.')}
                />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-close">{__('Fecha de cierre esperada')}</Label>
                    <Select id="w-close" value={p.closeFieldId} onChange={(e) => p.onCloseChange(Number(e.target.value))}>
                        <option value={0}>{__('— Sin fecha (un total por etapa) —')}</option>
                        {closeFields.map((f) => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-forecast-bucket">{__('Agrupar por')}</Label>
                    <Select
                        id="w-forecast-bucket"
                        value={p.bucket === 'week' || p.bucket === 'quarter' ? p.bucket : 'month'}
                        disabled={p.closeFieldId <= 0}
                        onChange={(e) => p.onBucketChange(e.target.value as ChartTimeBucket)}
                    >
                        <option value="week">{__('Semana')}</option>
                        <option value="month">{__('Mes')}</option>
                        <option value="quarter">{__('Trimestre')}</option>
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-forecast-goal">{__('Meta (opcional)')}</Label>
                    <Input
                        id="w-forecast-goal"
                        type="number"
                        min={0}
                        step="any"
                        value={p.goal}
                        onChange={(e) => p.onGoalChange(e.target.value)}
                        placeholder={__('Ej. 50000000')}
                    />
                </div>
            </div>
            {options.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <Label className="imcrm-text-xs">{__('Probabilidad de cierre por etapa')}</Label>
                        <button
                            type="button"
                            className="imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline"
                            onClick={() => p.onProbabilitiesChange({})}
                        >
                            {__('Volver a las sugeridas')}
                        </button>
                    </div>
                    {options.map((o) => (
                        <div key={o.value} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs" data-testid="imcrm-forecast-probability">
                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                                {o.label}
                                <span className="imcrm-ml-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                                    ({(resolved[o.value] ?? 0) >= 100 ? __('ganada') : (resolved[o.value] ?? 0) <= 0 ? __('perdida') : __('abierta')})
                                </span>
                            </span>
                            <Input
                                type="number"
                                min={0}
                                max={100}
                                step={5}
                                value={resolved[o.value] ?? 0}
                                onChange={(e) => {
                                    const n = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                                    p.onProbabilitiesChange({ ...p.probabilities, [o.value]: n });
                                }}
                                aria-label={o.label}
                                className="imcrm-h-8 imcrm-w-20 imcrm-text-right"
                            />
                            <span className="imcrm-text-muted-foreground">%</span>
                        </div>
                    ))}
                    <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                        {__('100 % = ganado; 0 % = perdido (no suma). En las demás, el pronóstico cuenta el monto × la probabilidad. Las sugerimos por el nombre de la etapa.')}
                    </p>
                </div>
            )}
        </div>
    );
}

/** v0.1.292 — Gráficos que aceptan "Desglosar por" (espejo de `BREAKDOWN_WIDGET_TYPES`). */
export function isBreakdownType(type: WidgetType): boolean {
    return type === 'chart_bar' || type === 'chart_area' || type === 'chart_line';
}

/** v0.1.292 — Métricas que suman (se apilan y van al 100 %; espejo de `STACKABLE_METRICS`). */
export function isStackableMetric(metric: string): boolean {
    return metric === 'count' || metric === 'count_empty' || metric === 'count_true' || metric === 'count_false' || metric === 'sum';
}

interface BreakdownConfigProps {
    type: WidgetType;
    /** Campos por los que se puede desglosar (sin el del eje principal). */
    fields: ReadonlyArray<{ id: number; label: string; type: string }>;
    allFields: ReadonlyArray<{ id: number; type: string }>;
    metric: KpiMetric;
    subGroupByFieldId: number;
    subTimeBucket: ChartTimeBucket;
    stackMode: 'stacked' | 'grouped';
    stackPercent: boolean;
    seriesTopN: number;
    onSubGroupChange: (id: number) => void;
    onSubTimeBucketChange: (b: ChartTimeBucket) => void;
    onStackModeChange: (m: 'stacked' | 'grouped') => void;
    onStackPercentChange: (v: boolean) => void;
    onSeriesTopNChange: (n: number) => void;
}

/**
 * v0.1.292 — "Desglosar por" un segundo campo: cada barra (o cada punto del
 * área) se parte en series con el color real de cada opción. Apiladas (y al
 * 100 %) sólo con métricas que suman: un promedio apilado no significa nada,
 * así que ahí van lado a lado.
 */
function BreakdownConfig({
    type,
    fields,
    allFields,
    metric,
    subGroupByFieldId,
    subTimeBucket,
    stackMode,
    stackPercent,
    seriesTopN,
    onSubGroupChange,
    onSubTimeBucketChange,
    onStackModeChange,
    onStackPercentChange,
    onSeriesTopNChange,
}: BreakdownConfigProps): JSX.Element {
    const stackable = isStackableMetric(metric);
    const mode = stackable ? stackMode : 'grouped';
    const sideLabel = type === 'chart_bar' ? __('Lado a lado') : __('Superpuestas');
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-3" data-testid="imcrm-breakdown-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="w-breakdown">{__('Desglosar por (opcional)')}</Label>
                <Select id="w-breakdown" value={subGroupByFieldId} onChange={(e) => onSubGroupChange(Number(e.target.value))}>
                    <option value={0}>{__('— Sin desglose —')}</option>
                    {fields.map((f) => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                </Select>
                <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                    {__('Parte cada barra en series según otro campo (por ejemplo, el estado por responsable), con el color de cada opción.')}
                </p>
            </div>
            {subGroupByFieldId > 0 && (
                <>
                    {isDateField(allFields, subGroupByFieldId) && (
                        <TimeBucketPicker value={subTimeBucket} onChange={onSubTimeBucketChange} />
                    )}
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="w-stack">{__('Series')}</Label>
                            <Select
                                id="w-stack"
                                value={mode}
                                onChange={(e) => onStackModeChange(e.target.value === 'grouped' ? 'grouped' : 'stacked')}
                            >
                                {stackable && <option value="stacked">{__('Apiladas')}</option>}
                                <option value="grouped">{sideLabel}</option>
                            </Select>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="w-series-top">{__('Series a mostrar')}</Label>
                            <Select id="w-series-top" value={seriesTopN} onChange={(e) => onSeriesTopNChange(Number(e.target.value))}>
                                <option value={0}>{__('Las 8 mayores (el resto en «Otros»)')}</option>
                                <option value={3}>{__('Las 3 mayores')}</option>
                                <option value={5}>{__('Las 5 mayores')}</option>
                                <option value={12}>{__('Las 12 mayores')}</option>
                                <option value={20}>{__('Las 20 mayores')}</option>
                            </Select>
                        </div>
                    </div>
                    {mode === 'stacked' && (
                        <ToggleRow label={__('Al 100 % (cada barra muestra el reparto)')} checked={stackPercent} onChange={onStackPercentChange} />
                    )}
                    {!stackable && (
                        <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                            {__('Con esta métrica las series van una al lado de la otra: apilar promedios, mínimos o máximos no tiene sentido.')}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

interface PivotConfigProps {
    metric: KpiMetric;
    metricFieldId: number;
    aggregatableFields: FieldOpt[];
    onMetricChange: (m: KpiMetric) => void;
    onMetricFieldChange: (id: number) => void;
    groupableFields: ReadonlyArray<{ id: number; label: string; type: string }>;
    allFields: ReadonlyArray<{ id: number; type: string }>;
    rowFieldId: number;
    colFieldId: number;
    rowBucket: ChartTimeBucket;
    colBucket: ChartTimeBucket;
    rowsTop: number;
    colsTop: number;
    rowSort: string;
    colSort: string;
    heatmap: boolean;
    totals: boolean;
    onRowFieldChange: (id: number) => void;
    onColFieldChange: (id: number) => void;
    onRowBucketChange: (b: ChartTimeBucket) => void;
    onColBucketChange: (b: ChartTimeBucket) => void;
    onRowsTopChange: (n: number) => void;
    onColsTopChange: (n: number) => void;
    onRowSortChange: (s: string) => void;
    onColSortChange: (s: string) => void;
    onHeatmapChange: (v: boolean) => void;
    onTotalsChange: (v: boolean) => void;
}

/** v0.1.292 — Configuración de la tabla dinámica: métrica, filas, columnas y presentación. */
function PivotConfig(p: PivotConfigProps): JSX.Element {
    const sortOptions = (
        <>
            <option value="">{__('Automático')}</option>
            <option value="value_desc">{__('Mayor total primero')}</option>
            <option value="value_asc">{__('Menor total primero')}</option>
            <option value="label">{__('Alfabético')}</option>
            <option value="options">{__('Orden de las opciones del campo')}</option>
        </>
    );
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-pivot-config">
            <ChartMetricConfig
                metric={p.metric}
                metricFieldId={p.metricFieldId}
                aggregatableFields={p.aggregatableFields}
                onMetricChange={p.onMetricChange}
                onMetricFieldChange={p.onMetricFieldChange}
            />
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <FieldPicker
                        label={__('Filas')}
                        value={p.rowFieldId}
                        fields={p.groupableFields.filter((f) => f.id !== p.colFieldId)}
                        onChange={p.onRowFieldChange}
                        emptyHint={__('La lista no tiene campos agrupables.')}
                    />
                    {isDateField(p.allFields, p.rowFieldId) && <TimeBucketPicker value={p.rowBucket} onChange={p.onRowBucketChange} />}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="w-pivot-rows-top">{__('Filas a mostrar')}</Label>
                        <Select id="w-pivot-rows-top" value={p.rowsTop} onChange={(e) => p.onRowsTopChange(Number(e.target.value))}>
                            <option value={0}>{__('Las 20 mayores (el resto en «Otros»)')}</option>
                            <option value={10}>{__('Las 10 mayores')}</option>
                            <option value={50}>{__('Las 50 mayores')}</option>
                            <option value={100}>{__('Las 100 mayores')}</option>
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="w-pivot-rows-sort">{__('Orden de las filas')}</Label>
                        <Select id="w-pivot-rows-sort" value={p.rowSort} onChange={(e) => p.onRowSortChange(e.target.value)}>
                            {sortOptions}
                        </Select>
                    </div>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <FieldPicker
                        label={__('Columnas')}
                        value={p.colFieldId}
                        fields={p.groupableFields.filter((f) => f.id !== p.rowFieldId)}
                        onChange={p.onColFieldChange}
                        emptyHint={__('La lista no tiene campos agrupables.')}
                    />
                    {isDateField(p.allFields, p.colFieldId) && <TimeBucketPicker value={p.colBucket} onChange={p.onColBucketChange} />}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="w-pivot-cols-top">{__('Columnas a mostrar')}</Label>
                        <Select id="w-pivot-cols-top" value={p.colsTop} onChange={(e) => p.onColsTopChange(Number(e.target.value))}>
                            <option value={0}>{__('Las 12 mayores (el resto en «Otros»)')}</option>
                            <option value={6}>{__('Las 6 mayores')}</option>
                            <option value={24}>{__('Las 24 mayores')}</option>
                            <option value={50}>{__('Las 50 mayores')}</option>
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor="w-pivot-cols-sort">{__('Orden de las columnas')}</Label>
                        <Select id="w-pivot-cols-sort" value={p.colSort} onChange={(e) => p.onColSortChange(e.target.value)}>
                            {sortOptions}
                        </Select>
                    </div>
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Mostrar')}</Label>
                <ToggleRow label={__('Totales por fila, por columna y general')} checked={p.totals} onChange={p.onTotalsChange} />
                <ToggleRow label={__('Mapa de calor (más intenso = mayor valor)')} checked={p.heatmap} onChange={p.onHeatmapChange} />
            </div>
        </div>
    );
}

/**
 * v0.1.286 — Vista previa EN VIVO del widget que se está configurando: el
 * mismo componente del tablero con datos reales (mismo período y filtros del
 * tablero), recalculada medio segundo después del último cambio.
 */
function WidgetPreview({
    dashboardId,
    widget,
    scope,
    report,
    blockedHint = null,
}: {
    dashboardId: number;
    widget: WidgetSpec;
    scope: DashboardBundleScope;
    /** v0.1.464 (J1) — en un informe: la vista previa del informe. */
    report?: ReportScope;
    /** Motivo por el que todavía no se puede calcular (formulario incompleto). */
    blockedHint?: string | null;
}): JSX.Element {
    const sig = JSON.stringify(widget);
    const [debounced, setDebounced] = useState<WidgetSpec>(widget);
    useEffect(() => {
        const t = window.setTimeout(() => setDebounced(JSON.parse(sig) as WidgetSpec), 450);
        return () => window.clearTimeout(t);
    }, [sig]);
    const hint = widgetPreviewHint(debounced) ?? blockedHint;
    const ready = hint === null ? debounced : null;
    const dashPreview = useWidgetPreview(report ? undefined : dashboardId, report ? null : ready, scope);
    const reportPreview = useReportWidgetPreview(report ? ready : null, report ?? { period: '', compare: '' });
    const preview = report ? reportPreview : dashPreview;
    const override = useMemo<WidgetDataOverride>(
        () => ({
            get: () => ({
                data: preview.data,
                isLoading: preview.isLoading,
                error: preview.error instanceof Error ? preview.error : null,
            }),
        }),
        [preview.data, preview.isLoading, preview.error],
    );
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-widget-preview">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Vista previa')}</Label>
            <div className="imcrm-h-60 imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
                {hint !== null ? (
                    <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-px-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-widget-preview-hint">
                        {hint}
                    </div>
                ) : (
                    <DashboardBundleContext.Provider value={scope}>
                        <WidgetDataOverrideContext.Provider value={override}>
                            <WidgetRenderer dashboardId={dashboardId} widget={debounced} />
                        </WidgetDataOverrideContext.Provider>
                    </DashboardBundleContext.Provider>
                )}
            </div>
        </div>
    );
}

/**
 * v0.1.474 — Barras o columnas, a la vista (antes un selector «Orientación»
 * que pocos encontraban). Cada opción con un dibujito de cómo se ve.
 */
function OrientationChoice({
    value,
    onChange,
}: {
    value: 'horizontal' | 'vertical';
    onChange: (next: 'horizontal' | 'vertical') => void;
}): JSX.Element {
    const options: Array<{ id: 'horizontal' | 'vertical'; label: string; hint: string }> = [
        { id: 'vertical', label: __('Columnas'), hint: __('Una columna por mes, día o categoría, con su valor arriba.') },
        { id: 'horizontal', label: __('Barras'), hint: __('Una barra por categoría, de izquierda a derecha.') },
    ];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-tour="widget-orientation">
            <span className="imcrm-text-sm imcrm-font-medium">{__('Cómo se dibuja')}</span>
            <div role="radiogroup" aria-label={__('Cómo se dibuja')} className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                {options.map((o) => {
                    const active = value === o.id;
                    return (
                        <button
                            key={o.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => onChange(o.id)}
                            data-testid={`imcrm-orientation-${o.id}`}
                            className={cn(
                                'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                                active
                                    ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                    : 'imcrm-border-input hover:imcrm-bg-accent',
                            )}
                        >
                            <OrientationGlyph vertical={o.id === 'vertical'} active={active} />
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                <span className="imcrm-text-[13px] imcrm-font-medium">{o.label}</span>
                                <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{o.hint}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function OrientationGlyph({ vertical, active }: { vertical: boolean; active: boolean }): JSX.Element {
    const bars = [0.55, 0.85, 0.4, 0.7];
    return (
        <svg viewBox="0 0 32 32" className={cn('imcrm-h-8 imcrm-w-8 imcrm-shrink-0', active ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} aria-hidden>
            {bars.map((v, i) =>
                vertical ? (
                    <rect key={i} x={3 + i * 7} y={29 - v * 24} width={5} height={v * 24} rx={1} fill="currentColor" />
                ) : (
                    <rect key={i} x={3} y={3 + i * 7} width={v * 26} height={5} rx={1} fill="currentColor" />
                ),
            )}
        </svg>
    );
}
