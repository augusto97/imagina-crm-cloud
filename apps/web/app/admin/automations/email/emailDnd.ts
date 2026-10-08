import type { EmailDesign } from '@imagina-base/shared';

import { canDrop, findBlock, isInnerType, isNoopDrop, type DragSource, type DropTarget } from './emailDesignOps';

/**
 * v0.1.270 — Dónde cae un bloque arrastrado sobre la vista previa del correo.
 *
 * PURO: recibe las cajas (en coordenadas del documento de la vista previa) de
 * los bloques de primer nivel y de cada columna, y la posición del puntero.
 * Devuelve el destino (primer nivel o una columna, ANTES de qué índice) y la
 * línea que se dibuja para mostrarlo. La misma regla en el lienzo y en tests.
 */
export interface Box {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export interface DropGeometry {
    /** La hoja del correo (para el ancho de la línea en el primer nivel). */
    sheet: Box;
    /** Bloques de primer nivel, en orden. */
    top: Array<{ id: string; box: Box }>;
    /** Cada columna con sus bloques, en orden. */
    columns: Array<{ parentId: string; columnIndex: number; box: Box; blocks: Array<{ id: string; box: Box }> }>;
}

export interface DropResolution {
    target: DropTarget;
    /** Línea indicadora: arriba, izquierda y ancho. */
    line: { top: number; left: number; width: number };
}

const inside = (b: Box, x: number, y: number): boolean => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
const mid = (b: Box): number => (b.top + b.bottom) / 2;

/** Índice de inserción: cuántos bloques quedan con su mitad por encima del puntero. */
function indexFor(boxes: Array<{ box: Box }>, y: number): number {
    let i = 0;
    for (const b of boxes) {
        if (mid(b.box) < y) i += 1;
        else break;
    }
    return i;
}

function lineAt(boxes: Array<{ box: Box }>, index: number, area: Box): { top: number; left: number; width: number } {
    const width = area.right - area.left;
    if (boxes.length === 0) return { top: area.top + 4, left: area.left, width };
    if (index >= boxes.length) return { top: boxes[boxes.length - 1]!.box.bottom, left: area.left, width };
    if (index === 0) return { top: boxes[0]!.box.top, left: area.left, width };
    const top = (boxes[index - 1]!.box.bottom + boxes[index]!.box.top) / 2;
    return { top, left: area.left, width };
}

export function resolveDrop(design: EmailDesign, src: DragSource, x: number, y: number, g: DropGeometry): DropResolution | null {
    const type = src.kind === 'new' ? src.type : findBlock(design, src.id)?.type;
    if (!type) return null;

    // 1) Dentro de una columna (sólo los bloques simples entran en columnas).
    if (isInnerType(type)) {
        const col = g.columns.find((c) => inside(c.box, x, y) && !(src.kind === 'move' && src.id === c.parentId));
        if (col) {
            const target: DropTarget = { parentId: col.parentId, columnIndex: col.columnIndex, index: indexFor(col.blocks, y) };
            if (canDrop(design, src, target)) {
                if (isNoopDrop(design, src, target)) return null;
                return { target, line: lineAt(col.blocks, target.index, col.box) };
            }
        }
    }

    // 2) Primer nivel.
    const target: DropTarget = { parentId: null, columnIndex: null, index: indexFor(g.top, y) };
    if (!canDrop(design, src, target) || isNoopDrop(design, src, target)) return null;
    return { target, line: lineAt(g.top, target.index, g.sheet) };
}
