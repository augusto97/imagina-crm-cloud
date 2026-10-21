/**
 * v0.1.286 — el valor de un filtro sobre un campo FECHA Y HORA viaja como
 * instante con zona (ISO `…Z`). El `<input type="datetime-local">` da la hora
 * LOCAL sin zona, y el servidor la leía como UTC: en Colombia el filtro «es
 * 21/10 14:30» buscaba las 9:30. Ahora el navegador la convierte (como hace
 * la edición de celdas desde v0.1.252) y el servidor compara el minuto entero.
 */

const NAIVE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Valor guardado del filtro → valor del `<input type="datetime-local">`. */
export function datetimeFilterToInput(value: unknown): string {
    if (typeof value !== 'string' || value === '') return '';
    // Filtros guardados antes (sin zona): el servidor los lee en la zona de
    // la empresa; se muestran tal cual.
    if (NAIVE_RE.test(value)) return value.slice(0, 16);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor del input (hora local) → instante ISO con zona para el filtro. */
export function datetimeInputToFilter(local: string): string {
    if (local === '') return '';
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().replace(/:\d{2}\.\d{3}Z$/, ':00Z');
}
