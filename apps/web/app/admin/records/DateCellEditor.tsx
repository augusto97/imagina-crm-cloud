import { useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useFields } from '@/hooks/useFields';
import {
    useDeleteRecurrence,
    useRecurrencesForRecord,
    useUpsertRecurrence,
} from '@/hooks/useRecurrences';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type {
    Recurrence,
    RecurrenceFrequency,
    RecurrenceMonthlyPattern,
    RecurrenceTriggerType,
} from '@/types/recurrence';

interface DateCellEditorProps {
    listId: number;
    recordId: number;
    field: FieldEntity;
    /** Valor actual (`YYYY-MM-DD` o `YYYY-MM-DD HH:MM:SS` / con T). */
    value: string | null;
    onCommit: (next: string | null) => void;
    children: React.ReactNode;
}

/**
 * Editor de fecha estilo ClickUp: calendario visual + atajos rápidos
 * a la izquierda + sección colapsable de "Recurrente" debajo.
 *
 * El popover entero se abre al click en `children` (el wrapper que
 * muestra el valor actual en la celda). El padre (EditableCell)
 * confirma vía `onCommit` y la recurrencia se persiste por su
 * cuenta (vía hooks de useRecurrences).
 */
export function DateCellEditor({
    listId,
    recordId,
    field,
    value,
    onCommit,
    children,
}: DateCellEditorProps): JSX.Element {
    const [open, setOpen] = useState(false);

    const isDateTime = field.type === 'datetime';
    const parsed = useMemo(() => parseDateValue(value), [value]);
    const [pickedDate, setPickedDate] = useState<Date | undefined>(parsed.date);
    const [pickedTime, setPickedTime] = useState<string>(parsed.time);

    // Sync state when value prop changes (e.g. otro lugar editó la celda).
    useMemo(() => {
        setPickedDate(parsed.date);
        setPickedTime(parsed.time);
    }, [parsed.date?.getTime(), parsed.time]);

    // CRÍTICO — debe ser `useRecurrencesForRecord` (no `useRecurrences`):
    // este componente se renderea en CADA celda de fecha de CADA record
    // visible en TableView/GroupedTableView. `useRecurrencesForRecord`
    // lee del context del `RecurrencesBatchProvider` que ya hace UNA
    // sola query batch para todos los records visibles. Sin esto se
    // disparaban N fetches individuales (uno por record), saturando
    // PHP-FPM y bloqueando el thread principal del frontend con
    // re-renders en cascada. Síntoma: "Cargando vista..." infinito al
    // cambiar de vista, porque el thread no llegaba a procesar el
    // re-render hasta que el componente se desmontaba. Fix en 0.57.10.
    const recurrences = useRecurrencesForRecord(listId, recordId);
    // En la nube el módulo de recurrencias todavía no está cableado
    // (POST/DELETE darían 404) — se oculta TODA la UI de recurrencia.
    // Los hooks se llaman igual (rules of hooks); solo se gatea el JSX.
    const recurrencesEnabled = moduleEnabled('recurrences');
    const existingRecurrence = recurrencesEnabled
        ? (recurrences.data ?? []).find((r) => r.date_field_id === field.id)
        : undefined;
    const [recurrenceOpen, setRecurrenceOpen] = useState(existingRecurrence !== undefined);

    const handleSelect = (next: Date | undefined): void => {
        setPickedDate(next);
        if (next === undefined) {
            onCommit(null);
            setOpen(false);
            return;
        }
        const formatted = formatDateValue(next, isDateTime ? pickedTime : null);
        onCommit(formatted);
        if (!isDateTime) {
            // Para `date` cerramos al elegir; para `datetime` el usuario
            // probablemente quiere ajustar la hora también.
            setOpen(false);
        }
    };

    const applyShortcut = (offset: ShortcutOffset): void => {
        const next = computeShortcut(offset);
        setPickedDate(next);
        onCommit(formatDateValue(next, isDateTime ? pickedTime : null));
        if (!isDateTime) setOpen(false);
    };

    const setTime = (t: string): void => {
        setPickedTime(t);
        if (pickedDate) {
            onCommit(formatDateValue(pickedDate, t));
        }
    };

    const clear = (): void => {
        setPickedDate(undefined);
        onCommit(null);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="imcrm-w-[445px] imcrm-p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="imcrm-flex">
                    <ShortcutsColumn
                        onPick={applyShortcut}
                        onClear={clear}
                        hasValue={pickedDate !== undefined}
                    />
                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-2 imcrm-border-l imcrm-border-border imcrm-p-3">
                        <DayPicker
                            mode="single"
                            selected={pickedDate}
                            onSelect={handleSelect}
                            modifiers={{
                                recurrence: existingRecurrence
                                    ? computeUpcomingOccurrences(
                                        pickedDate,
                                        existingRecurrence,
                                        // Cantidad proporcional a la frecuencia para
                                        // cubrir un horizonte de 10 años (las marcas
                                        // siguen apareciendo aunque el user navegue
                                        // hacia adelante varios años).
                                        previewCountFor(existingRecurrence),
                                    )
                                    : [],
                            }}
                            modifiersClassNames={{
                                recurrence: 'imcrm-rdp-recurrence',
                            }}
                            className="imcrm-rdp-imagina"
                        />

                        {isDateTime && (
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Hora')}
                                </Label>
                                <Input
                                    type="time"
                                    value={pickedTime}
                                    onChange={(e) => setTime(e.target.value)}
                                    className="imcrm-h-8 imcrm-w-32"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Recurrente: sección colapsable bajo el calendario.
                    Por defecto cerrada (a menos que ya haya una
                    recurrencia configurada — entonces abierta). */}
                {recurrencesEnabled && (
                <div className="imcrm-border-t imcrm-border-border">
                    <button
                        type="button"
                        onClick={() => setRecurrenceOpen((o) => !o)}
                        className={cn(
                            'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-2.5 imcrm-text-sm',
                            'hover:imcrm-bg-accent/40',
                            existingRecurrence !== undefined && 'imcrm-text-success',
                        )}
                    >
                        {recurrenceOpen ? (
                            <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />
                        ) : (
                            <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        <span className="imcrm-font-medium">
                            {existingRecurrence !== undefined
                                ? recurrenceSummary(existingRecurrence)
                                : __('Hacer recurrente')}
                        </span>
                    </button>
                    {recurrenceOpen && (
                        <RecurrencePanel
                            listId={listId}
                            recordId={recordId}
                            field={field}
                            existing={existingRecurrence ?? null}
                            seedDate={pickedDate}
                            onClose={() => setRecurrenceOpen(false)}
                        />
                    )}
                </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Atajos rápidos (columna izquierda del picker)
// ─────────────────────────────────────────────────────────────────────

type ShortcutOffset =
    | 'today'
    | 'tomorrow'
    | 'this_weekend'
    | 'next_week'
    | 'next_weekend'
    | 'two_weeks'
    | 'four_weeks';

interface ShortcutDef {
    id: ShortcutOffset;
    label: string;
    /** Sub-label gris a la derecha (ej. "mar." / "10:52 pm"). */
    hint: () => string;
}

const SHORTCUTS: ShortcutDef[] = [
    { id: 'today', label: __('Hoy'), hint: () => weekdayShort(new Date()) },
    { id: 'tomorrow', label: __('Mañana'), hint: () => weekdayShort(addDays(new Date(), 1)) },
    { id: 'this_weekend', label: __('Este fin de semana'), hint: () => weekdayShort(nextWeekday(0)) },
    { id: 'next_week', label: __('Próxima semana'), hint: () => weekdayShort(nextMonday()) },
    { id: 'next_weekend', label: __('Próximo fin de semana'), hint: () => dayShort(nextWeekday(6, 7)) },
    { id: 'two_weeks', label: __('2 semanas'), hint: () => dayShort(addDays(new Date(), 14)) },
    { id: 'four_weeks', label: __('4 semanas'), hint: () => dayShort(addDays(new Date(), 28)) },
];

function ShortcutsColumn({
    onPick,
    onClear,
    hasValue,
}: {
    onPick: (id: ShortcutOffset) => void;
    onClear: () => void;
    hasValue: boolean;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-w-40 imcrm-shrink-0 imcrm-flex-col imcrm-gap-0.5 imcrm-p-2">
            {SHORTCUTS.map((s) => (
                <button
                    key={s.id}
                    type="button"
                    onClick={() => onPick(s.id)}
                    className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent"
                >
                    <span className="imcrm-truncate">{s.label}</span>
                    <span className="imcrm-shrink-0 imcrm-text-[10px] imcrm-text-muted-foreground">
                        {s.hint()}
                    </span>
                </button>
            ))}
            {hasValue && (
                <button
                    type="button"
                    onClick={onClear}
                    className="imcrm-mt-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-xs imcrm-text-destructive hover:imcrm-bg-destructive/10"
                >
                    {__('Limpiar fecha')}
                </button>
            )}
        </div>
    );
}

function computeShortcut(id: ShortcutOffset): Date {
    const now = new Date();
    switch (id) {
        case 'today':
            return now;
        case 'tomorrow':
            return addDays(now, 1);
        case 'this_weekend':
            return nextWeekday(6); // próximo sábado (incluye hoy si es sábado)
        case 'next_week':
            return nextMonday();
        case 'next_weekend':
            return nextWeekday(6, 7); // sábado de la semana QUE VIENE
        case 'two_weeks':
            return addDays(now, 14);
        case 'four_weeks':
            return addDays(now, 28);
    }
}

function addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

/**
 * Devuelve el siguiente día de la semana especificado (0=dom..6=sáb)
 * a partir de hoy + `minOffset` días. minOffset=7 fuerza "la próxima
 * semana" (no esta).
 */
function nextWeekday(target: number, minOffset = 0): Date {
    const now = new Date();
    const start = addDays(now, minOffset);
    const cur = start.getDay();
    const diff = (target - cur + 7) % 7;
    return addDays(start, diff === 0 && minOffset === 0 ? 0 : (diff === 0 ? 7 : diff));
}

function nextMonday(): Date {
    return nextWeekday(1, 0); // lunes desde hoy
}

function weekdayShort(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function dayShort(d: Date): string {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ─────────────────────────────────────────────────────────────────────
// Recurrencia inline (panel)
// ─────────────────────────────────────────────────────────────────────

interface RecurrencePanelProps {
    listId: number;
    recordId: number;
    field: FieldEntity;
    existing: Recurrence | null;
    /** Fecha base para calcular "Repetir N veces" → end_date. */
    seedDate: Date | undefined;
    /** Llamado tras guardar/eliminar para que el caller pueda colapsar. */
    onClose?: () => void;
}

function RecurrencePanel({
    listId,
    recordId,
    field,
    existing,
    seedDate,
    onClose,
}: RecurrencePanelProps): JSX.Element {
    const fields = useFields(listId);
    const confirm = useConfirm();
    const upsert = useUpsertRecurrence(listId, recordId);
    const remove = useDeleteRecurrence(listId, recordId);

    const [frequency, setFrequency] = useState<RecurrenceFrequency>(
        existing?.frequency ?? 'monthly',
    );
    const [interval, setIntervalN] = useState<number>(existing?.interval_n ?? 1);
    const [monthlyPattern, setMonthlyPattern] = useState<RecurrenceMonthlyPattern>(
        existing?.monthly_pattern ?? 'same_day',
    );
    const [triggerType, setTriggerType] = useState<RecurrenceTriggerType>(
        existing?.trigger_type ?? 'schedule',
    );
    const [triggerStatusFieldId, setTriggerStatusFieldId] = useState<number>(
        existing?.trigger_status_field_id ?? 0,
    );
    const [triggerStatusValue, setTriggerStatusValue] = useState<string>(
        existing?.trigger_status_value ?? '',
    );
    // Acción "clone" / "update" como checkbox: marcar = clonar; desmarcar
    // = actualizar (default). Sigue el modelo ClickUp donde "Crear nueva
    // tarea" es opt-in.
    const [createNewTask, setCreateNewTask] = useState<boolean>(
        existing?.action_type === 'clone',
    );
    const [updateStatusEnabled, setUpdateStatusEnabled] = useState<boolean>(
        existing?.update_status_field_id != null,
    );
    const [updateStatusFieldId, setUpdateStatusFieldId] = useState<number>(
        existing?.update_status_field_id ?? 0,
    );
    const [updateStatusValue, setUpdateStatusValue] = useState<string>(
        existing?.update_status_value ?? '',
    );
    // "Repetir indefinidamente" (default true). Cuando se desmarca,
    // mostramos input de "Repetir N veces".
    const [indefinite, setIndefinite] = useState<boolean>(
        existing?.repeat_until == null,
    );
    const [repeatCount, setRepeatCount] = useState<number>(1);
    const [error, setError] = useState<string | null>(null);

    const statusFields = (fields.data ?? []).filter(
        (f) => f.type === 'select' || f.type === 'checkbox',
    );

    /**
     * Convierte "Repetir N veces" → fecha final calculada desde la
     * fecha base + N × frecuencia. Brittle pero matchea ClickUp UX.
     */
    const computeRepeatUntil = (): string | null => {
        if (indefinite) return null;
        if (!seedDate) return null;
        const out = new Date(seedDate);
        const n = Math.max(1, repeatCount);
        switch (frequency) {
            case 'daily':
            case 'days_after':
                out.setDate(out.getDate() + n * interval);
                break;
            case 'weekly':
                out.setDate(out.getDate() + n * interval * 7);
                break;
            case 'monthly':
                out.setMonth(out.getMonth() + n * interval);
                break;
            case 'yearly':
                out.setFullYear(out.getFullYear() + n * interval);
                break;
        }
        const y = out.getFullYear();
        const m = String(out.getMonth() + 1).padStart(2, '0');
        const d = String(out.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const handleSave = async (): Promise<void> => {
        setError(null);
        try {
            await upsert.mutateAsync({
                date_field_id: field.id,
                frequency,
                // Interval solo aplica al modo `days_after`. Para
                // diaria/semanal/mensual/anual lo forzamos a 1 — coincide
                // con la UX simple ("Mensual" = cada mes).
                interval_n: frequency === 'days_after' ? interval : 1,
                monthly_pattern: frequency === 'monthly' ? monthlyPattern : null,
                trigger_type: triggerType,
                trigger_status_field_id:
                    triggerType === 'status_change' ? triggerStatusFieldId : null,
                trigger_status_value:
                    triggerType === 'status_change' ? triggerStatusValue : null,
                action_type: createNewTask ? 'clone' : 'update',
                update_status_field_id: updateStatusEnabled ? updateStatusFieldId : null,
                update_status_value: updateStatusEnabled ? updateStatusValue : null,
                repeat_until: computeRepeatUntil(),
            });
            onClose?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : __('Error'));
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (existing === null) return;
        const ok = await confirm({
            title: __('Quitar recurrencia'),
            description: __('La celda dejará de repetirse automáticamente.'),
            destructive: true,
            confirmLabel: __('Quitar'),
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(existing.id);
            onClose?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : __('Error'));
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-bg-canvas imcrm-p-3">
            {/* Frecuencia. El input de "interval" solo aparece para
                `days_after` (donde N es obligatorio). Para diaria/
                semanal/mensual/anual asumimos N=1 — coincide con la
                UX simple de ClickUp ("Mensual" significa "cada mes"
                sin pedir un número). */}
            <Select
                value={frequency}
                onChange={(e) => {
                    const next = e.target.value as RecurrenceFrequency;
                    setFrequency(next);
                    // `days_after` solo tiene sentido con trigger
                    // `status_change` ("tras la finalización"). Al
                    // elegirlo forzamos el trigger; al salir, lo
                    // dejamos como estaba.
                    if (next === 'days_after') {
                        setTriggerType('status_change');
                    }
                }}
                aria-label={__('Frecuencia')}
                className="imcrm-h-8"
            >
                <option value="daily">{__('Diariamente')}</option>
                <option value="weekly">{__('Semanal')}</option>
                <option value="monthly">{__('Mensual')}</option>
                <option value="yearly">{__('Anual')}</option>
                <option value="days_after">{__('Días después de…')}</option>
            </Select>

            {frequency === 'days_after' && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Input
                        type="number"
                        min={1}
                        value={interval}
                        onChange={(e) => setIntervalN(Math.max(1, Number(e.target.value) || 1))}
                        aria-label={__('Días tras la finalización')}
                        className="imcrm-h-8 imcrm-w-20"
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {interval === 1
                            ? __('día tras la finalización')
                            : __('días tras la finalización')}
                    </span>
                </div>
            )}

            {frequency === 'monthly' && (
                <Select
                    value={monthlyPattern}
                    onChange={(e) =>
                        setMonthlyPattern(e.target.value as RecurrenceMonthlyPattern)
                    }
                    aria-label={__('Patrón mensual')}
                    className="imcrm-h-8"
                >
                    <option value="same_day">{__('El mismo día de cada mes')}</option>
                    <option value="weekday">{__('El mismo día de la semana')}</option>
                    <option value="first_day">{__('Primer día del mes')}</option>
                    <option value="last_day">{__('Último día del mes')}</option>
                </Select>
            )}

            <Select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as RecurrenceTriggerType)}
                aria-label={__('Cuándo rueda')}
                className="imcrm-h-8"
            >
                <option value="schedule">{__('Según un cronograma')}</option>
                <option value="status_change">{__('Cuando cambia el estado')}</option>
            </Select>

            {triggerType === 'status_change' && (
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <Select
                        value={triggerStatusFieldId}
                        onChange={(e) => setTriggerStatusFieldId(Number(e.target.value))}
                        className="imcrm-h-8"
                    >
                        <option value={0}>{__('— Campo de estado —')}</option>
                        {statusFields.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                    {triggerStatusFieldId > 0 && (
                        <Select
                            value={triggerStatusValue}
                            onChange={(e) => setTriggerStatusValue(e.target.value)}
                            className="imcrm-h-8"
                        >
                            <option value="">{__('— Valor target —')}</option>
                            {statusOptions(fields.data, triggerStatusFieldId).map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </Select>
                    )}
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={createNewTask}
                        onChange={(e) => setCreateNewTask(e.target.checked)}
                    />
                    {__('Crear nueva tarea')}
                </label>

                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={indefinite}
                        onChange={(e) => setIndefinite(e.target.checked)}
                    />
                    {__('Repetir indefinidamente')}
                </label>

                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        checked={updateStatusEnabled}
                        onChange={(e) => setUpdateStatusEnabled(e.target.checked)}
                    />
                    {__('Actualizar estado a:')}
                </label>
                {updateStatusEnabled && (
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 imcrm-pl-6">
                        <Select
                            value={updateStatusFieldId}
                            onChange={(e) => setUpdateStatusFieldId(Number(e.target.value))}
                            className="imcrm-h-8"
                        >
                            <option value={0}>{__('— Campo —')}</option>
                            {statusFields.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                        {updateStatusFieldId > 0 && (
                            <Select
                                value={updateStatusValue}
                                onChange={(e) => setUpdateStatusValue(e.target.value)}
                                className="imcrm-h-8"
                            >
                                <option value="">{__('— Valor —')}</option>
                                {statusOptions(fields.data, updateStatusFieldId).map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </div>
                )}
            </div>

            {!indefinite && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <Label className="imcrm-text-xs">{__('Repetir')}</Label>
                    <Input
                        type="number"
                        min={1}
                        value={repeatCount}
                        onChange={(e) =>
                            setRepeatCount(Math.max(1, Number(e.target.value) || 1))
                        }
                        className="imcrm-h-8 imcrm-w-20"
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('veces')}
                    </span>
                </div>
            )}

            {error !== null && (
                <p className="imcrm-rounded imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-destructive">
                    {error}
                </p>
            )}

            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                {existing !== null ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDelete()}
                        className="imcrm-text-destructive hover:imcrm-bg-destructive/10"
                    >
                        {__('No repetir')}
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onClose?.()}
                        className="imcrm-text-muted-foreground"
                    >
                        {__('Cancelar')}
                    </Button>
                )}
                <Button
                    size="sm"
                    onClick={() => void handleSave()}
                    disabled={upsert.isPending}
                >
                    {upsert.isPending ? __('Guardando…') : __('Guardar')}
                </Button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface ParsedDateValue {
    date: Date | undefined;
    /** "HH:mm" para datetime, "" para date. */
    time: string;
}

function parseDateValue(value: string | null): ParsedDateValue {
    if (value === null || value === '') return { date: undefined, time: '' };
    // Acepta "YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DDTHH:mm".
    const norm = value.replace('T', ' ');
    const [datePart, timePart] = norm.split(' ');
    if (!datePart) return { date: undefined, time: '' };
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return { date: undefined, time: '' };
    const date = new Date(y, m - 1, d);
    const time = timePart ? timePart.slice(0, 5) : '';
    return { date, time };
}

function formatDateValue(date: Date, time: string | null): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    if (time === null || time === '') return `${y}-${m}-${d}`;
    return `${y}-${m}-${d}T${time}`;
}

function statusOptions(
    allFields: FieldEntity[] | undefined,
    fieldId: number,
): Array<{ value: string; label: string }> {
    if (!allFields || fieldId <= 0) return [];
    const f = allFields.find((x) => x.id === fieldId);
    if (!f) return [];
    if (f.type === 'checkbox') {
        return [
            { value: '1', label: __('Marcado') },
            { value: '0', label: __('No marcado') },
        ];
    }
    const options = (f.config as { options?: Array<{ value: string; label?: string }> })
        .options;
    if (!Array.isArray(options)) return [];
    return options.map((o) => ({
        value: String(o.value),
        label: o.label ?? String(o.value),
    }));
}

/**
 * Resumen de la recurrencia — texto de una línea para mostrar en el
 * toggle "Hacer recurrente".
 */
function recurrenceSummary(rec: Recurrence): string {
    const freq = freqLabel(rec.frequency, rec.interval_n);
    if (rec.trigger_type === 'status_change') {
        return `${freq} · ${__('al cambiar estado')}`;
    }
    return `${freq} · ${__('según fecha')}`;
}

function freqLabel(freq: RecurrenceFrequency, interval: number): string {
    if (interval === 1) {
        switch (freq) {
            case 'daily': return __('Cada día');
            case 'weekly': return __('Cada semana');
            case 'monthly': return __('Cada mes');
            case 'yearly': return __('Cada año');
            case 'days_after': return __('Cada día');
        }
    }
    switch (freq) {
        case 'daily':
        case 'days_after':
            return `${__('Cada')} ${interval} ${__('días')}`;
        case 'weekly':
            return `${__('Cada')} ${interval} ${__('semanas')}`;
        case 'monthly':
            return `${__('Cada')} ${interval} ${__('meses')}`;
        case 'yearly':
            return `${__('Cada')} ${interval} ${__('años')}`;
    }
}

/**
 * Cuántas ocurrencias precomputar como preview en el calendario,
 * proporcional a la frecuencia. Cubre ~10 años hacia adelante, así
 * el user puede navegar varios años sin perder las marcas:
 *  - daily   → 365·10 = 3650
 *  - weekly  → 52·10  = 520
 *  - monthly → 12·10  = 120
 *  - yearly  → 10
 *
 * El cálculo es local y barato (un loop de aritmética de fechas);
 * 3650 puntos por celda no impactan el render.
 */
function previewCountFor(rec: Recurrence): number {
    const horizonYears = 10;
    switch (rec.frequency) {
        case 'daily':   return 365 * horizonYears;
        case 'weekly':  return 52 * horizonYears;
        case 'monthly': return 12 * horizonYears;
        case 'yearly':  return horizonYears;
        default:        return 60; // days_after / fallback
    }
}

/**
 * Aproximación rápida de las próximas N ocurrencias para resaltar en
 * el calendario. Es una preview visual — el cálculo "real" lo hace el
 * `DateRoller` del backend al disparar. Aquí replicamos los casos
 * básicos (daily/weekly/monthly same_day) — si no calza con el patrón
 * elegido, devolvemos array vacío (mejor no resaltar nada que mentir).
 */
function computeUpcomingOccurrences(
    seed: Date | undefined,
    rec: Recurrence,
    count: number,
): Date[] {
    if (!seed) return [];
    const out: Date[] = [];
    let cur = new Date(seed);
    for (let i = 0; i < count; i++) {
        const next = advance(cur, rec);
        if (next === null) return out;
        out.push(next);
        cur = next;
    }
    return out;
}

function advance(d: Date, rec: Recurrence): Date | null {
    const next = new Date(d);
    switch (rec.frequency) {
        case 'daily':
            next.setDate(next.getDate() + rec.interval_n);
            return next;
        case 'days_after':
            // No previewable: el seed real depende de cuándo dispara
            // el trigger ("now() + N días"), no de la fecha actual.
            return null;
        case 'weekly':
            next.setDate(next.getDate() + rec.interval_n * 7);
            return next;
        case 'monthly':
            if (rec.monthly_pattern && rec.monthly_pattern !== 'same_day') return null;
            next.setMonth(next.getMonth() + rec.interval_n);
            return next;
        case 'yearly':
            next.setFullYear(next.getFullYear() + rec.interval_n);
            return next;
    }
}
