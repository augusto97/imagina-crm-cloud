import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildMemberLookup } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import type { ResolvedAttachment } from '@/hooks/useAttachments';
import type { RelationTitles } from '@/hooks/useRelationTitles';
import type { WpUserSummary } from '@/hooks/useWpUsers';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { browserTimeZone, formatDateTimeStr, getTenantFormat } from '@/lib/tenantFormat';
import type { RecordEntity } from '@/types/record';

import { isTypingTarget, moveActiveCell, type GridPos } from '../views/gridKeyboard';
import { MAIN_SCROLLER_ID } from '../views/stickyTop';
import { cellToText, type CellTextContext } from './cellText';
import { bulkLabel, editLabel, useGridHistory } from './history';
import {
    cellValue,
    planClear,
    planFill,
    planPaste,
    summarizeIssues,
    type GridColumnRef,
    type GridPlan,
    type LockedReason,
} from './gridPlan';
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
import { cellKey, useBatchUpdateRecords } from './useBatchUpdate';

/**
 * v0.1.287 — La tabla como hoja de cálculo: celda activa, rango (click +
 * Shift+click, Shift+flechas, arrastrar con el mouse), copiar (Ctrl/Cmd+C,
 * texto LEGIBLE en TSV), pegar un bloque desde Excel/Sheets (Ctrl/Cmd+V),
 * rellenar hacia abajo (Ctrl/Cmd+D y el asa de la esquina), borrar (Supr) y
 * deshacer/rehacer (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y).
 *
 * Lo comparten la tabla plana y cada grupo de la agrupada: la tabla dibuja
 * las celdas con `data-cell="fila:columna"` dentro del contenedor y aplica
 * las sombras que devuelve `cellShadows`. Todo lo que escribe va en UNA
 * llamada (`PATCH …/records/batch`) y queda como un paso de deshacer.
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
}

export interface GridController {
    active: GridPos | null;
    rect: GridRect | null;
    focused: boolean;
    containerProps: {
        tabIndex: 0;
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
        onFocus: (e: React.FocusEvent<HTMLDivElement>) => void;
        onBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
        onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
        onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => void;
    };
    /** Sombras de una celda: bordes del rango, celda activa, vista previa y velo. */
    cellShadows: (row: number, col: number) => string[];
    /** ¿Esta celda lleva el asa de relleno? */
    hasFillHandle: (row: number, col: number) => boolean;
    onFillHandleMouseDown: (e: React.MouseEvent) => void;
}

const SINGLE = (pos: GridPos): GridRange => ({ anchor: pos, focus: pos });

/** Lee `data-cell="fila:columna"`. */
function parseCell(el: Element | null): GridPos | null {
    const raw = el?.getAttribute('data-cell');
    if (!raw) return null;
    const [r, c] = raw.split(':').map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { row: r as number, col: c as number };
}

export function useGridController(args: GridControllerArgs): GridController {
    const { containerRef, rows, columns, listId, canEdit } = args;
    const qc = useQueryClient();
    const toast = useToast();
    const history = useGridHistory();
    const batch = useBatchUpdateRecords(listId);

    const [range, setRange] = useState<GridRange | null>(null);
    const [focused, setFocused] = useState(false);
    const [preview, setPreview] = useState<GridRect | null>(null);
    const busyRef = useRef(false);
    const suppressClickRef = useRef(false);

    // Lo último de todo, para los listeners del documento (registrados una vez).
    const latest = useRef({ args, range, rows, columns, canEdit });
    latest.current = { args, range, rows, columns, canEdit };

    // Si cambian las filas o las columnas (filtro, orden, refresco), el rango
    // se recorta a lo que existe.
    const colCount = columns.length;
    const rowCount = rows.length;
    useEffect(() => {
        setRange((r) => clampRange(r, rowCount, colCount));
    }, [rowCount, colCount]);

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

    // ---- Texto legible para copiar ----------------------------------------
    const textContext = useCallback(
        (): CellTextContext => ({
            userName: (id) => {
                const u = qc.getQueryData<WpUserSummary | null>(['wp-user', id]);
                return u ? u.display_name || u.login : null;
            },
            relationTitle: (fieldId, id) => latest.current.args.relationTitles.get(fieldId)?.[id] ?? null,
            fileName: (id) => qc.getQueryData<ResolvedAttachment | null>(['imcrm', 'attachment', id])?.title ?? null,
        }),
        [qc],
    );

    const copyText = useCallback(
        (r: GridRect): string => {
            const { rows: rs, columns: cs } = latest.current;
            const ctx = textContext();
            const matrix: string[][] = [];
            for (let row = r.top; row <= r.bottom; row++) {
                const record = rs[row];
                if (!record) continue;
                const line: string[] = [];
                for (let col = r.left; col <= r.right; col++) {
                    const column = cs[col];
                    if (!column) continue;
                    if (column.field) line.push(cellToText(column.field, cellValue(record, column.field), ctx));
                    else if (column.id === 'id') line.push(String(record.id));
                    else if (column.id === 'updated_at') line.push(record.updated_at ? formatDateTimeStr(record.updated_at) : '');
                    else line.push('');
                }
                matrix.push(line);
            }
            return toTsv(matrix);
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

    // ---- Escribir un plan ---------------------------------------------------
    const applyPlan = useCallback(
        async (kind: 'paste' | 'fill' | 'clear', plan: GridPlan): Promise<boolean> => {
            const { canEdit: allowed } = latest.current;
            const truncated: string[] = [];
            if (plan.truncatedRows > 0) {
                truncated.push(
                    sprintf(
                        _n(
                            '%d fila del bloque no entró: no hay más filas cargadas',
                            '%d filas del bloque no entraron: no hay más filas cargadas',
                            plan.truncatedRows,
                        ),
                        plan.truncatedRows,
                    ),
                );
            }
            if (plan.truncatedCols > 0) {
                truncated.push(
                    sprintf(
                        _n('%d columna del bloque no entró', '%d columnas del bloque no entraron', plan.truncatedCols),
                        plan.truncatedCols,
                    ),
                );
            }
            if (plan.changes.length === 0) {
                const why = summarizeIssues(plan.issues);
                if (plan.issues.length > 0) {
                    toast.warning(
                        sprintf(_n('No se pudo cambiar %d celda', 'No se pudieron cambiar %d celdas', plan.issues.length), plan.issues.length),
                        [...why, ...truncated].join(' · '),
                    );
                } else if (truncated.length > 0) {
                    toast.warning(__('No se cambió nada'), truncated.join(' · '));
                } else {
                    toast.info(__('No hubo cambios: las celdas ya tenían esos valores'));
                }
                return false;
            }
            if (!allowed) {
                toast.error(__('No tienes permiso para editar registros en esta lista'));
                return false;
            }
            if (busyRef.current) return false;
            busyRef.current = true;
            let outcome;
            try {
                outcome = await batch.mutateAsync({
                    cells: plan.changes.map((c) => ({ recordId: c.recordId, field: c.field, value: c.after })),
                });
            } catch (err) {
                toast.error(__('No se pudieron guardar los cambios'), err instanceof Error ? err.message : undefined);
                return false;
            } finally {
                busyRef.current = false;
            }
            const applied = plan.changes.filter((c) => outcome.written.has(cellKey(c.recordId, c.field.id)));
            if (applied.length > 0 && history) {
                history.record({
                    label: applied.length === 1 ? editLabel(applied[0]!.field) : bulkLabel(kind, applied.length),
                    cells: applied.map((c) => ({
                        recordId: c.recordId,
                        field: c.field,
                        before: c.before,
                        after: outcome.written.get(cellKey(c.recordId, c.field.id)),
                    })),
                });
            }
            // Lo que no se pudo: lo del plan + filas que el servidor rechazó +
            // celdas con un valor que no pasó la validación.
            const failedRows = new Map(outcome.failed.map((f) => [f.id, f.message]));
            const failedCells = plan.changes.filter((c) => !outcome.written.has(cellKey(c.recordId, c.field.id)));
            const serverIssues = failedCells.map((c) => ({
                row: c.row,
                col: c.col,
                label: c.field.label,
                reason:
                    failedRows.get(c.recordId)
                    ?? outcome.cell_errors.find((e) => e.id === c.recordId && e.key === `f${c.field.id}`)?.message
                    ?? __('No se pudo guardar'),
            }));
            const allIssues = [...plan.issues, ...serverIssues];
            const done =
                kind === 'paste'
                    ? sprintf(_n('Se pegó %d celda', 'Se pegaron %d celdas', applied.length), applied.length)
                    : kind === 'fill'
                        ? sprintf(_n('Se rellenó %d celda', 'Se rellenaron %d celdas', applied.length), applied.length)
                        : sprintf(_n('Se borró %d celda', 'Se borraron %d celdas', applied.length), applied.length);
            const undo = history ? { label: __('Deshacer'), onClick: () => void history.undo() } : undefined;
            if (allIssues.length > 0 || truncated.length > 0) {
                const notDone = allIssues.length > 0
                    ? sprintf(_n('%d no se pudo', '%d no se pudieron', allIssues.length), allIssues.length)
                    : '';
                toast.show({
                    title: notDone ? `${done} · ${notDone}` : done,
                    description: [...summarizeIssues(allIssues), ...truncated].join(' · '),
                    variant: 'warning',
                    duration: 9000,
                    ...(undo && applied.length > 0 ? { action: undo } : {}),
                });
            } else {
                toast.show({ title: done, variant: 'success', ...(undo ? { action: undo } : {}) });
            }
            return true;
        },
        [batch, history, toast],
    );

    // ---- Pegar ---------------------------------------------------------------
    const pasteText = useCallback(
        async (text: string): Promise<void> => {
            const { range: r, rows: rs, columns: cs, args: a } = latest.current;
            if (!r) return;
            const block = parseTsv(text);
            if (block.length === 0) return;
            const target = rectOf(r);
            // Personas por nombre o email: se buscan entre los miembros (una
            // búsqueda por texto distinto, con tope).
            const userTexts = new Set<string>();
            const width = Math.max(...block.map((b) => b.length));
            const single = block.length === 1 && width === 1;
            for (let dc = 0; dc < (single ? target.right - target.left + 1 : width); dc++) {
                const f = cs[target.left + dc]?.field;
                if (!f || f.type !== 'user') continue;
                for (const line of block) {
                    const t = (single ? block[0]![0]! : line[dc] ?? '').trim();
                    if (t !== '' && !/^\d+$/.test(t)) userTexts.add(t);
                }
            }
            let members: Map<string, number> | undefined;
            if (userTexts.size > 0) {
                const found = new Map<number, { id: number; name: string; email: string }>();
                await Promise.all(
                    [...userTexts].slice(0, 30).map(async (q) => {
                        try {
                            const res = await api.get<WpUserSummary[]>('/me/users-search', { query: { q, limit: 5 } });
                            for (const u of res.data) found.set(u.id, { id: u.id, name: u.display_name, email: u.login });
                        } catch {
                            // Sin resultados: la celda queda como "persona no encontrada".
                        }
                    }),
                );
                members = buildMemberLookup([...found.values()]);
            }
            const fmt = getTenantFormat();
            const plan = planPaste({
                block,
                target,
                rows: rs,
                columns: cs,
                coercion: {
                    members,
                    numberFormat: fmt.number_format,
                    dateFormat: fmt.date_format,
                    // Una fecha y hora se lee en el reloj de quien pega (el mismo
                    // en que la tabla la muestra).
                    timeZone: browserTimeZone() ?? undefined,
                    strictBoolean: true,
                },
                locked: a.locked,
            });
            const ok = await applyPlan('paste', plan);
            if (ok && !single) {
                const bottom = Math.min(rs.length - 1, target.top + block.length - 1);
                const right = Math.min(cs.length - 1, target.left + width - 1);
                setRange({ anchor: { row: target.top, col: target.left }, focus: { row: bottom, col: right } });
            }
        },
        [applyPlan],
    );

    // ---- Rellenar -------------------------------------------------------------
    const fillRange = useCallback(
        (sourceTop: number, sourceBottom: number, targetTop: number, targetBottom: number, left: number, right: number): void => {
            const { rows: rs, columns: cs, args: a } = latest.current;
            if (targetBottom < targetTop) return;
            const plan = planFill({ rows: rs, columns: cs, left, right, sourceTop, sourceBottom, targetTop, targetBottom, locked: a.locked });
            void applyPlan('fill', plan);
        },
        [applyPlan],
    );

    /** Ctrl/Cmd+D: la primera fila del rango hacia las de abajo (sin rango, la de arriba). */
    const fillDown = useCallback((): void => {
        const r = latest.current.range;
        if (!r) return;
        const rr = rectOf(r);
        if (rr.bottom > rr.top) fillRange(rr.top, rr.top, rr.top + 1, rr.bottom, rr.left, rr.right);
        else if (rr.top > 0) fillRange(rr.top - 1, rr.top - 1, rr.top, rr.top, rr.left, rr.right);
    }, [fillRange]);

    const clearRange = useCallback((): void => {
        const { range: r, rows: rs, columns: cs, args: a } = latest.current;
        if (!r) return;
        void applyPlan('clear', planClear({ rows: rs, columns: cs, rect: rectOf(r), locked: a.locked }));
    }, [applyPlan]);

    // ---- Copiar / pegar con el portapapeles del sistema -----------------------
    const copyHandledRef = useRef(false);
    const pasteHandledRef = useRef(false);
    const gridHasFocus = useCallback((): boolean => {
        const c = containerRef.current;
        const el = document.activeElement;
        return Boolean(c && el && c.contains(el) && !isTypingTarget(el));
    }, [containerRef]);

    useEffect(() => {
        const onCopy = (e: ClipboardEvent): void => {
            const r = latest.current.range;
            if (!r || !gridHasFocus()) return;
            // Texto elegido a mano dentro de UNA celda: se copia lo elegido.
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.toString().trim() !== '' && rectOf(r).top === rectOf(r).bottom && rectOf(r).left === rectOf(r).right) return;
            copyHandledRef.current = true;
            e.clipboardData?.setData('text/plain', copyText(rectOf(r)));
            e.preventDefault();
        };
        const onPaste = (e: ClipboardEvent): void => {
            if (!latest.current.range || !gridHasFocus()) return;
            pasteHandledRef.current = true;
            const text = e.clipboardData?.getData('text/plain') ?? '';
            e.preventDefault();
            if (text !== '') void pasteText(text);
        };
        document.addEventListener('copy', onCopy);
        document.addEventListener('paste', onPaste);
        return () => {
            document.removeEventListener('copy', onCopy);
            document.removeEventListener('paste', onPaste);
        };
    }, [copyText, gridHasFocus, pasteText]);

    // ---- Mouse: rango y asa de relleno ----------------------------------------
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
        if (target.closest('[data-fill-handle]')) return;
        if (isTypingTarget(target)) return;
        const td = target.closest('td[data-cell]');
        if (!td || !e.currentTarget.contains(td)) return;
        const pos = parseCell(td);
        if (!pos) return;
        if (e.shiftKey && range) {
            // Shift+click: extiende el rango desde la celda activa.
            e.preventDefault();
            setRange({ anchor: range.anchor, focus: pos });
            suppressClickRef.current = true;
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
            e.currentTarget.focus({ preventScroll: true });
            return;
        }
        setRange(SINGLE(pos));
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

    const onClickCapture = (e: React.MouseEvent<HTMLDivElement>): void => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        e.stopPropagation();
        e.preventDefault();
    };

    // ---- Teclado ------------------------------------------------------------
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        const container = e.currentTarget;
        const onContainer = e.target === container;
        // Al terminar de editar (Enter/Escape/Tab dentro del editor) el editor
        // se desmonta y el foco quedaba en el <body>: vuelve a la tabla.
        if (!onContainer && (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab')) {
            requestAnimationFrame(() => {
                const a = document.activeElement;
                if (!a || a === document.body) container.focus({ preventScroll: true });
            });
        }
        // Dentro de un editor las teclas escriben (y su Ctrl+Z es el del editor).
        if (isTypingTarget(e.target)) return;
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
                // El evento `copy` del navegador escribe el portapapeles; si no
                // llega (nada enfocado que el navegador considere copiable),
                // se escribe con la API del portapapeles.
                copyHandledRef.current = false;
                const text = copyText(rectOf(range));
                window.setTimeout(() => {
                    if (!copyHandledRef.current) void navigator.clipboard?.writeText(text).catch(() => undefined);
                }, 0);
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
        if (!onContainer && (e.key === 'Enter' || e.key === ' ')) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && range) {
            e.preventDefault();
            clearRange();
            return;
        }
        if (onContainer && (e.key === 'Enter' || e.key === 'F2') && active) {
            e.preventDefault();
            const record = rows[active.row];
            if (active.col === 0 && args.onOpenRow && record) {
                args.onOpenRow(record);
                return;
            }
            const trigger = cellEl(active)?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [role="button"]');
            trigger?.click();
            return;
        }
        if (e.key === 'Escape') {
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
        if (next === undefined) return;
        e.preventDefault();
        if (!onContainer) container.focus({ preventScroll: true });
        moveTo(SINGLE(next));
    };

    const onFocus = (e: React.FocusEvent<HTMLDivElement>): void => {
        setFocused(true);
        if (e.target === e.currentTarget && range === null && rowCount > 0) setRange(SINGLE({ row: 0, col: 0 }));
    };
    const onBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setFocused(false);
    };

    // ---- Dibujo ---------------------------------------------------------------
    const showSelection = focused || preview !== null;
    const cellShadows = (row: number, col: number): string[] => {
        if (!showSelection) return [];
        const out = [...cellSelectionShadows(rect, active, row, col), ...fillPreviewShadows(preview, row, col)];
        if (isRangeFill(rect, active, row, col)) out.push(RANGE_FILL_SHADOW);
        else if (preview && rectContains(preview, row, col)) out.push(PREVIEW_FILL_SHADOW);
        return out;
    };
    const hasFillHandle = (row: number, col: number): boolean =>
        showSelection && canEdit && rect !== null && rect.bottom === row && rect.right === col;

    return {
        active: showSelection ? active : null,
        rect: showSelection ? rect : null,
        focused,
        containerProps: { tabIndex: 0, onKeyDown, onFocus, onBlur, onMouseDown, onClickCapture },
        cellShadows,
        hasFillHandle,
        onFillHandleMouseDown,
    };
}
