import { useMemo } from 'react';
import { BarChart3, ChartArea, ChartLine, ChartPie, CircleGauge, Filter, Gauge, Table2, TrendingUp } from 'lucide-react';
import { FIELD_DISPLAYS, RELATED_VIEWS, type LayoutBlock, type LayoutDataSource } from '@imagina-base/shared';

import { KPI_ICON_OPTIONS } from '@/admin/dashboards/widgets/KpiWidget';
import { FilterGroupView } from '@/admin/records/FilterGroupView';
import { GalleryBlockForm, ImageBlockForm, SpacerBlockForm } from '@/admin/template-editor-core/ImageBlockForm';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';

import { useSourceListId } from '../LayoutBlocks';
import { useLayoutCtx } from '../LayoutContext';
import { useEditor } from './editorState';
import { FieldChecklist, FieldSelect, Group, NumberInput, Row, Segmented, TextInput, Toggle } from './inspectorUi';

/**
 * v0.1.231 — Formularios del inspector por tipo de bloque. Cada uno recibe
 * la config y un `set(patch)` que la mezcla y la guarda en el historial.
 */
export interface FormProps {
    block: LayoutBlock;
    set: (patch: Record<string, unknown>) => void;
}

const NUMERIC = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'rollup', 'computed']);
const isNumeric = (f: FieldEntity): boolean => NUMERIC.has(f.type);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

// ── Datos del registro ───────────────────────────────────────────────────

export function FieldForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    const field = ctx.fieldsById.get(Number(c.field_id));
    const displays = field ? FIELD_DISPLAYS[field.type] ?? [] : [];
    const display = str(c.display, displays[0]?.key ?? '');
    const goalable = field && isNumeric(field) && ['bar', 'gauge', 'ring'].includes(display);
    return (
        <>
            <Group title={__('Datos')}>
                <Row label={__('Campo')}>
                    <FieldSelect fields={ctx.fields} value={field?.id} onChange={(id) => set({ field_id: id, display: undefined })} ariaLabel={__('Campo')} />
                </Row>
            </Group>
            {field && (
                <Group title={__('Visualización')}>
                    <Row label={__('Forma de mostrarlo')} hint={__('Las formas cambian según el tipo del campo.')}>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                            {displays.map((d) => (
                                <button
                                    key={d.key}
                                    type="button"
                                    onClick={() => set({ display: d.key })}
                                    className={cn(
                                        'imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-[11px]',
                                        display === d.key ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-semibold' : 'imcrm-border-border hover:imcrm-bg-accent',
                                    )}
                                    aria-pressed={display === d.key}
                                >
                                    {__(d.label)}
                                </button>
                            ))}
                        </div>
                    </Row>
                    {goalable && (
                        <Row label={__('Meta')} hint={__('El 100 % de la barra o el medidor. Vacío: 100 para porcentajes.')}>
                            <NumberInput value={num(c.goal)} onChange={(v) => set({ goal: v })} min={0} ariaLabel={__('Meta')} />
                        </Row>
                    )}
                    {isNumeric(field) && (
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                            <Row label={__('Prefijo')}>
                                <TextInput value={str(c.prefix)} onChange={(v) => set({ prefix: v || undefined })} placeholder="$" />
                            </Row>
                            <Row label={__('Sufijo')}>
                                <TextInput value={str(c.suffix)} onChange={(v) => set({ suffix: v || undefined })} placeholder="%" />
                            </Row>
                        </div>
                    )}
                    <Toggle label={__('Como tarjeta con título')} checked={c.card === true} onChange={(v) => set({ card: v })} />
                    {c.card !== true && <Toggle label={__('Ocultar la etiqueta')} checked={c.label === 'hidden'} onChange={(v) => set({ label: v ? 'hidden' : undefined })} />}
                </Group>
            )}
        </>
    );
}

export function FieldsForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    const layout = str(c.layout, 'list');
    return (
        <>
            <Group title={__('Datos')}>
                <Row label={__('Campos')} hint={__('Se editan en la ficha y se guardan solos.')}>
                    <FieldChecklist fields={ctx.fields} value={ids(c.field_ids)} onChange={(v) => set({ field_ids: v })} max={40} />
                </Row>
            </Group>
            <Group title={__('Visualización')}>
                <Row label={__('Disposición')}>
                    <Segmented
                        value={layout === 'grid' ? 'grid' : 'list'}
                        onChange={(v) => set({ layout: v })}
                        options={[
                            { value: 'list', label: __('Lista') },
                            { value: 'grid', label: __('Grilla') },
                        ]}
                        ariaLabel={__('Disposición')}
                    />
                </Row>
                {layout === 'grid' && (
                    <Row label={__('Columnas')}>
                        <Segmented
                            value={String(num(c.columns) ?? 2)}
                            onChange={(v) => set({ columns: Number(v) })}
                            options={['1', '2', '3'].map((v) => ({ value: v, label: v }))}
                            ariaLabel={__('Columnas')}
                        />
                    </Row>
                )}
                <Toggle label={__('Plegable')} checked={c.collapsible !== false} onChange={(v) => set({ collapsible: v })} hint={__('Con título, se puede plegar desde la ficha.')} />
                {c.collapsible !== false && <Toggle label={__('Empieza plegado')} checked={c.collapsed === true} onChange={(v) => set({ collapsed: v })} />}
            </Group>
        </>
    );
}

export function FilesForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    return (
        <Group title={__('Datos')}>
            <Row label={__('Campos de archivo')} hint={__('Vacío: todos los campos de archivo de la lista.')}>
                <FieldChecklist fields={ctx.fields} value={ids(block.config.field_ids)} onChange={(v) => set({ field_ids: v })} allow={(f) => f.type === 'file'} />
            </Row>
        </Group>
    );
}

export function StagesForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    return (
        <Group title={__('Datos')}>
            <Row label={__('Campo de estado')} hint={__('Un campo de selección: cada opción es una etapa, en el orden del campo.')}>
                <FieldSelect fields={ctx.fields} value={num(block.config.field_id)} onChange={(id) => set({ field_id: id })} allow={(f) => f.type === 'select'} />
            </Row>
        </Group>
    );
}

// ── Fuente de datos ──────────────────────────────────────────────────────

function encodeSource(s: LayoutDataSource | undefined): string {
    if (!s) return '';
    if (s.kind === 'related') return `rel:${s.field_id}:${s.direction ?? ''}`;
    if (s.kind === 'list') return `list:${s.list_id}`;
    return 'record';
}

function SourcePicker({ value, onChange, allowList }: { value: LayoutDataSource | undefined; onChange: (s: LayoutDataSource) => void; allowList: boolean }): JSX.Element {
    const ed = useEditor();
    const ctx = useLayoutCtx();
    const paths = ed.catalog.paths;
    return (
        <Select
            value={encodeSource(value)}
            onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith('rel:')) {
                    const [, id, dir] = v.split(':');
                    onChange({ kind: 'related', field_id: Number(id), ...(dir ? { direction: dir as 'forward' | 'reverse' } : {}) });
                } else if (v.startsWith('list:')) onChange({ kind: 'list', list_id: Number(v.slice(5)) });
            }}
            className="imcrm-h-8 imcrm-text-sm"
            aria-label={__('Fuente de datos')}
        >
            {value === undefined && <option value="">{__('— Elegí de dónde salen los datos —')}</option>}
            {paths.length > 0 && (
                <optgroup label={__('Registros vinculados a éste')}>
                    {paths.map((p) => (
                        <option key={`${p.relation_field_id}:${p.direction}`} value={`rel:${p.relation_field_id}:${p.direction}`}>
                            {p.other_list_name} · {p.relation_label}
                        </option>
                    ))}
                </optgroup>
            )}
            {allowList && (
                <optgroup label={__('Comparar con el total')}>
                    <option value={`list:${ctx.list.id}`}>{`${__('Toda la lista')} «${ctx.list.name}»`}</option>
                </optgroup>
            )}
        </Select>
    );
}

/** Campos de la lista de la que lee una fuente. */
function useSourceFields(source: LayoutDataSource | undefined): { listId: number; fields: FieldEntity[] } {
    const ctx = useLayoutCtx();
    const listId = useSourceListId(source);
    const own = listId === ctx.list.id;
    const q = useFields(!own && listId > 0 ? listId : undefined);
    return { listId, fields: own ? ctx.fields : q.data ?? [] };
}

function FilterEditor({ value, onChange, fields, listId }: { value: unknown; onChange: (t: FilterTree | undefined) => void; fields: FieldEntity[]; listId: number }): JSX.Element {
    const tree = value && typeof value === 'object' && (value as FilterTree).type === 'group' ? (value as FilterTree) : null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <Toggle
                label={__('Sólo algunos registros')}
                checked={tree !== null}
                onChange={(v) => onChange(v ? { type: 'group', logic: 'and', children: [] } : undefined)}
                hint={__('Por ejemplo, sólo las facturas pendientes.')}
            />
            {tree && listId > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                    <FilterGroupView root={tree} path={[]} fields={fields} listId={listId} onRootChange={(next) => onChange(next)} />
                </div>
            )}
        </div>
    );
}

// ── Gráficos ─────────────────────────────────────────────────────────────

const KINDS: Array<{ value: string; label: string; icon: typeof BarChart3 }> = [
    { value: 'kpi', label: __('Cifra'), icon: Gauge },
    { value: 'stat_delta', label: __('Variación'), icon: TrendingUp },
    { value: 'bar', label: __('Barras'), icon: BarChart3 },
    { value: 'pie', label: __('Dona'), icon: ChartPie },
    { value: 'line', label: __('Líneas'), icon: ChartLine },
    { value: 'area', label: __('Área'), icon: ChartArea },
    { value: 'funnel', label: __('Embudo'), icon: Filter },
    { value: 'gauge', label: __('Medidor'), icon: CircleGauge },
    { value: 'table', label: __('Tabla'), icon: Table2 },
];

const METRICS = [
    { value: 'count', label: __('Cantidad de registros') },
    { value: 'sum', label: __('Suma') },
    { value: 'avg', label: __('Promedio') },
    { value: 'min', label: __('Mínimo') },
    { value: 'max', label: __('Máximo') },
    { value: 'count_unique', label: __('Valores únicos') },
];

const BUCKETS = [
    { value: 'day', label: __('Día') },
    { value: 'week', label: __('Semana') },
    { value: 'month', label: __('Mes') },
    { value: 'quarter', label: __('Trimestre') },
    { value: 'year', label: __('Año') },
];

const GROUPABLE = new Set(['select', 'multi_select', 'user', 'checkbox', 'text', 'email', 'phone', 'url', 'date', 'datetime', 'number', 'rating', 'lookup', 'rollup']);
const isDate = (f: FieldEntity): boolean => f.type === 'date' || f.type === 'datetime';

export function ChartForm({ block, set }: FormProps): JSX.Element {
    const c = block.config;
    const source = c.source as LayoutDataSource | undefined;
    const kind = str(c.kind, 'kpi');
    const metric = str(c.metric, 'count');
    const { listId, fields } = useSourceFields(source);
    const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const groupField = byId.get(Number(c.group_by_field_id));
    const needsGroup = ['bar', 'pie', 'funnel'].includes(kind);
    const needsDate = ['line', 'area', 'stat_delta'].includes(kind);
    const numericMetric = metric === 'sum' || metric === 'avg';
    return (
        <>
            <Group title={__('Datos')}>
                <Row label={__('De dónde salen')}>
                    <SourcePicker value={source} onChange={(s) => set({ source: s, metric_field_id: undefined, group_by_field_id: undefined, date_field_id: undefined, visible_field_ids: undefined, sort_field_id: undefined, filter_tree: undefined })} allowList />
                </Row>
                {kind !== 'table' && (
                    <>
                        <Row label={__('Qué se calcula')}>
                            <Select value={metric} onChange={(e) => set({ metric: e.target.value, ...(e.target.value === 'count' ? { metric_field_id: undefined } : {}) })} className="imcrm-h-8 imcrm-text-sm" aria-label={__('Métrica')}>
                                {METRICS.map((m) => (
                                    <option key={m.value} value={m.value}>
                                        {m.label}
                                    </option>
                                ))}
                            </Select>
                        </Row>
                        {metric !== 'count' && (
                            <Row label={__('De qué campo')}>
                                <FieldSelect fields={fields} value={num(c.metric_field_id)} onChange={(id) => set({ metric_field_id: id })} allow={numericMetric ? isNumeric : undefined} ariaLabel={__('Campo de la métrica')} />
                            </Row>
                        )}
                    </>
                )}
                {needsGroup && (
                    <Row label={__('Agrupar por')}>
                        <FieldSelect fields={fields} value={groupField?.id} onChange={(id) => set({ group_by_field_id: id })} allow={(f) => GROUPABLE.has(f.type)} ariaLabel={__('Agrupar por')} />
                    </Row>
                )}
                {needsGroup && groupField && isDate(groupField) && (
                    <Row label={__('Por')}>
                        <Select value={str(c.time_bucket, 'month')} onChange={(e) => set({ time_bucket: e.target.value })} className="imcrm-h-8 imcrm-text-sm" aria-label={__('Período')}>
                            {BUCKETS.map((b) => (
                                <option key={b.value} value={b.value}>
                                    {b.label}
                                </option>
                            ))}
                        </Select>
                    </Row>
                )}
                {needsDate && (
                    <Row label={__('Campo de fecha')}>
                        <FieldSelect fields={fields} value={num(c.date_field_id)} onChange={(id) => set({ date_field_id: id })} allow={isDate} emptyLabel={__('Fecha de creación')} ariaLabel={__('Campo de fecha')} />
                    </Row>
                )}
                {(kind === 'line' || kind === 'area') && (
                    <Row label={__('Agrupar las fechas por')}>
                        <Select value={str(c.time_bucket, 'month')} onChange={(e) => set({ time_bucket: e.target.value })} className="imcrm-h-8 imcrm-text-sm" aria-label={__('Período')}>
                            {BUCKETS.map((b) => (
                                <option key={b.value} value={b.value}>
                                    {b.label}
                                </option>
                            ))}
                        </Select>
                    </Row>
                )}
                {kind === 'stat_delta' && (
                    <Row label={__('Comparar los últimos (días)')} hint={__('Contra el mismo período anterior.')}>
                        <NumberInput value={num(c.period_days) ?? 30} onChange={(v) => set({ period_days: v })} min={1} max={365} />
                    </Row>
                )}
                {kind === 'table' && (
                    <>
                        <Row label={__('Columnas')}>
                            <FieldChecklist fields={fields} value={ids(c.visible_field_ids)} onChange={(v) => set({ visible_field_ids: v })} max={12} />
                        </Row>
                        <SortRow fields={fields} c={c} set={set} max={50} />
                    </>
                )}
                <FilterEditor value={c.filter_tree} onChange={(t) => set({ filter_tree: t })} fields={fields} listId={listId} />
            </Group>
            <Group title={__('Visualización')}>
                <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1.5" role="radiogroup" aria-label={__('Tipo de gráfico')}>
                    {KINDS.map((k) => (
                        <button
                            key={k.value}
                            type="button"
                            role="radio"
                            aria-checked={kind === k.value}
                            onClick={() => set({ kind: k.value, ...(k.value === 'line' || k.value === 'area' ? { time_bucket: str(c.time_bucket, 'month') } : {}) })}
                            className={cn(
                                'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-p-2 imcrm-text-[11px]',
                                kind === k.value ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-semibold' : 'imcrm-border-border hover:imcrm-bg-accent',
                            )}
                        >
                            <k.icon className="imcrm-h-4 imcrm-w-4" />
                            {k.label}
                        </button>
                    ))}
                </div>
                {(kind === 'kpi' || kind === 'gauge') && (
                    <>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                            <Row label={__('Meta')}>
                                <NumberInput value={num(c.goal)} onChange={(v) => set({ goal: v })} min={0} />
                            </Row>
                            <Row label={__('Icono')}>
                                <Select value={str(c.icon)} onChange={(e) => set({ icon: e.target.value || undefined })} className="imcrm-h-8 imcrm-text-sm">
                                    <option value="">{__('Ninguno')}</option>
                                    {KPI_ICON_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                            <Row label={__('Prefijo')}>
                                <TextInput value={str(c.prefix)} onChange={(v) => set({ prefix: v || undefined })} placeholder="$" />
                            </Row>
                            <Row label={__('Sufijo')}>
                                <TextInput value={str(c.suffix)} onChange={(v) => set({ suffix: v || undefined })} placeholder="%" />
                            </Row>
                        </div>
                    </>
                )}
                {kind === 'pie' && (
                    <Row label={__('Texto del centro')}>
                        <TextInput value={str(c.center_label)} onChange={(v) => set({ center_label: v || undefined })} placeholder={__('Total')} />
                    </Row>
                )}
                {needsGroup && <Toggle label={__('Ocultar grupos en cero')} checked={c.hide_zero_groups === true} onChange={(v) => set({ hide_zero_groups: v || undefined })} />}
                {(kind === 'bar' || kind === 'line' || kind === 'area') && (
                    <>
                        <Toggle label={__('Mostrar los valores')} checked={c.show_data_labels === true} onChange={(v) => set({ show_data_labels: v || undefined })} />
                        <Toggle label={__('Línea del promedio')} checked={c.show_average_line === true} onChange={(v) => set({ show_average_line: v || undefined })} />
                    </>
                )}
            </Group>
        </>
    );
}

function SortRow({ fields, c, set, max }: { fields: FieldEntity[]; c: Record<string, unknown>; set: FormProps['set']; max: number }): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
            <Row label={__('Ordenar por')}>
                <FieldSelect fields={fields} value={num(c.sort_field_id)} onChange={(id) => set({ sort_field_id: id })} emptyLabel={__('Más recientes')} />
            </Row>
            <Row label={__('Mostrar')}>
                <NumberInput value={num(c.limit)} onChange={(v) => set({ limit: v })} min={1} max={max} placeholder="10" />
            </Row>
            {num(c.sort_field_id) !== undefined && (
                <div className="imcrm-col-span-2">
                    <Segmented
                        value={c.sort_dir === 'asc' ? 'asc' : 'desc'}
                        onChange={(v) => set({ sort_dir: v })}
                        options={[
                            { value: 'desc', label: __('Mayor a menor') },
                            { value: 'asc', label: __('Menor a mayor') },
                        ]}
                        ariaLabel={__('Dirección')}
                    />
                </div>
            )}
        </div>
    );
}

// ── Vinculados ───────────────────────────────────────────────────────────

const VIEW_LABEL: Record<string, string> = {
    table: __('Tabla'),
    list: __('Lista'),
    cards: __('Tarjetas'),
    board: __('Tablero'),
    timeline: __('Línea de tiempo'),
    gallery: __('Galería'),
};

export function RelatedForm({ block, set }: FormProps): JSX.Element {
    const ed = useEditor();
    const c = block.config;
    const source = c.source as LayoutDataSource | undefined;
    const view = str(c.view, 'table');
    const { listId, fields } = useSourceFields(source);
    return (
        <>
            <Group title={__('Datos')}>
                {ed.catalog.paths.length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Esta lista no tiene relaciones con otras. Agregá un campo «Relación» para mostrar sus registros vinculados.')}</p>
                ) : (
                    <Row label={__('Registros de')}>
                        <SourcePicker value={source} onChange={(s) => set({ source: s, field_ids: undefined, sort_field_id: undefined, group_field_id: undefined, date_field_id: undefined, image_field_id: undefined, filter_tree: undefined })} allowList={false} />
                    </Row>
                )}
                <Row label={__('Columnas')} hint={__('Vacío: las primeras de la lista.')}>
                    <FieldChecklist fields={fields} value={ids(c.field_ids)} onChange={(v) => set({ field_ids: v })} max={12} />
                </Row>
                <SortRow fields={fields} c={c} set={set} max={100} />
                <FilterEditor value={c.filter_tree} onChange={(t) => set({ filter_tree: t })} fields={fields} listId={listId} />
            </Group>
            <Group title={__('Visualización')}>
                <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1.5" role="radiogroup" aria-label={__('Vista')}>
                    {RELATED_VIEWS.map((v) => (
                        <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={view === v}
                            onClick={() => set({ view: v })}
                            className={cn(
                                'imcrm-rounded-lg imcrm-border imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px]',
                                view === v ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-semibold' : 'imcrm-border-border hover:imcrm-bg-accent',
                            )}
                        >
                            {VIEW_LABEL[v]}
                        </button>
                    ))}
                </div>
                {view === 'board' && (
                    <Row label={__('Columnas del tablero por')}>
                        <FieldSelect fields={fields} value={num(c.group_field_id)} onChange={(id) => set({ group_field_id: id })} allow={(f) => f.type === 'select'} emptyLabel={__('El primer campo de selección')} />
                    </Row>
                )}
                {view === 'timeline' && (
                    <Row label={__('Fecha')}>
                        <FieldSelect fields={fields} value={num(c.date_field_id)} onChange={(id) => set({ date_field_id: id })} allow={isDate} emptyLabel={__('El primer campo de fecha')} />
                    </Row>
                )}
                {view === 'gallery' && (
                    <Row label={__('Imagen')}>
                        <FieldSelect fields={fields} value={num(c.image_field_id)} onChange={(id) => set({ image_field_id: id })} allow={(f) => f.type === 'url' || f.type === 'file'} emptyLabel={__('El primer campo de imagen')} />
                    </Row>
                )}
            </Group>
        </>
    );
}

// ── Contenido ────────────────────────────────────────────────────────────

export function HeadingForm({ block, set }: FormProps): JSX.Element {
    const c = block.config;
    return (
        <Group title={__('Contenido')}>
            <Row label={__('Texto')}>
                <TextInput value={str(c.text)} onChange={(v) => set({ text: v })} />
            </Row>
            <Row label={__('Subtítulo')}>
                <TextInput value={str(c.subtitle)} onChange={(v) => set({ subtitle: v || undefined })} />
            </Row>
            <Row label={__('Tamaño')}>
                <Segmented
                    value={String(num(c.level) ?? 2)}
                    onChange={(v) => set({ level: Number(v) })}
                    options={[
                        { value: '1', label: __('Grande') },
                        { value: '2', label: __('Mediano') },
                        { value: '3', label: __('Chico') },
                    ]}
                    ariaLabel={__('Tamaño')}
                />
            </Row>
        </Group>
    );
}

export function TextForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    const fromField = c.source === 'field';
    return (
        <Group title={__('Contenido')}>
            <Segmented
                value={fromField ? 'field' : 'literal'}
                onChange={(v) => set({ source: v })}
                options={[
                    { value: 'literal', label: __('Texto fijo') },
                    { value: 'field', label: __('De un campo') },
                ]}
                ariaLabel={__('Origen del texto')}
            />
            {fromField ? (
                <Row label={__('Campo')}>
                    <FieldSelect fields={ctx.fields} value={num(c.field_id)} onChange={(id) => set({ field_id: id })} allow={(f) => f.type === 'text' || f.type === 'long_text'} />
                </Row>
            ) : (
                <Row label={__('Texto')} hint={__('Admite **negrita**, *cursiva*, listas y enlaces.')}>
                    <TextInput value={str(c.content)} onChange={(v) => set({ content: v })} multiline />
                </Row>
            )}
        </Group>
    );
}

export function NoticeForm({ block, set }: FormProps): JSX.Element {
    const c = block.config;
    return (
        <Group title={__('Contenido')}>
            <Row label={__('Tono')}>
                <Segmented
                    value={str(c.tone, 'info')}
                    onChange={(v) => set({ tone: v })}
                    options={[
                        { value: 'info', label: __('Info') },
                        { value: 'success', label: __('Éxito') },
                        { value: 'warning', label: __('Atención') },
                        { value: 'tip', label: __('Consejo') },
                    ]}
                    ariaLabel={__('Tono')}
                />
            </Row>
            <Row label={__('Texto')}>
                <TextInput value={str(c.text)} onChange={(v) => set({ text: v })} multiline />
            </Row>
        </Group>
    );
}

export function ButtonForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    const action = str(c.action, 'url');
    const fromField = c.target_source === 'field';
    const allow = (f: FieldEntity): boolean => (action === 'mailto' ? f.type === 'email' : action === 'tel' ? f.type === 'phone' : ['url', 'text', 'email', 'phone'].includes(f.type));
    return (
        <Group title={__('Contenido')}>
            <Row label={__('Texto del botón')}>
                <TextInput value={str(c.label)} onChange={(v) => set({ label: v })} />
            </Row>
            <Row label={__('Al hacer clic')}>
                <Select value={action} onChange={(e) => set({ action: e.target.value })} className="imcrm-h-8 imcrm-text-sm">
                    <option value="url">{__('Abrir un enlace')}</option>
                    <option value="mailto">{__('Escribir un correo')}</option>
                    <option value="tel">{__('Llamar')}</option>
                    <option value="copy">{__('Copiar al portapapeles')}</option>
                </Select>
            </Row>
            <Segmented
                value={fromField ? 'field' : 'literal'}
                onChange={(v) => set({ target_source: v })}
                options={[
                    { value: 'literal', label: __('Valor fijo') },
                    { value: 'field', label: __('De un campo') },
                ]}
                ariaLabel={__('Origen del destino')}
            />
            {fromField ? (
                <Row label={__('Campo')}>
                    <FieldSelect fields={ctx.fields} value={num(c.target_field_id)} onChange={(id) => set({ target_field_id: id })} allow={allow} />
                </Row>
            ) : (
                <Row label={__('Destino')}>
                    <TextInput value={str(c.target)} onChange={(v) => set({ target: v })} placeholder={action === 'url' ? 'https://' : ''} />
                </Row>
            )}
            <Row label={__('Estilo')}>
                <Segmented
                    value={c.variant === 'outline' ? 'outline' : 'default'}
                    onChange={(v) => set({ variant: v })}
                    options={[
                        { value: 'default', label: __('Relleno') },
                        { value: 'outline', label: __('Con borde') },
                    ]}
                    ariaLabel={__('Estilo')}
                />
            </Row>
        </Group>
    );
}

export function EmbedForm({ block, set }: FormProps): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    const fromField = c.source === 'field';
    return (
        <Group title={__('Contenido')}>
            <Segmented
                value={fromField ? 'field' : 'literal'}
                onChange={(v) => set({ source: v })}
                options={[
                    { value: 'literal', label: __('Enlace fijo') },
                    { value: 'field', label: __('De un campo') },
                ]}
                ariaLabel={__('Origen del enlace')}
            />
            {fromField ? (
                <Row label={__('Campo')}>
                    <FieldSelect fields={ctx.fields} value={num(c.field_id)} onChange={(id) => set({ field_id: id })} allow={(f) => f.type === 'url'} />
                </Row>
            ) : (
                <Row label={__('Enlace')} hint={__('YouTube, Vimeo, Loom, Figma o Google Drive.')}>
                    <TextInput value={str(c.url)} onChange={(v) => set({ url: v })} placeholder="https://" />
                </Row>
            )}
        </Group>
    );
}

export function DividerForm({ block, set }: FormProps): JSX.Element {
    return (
        <Group title={__('Contenido')}>
            <Row label={__('Etiqueta (opcional)')}>
                <TextInput value={str(block.config.label)} onChange={(v) => set({ label: v || undefined })} />
            </Row>
        </Group>
    );
}

export function ImageForm({ block, set }: FormProps): JSX.Element {
    const config = { ...block.config, image_file_id: block.config.image_file_id ?? block.config.file_id };
    return (
        <Group title={__('Contenido')}>
            <ImageBlockForm config={config} onConfigChange={(next) => set({ ...next, file_id: undefined })} />
        </Group>
    );
}

export function GalleryForm({ block, set }: FormProps): JSX.Element {
    return (
        <Group title={__('Contenido')}>
            <GalleryBlockForm config={block.config} onConfigChange={(next) => set(next)} />
        </Group>
    );
}

export function SpacerForm({ block, set }: FormProps): JSX.Element {
    return (
        <Group title={__('Contenido')}>
            <SpacerBlockForm config={block.config} onConfigChange={(next) => set({ height: Math.min(240, Number(next.height)) })} />
        </Group>
    );
}

export function InfoForm({ text }: { text: string }): JSX.Element {
    return (
        <Group title={__('Datos')}>
            <p className="imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">{text}</p>
        </Group>
    );
}

