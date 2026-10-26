import { createContext, forwardRef, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { formatDuration, parseDuration, parseNumberText, validateFieldValue, type DurationFormat } from '@imagina-base/shared';

import { PhoneControl } from '@/components/fields/PhoneControl';
import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';

import { Input } from '@/components/ui/input';
import { RelationPicker } from '@/components/fields/RelationPicker';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { useRecurrencesForRecord } from '@/hooks/useRecurrences';
import { useUpdateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import type { GridPickerControl } from '@/lib/gridPicker';
import { getTenantFormat } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { ButtonFieldControl } from './buttons/ButtonFieldControl';
import { DateCellEditor } from './DateCellEditor';
import { isCloseCancelled } from './dependencies/closeGuard';
import { gridCellKey, useCellEditRequest, useGridEditStore, type EditEndReason } from './grid/editStore';
import { editLabel, useGridHistory } from './grid/history';
import { isCheckedValue, renderCellValue } from './renderCellValue';
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
    /**
     * El registro de la fila. Lo necesita el campo «Botón» (su condición de
     * «deshabilitado si…» mira otros campos del registro).
     */
    record?: RecordEntity;
}

/**
 * Celda con edición inline.
 *
 * Dentro de una TABLA (v0.1.294, como una hoja de cálculo) un click ELIGE la
 * celda —para copiar, cortar, pegar, borrar o moverse con el teclado— y la
 * edición se pide aparte: segundo click sobre la celda elegida, doble click,
 * Enter, F2 o empezar a escribir (lo tecleado reemplaza el valor). La tabla lo
 * pide por el almacén de edición (`grid/editStore`) y la celda avisa cuando
 * termina, así el foco vuelve a la tabla y Enter/Tab mueven la selección.
 * Antes un click abría el editor: el teclado quedaba dentro del input y
 * copiar/pegar no funcionaba (Ctrl+C copiaba «3000» crudo, en una selección no
 * copiaba nada y pegar un bloque de Excel no hacía nada).
 *
 * Fuera de una tabla (la tabla editable de la ficha) no hay almacén y un click
 * edita, como siempre.
 *
 * - Enter o salir confirma → mutación optimista; Escape cancela.
 * - Si el servidor (o la validación local) rechaza, el error queda sobre la
 *   celda y el editor sigue abierto para corregir.
 */
// `computed` y compañía se muestran de sólo lectura: los deriva el servidor.
// v0.1.300 — el ID automático y las columnas de sistema los pone el servidor.
const SERVER_FILLED = ['autonumber', 'created_at', 'updated_at', 'created_by', 'updated_by'];
const NON_INLINE_TYPES = ['user', 'file', 'relation', 'computed', 'lookup', 'rollup', 'ai', 'time_tracked', 'formula', 'approval', ...SERVER_FILLED];
/** Tipos que no se editan desde la celda en ningún modo. */
const READ_ONLY_TYPES = ['file', 'computed', 'lookup', 'rollup', 'ai', 'time_tracked', 'formula', 'approval', ...SERVER_FILLED];
/** Tipos que se editan con un selector (popover). */
const PICKER_TYPES = ['select', 'multi_select', 'date', 'datetime', 'user', 'relation'];
const NUMERIC_TEXT_TYPES = ['number', 'currency', 'percent'];

function isEmptyCellValue(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** El texto con el que arranca el editor (números con el decimal de la empresa, sin miles). */
export function editDraftFor(field: FieldEntity, value: unknown): unknown {
    if (NUMERIC_TEXT_TYPES.includes(field.type)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return value === null || value === undefined ? '' : String(value);
        const fmt = getTenantFormat().number_format;
        const s = String(value);
        return fmt === 'comma_dot' ? s : s.replace('.', ',');
    }
    if (field.type === 'duration') {
        return formatDuration(value, (field.config as { format?: DurationFormat }).format);
    }
    return value;
}

/**
 * Lo que escribió la persona → el valor del campo, con el MISMO criterio que
 * el servidor (validador compartido). Los números se leen con el formato de la
 * empresa («1.500.000» o «1,5»); la duración, «1h 30m», «1:30» o «90».
 */
export function parseCellDraft(field: FieldEntity, draft: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
    // La relación no vive en `data` (el validador no la conoce): son ids.
    if (field.type === 'relation') return { ok: true, value: Array.isArray(draft) ? draft : [] };
    let value: unknown = draft;
    if (typeof draft === 'string' && (NUMERIC_TEXT_TYPES.includes(field.type) || field.type === 'duration')) {
        const text = draft.trim();
        if (text === '') {
            value = null;
        } else if (field.type === 'duration') {
            const parsed = parseDuration(text);
            if (!parsed.ok) return { ok: false, error: __('Escribe una duración: 1h 30m, 1:30 o 90') };
            value = parsed.value;
        } else {
            const n = parseNumberText(field.type === 'percent' ? text.replace(/%/g, '') : text, getTenantFormat().number_format);
            if (n === null) return { ok: false, error: sprintf(__('«%s» no es un número'), text) };
            value = n;
        }
    }
    if (field.type === 'text' || field.type === 'long_text' || field.type === 'email' || field.type === 'url') {
        if (typeof value === 'string' && value.trim() === '') value = null;
    }
    const valid = validateFieldValue({ type: field.type, config: field.config, is_required: field.is_required }, value);
    if (!valid.ok) return { ok: false, error: valid.error };
    return { ok: true, value: valid.value };
}

function EditableCellInner({
    field,
    recordId,
    listId,
    value,
    canEdit: canEditByCaps = true,
    lockedReason = null,
    record,
}: EditableCellProps): JSX.Element {
    const canEditByUser = canEditByCaps && lockedReason === null;
    // v0.1.259 — UNA mutación por tabla (contexto), no una por celda: con
    // decenas de filas visibles eran cientos de observers montados por nada.
    const updateRecord = useContext(RecordUpdaterContext)!;
    const history = useGridHistory();
    const store = useGridEditStore();
    const gridMode = store !== null;
    const gridKey = gridCellKey(recordId, field.id);
    const editReq = useCellEditRequest(store, gridKey);
    const [pending, setPending] = useState(false);
    const wrapText = useWrapText();
    const relationTitles = useRelationTitlesFor(field.id);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<unknown>(value);
    const [error, setError] = useState<string | null>(null);
    /** En la tabla: el selector abierto por la tabla (y lo tecleado para abrirlo). */
    const [picker, setPicker] = useState<{ token: number; seed: string | null } | null>(null);
    /** El último pedido de edición ya atendido (estado, no ref: se lee al dibujar). */
    const [handledToken, setHandledToken] = useState(0);
    /** Acciones de un pedido que no son abrir un editor (marcar casilla, poner estrellas, presionar un botón). */
    const [pendingAction, setPendingAction] = useState<{ kind: 'toggle' | 'rate' | 'press' | 'end'; value?: number | null } | null>(null);
    /** Campo «Botón»: sube en uno para presionarlo desde el teclado. */
    const [pressSignal, setPressSignal] = useState(0);
    const committing = useRef(false);
    /** El editor arrancó con algo tecleado (reemplaza el valor): el cursor va al final. */
    const [seeded, setSeeded] = useState(false);
    const editorBoxRef = useRef<HTMLDivElement>(null);

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

    const endGrid = (reason: EditEndReason): void => {
        store?.end(gridKey, reason);
    };

    const startEdit = (): void => {
        if (!canEdit) return;
        setDraft(editDraftFor(field, value));
        setSeeded(false);
        setError(null);
        setEditing(true);
    };

    const cancel = (): void => {
        setDraft(value);
        setError(null);
        setEditing(false);
        endGrid('escape');
    };

    /**
     * `reason`: cómo terminó la edición (Enter, Tab, salir…). Sólo con razón
     * se le avisa a la tabla — un selector múltiple guarda en cada opción y
     * sigue abierto.
     */
    const commit = async (raw: unknown, reason?: EditEndReason): Promise<void> => {
        if (committing.current) return;
        const parsed = parseCellDraft(field, raw);
        if (!parsed.ok) {
            setError(parsed.error);
            return;
        }
        const next = parsed.value;
        if (next === value || (isEmptyCellValue(next) && isEmptyCellValue(value))) {
            setEditing(false);
            setError(null);
            if (reason) endGrid(reason);
            return;
        }
        committing.current = true;
        setError(null);
        try {
            setPending(true);
            const saved = await updateRecord({ id: recordId, values: { [field.slug]: next } });
            setEditing(false);
            // v0.1.287 — la edición de una celda es UN paso de deshacer
            // (Ctrl/Cmd+Z con el foco en la tabla). El "después" es lo que
            // QUEDÓ guardado: deshacer compara contra eso.
            if (history) {
                const after = field.type === 'relation'
                    ? saved?.relations?.[field.slug] ?? next
                    : saved?.fields?.[field.slug] ?? next;
                history.record({ label: editLabel(field), cells: [{ recordId, field, before: value, after }] });
            }
            if (reason) endGrid(reason);
        } catch (err) {
            // A8 — la persona canceló el cierre (lo bloquean registros
            // abiertos): no es un error, la celda vuelve a como estaba.
            if (isCloseCancelled(err)) {
                setEditing(false);
                setError(null);
                if (reason) endGrid(reason);
                return;
            }
            // v0.1.300 — una regla de OTRO campo («NIT» es obligatorio cuando
            // «Tipo» es «Empresa») también se muestra junto a esta celda.
            const msg = err instanceof ApiError
                ? (err.errors[field.slug] ?? Object.values(err.errors)[0] ?? err.message)
                : err instanceof Error
                    ? err.message
                    : __('Error');
            setError(msg);
            // Mantenemos el modo edición para que el usuario corrija.
        } finally {
            setPending(false);
            committing.current = false;
        }
    };

    // v0.1.294 — La tabla pidió editar ESTA celda. Se atiende AL DIBUJAR (no
    // en un efecto): así el editor queda montado —y enfocado, ver CellEditor—
    // antes de la tecla siguiente. En un efecto, quien escribe rápido perdía
    // las primeras letras (caían en la tabla mientras el editor se abría).
    if (store && editReq && editReq.token !== handledToken) {
        setHandledToken(editReq.token);
        const seed = editReq.seed;
        if (field.type === 'button') {
            // Enter o Espacio presionan el botón (sus permisos los decide él).
            setPendingAction(seed === null || seed === ' ' ? { kind: 'press' } : { kind: 'end' });
        } else if (!canEditByUser || READ_ONLY_TYPES.includes(field.type)) {
            setPendingAction({ kind: 'end' });
        } else if (field.type === 'checkbox') {
            // Enter o Espacio la marcan / desmarcan.
            setPendingAction(seed === null || seed === ' ' ? { kind: 'toggle' } : { kind: 'end' });
        } else if (field.type === 'rating') {
            // Un número la pone (0 la vacía); otra tecla no hace nada.
            setPendingAction(seed !== null && /^\d$/.test(seed) ? { kind: 'rate', value: Number(seed) === 0 ? null : Number(seed) } : { kind: 'end' });
        } else if (PICKER_TYPES.includes(field.type)) {
            setPicker({ token: editReq.token, seed });
        } else {
            setDraft(seed !== null ? seed : editDraftFor(field, value));
            setSeeded(seed !== null);
            setError(null);
            setEditing(true);
        }
    }
    useEffect(() => {
        if (!pendingAction) return;
        setPendingAction(null);
        if (pendingAction.kind === 'toggle') void commit(!isCheckedValue(value), 'closed');
        else if (pendingAction.kind === 'rate') void commit(pendingAction.value ?? null, 'closed');
        else if (pendingAction.kind === 'press') {
            setPressSignal((n) => n + 1);
            endGrid('closed');
        } else endGrid('closed');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingAction]);

    // Teclas que llegaron antes de que el editor tomara el foco (se escribe
    // rápido): se suman a lo tecleado.
    useEffect(() => {
        if (!editReq || editReq.token !== handledToken || editReq.seed === null) return;
        if (picker && picker.token === editReq.token) {
            if (picker.seed !== editReq.seed) setPicker({ token: picker.token, seed: editReq.seed });
        } else if (editing && seeded) {
            setDraft(editReq.seed);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editReq?.seed]);

    const gridPicker: GridPickerControl | undefined = gridMode
        ? {
              openToken: picker?.token ?? null,
              seed: picker?.seed ?? null,
              onClosed: () => {
                  setPicker(null);
                  endGrid('closed');
              },
          }
        : undefined;

    if (!editing) {
        const isDateField = field.type === 'date' || field.type === 'datetime';

        // Campo «Botón»: UN click lo presiona (como la casilla), sin elegir la
        // celda antes. Deshabilitado, se ve atenuado con el motivo en el tooltip.
        if (field.type === 'button') {
            return (
                <span className="imcrm-flex imcrm-h-full imcrm-min-w-0 imcrm-items-center">
                    <ButtonFieldControl field={field} listId={listId} record={record ?? null} size="cell" pressSignal={pressSignal} />
                </span>
            );
        }

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
                        checked={isCheckedValue(value)}
                        disabled={pending}
                        aria-label={field.label}
                        // En la tabla la casilla no se lleva el foco: el teclado
                        // (flechas, Ctrl+C) sigue en la tabla.
                        tabIndex={gridMode ? -1 : undefined}
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
                    grid={gridPicker}
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
                    grid={gridPicker}
                    onChange={(ids) => void commit(ids)}
                />
            );
        }

        // v0.1.286 — persona: se asigna desde la tabla con el mismo selector de
        // la ficha (antes sólo se podía en la ficha). El selector se monta
        // recién en el primer click (un popover por celda pesa, v0.1.259).
        if (field.type === 'user' && canEditByUser) {
            return (
                <UserCellEditor
                    field={field}
                    value={value}
                    pending={pending}
                    grid={gridPicker}
                    onCommit={(id) => void commit(id)}
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
                    grid={gridPicker}
                    onCommit={(next) => void commit(next)}
                >
                    <DateCellTrigger
                        listId={listId}
                        recordId={recordId}
                        field={field}
                        cellValue={value}
                        asDisplay={gridMode}
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
        // v0.1.291 — sin edición en línea (archivos, persona, calculados…) la
        // celda es un div, no un <button disabled>: un botón deshabilitado se
        // traga los clicks de lo que tiene adentro (el enlace del archivo que
        // abre el visor) y además un enlace dentro de un botón es HTML inválido.
        // v0.1.294 — en la tabla tampoco es un botón: el click elige la celda
        // y la edición la pide la tabla (segundo click, doble click, Enter).
        if (!canEdit || gridMode) {
            return (
                <div
                    className={cn(
                        'imcrm-block imcrm-w-full imcrm-text-left imcrm-min-h-[1.5rem]',
                        !gridMode && 'imcrm-cursor-default',
                        wrapText ? 'imcrm-whitespace-pre-wrap imcrm-break-words' : 'imcrm-truncate',
                    )}
                    title={lockedReason ?? (canEdit ? undefined : __('No editable inline'))}
                >
                    {renderCellValue(field, value)}
                </div>
            );
        }
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
        <div ref={editorBoxRef} className="imcrm-relative imcrm--mx-1 imcrm--my-0.5">
            <CellEditor
                field={field}
                value={draft}
                onChange={(v) => {
                    setDraft(v);
                    if (error !== null) setError(null);
                }}
                onCommit={(v, reason) => void commit(v, reason)}
                onCancel={cancel}
                isPending={pending}
                gridMode={gridMode}
                caretAtEnd={gridMode || seeded}
                invalid={error !== null}
            />
            {error !== null && (
                <CellErrorBubble anchor={editorBoxRef} message={error} hint={gridMode ? __('Corrígelo o pulsa Esc para descartar.') : null} />
            )}
        </div>
    );
}

/**
 * v0.1.294 — El motivo de un valor rechazado, debajo de la celda. Va por
 * portal y con posición fija: la celda recorta lo que se sale (overflow
 * hidden), y por eso el mensaje antes no se veía.
 */
function CellErrorBubble({ anchor, message, hint }: { anchor: React.RefObject<HTMLElement>; message: string; hint: string | null }): JSX.Element | null {
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    useLayoutEffect(() => {
        const update = (): void => {
            const r = anchor.current?.getBoundingClientRect();
            if (r) setPos({ left: r.left, top: r.bottom + 4 });
        };
        update();
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [anchor, message]);
    if (!pos) return null;
    return createPortal(
        <div
            role="alert"
            style={{ position: 'fixed', left: pos.left, top: pos.top }}
            className="imcrm-z-[70] imcrm-max-w-[18rem] imcrm-rounded-md imcrm-border imcrm-border-destructive imcrm-bg-destructive imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-destructive-foreground imcrm-shadow-imcrm-md"
            data-testid="imcrm-cell-error"
        >
            {message}
            {hint && <span className="imcrm-mt-0.5 imcrm-block imcrm-opacity-80">{hint}</span>}
        </div>,
        document.body,
    );
}

/** Celda de persona: lectura hasta el primer click; después, el selector. */
function UserCellEditor({
    field,
    value,
    pending,
    grid,
    onCommit,
}: {
    field: FieldEntity;
    value: unknown;
    pending: boolean;
    grid?: GridPickerControl;
    onCommit: (id: number | null) => void;
}): JSX.Element {
    const [armed, setArmed] = useState(false);
    const current = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : null;
    const open = grid ? grid.openToken !== null : armed;
    if (!open) {
        if (grid) {
            return (
                <div className="imcrm-block imcrm-min-h-[1.5rem] imcrm-w-full imcrm-truncate imcrm-text-left" data-testid={`imcrm-user-cell-${field.slug}`}>
                    {renderCellValue(field, value)}
                </div>
            );
        }
        return (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setArmed(true);
                }}
                disabled={pending}
                className="imcrm-block imcrm-min-h-[1.5rem] imcrm-w-full imcrm-truncate imcrm-rounded imcrm--mx-1 imcrm-px-1 imcrm-text-left hover:imcrm-bg-accent/40"
                title={__('Click para asignar')}
                data-testid={`imcrm-user-cell-${field.slug}`}
            >
                {renderCellValue(field, value)}
            </button>
        );
    }
    return (
        // El popover vive en un portal, pero los eventos de React burbujean por
        // el ÁRBOL: sin esto un click adentro abría la ficha del registro.
        <div onClick={(e) => e.stopPropagation()} className="imcrm-min-w-0">
            <UserPicker
                key={`${grid?.openToken ?? 'armed'}:${grid?.seed ?? ''}`}
                value={Number.isFinite(current) ? current : null}
                onChange={(id) => onCommit(id)}
                flat
                compact
                showAssignMe
                defaultOpen
                disabled={pending}
                initialQuery={grid?.seed ?? ''}
                onOpenChange={(o) => {
                    if (!o) grid?.onClosed();
                }}
            />
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

/**
 * La mutación de edición que comparten todas las celdas de una tabla.
 *
 * v0.1.290 — `onSaved`: la tabla EDITABLE de la ficha (los ítems de una
 * cotización) lee sus filas del bundle de la ficha y no de la lista: al
 * guardar una celda parchea ese cache y refresca lo que depende (totales,
 * rollups del registro, el PDF).
 */
export function RecordUpdaterProvider({
    listId,
    onSaved,
    children,
}: {
    listId: number;
    onSaved?: (id: number, values: Record<string, unknown>) => void;
    children: ReactNode;
}): JSX.Element {
    const update = useUpdateRecord(listId);
    const { mutateAsync } = update;
    const updater = useMemo<RecordUpdater>(
        () =>
            onSaved
                ? async (vars, opts) => {
                      const res = await mutateAsync(vars, opts);
                      onSaved(vars.id, vars.values);
                      return res;
                  }
                : mutateAsync,
        [mutateAsync, onSaved],
    );
    return <RecordUpdaterContext.Provider value={updater}>{children}</RecordUpdaterContext.Provider>;
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
        // Campo «Botón»: no tiene valor propio; su «deshabilitado si…» mira la
        // FILA y su aspecto la config — sin esto quedaba con el estado viejo.
        && (next.field.type !== 'button' || (prev.record === next.record && prev.field === next.field))
    );
});


interface CellEditorProps {
    field: FieldEntity;
    value: unknown;
    onChange: (value: unknown) => void;
    /** `reason`: cómo terminó (Enter, Tab, salir) — la tabla mueve la selección con eso. */
    onCommit: (value: unknown, reason: EditEndReason) => void;
    onCancel: () => void;
    isPending: boolean;
    /** v0.1.294 — dentro de la tabla: Tab confirma y pasa a la celda de al lado. */
    gridMode: boolean;
    /** Cursor al final (tabla, o se empezó tecleando) en vez de todo seleccionado. */
    caretAtEnd: boolean;
    invalid: boolean;
}

function CellEditor({ field, value, onChange, onCommit, onCancel, isPending, gridMode, caretAtEnd, invalid }: CellEditorProps): JSX.Element {
    const ref = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

    // useLayoutEffect: el foco entra al editor en el mismo commit que lo
    // monta, antes de que llegue la tecla siguiente.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        if (!('setSelectionRange' in el) || el instanceof HTMLSelectElement) return;
        try {
            if (caretAtEnd) {
                const len = el.value.length;
                el.setSelectionRange(len, len);
            } else {
                el.select();
            }
        } catch {
            // inputs sin selección (email/number en algunos navegadores)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter' && field.type !== 'long_text' && !e.shiftKey) {
            e.preventDefault();
            onCommit(value, 'enter');
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit(value, 'enter');
        } else if (e.key === 'Tab' && gridMode) {
            e.preventDefault();
            onCommit(value, e.shiftKey ? 'shift-tab' : 'tab');
        }
    };

    const commonProps = {
        onKeyDown: handleKeyDown,
        onBlur: () => onCommit(value, 'blur'),
        disabled: isPending,
        'aria-invalid': invalid || undefined,
        className: cn('imcrm-h-7 imcrm-text-sm', invalid && 'imcrm-border-destructive focus-visible:imcrm-ring-destructive'),
    };
    const text = value === null || value === undefined ? '' : String(value);

    switch (field.type) {
        case 'long_text':
            return (
                <Textarea
                    ref={ref as React.RefObject<HTMLTextAreaElement>}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => onCommit(value, 'blur')}
                    disabled={isPending}
                    aria-invalid={invalid || undefined}
                    className={cn('imcrm-min-h-[60px] imcrm-text-sm', invalid && 'imcrm-border-destructive')}
                    rows={3}
                />
            );
        case 'checkbox':
            return (
                <input
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="checkbox"
                    checked={isCheckedValue(value)}
                    onChange={(e) => {
                        onChange(e.target.checked);
                        // Para checkbox, el commit es inmediato.
                        onCommit(e.target.checked, 'closed');
                    }}
                    disabled={isPending}
                />
            );
        // select / multi_select NO pasan por aquí: en modo lectura la celda
        // ya renderiza el OptionPicker (variant="cell") con popover directo.
        //
        // v0.1.294 — números, moneda, porcentaje y duración se escriben en un
        // input de TEXTO y se leen al confirmar con el formato de la empresa:
        // el `type="number"` nativo no aceptaba «1.500.000» ni «1,5» (pegarlo
        // vaciaba la celda) y mostraba flechitas que no aportan.
        case 'number':
        case 'currency':
        case 'percent':
        case 'duration':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    inputMode={field.type === 'duration' ? 'text' : 'decimal'}
                    placeholder={field.type === 'duration' ? '1h 30m' : undefined}
                    value={text}
                    onChange={(e) => onChange(e.target.value)}
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
        case 'phone':
            return (
                <PhoneControl
                    ref={ref as React.RefObject<HTMLInputElement>}
                    value={typeof value === 'string' ? value : null}
                    config={field.config}
                    onChange={onChange}
                    onKeyDown={handleKeyDown}
                    onBlur={() => onCommit(value, 'blur')}
                    disabled={isPending}
                />
            );
        case 'email':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="text"
                    inputMode="email"
                    value={text}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'url':
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    type="text"
                    inputMode="url"
                    value={text}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        default:
            return (
                <Input
                    {...commonProps}
                    ref={ref as React.RefObject<HTMLInputElement>}
                    value={text}
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
        /** v0.1.294 — en la tabla es sólo la vista del valor (el click elige la celda). */
        asDisplay?: boolean;
    } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'>
>(function DateCellTrigger(
    { listId, recordId, field, cellValue, asDisplay = false, ...rest },
    ref,
) {
    // Usa el batch context si existe (TableView lo provee con N
    // recordIds en una sola query). Fallback a fetch individual
    // cuando se renderea fuera de TableView (ej. un drawer
    // standalone). Cero N+1 en la tabla.
    const recurrences = useRecurrencesForRecord(listId, recordId);
    const hasRecurrence = (recurrences.data ?? []).some((r) => r.date_field_id === field.id);

    if (asDisplay) {
        return (
            <div
                ref={ref as unknown as React.Ref<HTMLDivElement>}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-1 imcrm-truncate imcrm-text-left imcrm-min-h-[1.5rem]"
                title={hasRecurrence ? __('Recurrente') : undefined}
            >
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{renderCellValue(field, cellValue)}</span>
                {hasRecurrence && (
                    <RefreshCw className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-success" aria-label={__('Recurrente')} />
                )}
            </div>
        );
    }

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
