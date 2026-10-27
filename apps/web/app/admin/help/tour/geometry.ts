/**
 * Fase 7 — geometría PURA del recorrido: el recorte alrededor del elemento
 * señalado y dónde va el globo. Sin DOM, para poder probarla.
 */

export interface Box {
    top: number;
    left: number;
    width: number;
    height: number;
}

export interface Size {
    width: number;
    height: number;
}

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface BalloonPosition {
    top: number;
    left: number;
    /** Dónde quedó respecto del elemento (`center` = sin elemento). */
    placement: Placement | 'center';
}

/** Aire entre el elemento y el borde del recorte. */
export const HOLE_PADDING = 6;
/** Separación entre el recorte y el globo. */
export const BALLOON_GAP = 12;
/** Margen mínimo contra los bordes de la ventana. */
export const VIEWPORT_MARGIN = 12;

/**
 * El recorte: el elemento con un poco de aire, recortado a la ventana (un
 * elemento más alto que la pantalla no puede dejar el recorte afuera).
 */
export function holeBox(target: Box, viewport: Size, pad = HOLE_PADDING): Box {
    const top = Math.max(0, target.top - pad);
    const left = Math.max(0, target.left - pad);
    const bottom = Math.min(viewport.height, target.top + target.height + pad);
    const right = Math.min(viewport.width, target.left + target.width + pad);
    return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function clamp(v: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(Math.max(v, min), max);
}

function positionFor(p: Placement, hole: Box, balloon: Size, viewport: Size, gap: number, margin: number): BalloonPosition {
    const cx = hole.left + hole.width / 2;
    const cy = hole.top + hole.height / 2;
    const maxLeft = viewport.width - balloon.width - margin;
    const maxTop = viewport.height - balloon.height - margin;
    switch (p) {
        case 'bottom':
            return { placement: p, top: hole.top + hole.height + gap, left: clamp(cx - balloon.width / 2, margin, maxLeft) };
        case 'top':
            return { placement: p, top: hole.top - gap - balloon.height, left: clamp(cx - balloon.width / 2, margin, maxLeft) };
        case 'right':
            return { placement: p, left: hole.left + hole.width + gap, top: clamp(cy - balloon.height / 2, margin, maxTop) };
        case 'left':
            return { placement: p, left: hole.left - gap - balloon.width, top: clamp(cy - balloon.height / 2, margin, maxTop) };
    }
}

function fits(pos: BalloonPosition, balloon: Size, viewport: Size, margin: number): boolean {
    return (
        pos.top >= margin &&
        pos.left >= margin &&
        pos.top + balloon.height <= viewport.height - margin &&
        pos.left + balloon.width <= viewport.width - margin
    );
}

/**
 * Dónde va el globo. Prueba la ubicación preferida y después abajo, arriba,
 * derecha e izquierda; la primera que entre ENTERA gana. Si ninguna entra
 * (pantalla chica, elemento enorme), el lado con más espacio, recortado a la
 * ventana — el globo nunca queda fuera de la pantalla.
 */
export function placeBalloon(
    hole: Box | null,
    balloon: Size,
    viewport: Size,
    preferred?: Placement,
    gap = BALLOON_GAP,
    margin = VIEWPORT_MARGIN,
): BalloonPosition {
    if (hole === null) {
        return {
            placement: 'center',
            top: Math.max(margin, (viewport.height - balloon.height) / 2),
            left: Math.max(margin, (viewport.width - balloon.width) / 2),
        };
    }
    const order: Placement[] = [];
    for (const p of [preferred, 'bottom', 'top', 'right', 'left'] as Array<Placement | undefined>) {
        if (p && !order.includes(p)) order.push(p);
    }
    for (const p of order) {
        const pos = positionFor(p, hole, balloon, viewport, gap, margin);
        if (fits(pos, balloon, viewport, margin)) return pos;
    }
    const space: Record<Placement, number> = {
        bottom: viewport.height - (hole.top + hole.height),
        top: hole.top,
        right: viewport.width - (hole.left + hole.width),
        left: hole.left,
    };
    const best = (Object.keys(space) as Placement[]).sort((a, b) => space[b] - space[a])[0]!;
    const pos = positionFor(best, hole, balloon, viewport, gap, margin);
    return {
        placement: best,
        top: clamp(pos.top, margin, viewport.height - balloon.height - margin),
        left: clamp(pos.left, margin, viewport.width - balloon.width - margin),
    };
}

/**
 * En el celular el globo es una tarjeta pegada abajo; si el elemento está en
 * la mitad de abajo de la pantalla, la tarjeta va arriba para no taparlo.
 */
export function mobileCardEdge(hole: Box | null, viewport: Size): 'top' | 'bottom' {
    if (hole === null) return 'bottom';
    const center = hole.top + hole.height / 2;
    return center > viewport.height * 0.55 ? 'top' : 'bottom';
}

/** ¿El elemento se ve entero (con un poco de aire)? Si no, hay que llevarlo a la vista. */
export function isFullyVisible(target: Box, viewport: Size, margin = 24): boolean {
    return (
        target.top >= margin &&
        target.left >= 0 &&
        target.top + target.height <= viewport.height - margin &&
        target.left + target.width <= viewport.width
    );
}

/**
 * ¿Se ve lo suficiente para señalarlo? Entero, o —si ocupa más de media
 * pantalla— con su borde de arriba en el primer tercio.
 */
export function wellInView(target: Box, viewport: Size, margin = 24): boolean {
    if (isFullyVisible(target, viewport, margin)) return true;
    const tall = target.height > viewport.height * 0.5;
    return tall && target.top >= -1 && target.top <= viewport.height * 0.35 && target.left >= 0 && target.left + target.width <= viewport.width;
}
