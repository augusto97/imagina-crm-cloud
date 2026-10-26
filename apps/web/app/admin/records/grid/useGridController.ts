import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Team } from '@imagina-base/shared';
import { useToast } from '@/components/ui/toast';
import type { ResolvedAttachment } from '@/hooks/useAttachments';
import type { RelationTitles } from '@/hooks/useRelationTitles';
import { teamsKeys } from '@/hooks/useTeams';
import type { WpUserSummary } from '@/hooks/useWpUsers';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { isTypingTarget, moveActiveCell, type GridPos } from '../views/gridKeyboard';
import { MAIN_SCROLLER_ID } from '../views/stickyTop';
import { cellToText, type CellTextContext } from './cellText';
import {
    clearCut,
    clipForText,
    getCutKeys,
    getGridClip,
    setGridClip,
    subscribeGridClip,
    toHtmlTable,
    type ClipCell,
} from './clipboard';
import { GridEditStore, gridCellKey, type EditEndReason } from './editStore';
import {
    cellValue,
    cellWriteBlock,
    planClear,
    planFill,
    summarizeIssues,
    type CellChange,
    type CellIssue,
    type GridColumnRef,
    type GridPlan,
    type LockedReason,
} from './gridPlan';
import { bulkLabel, editLabel, useGridHistory, type HistoryCreatedRow } from './history';
import { computePaste, pasteNeedsReview, preparePaste, type PasteInputs, type PasteOutcome } from './pasteFlow';
import {
    cellSelectionShadows,
    clampRange,
    extendFocus,
    fillPreviewShadows,
    isRangeFill,
    PREVIEW_FILL_SHADOW,
    RANGE_FILL_SHADOW,
    rectContains,
    rectOf,
    type GridRange,
    type GridRect,
} from './selection';
import { parseTsv, toTsv } from './tsv';
import { cellKey, useBatchCreateRecords, useBatchUpdateRecords } from './useBatchUpdate';

/**
 * v0.1.287 / v0.1.294 — La tabla como hoja de cálculo.
 *
 * Modelo (el de Excel, Google Sheets y Airtable): un click ELIGE la celda —
 * borde azul, el teclado queda en la tabla— y desde ahí se copia, corta,
 * pega, borra o se mueve con las flechas. Para EDITAR: segundo click sobre la
 * celda elegida, doble click, Enter / F2 o simplemente empezar a escribir (lo
 * tecleado reemplaza el valor). La casilla y las estrellas se tocan directo.
 * Antes un click abría el editor y todo lo de la hoja de cálculo quedaba
 * dentro del input (v0.1.287): copiar daba el valor crudo, en una selección no
 * copiaba nada y pegar un bloque de Excel no hacía nada.
 *
 * Rango: Shift+click, Shift+flechas, arrastrar, Ctrl+A. Portapapeles:
 * Ctrl/Cmd+C copia texto LEGIBLE (TSV + tabla HTML) y guarda el valor real
 * (portapapeles interno); Ctrl/Cmd+X corta (marca punteada; el origen se vacía
 * al pegar); Ctrl/Cmd+V pega con la conversión del import y, si algo no se
 * puede, muestra ANTES qué y por qué (también ofrece crear las filas que no
 * entran y las opciones que no existen). Rellenar (Ctrl+D y el asa) continúa
 * series. Supr vacía. Deshacer/rehacer sin pisar cambios ajenos. Todo con un
 * menú de click derecho.
 *
 * Lo comparten la tabla plana y cada grupo de la agrupada: la tabla dibuja
 * las celdas con `data-cell="fila:columna"` y aplica `cellShadows`/`cellMark`.
 */
export interface GridControllerArgs {
    /** El contenedor enfocable que envuelve las celdas (el scroller del cuerpo). */
    containerRef: RefObject<HTMLDivElement>;
    /** Las filas en el orden en que se ven (incluye las subtareas abiertas). */
    rows: RecordEntity[];
    /** Las columnas visibles en orden (sin la de la casilla). */
    columns: GridColumnRef[];
    listId: number;
    /** ¿Puede editar registros? (sin permiso, pegar/rellenar/borrar avisan). */
    canEdit: boolean;
    /** v0.1.294 — ¿puede crear registros? (pegar más filas de las que hay crea las que faltan). */
    canCreate?: boolean;
    /** v0.1.294 — hay registros que no están cargados debajo (otra página): pegar no crea filas. */
    hasMoreRows?: boolean;
    /** v0.1.294 — todos los campos de la lista (los obligatorios de una fila nueva). */
    allFields?: FieldEntity[];
    /** v0.1.294 — puede crear opciones de un select al pegar (`manage_fields`). */
    canManageFields?: boolean;
    /** Por qué una celda no se puede tocar (reglas de la tienda). */
    locked?: LockedReason;
    /** Títulos de los registros vinculados (para copiar una relación como texto). */
    relationTitles: ReadonlyMap<number, RelationTitles>;
    /** Enter en la primera columna abre el registro. */
    onOpenRow?: (record: RecordEntity) => void;
    /** Trae una fila a la ventana virtual cuando no está dibujada. */
    scrollToIndex?: (index: number) => void;
    /** Borde inferior (px de pantalla) de lo que tapa la tabla arriba. */
    headBottom?: () => number | null;
    /** Cuántas columnas quedan fijas a la izquierda. */
    frozenCount?: number;
    /** v0.1.294 — el nombre legible de un registro (para el detalle de lo que no se pudo). */
    recordTitle?: (record: RecordEntity) => string;
    /** v0.1.294 — por qué aquí no se crean filas al pegar (la vista agrupada). */
    noCreateReason?: string;
    /**
     * v0.1.295 — «Editar con un click» (ajuste de la vista): el primer click
     * abre el editor de la celda en vez de sólo elegirla, y un enlace se abre
     * con un click (el modelo de antes de v0.1.294).
     */
    singleClickEdit?: boolean;
}

/** La marca extra de una celda: corte (bordes punteados) o error del último pegado. */
export interface CellMark {
    cut?: { top: boolean; bottom: boolean; left: boolean; right: boolean };
    error?: string;
}

/** Lo que muestra el menú de click derecho sobre las celdas. */
export interface GridMenuActions {
    /** «Celda «Monto»» o «6 celdas». */
    summary: string;
    canEdit: boolean;
    /** Hay UNA celda elegida que se puede editar. */
    editable: boolean;
    multiRow: boolean;
    canUndo: boolean;
    canRedo: boolean;
    edit: () => void;
    copy: () => void;
    cut: () => void;
    paste: () => void;
    clear: () => void;
    fillDown: () => void;
    undo: () => void;
    redo: () => void;
    /** Al cerrarse el menú: el foco vuelve a la tabla (si no lo tomó un editor). */
    restoreFocus: () => void;
}

/** Revisión antes de pegar: lo que se va a hacer y lo que no se puede. */
export interface GridReview {
    inputs: PasteInputs;
    outcome: PasteOutcome;
    canCreateRows: boolean;
    hasMoreRows: boolean;
    /** Por qué no se pueden crear las filas que no entran (si no se puede). */
    noCreateReason: string;
    canCreateOptions: boolean;
    /** Nombre legible de cada fila con problemas. */
    rowLabel: (issue: CellIssue) => string;
}

export interface GridResult {
    title: string;
    issues: CellIssue[];
    rowLabel: (issue: CellIssue) => string;
}

export interface SelectionInfo {
    cells: number;
    rows: number;
    cols: number;
    /** Suma y promedio de las celdas numéricas del rango (como la barra de Sheets). */
    numeric: { count: number; sum: number; avg: number } | null;
}

export interface GridController {
    active: GridPos | null;
    rect: GridRect | null;
    focused: boolean;
    /** El almacén de edición: la tabla lo pone en contexto para sus celdas. */
    editStore: GridEditStore;
    containerProps: {
        tabIndex: 0;
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
        onFocus: (e: React.FocusEvent<HTMLDivElement>) => void;
        onBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
        onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
        onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => void;
        onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    };
    /** Sombras de una celda: bordes del rango, celda activa, vista previa y velo. */
    cellShadows: (row: number, col: number) => string[];
    cellMark: (row: number, col: number) => CellMark | null;
    /** ¿Esta celda lleva el asa de relleno? */
    hasFillHandle: (row: number, col: number) => boolean;
    onFillHandleMouseDown: (e: React.MouseEvent) => void;
    /** Click derecho: elige la celda (si no estaba en el rango). true = era una celda. */
    openContextMenu: (e: React.MouseEvent) => boolean;
    menu: GridMenuActions;
    review: GridReview | null;
    confirmReview: (opts: { createRows: boolean; createOptions: boolean }) => Promise<void>;
    cancelReview: () => void;
    result: GridResult | null;
    closeResult: () => void;
    selectionInfo: SelectionInfo | null;
    busy: boolean;
}

const SINGLE = (pos: GridPos): GridRange => ({ anchor: pos, focus: pos });
const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'duration', 'rating']);
/** Tipos que se editan con un selector o que no se escriben: Enter no "edita texto". */
const ERROR_MARK_MS = 12_000;

/** Lee `data-cell="fila:columna"`. */
function parseCell(el: Element | null): GridPos | null {
    const raw = el?.getAttribute('data-cell');
    if (!raw) return null;
    const [r, c] = raw.split(':').map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { row: r as number, col: c as number };
}

/** Atajo de teclado con la tecla de la plataforma (⌘ en Mac). */
export function shortcutLabel(key: string): string {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    return mac ? `⌘${key}` : `Ctrl+${key}`;
}

export function useGridController(args: GridControllerArgs): GridController {
    const { containerRef, rows, columns, listId, canEdit } = args;
    const qc = useQueryClient();
    const toast = useToast();
    const history = useGridHistory();
    const batch = useBatchUpdateRecords(listId);
    const batchCreate = useBatchCreateRecords(listId);

    const [range, setRange] = useState<GridRange | null>(null);
    const [focused, setFocused] = useState(false);
    // v0.1.295 — con el menú de click derecho abierto el foco está en el menú
    // (un portal), así que la tabla "pierde" el foco; la selección tiene que
    // seguir pintada: es justo sobre lo que va a actuar el menú.
    const [menuHold, setMenuHold] = useState(false);
    const [preview, setPreview] = useState<GridRect | null>(null);
    const [review, setReview] = useState<GridReview | null>(null);
    const [result, setResult] = useState<GridResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [errorCells, setErrorCells] = useState<ReadonlyMap<string, string>>(new Map());
    const busyRef = useRef(false);
    const suppressClickRef = useRef(false);
    /** Dónde empezó el último click y si esa celda YA estaba elegida (segundo click = editar). */
    const pressRef = useRef<{ pos: GridPos; wasActive: boolean } | null>(null);
    const [editStore] = useState(() => new GridEditStore());

    // Lo último de todo, para los listeners del documento (registrados una vez).
    const latest = useRef({ args, range, rows, columns, canEdit, focused });
    latest.current = { args, range, rows, columns, canEdit, focused };

    // Las marcas de corte cambian desde cualquier tabla (portapapeles compartido).
    const cutKeys = useSyncExternalStore(subscribeGridClip, getCutKeys);

    // Si cambian las filas o las columnas (filtro, orden, refresco), el rango
    // se recorta a lo que existe.
    const colCount = columns.length;
    const rowCount = rows.length;
    useEffect(() => {
        setRange((r) => clampRange(r, rowCount, colCount));
    }, [rowCount, colCount]);

    // Las marcas rojas de un pegado fallido se van solas.
    useEffect(() => {
        if (errorCells.size === 0) return;
        const t = window.setTimeout(() => setErrorCells(new Map()), ERROR_MARK_MS);
        return () => window.clearTimeout(t);
    }, [errorCells]);

    const active = range?.anchor ?? null;
    const rect = range ? rectOf(range) : null;

    const cellEl = useCallback(
        (pos: GridPos): HTMLElement | null =>
            containerRef.current?.querySelector<HTMLElement>(`td[data-cell="${pos.row}:${pos.col}"]`) ?? null,
        [containerRef],
    );

    const reveal = useCallback(
        (pos: GridPos, attempt = 0): void => {
            const td = cellEl(pos);
            if (!td) {
                if (attempt === 0) latest.current.args.scrollToIndex?.(pos.row);
                if (attempt < 3) requestAnimationFrame(() => reveal(pos, attempt + 1));
                return;
            }
            const main = document.getElementById(MAIN_SCROLLER_ID);
            const body = containerRef.current;
            const r = td.getBoundingClientRect();
            if (main) {
                // Debajo de la cabecera fija (página + columnas), no detrás.
                const headBottom = latest.current.args.headBottom?.() ?? main.getBoundingClientRect().top;
                const mainBottom = main.getBoundingClientRect().bottom;
                if (r.top < headBottom) main.scrollTop -= headBottom - r.top;
                else if (r.bottom > mainBottom) main.scrollTop += r.bottom - mainBottom;
            }
            if (body) {
                const b = body.getBoundingClientRect();
                const frozen = Math.max(1, latest.current.args.frozenCount ?? 1);
                const lastFrozen = body.querySelector<HTMLElement>(`td[data-cell="${pos.row}:${frozen - 1}"]`);
                const leftEdge = pos.col < frozen ? b.left : Math.max(b.left, lastFrozen?.getBoundingClientRect().right ?? b.left);
                if (r.left < leftEdge) body.scrollLeft -= leftEdge - r.left;
                else if (r.right > b.right) body.scrollLeft += r.right - b.right;
            }
        },
        [cellEl, containerRef],
    );

    const moveTo = useCallback(
        (next: GridRange): void => {
            setRange(next);
            requestAnimationFrame(() => reveal(next.focus));
        },
        [reveal],
    );

    const focusGrid = useCallback((): void => {
        containerRef.current?.focus({ preventScroll: true });
    }, [containerRef]);

    const rowLabel = useCallback((issue: CellIssue): string => {
        if (issue.newRow !== undefined) return sprintf(__('Fila nueva %d'), issue.newRow);
        const rec = issue.recordId != null ? latest.current.rows.find((r) => r.id === issue.recordId) : undefined;
        const title = rec ? latest.current.args.recordTitle?.(rec) : undefined;
        if (title) return title;
        return issue.row >= 0 ? sprintf(__('Fila %d'), issue.row + 1) : issue.recordId != null ? `#${issue.recordId}` : '—';
    }, []);

    // ---- Editar --------------------------------------------------------------
    /** Pide editar la celda (la abre la propia celda; ver `EditableCell`). */
    const startEdit = useCallback(
        (pos: GridPos, seed: string | null): void => {
            const { rows: rs, columns: cs, canEdit: allowed, args: a } = latest.current;
            const record = rs[pos.row];
            const field = cs[pos.col]?.field ?? null;
            if (!record) return;
            if (!field) return;
            if (field.type === 'file') {
                // Los archivos se suben en la ficha: Enter la abre.
                if (seed === null) a.onOpenRow?.(record);
                return;
            }
            const blocked = cellWriteBlock(field, record, 'fill', a.locked);
            if (blocked !== null) {
                if (seed === null) toast.info(sprintf(__('«%1$s»: %2$s'), field.label, blocked));
                return;
            }
            if (!allowed) {
                if (seed === null) toast.info(__('No tienes permiso para editar registros en esta lista'));
                return;
            }
            const key = gridCellKey(record.id, field.id);
            // Ya se está editando (p. ej. el doble click después del segundo click).
            if (seed === null && editStore.get()?.key === key) return;
            editStore.request(key, seed);
        },
        [editStore, toast],
    );

    // Cuando una celda termina de editar: el foco vuelve a la tabla y, con
    // Enter / Tab, la selección avanza (como en Excel).
    useEffect(() => {
        editStore.onEnd = (_key: string, reason: EditEndReason) => {
            const container = containerRef.current;
            if (!container) return;
            const { range: r, rows: rs, columns: cs } = latest.current;
            // El foco vuelve a la tabla salvo que la persona se haya ido a otra
            // parte de la página (click en el buscador, en otro panel…).
            requestAnimationFrame(() => {
                const now = document.activeElement;
                if (!now || now === document.body || container.contains(now)) container.focus({ preventScroll: true });
                else setFocused(false);
            });
            if (reason === 'blur') return;
            if (!r) return;
            if (reason === 'enter') {
                const next = moveActiveCell(r.anchor, 'ArrowDown', false, rs.length, cs.length);
                if (next) moveTo(SINGLE(next));
            } else if (reason === 'tab' || reason === 'shift-tab') {
                const next = moveActiveCell(r.anchor, 'Tab', reason === 'shift-tab', rs.length, cs.length);
                if (next) moveTo(SINGLE(next));
            }
        };
        return () => {
            editStore.onEnd = null;
        };
    }, [editStore, containerRef, moveTo]);

    // ---- Texto legible para copiar ----------------------------------------
    const textContext = useCallback(
        (): CellTextContext => ({
            userName: (id) => {
                const u = qc.getQueryData<WpUserSummary | null>(['wp-user', id]);
                return u ? u.display_name || u.login : null;
            },
            relationTitle: (fieldId, id) => latest.current.args.relationTitles.get(fieldId)?.[id] ?? null,
            fileName: (id) => qc.getQueryData<ResolvedAttachment | null>(['imcrm', 'attachment', id])?.title ?? null,
            teamName: (id) => qc.getQueryData<Team[]>(teamsKeys.list())?.find((t) => t.id === id)?.name ?? null,
        }),
        [qc],
    );

    /** El rango como texto (matriz) + el valor real de cada celda. */
    const copyMatrix = useCallback(
        (r: GridRect): { matrix: string[][]; cells: ClipCell[][] } => {
            const { rows: rs, columns: cs } = latest.current;
            const ctx = textContext();
            const matrix: string[][] = [];
            const cells: ClipCell[][] = [];
            for (let row = r.top; row <= r.bottom; row++) {
                const record = rs[row];
                if (!record) continue;
                const line: string[] = [];
                const raw: ClipCell[] = [];
                for (let col = r.left; col <= r.right; col++) {
                    const column = cs[col];
                    if (!column) continue;
                    let text = '';
                    let value: unknown = null;
                    if (column.field) {
                        value = cellValue(record, column.field);
                        text = cellToText(column.field, value, ctx);
                    } else if (column.id === 'id') {
                        text = String(record.id);
                    } else if (column.id === 'updated_at') {
                        text = record.updated_at ? formatDateTimeStr(record.updated_at) : '';
                    }
                    line.push(text);
                    raw.push({ recordId: record.id, fieldId: column.field?.id ?? null, fieldType: column.field?.type ?? null, value, text });
                }
                matrix.push(line);
                cells.push(raw);
            }
            return { matrix, cells };
        },
        [textContext],
    );

    // Los nombres de las personas del rango se traen apenas se selecciona
    // (en UNA request), así al copiar ya están: el evento de copiar es
    // síncrono y no puede esperar a la red.
    useEffect(() => {
        if (!focused || !rect) return;
        const ids = new Set<number>();
        for (let col = rect.left; col <= rect.right; col++) {
            const f = columns[col]?.field;
            if (!f || f.type !== 'user') continue;
            for (let row = rect.top; row <= rect.bottom && ids.size < 100; row++) {
                const v = rows[row] ? cellValue(rows[row]!, f) : null;
                const id = typeof v === 'number' ? v : Number(v);
                if (Number.isInteger(id) && id > 0 && qc.getQueryData(['wp-user', id]) === undefined) ids.add(id);
            }
        }
        if (ids.size === 0) return;
        let cancelled = false;
        void api
            .get<WpUserSummary[]>('/me/users', { query: { ids: [...ids].join(',') } })
            .then((res) => {
                if (cancelled) return;
                for (const u of res.data) qc.setQueryData(['wp-user', u.id], u);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focused, rect?.top, rect?.bottom, rect?.left, rect?.right, rows, columns, qc]);

    /** Prepara lo copiado (o cortado): texto, HTML y el portapapeles interno. */
    const buildClip = useCallback(
        (r: GridRect, cut: boolean): { text: string; html: string; count: number } => {
            const { matrix, cells } = copyMatrix(r);
            const text = toTsv(matrix);
            setGridClip({ listId: latest.current.args.listId, text, cells, cut });
            return { text, html: toHtmlTable(matrix), count: matrix.reduce((n, l) => n + l.length, 0) };
        },
        [copyMatrix],
    );

    const announceCopy = useCallback(
        (count: number, cut: boolean): void => {
            if (cut) {
                toast.show({
                    title: sprintf(_n('Cortaste %d celda', 'Cortaste %d celdas', count), count),
                    description: sprintf(__('Elige dónde moverlas y pega con %s. Esc cancela.'), shortcutLabel('V')),
                    variant: 'info',
                    duration: 4000,
                });
            } else {
                toast.show({
                    title: sprintf(_n('Copiaste %d celda', 'Copiaste %d celdas', count), count),
                    description: sprintf(__('Pégalas aquí o en Excel / Google Sheets con %s.'), shortcutLabel('V')),
                    variant: 'info',
                    duration: 2500,
                });
            }
        },
        [toast],
    );

    // ---- Escribir un plan ---------------------------------------------------
    /**
     * Manda los cambios (y las filas nuevas) en una llamada, los deja como UN
     * paso de deshacer y avisa: éxito con «Deshacer», o lo que no se pudo con
     * «Ver detalle» y las celdas marcadas en rojo.
     */
    const applyChanges = useCallback(
        async (
            kind: 'paste' | 'fill' | 'clear' | 'cut',
            changes: CellChange[],
            knownIssues: CellIssue[],
            newRows: Array<{ index: number; data: Record<string, unknown> }> = [],
        ): Promise<boolean> => {
            const { canEdit: allowed } = latest.current;
            if (changes.length > 0 && !allowed) {
                toast.error(__('No tienes permiso para editar registros en esta lista'));
                return false;
            }
            if (busyRef.current) return false;
            busyRef.current = true;
            setBusy(true);
            let outcome = { updated: [] as unknown[], failed: [] as Array<{ id: number; code: string; message: string }>, cell_errors: [] as Array<{ id: number; key: string; message: string }>, written: new Map<string, unknown>() };
            let created: HistoryCreatedRow[] = [];
            const createIssues: CellIssue[] = [];
            try {
                if (changes.length > 0) {
                    outcome = await batch.mutateAsync({
                        cells: changes.map((c) => ({ recordId: c.recordId, field: c.field, value: c.after })),
                    });
                }
                if (newRows.length > 0) {
                    const res = await batchCreate.mutateAsync(newRows.map((r) => r.data));
                    created = res.created.map((c) => {
                        const written = newRows[c.index]?.data ?? {};
                        const data: Record<string, unknown> = {};
                        for (const k of Object.keys(written)) data[k] = c.record.data[k] ?? c.record.relations?.[k] ?? written[k] ?? null;
                        return { id: c.record.id, data };
                    });
                    for (const f of res.failed) {
                        const reasons = f.errors ? Object.values(f.errors).join(' · ') : f.message;
                        createIssues.push({ row: -1, col: 0, label: __('Fila nueva'), reason: reasons, recordId: null, newRow: newRows[f.index]?.index ?? f.index + 1 });
                    }
                }
            } catch (err) {
                toast.error(__('No se pudieron guardar los cambios'), err instanceof Error ? err.message : undefined);
                return false;
            } finally {
                busyRef.current = false;
                setBusy(false);
            }
            const applied = changes.filter((c) => outcome.written.has(cellKey(c.recordId, c.field.id)));
            if ((applied.length > 0 || created.length > 0) && history) {
                history.record({
                    label: applied.length === 1 && created.length === 0 ? editLabel(applied[0]!.field) : bulkLabel(kind, applied.length, created.length),
                    cells: applied.map((c) => ({
                        recordId: c.recordId,
                        field: c.field,
                        before: c.before,
                        after: outcome.written.get(cellKey(c.recordId, c.field.id)),
                    })),
                    ...(created.length > 0 ? { created } : {}),
                });
            }
            // Lo que no se pudo: lo del plan + filas que el servidor rechazó +
            // celdas con un valor que no pasó la validación + altas fallidas.
            const failedRows = new Map(outcome.failed.map((f) => [f.id, f.message]));
            const serverIssues: CellIssue[] = changes
                .filter((c) => !outcome.written.has(cellKey(c.recordId, c.field.id)))
                .map((c) => ({
                    row: c.row,
                    col: c.col,
                    label: c.field.label,
                    recordId: c.recordId,
                    reason:
                        failedRows.get(c.recordId)
                        ?? outcome.cell_errors.find((e) => e.id === c.recordId && e.key === `f${c.field.id}`)?.message
                        ?? __('No se pudo guardar'),
                }));
            const allIssues = [...knownIssues, ...serverIssues, ...createIssues];
            // Marcas rojas sobre las celdas que fallaron (las visibles).
            const marks = new Map<string, string>();
            for (const c of changes) {
                if (outcome.written.has(cellKey(c.recordId, c.field.id))) continue;
                const why = serverIssues.find((i) => i.recordId === c.recordId && i.label === c.field.label)?.reason;
                if (why) marks.set(cellKey(c.recordId, c.field.id), why);
            }
            for (const i of knownIssues) {
                const f = i.col >= 0 ? latest.current.columns[i.col]?.field : null;
                if (f && i.recordId != null) marks.set(cellKey(i.recordId, f.id), i.reason);
            }
            setErrorCells(marks);

            const n = applied.length;
            const done =
                kind === 'paste' || kind === 'cut'
                    ? sprintf(_n('Se pegó %d celda', 'Se pegaron %d celdas', n), n)
                    : kind === 'fill'
                        ? sprintf(_n('Se rellenó %d celda', 'Se rellenaron %d celdas', n), n)
                        : sprintf(_n('Se borró %d celda', 'Se borraron %d celdas', n), n);
            const withRows = created.length > 0
                ? `${n > 0 ? done : ''}${n > 0 ? ' · ' : ''}${sprintf(_n('se creó %d registro', 'se crearon %d registros', created.length), created.length)}`
                : done;
            const undo = history ? { label: __('Deshacer'), onClick: () => void history.undo() } : undefined;
            if (allIssues.length > 0) {
                const title = n > 0 || created.length > 0
                    ? `${withRows} · ${sprintf(_n('%d no se pudo', '%d no se pudieron', allIssues.length), allIssues.length)}`
                    : sprintf(_n('No se pudo cambiar %d celda', 'No se pudieron cambiar %d celdas', allIssues.length), allIssues.length);
                setResult(null);
                toast.show({
                    title,
                    description: summarizeIssues(allIssues, 2).join(' · '),
                    variant: 'warning',
                    duration: 10_000,
                    action: {
                        label: __('Ver detalle'),
                        onClick: () => setResult({ title, issues: allIssues, rowLabel }),
                    },
                });
            } else if (n > 0 || created.length > 0) {
                toast.show({ title: withRows, variant: 'success', ...(undo ? { action: undo } : {}) });
            }
            return n > 0 || created.length > 0;
        },
        [batch, batchCreate, history, rowLabel, toast],
    );

    /** Rellenar / borrar: sin revisión previa (se ve lo que se tocó y se deshace). */
    const applySimple = useCallback(
        async (kind: 'fill' | 'clear', plan: GridPlan): Promise<void> => {
            if (plan.changes.length === 0) {
                if (plan.issues.length > 0) {
                    const title = sprintf(_n('No se pudo cambiar %d celda', 'No se pudieron cambiar %d celdas', plan.issues.length), plan.issues.length);
                    toast.show({
                        title,
                        description: summarizeIssues(plan.issues, 2).join(' · '),
                        variant: 'warning',
                        duration: 8000,
                        action: { label: __('Ver detalle'), onClick: () => setResult({ title, issues: plan.issues, rowLabel }) },
                    });
                } else {
                    toast.info(__('No hubo cambios: las celdas ya tenían esos valores'));
                }
                return;
            }
            await applyChanges(kind, plan.changes, plan.issues);
        },
        [applyChanges, rowLabel, toast],
    );

    // ---- Pegar ---------------------------------------------------------------
    const applyPasteOutcome = useCallback(
        async (inputs: PasteInputs, outcome: PasteOutcome, createRows: boolean): Promise<void> => {
            const { rows: rs, columns: cs } = latest.current;
            const isCut = Boolean(inputs.clip?.cut) && outcome.cutClears.length > 0;
            const issues = [...outcome.plan.issues, ...outcome.cutIssues, ...(createRows ? outcome.newRowIssues : [])];
            const changes = [...outcome.plan.changes, ...outcome.cutClears];
            const newRows = createRows ? outcome.newRows : [];
            if (changes.length === 0 && newRows.length === 0) {
                if (issues.length === 0) toast.info(__('No hubo cambios: las celdas ya tenían esos valores'));
                else {
                    const title = sprintf(_n('No se pudo pegar %d celda', 'No se pudieron pegar %d celdas', issues.length), issues.length);
                    toast.show({
                        title,
                        description: summarizeIssues(issues, 2).join(' · '),
                        variant: 'warning',
                        duration: 8000,
                        action: { label: __('Ver detalle'), onClick: () => setResult({ title, issues, rowLabel }) },
                    });
                }
                return;
            }
            const ok = await applyChanges(isCut ? 'cut' : 'paste', changes, issues, newRows);
            if (inputs.clip?.cut) clearCut();
            if (ok) {
                const width = Math.max(1, ...inputs.block.map((b) => b.length));
                const single = inputs.block.length === 1 && width === 1;
                if (!single) {
                    const bottom = Math.min(rs.length - 1, inputs.target.top + inputs.block.length - 1);
                    const right = Math.min(cs.length - 1, inputs.target.left + width - 1);
                    setRange({ anchor: { row: inputs.target.top, col: inputs.target.left }, focus: { row: bottom, col: right } });
                }
            }
        },
        [applyChanges, rowLabel, toast],
    );

    const pasteText = useCallback(
        async (text: string): Promise<void> => {
            const { range: r, columns: cs, canEdit: allowed, args: a } = latest.current;
            if (!r) return;
            if (!allowed && !(a.canCreate ?? false)) {
                toast.error(__('No tienes permiso para editar registros en esta lista'));
                return;
            }
            const block = parseTsv(text);
            if (block.length === 0) return;
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            let inputs: PasteInputs;
            try {
                inputs = await preparePaste({ text, block, target: rectOf(r), columns: cs, clip: clipForText(text) });
            } finally {
                busyRef.current = false;
                setBusy(false);
            }
            const now = latest.current;
            const outcome = computePaste(inputs, {
                rows: now.rows,
                columns: now.columns,
                allFields: now.args.allFields ?? now.columns.flatMap((c) => (c.field ? [c.field] : [])),
                listId: now.args.listId,
                locked: now.args.locked,
            });
            const canCreateRows = (now.args.canCreate ?? false) && !(now.args.hasMoreRows ?? false);
            if (pasteNeedsReview(outcome)) {
                setReview({
                    inputs,
                    outcome,
                    canCreateRows,
                    hasMoreRows: now.args.hasMoreRows ?? false,
                    noCreateReason: now.args.hasMoreRows
                        ? __('debajo hay registros de la página siguiente. Ve a la última página para agregar filas nuevas, o pega por partes.')
                        : now.args.noCreateReason ?? __('no hay más filas debajo y no tienes permiso para crear registros.'),
                    canCreateOptions: now.args.canManageFields ?? false,
                    rowLabel,
                });
                return;
            }
            await applyPasteOutcome(inputs, outcome, false);
        },
        [applyPasteOutcome, rowLabel, toast],
    );

    const cancelReview = useCallback((): void => {
        setReview(null);
        requestAnimationFrame(focusGrid);
    }, [focusGrid]);

    const confirmReview = useCallback(
        async (opts: { createRows: boolean; createOptions: boolean }): Promise<void> => {
            const rv = review;
            if (!rv) return;
            let { outcome } = rv;
            const { inputs } = rv;
            if (opts.createOptions && rv.canCreateOptions && outcome.plan.unknownOptions.length > 0) {
                // Se crean las opciones que faltan y se vuelve a planear con el
                // campo ampliado (el mismo criterio que el import).
                const patched = new Map<number, FieldEntity>();
                try {
                    for (const u of outcome.plan.unknownOptions) {
                        let field = u.field;
                        for (const label of u.labels) {
                            const res = await api.post<FieldEntity>(`/lists/${listId}/fields/${field.id}/options`, { value: label, label });
                            field = { ...field, config: res.data.config };
                        }
                        patched.set(field.id, field);
                    }
                } catch (err) {
                    toast.error(__('No se pudieron crear las opciones'), err instanceof Error ? err.message : undefined);
                    return;
                }
                const now = latest.current;
                const columnsPatched = now.columns.map((c) => (c.field && patched.has(c.field.id) ? { ...c, field: patched.get(c.field.id)! } : c));
                outcome = computePaste(inputs, {
                    rows: now.rows,
                    columns: columnsPatched,
                    allFields: (now.args.allFields ?? []).map((f) => patched.get(f.id) ?? f),
                    listId: now.args.listId,
                    locked: now.args.locked,
                });
                void qc.invalidateQueries({ queryKey: ['fields'] });
            }
            setReview(null);
            await applyPasteOutcome(inputs, outcome, opts.createRows && rv.canCreateRows);
            requestAnimationFrame(focusGrid);
        },
        [applyPasteOutcome, focusGrid, listId, qc, review, toast],
    );

    // ---- Rellenar -------------------------------------------------------------
    const fillRange = useCallback(
        (sourceTop: number, sourceBottom: number, targetTop: number, targetBottom: number, left: number, right: number): void => {
            const { rows: rs, columns: cs, args: a, canEdit: allowed } = latest.current;
            if (targetBottom < targetTop) return;
            if (!allowed) {
                toast.error(__('No tienes permiso para editar registros en esta lista'));
                return;
            }
            const plan = planFill({ rows: rs, columns: cs, left, right, sourceTop, sourceBottom, targetTop, targetBottom, locked: a.locked });
            void applySimple('fill', plan);
        },
        [applySimple, toast],
    );

    /** Ctrl/Cmd+D: la primera fila del rango hacia las de abajo (sin rango, la de arriba). */
    const fillDown = useCallback((): void => {
        const r = latest.current.range;
        if (!r) return;
        const rr = rectOf(r);
        if (rr.bottom > rr.top) fillRange(rr.top, rr.top, rr.top + 1, rr.bottom, rr.left, rr.right);
        else if (rr.top > 0) fillRange(rr.top - 1, rr.top - 1, rr.top, rr.top, rr.left, rr.right);
        else toast.info(__('Para rellenar hacia abajo, elige varias filas: la primera se copia en las demás'));
    }, [fillRange, toast]);

    const clearRange = useCallback((): void => {
        const { range: r, rows: rs, columns: cs, args: a, canEdit: allowed } = latest.current;
        if (!r) return;
        if (!allowed) {
            toast.error(__('No tienes permiso para editar registros en esta lista'));
            return;
        }
        void applySimple('clear', planClear({ rows: rs, columns: cs, rect: rectOf(r), locked: a.locked }));
    }, [applySimple, toast]);

    // ---- Copiar / cortar / pegar con el portapapeles del sistema ---------------
    const copyHandledRef = useRef(false);
    const pasteHandledRef = useRef(false);
    const gridHasFocus = useCallback((): boolean => {
        const c = containerRef.current;
        const el = document.activeElement;
        return Boolean(c && el && c.contains(el) && !isTypingTarget(el));
    }, [containerRef]);

    useEffect(() => {
        const onCopyOrCut = (e: ClipboardEvent): void => {
            const r = latest.current.range;
            if (!r || !gridHasFocus()) return;
            const rr = rectOf(r);
            // Texto elegido a mano dentro de UNA celda: se copia lo elegido.
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.toString().trim() !== '' && rr.top === rr.bottom && rr.left === rr.right) return;
            const wantsCut = e.type === 'cut';
            const cut = wantsCut && latest.current.canEdit;
            copyHandledRef.current = true;
            const { text, html, count } = buildClip(rr, cut);
            e.clipboardData?.setData('text/plain', text);
            e.clipboardData?.setData('text/html', html);
            e.preventDefault();
            if (wantsCut && !cut) toast.info(__('No tienes permiso para editar: se copió en vez de cortar'));
            else announceCopy(count, cut);
        };
        const onPaste = (e: ClipboardEvent): void => {
            if (!latest.current.range || !gridHasFocus()) return;
            pasteHandledRef.current = true;
            const text = e.clipboardData?.getData('text/plain') ?? '';
            e.preventDefault();
            if (text !== '') void pasteText(text);
            else toast.info(__('El portapapeles no tiene texto para pegar'));
        };
        document.addEventListener('copy', onCopyOrCut);
        document.addEventListener('cut', onCopyOrCut);
        document.addEventListener('paste', onPaste);
        return () => {
            document.removeEventListener('copy', onCopyOrCut);
            document.removeEventListener('cut', onCopyOrCut);
            document.removeEventListener('paste', onPaste);
        };
    }, [announceCopy, buildClip, gridHasFocus, pasteText, toast]);

    /** Copiar / cortar desde el menú: la API del portapapeles (texto + HTML). */
    const copyViaMenu = useCallback(
        async (cut: boolean): Promise<void> => {
            const r = latest.current.range;
            if (!r) return;
            const allowedCut = cut && latest.current.canEdit;
            const { text, html, count } = buildClip(rectOf(r), allowedCut);
            try {
                if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            'text/plain': new Blob([text], { type: 'text/plain' }),
                            'text/html': new Blob([html], { type: 'text/html' }),
                        }),
                    ]);
                } else {
                    await navigator.clipboard.writeText(text);
                }
                announceCopy(count, allowedCut);
            } catch {
                // Sin permiso del navegador: igual quedó en el portapapeles de la
                // tabla (se puede pegar aquí mismo con el menú).
                toast.show({
                    title: allowedCut ? __('Cortado para pegar en esta tabla') : __('Copiado para pegar en esta tabla'),
                    description: sprintf(__('El navegador no dejó usar el portapapeles: para llevarlo a otro programa usa %s.'), shortcutLabel(allowedCut ? 'X' : 'C')),
                    variant: 'info',
                });
            }
            focusGrid();
        },
        [announceCopy, buildClip, focusGrid, toast],
    );

    const pasteViaMenu = useCallback(async (): Promise<void> => {
        let text: string | null = null;
        try {
            text = (await navigator.clipboard?.readText?.()) ?? null;
        } catch {
            text = null;
        }
        if (text === null || text === '') {
            const clip = getGridClip();
            if (clip) {
                text = clip.text;
            } else {
                toast.show({
                    title: __('No se pudo leer el portapapeles'),
                    description: sprintf(__('El navegador no dejó leerlo desde el menú: pega con %s.'), shortcutLabel('V')),
                    variant: 'info',
                });
                focusGrid();
                return;
            }
        }
        focusGrid();
        await pasteText(text);
    }, [focusGrid, pasteText, toast]);

    // ---- Mouse: rango, segundo click y asa de relleno --------------------------
    const cellAt = useCallback(
        (x: number, y: number): GridPos | null => {
            const td = document.elementFromPoint(x, y)?.closest('td[data-cell]') ?? null;
            if (!td || !containerRef.current?.contains(td)) return null;
            return parseCell(td);
        },
        [containerRef],
    );

    const endGesture = (moved: boolean): void => {
        document.body.classList.remove('imcrm-grid-selecting');
        if (moved) {
            suppressClickRef.current = true;
            // Si el gesto terminó afuera no habrá click que suprimir.
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
        }
    };

    const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        // Los eventos de un popover (portal) burbujean por el árbol de React:
        // sólo cuenta lo que está DENTRO de la tabla.
        if (!e.currentTarget.contains(target)) return;
        if (target.closest('[data-fill-handle]')) return;
        if (isTypingTarget(target)) return;
        const td = target.closest('td[data-cell]');
        if (!td || !e.currentTarget.contains(td)) return;
        const pos = parseCell(td);
        if (!pos) return;
        const cur = latest.current.range;
        const wasActive = latest.current.focused
            && cur !== null
            && cur.anchor.row === pos.row
            && cur.anchor.col === pos.col
            && cur.focus.row === pos.row
            && cur.focus.col === pos.col;
        pressRef.current = { pos, wasActive };
        if (e.shiftKey && cur) {
            // Shift+click: extiende el rango desde la celda activa.
            e.preventDefault();
            setRange({ anchor: cur.anchor, focus: pos });
            suppressClickRef.current = true;
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
            e.currentTarget.focus({ preventScroll: true });
            return;
        }
        if (!wasActive) setRange(SINGLE(pos));
        // Los controles directos (casilla, estrellas) se llevan su propio foco;
        // el resto de la celda deja el foco en la tabla.
        if (!target.closest('input, button, a, [role="button"]')) {
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
        }
        // Arrastrar: el rango sigue al mouse mientras el botón siga apretado.
        let moved = false;
        const onMove = (ev: MouseEvent): void => {
            if ((ev.buttons & 1) === 0) return;
            const over = cellAt(ev.clientX, ev.clientY);
            if (!over) return;
            if (!moved && (over.row !== pos.row || over.col !== pos.col)) {
                moved = true;
                document.body.classList.add('imcrm-grid-selecting');
                window.getSelection()?.removeAllRanges();
                containerRef.current?.focus({ preventScroll: true });
            }
            if (moved) setRange({ anchor: pos, focus: over });
        };
        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp, true);
            endGesture(moved);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp, true);
    };

    const onClickCapture = (e: React.MouseEvent<HTMLDivElement>): void => {
        const target = e.target as HTMLElement;
        if (!e.currentTarget.contains(target)) return;
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.stopPropagation();
            e.preventDefault();
            return;
        }
        const press = pressRef.current;
        pressRef.current = null;
        const td = target.closest('td[data-cell]');
        const pos = td ? parseCell(td) : null;
        if (!press || !pos || press.pos.row !== pos.row || press.pos.col !== pos.col) return;
        if (e.shiftKey) return;
        // Un enlace (url, archivo) en una celda que no estaba elegida: el
        // primer click la elige; el segundo (o Ctrl/⌘+click) abre el enlace.
        const link = target.closest('a[href]');
        if (link) {
            // Con «Editar con un click» el enlace se abre con un click, como antes.
            if (latest.current.args.singleClickEdit) return;
            if (!press.wasActive && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        // Controles directos: la casilla se marca y las estrellas se ponen con un click.
        if (target.closest('input[type="checkbox"], button')) return;
        // La primera columna abre el registro (su propio onClick).
        if (pos.col === 0 && latest.current.args.onOpenRow) return;
        if (press.wasActive || latest.current.args.singleClickEdit) startEdit(pos, null);
    };

    const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
        const target = e.target as HTMLElement;
        if (!e.currentTarget.contains(target)) return;
        if (isTypingTarget(target) || target.closest('a[href], input[type="checkbox"], button')) return;
        const td = target.closest('td[data-cell]');
        const pos = td ? parseCell(td) : null;
        if (!pos) return;
        if (pos.col === 0 && latest.current.args.onOpenRow) return;
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        startEdit(pos, null);
    };

    const onFillHandleMouseDown = (e: React.MouseEvent): void => {
        if (e.button !== 0 || !range) return;
        e.preventDefault();
        e.stopPropagation();
        const source = rectOf(range);
        let to = source.bottom;
        document.body.classList.add('imcrm-grid-selecting');
        const onMove = (ev: MouseEvent): void => {
            const over = cellAt(ev.clientX, ev.clientY);
            if (!over) return;
            to = Math.max(source.bottom, over.row);
            setPreview(to > source.bottom ? { top: source.bottom + 1, bottom: to, left: source.left, right: source.right } : null);
        };
        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp, true);
            endGesture(true);
            setPreview(null);
            if (to > source.bottom) {
                fillRange(source.top, source.bottom, source.bottom + 1, to, source.left, source.right);
                setRange({ anchor: { row: source.top, col: source.left }, focus: { row: to, col: source.right } });
            }
            containerRef.current?.focus({ preventScroll: true });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp, true);
    };

    const openContextMenu = (e: React.MouseEvent): boolean => {
        const target = e.target as HTMLElement;
        const container = containerRef.current;
        if (!container || !container.contains(target)) return false;
        const td = target.closest('td[data-cell]');
        const pos = td ? parseCell(td) : null;
        if (!pos) return false;
        const cur = latest.current.range;
        if (!cur || !rectContains(rectOf(cur), pos.row, pos.col)) setRange(SINGLE(pos));
        container.focus({ preventScroll: true });
        setMenuHold(true);
        return true;
    };

    // ---- Teclado ------------------------------------------------------------
    const copyByKeyboard = (cut: boolean): void => {
        if (!range) return;
        // El evento `copy`/`cut` del navegador escribe el portapapeles; si no
        // llega (nada enfocado que el navegador considere copiable), se
        // escribe con la API del portapapeles.
        copyHandledRef.current = false;
        const rr = rectOf(range);
        window.setTimeout(() => {
            if (copyHandledRef.current) return;
            const allowedCut = cut && latest.current.canEdit;
            const { text, count } = buildClip(rr, allowedCut);
            void navigator.clipboard?.writeText(text).catch(() => undefined);
            announceCopy(count, allowedCut);
        }, 0);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        const container = e.currentTarget;
        // Las teclas de un popover (portal) burbujean por el árbol de React:
        // no son de la tabla.
        if (!container.contains(e.target as Node)) return;
        // Dentro de un editor las teclas escriben (y su Ctrl+Z es el del editor).
        if (isTypingTarget(e.target)) return;
        const onContainer = e.target === container;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (mod && !e.altKey) {
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                void history?.undo();
                return;
            }
            if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.metaKey)) {
                e.preventDefault();
                void history?.redo();
                return;
            }
            if (key === 'd') {
                e.preventDefault();
                fillDown();
                return;
            }
            if (key === 'a' && rowCount > 0 && colCount > 0) {
                e.preventDefault();
                setRange({ anchor: { row: 0, col: 0 }, focus: { row: rowCount - 1, col: colCount - 1 } });
                return;
            }
            if (key === 'c' && range) {
                copyByKeyboard(false);
                return;
            }
            if (key === 'x' && range) {
                copyByKeyboard(true);
                return;
            }
            if (key === 'v' && range) {
                pasteHandledRef.current = false;
                window.setTimeout(() => {
                    if (pasteHandledRef.current) return;
                    void navigator.clipboard
                        ?.readText()
                        .then((text) => {
                            if (text) void pasteText(text);
                        })
                        .catch(() => toast.info(__('Para pegar, permite el acceso al portapapeles o usa el menú del navegador')));
                }, 50);
                return;
            }
            return;
        }
        if (e.altKey) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && range) {
            e.preventDefault();
            clearRange();
            return;
        }
        if ((e.key === 'Enter' || e.key === 'F2') && active) {
            e.preventDefault();
            const record = rows[active.row];
            if (e.key === 'Enter' && active.col === 0 && args.onOpenRow && record) {
                args.onOpenRow(record);
                return;
            }
            if (!onContainer) container.focus({ preventScroll: true });
            startEdit(active, null);
            return;
        }
        if (e.key === 'Escape') {
            if (getCutKeys().size > 0) {
                clearCut();
                return;
            }
            if (range && (range.anchor.row !== range.focus.row || range.anchor.col !== range.focus.col)) {
                setRange(SINGLE(range.anchor));
            } else if (onContainer) {
                setRange(null);
            }
            return;
        }
        if (e.shiftKey && e.key !== 'Tab' && range) {
            const nextFocus = extendFocus(range.focus, e.key, rowCount, colCount);
            if (nextFocus) {
                e.preventDefault();
                if (!onContainer) container.focus({ preventScroll: true });
                moveTo({ anchor: range.anchor, focus: nextFocus });
                return;
            }
        }
        const next = moveActiveCell(active, e.key, e.shiftKey, rowCount, colCount);
        if (next !== undefined) {
            e.preventDefault();
            if (!onContainer) container.focus({ preventScroll: true });
            moveTo(SINGLE(next));
            return;
        }
        // Empezar a escribir edita la celda (lo tecleado reemplaza el valor).
        if (active && (e.key.length === 1 || e.key === 'Dead')) {
            const field = columns[active.col]?.field;
            const record = rows[active.row];
            if (!field || !record) return;
            if (e.key !== 'Dead') e.preventDefault();
            // El editor de esta celda ya se está abriendo: la tecla se suma.
            if (e.key !== 'Dead' && editStore.appendSeed(gridCellKey(record.id, field.id), e.key)) return;
            startEdit(active, e.key === 'Dead' ? '' : e.key);
        }
    };

    const onFocus = (e: React.FocusEvent<HTMLDivElement>): void => {
        setFocused(true);
        // Con Tab desde afuera, la primera celda; con un click, la clickeada
        // (el mousedown ya la eligió: actualización funcional, no el render viejo).
        if (e.target === e.currentTarget && rowCount > 0) setRange((r) => r ?? SINGLE({ row: 0, col: 0 }));
    };
    const onBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        // Un editor de la tabla abierto (popover en un portal) sigue siendo "la tabla".
        if (editStore.isEditing()) return;
        setFocused(false);
    };

    // ---- Dibujo ---------------------------------------------------------------
    const keyAt = (row: number, col: number): string | null => {
        const rec = rows[row];
        const f = columns[col]?.field;
        return rec && f ? `${rec.id}:${f.id}` : null;
    };
    const showSelection = focused || menuHold || preview !== null || editStore.isEditing() || review !== null;
    const cellShadows = (row: number, col: number): string[] => {
        if (!showSelection) return [];
        // Una celda cortada lleva SÓLO el borde punteado (el sólido de la
        // selección, debajo, lo tapaba y el corte no se notaba).
        const k = keyAt(row, col);
        const cut = k !== null && cutKeys.has(k);
        const out = [...(cut ? [] : cellSelectionShadows(rect, active, row, col)), ...fillPreviewShadows(preview, row, col)];
        if (isRangeFill(rect, active, row, col)) out.push(RANGE_FILL_SHADOW);
        else if (preview && rectContains(preview, row, col)) out.push(PREVIEW_FILL_SHADOW);
        return out;
    };
    const hasFillHandle = (row: number, col: number): boolean =>
        showSelection && canEdit && rect !== null && rect.bottom === row && rect.right === col && !editStore.isEditing();

    const cellMark = (row: number, col: number): CellMark | null => {
        const k = keyAt(row, col);
        if (k === null) return null;
        const error = errorCells.get(k);
        let cut: CellMark['cut'];
        if (cutKeys.has(k)) {
            const isCut = (r: number, c: number): boolean => {
                const kk = keyAt(r, c);
                return kk !== null && cutKeys.has(kk);
            };
            cut = { top: !isCut(row - 1, col), bottom: !isCut(row + 1, col), left: !isCut(row, col - 1), right: !isCut(row, col + 1) };
        }
        return error || cut ? { ...(error ? { error } : {}), ...(cut ? { cut } : {}) } : null;
    };

    // ---- Menú y barra de selección ------------------------------------------
    // Se arma en cada render (barato): deshacer/rehacer cambian sin re-render.
    const menu = ((): GridMenuActions => {
        const rr = rect;
        const cells = rr ? (rr.bottom - rr.top + 1) * (rr.right - rr.left + 1) : 0;
        const single = cells === 1 && active !== null;
        const field = single ? columns[active!.col]?.field ?? null : null;
        const record = single ? rows[active!.row] : undefined;
        const editable = Boolean(
            single && field && record && canEdit && cellWriteBlock(field, record, 'fill', args.locked) === null && field.type !== 'file',
        );
        return {
            summary: single
                ? field
                    ? sprintf(__('Celda «%s»'), field.label)
                    : __('Celda')
                : sprintf(_n('%d celda', '%d celdas', cells), cells),
            canEdit,
            editable,
            multiRow: rr !== null && rr.bottom > rr.top,
            canUndo: history?.canUndo() ?? false,
            canRedo: history?.canRedo() ?? false,
            edit: () => {
                if (active) startEdit(active, null);
            },
            copy: () => void copyViaMenu(false),
            cut: () => void copyViaMenu(true),
            paste: () => void pasteViaMenu(),
            clear: () => {
                clearRange();
                focusGrid();
            },
            fillDown: () => {
                fillDown();
                focusGrid();
            },
            undo: () => void history?.undo(),
            redo: () => void history?.redo(),
            restoreFocus: () =>
                requestAnimationFrame(() => {
                    const el = document.activeElement;
                    if (!el || el === document.body) focusGrid();
                    setMenuHold(false);
                }),
        };
    })();

    const selectionInfo = useMemo<SelectionInfo | null>(() => {
        if (!(focused || menuHold) || !rect) return null;
        const nRows = rect.bottom - rect.top + 1;
        const nCols = rect.right - rect.left + 1;
        if (nRows * nCols < 2) return null;
        let count = 0;
        let sum = 0;
        for (let col = rect.left; col <= rect.right; col++) {
            const f = columns[col]?.field;
            if (!f || !NUMERIC_TYPES.has(f.type)) continue;
            for (let row = rect.top; row <= rect.bottom; row++) {
                const v = rows[row] ? cellValue(rows[row]!, f) : null;
                if (typeof v === 'number' && Number.isFinite(v)) {
                    count++;
                    sum += v;
                }
            }
        }
        return {
            cells: nRows * nCols,
            rows: nRows,
            cols: nCols,
            numeric: count > 0 ? { count, sum, avg: sum / count } : null,
        };
    }, [focused, menuHold, rect?.top, rect?.bottom, rect?.left, rect?.right, rows, columns]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        active: showSelection ? active : null,
        rect: showSelection ? rect : null,
        focused,
        editStore,
        containerProps: { tabIndex: 0, onKeyDown, onFocus, onBlur, onMouseDown, onClickCapture, onDoubleClick },
        cellShadows,
        cellMark,
        hasFillHandle,
        onFillHandleMouseDown,
        openContextMenu,
        menu,
        review,
        confirmReview,
        cancelReview,
        result,
        closeResult: () => setResult(null),
        selectionInfo,
        busy,
    };
}

/** Número para la barra de selección (con el formato de la empresa). */
export function formatSelectionNumber(n: number): string {
    return formatNumber(n, { maxFrac: 2 });
}
