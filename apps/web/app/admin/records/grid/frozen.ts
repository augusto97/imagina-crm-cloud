/**
 * v0.1.287 — Columnas fijas («Fijar hasta esta columna»): cuántas de las
 * primeras columnas visibles quedan clavadas a la izquierda al scrollear en
 * horizontal, y en qué posición (`left`) va cada una.
 *
 * Sin elección la tabla fija sólo la primera (como siempre). En pantallas
 * angostas, si lo fijado ocupara más del 60 % del ancho visible no quedaría
 * lugar para scrollear el resto: se fija sólo la primera.
 */
export const FROZEN_MAX_SHARE = 0.6;

export interface FrozenLayout {
    /** column id → `left` en px. */
    left: Map<string, number>;
    /** La última columna fijada (lleva la línea de separación). */
    lastId: string | null;
    /** Cuántas quedaron fijas de verdad (puede ser menos que lo pedido). */
    count: number;
}

export function computeFrozen(
    columns: ReadonlyArray<{ id: string; width: number }>,
    requested: number,
    containerWidth: number | null,
): FrozenLayout {
    const n = Math.max(1, Math.min(requested, columns.length));
    let take = n;
    if (n > 1 && containerWidth !== null && containerWidth > 0) {
        const total = columns.slice(0, n).reduce((sum, c) => sum + c.width, 0);
        if (total > containerWidth * FROZEN_MAX_SHARE) take = 1;
    }
    const left = new Map<string, number>();
    let x = 0;
    for (const c of columns.slice(0, take)) {
        left.set(c.id, x);
        x += c.width;
    }
    const last = columns[take - 1];
    return { left, lastId: last ? last.id : null, count: columns.length === 0 ? 0 : take };
}

/** La línea sutil tras la última columna fijada (va en `box-shadow` con el resto). */
export const FROZEN_EDGE_SHADOW = 'inset -1px 0 0 hsl(var(--imcrm-border))';
