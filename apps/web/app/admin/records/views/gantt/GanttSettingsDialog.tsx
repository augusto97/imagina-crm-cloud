import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import {
    GANTT_COLOR_TYPES,
    GANTT_DATE_TYPES,
    GANTT_GROUP_TYPES,
    GANTT_MAX_COLUMNS,
    RESCHEDULE_MAX_RECORDS,
    type GanttColorBy,
    type GanttSettings,
    type GanttZoom,
    type ViewColorRule,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useDependencySettings, useUpdateDependencySettings } from '@/hooks/useDependencies';
import { useFields } from '@/hooks/useFields';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { SavedViewConfig, SavedViewEntity } from '@/types/view';

import { ColorRulesEditor } from '../ColorRulesEditor';
import { ganttToViewConfig, viewConfigToGantt } from '../savedViewMapping';

interface GanttSettingsDialogProps {
    listId: number;
    view: SavedViewEntity;
    /** Los campos de la lista (si no vienen, se piden). */
    fields?: FieldEntity[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** La reprogramación en cadena es de la LISTA: sólo quien la administra la ve. */
    canManageList?: boolean;
}

export const GANTT_ZOOM_LABEL: Record<GanttZoom, string> = {
    day: __('Día'),
    week: __('Semana'),
    month: __('Mes'),
    quarter: __('Trimestre'),
};

type SortChoice = { fieldId: number; dir: 'asc' | 'desc' } | null;

/** Tipos que no tienen sentido como columna del panel (no se leen en una línea). */
const NO_COLUMN_TYPES = new Set(['long_text', 'relation', 'file', 'ai']);

/**
 * «Configurar Gantt» (B1): todo lo de la vista en un lugar —qué fechas dibujan
 * la barra, cómo se agrupan y colorean, qué columnas lleva el panel, el zoom
 * con el que abre y qué se dibuja (subtareas, flechas, línea base)— más la
 * regla de la LISTA de reprogramar en cadena (sólo para quien la administra).
 *
 * El `useEffect` de re-init depende sólo de `[open, view.id]`: si dependiera
 * de `view` reiniciaría lo que la persona está editando en cada refetch.
 */
export function GanttSettingsDialog({ listId, view, fields: fieldsProp, open, onOpenChange, canManageList: canManageListProp }: GanttSettingsDialogProps): JSX.Element {
    const fieldsQuery = useFields(fieldsProp ? undefined : listId);
    const fields = useMemo(() => fieldsProp ?? fieldsQuery.data ?? [], [fieldsProp, fieldsQuery.data]);
    const canManageListCap = useCan(CAP.MANAGE_LISTS);
    const canManageList = canManageListProp ?? canManageListCap;
    const update = useUpdateSavedView(listId);
    const depSettings = useDependencySettings(canManageList && open ? listId : undefined);
    const updateDeps = useUpdateDependencySettings(listId);

    const [name, setName] = useState(view.name);
    const [settings, setSettings] = useState<GanttSettings>(() => viewConfigToGantt(view.config));
    const [rules, setRules] = useState<ViewColorRule[]>(view.config.color_rules ?? []);
    const [sort, setSort] = useState<SortChoice>(null);
    const [reschedule, setReschedule] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(view.name);
        setSettings(viewConfigToGantt(view.config));
        setRules(view.config.color_rules ?? []);
        const first = view.config.sort?.[0];
        setSort(first ? { fieldId: first.field_id, dir: first.dir } : null);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view.id]);

    useEffect(() => {
        if (depSettings.data) setReschedule(depSettings.data.reschedule);
    }, [depSettings.data]);

    useEffect(() => {
        if (!open) {
            update.reset();
            updateDeps.reset();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const patch = (p: Partial<GanttSettings>): void => setSettings((prev) => ({ ...prev, ...p }));

    const dateFields = fields.filter((f) => (GANTT_DATE_TYPES as readonly string[]).includes(f.type));
    const groupFields = fields.filter((f) => (GANTT_GROUP_TYPES as readonly string[]).includes(f.type));
    const colorFields = fields.filter((f) => (GANTT_COLOR_TYPES as readonly string[]).includes(f.type));
    const columnCandidates = useMemo(
        () => fields.filter((f) => !f.is_primary && !NO_COLUMN_TYPES.has(f.type)),
        [fields],
    );
    const sortCandidates = fields.filter((f) => !['relation', 'file', 'long_text', 'ai'].includes(f.type));
    const fieldLabel = (id: number): string => fields.find((f) => f.id === id)?.label ?? `#${id}`;
    const columnIds = settings.columns.map((c) => c.field_id);

    const toggleColumn = (id: number): void => {
        if (columnIds.includes(id)) {
            patch({ columns: settings.columns.filter((c) => c.field_id !== id) });
        } else if (settings.columns.length < GANTT_MAX_COLUMNS) {
            patch({ columns: [...settings.columns, { field_id: id }] });
        }
    };
    const moveColumn = (id: number, dir: -1 | 1): void => {
        const idx = columnIds.indexOf(id);
        const target = idx + dir;
        if (idx < 0 || target < 0 || target >= settings.columns.length) return;
        const next = [...settings.columns];
        [next[idx], next[target]] = [next[target]!, next[idx]!];
        patch({ columns: next });
    };

    const startField = fields.find((f) => f.id === settings.startFieldId);
    const endField = fields.find((f) => f.id === settings.endFieldId);
    const depData = depSettings.data;
    // Sin campos propios en la regla, la lista toma los del Gantt al encenderla.
    const ruleStart = depData?.start_field_id ?? settings.startFieldId;
    const ruleEnd = depData?.end_field_id ?? settings.endFieldId;

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        if (settings.startFieldId === null) {
            setError(__('Elige la fecha de inicio de las barras.'));
            return;
        }
        // Color por campo sin campo elegido = sin color (no se guarda a medias).
        const final: GanttSettings =
            settings.colorBy === 'field' && settings.colorFieldId === null ? { ...settings, colorBy: 'none' } : settings;
        try {
            const config: SavedViewConfig = {
                ...ganttToViewConfig(view.config, final),
                color_rules: rules,
                sort: sort ? [{ field_id: sort.fieldId, dir: sort.dir }] : [],
            };
            await update.mutateAsync({ id: view.id, name: name.trim() || view.name, config });
            if (canManageList && depData && reschedule !== depData.reschedule) {
                await updateDeps.mutateAsync(
                    reschedule
                        ? { reschedule: true, start_field_id: ruleStart, end_field_id: ruleEnd ?? ruleStart }
                        : { reschedule: false },
                );
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const colorChoice = (value: GanttColorBy, label: string, hint: string): JSX.Element => (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
            <input
                type="radio"
                name="gantt-color-by"
                checked={settings.colorBy === value}
                onChange={() => patch({ colorBy: value })}
                className="imcrm-mt-0.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                data-testid={`gantt-color-by-${value}`}
            />
            <span className="imcrm-flex imcrm-flex-col">
                <span className="imcrm-font-medium">{label}</span>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>
            </span>
        </label>
    );

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6',
                        'imcrm-max-h-[88vh] imcrm-overflow-y-auto',
                    )}
                    data-testid="imcrm-gantt-settings-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Configurar Gantt')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Las fechas de las barras, cómo se agrupan y colorean, las columnas y qué se dibuja.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-6">
                        <Section title={__('Barras')}>
                            <Row label={__('Nombre')} htmlFor="gantt-name">
                                <Input id="gantt-name" value={name} onChange={(e) => setName(e.target.value)} />
                            </Row>
                            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <Row label={__('Fecha de inicio')} htmlFor="gantt-start">
                                    <Select
                                        id="gantt-start"
                                        value={settings.startFieldId ?? 0}
                                        onChange={(e) => {
                                            const id = Number(e.target.value) || null;
                                            patch({ startFieldId: id, endFieldId: settings.endFieldId === id ? null : settings.endFieldId });
                                        }}
                                    >
                                        <option value={0} disabled>
                                            {__('Elige un campo de fecha')}
                                        </option>
                                        {dateFields.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                                <Row
                                    label={__('Fecha de fin')}
                                    htmlFor="gantt-end"
                                    hint={__('Sin fecha de fin, cada registro se dibuja como un hito (rombo).')}
                                >
                                    <Select
                                        id="gantt-end"
                                        value={settings.endFieldId ?? 0}
                                        onChange={(e) => patch({ endFieldId: Number(e.target.value) || null })}
                                    >
                                        <option value={0}>{__('Sin fecha de fin')}</option>
                                        {dateFields
                                            .filter((f) => f.id !== settings.startFieldId)
                                            .map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                    </Select>
                                </Row>
                            </div>
                            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <Row label={__('Agrupar por')} htmlFor="gantt-group">
                                    <Select
                                        id="gantt-group"
                                        value={settings.groupByFieldId ?? 0}
                                        onChange={(e) => patch({ groupByFieldId: Number(e.target.value) || null })}
                                    >
                                        <option value={0}>{__('Sin agrupar')}</option>
                                        {groupFields.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                                <Row label={__('Zoom al abrir')} htmlFor="gantt-zoom">
                                    <Select id="gantt-zoom" value={settings.zoom} onChange={(e) => patch({ zoom: e.target.value as GanttZoom })}>
                                        {(Object.keys(GANTT_ZOOM_LABEL) as GanttZoom[]).map((z) => (
                                            <option key={z} value={z}>
                                                {GANTT_ZOOM_LABEL[z]}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                            </div>
                            <Row label={__('Orden de las filas')} htmlFor="gantt-sort">
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Select
                                        id="gantt-sort"
                                        value={sort?.fieldId ?? 0}
                                        onChange={(e) => {
                                            const id = Number(e.target.value);
                                            setSort(id > 0 ? { fieldId: id, dir: sort?.dir ?? 'asc' } : null);
                                        }}
                                    >
                                        <option value={0}>{__('Por la fecha de inicio')}</option>
                                        {sortCandidates.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                    {sort && (
                                        <Select
                                            aria-label={__('Dirección')}
                                            value={sort.dir}
                                            onChange={(e) => setSort({ ...sort, dir: e.target.value as 'asc' | 'desc' })}
                                            className="imcrm-w-40"
                                        >
                                            <option value="asc">{__('Ascendente')}</option>
                                            <option value="desc">{__('Descendente')}</option>
                                        </Select>
                                    )}
                                </div>
                            </Row>
                        </Section>

                        <Section title={__('Color de las barras')}>
                            {colorChoice('field', __('Por un campo de selección'), __('Cada barra toma el color de su opción (por ejemplo, el estado).'))}
                            {settings.colorBy === 'field' && (
                                <div className="imcrm-pl-6">
                                    <Select
                                        aria-label={__('Campo del color')}
                                        value={settings.colorFieldId ?? 0}
                                        onChange={(e) => patch({ colorFieldId: Number(e.target.value) || null })}
                                        data-testid="gantt-color-field"
                                    >
                                        <option value={0}>{colorFields.length === 0 ? __('La lista no tiene campos de selección') : __('Elige un campo')}</option>
                                        {colorFields.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            )}
                            {colorChoice('rules', __('Por reglas de color'), __('Las mismas reglas condicionales de la tabla: gana la primera que se cumple.'))}
                            {settings.colorBy === 'rules' && (
                                <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
                                    <ColorRulesEditor listId={listId} fields={fields} rules={rules} onChange={setRules} />
                                </div>
                            )}
                            {colorChoice('none', __('Sin color'), __('Todas las barras del color principal.'))}
                        </Section>

                        <Section title={__('Panel de la izquierda')}>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(
                                    /* translators: %d: max columns */
                                    __('Además del título, hasta %d columnas. Los anchos se ajustan arrastrando el borde de cada encabezado.'),
                                    GANTT_MAX_COLUMNS,
                                )}
                            </p>
                            {settings.columns.length > 0 && (
                                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="gantt-columns-order">
                                    {settings.columns.map((c, i) => (
                                        <li key={c.field_id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-sm">
                                            <span className="imcrm-flex-1 imcrm-truncate">{fieldLabel(c.field_id)}</span>
                                            <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={i === 0} onClick={() => moveColumn(c.field_id, -1)} aria-label={__('Subir')}>
                                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="imcrm-h-7 imcrm-w-7"
                                                disabled={i === settings.columns.length - 1}
                                                onClick={() => moveColumn(c.field_id, 1)}
                                                aria-label={__('Bajar')}
                                            >
                                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </Button>
                                        </li>
                                    ))}
                                </ol>
                            )}
                            <div className="imcrm-grid imcrm-max-h-48 imcrm-grid-cols-1 imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2 sm:imcrm-grid-cols-2">
                                {columnCandidates.map((f) => {
                                    const checked = columnIds.includes(f.id);
                                    const disabled = !checked && settings.columns.length >= GANTT_MAX_COLUMNS;
                                    return (
                                        <label
                                            key={f.id}
                                            className={cn(
                                                'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-sm',
                                                disabled ? 'imcrm-opacity-50' : 'imcrm-cursor-pointer hover:imcrm-bg-accent/50',
                                            )}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={disabled}
                                                onChange={() => toggleColumn(f.id)}
                                                className="imcrm-h-3.5 imcrm-w-3.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                                data-testid={`gantt-column-${f.slug}`}
                                            />
                                            <span className="imcrm-truncate">{f.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </Section>

                        <Section title={__('Qué se dibuja')}>
                            <Check checked={settings.showSubtasks} onChange={(v) => patch({ showSubtasks: v })} label={__('Subtareas debajo de su registro')} />
                            <Check checked={settings.showDependencies} onChange={(v) => patch({ showDependencies: v })} label={__('Flechas de las dependencias')} />
                            <Check checked={settings.showBaseline} onChange={(v) => patch({ showBaseline: v })} label={__('Línea base (las fechas guardadas, debajo de cada barra)')} />
                        </Section>

                        {canManageList && (
                            <Section title={__('Reprogramar en cadena (regla de la lista)')}>
                                <Check
                                    checked={reschedule}
                                    disabled={!depData}
                                    onChange={setReschedule}
                                    label={__('Al correr el fin de un registro, correr lo mismo a los que dependen de él')}
                                    testId="gantt-reschedule"
                                />
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {sprintf(
                                        /* translators: 1: start field, 2: end field, 3: max records */
                                        __('Vale para toda la lista (cualquier vista, la ficha, las automatizaciones) y usa «%1$s» y «%2$s». Cada registro corrido queda en su actividad; hasta %3$d por cambio.'),
                                        ruleStart ? fieldLabel(ruleStart) : startField?.label ?? '—',
                                        ruleEnd ? fieldLabel(ruleEnd) : endField?.label ?? startField?.label ?? '—',
                                        RESCHEDULE_MAX_RECORDS,
                                    )}
                                </p>
                            </Section>
                        )}

                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={update.isPending || updateDeps.isPending || settings.startFieldId === null} data-testid="gantt-settings-save">
                                {update.isPending || updateDeps.isPending ? __('Guardando…') : __('Guardar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <legend className="imcrm-mb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">{title}</legend>
            {children}
        </fieldset>
    );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {hint && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

function Check({
    checked,
    onChange,
    label,
    disabled,
    testId,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    disabled?: boolean;
    testId?: string;
}): JSX.Element {
    return (
        <label className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm', disabled ? 'imcrm-opacity-60' : 'imcrm-cursor-pointer')}>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="imcrm-h-3.5 imcrm-w-3.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                data-testid={testId}
            />
            {label}
        </label>
    );
}
