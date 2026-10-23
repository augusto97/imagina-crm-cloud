import {
    GANTT_COLUMN_WIDTH_DEFAULT,
    GANTT_DEFAULT_BAR_COLOR,
    GANTT_NULL_GROUP,
    GANTT_PX_PER_DAY,
    GANTT_RULE_COLOR_HEX,
    GANTT_TITLE_WIDTH_DEFAULT,
    type GanttBar,
    type GanttColumn,
    type GanttSettings,
    type GanttZoom,
} from '@imagina-base/shared';

/**
 * B1 — Lógica de pantalla del Gantt (pura, con tests): el lienzo en píxeles,
 * dónde cae cada barra, las flechas de las dependencias y las etiquetas de los
 * grupos. Lo que decide el DATO (qué fechas cambian al mover, la ventana que
 * se pide) vive en `packages/shared` (`gantt.ts`), compartido con el servidor.
 */

/** Alto de una fila (registro o grupo). */
export const GANTT_ROW_H = 34;
/** Las dos filas del encabezado del tiempo. */
export const GANTT_HEADER_TOP_H = 22;
export const GANTT_HEADER_BOTTOM_H = 24;
export const GANTT_HEADER_H = GANTT_HEADER_TOP_H + GANTT_HEADER_BOTTOM_H;
/** La barra dentro de la fila (arriba queda aire; abajo, la línea base). */
export const GANTT_BAR_TOP = 7;
export const GANTT_BAR_H = 18;
export const GANTT_BASELINE_TOP = 27;
export const GANTT_BASELINE_H = 4;
/** El rombo de un hito. */
export const GANTT_MILESTONE = 14;
/**
 * El lienzo cubre ±5 años alrededor de hoy (en el zoom «día» son ~130.000 px:
 * el navegador sólo pinta lo visible). Los datos NO se piden enteros: se pide
 * la ventana que se ve más un margen (`ganttGrowWindow`).
 */
export const GANTT_CANVAS_HALF_DAYS = 1830;
/** Cuánto dura la barra al programar un «Sin programar» soltándolo (según el zoom). */
export const GANTT_SCHEDULE_DAYS: Record<GanttZoom, number> = { day: 1, week: 5, month: 14, quarter: 30 };

export interface GanttCanvas {
    /** Primer día del lienzo (x = 0). */
    origin: number;
    days: number;
    /** Píxeles por día. */
    ppd: number;
    width: number;
}

export function ganttCanvas(today: number, zoom: GanttZoom): GanttCanvas {
    const ppd = GANTT_PX_PER_DAY[zoom];
    const days = GANTT_CANVAS_HALF_DAYS * 2 + 1;
    return { origin: today - GANTT_CANVAS_HALF_DAYS, days, ppd, width: Math.ceil(days * ppd) };
}

/** x del borde izquierdo de un día. */
export function xOfDay(c: GanttCanvas, day: number): number {
    return (day - c.origin) * c.ppd;
}

/** El día que cae en una x del lienzo. */
export function dayAtX(c: GanttCanvas, x: number): number {
    return c.origin + Math.floor(x / c.ppd);
}

/** Los días que se ven (inclusive) con el scroll actual. */
export function visibleDayRange(c: GanttCanvas, scrollLeft: number, viewportWidth: number): { from: number; to: number } {
    const from = dayAtX(c, Math.max(0, scrollLeft));
    const to = dayAtX(c, Math.max(0, scrollLeft + Math.max(1, viewportWidth) - 1));
    return { from, to };
}

/** El scroll que deja un día en una fracción del ancho visible (Ir a hoy, cambiar de zoom). */
export function scrollLeftFor(c: GanttCanvas, day: number, viewportWidth: number, at = 1 / 3): number {
    const x = xOfDay(c, day) + c.ppd / 2 - viewportWidth * at;
    return Math.max(0, Math.min(c.width - viewportWidth, Math.round(x)));
}

/** Dónde se dibuja una barra (o el rombo de un hito) en el lienzo. */
export function barBox(c: GanttCanvas, bar: GanttBar): { left: number; width: number } {
    if (bar.milestone) {
        const center = xOfDay(c, bar.start) + c.ppd / 2;
        return { left: center - GANTT_MILESTONE / 2, width: GANTT_MILESTONE };
    }
    const left = xOfDay(c, bar.start);
    return { left, width: Math.max(6, (bar.end - bar.start + 1) * c.ppd) };
}

/** Días que se corrió un arrastre de `dx` píxeles (redondeado al día). */
export function snapDays(dx: number, ppd: number): number {
    const d = Math.round(dx / ppd);
    return Object.is(d, -0) ? 0 : d;
}

/**
 * La flecha de una dependencia: sale del FIN del que bloquea y entra al
 * INICIO del bloqueado. Si hay lugar va en «L» (derecha, baja, derecha); si el
 * bloqueado empieza antes de que termine el otro, rodea por el espacio entre
 * las filas.
 */
export function dependencyPath(from: { x: number; y: number }, to: { x: number; y: number }, rowH = GANTT_ROW_H): string {
    const gap = 10;
    if (to.x - from.x >= gap * 2) {
        const mid = from.x + gap;
        return `M ${from.x} ${from.y} H ${mid} V ${to.y} H ${to.x}`;
    }
    const between = to.y > from.y ? from.y + rowH / 2 : from.y - rowH / 2;
    return `M ${from.x} ${from.y} H ${from.x + gap} V ${between} H ${to.x - gap} V ${to.y} H ${to.x}`;
}

/** Ancho de la columna del título y de cada columna del panel. */
export function panelWidths(s: Pick<GanttSettings, 'titleWidth' | 'columns'>): { title: number; columns: number[]; total: number } {
    const title = s.titleWidth ?? GANTT_TITLE_WIDTH_DEFAULT;
    const columns = s.columns.map((c) => c.width ?? GANTT_COLUMN_WIDTH_DEFAULT);
    return { title, columns, total: title + columns.reduce((a, b) => a + b, 0) };
}

/** Cambiar el ancho de una columna del panel (`-1` = la del título). */
export function resizePanelColumn(
    s: Pick<GanttSettings, 'titleWidth' | 'columns'>,
    index: number,
    width: number,
): { titleWidth: number | null; columns: GanttColumn[] } {
    if (index < 0) return { titleWidth: clampWidth(width, 80, 600), columns: s.columns };
    return {
        titleWidth: s.titleWidth,
        columns: s.columns.map((c, i) => (i === index ? { field_id: c.field_id, width: clampWidth(width, 60, 600) } : c)),
    };
}

function clampWidth(w: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(w)));
}

/**
 * El patch que deshace una edición: los valores ANTERIORES de los campos que
 * cambió (un valor que no estaba vuelve a vacío).
 */
export function undoPatchFor(before: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) out[k] = before[k] === undefined || before[k] === '' ? null : before[k];
    return out;
}

/** Color de una regla condicional (paleta de la vista) como hex, o null. */
export function ruleColorHex(color: string | null | undefined): string | null {
    return color ? GANTT_RULE_COLOR_HEX[color] ?? null : null;
}

export { GANTT_DEFAULT_BAR_COLOR, GANTT_NULL_GROUP };
