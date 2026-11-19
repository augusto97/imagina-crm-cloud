/**
 * v0.1.464 (J1) — Libro de Excel con VARIAS hojas, armado en memoria. Lo usa
 * la descarga de un informe (una hoja por bloque de datos): son pocas filas
 * por hoja (lo que muestra un gráfico o una tabla de un informe), así que no
 * hace falta el streaming de `XlsxStreamWriter`.
 *
 * Mismas reglas que el escritor por streaming: los textos van SIEMPRE como
 * texto (uno que empieza con `=`, `+`, `-` o `@` lleva el prefijo de comilla
 * y nunca se vuelve fórmula), los números como números (se pueden sumar y
 * ordenar), nombres de hoja válidos y únicos.
 */
import { strToU8, zipSync } from 'fflate';
import { xmlEscape } from './xml';
import { XLSX_MAX_CELL_CHARS, columnName, sanitizeSheetName } from './writer';

export type XlsxBookCell = string | number | null | undefined;

export interface XlsxBookSheet {
    name: string;
    rows: XlsxBookCell[][];
    /** Filas (índice desde 0) que van en negrita con línea abajo: los encabezados de cada tabla. */
    headerRows?: number[];
    /** Filas (índice desde 0) que van en negrita sin línea: títulos. */
    titleRows?: number[];
    /** Ancho de cada columna (en caracteres). Sin él, se calcula del contenido. */
    widths?: number[];
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Estilos fijos: 0 normal, 1 encabezado, 2 título; +3 = el mismo con prefijo de comilla. */
const STYLE_HEADER = 1;
const STYLE_TITLE = 2;
const QUOTED_OFFSET = 3;

/** Nombres de hoja únicos (Excel no distingue mayúsculas). */
export function uniqueSheetNames(names: string[]): string[] {
    const used = new Set<string>();
    return names.map((raw, i) => {
        const base = sanitizeSheetName(raw, `Hoja${i + 1}`);
        let name = base;
        let n = 2;
        while (used.has(name.toLowerCase())) {
            const suffix = ` (${n++})`;
            name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
        }
        used.add(name.toLowerCase());
        return name;
    });
}

function textCell(ref: string, raw: string, style: number): string {
    const text = raw.length > XLSX_MAX_CELL_CHARS ? `${raw.slice(0, XLSX_MAX_CELL_CHARS - 1)}…` : raw;
    const s = /^[=+\-@]/.test(text) ? style + QUOTED_OFFSET : style;
    const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t${space}>${xmlEscape(text)}</t></is></c>`;
}

function sheetXml(sheet: XlsxBookSheet): string {
    const headers = new Set(sheet.headerRows ?? []);
    const titles = new Set(sheet.titleRows ?? []);
    const maxCols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const widths = sheet.widths ?? Array.from({ length: maxCols }, (_, c) => {
        let w = 8;
        for (const r of sheet.rows.slice(0, 500)) {
            const v = r[c];
            const len = v === null || v === undefined ? 0 : typeof v === 'number' ? String(Math.round(v * 100) / 100).length + 2 : v.length;
            if (len > w) w = len;
        }
        return Math.min(60, w + 2);
    });
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w)).toFixed(2)}" customWidth="1"/>`).join('');
    const rows = sheet.rows
        .map((row, ri) => {
            const style = headers.has(ri) ? STYLE_HEADER : titles.has(ri) ? STYLE_TITLE : 0;
            const r = ri + 1;
            const cells = row
                .map((cell, ci) => {
                    const ref = `${columnName(ci)}${r}`;
                    if (cell === null || cell === undefined || cell === '') return '';
                    if (typeof cell === 'number') {
                        if (!Number.isFinite(cell)) return '';
                        return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${String(cell)}</v></c>`;
                    }
                    return textCell(ref, cell, style);
                })
                .join('');
            return `<row r="${r}">${cells}</row>`;
        })
        .join('');
    return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetViews><sheetView workbookViewId="0"/></sheetViews>`
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + (cols !== '' ? `<cols>${cols}</cols>` : '')
        + `<sheetData>${rows}</sheetData>`
        + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
}

function stylesXml(): string {
    const font = (extra: string, sz = 11): string => `<font>${extra}<sz val="${sz}"/><name val="Calibri"/><family val="2"/></font>`;
    const xf = (fontId: number, fillId: number, borderId: number, quote: boolean): string => {
        const attrs = [
            'numFmtId="0"',
            `fontId="${fontId}"`,
            `fillId="${fillId}"`,
            `borderId="${borderId}"`,
            'xfId="0"',
            fontId ? 'applyFont="1"' : '',
            fillId ? 'applyFill="1"' : '',
            borderId ? 'applyBorder="1"' : '',
            quote ? 'quotePrefix="1"' : '',
        ].filter(Boolean).join(' ');
        return `<xf ${attrs}/>`;
    };
    const base = [xf(0, 0, 0, false), xf(1, 2, 1, false), xf(2, 0, 0, false)];
    const quoted = [xf(0, 0, 0, true), xf(1, 2, 1, true), xf(2, 0, 0, true)];
    return `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">`
        + `<fonts count="3">${font('')}${font('<b/>')}${font('<b/>', 13)}</fonts>`
        + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>'
        + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + `<cellXfs count="${base.length + quoted.length}">${base.join('')}${quoted.join('')}</cellXfs>`
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';
}

/** Arma el .xlsx (bytes). Sin hojas, una vacía (Excel no abre un libro sin hojas). */
export function buildXlsxWorkbook(input: XlsxBookSheet[]): Uint8Array {
    const sheets = input.length > 0 ? input : [{ name: 'Hoja1', rows: [] }];
    const names = uniqueSheetNames(sheets.map((s) => s.name));
    const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
    const files: Record<string, Uint8Array> = {};
    files['[Content_Types].xml'] = strToU8(
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>`
            + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')
            + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>`
            + '</Types>',
    );
    files['_rels/.rels'] = strToU8(`${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    files['xl/_rels/workbook.xml.rels'] = strToU8(
        `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
            + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
            + `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
    );
    files['xl/styles.xml'] = strToU8(stylesXml());
    files['xl/workbook.xml'] = strToU8(
        `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr/><bookViews><workbookView/></bookViews><sheets>`
            + names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
            + '</sheets></workbook>',
    );
    sheets.forEach((s, i) => {
        files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
    });
    return zipSync(files, { level: 6 });
}
