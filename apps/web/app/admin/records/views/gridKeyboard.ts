/**
 * v0.1.286 — navegación con teclado en la tabla plana (como una hoja de
 * cálculo): las flechas mueven la celda activa, Tab / Shift+Tab avanzan y
 * retroceden (saltando de fila), Inicio / Fin van al borde de la fila, Enter
 * edita y Escape suelta. Puro: la tabla sólo aplica el resultado.
 */

export interface GridPos {
    row: number;
    col: number;
}

/**
 * Próxima celda activa para una tecla, o `undefined` si la tecla no es de
 * navegación (o no hay a dónde ir: Tab en la última celda deja salir el foco).
 */
export function moveActiveCell(
    pos: GridPos | null,
    key: string,
    shiftKey: boolean,
    rowCount: number,
    colCount: number,
): GridPos | undefined {
    if (rowCount <= 0 || colCount <= 0) return undefined;
    const clampRow = (r: number): number => Math.min(rowCount - 1, Math.max(0, r));
    const clampCol = (c: number): number => Math.min(colCount - 1, Math.max(0, c));
    const nav = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End', 'PageDown', 'PageUp'];
    if (!nav.includes(key)) return undefined;
    if (pos === null) return key === 'Tab' && shiftKey ? undefined : { row: 0, col: 0 };
    const cur = { row: clampRow(pos.row), col: clampCol(pos.col) };
    switch (key) {
        case 'ArrowDown':
            return { row: clampRow(cur.row + 1), col: cur.col };
        case 'ArrowUp':
            return { row: clampRow(cur.row - 1), col: cur.col };
        case 'ArrowRight':
            return { row: cur.row, col: clampCol(cur.col + 1) };
        case 'ArrowLeft':
            return { row: cur.row, col: clampCol(cur.col - 1) };
        case 'Home':
            return { row: cur.row, col: 0 };
        case 'End':
            return { row: cur.row, col: colCount - 1 };
        case 'PageDown':
            return { row: clampRow(cur.row + 10), col: cur.col };
        case 'PageUp':
            return { row: clampRow(cur.row - 10), col: cur.col };
        case 'Tab': {
            if (shiftKey) {
                if (cur.col > 0) return { row: cur.row, col: cur.col - 1 };
                return cur.row > 0 ? { row: cur.row - 1, col: colCount - 1 } : undefined;
            }
            if (cur.col < colCount - 1) return { row: cur.row, col: cur.col + 1 };
            return cur.row < rowCount - 1 ? { row: cur.row + 1, col: 0 } : undefined;
        }
        default:
            return undefined;
    }
}

/** ¿El foco está en algo donde las teclas se TIPEAN (y no navegan)? */
export function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    if (el instanceof HTMLInputElement) return el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button';
    return false;
}
