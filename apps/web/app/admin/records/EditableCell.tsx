import { createContext, forwardRef, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DurationFormat } from '@imagina-base/shared';

import { DurationControl } from '@/components/fields/DurationControl';
import { PhoneControl } from '@/components/fields/PhoneControl';
import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';

import { Input } from '@/components/ui/input';
import { RelationPicker } from '@/components/fields/RelationPicker';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { useRecurrencesForRecord } from '@/hooks/useRecurrences';
import { useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { parseUtcDate } from '@/lib/utcDate';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { DateCellEditor } from './DateCellEditor';
import { renderCellValue } from './renderCellValue';
import { useRelationTitlesFor } from './relationTitlesContext';
import { useWrapText } from './wrapText';

interface EditableCellProps {
    field: FieldEntity;
    recordId: number;
    listId: number;
    value: unknown;
    /**
     * Si `false`, la celda se renderiza read-only (sin doble-click edit,
     * sin disabled controls). Default `true` para back-compat.
     *
     * Lo usa el TableView con `useCan(EDIT_RECORDS) || useCan(EDIT_OWN_RECORDS)`
     * — un viewer sin caps de edit no podrá activar el modo edición
     * aunque el field type sea editable. Previene 403 backend en click.
     */
    canEdit?: boolean;
    /**
     * v0.1.213 — En una lista de tienda, por qué esta celda no se puede
     * editar (lo calcula quien arma la fila con `storeAccessFor`). null = libre.
     */
    lockedReason?: string | null;
}

/**
 * Celda con edición inline.
 *
 * - UN click activa modo edición (input apropiado al tipo).
 * - Enter o blur confirma → mutación optimistic.
 * - Escape cancela.
 * - Si el server rechaza, mostramos un tooltip de error sobre la celda
 *   y revertimos al valor previo (la mutación lo hace en `onError`).
 *
 * Tipos editables inline en MVP: text, long_text, number, currency,
 * email, url, date, datetime, checkbox, select, multi_select.
 * Tipos NO editables inline: user, file, relation (requieren pickers
 * más complejos — se editan por el RecordDetailDrawer en una iteración
 * posterior).
 */
// `computed` se muestra read-only — su valor lo deriva el backend
// desde otros campos del record, el usuario no lo edita directo.
const NON_INLINE_TYPES = ['user', 'file', 'relation', 'computed', 'lookup', 'rollup', 'ai'];

function EditableCellInner({
    field,
    recordId,
    listId,
    value,
    canEdit: canEditByCaps = true,
    lockedReason = null,
}: EditableCellProps): JSX.Element {
    const canEditByUser = canEditByCaps && lockedReason === null;
    // v0.1.259 — UNA mutación por tabla (contexto), no una por celda: con
    // decenas de filas visibles eran cientos de observers montados por nada.
    const updateRecord = useContext(RecordUpdaterContext)!;
    const [pending, setPending] = useState(false);
    const wrapText = useWrapText();
    const relationTitles = useRelationTitlesFor(field.id);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<unknown>(value);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!editing) {
            setDraft(value);
            setError(null);
        }
    }, [value, editing]);

    // Combinación de dos checks:
    //  - `canEditByUser`: prop pasada por TableView (caps del usuario).
    //  - field.type editable inline (excluye user/file/relation/computed).
    const canEdit = canEditByUser && !NON_INLINE_TYPES.includes(field.type);

    const startEdit = (): void => {
        if (!canEdit) return;
        setDraft(value);
        setError(null);
        setEditing(true);
    };

    const cancel = (): void => {
        setDraft(value);
        setError(null);
        setEditing(false);
    };

    const commit = async (next: unknown): Promise<void> => {
        if (next === value) {
            setEditing(false);
            return;
        }
        setError(null);
        try {
            setPending(true);
            await updateRecord({ id: recordId, values: { [field.slug]: next } });
            setEditing(false);
        } catch (err) {
            const msg = err instanceof ApiError
                ? (err.errors[field.slug] ?? err.message)
                : err instanceof Error
                    ? err.message
                    : __('Error');
            setError(msg);
            // Mantenemos el modo edición para que el usuario corrija.
        } finally {
            setPending(false);
        }
    };

    if (!editing) {
        const isDateField = field.type === 'date' || field.type === 'datetime';

        // select / multi_select: popover directo estilo ClickUp — UN click
        // abre las opciones (nada de doble click ni modo edición
        // "encajonado" que quedaba pegado). En multi el popover queda
        // abierto para marcar varias opciones; cada toggle commitea
        // optimista y los chips de la celda se actualizan en vivo.
        // v0.1.252 — la casilla se marca con UN click (antes el primero sólo
        // mostraba el control y había que clickear de nuevo).
        if (field.type === 'checkbox' && canEdit) {
            return (
                <span className="imcrm-flex imcrm-h-full imcrm-items-center">
                    <input
                        type="checkbox"
                        className="imcrm-h-4 imcrm-w-4 imcrm-cursor-pointer imcrm-accent-[hsl(var(--imcrm-primary))]"
                        checked={Boolean(value)}
                        disabled={pending}
                        aria-label={field.label}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void commit(e.target.checked)}
                    />
                </span>
            );
        }

        if ((field.type === 'select' || field.type === 'multi_select') && canEdit) {
            return (
                <OptionPicker
                    field={field}
                    listId={listId}
                    mode={field.type === 'select' ? 'single' : 'multi'}
                    variant="cell"
                    // v0.1.137 — "Ajustar texto" también manda sobre los chips
                    // (paridad con ClickUp): sin él, una línea recortada.
                    wrap={wrapText}
                    value={
                        field.type === 'select'
                            ? (typeof value === 'string' ? value : null)
                            : (Array.isArray(value) ? (value as string[]) : [])
                    }
                    onChange={(v) => {
                        void commit(field.type === 'select' ? (v ?? null) : (Array.isArray(v) ? v : []));
                    }}
                />
            );
        }

        // v0.1.209 — relación: chips con el título del vinculado (resuelto
        // por la tabla, una query por columna) y el mismo selector con
        // buscador que la ficha. Sin permiso de edición queda de lectura.
        if (field.type === 'relation') {
            return (
                <RelationPicker
                    field={field}
                    variant="cell"
                    wrap={wrapText}
                    value={value}
                    knownTitles={relationTitles}
                    disabled={!canEditByUser}
                    onChange={(ids) => void commit(ids)}
                />
            );
        }

        // v0.1.158 — la calificación se pone HACIENDO CLICK en la estrella:
        // el mismo criterio que select/multi_select (no hay un "modo edición"
        // aparte para algo que se resuelve en un gesto).
        if (field.type === 'rating' && canEdit) {
            const cfg = field.config as { max?: number; icon?: RatingIcon };
            return (
                <RatingControl
                    value={typeof value === 'number' ? value : null}
                    max={cfg.max}
                    icon={cfg.icon}
                    onChange={(next) => void commit(next)}
                />
            );
        }

        // Para fechas usamos el `<DateCellEditor>` (calendario visual +
        // recurrencia ClickUp-style) en lugar del input nativo. Click
        // simple abre el picker; las mutaciones se confirman vía
        // `commit(next)` que reusa el optimistic update existente.
        if (isDateField && canEdit) {
            return (
                <DateCellEditor
                    listId={listId}
                    recordId={recordId}
                    field={field}
                    value={typeof value === 'string' ? value : null}
                    onCommit={(next) => void commit(next)}
                >
                    <DateCellTrigger
                        listId={listId}
                        recordId={recordId}
                        field={field}
                        cellValue={value}
                    />
                </DateCellEditor>
            );
        }

        // `imcrm-truncate` (overflow-hidden + nowrap + text-overflow:
        // ellipsis) recorta el contenido cuando supera el ancho de la
        // columna — sin esto, long_text/multi_select largos se metían
        // visualmente sobre las celdas vecinas. El user usa el drawer
        // de detalle para ver/editar el contenido completo, o activa
        // "Ajustar texto" en el panel de la vista (`wrapText`).
        return (
            <button
                type="button"
                // UN click para editar (feedback del usuario, estilo
                // ClickUp) — antes exigía doble click. No choca con abrir
                // el registro: eso vive solo en la columna primaria/ID.
                onClick={startEdit}
                disabled={!canEdit}
                className={cn(
                    'imcrm-block imcrm-w-full imcrm-text-left imcrm-min-h-[1.5rem]',
                    wrapText ? 'imcrm-whitespace-pre-wrap imcrm-break-words' : 'imcrm-truncate',
                    canEdit && 'hover:imcrm-bg-accent/40 imcrm-rounded imcrm--mx-1 imcrm-px-1',
                    !canEdit && 'imcrm-cursor-default',
                )}
                title={lockedReason ?? (canEdit ? __('Click para editar') : __('No editable inline'))}
            >
                {renderCellValue(field, value)}
            </button>
        );
    }

    return (
        <div className="imcrm-relative imcrm--mx-1 imcrm--my-0.5">
            <CellEditor
                field={field}
                value={draft}
                onChange={setDraft}
                onCommit={(v) => void commit(v)}
                onCancel={cancel}
                isPending={pending}
            />
            {error !== null && (
                <div className="imcrm-absolute imcrm-left-0 imcrm-top-full imcrm-z-10 imcrm-mt-1 imcrm-rounded-md imcrm-border imcrm-border-destructive imcrm-bg-destructive imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-destructive-foreground imcrm-shadow-imcrm-md">
                    {error}
                </div>
            )}
        </div>
    );
}

/**
 * Memo wrapper (Fase 16.D — fix perf P4 del reporte de auditoría).
 *
 * Antes: el TableView renderea `<EditableCell>` por cada cell visible
 * (típicamente 10 cols × 50 rows = 500 cells). Sin memo, cualquier
 * re-render del parent (RecordsPage, p.ej. al tipear en el search)
 * re-rendea las 500 celdas. Con la cell siendo 448 líneas con state
 * propio + 3-4 useEffect, eso es work caro.
 *
 * Comparator custom: solo re-rendea si (recordId, field.id, value,
 * canEdit, listId) cambian. Los demás props son closures que el
 * parent crea fresh en cada render pero NO cambian la pintada del
 * cell.
 *
 * Importante: si el field config cambia (ej. options de un select)
 * el TableView dispara un re-mount via key — no necesitamos
 * comparar `field` por deep equality.
 */
type RecordUpdater = ReturnType<typeof useUpdateRecord>['mutateAsync'];
const RecordUpdaterContext = createContext<RecordUpdater | null>(null);

/** La mutación de edición que comparten todas las celdas de una tabla. */
export function RecordUpdaterProvider({ listId, children }: { listId: number; children: ReactNode }): JSX.Element {
    const update = useUpdateRecord(listId);
    return <RecordUpdaterContext.Provider value={update.mutateAsync}>{children}</RecordUpdaterContext.Provider>;
}

/** Fuera de una tabla con proveedor, la celda trae el suyo. */
function EditableCellWithUpdater(props: EditableCellProps): JSX.Element {
    const shared = useContext(RecordUpdaterContext);
    if (shared) return <EditableCellInner {...props} />;
    return (
        <RecordUpdaterProvider listId={props.listId}>
            <EditableCellInner {...props} />
        </RecordUpdaterProvider>
    );
}

export const EditableCell = memo(EditableCellWithUpdater, (prev, next) => {
    return (
        prev.recordId === next.recordId
        && prev.listId === next.listId
        && prev.field.id === next.field.id
        && prev.value === next.value
        && prev.canEdit === next.canEdit
        && prev.lockedReason === next.lockedReason
    );
});

interface CellEditorProps {
    field: FieldEntity;
    value: unknown;
    onChange: (value: unknown) => void;
    onCommit: (value: unknown) => void;
    onCancel: () => void;
    isPending: boolean;
}

function CellEditor({ field, value, onChange, onCommit, onCancel, isPending }: CellEditorProps): JSX.Element {
    const ref = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

    useEffect(() => {
        ref.current?.focus();
        if (ref.current && 'select' in ref.current) {
            try {
                (ref.current as HTMLInputElement).select();
            } catch {
                // ignore
            }
        }
    }, []);

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter' && field.type !== 'long_text') {
            e.preventDefault();
            onCommit(value);
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit(value);
        }
    };

    const commonProps = {
        onKeyDown: handleKeyDown,
        onBlur: () => onCommit(value),
        disabled: isPending,
        className: 'imcrm-h-7 imcrm-text-sm',
    };

    switch (field.type) {
        case 'long_text':
            return (
                <Textarea
                    ref={ref as React.RefObject<HTMLTextAreaElement>}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => onCommit(value)}
                    disabled={isPending}
                    className="imcrm-min-h-[60px] imcrm-text-sm"
                    rows={3}
                />
            );
        case 'checkbox':
            return (
                <input
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => {
                        onChange(e.target.checked);
                        // Para checkbox, el commit es inmediato.
                        onCommit(e.target.checked);
                    }}
                    disabled={isPending}
                />
            );
        // select / multi_select NO pasan por acá: en modo lectura la celda
        // ya renderiza el OptionPicker (variant="cell") con popover directo.
        case 'number':
        case 'currency':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="number"
                    step="any"
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                />
            );
        case 'date':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="date"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value || null)}
                />
            );
        case 'datetime':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="datetime-local"
                    value={typeof value === 'string' && value !== '' ? toLocalDateTimeInput(value) : ''}
                    // v0.1.252 — el backend exige el instante con zona.
                    onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
                />
            );
        case 'percent':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                />
            );
        case 'duration':
            return (
                <DurationControl
                    ref={ref as React.RefObject<HTMLInputElement>}
                    value={typeof value === 'number' ? value : null}
                    format={(field.config as { format?: DurationFormat }).format}
                    onCommit={onCommit}
                    onCancel={onCancel}
                    disabled={isPending}
                />
            );
        case 'phone':
            return (
                <PhoneControl
                    ref={ref as React.RefObject<HTMLInputElement>}
                    value={typeof value === 'string' ? value : null}
                    config={field.config}
                    onChange={onChange}
                    onKeyDown={handleKeyDown}
                    onBlur={() => onCommit(value)}
                    disabled={isPending}
                />
            );
        case 'email':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="email"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'url':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="url"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        default:
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
    }
}

/**
 * Trigger del `DateCellEditor` en modo lectura. Muestra el valor
 * formateado y, cuando el record tiene una recurrencia activa para
 * este field, un icono `RefreshCw` en el lado derecho — feedback
 * visual rápido para que el user sepa qué fechas se repiten sin
 * tener que abrir cada celda.
 *
 * **Importante**: `forwardRef` + spread de props es obligatorio.
 * Radix `<PopoverTrigger asChild>` inyecta su `ref` y handlers
 * (onClick, onPointerDown, aria-*) sobre el hijo directo. Si este
 * componente es una function component sin forward, Radix no puede
 * adjuntar los handlers al `<button>` real y los clicks no abren
 * el popover.
 *
 * `useRecurrences` se llama también dentro de `DateCellEditor`,
 * pero React Query dedupea por queryKey (mismos `listId+recordId`)
 * — sin overhead extra de red.
 */
const DateCellTrigger = forwardRef<
    HTMLButtonElement,
    {
        listId: number;
        recordId: number;
        field: FieldEntity;
        // Renombrado a `cellValue` para no chocar con el `value` propio
        // de `<button>` en `ButtonHTMLAttributes` (string|number|...).
        cellValue: unknown;
    } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'>
>(function DateCellTrigger(
    { listId, recordId, field, cellValue, ...rest },
    ref,
) {
    // Usa el batch context si existe (TableView lo provee con N
    // recordIds en una sola query). Fallback a fetch individual
    // cuando se renderea fuera de TableView (ej. un drawer
    // standalone). Cero N+1 en la tabla.
    const recurrences = useRecurrencesForRecord(listId, recordId);
    const hasRecurrence = (recurrences.data ?? []).some((r) => r.date_field_id === field.id);

    return (
        <button
            ref={ref}
            type="button"
            {...rest}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-1 imcrm-truncate imcrm-text-left imcrm-min-h-[1.5rem] imcrm-rounded imcrm--mx-1 imcrm-px-1 hover:imcrm-bg-accent/40',
                /* las fechas no se benefician del wrap: nunca desbordan */
                rest.className,
            )}
            title={hasRecurrence
                ? __('Recurrente · click para editar')
                : __('Editar fecha y recurrencia')}
        >
            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                {renderCellValue(field, cellValue)}
            </span>
            {hasRecurrence && (
                <RefreshCw
                    className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-success"
                    aria-label={__('Recurrente')}
                />
            )}
        </button>
    );
});

/** Instante del API → valor de un `<input type="datetime-local">` en hora local. */
function toLocalDateTimeInput(value: string): string {
    const d = parseUtcDate(value);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
