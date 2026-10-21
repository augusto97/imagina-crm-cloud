import type { GridPos } from '../views/gridKeyboard';

/**
 * v0.1.287 — Rango de celdas de la tabla (como en Excel/Sheets): la celda
 * donde empezó (`anchor`, la activa) y la del otro extremo (`focus`). Puro:
 * la tabla sólo aplica el resultado.
 */
export interface GridRange {
    anchor: GridPos;
    focus: GridPos;
}

/** El rectángulo normalizado de un rango (inclusive). */
export interface GridRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export function rectOf(range: GridRange): GridRect {
    return {
        top: Math.min(range.anchor.row, range.focus.row),
        bottom: Math.max(range.anchor.row, range.focus.row),
        left: Math.min(range.anchor.col, range.focus.col),
        right: Math.max(range.anchor.col, range.focus.col),
    };
}

export function rectContains(rect: GridRect, row: number, col: number): boolean {
    return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

export function rectSize(rect: GridRect): { rows: number; cols: number } {
    return { rows: rect.bottom - rect.top + 1, cols: rect.right - rect.left + 1 };
}

/** ¿El rango abarca más de una celda? */
export function isMultiCell(range: GridRange | null): boolean {
    if (!range) return false;
    return range.anchor.row !== range.focus.row || range.anchor.col !== range.focus.col;
}

/** Recorta un rango a la grilla actual (cambió el filtro, se borraron filas…). */
export function clampRange(range: GridRange | null, rowCount: number, colCount: number): GridRange | null {
    if (!range || rowCount <= 0 || colCount <= 0) return null;
    const clamp = (p: GridPos): GridPos => ({
        row: Math.min(rowCount - 1, Math.max(0, p.row)),
        col: Math.min(colCount - 1, Math.max(0, p.col)),
    });
    const anchor = clamp(range.anchor);
    const focus = clamp(range.focus);
    if (anchor.row === range.anchor.row && anchor.col === range.anchor.col && focus.row === range.focus.row && focus.col === range.focus.col) {
        return range;
    }
    return { anchor, focus };
}

const SEL = 'hsl(var(--imcrm-primary))';

/**
 * El borde del rango dibujado celda por celda (con `box-shadow` inset: no
 * cambia el tamaño de la celda ni depende de qué filas estén dibujadas, así
 * funciona con la tabla virtualizada). La celda activa lleva su recuadro
 * completo; el resto del rango, sólo los lados que son borde del rectángulo.
 */
export function cellSelectionShadows(
    rect: GridRect | null,
    active: GridPos | null,
    row: number,
    col: number,
): string[] {
    const out: string[] = [];
    if (rect && rectContains(rect, row, col) && (rect.top !== rect.bottom || rect.left !== rect.right)) {
        if (col === rect.left) out.push(`inset 2px 0 0 ${SEL}`);
        if (col === rect.right) out.push(`inset -2px 0 0 ${SEL}`);
        if (row === rect.top) out.push(`inset 0 2px 0 ${SEL}`);
        if (row === rect.bottom) out.push(`inset 0 -2px 0 ${SEL}`);
    }
    if (active && active.row === row && active.col === col) out.push(`inset 0 0 0 2px ${SEL}`);
    return out;
}

/** El fondo de una celda seleccionada (no activa) dentro de un rango de varias. */
export function isRangeFill(rect: GridRect | null, active: GridPos | null, row: number, col: number): boolean {
    if (!rect || (rect.top === rect.bottom && rect.left === rect.right)) return false;
    if (active && active.row === row && active.col === col) return false;
    return rectContains(rect, row, col);
}

/** Shift+flecha: mueve el extremo del rango (el ancla queda fija). */
export function extendFocus(focus: GridPos, key: string, rowCount: number, colCount: number): GridPos | null {
    const clampRow = (r: number): number => Math.min(rowCount - 1, Math.max(0, r));
    const clampCol = (c: number): number => Math.min(colCount - 1, Math.max(0, c));
    switch (key) {
        case 'ArrowDown':
            return { row: clampRow(focus.row + 1), col: focus.col };
        case 'ArrowUp':
            return { row: clampRow(focus.row - 1), col: focus.col };
        case 'ArrowRight':
            return { row: focus.row, col: clampCol(focus.col + 1) };
        case 'ArrowLeft':
            return { row: focus.row, col: clampCol(focus.col - 1) };
        case 'Home':
            return { row: focus.row, col: 0 };
        case 'End':
            return { row: focus.row, col: colCount - 1 };
        case 'PageDown':
            return { row: clampRow(focus.row + 10), col: focus.col };
        case 'PageUp':
            return { row: clampRow(focus.row - 10), col: focus.col };
        default:
            return null;
    }
}

/**
 * Vista previa del relleno (mientras se arrastra el asa): las celdas que se
 * van a escribir llevan un borde suave alrededor del bloque y un velo leve,
 * para que se vea hasta dónde llega antes de soltar.
 */
export function fillPreviewShadows(preview: GridRect | null, row: number, col: number): string[] {
    if (!preview || !rectContains(preview, row, col)) return [];
    const line = 'hsl(var(--imcrm-primary) / 0.55)';
    const out: string[] = [];
    if (col === preview.left) out.push(`inset 1px 0 0 ${line}`);
    if (col === preview.right) out.push(`inset -1px 0 0 ${line}`);
    if (row === preview.bottom) out.push(`inset 0 -1px 0 ${line}`);
    return out;
}

/** El velo de las celdas seleccionadas (va al FINAL de las sombras: debajo de los bordes). */
export const RANGE_FILL_SHADOW = 'inset 0 0 0 9999px hsl(var(--imcrm-primary) / 0.08)';
export const PREVIEW_FILL_SHADOW = 'inset 0 0 0 9999px hsl(var(--imcrm-primary) / 0.04)';
