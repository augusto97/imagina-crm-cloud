/**
 * Escritor de .xlsx POR STREAMING: una hoja, fila a fila, sin armar el
 * archivo en memoria. Lo usa el export del servidor (una lista de 100.000
 * registros sale con memoria constante: se comprime a medida que se escribe
 * y cada tramo se manda al cliente respetando la contrapresión del socket).
 *
 * Lo que escribe: celdas de texto (siempre como TEXTO — una celda que empieza
 * con `=`, `+`, `-` o `@` nunca se vuelve fórmula, y además lleva el prefijo
 * de comilla de Excel para que tampoco lo sea al editarla), números con su
 * formato (moneda, porcentaje, fecha, duración), hipervínculos, encabezado en
 * negrita con filtro automático, filas/columnas inmovilizadas y anchos de
 * columna.
 */
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { xmlEscape } from './xml';

/** Una celda: texto, número con estilo, o texto con estilo (y enlace). `null` = vacía. */
export type XlsxOutCell =
    | null
    | string
    | { n: number; s?: number }
    | { text: string; link?: string; s?: number };

export interface XlsxStyle {
    /** Código de formato de número (`#,##0.00`, `dd/mm/yyyy`…). */
    numFmt?: string;
    bold?: boolean;
    /** Sangría (niveles). */
    indent?: number;
    /** Relleno sólido (hex `RRGGBB`). */
    fill?: string;
    /** Línea fina debajo. */
    borderBottom?: boolean;
    /** Azul y subrayado, como un hipervínculo. */
    link?: boolean;
}

export interface XlsxWriterOptions {
    sheetName: string;
    /** Filas de arriba inmovilizadas (1 = el encabezado). */
    freezeRows?: number;
    /** Columnas de la izquierda inmovilizadas. */
    freezeCols?: number;
    /** Filtro automático sobre el encabezado (fila 1). */
    autoFilter?: boolean;
    /** Nivel de compresión (1-9). */
    level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Máximo de caracteres de una celda en Excel. */
export const XLSX_MAX_CELL_CHARS = 32_767;
/** Máximo de hipervínculos por hoja en Excel. */
const MAX_LINKS = 65_000;

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

type Sink = (chunk: Uint8Array) => void | Promise<void>;

interface StyleEntry {
    numFmtId: number;
    fontId: number;
    fillId: number;
    borderId: number;
    indent: number;
    quotePrefix: boolean;
}

export class XlsxStreamWriter {
    private readonly zip: Zip;
    private readonly out: Uint8Array[] = [];
    private zipError: Error | null = null;
    private sheet: ZipDeflate | null = null;
    private buffer: string[] = [];
    private bufferLen = 0;
    private rowNum = 0;
    private maxCol = 0;
    private readonly links: Array<{ ref: string; url: string }> = [];
    private started = false;
    private finished = false;

    private readonly numFmts = new Map<string, number>();
    private readonly fills: string[] = [];
    private readonly styles: StyleEntry[] = [{ numFmtId: 0, fontId: 0, fillId: 0, borderId: 0, indent: 0, quotePrefix: false }];
    private readonly styleKeys = new Map<string, number>();
    /** Estilo → su gemelo con el prefijo de comilla (para textos que parecen fórmula). */
    private readonly quoted = new Map<number, number>();
    private readonly linkStyle: number;

    constructor(
        private readonly sink: Sink,
        private readonly opts: XlsxWriterOptions,
    ) {
        this.zip = new Zip((err, chunk) => {
            if (err) this.zipError = err;
            else this.out.push(chunk);
        });
        this.styleKeys.set(this.keyOf(this.styles[0]!), 0);
        this.linkStyle = this.style({ link: true });
    }

    /** Registra un estilo y devuelve su índice. Sólo ANTES de `begin`. */
    style(spec: XlsxStyle): number {
        if (this.started) throw new Error('XlsxStreamWriter: los estilos se registran antes de begin()');
        const entry: StyleEntry = {
            numFmtId: spec.numFmt ? this.numFmtId(spec.numFmt) : 0,
            fontId: spec.link ? 2 : spec.bold ? 1 : 0,
            fillId: spec.fill ? this.fillId(spec.fill) : 0,
            borderId: spec.borderBottom ? 1 : 0,
            indent: Math.max(0, Math.min(15, Math.floor(spec.indent ?? 0))),
            quotePrefix: false,
        };
        const idx = this.intern(entry);
        // Su gemelo "texto literal" (quotePrefix) para las celdas que empiezan con = + - @.
        this.quoted.set(idx, this.intern({ ...entry, quotePrefix: true }));
        return idx;
    }

    /** Escribe las partes fijas y abre la hoja. `widths`: ancho de cada columna (en caracteres). */
    async begin(widths: number[]): Promise<void> {
        if (this.started) return;
        this.started = true;
        // El estilo por defecto también tiene su gemelo.
        if (!this.quoted.has(0)) this.quoted.set(0, this.intern({ ...this.styles[0]!, quotePrefix: true }));
        this.addFile('[Content_Types].xml', contentTypes());
        this.addFile('_rels/.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
        this.addFile(
            'xl/_rels/workbook.xml.rels',
            `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
        );
        this.addFile('xl/styles.xml', this.stylesXml());

        this.sheet = new ZipDeflate('xl/worksheets/sheet1.xml', { level: this.opts.level ?? 6 });
        this.zip.add(this.sheet);
        const cols = widths
            .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w)).toFixed(2)}" customWidth="1"/>`)
            .join('');
        this.sheet.push(
            strToU8(
                `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
                    + `<sheetViews>${this.sheetView()}</sheetViews>`
                    + '<sheetFormatPr defaultRowHeight="15"/>'
                    + (cols !== '' ? `<cols>${cols}</cols>` : '')
                    + '<sheetData>',
            ),
        );
        await this.drain();
    }

    /** Agrega una fila (al buffer; `flush` la manda). */
    row(cells: XlsxOutCell[], defaultStyle = 0): void {
        if (!this.sheet || this.finished) throw new Error('XlsxStreamWriter: fila fuera de begin()/finish()');
        this.rowNum++;
        const r = this.rowNum;
        let xml = `<row r="${r}">`;
        cells.forEach((cell, i) => {
            if (cell === null || cell === undefined) return;
            const ref = `${columnName(i)}${r}`;
            if (typeof cell === 'string') {
                if (cell === '') return;
                xml += this.textCell(ref, cell, defaultStyle);
            } else if ('n' in cell) {
                if (!Number.isFinite(cell.n)) return;
                const s = cell.s ?? defaultStyle;
                xml += `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${String(cell.n)}</v></c>`;
            } else {
                if (cell.text === '') return;
                const url = cell.link === undefined ? null : safeLink(cell.link);
                if (url !== null && this.links.length < MAX_LINKS) {
                    this.links.push({ ref, url });
                    xml += this.textCell(ref, cell.text, cell.s ?? this.linkStyle);
                } else {
                    xml += this.textCell(ref, cell.text, cell.s ?? defaultStyle);
                }
            }
            if (i + 1 > this.maxCol) this.maxCol = i + 1;
        });
        xml += '</row>';
        this.buffer.push(xml);
        this.bufferLen += xml.length;
    }

    /** ¿Conviene mandar lo acumulado? (para llamar a `flush` cada tanto). */
    get pendingChars(): number {
        return this.bufferLen;
    }

    /** Comprime lo acumulado y lo manda (esperando si el destino está lleno). */
    async flush(): Promise<void> {
        if (!this.sheet || this.buffer.length === 0) return;
        this.sheet.push(strToU8(this.buffer.join('')));
        this.buffer = [];
        this.bufferLen = 0;
        await this.drain();
    }

    /** Cierra la hoja y el libro. Devuelve cuántas filas se escribieron (con el encabezado). */
    async finish(): Promise<number> {
        if (this.finished) return this.rowNum;
        if (!this.started) await this.begin([]);
        await this.flush();
        this.finished = true;
        const lastCol = columnName(Math.max(0, this.maxCol - 1));
        const range = `A1:${lastCol}${Math.max(1, this.rowNum)}`;
        let tail = '</sheetData>';
        if (this.opts.autoFilter && this.maxCol > 0) tail += `<autoFilter ref="${range}"/>`;
        if (this.links.length > 0) {
            tail += '<hyperlinks>'
                + this.links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')
                + '</hyperlinks>';
        }
        tail += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
        this.sheet!.push(strToU8(tail), true);
        await this.drain();

        if (this.links.length > 0) {
            const rels = this.links
                .map((l, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/hyperlink" Target="${xmlEscape(l.url)}" TargetMode="External"/>`)
                .join('');
            this.addFile('xl/worksheets/_rels/sheet1.xml.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`);
        }
        const sheetName = xmlEscape(this.opts.sheetName);
        const definedNames = this.opts.autoFilter && this.maxCol > 0
            ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xmlEscape(quoteSheet(this.opts.sheetName))}!${absolute(range)}</definedName></definedNames>`
            : '';
        this.addFile(
            'xl/workbook.xml',
            `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr/><bookViews><workbookView/></bookViews>`
                + `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${definedNames}</workbook>`,
        );
        this.zip.end();
        await this.drain();
        return this.rowNum;
    }

    // ── Detalles ────────────────────────────────────────────────────────

    private textCell(ref: string, raw: string, style: number): string {
        const text = raw.length > XLSX_MAX_CELL_CHARS ? `${raw.slice(0, XLSX_MAX_CELL_CHARS - 1)}…` : raw;
        // Lo que Excel tomaría por fórmula al EDITAR la celda va con el
        // prefijo de comilla (como si se hubiera tecleado `'=…`). Al abrir el
        // archivo nunca se evalúa: una celda de texto no tiene fórmula.
        const s = /^[=+\-@]/.test(text) ? (this.quoted.get(style) ?? style) : style;
        const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
        return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t${space}>${xmlEscape(text)}</t></is></c>`;
    }

    private sheetView(): string {
        const rows = Math.max(0, this.opts.freezeRows ?? 0);
        const cols = Math.max(0, this.opts.freezeCols ?? 0);
        if (rows === 0 && cols === 0) return '<sheetView workbookViewId="0" tabSelected="1"/>';
        const topLeft = `${columnName(cols)}${rows + 1}`;
        const pane = rows > 0 && cols > 0 ? 'bottomRight' : rows > 0 ? 'bottomLeft' : 'topRight';
        return '<sheetView workbookViewId="0" tabSelected="1">'
            + `<pane${cols > 0 ? ` xSplit="${cols}"` : ''}${rows > 0 ? ` ySplit="${rows}"` : ''} topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/>`
            + `<selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/>`
            + '</sheetView>';
    }

    private addFile(name: string, content: string): void {
        const f = new ZipDeflate(name, { level: 6 });
        this.zip.add(f);
        f.push(strToU8(content), true);
    }

    private async drain(): Promise<void> {
        if (this.zipError) throw this.zipError;
        while (this.out.length > 0) {
            const chunk = this.out.shift()!;
            await this.sink(chunk);
        }
    }

    private numFmtId(code: string): number {
        const builtin = BUILTIN_FORMATS[code];
        if (builtin !== undefined) return builtin;
        const hit = this.numFmts.get(code);
        if (hit !== undefined) return hit;
        const id = 164 + this.numFmts.size;
        this.numFmts.set(code, id);
        return id;
    }

    private fillId(hex: string): number {
        const clean = hex.replace(/^#/, '').toUpperCase();
        const i = this.fills.indexOf(clean);
        if (i !== -1) return i + 2;
        this.fills.push(clean);
        return this.fills.length + 1;
    }

    private keyOf(e: StyleEntry): string {
        return `${e.numFmtId}|${e.fontId}|${e.fillId}|${e.borderId}|${e.indent}|${e.quotePrefix ? 1 : 0}`;
    }

    private intern(e: StyleEntry): number {
        const key = this.keyOf(e);
        const hit = this.styleKeys.get(key);
        if (hit !== undefined) return hit;
        this.styles.push(e);
        const idx = this.styles.length - 1;
        this.styleKeys.set(key, idx);
        return idx;
    }

    private stylesXml(): string {
        const numFmts = [...this.numFmts]
            .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`)
            .join('');
        const font = (extra: string): string => `<font>${extra}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
        const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
            .concat(this.fills.map((hex) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`));
        const xfs = this.styles
            .map((s) => {
                const attrs = [
                    `numFmtId="${s.numFmtId}"`,
                    `fontId="${s.fontId}"`,
                    `fillId="${s.fillId}"`,
                    `borderId="${s.borderId}"`,
                    'xfId="0"',
                    s.numFmtId ? 'applyNumberFormat="1"' : '',
                    s.fontId ? 'applyFont="1"' : '',
                    s.fillId ? 'applyFill="1"' : '',
                    s.borderId ? 'applyBorder="1"' : '',
                    s.indent ? 'applyAlignment="1"' : '',
                    s.quotePrefix ? 'quotePrefix="1"' : '',
                ].filter(Boolean).join(' ');
                return s.indent ? `<xf ${attrs}><alignment indent="${s.indent}"/></xf>` : `<xf ${attrs}/>`;
            })
            .join('');
        return `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">`
            + (numFmts !== '' ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : '')
            + `<fonts count="3">${font('')}${font('<b/>')}${font('<u/><color rgb="FF0563C1"/>')}</fonts>`
            + `<fills count="${fills.length}">${fills.join('')}</fills>`
            + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
            + '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>'
            + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            + `<cellXfs count="${this.styles.length}">${xfs}</cellXfs>`
            + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            + '</styleSheet>';
    }
}

/** Formatos que ya trae Excel (no hace falta declararlos). */
const BUILTIN_FORMATS: Record<string, number> = {
    General: 0,
    '0': 1,
    '0.00': 2,
    '#,##0': 3,
    '#,##0.00': 4,
    '0%': 9,
    '0.00%': 10,
    '@': 49,
};

function contentTypes(): string {
    const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
    return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>`
        + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>`
        + '</Types>';
}

/** Índice de columna (0 = A) → letras de Excel. */
export function columnName(index: number): string {
    let n = index + 1;
    let s = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function quoteSheet(name: string): string {
    return `'${name.replace(/'/g, "''")}'`;
}

function absolute(range: string): string {
    return range.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
}

/** Sólo enlaces web y de correo se vuelven hipervínculos (nada de `javascript:` ni `file:`). */
function safeLink(url: string): string | null {
    const u = url.trim();
    if (/^https?:\/\/[^\s]+$/i.test(u) || /^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return u.slice(0, 2000);
    return null;
}

/**
 * Nombre de hoja válido para Excel: sin `[]:*?/\`, sin apóstrofo al
 * principio o al final, hasta 31 caracteres y nunca «History» (reservado).
 */
export function sanitizeSheetName(name: string, fallback = 'Hoja1'): string {
    let s = name
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F[\]:*?/\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^'+|'+$/g, '')
        .trim();
    if (s.length > 31) s = s.slice(0, 31).trim();
    if (s === '' || s.toLowerCase() === 'history') s = fallback;
    return s;
}

/**
 * Registros por planilla exportada. Excel admite ~1 millón de filas, pero
 * una exportación así tarda minutos y casi nadie la puede abrir: más allá de
 * esto se pide filtrar o exportar en CSV (que no tiene tope).
 */
export const XLSX_EXPORT_MAX_ROWS = 100_000;
