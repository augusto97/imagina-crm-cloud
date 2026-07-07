/**
 * Helpers para gestionar bloques anidados (`nested_section`) en
 * templates del portal (y futuro CRM).
 *
 * Modelo:
 *   - `blocks` top-level: array flat `TBlock[]` con `y/x/pos/w`.
 *   - Un bloque de tipo `nested_section` tiene en su config un array
 *     `columns: [{ id, width, blocks: TBlock[] }]` con sub-bloques.
 *   - Los sub-bloques tienen su propio `id` único y son del mismo
 *     shape `TBlock`. NO pueden ser otro `nested_section` (1 nivel).
 *
 * Estos helpers permiten encontrar / actualizar / mover / eliminar un
 * bloque por id sin importar si es top-level o sub-bloque.
 */

import type { BaseTemplateBlock } from './types';

/** Path estructural a un bloque. */
export type BlockPath =
    /** Top-level: solo el id. */
    | { kind: 'top'; id: string }
    /** Sub-bloque: id del parent + (colIdx, subIdx). */
    | { kind: 'sub'; parentId: string; colIdx: number; subIdx: number };

/** Sub-bloque con su path resuelto. */
export interface SubBlockLocation<T extends BaseTemplateBlock> {
    block: T;
    parentId: string;
    colIdx: number;
    subIdx: number;
}

/**
 * Config esperado para un block de tipo `nested_section`.
 */
export interface NestedSectionConfig<T extends BaseTemplateBlock> {
    columns: Array<{
        id: string;
        width: number;
        blocks: T[];
    }>;
}

function isNestedSection<T extends BaseTemplateBlock>(b: T): boolean {
    return b.type === 'nested_section';
}

function getNestedConfig<T extends BaseTemplateBlock>(b: T): NestedSectionConfig<T> | null {
    if (! isNestedSection(b)) return null;
    const cfg = b.config as unknown as NestedSectionConfig<T>;
    if (! cfg || ! Array.isArray(cfg.columns)) return null;
    return cfg;
}

/**
 * Encuentra un bloque por id, sea top-level o sub-bloque. Devuelve el
 * bloque + su path.
 */
export function findBlockById<T extends BaseTemplateBlock>(
    blocks: T[],
    id: string,
): { block: T; path: BlockPath } | null {
    for (const b of blocks) {
        if (b.id === id) {
            return { block: b, path: { kind: 'top', id } };
        }
        const cfg = getNestedConfig(b);
        if (! cfg) continue;
        for (let cIdx = 0; cIdx < cfg.columns.length; cIdx += 1) {
            const col = cfg.columns[cIdx];
            if (! col) continue;
            for (let sIdx = 0; sIdx < col.blocks.length; sIdx += 1) {
                const sub = col.blocks[sIdx];
                if (sub && sub.id === id) {
                    return {
                        block: sub,
                        path: { kind: 'sub', parentId: b.id, colIdx: cIdx, subIdx: sIdx },
                    };
                }
            }
        }
    }
    return null;
}

/**
 * Actualiza un bloque por id aplicando `patch`. Funciona tanto a
 * top-level como sub-bloques. Devuelve un nuevo array `blocks`.
 */
export function updateBlockById<T extends BaseTemplateBlock>(
    blocks: T[],
    id: string,
    patch: Partial<T>,
): T[] {
    return blocks.map((b) => {
        if (b.id === id) return { ...b, ...patch };
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        let touched = false;
        const newColumns = cfg.columns.map((col) => {
            const newBlocks = col.blocks.map((sub) => {
                if (sub.id === id) {
                    touched = true;
                    return { ...sub, ...patch };
                }
                return sub;
            });
            return { ...col, blocks: newBlocks };
        });
        if (! touched) return b;
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/**
 * Elimina un bloque por id de cualquier nivel.
 */
export function deleteBlockById<T extends BaseTemplateBlock>(
    blocks: T[],
    id: string,
): T[] {
    // Filtrar top-level.
    const filtered = blocks.filter((b) => b.id !== id);
    // Filtrar sub-bloques.
    return filtered.map((b) => {
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const newColumns = cfg.columns.map((col) => ({
            ...col,
            blocks: col.blocks.filter((sub) => sub.id !== id),
        }));
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/** Target de un drop / move — puede ser top-level o sub-columna. */
export type DropTarget =
    /** Top-level: agregar al final de la columna (y, x). */
    | { kind: 'top'; y: number; x: number; pos: number }
    /** Sub-columna: dentro del parentId, en la sub-col cIdx, posición sIdx. */
    | { kind: 'sub'; parentId: string; colIdx: number; subIdx: number };

/**
 * Mueve un bloque al destino indicado. El bloque se quita de su
 * posición actual (top-level o sub-bloque) y se inserta en el destino.
 *
 * Restricciones:
 *  - Un bloque tipo `nested_section` NO puede meterse adentro de otro
 *    `nested_section` (1 nivel max). Si se intenta, devuelve `null`.
 *  - El bloque movido tiene su `id` preservado.
 *
 * Para drops "al final de la columna" sin saber el `pos`/`subIdx`
 * exacto, pasar Number.MAX_SAFE_INTEGER y se clampea adentro.
 */
export function moveBlock<T extends BaseTemplateBlock>(
    blocks: T[],
    sourceId: string,
    target: DropTarget,
): T[] | null {
    const found = findBlockById(blocks, sourceId);
    if (! found) return blocks;

    const movedBlock = found.block;

    // Restricción: no permitir nested_section adentro de nested_section.
    if (target.kind === 'sub' && isNestedSection(movedBlock)) {
        return null;
    }

    // 1) Quitar el bloque de donde estaba.
    let working = deleteBlockById(blocks, sourceId);

    // 2) Insertar en el destino.
    if (target.kind === 'top') {
        // Hacer espacio en la columna destino: shiftear `pos` de los
        // que estaban en (y, x) con pos >= target.pos.
        working = working.map((b) =>
            (b.y ?? 0) === target.y
                && (b.x ?? 0) === target.x
                && (b.pos ?? 0) >= target.pos
                ? { ...b, pos: (b.pos ?? 0) + 1 }
                : b,
        );
        // Calcular el width de la columna destino (consistencia).
        const colW = working.find(
            (b) => (b.y ?? 0) === target.y && (b.x ?? 0) === target.x,
        )?.w ?? movedBlock.w ?? 12;
        working = [
            ...working,
            { ...movedBlock, y: target.y, x: target.x, pos: target.pos, w: colW, h: 0 } as T,
        ];
        return working;
    }

    // target.kind === 'sub'
    return working.map((b) => {
        if (b.id !== target.parentId) return b;
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const newColumns = cfg.columns.map((col, cIdx) => {
            if (cIdx !== target.colIdx) return col;
            const insertAt = Math.max(
                0,
                Math.min(target.subIdx, col.blocks.length),
            );
            const newBlocks = [...col.blocks];
            newBlocks.splice(insertAt, 0, movedBlock);
            return { ...col, blocks: newBlocks };
        });
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/**
 * Crea un sub-bloque nuevo en una columna del nested_section indicado.
 * El bloque ya viene construido (id, type, config) por el caller —
 * acá solo lo insertamos en el path.
 */
export function insertSubBlock<T extends BaseTemplateBlock>(
    blocks: T[],
    parentId: string,
    colIdx: number,
    block: T,
): T[] {
    return blocks.map((b) => {
        if (b.id !== parentId) return b;
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const newColumns = cfg.columns.map((col, cIdx) => {
            if (cIdx !== colIdx) return col;
            return { ...col, blocks: [...col.blocks, block] };
        });
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/**
 * Reordena un sub-bloque dentro de su columna en el nested_section
 * indicado (dirección: -1 sube, +1 baja).
 */
export function moveSubBlockWithinColumn<T extends BaseTemplateBlock>(
    blocks: T[],
    parentId: string,
    colIdx: number,
    subIdx: number,
    direction: -1 | 1,
): T[] {
    return blocks.map((b) => {
        if (b.id !== parentId) return b;
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const newColumns = cfg.columns.map((col, cIdx) => {
            if (cIdx !== colIdx) return col;
            const arr = [...col.blocks];
            const newIdx = subIdx + direction;
            if (newIdx < 0 || newIdx >= arr.length) return col;
            const [removed] = arr.splice(subIdx, 1);
            arr.splice(newIdx, 0, removed!);
            return { ...col, blocks: arr };
        });
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/**
 * Cambia el ancho de una sub-columna en el nested_section dado.
 */
export function setSubColumnWidth<T extends BaseTemplateBlock>(
    blocks: T[],
    parentId: string,
    colIdx: number,
    width: number,
): T[] {
    const clamped = Math.max(1, Math.min(12, Math.round(width)));
    return blocks.map((b) => {
        if (b.id !== parentId) return b;
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const newColumns = cfg.columns.map((col, cIdx) =>
            cIdx === colIdx ? { ...col, width: clamped } : col,
        );
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/**
 * Agrega una sub-columna nueva (vacía) al final del nested_section.
 */
export function addSubColumn<T extends BaseTemplateBlock>(
    blocks: T[],
    parentId: string,
): T[] {
    return blocks.map((b) => {
        if (b.id !== parentId) return b;
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const used = cfg.columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
        const remaining = Math.max(3, 12 - used);
        const newColumns = [
            ...cfg.columns,
            {
                id: `nc-${Date.now()}-${cfg.columns.length}`,
                width: Math.min(12, remaining),
                blocks: [] as T[],
            },
        ];
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}

/**
 * Elimina una sub-columna del nested_section (con todos sus sub-bloques).
 */
export function deleteSubColumn<T extends BaseTemplateBlock>(
    blocks: T[],
    parentId: string,
    colIdx: number,
): T[] {
    return blocks.map((b) => {
        if (b.id !== parentId) return b;
        const cfg = getNestedConfig(b);
        if (! cfg) return b;
        const newColumns = cfg.columns.filter((_, cIdx) => cIdx !== colIdx);
        return { ...b, config: { ...(b.config as object), columns: newColumns } } as T;
    });
}
