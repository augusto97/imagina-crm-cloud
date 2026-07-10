/**
 * Parser CSV minimalista pero robusto (paridad con `Imports/CsvParser.php`
 * del plugin). Maneja:
 *  - BOM UTF-8 (lo strippea automáticamente).
 *  - Celdas con comas, comillas dobles escapadas (`""`) y saltos de línea
 *    dentro de comillas — state machine char a char, sin dependencias.
 *  - Detección de delimiter (`,` vs `;` vs tab) por la primera línea —
 *    Excel en español exporta con `;` por la configuración regional.
 *
 * El encoding lo resuelve el transporte (el body llega como UTF-8 vía JSON);
 * no hay equivalente al fallback Latin-1 del plugin porque JSON siempre es
 * UTF-8 válido.
 */

export interface ParsedCsv {
    headers: string[];
    rows: string[][];
}

export function parseCsv(csv: string, delimiter?: string): ParsedCsv {
    const clean = stripBom(csv);
    if (clean.trim() === '') return { headers: [], rows: [] };

    const delim = delimiter ?? detectDelimiter(clean);

    const allRows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    let sawAny = false; // ¿la fila actual tiene contenido (aunque sea "")?

    const pushCell = (): void => {
        row.push(cell);
        cell = '';
    };
    const pushRow = (): void => {
        pushCell();
        // Línea completamente vacía → se descarta (como fgetcsv con [null]).
        const isEmpty = row.length === 1 && row[0] === '' && !sawAny;
        if (!isEmpty) allRows.push(row);
        row = [];
        sawAny = false;
    };

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i]!;
        if (inQuotes) {
            if (ch === '"') {
                if (clean[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            sawAny = true;
        } else if (ch === delim) {
            pushCell();
            sawAny = true;
        } else if (ch === '\n') {
            pushRow();
        } else if (ch === '\r') {
            if (clean[i + 1] === '\n') i++;
            pushRow();
        } else {
            cell += ch;
        }
    }
    // Última línea sin newline final.
    if (cell !== '' || row.length > 0) pushRow();

    const [first, ...rest] = allRows;
    return {
        headers: (first ?? []).map((h) => h.trim()),
        rows: rest,
    };
}

function stripBom(csv: string): string {
    return csv.startsWith('﻿') ? csv.slice(1) : csv;
}

/**
 * Detecta el delimiter más probable contando ocurrencias en la primera línea,
 * ignorando separadores dentro de comillas (quitamos los pares "..." antes de
 * contar). Empate o cero → coma.
 */
function detectDelimiter(csv: string): string {
    const nl = csv.indexOf('\n');
    const firstLine = nl === -1 ? csv : csv.slice(0, nl);
    const unquoted = firstLine.replace(/"[^"]*"/g, '');

    const counts: Array<[string, number]> = [
        [',', countChar(unquoted, ',')],
        [';', countChar(unquoted, ';')],
        ['\t', countChar(unquoted, '\t')],
    ];
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

function countChar(s: string, c: string): number {
    let n = 0;
    for (const ch of s) if (ch === c) n++;
    return n;
}
