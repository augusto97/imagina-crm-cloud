/**
 * v0.1.287 — Texto tabulado (TSV): lo que Excel, Google Sheets y la propia
 * tabla ponen en el portapapeles al copiar un rango de celdas.
 *
 * Reglas (las de Excel/Sheets): filas separadas por salto de línea (`\n` o
 * `\r\n`), celdas por tabulación. Una celda con tabulación, salto de línea o
 * comillas va entre comillas dobles, y las comillas internas se duplican
 * (`"dice ""hola"""`). El salto de línea final que agregan las planillas no
 * es una fila vacía.
 */

/** TSV → matriz de celdas (texto crudo, sin convertir). */
export function parseTsv(text: string): string[][] {
    const src = text.replace(/\r\n?/g, '\n');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let i = 0;
    let quoted = false;
    let cellStart = true;
    while (i < src.length) {
        const ch = src[i]!;
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    cell += '"';
                    i += 2;
                    continue;
                }
                quoted = false;
                i++;
                continue;
            }
            cell += ch;
            i++;
            continue;
        }
        if (cellStart && ch === '"') {
            quoted = true;
            cellStart = false;
            i++;
            continue;
        }
        cellStart = false;
        if (ch === '\t') {
            row.push(cell);
            cell = '';
            cellStart = true;
        } else if (ch === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            cellStart = true;
        } else {
            cell += ch;
        }
        i++;
    }
    // Última fila (sin salto final). Un salto final deja `row` vacío y la
    // celda vacía: no es una fila de verdad.
    if (cell !== '' || row.length > 0 || !cellStart) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

/** Matriz de celdas → TSV con las comillas de Excel donde hacen falta. */
export function toTsv(rows: string[][]): string {
    return rows.map((r) => r.map(quoteCell).join('\t')).join('\n');
}

function quoteCell(value: string): string {
    if (/[\t\n\r"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}
