import { createContext, useContext } from 'react';

/**
 * v0.1.172 — "sostener" el panel flotante del riel mientras un menú o un
 * diálogo abierto DESDE ese panel sigue vivo.
 *
 * El flotante se cierra al salir el mouse (v0.1.145) y al clickear adentro.
 * Pero el menú contextual de un item y sus diálogos van por portal al body:
 * en el DOM el puntero "sale" del panel al entrar al menú, y cada click en
 * un item del menú burbujea por el árbol de React hasta el flotante. Sin
 * esto, elegir "Compartir" desde el flotante lo cerraba, desmontaba la fila
 * y el diálogo se iba con ella.
 *
 * Fuera del flotante (panel acoplado) el provider no existe y `hold` es un
 * no-op.
 */
export const PeekHoldContext = createContext<((held: boolean) => void) | null>(null);

export function usePeekHold(): (held: boolean) => void {
    const hold = useContext(PeekHoldContext);
    return hold ?? noop;
}

function noop(): void {
    /* panel acoplado: nada que sostener */
}
