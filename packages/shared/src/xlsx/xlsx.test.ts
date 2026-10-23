import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
    XlsxError,
    XlsxStreamWriter,
    canonicalNumber,
    civilFromExcelSerial,
    classifyFormatCode,
    classifyNumFmt,
    columnName,
    excelSerialFromCivil,
    openXlsx,
    sanitizeSheetName,
    tableToCsv,
    xlsxSheetToImportTable,
    xmlEscape,
    type XlsxCell,
} from './index';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Arma un .xlsx a mano (como lo haría otro programa) para probar el lector. */
function buildXlsx(parts: {
    sheets: Array<{ name: string; xml: string; state?: string; chart?: boolean }>;
    shared?: string;
    styles?: string;
    workbookPr?: string;
    activeTab?: number;
    prefix?: string;
}): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    files['[Content_Types].xml'] = strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    files['_rels/.rels'] = strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    const p = parts.prefix ? `${parts.prefix}:` : '';
    const xmlns = parts.prefix ? `xmlns:${parts.prefix}="${NS}"` : `xmlns="${NS}"`;
    const rels: string[] = [];
    const sheetsXml = parts.sheets
        .map((s, i) => {
            const target = s.chart ? `chartsheets/sheet${i + 1}.xml` : `worksheets/sheet${i + 1}.xml`;
            rels.push(`<Relationship Id="rId${i + 1}" Type="${REL}/${s.chart ? 'chartsheet' : 'worksheet'}" Target="${target}"/>`);
            files[`xl/${target}`] = strToU8(s.xml);
            return `<${p}sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`;
        })
        .join('');
    if (parts.shared) {
        rels.push(`<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
        files['xl/sharedStrings.xml'] = strToU8(parts.shared);
    }
    if (parts.styles) {
        rels.push(`<Relationship Id="rIdT" Type="${REL}/styles" Target="/xl/styles.xml"/>`);
        files['xl/styles.xml'] = strToU8(parts.styles);
    }
    files['xl/_rels/workbook.xml.rels'] = strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    );
    files['xl/workbook.xml'] = strToU8(
        `<?xml version="1.0"?><${p}workbook ${xmlns} xmlns:r="${REL}">${parts.workbookPr ?? ''}`
            + `<${p}bookViews><${p}workbookView activeTab="${parts.activeTab ?? 0}"/></${p}bookViews><${p}sheets>${sheetsXml}</${p}sheets></${p}workbook>`,
    );
    return zipSync(files);
}

const sheetXml = (rows: string, prefix = ''): string => {
    const p = prefix ? `${prefix}:` : '';
    const ns = prefix ? `xmlns:${prefix}="${NS}"` : `xmlns="${NS}"`;
    return `<?xml version="1.0"?><${p}worksheet ${ns}><${p}dimension ref="A1:D3"/><${p}sheetData>${rows}</${p}sheetData></${p}worksheet>`;
};

/** Escribe con el writer y junta los bytes. */
async function writeBook(build: (w: XlsxStreamWriter) => Promise<void> | void, opts = { sheetName: 'Datos' }): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const w = new XlsxStreamWriter((c) => {
        chunks.push(c);
    }, { ...opts, freezeRows: 1, autoFilter: true });
    await build(w);
    await w.finish();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

describe('fechas de Excel', () => {
    it('ida y vuelta, incluido el 29/2/1900 que no existe y la hora', () => {
        expect(excelSerialFromCivil(1900, 1, 1)).toBe(1);
        expect(excelSerialFromCivil(1900, 2, 28)).toBe(59);
        expect(excelSerialFromCivil(1900, 3, 1)).toBe(61);
        expect(excelSerialFromCivil(2026, 7, 30)).toBe(46233);
        expect(excelSerialFromCivil(1899, 12, 31)).toBeNull();
        const s = excelSerialFromCivil(2026, 7, 30, 14, 30)!;
        expect(civilFromExcelSerial(s)).toEqual({ y: 2026, m: 7, d: 30, h: 14, mi: 30, s: 0 });
        // Ruido de punto flotante: 14:29:59.9999 es 14:30.
        expect(civilFromExcelSerial(46233.604166666)).toMatchObject({ h: 14, mi: 30, s: 0 });
        expect(civilFromExcelSerial(60)).toMatchObject({ y: 1900, m: 2, d: 28 });
        // Sistema 1904 (Excel viejo de Mac): el día 0 es el 1/1/1904.
        expect(civilFromExcelSerial(0, true)).toMatchObject({ y: 1904, m: 1, d: 1 });
        expect(civilFromExcelSerial(44771, true)).toMatchObject({ y: 2026, m: 7, d: 30 });
    });
});

describe('formatos de número', () => {
    it('clasifica integrados y propios', () => {
        expect(classifyNumFmt(14)).toBe('date');
        expect(classifyNumFmt(22)).toBe('datetime');
        expect(classifyNumFmt(46)).toBe('elapsed');
        expect(classifyNumFmt(9)).toBe('percent');
        expect(classifyNumFmt(0)).toBe('general');
        expect(classifyNumFmt(57)).toBe('date');
        expect(classifyFormatCode('dd/mm/yyyy')).toBe('date');
        expect(classifyFormatCode('dd/mm/yyyy hh:mm')).toBe('datetime');
        expect(classifyFormatCode('[$-409]d-mmm-yy;@')).toBe('date');
        expect(classifyFormatCode('h:mm AM/PM')).toBe('time');
        expect(classifyFormatCode('[h]:mm')).toBe('elapsed');
        expect(classifyFormatCode('0.00%')).toBe('percent');
        expect(classifyFormatCode('"$ "#,##0.00')).toBe('currency');
        expect(classifyFormatCode('[$€-C0A] #,##0.00')).toBe('currency');
        expect(classifyFormatCode('#,##0 "COP"')).toBe('currency');
        expect(classifyFormatCode('#,##0.00;[Red]-#,##0.00')).toBe('number');
        expect(classifyFormatCode('0 "días"')).toBe('number');
        expect(classifyFormatCode('@')).toBe('text');
        expect(classifyFormatCode('mmmm')).toBe('date');
    });
});

describe('número canónico (lo que viaja al import)', () => {
    it('sin miles, con el decimal de la empresa y sin ruido', () => {
        expect(canonicalNumber(1234.5, '.')).toBe('1234.5');
        expect(canonicalNumber(1234.5, ',')).toBe('1234,5');
        expect(canonicalNumber(1.234, '.')).toBe('1.234');
        expect(canonicalNumber(0.1 + 0.2, '.')).toBe('0.3');
        expect(canonicalNumber(3001112233, '.')).toBe('3001112233');
        expect(canonicalNumber(1e-7, '.')).toBe('0.0000001');
        expect(canonicalNumber(1e21, '.')).toBe('1000000000000000000000');
        expect(canonicalNumber(-0, '.')).toBe('0');
    });
});

describe('escritor por streaming → lector', () => {
    it('ida y vuelta con tipos reales, estilos y texto que parece fórmula', async () => {
        const bytes = await writeBook(async (w) => {
            const date = w.style({ numFmt: 'dd/mm/yyyy' });
            const dt = w.style({ numFmt: 'dd/mm/yyyy hh:mm' });
            const money = w.style({ numFmt: '"$ "#,##0.00' });
            const pct = w.style({ numFmt: '0%' });
            const dur = w.style({ numFmt: '[h]:mm' });
            const header = w.style({ bold: true, fill: 'F2F2F2', borderBottom: true });
            await w.begin([12, 12, 12, 12, 12, 12, 12, 12]);
            w.row(['Nombre', 'Fecha', 'Hora', 'Monto', 'Avance', 'Tiempo', 'Teléfono', 'Web'], header);
            w.row([
                '=HYPERLINK("http://evil","x")',
                { n: excelSerialFromCivil(2026, 7, 30)!, s: date },
                { n: excelSerialFromCivil(2026, 7, 30, 14, 30)!, s: dt },
                { n: 1250000.5, s: money },
                { n: 0.75, s: pct },
                { n: 90 / 1440, s: dur },
                '+573001112233',
                { text: 'https://acme.co/x?a=1&b=2', link: 'https://acme.co/x?a=1&b=2' },
            ]);
            w.row(['Línea 1\nLínea 2 <b>&', null, null, { n: -3.5, s: money }, null, null, ' con espacios ', { text: 'javascript:alert(1)', link: 'javascript:alert(1)' }]);
        });
        const book = openXlsx(bytes);
        expect(book.sheets).toEqual([{ index: 0, name: 'Datos', hidden: false, rowsHint: null }]);
        const sheet = book.readSheet(0);
        const [head, r1, r2] = sheet.rows;
        expect(head!.cells.map((c) => (c as { v: unknown }).v)).toEqual(['Nombre', 'Fecha', 'Hora', 'Monto', 'Avance', 'Tiempo', 'Teléfono', 'Web']);
        expect(r1!.cells[0]).toEqual({ t: 'str', v: '=HYPERLINK("http://evil","x")' });
        expect(r1!.cells[1]).toEqual({ t: 'date', v: { y: 2026, m: 7, d: 30, h: 0, mi: 0, s: 0 }, time: false });
        expect(r1!.cells[2]).toEqual({ t: 'date', v: { y: 2026, m: 7, d: 30, h: 14, mi: 30, s: 0 }, time: true });
        expect(r1!.cells[3]).toEqual({ t: 'num', v: 1250000.5, kind: 'currency' });
        expect(r1!.cells[4]).toEqual({ t: 'num', v: 0.75, kind: 'percent' });
        expect(r1!.cells[5]).toMatchObject({ t: 'num', kind: 'elapsed' });
        expect(r1!.cells[6]).toEqual({ t: 'str', v: '+573001112233' });
        expect(r2!.cells[0]).toEqual({ t: 'str', v: 'Línea 1\nLínea 2 <b>&' });
        expect(r2!.cells[6]).toEqual({ t: 'str', v: ' con espacios ' });

        const table = xlsxSheetToImportTable(sheet, { decimalSeparator: ',', maxRows: 5000 });
        expect(table.rows[0]).toEqual([
            '=HYPERLINK("http://evil","x")',
            '2026-07-30',
            '2026-07-30 14:30',
            '1250000,5',
            '75%',
            '1h 30m',
            '+573001112233',
            'https://acme.co/x?a=1&b=2',
        ]);
        expect(table.typeHints).toMatchObject({ 1: 'date', 2: 'datetime', 3: 'currency', 4: 'percent', 5: 'duration' });

        // El XML de la hoja: texto que parece fórmula = celda de TEXTO con
        // prefijo de comilla, nunca `<f>`; un solo hipervínculo (el http).
        const { unzipSync, strFromU8 } = await import('fflate');
        const files = unzipSync(bytes);
        const xml = strFromU8(files['xl/worksheets/sheet1.xml']!);
        expect(xml).not.toContain('<f>');
        expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
        expect(xml).toContain('<autoFilter ref="A1:H3"/>');
        expect(xml.match(/<hyperlink /g)).toHaveLength(1);
        const styles = strFromU8(files['xl/styles.xml']!);
        expect(styles).toContain('quotePrefix="1"');
        const rels = strFromU8(files['xl/worksheets/_rels/sheet1.xml.rels']!);
        expect(rels).toContain('Target="https://acme.co/x?a=1&amp;b=2"');
        const wb = strFromU8(files['xl/workbook.xml']!);
        expect(wb).toContain("_xlnm._FilterDatabase");
        expect(wb).toContain("'Datos'!$A$1:$H$3");
    });

    it('escribe miles de filas por tramos con memoria acotada', async () => {
        let maxChunk = 0;
        const chunks: Uint8Array[] = [];
        const w = new XlsxStreamWriter((c) => {
            maxChunk = Math.max(maxChunk, c.length);
            chunks.push(c);
        }, { sheetName: 'Grande' });
        await w.begin([10, 10]);
        for (let i = 0; i < 20_000; i++) {
            w.row([`Fila ${i}`, { n: i }]);
            if (w.pendingChars > 64_000) await w.flush();
        }
        const rows = await w.finish();
        expect(rows).toBe(20_000);
        const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let o = 0;
        for (const c of chunks) {
            bytes.set(c, o);
            o += c.length;
        }
        const sheet = openXlsx(bytes, { maxRows: 100_000 }).readSheet(0);
        expect(sheet.totalRows).toBe(20_000);
        expect(sheet.rows[19_999]!.cells).toEqual([{ t: 'str', v: 'Fila 19999' }, { t: 'num', v: 19_999, kind: 'general' }]);
    });
});

describe('lector: lo que generan otros programas', () => {
    it('textos compartidos con formato, en línea, fórmulas, errores, 1904 y prefijos', () => {
        const shared = `<sst xmlns="${NS}"><si><t>Cliente</t></si><si><r><t>Ac</t></r><r><rPr><b/></rPr><t xml:space="preserve">me S.A.</t></r><rPh><t>アクメ</t></rPh></si><si><t>Línea_x000D_\nsalto</t></si><si><t>Monto</t></si></sst>`;
        const styles = `<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="170" formatCode="dd/mm/yyyy;@"/></numFmts>`
            + '<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>'
            + '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="170" applyNumberFormat="1"><alignment/></xf><xf numFmtId="4"/></cellXfs></styleSheet>';
        const rows = '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>3</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Fecha</x:t></x:is></x:c><x:c r="D1" t="str"><x:v>Nota</x:v></x:c></x:row>'
            + '<x:row r="3"><x:c r="A3" t="s"><x:v>1</x:v></x:c><x:c r="B3" s="2"><x:f>SUM(1,2)</x:f><x:v>1500.25</x:v></x:c><x:c r="C3" s="1"><x:v>44771</x:v></x:c><x:c r="D3" t="s"><x:v>2</x:v></x:c></x:row>'
            + '<x:row r="4"><x:c r="A4" t="b"><x:v>1</x:v></x:c><x:c r="B4" t="e"><x:v>#DIV/0!</x:v></x:c><x:c r="C4" t="d"><x:v>2026-01-15T08:05:00</x:v></x:c><x:c r="D4"><x:f>A1+1</x:f></x:c></x:row>';
        const bytes = buildXlsx({
            prefix: 'x',
            workbookPr: '<x:workbookPr date1904="1"/>',
            sheets: [{ name: 'Hoja 1', xml: sheetXml(rows, 'x') }],
            shared,
            styles,
        });
        const book = openXlsx(bytes);
        expect(book.sheets[0]).toMatchObject({ name: 'Hoja 1', rowsHint: 3 });
        const sheet = book.readSheet(0);
        expect(sheet.totalRows).toBe(3);
        expect(sheet.formulasWithoutValue).toBe(1);
        expect(sheet.errorCells).toBe(1);
        const table = xlsxSheetToImportTable(sheet, { decimalSeparator: '.', maxRows: 5000 });
        expect(table.headers).toEqual(['Cliente', 'Monto', 'Fecha', 'Nota']);
        expect(table.rows).toEqual([
            ['Acme S.A.', '1500.25', '2026-07-30', 'Línea\r\nsalto'],
            ['Sí', '', '2026-01-15 08:05', ''],
        ]);
    });

    it('elige la hoja activa visible, salta gráficos y lista las ocultas', () => {
        const one = sheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>');
        const bytes = buildXlsx({
            activeTab: 2,
            sheets: [
                { name: 'Resumen', xml: one },
                { name: 'Gráfico', xml: '<chartsheet/>', chart: true },
                { name: 'Clientes', xml: one },
                { name: 'Interna', xml: one, state: 'hidden' },
            ],
        });
        const book = openXlsx(bytes);
        expect(book.sheets.map((s) => [s.name, s.hidden])).toEqual([
            ['Resumen', false],
            ['Clientes', false],
            ['Interna', true],
        ]);
        expect(book.sheets[book.defaultSheet]!.name).toBe('Clientes');
    });

    it('un título arriba de la tabla (celda combinada) no es la cabecera', () => {
        const t = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
        const rows = `<row r="1">${t('B1', 'Reporte de ventas 2026')}</row><row r="3">${t('B3', 'Cliente')}${t('C3', 'Ciudad')}${t('D3', 'Total')}</row>`
            + `<row r="4">${t('B4', 'Acme')}<c r="D4"><v>10</v></c></row>`;
        const table = xlsxSheetToImportTable(openXlsx(buildXlsx({ sheets: [{ name: 'S', xml: sheetXml(rows) }] })).readSheet(0), {
            decimalSeparator: '.',
            maxRows: 5000,
        });
        expect(table.skippedTopRows).toBe(1);
        // La columna A (vacía) no viaja.
        expect(table.headers).toEqual(['Cliente', 'Ciudad', 'Total']);
        expect(table.rows).toEqual([['Acme', '', '10']]);
    });

    it('dígitos guardados como TEXTO: teléfono o código, nunca número', () => {
        const t = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
        const rows = `<row r="1">${t('A1', 'Teléfono')}${t('B1', 'Código')}</row>`
            + `<row r="2">${t('A2', '+573001112233')}${t('B2', '00123')}</row>`
            + `<row r="3">${t('A3', '3001234567')}${t('B3', '00456')}</row>`
            + `<row r="4">${t('A4', '+52 55 1111 2222')}${t('B4', '00789')}</row>`;
        const table = xlsxSheetToImportTable(openXlsx(buildXlsx({ sheets: [{ name: 'S', xml: sheetXml(rows) }] })).readSheet(0), {
            decimalSeparator: '.',
            maxRows: 5000,
        });
        expect(table.typeHints).toEqual({ 0: 'phone', 1: 'text' });
        expect(table.rows[0]).toEqual(['+573001112233', '00123']);
    });

    it('cuenta las filas que pasan del tope y lo avisa', () => {
        const rows = Array.from({ length: 30 }, (_v, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
        const sheet = openXlsx(buildXlsx({ sheets: [{ name: 'S', xml: sheetXml(rows) }] }), { maxRows: 10 }).readSheet(0);
        const table = xlsxSheetToImportTable(sheet, { decimalSeparator: '.', maxRows: 10 });
        expect(table.rows).toHaveLength(10);
        expect(table.totalRows).toBe(29);
        expect(table.truncated).toBe(true);
    });
});

describe('lector: archivos hostiles o equivocados', () => {
    it('rechaza DTD/entidades (billion laughs) sin expandir nada', () => {
        const evil = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>'
            + `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lol2;</t></is></c></row></sheetData></worksheet>`;
        const book = openXlsx(buildXlsx({ sheets: [{ name: 'S', xml: evil }] }));
        expect(() => book.readSheet(0)).toThrowError(XlsxError);
        try {
            book.readSheet(0);
        } catch (e) {
            expect((e as XlsxError).code).toBe('unsafe');
        }
    });

    it('corta una bomba de compresión sin reservar lo que el zip dice que mide', () => {
        // 60 MB de ceros comprimen a ~60 KB; el tope por parte es 1 MB.
        const huge = new Uint8Array(60 * 1024 * 1024).fill(32);
        const bytes = zipSync({ '_rels/.rels': strToU8('<Relationships/>'), 'xl/workbook.xml': huge }, { level: 9 });
        expect(bytes.length).toBeLessThan(1024 * 1024);
        expect(() => openXlsx(bytes, { maxPartBytes: 1024 * 1024 })).toThrowError(/demasiado grande/);
    });

    it('explica un .xls viejo / cifrado, un archivo que no es zip y uno demasiado grande', () => {
        const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
        expect(() => openXlsx(cfb)).toThrowError(/Excel antiguo \(\.xls\) o está protegido/);
        expect(() => openXlsx(strToU8('Nombre,Email\nAna,a@b.co'))).toThrowError(/no es un libro de Excel/);
        expect(() => openXlsx(new Uint8Array(100), { maxFileBytes: 10 })).toThrowError(/el máximo para importar/);
    });
});

describe('utilidades', () => {
    it('CSV que el import lee igual (comillas, saltos, punto y coma)', () => {
        const csv = tableToCsv(['Nombre', 'Nota; con punto y coma'], [['Acme, S.A.', 'dice "hola"\nchau']]);
        expect(csv).toBe('Nombre,"Nota; con punto y coma"\r\n"Acme, S.A.","dice ""hola""\nchau"\r\n');
    });

    it('nombre de hoja válido y letras de columna', () => {
        expect(sanitizeSheetName('Clientes [activos]: 2026/07*?')).toBe('Clientes activos 2026 07');
        expect(sanitizeSheetName("'Ventas'")).toBe('Ventas');
        expect(sanitizeSheetName('History')).toBe('Hoja1');
        expect(sanitizeSheetName('x'.repeat(40))).toHaveLength(31);
        expect(columnName(0)).toBe('A');
        expect(columnName(25)).toBe('Z');
        expect(columnName(26)).toBe('AA');
        expect(columnName(701)).toBe('ZZ');
        expect(columnName(702)).toBe('AAA');
    });

    it('escape XML: controles fuera y el `_xHHHH_` literal protegido', () => {
        expect(xmlEscape('a\u0001b<&>"_x000D_')).toBe('ab&lt;&amp;&gt;&quot;_x005F_x000D_');
        const cell: XlsxCell = { t: 'str', v: 'x' };
        expect(cell.t).toBe('str');
    });
});
