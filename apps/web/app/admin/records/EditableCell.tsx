import { forwardRef, memo, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { useRecurrencesForRecord } from '@/hooks/useRecurrences';
import { useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { DateCellEditor } from './DateCellEditor';
import { renderCellValue } from './renderCellValue';

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
}

/**
 * Celda con edición inline.
 *
 * - Doble click activa modo edición (input apropiado al tipo).
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
const NON_INLINE_TYPES = ['user', 'file', 'relation', 'computed'];

function EditableCellInner({
    field,
    recordId,
    listId,
    value,
    canEdit: canEditByUser = true,
}: EditableCellProps): JSX.Element {
    const update = useUpdateRecord(listId);
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
            await update.mutateAsync({ id: recordId, values: { [field.slug]: next } });
            setEditing(false);
        } catch (err) {
            const msg = err instanceof ApiError
                ? (err.errors[field.slug] ?? err.message)
                : err instanceof Error
                    ? err.message
                    : __('Error');
            setError(msg);
            // Mantenemos el modo edición para que el usuario corrija.
        }
    };

    if (!editing) {
        const isDateField = field.type === 'date' || field.type === 'datetime';

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
        // de detalle para ver/editar el contenido completo.
        return (
            <button
                type="button"
                onDoubleClick={startEdit}
                disabled={!canEdit}
                className={cn(
                    'imcrm-block imcrm-w-full imcrm-truncate imcrm-text-left imcrm-min-h-[1.5rem]',
                    canEdit && 'hover:imcrm-bg-accent/40 imcrm-rounded imcrm--mx-1 imcrm-px-1',
                    !canEdit && 'imcrm-cursor-default',
                )}
                title={canEdit ? __('Doble click para editar') : __('No editable inline')}
            >
                {renderCellValue(field, value)}
            </button>
        );
    }

    return (
        <div className="imcrm-relative imcrm--mx-1 imcrm--my-0.5">
            <CellEditor
                field={field}
                listId={listId}
                value={draft}
                onChange={setDraft}
                onCommit={(v) => void commit(v)}
                onCancel={cancel}
                isPending={update.isPending}
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
export const EditableCell = memo(EditableCellInner, (prev, next) => {
    return (
        prev.recordId === next.recordId
        && prev.listId === next.listId
        && prev.field.id === next.field.id
        && prev.value === next.value
        && prev.canEdit === next.canEdit
    );
});

interface CellEditorProps {
    field: FieldEntity;
    listId: number;
    value: unknown;
    onChange: (value: unknown) => void;
    onCommit: (value: unknown) => void;
    onCancel: () => void;
    isPending: boolean;
}

function CellEditor({ field, listId, value, onChange, onCommit, onCancel, isPending }: CellEditorProps): JSX.Element {
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
        case 'select':
            return (
                <OptionPicker
                    field={field}
                    listId={listId}
                    mode="single"
                    value={typeof value === 'string' ? value : null}
                    onChange={(v) => {
                        // Auto-commit al cambiar (igual que la versión
                        // con `<select>` que llamaba a onCommit en
                        // `onChange`). El OptionPicker cierra su popover
                        // tras la selección.
                        onChange(v ?? null);
                        onCommit(v ?? null);
                    }}
                />
            );
        case 'multi_select':
            return (
                <OptionPicker
                    field={field}
                    listId={listId}
                    mode="multi"
                    value={Array.isArray(value) ? (value as string[]) : []}
                    onChange={(v) => {
                        // Commit on every toggle — TanStack Query dedupea
                        // mutations sucesivas con la misma key, así que
                        // marcar 3 opciones seguidas genera ~1 request.
                        const next = Array.isArray(v) ? v : [];
                        onChange(next);
                        onCommit(next);
                    }}
                />
            );
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
                    value={typeof value === 'string' ? value.replace(' ', 'T').slice(0, 16) : ''}
                    onChange={(e) => onChange(e.target.value || null)}
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
