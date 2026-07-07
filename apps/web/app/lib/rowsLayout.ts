/**
 * Layout por filas/columnas/bloques apilados — modelo unificado desde 0.57.24.
 *
 * Estructura conceptual (jerárquica):
 *
 *   Template
 *     ├─ Row 0
 *     │    ├─ Column 0 (w=8)
 *     │    │    ├─ Block "header"
 *     │    │    ├─ Block "properties"
 *     │    │    └─ Block "timeline"
 *     │    └─ Column 1 (w=4)
 *     │         ├─ Block "stats"
 *     │         └─ Block "related"
 *     ├─ Row 1
 *     │    └─ Column 0 (w=12)
 *     │         └─ Block "notes"
 *     ...
 *
 * Storage (sigue flat en el JSON):
 *
 *   Cada bloque tiene `{ y, x, w, pos }`:
 *     - `y` → índice de fila (0, 1, 2...)
 *     - `x` → índice de columna dentro de la fila (0, 1, 2...)
 *     - `w` → ancho de la columna en cols de 12
 *     - `pos` → posición vertical dentro de la columna (0, 1, 2...)
 *
 *   Dos bloques con el mismo (y, x) están en la MISMA columna,
 *   apilados verticalmente según `pos`.
 *   Dos bloques con (y, x) distintos están en columnas separadas
 *   de la misma fila (si comparten `y`) o en filas distintas.
 *
 * El `w` se infiere de la PRIMERA columna definida en cada (y, x) —
 * para que dos bloques en la misma columna no puedan disagree sobre
 * el ancho. Al editar el ancho de una columna, se aplica a todos los
 * bloques de esa columna.
 *
 * Compatibilidad con templates legacy (modelo pre-0.57.24):
 *   - Bloques sin `pos` → default 0 (una columna = un bloque).
 *   - Bloques con `y` arbitrarios → siguen funcionando (groupBlocks
 *     usa el `y` tal cual). Al editar, se normalizan a consecutivos.
 *   - El campo `h` se ignora completamente.
 */

export interface PositionedBlock {
    id?: string;
    x?: number;     // índice de columna en la fila (0, 1, 2...)
    y?: number;     // índice de fila (0, 1, 2...)
    w?: number;     // ancho de la columna en /12
    h?: number;     // [legacy, ignorado]
    pos?: number;   // posición vertical dentro de la columna (0, 1, 2...)
}

type WithId<T> = T & { id: string };

export interface Column<T extends PositionedBlock> {
    /** Índice de la columna dentro de su fila (0, 1, 2...). */
    colIdx: number;
    /** Ancho en cols de 12 (inferido del primer bloque). */
    width: number;
    /** Bloques apilados verticalmente, ordenados por `pos` ascendente. */
    blocks: T[];
}

export interface Row<T extends PositionedBlock> {
    /** Índice de fila (puede ser no-consecutivo en templates legacy). */
    index: number;
    /** Columnas ordenadas por colIdx ascendente. */
    columns: Column<T>[];
}

/**
 * Agrupa los bloques en una jerarquía Filas → Columnas → Bloques.
 *
 * El orden interno:
 *  - Filas: por `y` ascendente.
 *  - Columnas dentro de fila: por `x` ascendente.
 *  - Bloques dentro de columna: por `pos` ascendente; empate → orden
 *    de inserción.
 *
 * No re-numera nada — los valores `y/x/pos` se devuelven tal cual.
 * Para normalizar a índices consecutivos, usar `normalizeToRows`.
 */
export function groupBlocksByRowsAndColumns<T extends PositionedBlock>(
    blocks: ReadonlyArray<T>,
): Row<T>[] {
    // Agrupo por (y, x) en un nested Map.
    const byRow = new Map<number, Map<number, T[]>>();
    for (const b of blocks) {
        const y = b.y ?? 0;
        const x = b.x ?? 0;
        const inRow = byRow.get(y) ?? new Map<number, T[]>();
        const inCol = inRow.get(x) ?? [];
        inCol.push(b);
        inRow.set(x, inCol);
        byRow.set(y, inRow);
    }

    const rowKeys = Array.from(byRow.keys()).sort((a, b) => a - b);
    const rows: Row<T>[] = [];
    for (const rowKey of rowKeys) {
        const colMap = byRow.get(rowKey);
        if (! colMap) continue;
        const colKeys = Array.from(colMap.keys()).sort((a, b) => a - b);
        const columns: Column<T>[] = [];
        for (const colKey of colKeys) {
            const inCol = colMap.get(colKey) ?? [];
            // Orden vertical por `pos`. Empate → orden de inserción.
            inCol.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
            const width = clampWidth(inCol[0]?.w ?? 12);
            columns.push({ colIdx: colKey, width, blocks: inCol });
        }
        rows.push({ index: rowKey, columns });
    }
    return rows;
}

/**
 * Alias retro-compat — algunos consumidores aún esperan filas planas
 * (sin la dimensión de columna). Devuelve filas con TODOS los bloques
 * en un array plano, en orden (x asc, pos asc).
 *
 * Útil cuando un consumidor no necesita conocer la columna y solo
 * quiere recorrer los bloques de una fila en orden visual.
 */
export function groupBlocksByRow<T extends PositionedBlock>(
    blocks: ReadonlyArray<T>,
): Array<{ index: number; blocks: T[] }> {
    return groupBlocksByRowsAndColumns(blocks).map((r) => ({
        index: r.index,
        blocks: r.columns.flatMap((c) => c.blocks),
    }));
}

/**
 * Normaliza un template legacy al modelo (row, col, pos) con índices
 * consecutivos. Idempotente.
 *
 * Pasos:
 *  1. Agrupa por (y, x).
 *  2. Reasigna `y` como índice consecutivo de fila (0, 1, 2...).
 *  3. Reasigna `x` como índice consecutivo de columna en la fila.
 *  4. Reasigna `pos` como índice consecutivo dentro de la columna.
 *  5. Mantiene `w` del primer bloque de cada columna; lo aplica a
 *     todos los bloques de esa columna (consistencia).
 */
export function normalizeToRows<T extends PositionedBlock>(
    blocks: ReadonlyArray<T>,
): T[] {
    const rows = groupBlocksByRowsAndColumns(blocks);
    const out: T[] = [];
    rows.forEach((row, rowIdx) => {
        row.columns.forEach((col, colIdx) => {
            col.blocks.forEach((block, posIdx) => {
                out.push({
                    ...block,
                    x: colIdx,
                    y: rowIdx,
                    pos: posIdx,
                    w: col.width,
                    h: 0,
                });
            });
        });
    });
    return out;
}

/**
 * Mueve un bloque al destino (rowIdx, colIdx, posIdx). Si la columna
 * o fila destino no existe, se crea. Después aplana y re-numera todo
 * a índices consecutivos.
 *
 * Comportamiento de destino:
 *   - Si `colIdx` apunta a una columna existente en `rowIdx`, el
 *     bloque se inserta APILADO en esa columna en posición `posIdx`.
 *     El `w` del bloque se ajusta al `w` de la columna destino.
 *   - Si `colIdx` apunta a una columna nueva (> colCount), se crea
 *     una columna nueva al final de la fila con el `w` original del
 *     bloque (o el `widthHint` provisto).
 *   - Si `rowIdx` es > rowCount, se crea una fila nueva al final.
 */
export function moveBlock<T extends WithId<PositionedBlock>>(
    blocks: ReadonlyArray<T>,
    blockId: string,
    target: { row: number; col: number; pos: number },
    widthHint?: number,
): T[] {
    const block = blocks.find((b) => b.id === blockId);
    if (! block) return [...blocks];

    const without = blocks.filter((b) => b.id !== blockId);
    const rows = groupBlocksByRowsAndColumns(without);

    // Asegurar que la fila destino existe.
    while (rows.length <= target.row) {
        rows.push({ index: rows.length, columns: [] });
    }
    const targetRow = rows[target.row]!;

    // Asegurar que la columna destino existe; si no, crear nueva.
    let targetCol: Column<T>;
    if (target.col < targetRow.columns.length) {
        targetCol = targetRow.columns[target.col]!;
    } else {
        targetCol = {
            colIdx: targetRow.columns.length,
            width: clampWidth(widthHint ?? block.w ?? 12),
            blocks: [],
        };
        targetRow.columns.push(targetCol);
    }

    // Inserto el bloque en la columna en posición posIdx. El `w` del
    // bloque movido se ajusta al `width` de la columna destino para
    // que la columna sea consistente.
    const insertAt = Math.max(0, Math.min(target.pos, targetCol.blocks.length));
    const moved: T = { ...block, w: targetCol.width };
    targetCol.blocks.splice(insertAt, 0, moved);

    // Re-aplanar con índices consecutivos.
    return flattenWithConsecutiveIndices(rows);
}

/**
 * Quita un bloque y compacta filas/columnas para cerrar huecos.
 */
export function removeBlock<T extends WithId<PositionedBlock>>(
    blocks: ReadonlyArray<T>,
    blockId: string,
): T[] {
    return flattenWithConsecutiveIndices(
        groupBlocksByRowsAndColumns(blocks.filter((b) => b.id !== blockId)),
    );
}

/**
 * Cambia el ancho de la columna que contiene un bloque. Si el bloque
 * comparte columna con otros, el cambio se aplica a TODA la columna
 * (mantiene consistencia).
 */
export function setColumnWidth<T extends WithId<PositionedBlock>>(
    blocks: ReadonlyArray<T>,
    blockId: string,
    width: number,
): T[] {
    const block = blocks.find((b) => b.id === blockId);
    if (! block) return [...blocks];
    const clamped = clampWidth(width);
    const targetY = block.y ?? 0;
    const targetX = block.x ?? 0;
    return blocks.map((b) =>
        (b.y ?? 0) === targetY && (b.x ?? 0) === targetX
            ? { ...b, w: clamped }
            : b,
    );
}

/**
 * Compacta filas/columnas/pos a índices consecutivos sin huecos.
 */
export function compactRows<T extends PositionedBlock>(
    blocks: ReadonlyArray<T>,
): T[] {
    return flattenWithConsecutiveIndices(groupBlocksByRowsAndColumns(blocks));
}

function flattenWithConsecutiveIndices<T extends PositionedBlock>(
    rows: Row<T>[],
): T[] {
    const out: T[] = [];
    let rowIdx = 0;
    for (const row of rows) {
        // Filas vacías (sin columnas con bloques) se saltan.
        const nonEmptyCols = row.columns.filter((c) => c.blocks.length > 0);
        if (nonEmptyCols.length === 0) continue;
        nonEmptyCols.forEach((col, colIdx) => {
            col.blocks.forEach((block, posIdx) => {
                out.push({
                    ...block,
                    x: colIdx,
                    y: rowIdx,
                    pos: posIdx,
                    w: col.width,
                    h: 0,
                });
            });
        });
        rowIdx += 1;
    }
    return out;
}

function clampWidth(w: number): number {
    if (! Number.isFinite(w)) return 12;
    return Math.max(1, Math.min(12, Math.round(w)));
}

/** Presets de ancho que mostramos en el editor. */
export const WIDTH_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 3,  label: '1/4' },
    { value: 4,  label: '1/3' },
    { value: 6,  label: '1/2' },
    { value: 8,  label: '2/3' },
    { value: 9,  label: '3/4' },
    { value: 12, label: 'Full' },
];

/**
 * Suma de widths de todas las columnas en una fila.
 */
export function rowTotalWidth<T extends PositionedBlock>(row: Row<T>): number {
    return row.columns.reduce((sum, c) => sum + c.width, 0);
}

