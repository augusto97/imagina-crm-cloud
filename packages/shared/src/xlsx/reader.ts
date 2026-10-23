/**
 * Lector de .xlsx (Office Open XML) — sin dependencias más allá de `fflate`.
 *
 * Se usa en el NAVEGADOR al importar: el archivo nunca viaja al servidor, que
 * sólo recibe la hoja elegida ya convertida (ver `xlsxSheetToImportTable`).
 * Por eso el lector es estricto con lo que puede salir caro o ser hostil:
 * topes de tamaño en el archivo, en cada parte DESCOMPRIMIDA y en las filas
 * (`XLSX_READ_LIMITS`), y rechazo de DTD/entidades en el XML.
 *
 * Lo que entiende: hojas (incluidas las ocultas), textos compartidos y en
 * línea (con formato enriquecido), números con su formato (fecha, fecha y
 * hora, hora, duración, porcentaje, moneda), sistema de fechas 1904,
 * booleanos, errores y fórmulas (se usa el ÚLTIMO VALOR CALCULADO que guardó
 * Excel; una fórmula sin valor se cuenta para avisarlo).
 */
import { decodeXmlBytes, inflateEntry, readZipDirectory, type ZipEntry } from './zip';
import { classifyNumFmt, type NumFmtKind } from './numfmt';
import { civilFromExcelSerial, type CivilDateTime } from './serial';
import { decodeEntities, decodeOoxmlEscapes, scanXml } from './xml';
import { XlsxError } from './errors';

export interface XlsxReadLimits {
    /** Tamaño del archivo tal como se sube. */
    maxFileBytes: number;
    /** Cada parte (XML) ya descomprimida. */
    maxPartBytes: number;
    /** Filas de DATOS que se leen (las siguientes sólo se cuentan). */
    maxRows: number;
    /** Columnas que se leen (las de más a la derecha se ignoran). */
    maxCols: number;
}

/**
 * Topes del import. 5.000 filas es lo que procesa una importación (el mismo
 * tope que el CSV y que «actualizar desde un archivo»).
 */
export const XLSX_READ_LIMITS: XlsxReadLimits = {
    maxFileBytes: 15 * 1024 * 1024,
    maxPartBytes: 120 * 1024 * 1024,
    maxRows: 5000,
    maxCols: 500,
};

export type XlsxCell =
    | { t: 'str'; v: string }
    | { t: 'num'; v: number; kind: NumFmtKind }
    | { t: 'bool'; v: boolean }
    /** Fecha (con hora si `time`), como reloj de pared: sin zona. */
    | { t: 'date'; v: CivilDateTime; time: boolean }
    | { t: 'err'; v: string };

export interface XlsxRow {
    /** Número de fila en la hoja (1 = la primera). */
    r: number;
    cells: Array<XlsxCell | null>;
}

export interface XlsxSheetInfo {
    index: number;
    name: string;
    hidden: boolean;
    /** Filas que declara la hoja (aproximado: incluye la cabecera); null si no lo dice. */
    rowsHint: number | null;
}

export interface XlsxSheet {
    name: string;
    /** Filas con al menos una celda con valor, en orden (hasta el tope + la cabecera). */
    rows: XlsxRow[];
    /** Filas con valor en TODA la hoja (aunque pasen del tope). */
    totalRows: number;
    truncated: boolean;
    colsTruncated: boolean;
    /** Fórmulas sin valor calculado guardado (quedan vacías). */
    formulasWithoutValue: number;
    /** Celdas con error (`#N/A`, `#DIV/0!`…): quedan vacías. */
    errorCells: number;
}

export interface XlsxWorkbook {
    sheets: XlsxSheetInfo[];
    /** La hoja que estaba abierta al guardar (si es visible), si no la primera visible. */
    defaultSheet: number;
    readSheet(index: number): XlsxSheet;
}

interface Rel {
    type: string;
    target: string;
}

/** Abre un libro: lee la lista de hojas sin leer todavía su contenido. */
export function openXlsx(bytes: Uint8Array, limits: Partial<XlsxReadLimits> = {}): XlsxWorkbook {
    const lim: XlsxReadLimits = { ...XLSX_READ_LIMITS, ...limits };
    if (bytes.length > lim.maxFileBytes) {
        throw new XlsxError(
            'too_large',
            `El archivo pesa ${mb(bytes.length)} y el máximo para importar es ${mb(lim.maxFileBytes)}. Divídelo o quita las hojas que no necesitas.`,
        );
    }
    const dir = readZipDirectory(bytes);
    const lower = new Map<string, ZipEntry>();
    for (const [k, v] of dir) lower.set(k.toLowerCase(), v);
    const entry = (path: string): ZipEntry | undefined => dir.get(path) ?? lower.get(path.toLowerCase());
    const readPart = (path: string): string | null => {
        const e = entry(path);
        return e ? decodeXmlBytes(inflateEntry(bytes, e, lim.maxPartBytes)) : null;
    };

    // Dónde está el libro: lo dice `_rels/.rels` (casi siempre `xl/workbook.xml`).
    const rootRels = parseRels(readPart('_rels/.rels'), '');
    const officeDoc = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'));
    const workbookPath = officeDoc?.target ?? 'xl/workbook.xml';
    const workbookXml = readPart(workbookPath);
    if (workbookXml === null) throw new XlsxError('not_xlsx', 'El archivo no es un libro de Excel (.xlsx).');
    const base = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1) : '';
    const wbRels = parseRels(readPart(`${base}_rels/${workbookPath.slice(base.length)}.rels`), base);

    let date1904 = false;
    let activeTab = 0;
    const declared: Array<{ name: string; hidden: boolean; relId: string }> = [];
    scanXml(workbookXml, {
        open(name, a) {
            if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
            else if (name === 'workbookView' && a.activeTab !== undefined) activeTab = Number(a.activeTab) || 0;
            else if (name === 'sheet') declared.push({ name: a.name ?? '', hidden: a.state === 'hidden' || a.state === 'veryHidden', relId: a.id ?? '' });
        },
    });

    // Sólo hojas de cálculo (no las de gráfico ni las de macros).
    const sheets: Array<XlsxSheetInfo & { path: string }> = [];
    declared.forEach((s, i) => {
        const rel = wbRels.get(s.relId);
        if (!rel || !rel.type.endsWith('/worksheet') || !entry(rel.target)) return;
        sheets.push({ index: sheets.length, name: s.name || `Hoja ${i + 1}`, hidden: s.hidden, rowsHint: null, path: rel.target });
    });
    if (sheets.length === 0) throw new XlsxError('no_sheets', 'El libro no tiene hojas con datos.');
    for (const s of sheets) s.rowsHint = peekRows(bytes, entry(s.path)!);

    const visible = sheets.filter((s) => !s.hidden);
    const declaredActive = declared[activeTab];
    const active = declaredActive ? sheets.find((s) => s.name === (declaredActive.name || '') && !s.hidden) : undefined;
    const defaultSheet = active?.index ?? visible[0]?.index ?? 0;

    // Textos compartidos y estilos: se leen una vez, al leer la primera hoja.
    let shared: string[] | null = null;
    let styleKinds: NumFmtKind[] | null = null;
    const relOf = (suffix: string, fallback: string): string =>
        [...wbRels.values()].find((r) => r.type.endsWith(suffix))?.target ?? fallback;

    return {
        sheets: sheets.map((s) => ({ index: s.index, name: s.name, hidden: s.hidden, rowsHint: s.rowsHint })),
        defaultSheet,
        readSheet(index: number): XlsxSheet {
            const s = sheets[index];
            if (!s) throw new XlsxError('no_sheets', 'Esa hoja no existe en el archivo.');
            shared ??= parseSharedStrings(readPart(relOf('/sharedStrings', `${base}sharedStrings.xml`)));
            styleKinds ??= parseStyleKinds(readPart(relOf('/styles', `${base}styles.xml`)));
            const xml = readPart(s.path);
            if (xml === null) throw new XlsxError('corrupt', 'No se encontró el contenido de la hoja.');
            return parseSheet(s.name, xml, shared, styleKinds, date1904, lim);
        },
    };
}

/** Relaciones de una parte: Id → { tipo, destino ya resuelto como ruta del zip }. */
function parseRels(xml: string | null, base: string): Map<string, Rel> {
    const out = new Map<string, Rel>();
    if (xml === null) return out;
    scanXml(xml, {
        open(name, a) {
            if (name !== 'Relationship' || !a.Id || !a.Target || a.TargetMode === 'External') return;
            out.set(a.Id, { type: a.Type ?? '', target: resolvePath(base, a.Target) });
        },
    });
    return out;
}

function resolvePath(base: string, target: string): string {
    const t = target.replace(/\\/g, '/');
    const parts = (t.startsWith('/') ? t.slice(1) : base + t).split('/');
    const out: string[] = [];
    for (const p of parts) {
        if (p === '..') out.pop();
        else if (p !== '.' && p !== '') out.push(p);
    }
    return out.join('/');
}

/** Cuántas filas declara la hoja (`<dimension ref="A1:K201">`), leyendo sólo su principio. */
function peekRows(bytes: Uint8Array, e: ZipEntry): number | null {
    try {
        const head = decodeXmlBytes(inflateEntry(bytes, e, 64 * 1024, 4096));
        const m = /<(?:\w+:)?dimension\s+ref="[A-Z]+\d+(?::[A-Z]+(\d+))?"/i.exec(head);
        if (!m) return null;
        return m[1] ? Number(m[1]) : 1;
    } catch {
        return null;
    }
}

function parseSharedStrings(xml: string | null): string[] {
    const out: string[] = [];
    if (xml === null) return out;
    let cur: string[] | null = null;
    let inT = false;
    let phonetic = 0;
    scanXml(xml, {
        open(name, _a, self) {
            if (name === 'si') cur = [];
            else if (name === 'rPh' && !self) phonetic++;
            else if (name === 't' && !self && phonetic === 0) inT = true;
        },
        close(name) {
            if (name === 't') inT = false;
            else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
            else if (name === 'si' && cur) {
                out.push(decodeOoxmlEscapes(cur.join('')));
                cur = null;
            }
        },
        text(raw) {
            if (inT && cur) cur.push(decodeEntities(raw));
        },
    });
    return out;
}

/** Qué es cada estilo de celda (`s` del `<c>`), según su formato de número. */
function parseStyleKinds(xml: string | null): NumFmtKind[] {
    if (xml === null) return [];
    const custom = new Map<number, string>();
    const xfIds: number[] = [];
    let inCellXfs = false;
    scanXml(xml, {
        open(name, a) {
            if (name === 'numFmt' && a.numFmtId !== undefined) custom.set(Number(a.numFmtId), a.formatCode ?? '');
            else if (name === 'cellXfs') inCellXfs = true;
            else if (name === 'xf' && inCellXfs) xfIds.push(Number(a.numFmtId ?? 0) || 0);
        },
        close(name) {
            if (name === 'cellXfs') inCellXfs = false;
        },
    });
    return xfIds.map((id) => classifyNumFmt(id, custom.get(id)));
}

/** `B12` → índice de columna 1 (A = 0). */
function columnIndex(ref: string): number {
    let col = 0;
    for (let i = 0; i < ref.length; i++) {
        const c = ref.charCodeAt(i);
        if (c >= 65 && c <= 90) col = col * 26 + (c - 64);
        else if (c >= 97 && c <= 122) col = col * 26 + (c - 96);
        else break;
    }
    return col - 1;
}

function parseSheet(
    name: string,
    xml: string,
    shared: string[],
    styleKinds: NumFmtKind[],
    date1904: boolean,
    lim: XlsxReadLimits,
): XlsxSheet {
    const sheet: XlsxSheet = {
        name,
        rows: [],
        totalRows: 0,
        truncated: false,
        colsTruncated: false,
        formulasWithoutValue: 0,
        errorCells: 0,
    };
    // Se guarda la cabecera + las filas de datos del tope; un margen de 10
    // filas deja que la cabecera NO sea la primera fila con algo (un título
    // arriba de la tabla).
    const keep = lim.maxRows + 11;

    let rowNum = 0;
    let row: Array<XlsxCell | null> | null = null;
    let rowHasValue = false;
    let col = -1;
    let cellType = 'n';
    let cellStyle = 0;
    let value: string[] | null = null;
    let inline: string[] | null = null;
    let capture: 'v' | 't' | null = null;
    let phonetic = 0;
    let formula = false;

    const finishCell = (): void => {
        const cell = makeCell();
        if (cell !== null && row !== null) {
            if (col >= lim.maxCols) {
                sheet.colsTruncated = true;
            } else if (col >= 0) {
                while (row.length < col) row.push(null);
                row[col] = cell;
                rowHasValue = true;
            }
        } else if (cell !== null) {
            rowHasValue = true;
        }
    };

    const makeCell = (): XlsxCell | null => {
        const raw = value === null ? null : decodeEntities(value.join(''));
        switch (cellType) {
            case 's': {
                if (raw === null || raw.trim() === '') return null;
                const text = shared[Number(raw)] ?? '';
                return text === '' ? null : { t: 'str', v: text };
            }
            case 'inlineStr': {
                // Algunos generadores ponen el texto en `<v>` en vez de `<is>`.
                const text = decodeOoxmlEscapes(inline !== null ? inline.join('') : (raw ?? ''));
                return text === '' ? null : { t: 'str', v: text };
            }
            case 'str': {
                if (raw === null) {
                    if (formula) sheet.formulasWithoutValue++;
                    return null;
                }
                const text = decodeOoxmlEscapes(raw);
                return text === '' ? null : { t: 'str', v: text };
            }
            case 'b':
                return raw === null ? null : { t: 'bool', v: raw.trim() === '1' || raw.trim() === 'true' };
            case 'e':
                if (raw === null) return null;
                sheet.errorCells++;
                return { t: 'err', v: raw };
            case 'd': {
                const m = raw === null ? null : /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw.trim());
                if (!m) return null;
                const civil: CivilDateTime = {
                    y: Number(m[1]),
                    m: Number(m[2]),
                    d: Number(m[3]),
                    h: Number(m[4] ?? 0),
                    mi: Number(m[5] ?? 0),
                    s: Number(m[6] ?? 0),
                };
                return { t: 'date', v: civil, time: m[4] !== undefined };
            }
            default: {
                if (raw === null || raw.trim() === '') {
                    if (formula) sheet.formulasWithoutValue++;
                    return null;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return null;
                const kind = styleKinds[cellStyle] ?? 'general';
                if (kind === 'date' || kind === 'datetime') {
                    const civil = civilFromExcelSerial(n, date1904);
                    if (civil === null) return { t: 'num', v: n, kind: 'number' };
                    return { t: 'date', v: civil, time: kind === 'datetime' };
                }
                return { t: 'num', v: n, kind };
            }
        }
    };

    scanXml(xml, {
        open(tag, a, self) {
            switch (tag) {
                case 'row':
                    rowNum = a.r !== undefined ? Number(a.r) || rowNum + 1 : rowNum + 1;
                    row = sheet.rows.length < keep ? [] : null;
                    rowHasValue = false;
                    col = -1;
                    if (self) closeRow();
                    break;
                case 'c':
                    col = a.r !== undefined ? columnIndex(a.r) : col + 1;
                    cellType = a.t ?? 'n';
                    cellStyle = a.s !== undefined ? Number(a.s) || 0 : 0;
                    value = null;
                    inline = null;
                    formula = false;
                    if (self) finishCell();
                    break;
                case 'v':
                    if (!self) {
                        value = [];
                        capture = 'v';
                    }
                    break;
                case 'f':
                    formula = true;
                    break;
                case 'is':
                    inline = [];
                    break;
                case 'rPh':
                    if (!self) phonetic++;
                    break;
                case 't':
                    if (!self && inline !== null && phonetic === 0) capture = 't';
                    break;
            }
        },
        close(tag) {
            switch (tag) {
                case 'v':
                case 't':
                    capture = null;
                    break;
                case 'rPh':
                    phonetic = Math.max(0, phonetic - 1);
                    break;
                case 'c':
                    finishCell();
                    break;
                case 'row':
                    closeRow();
                    break;
            }
        },
        text(raw) {
            if (capture === 'v') value?.push(raw);
            else if (capture === 't') inline?.push(decodeEntities(raw));
        },
    });

    function closeRow(): void {
        if (!rowHasValue) {
            row = null;
            return;
        }
        sheet.totalRows++;
        if (row !== null && sheet.rows.length < keep) {
            sheet.rows.push({ r: rowNum, cells: row });
        } else {
            sheet.truncated = true;
        }
        row = null;
    }

    return sheet;
}

function mb(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * El XML crudo de una parte del archivo (`xl/styles.xml`…), con los mismos
 * topes del lector. Para diagnóstico y pruebas.
 */
export function readXlsxPart(bytes: Uint8Array, path: string, maxBytes = XLSX_READ_LIMITS.maxPartBytes): string | null {
    const entry = readZipDirectory(bytes).get(path);
    return entry ? decodeXmlBytes(inflateEntry(bytes, entry, maxBytes)) : null;
}
