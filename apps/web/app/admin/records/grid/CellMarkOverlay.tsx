import type { CellMark } from './useGridController';

/**
 * v0.1.294 — Las marcas de una celda que no son la selección:
 *  - CORTE: borde punteado alrededor de lo cortado (como Excel), hasta pegar
 *    o pulsar Esc;
 *  - ERROR: borde rojo en las celdas que no se pudieron pegar/rellenar (el
 *    motivo va en el `title` de la celda), por unos segundos.
 */
export const ERROR_CELL_SHADOW = 'inset 0 0 0 2px hsl(var(--imcrm-destructive))';

export function CellMarkOverlay({ mark }: { mark: CellMark | null }): JSX.Element | null {
    if (!mark?.cut) return null;
    const w = (edge: boolean): number => (edge ? 2 : 0);
    return (
        <span
            aria-hidden
            data-cut-mark
            className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-z-[1] imcrm-border-dashed imcrm-border-primary"
            style={{
                borderTopWidth: w(mark.cut.top),
                borderBottomWidth: w(mark.cut.bottom),
                borderLeftWidth: w(mark.cut.left),
                borderRightWidth: w(mark.cut.right),
            }}
        />
    );
}
