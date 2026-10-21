import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useToast } from '@/components/ui/toast';
import { __, _n, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { cellKey, useBatchUpdateRecords, type BatchUpdateOutcome } from './useBatchUpdate';

/**
 * v0.1.287 — Deshacer / rehacer de la tabla (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z y
 * Ctrl+Y con el foco en la tabla). Guarda las ediciones del PROPIO usuario en
 * esta sesión: una edición de celda, un pegado, un relleno o un borrado son
 * UN paso cada uno (hasta 50).
 *
 * Deshacer nunca pisa el cambio de otra persona: cada fila viaja con el valor
 * que se cree vigente (`expect`) y, si alguien la cambió después, el servidor
 * no la toca y se avisa. Vive en la página de la lista (la comparten la tabla
 * plana y la agrupada) y se vacía al cambiar de lista.
 */
export interface HistoryCell {
    recordId: number;
    field: FieldEntity;
    before: unknown;
    after: unknown;
}

export interface HistoryEntry {
    /** Cómo se nombra en el aviso: «el cambio en «Estado»», «el pegado (18 celdas)». */
    label: string;
    cells: HistoryCell[];
}

interface GridHistoryValue {
    record: (entry: HistoryEntry) => void;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
}

const GridHistoryContext = createContext<GridHistoryValue | null>(null);

/** Null fuera de una página de lista (la ficha, un modal): ahí no hay deshacer. */
export function useGridHistory(): GridHistoryValue | null {
    return useContext(GridHistoryContext);
}

const MAX_STEPS = 50;

/** El nombre de un paso de edición de UNA celda. */
export function editLabel(field: FieldEntity): string {
    return sprintf(__('el cambio en «%s»'), field.label);
}

/** El nombre de un paso de varias celdas («el pegado (18 celdas)»). */
export function bulkLabel(kind: 'paste' | 'fill' | 'clear', count: number): string {
    const what = kind === 'paste' ? __('el pegado') : kind === 'fill' ? __('el relleno') : __('el borrado');
    return `${what} (${sprintf(_n('%d celda', '%d celdas', count), count)})`;
}

export function GridHistoryProvider({ listId, children }: { listId: number; children: ReactNode }): JSX.Element {
    const toast = useToast();
    const batch = useBatchUpdateRecords(listId);
    // El valor del contexto es ESTABLE (lo leen todas las celdas de la tabla:
    // si cambiara en cada render, se re-dibujarían todas): la mutación y los
    // avisos se leen por ref.
    const mutateRef = useRef(batch.mutateAsync);
    mutateRef.current = batch.mutateAsync;
    const toastRef = useRef(toast);
    toastRef.current = toast;
    const undoRef = useRef<HistoryEntry[]>([]);
    const redoRef = useRef<HistoryEntry[]>([]);
    const busyRef = useRef(false);

    // Cambiar de lista vacía el historial: las ediciones son de ESTA lista.
    useEffect(() => {
        undoRef.current = [];
        redoRef.current = [];
    }, [listId]);

    const record = useCallback((entry: HistoryEntry): void => {
        if (entry.cells.length === 0) return;
        undoRef.current = [...undoRef.current, entry].slice(-MAX_STEPS);
        redoRef.current = [];
    }, []);

    const run = useCallback(
        async (direction: 'undo' | 'redo'): Promise<void> => {
            const toast = toastRef.current;
            if (busyRef.current) return;
            const from = direction === 'undo' ? undoRef : redoRef;
            const to = direction === 'undo' ? redoRef : undoRef;
            const entry = from.current[from.current.length - 1];
            if (!entry) {
                toast.info(direction === 'undo' ? __('No hay nada para deshacer') : __('No hay nada para rehacer'));
                return;
            }
            busyRef.current = true;
            from.current = from.current.slice(0, -1);
            let outcome: BatchUpdateOutcome;
            try {
                outcome = await mutateRef.current({
                    cells: entry.cells.map((c) => ({ recordId: c.recordId, field: c.field, value: direction === 'undo' ? c.before : c.after })),
                    expect: entry.cells.map((c) => ({ recordId: c.recordId, field: c.field, value: direction === 'undo' ? c.after : c.before })),
                });
            } catch (err) {
                // No se pudo ni intentar: el paso vuelve a su pila.
                from.current = [...from.current, entry];
                busyRef.current = false;
                toast.error(direction === 'undo' ? __('No se pudo deshacer') : __('No se pudo rehacer'), err instanceof Error ? err.message : undefined);
                return;
            }
            busyRef.current = false;
            // Lo que se aplicó pasa a la otra pila con el valor que QUEDÓ en el servidor.
            const applied = entry.cells
                .filter((c) => outcome.written.has(cellKey(c.recordId, c.field.id)))
                .map((c): HistoryCell => {
                    const now = outcome.written.get(cellKey(c.recordId, c.field.id));
                    return direction === 'undo' ? { ...c, before: now } : { ...c, after: now };
                });
            if (applied.length > 0) {
                to.current = [...to.current, { label: entry.label, cells: applied }].slice(-MAX_STEPS);
            }
            const conflicts = outcome.failed.filter((f) => f.code === 'record_changed');
            const otherFailures = outcome.failed.length - conflicts.length + outcome.cell_errors.length;
            if (applied.length > 0) {
                const opposite = direction === 'undo' ? 'redo' : 'undo';
                toast.show({
                    title: direction === 'undo'
                        ? sprintf(__('Se deshizo %s'), entry.label)
                        : sprintf(__('Se rehízo %s'), entry.label),
                    variant: 'success',
                    action: { label: opposite === 'redo' ? __('Rehacer') : __('Deshacer'), onClick: () => void run(opposite) },
                });
            }
            if (conflicts.length > 0) {
                toast.warning(
                    sprintf(
                        _n(
                            'No se tocó %d fila: alguien la cambió después',
                            'No se tocaron %d filas: alguien las cambió después',
                            conflicts.length,
                        ),
                        conflicts.length,
                    ),
                    conflicts.slice(0, 2).map((c) => c.message).join(' · '),
                );
            }
            if (otherFailures > 0) {
                toast.error(
                    direction === 'undo' ? __('Parte del cambio no se pudo deshacer') : __('Parte del cambio no se pudo rehacer'),
                    [...outcome.failed.filter((f) => f.code !== 'record_changed').map((f) => f.message), ...outcome.cell_errors.map((e) => e.message)]
                        .slice(0, 2)
                        .join(' · '),
                );
            }
        },
        [],
    );

    const value = useMemo<GridHistoryValue>(
        () => ({ record, undo: () => run('undo'), redo: () => run('redo') }),
        [record, run],
    );

    return <GridHistoryContext.Provider value={value}>{children}</GridHistoryContext.Provider>;
}
