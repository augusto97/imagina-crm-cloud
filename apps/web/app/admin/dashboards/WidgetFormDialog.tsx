import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { KPI_ICON_OPTIONS } from '@/admin/dashboards/widgets/KpiWidget';
import { BlockStyleEditor } from '@/admin/template-editor-core/BlockStyleEditor';
import { ImageBlockForm } from '@/admin/template-editor-core/ImageBlockForm';
import { hasBlockStyle, readBlockStyle, type BlockStyle } from '@/lib/blockStyle';
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
import type { FilterTree } from '@/types/record';

import { FiltersPanel } from '@/admin/records/FiltersPanel';
import {
    isFlatAndTree,
    treeFromActiveFilters,
} from '@/admin/records/filterTree';

interface WidgetFormDialogProps {
    initial: WidgetSpec | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (widget: WidgetSpec) => void;
}

const GROUPABLE_TYPES = [
    'select', 'multi_select',
    'text', 'email', 'url',
    'date', 'datetime',
    'checkbox',
];

export function WidgetFormDialog({
    initial,
    open,
    onOpenChange,
    onSave,
}: WidgetFormDialogProps): JSX.Element {
    const lists = useLists();

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
        () => (fields.data ?? []).filter((f) => GROUPABLE_TYPES.includes(f.type)),
        [fields.data],
    );
    const dateFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type === 'date' || f.type === 'datetime'),
        [fields.data],
    );
    const allUsableFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type !== 'relation'),
        [fields.data],
    );
    // 0.36.9: cualquier field excepto relation/computed se puede usar
    // como metric en KPI/Charts/StatDelta — RecordAggregator soporta
    // count/count_unique/count_empty para todos, sum/avg/min/max/etc
    // según tipo. El picker filtra qué cálculos se ofrecen.
    const aggregatableFields = useMemo<FieldOpt[]>(
        () => (fields.data ?? [])
            .filter((f) => f.type !== 'relation' && f.type !== 'computed')
            .map((f) => ({ id: f.id, label: f.label, type: f.type })),
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
            setShowAverageLine(Boolean(initial.config.show_average_line));
            setShowDataLabels(Boolean(initial.config.show_data_labels));
            setShowLegend(Boolean(initial.config.show_legend));
            setTimeBucket(
                isTimeBucket(initial.config.time_bucket)
                    ? initial.config.time_bucket
                    : 'month',
            );
            const period = initial.config.period;
            if (period && typeof period === 'object' && period.field_id > 0) {
                setPeriodFieldId(period.field_id);
                setPeriodPreset(period.preset as DateRangePresetId);
            } else {
                setPeriodFieldId(0);
                setPeriodPreset('');
            }
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
            setShowAverageLine(false);
            setShowDataLabels(false);
            setShowLegend(false);
            setTimeBucket('month');
            setPeriodFieldId(0);
            setPeriodPreset('');
            setFilterTree({ type: 'group', logic: 'and', children: [] });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initial?.id]);

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
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
                        ? { field_id: periodFieldId, preset: periodPreset }
                        : null,
            });
        // La capa de estilo viaja en config.style para TODOS los tipos.
        delete config.style;
        if (hasBlockStyle(style)) config.style = style;
        if (type === 'chart_bar' || type === 'chart_pie' || type === 'funnel') {
            delete config.hide_zero_groups;
            if (hideZeroGroups) config.hide_zero_groups = true;
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
        const widget: WidgetSpec = {
            id: initial?.id ?? generateWidgetId(),
            type,
            list_id: isContent ? 0 : listId,
            title: title.trim(),
            config,
            // 0.57.42 — tamaño inicial según el tipo (KPI compacto,
            // tabla ancha…) y posicionado al FINAL del dashboard.
            layout: initial?.layout ?? defaultLayoutForType(type),
        };
        onSave(widget);
        onOpenChange(false);
    };

    // 0.36.9: con la matriz expandida, cualquier métrica que NO sea
    // count sobre todos los registros requiere un field_id. La única
    // configuración válida sin campo es metric=count + field_id=0
    // (= COUNT(*)).
    const metricNeedsField = metric !== 'count' || metricFieldId > 0
        ? metricFieldId > 0
        : true;

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
        return false;
    }, [type, listId, metricNeedsField, groupByFieldId, dateFieldId]);

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
                                    value={type}
                                    onChange={(e) => setType(e.target.value as WidgetType)}
                                >
                                    <option value="kpi">{__('KPI · Número')}</option>
                                    <option value="stat_delta">{__('KPI · Delta vs período')}</option>
                                    <option value="gauge">{__('Medidor · Progreso vs meta')}</option>
                                    <option value="chart_bar">{__('Gráfico de barras')}</option>
                                    <option value="chart_pie">{__('Gráfico de torta')}</option>
                                    <option value="funnel">{__('Embudo (etapas de pipeline)')}</option>
                                    <option value="chart_line">{__('Línea (tendencia mensual)')}</option>
                                    <option value="chart_area">{__('Area (tendencia mensual)')}</option>
                                    <option value="table">{__('Tabla · Top N')}</option>
                                    <option value="heading">{__('Contenido · Título de sección')}</option>
                                    <option value="text">{__('Contenido · Texto')}</option>
                                    <option value="image">{__('Contenido · Imagen')}</option>
                                    <option value="divider">{__('Contenido · Separador')}</option>
                                    <option value="spacer">{__('Contenido · Espaciador')}</option>
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
                                    }}
                                >
                                    <option value={0}>{__('— Selecciona —')}</option>
                                    {(lists.data ?? []).map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.name}
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
                                    onChange={setGroupByFieldId}
                                    emptyHint={__('La lista no tiene campos agrupables (select, multi_select, text, email, url, date, datetime, checkbox).')}
                                />
                                {isDateField(fields.data ?? [], groupByFieldId) && (
                                    <TimeBucketPicker
                                        value={timeBucket}
                                        onChange={setTimeBucket}
                                    />
                                )}
                            </>
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
                            </>
                        )}

                        {(type === 'chart_bar' || type === 'chart_pie' || type === 'funnel'
                            || type === 'chart_line' || type === 'chart_area') && (
                            <PresentationToggles
                                type={type}
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
                                onFieldChange={setPeriodFieldId}
                                onPresetChange={setPeriodPreset}
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
                                    {__('Restringen los datos del widget. Soportan AND/OR y grupos anidados; para fechas hay rangos rápidos como "este mes".')}
                                </p>
                            </div>
                        )}

                        {/* v0.1.98 — capa de estilo del card (misma del editor
                            de plantillas: fondo/texto/borde/tipografía + presets
                            de marca). Aplica a TODOS los tipos de widget. */}
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                            <BlockStyleEditor value={style} onChange={setStyle} />
                        </div>

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
function metricsForFieldType(type: string): MetricOpt[] {
    switch (type) {
        case 'number':
        case 'currency':
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
                    {__('Si no seleccionas ninguna, mostramos las primeras 4 de la lista.')}
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
    onFieldChange: (id: number) => void;
    onPresetChange: (id: DateRangePresetId | '') => void;
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
    onFieldChange,
    onPresetChange,
}: PeriodPickerProps): JSX.Element {
    const presets = DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom');
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
            <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                {__('Limita el widget a un rango relativo. Se recalcula en cada carga del dashboard — "este mes" será siempre el mes actual.')}
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
    showAverageLine,
    showDataLabels,
    showLegend,
    hideZeroGroups,
    onShowAverageLineChange,
    onShowDataLabelsChange,
    onShowLegendChange,
    onHideZeroGroupsChange,
}: PresentationTogglesProps): JSX.Element {
    // La línea de promedio sólo aplica a charts numéricos con eje
    // ordenado (bar/line/area). En pie no hay un "eje Y" donde
    // pintar una línea, y en el embudo no tiene lectura útil.
    const supportsAverage = type !== 'chart_pie' && type !== 'funnel';
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
            <ToggleRow
                label={__('Etiquetas de datos')}
                checked={showDataLabels}
                onChange={onShowDataLabelsChange}
            />
            <ToggleRow
                label={__('Leyenda')}
                checked={showLegend}
                onChange={onShowLegendChange}
            />
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
    return f?.type === 'date' || f?.type === 'datetime';
}

function FieldPicker({ label, value, fields, onChange, emptyHint }: FieldPickerProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{label}</Label>
            {fields.length === 0 ? (
                <p className="imcrm-text-xs imcrm-text-warning">{emptyHint}</p>
            ) : (
                <Select value={value} onChange={(e) => onChange(Number(e.target.value))}>
                    <option value={0}>{__('— Selecciona —')}</option>
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

    const presentation = (c: WidgetSpec['config']): WidgetSpec['config'] => {
        if (state.showAverageLine) c.show_average_line = true;
        if (state.showDataLabels) c.show_data_labels = true;
        if (state.showLegend) c.show_legend = true;
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
function decodeWidgetFilters(config: WidgetSpec['config']): FilterTree {
    const tree = config.filter_tree;
    if (tree && typeof tree === 'object' && (tree as FilterTree).type === 'group') {
        return tree as FilterTree;
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
