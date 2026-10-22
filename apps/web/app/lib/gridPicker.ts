/**
 * v0.1.294 — Un selector de celda (opciones, fecha, persona, vínculos) que
 * abre la TABLA, no el click: en la tabla un click elige la celda y el
 * selector se abre con el segundo click, el doble click, Enter o al empezar a
 * escribir (lo tecleado llega como `seed` y va al buscador).
 */
export interface GridPickerControl {
    /** Cambia cada vez que la tabla pide abrirlo; null = cerrado. */
    openToken: number | null;
    /** Lo que se tecleó para abrirlo (o null). */
    seed: string | null;
    /** El selector se cerró (eligió, Escape o click afuera). */
    onClosed: () => void;
}
