/**
 * v0.1.294 — El portapapeles INTERNO de la tabla.
 *
 * Al copiar se escribe en el portapapeles del sistema el texto legible (TSV,
 * lo que entiende Excel/Sheets) y, en paralelo, aquí se guarda el valor real
 * de cada celda. Al pegar, si lo que trae el portapapeles es exactamente lo
 * que copió la tabla, cada celda que vuelve a su MISMO campo usa el valor real
 * (sin perder nada: los vínculos de una relación, una fecha con hora…); el
 * resto se convierte desde el texto, igual que si viniera de Excel.
 *
 * También recuerda si la copia fue un CORTE: las celdas cortadas se marcan con
 * un borde punteado y se vacían recién al pegar (como en Excel y Sheets; si
 * se pega en otro programa, no se borra nada).
 *
 * Vive a nivel de módulo: lo comparten la tabla plana y todos los grupos de la
 * agrupada (cortar en un grupo y pegar en otro funciona).
 */
export interface ClipCell {
    recordId: number | null;
    fieldId: number | null;
    fieldType: string | null;
    value: unknown;
    text: string;
}

export interface GridClip {
    listId: number;
    /** El TSV exacto que se puso en el portapapeles del sistema. */
    text: string;
    cells: ClipCell[][];
    cut: boolean;
}

let current: GridClip | null = null;
let cutKeys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
    for (const fn of listeners) fn();
}

export function setGridClip(clip: GridClip | null): void {
    current = clip;
    const keys = new Set<string>();
    if (clip?.cut) {
        for (const row of clip.cells) {
            for (const c of row) {
                if (c.recordId !== null && c.fieldId !== null) keys.add(`${c.recordId}:${c.fieldId}`);
            }
        }
    }
    cutKeys = keys;
    emit();
}

export function getGridClip(): GridClip | null {
    return current;
}

/** Quita la marca de corte (Escape, o ya se pegó) sin olvidar lo copiado. */
export function clearCut(): void {
    if (!current?.cut) return;
    setGridClip({ ...current, cut: false });
}

/** Claves `registro:campo` de las celdas cortadas (vacío si no hay corte). */
export function getCutKeys(): ReadonlySet<string> {
    return cutKeys;
}

export function subscribeGridClip(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function normalize(text: string): string {
    return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/** El portapapeles interno si `text` es lo que copió la tabla (o null). */
export function clipForText(text: string): GridClip | null {
    if (!current) return null;
    return normalize(current.text) === normalize(text) ? current : null;
}

/**
 * La misma matriz como tabla HTML: pegada en Docs, Word o un correo queda como
 * tabla (Excel y Sheets usan el TSV de todos modos).
 */
export function toHtmlTable(matrix: string[][]): string {
    const esc = (s: string): string =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
    const rows = matrix.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    return `<meta charset="utf-8"><table>${rows}</table>`;
}
