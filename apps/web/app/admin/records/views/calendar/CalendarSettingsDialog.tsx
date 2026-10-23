import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Trash2, X } from 'lucide-react';
import {
    CALENDAR_MAIN_SOURCE,
    CALENDAR_MAX_SOURCES,
    CALENDAR_SOURCE_PALETTE,
    VIEW_ROW_COLORS,
    newCalendarSourceId,
    type CalendarColorBy,
    type CalendarMode,
    type CalendarSettings,
    type CalendarSource,
    type ViewColorRule,
    type ViewRowColor,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { SavedViewEntity } from '@/types/view';

import { ROW_COLOR_HEX, ROW_COLOR_LABEL } from '../../grid/colorRules';
import { ColorRulesEditor } from '../ColorRulesEditor';
import { calendarToViewConfig, viewConfigToCalendar } from '../savedViewMapping';

const DURATIONS: Array<{ value: number; label: string }> = [
    { value: 0, label: __('Todo el día') },
    { value: 15, label: __('15 minutos') },
    { value: 30, label: __('30 minutos') },
    { value: 45, label: __('45 minutos') },
    { value: 60, label: __('1 hora') },
    { value: 90, label: __('1 hora y media') },
    { value: 120, label: __('2 horas') },
    { value: 180, label: __('3 horas') },
    { value: 240, label: __('4 horas') },
    { value: 480, label: __('8 horas') },
];

export const CALENDAR_MODE_LABEL: Record<CalendarMode, string> = {
    month: __('Mes'),
    week: __('Semana'),
    day: __('Día'),
    agenda: __('Agenda'),
};

const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/**
 * «Configurar calendario» — B4. Todo lo del calendario en un solo lugar: las
 * fuentes de fecha (inicio y fin o duración, etiqueta, color, si se ve), cómo
 * se pinta cada evento (por fuente, por un campo de selección, con las reglas
 * de color de la vista), y cómo abre (vista por defecto, primer día de la
 * semana, horario visible y fines de semana). Se guarda en la vista.
 *
 * El `useEffect` de re-init depende sólo de `[open, view.id]` (como el del
 * kanban): `view` cambia de identidad en cada render y resetearía lo que la
 * persona está editando.
 */
export function CalendarSettingsDialog({
    listId,
    view,
    open,
    onOpenChange,
}: {
    listId: number;
    view: SavedViewEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): JSX.Element {
    const update = useUpdateSavedView(listId);
    const fieldsQuery = useFields(listId);
    const fields: FieldEntity[] = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);
    const [name, setName] = useState(view.name);
    const [settings, setSettings] = useState<CalendarSettings>(() => viewConfigToCalendar(view.config).settings);
    const [rules, setRules] = useState<ViewColorRule[]>(() => viewConfigToCalendar(view.config).colorRules);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        const c = viewConfigToCalendar(view.config);
        setName(view.name);
        setSettings(c.settings);
        setRules(c.colorRules);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view.id]);

    const dateFields = useMemo(() => fields.filter((f) => f.type === 'date' || f.type === 'datetime'), [fields]);
    const durationFields = useMemo(() => fields.filter((f) => f.type === 'duration'), [fields]);
    const selectFields = useMemo(() => fields.filter((f) => f.type === 'select'), [fields]);
    const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

    const patch = (p: Partial<CalendarSettings>): void => setSettings((prev) => ({ ...prev, ...p }));
    const patchSource = (id: string, p: Partial<CalendarSource>): void =>
        setSettings((prev) => ({ ...prev, sources: prev.sources.map((s) => (s.id === id ? { ...s, ...p } : s)) }));

    const addSource = (): void => {
        const used = new Set(settings.sources.map((s) => s.startFieldId));
        const next = dateFields.find((f) => !used.has(f.id)) ?? dateFields[0];
        if (!next) return;
        setSettings((prev) => ({
            ...prev,
            sources: [
                ...prev.sources,
                {
                    id: newCalendarSourceId(prev.sources),
                    startFieldId: next.id,
                    endFieldId: null,
                    durationFieldId: null,
                    label: null,
                    color: CALENDAR_SOURCE_PALETTE[prev.sources.length % CALENDAR_SOURCE_PALETTE.length]!,
                    enabled: true,
                },
            ],
        }));
    };

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        const main = settings.sources[0];
        if (!main) {
            setError(__('Elige el campo de fecha del calendario.'));
            return;
        }
        if (settings.dayEndHour <= settings.dayStartHour) {
            setError(__('El horario visible tiene que terminar después de empezar.'));
            return;
        }
        const starts = settings.sources.map((s) => `${s.startFieldId}:${s.endFieldId ?? ''}`);
        if (new Set(starts).size !== starts.length) {
            setError(__('Hay dos fuentes con el mismo campo de fecha.'));
            return;
        }
        try {
            await update.mutateAsync({
                id: view.id,
                name: name.trim() || view.name,
                config: calendarToViewConfig(view.config, settings, rules),
            });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

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
                    data-testid="imcrm-cal-settings-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Configurar calendario')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Qué fechas se muestran, de qué color y cómo abre el calendario.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-6">
                        <Section title={__('General')}>
                            <Row label={__('Nombre')} htmlFor="cal-name">
                                <Input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} />
                            </Row>
                        </Section>

                        <Section title={__('Fechas que se muestran')}>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Cada fuente es un campo de fecha de la lista: «Vencimiento», «Próximo contacto»… Con un fin (o una duración), los eventos ocupan varios días u horas y se pueden estirar.')}
                            </p>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-cal-sources">
                                {settings.sources.map((s, i) => {
                                    const start = byId.get(s.startFieldId);
                                    const ends = dateFields.filter((f) => f.id !== s.startFieldId && f.type === start?.type);
                                    const endValue = s.endFieldId !== null ? `e:${s.endFieldId}` : s.durationFieldId !== null ? `d:${s.durationFieldId}` : '';
                                    return (
                                        <div key={s.id} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-cal-source={s.id}>
                                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                                <ColorSwatches value={s.color} onChange={(color) => patchSource(s.id, { color })} />
                                                <Input
                                                    aria-label={__('Etiqueta')}
                                                    placeholder={start?.label ?? __('Etiqueta')}
                                                    value={s.label ?? ''}
                                                    onChange={(e) => patchSource(s.id, { label: e.target.value.trim() === '' ? null : e.target.value })}
                                                    className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1"
                                                />
                                                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                                                    <input
                                                        type="checkbox"
                                                        checked={s.enabled}
                                                        onChange={(e) => patchSource(s.id, { enabled: e.target.checked })}
                                                        className="imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                                    />
                                                    {__('Visible')}
                                                </label>
                                                {s.id !== CALENDAR_MAIN_SOURCE && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={__('Quitar fuente')}
                                                        onClick={() => setSettings((prev) => ({ ...prev, sources: prev.sources.filter((x) => x.id !== s.id) }))}
                                                    >
                                                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                                                <Row label={i === 0 ? __('Inicio (fuente principal)') : __('Inicio')} htmlFor={`cal-src-start-${s.id}`}>
                                                    <Select
                                                        id={`cal-src-start-${s.id}`}
                                                        value={s.startFieldId}
                                                        onChange={(e) => {
                                                            const id = Number(e.target.value);
                                                            const t = byId.get(id)?.type;
                                                            const end = s.endFieldId !== null ? byId.get(s.endFieldId) : undefined;
                                                            patchSource(s.id, {
                                                                startFieldId: id,
                                                                endFieldId: end && end.type === t && end.id !== id ? s.endFieldId : null,
                                                                durationFieldId: t === 'datetime' ? s.durationFieldId : null,
                                                            });
                                                        }}
                                                    >
                                                        {dateFields.map((f) => (
                                                            <option key={f.id} value={f.id}>
                                                                {f.label}
                                                                {f.type === 'datetime' ? ` · ${__('con hora')}` : ''}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                </Row>
                                                <Row label={__('Fin')} htmlFor={`cal-src-end-${s.id}`}>
                                                    <Select
                                                        id={`cal-src-end-${s.id}`}
                                                        value={endValue}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            patchSource(s.id, {
                                                                endFieldId: v.startsWith('e:') ? Number(v.slice(2)) : null,
                                                                durationFieldId: v.startsWith('d:') ? Number(v.slice(2)) : null,
                                                            });
                                                        }}
                                                    >
                                                        <option value="">{__('Sin fin')}</option>
                                                        {ends.map((f) => (
                                                            <option key={f.id} value={`e:${f.id}`}>
                                                                {f.label}
                                                            </option>
                                                        ))}
                                                        {start?.type === 'datetime' &&
                                                            durationFields.map((f) => (
                                                                <option key={`d${f.id}`} value={`d:${f.id}`}>
                                                                    {sprintf(__('Duración: %s'), f.label)}
                                                                </option>
                                                            ))}
                                                    </Select>
                                                </Row>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {settings.sources.length < CALENDAR_MAX_SOURCES && dateFields.length > 0 && (
                                <Button type="button" variant="outline" size="sm" className="imcrm-self-start" onClick={addSource} data-testid="imcrm-cal-add-source">
                                    <Plus className="imcrm-mr-1 imcrm-h-4 imcrm-w-4" />
                                    {__('Agregar otra fecha')}
                                </Button>
                            )}
                            <Row
                                label={__('Un evento con hora y sin fin dura')}
                                htmlFor="cal-default-duration"
                                hint={__('Si no tiene fin ni duración propia. «Todo el día» lo muestra arriba, en la franja del día.')}
                            >
                                <Select id="cal-default-duration" value={settings.defaultDuration} onChange={(e) => patch({ defaultDuration: Number(e.target.value) })}>
                                    {DURATIONS.map((d) => (
                                        <option key={d.value} value={d.value}>
                                            {d.label}
                                        </option>
                                    ))}
                                    {!DURATIONS.some((d) => d.value === settings.defaultDuration) && (
                                        <option value={settings.defaultDuration}>{sprintf(__('%d minutos'), settings.defaultDuration)}</option>
                                    )}
                                </Select>
                            </Row>
                        </Section>

                        <Section title={__('Colores')}>
                            <Row label={__('Color de los eventos')} htmlFor="cal-color-by">
                                <Select
                                    id="cal-color-by"
                                    value={settings.colorBy}
                                    onChange={(e) => {
                                        const by = e.target.value as CalendarColorBy;
                                        patch({ colorBy: by, colorFieldId: by === 'field' ? settings.colorFieldId ?? selectFields[0]?.id ?? null : settings.colorFieldId });
                                    }}
                                >
                                    <option value="auto">{__('Automático (por fuente o por el primer campo de selección)')}</option>
                                    <option value="source">{__('El color de cada fuente de fecha')}</option>
                                    <option value="field" disabled={selectFields.length === 0}>
                                        {__('El color de la opción de un campo de selección')}
                                    </option>
                                    <option value="none">{__('Un solo color')}</option>
                                </Select>
                            </Row>
                            {settings.colorBy === 'field' && (
                                <Row label={__('Campo de selección')} htmlFor="cal-color-field">
                                    <Select id="cal-color-field" value={settings.colorFieldId ?? ''} onChange={(e) => patch({ colorFieldId: e.target.value === '' ? null : Number(e.target.value) })}>
                                        {selectFields.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                            )}
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label>{__('Reglas de color')}</Label>
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('Las mismas de la tabla: si un registro cumple una regla, su evento toma ese color (gana la de arriba).')}
                                </p>
                                <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
                                    <ColorRulesEditor listId={listId} fields={fields} rules={rules} onChange={setRules} eventsOnly />
                                </div>
                            </div>
                        </Section>

                        <Section title={__('Cómo se ve')}>
                            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <Row label={__('Abre en')} htmlFor="cal-default-mode">
                                    <Select id="cal-default-mode" value={settings.defaultMode} onChange={(e) => patch({ defaultMode: e.target.value as CalendarMode })}>
                                        {(Object.keys(CALENDAR_MODE_LABEL) as CalendarMode[]).map((m) => (
                                            <option key={m} value={m}>
                                                {CALENDAR_MODE_LABEL[m]}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                                <Row label={__('La semana empieza el')} htmlFor="cal-week-start">
                                    <Select id="cal-week-start" value={settings.weekStart} onChange={(e) => patch({ weekStart: Number(e.target.value) as 0 | 1 | 6 })}>
                                        <option value={1}>{__('Lunes')}</option>
                                        <option value={0}>{__('Domingo')}</option>
                                        <option value={6}>{__('Sábado')}</option>
                                    </Select>
                                </Row>
                                <Row label={__('Horario visible (semana y día)')} htmlFor="cal-day-start">
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        <Select id="cal-day-start" value={settings.dayStartHour} onChange={(e) => patch({ dayStartHour: Number(e.target.value) })}>
                                            {Array.from({ length: 24 }, (_, h) => (
                                                <option key={h} value={h}>
                                                    {hourLabel(h)}
                                                </option>
                                            ))}
                                        </Select>
                                        <span className="imcrm-text-sm imcrm-text-muted-foreground">{__('a')}</span>
                                        <Select aria-label={__('Hasta')} value={settings.dayEndHour} onChange={(e) => patch({ dayEndHour: Number(e.target.value) })}>
                                            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                                                <option key={h} value={h}>
                                                    {hourLabel(h)}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                </Row>
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-self-end imcrm-pb-2 imcrm-text-sm">
                                    <input
                                        type="checkbox"
                                        checked={settings.showWeekends}
                                        onChange={(e) => patch({ showWeekends: e.target.checked })}
                                        className="imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                        data-testid="imcrm-cal-weekends"
                                    />
                                    {__('Mostrar sábados y domingos')}
                                </label>
                            </div>
                        </Section>

                        {error !== null && (
                            <div role="alert" className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" disabled={update.isPending} data-testid="imcrm-cal-settings-save">
                                {update.isPending ? __('Guardando…') : __('Guardar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function ColorSwatches({ value, onChange }: { value: ViewRowColor; onChange: (c: ViewRowColor) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1" role="radiogroup" aria-label={__('Color')}>
            {VIEW_ROW_COLORS.map((c) => (
                <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === value}
                    aria-label={ROW_COLOR_LABEL[c]}
                    title={ROW_COLOR_LABEL[c]}
                    onClick={() => onChange(c)}
                    className={cn('imcrm-h-5 imcrm-w-5 imcrm-rounded-full imcrm-ring-offset-1 imcrm-ring-offset-card', c === value && 'imcrm-ring-2 imcrm-ring-foreground')}
                    style={{ backgroundColor: ROW_COLOR_HEX[c] }}
                />
            ))}
        </div>
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
