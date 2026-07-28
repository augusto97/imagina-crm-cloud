import { createContext, useContext } from 'react';

/**
 * "Ajustar texto" de la vista (v0.1.127).
 *
 * Por defecto una celda recorta con elipsis (`truncate`) para que un
 * long_text o un multi_select largo no empuje la fila ni se meta sobre
 * la columna vecina. Con el ajuste activo la celda muestra el contenido
 * COMPLETO y la fila crece — es el primer toggle del panel de vista de
 * ClickUp y el que más se nota en listas con notas o direcciones.
 *
 * Va por contexto y no por prop: la celda es un componente hoja al que
 * habría que enhebrar el flag a través de las column defs de TanStack en
 * dos vistas distintas (plana y agrupada), y es una preferencia de
 * PRESENTACIÓN que no participa de ningún cálculo.
 */
export const WrapTextContext = createContext(false);

export function useWrapText(): boolean {
    return useContext(WrapTextContext);
}
