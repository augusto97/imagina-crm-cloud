import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
    DOC_MARGINS,
    readableInk,
    type DocBlock,
    type DocBlockRegion,
    type DocDesign,
    type DocImage,
    type DocInnerBlock,
    type RichMark,
    type RichNode,
} from '@imagina-base/shared';

/**
 * v0.1.266 (ADR-S35) — Diseño de documento → PDF.
 *
 * pdfmake (JS puro sobre pdfkit): decenas de milisegundos por documento, sin
 * navegador sin pantalla. Este archivo sólo MAQUETA: los datos ya vienen
 * resueltos (variables, valores formateados, filas de la tabla de ítems,
 * totales, imágenes como data URL) por `DocumentsService`. Así la vista
 * previa del editor, el botón de la ficha y la acción de automatización
 * salen de la MISMA función.
 *
 * Seguridad: pdfmake puede leer archivos locales y descargar URLs si un nodo
 * se lo pide. Las dos políticas se cierran (`() => false`): las imágenes
 * llegan ya como bytes que el servicio validó, y las fuentes viven en el
 * sistema de archivos VIRTUAL de pdfmake.
 */

// --- pdfmake (singleton del módulo) -----------------------------------------

interface PdfMakeLike {
    virtualfs: { writeFileSync(name: string, data: Buffer): void };
    setFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(cb: (url: string) => boolean): void;
    setLocalAccessPolicy(cb: (path: string) => boolean): void;
    createPdf(def: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
}

let pdfmakeInstance: PdfMakeLike | null = null;

function pdfmake(): PdfMakeLike {
    if (pdfmakeInstance) return pdfmakeInstance;
    const req = createRequire(__filename);
    const pm = req('pdfmake') as PdfMakeLike;
    const fontDir = path.join(path.dirname(req.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
    for (const f of ['Regular', 'Medium', 'Italic', 'MediumItalic']) {
        pm.virtualfs.writeFileSync(`Roboto-${f}.ttf`, readFileSync(path.join(fontDir, `Roboto-${f}.ttf`)));
    }
    pm.setFonts({
        Roboto: {
            normal: 'Roboto-Regular.ttf',
            bold: 'Roboto-Medium.ttf',
            italics: 'Roboto-Italic.ttf',
            bolditalics: 'Roboto-MediumItalic.ttf',
        },
    });
    pm.setUrlAccessPolicy(() => false);
    pm.setLocalAccessPolicy(() => false);
    pdfmakeInstance = pm;
    return pm;
}

// --- Datos ya resueltos ----------------------------------------------------

export interface ItemsTable {
    /** Etiqueta, alineación y ancho de cada columna (sin la del número). */
    columns: Array<{ label: string; align: 'left' | 'center' | 'right'; width: 'auto' | 'fill' }>;
    /** Valores ya formateados. */
    rows: string[][];
    /** Mensaje en lugar de la tabla (sin origen elegido, relación borrada…). */
    notice?: string;
}

export interface TotalsRowResolved {
    id: string;
    label: string;
    value: string;
    emphasis: boolean;
}

export interface DocRenderInput {
    design: DocDesign;
    /**
     * Resuelve un template (variables → texto). En el modo «variables» del
     * editor lo devuelve tal cual y `tagsMode` pinta las variables.
     */
    resolve: (template: string) => string;
    tagsMode: boolean;
    fieldLabel: (slug: string) => string;
    /** Valor legible de un campo del registro. */
    fieldValue: (slug: string) => string;
    items: Map<string, ItemsTable>;
    totals: Map<string, TotalsRowResolved[]>;
    /** Clave de imagen → data URL (png/jpeg). */
    images: Map<string, string>;
    /** Metadatos del PDF. */
    title: string;
    author: string;
}

export interface DocRenderOutput {
    buffer: Buffer;
    pages: number;
    pageWidth: number;
    pageHeight: number;
    regions: DocBlockRegion[];
}

/** Clave de una imagen del diseño en el mapa `images`. */
export function docImageKey(img: DocImage): string | null {
    if (img.kind === 'brand') return 'brand';
    if (img.kind === 'file' && img.file_id) return `file:${img.file_id}`;
    if (img.kind === 'url' && img.url.trim()) return `url:${img.url.trim()}`;
    return null;
}

// --- Medidas ---------------------------------------------------------------

const PAGE_PT: Record<DocDesign['theme']['page_size'], [number, number]> = {
    letter: [612, 792],
    a4: [595.28, 841.89],
    legal: [612, 1008],
};
const COLUMN_GAP = 16;
const PAD: Record<'none' | 'sm' | 'md' | 'lg', number> = { none: 0, sm: 4, md: 8, lg: 14 };
const TAG_RE = /\{\{\s*[a-zA-Z0-9_.]+(?:\|[a-zA-Z0-9+-]+)*\s*\}\}/g;

type Node = Record<string, unknown>;

interface Ctx {
    input: DocRenderInput;
    base: number;
    t: DocDesign['theme'];
    contentW: number;
}

// --- Texto -----------------------------------------------------------------

/** Un template → runs de pdfmake (en modo variables, las pinta como pastillas). */
function runs(ctx: Ctx, template: string, style: Node = {}): Node[] {
    if (!template) return [];
    if (!ctx.input.tagsMode) return [{ text: ctx.input.resolve(template), ...style }];
    const out: Node[] = [];
    let last = 0;
    TAG_RE.lastIndex = 0;
    for (let m = TAG_RE.exec(template); m; m = TAG_RE.exec(template)) {
        if (m.index > last) out.push({ text: template.slice(last, m.index), ...style });
        out.push({ text: m[0], ...style, color: '#075985', background: '#e0f2fe' });
        last = m.index + m[0].length;
    }
    TAG_RE.lastIndex = 0;
    if (last < template.length) out.push({ text: template.slice(last), ...style });
    return out;
}

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)/i;

function markStyle(ctx: Ctx, marks: RichMark[] | undefined): Node {
    const st: Node = {};
    const decorations: string[] = [];
    for (const m of marks ?? []) {
        const a = m.attrs ?? {};
        if (m.type === 'bold') st.bold = true;
        else if (m.type === 'italic') st.italics = true;
        else if (m.type === 'underline') decorations.push('underline');
        else if (m.type === 'strike') decorations.push('lineThrough');
        else if (m.type === 'textStyle' && typeof a.color === 'string' && /^#[0-9a-f]{3,6}$/i.test(a.color)) st.color = a.color;
        else if (m.type === 'highlight') st.background = typeof a.color === 'string' && /^#[0-9a-f]{3,6}$/i.test(a.color) ? a.color : '#fef08a';
        else if (m.type === 'link' && typeof a.href === 'string') {
            const href = ctx.input.tagsMode ? a.href : ctx.input.resolve(a.href);
            if (SAFE_HREF.test(href)) {
                st.link = href;
                st.color = ctx.t.accent;
                decorations.push('underline');
            }
        }
    }
    if (decorations.length === 1) st.decoration = decorations[0];
    else if (decorations.length > 1) st.decoration = decorations;
    return st;
}

function inlineRuns(ctx: Ctx, nodes: RichNode[] | undefined): Node[] {
    const out: Node[] = [];
    for (const n of nodes ?? []) {
        if (n.type === 'text' && typeof n.text === 'string') out.push(...runs(ctx, n.text, markStyle(ctx, n.marks)));
        else if (n.type === 'hardBreak') out.push({ text: '\n' });
        else if (n.type === 'mentionUser' || n.type === 'mentionRecord') {
            out.push({ text: typeof n.attrs?.label === 'string' ? n.attrs.label : '' });
        } else out.push(...inlineRuns(ctx, n.content));
    }
    return out;
}

interface TextStyle {
    size: number;
    color: string;
    align: string;
}

function richBlocks(ctx: Ctx, nodes: RichNode[] | undefined, st: TextStyle): Node[] {
    const list = nodes ?? [];
    return list.map((n, i) => {
        const mb = i === list.length - 1 ? 0 : Math.round(st.size * 0.55);
        const base = { fontSize: st.size, color: st.color, alignment: st.align, lineHeight: 1.25 };
        switch (n.type) {
            case 'paragraph': {
                const r = inlineRuns(ctx, n.content);
                return { text: r.length ? r : ' ', ...base, margin: [0, 0, 0, mb] };
            }
            case 'heading': {
                const level = Number(n.attrs?.level) || 2;
                const size = level <= 1 ? st.size + 6 : level === 2 ? st.size + 3 : st.size + 1;
                return { text: inlineRuns(ctx, n.content), ...base, fontSize: size, bold: true, margin: [0, 2, 0, Math.max(mb, 4)] };
            }
            case 'bulletList':
            case 'orderedList':
            case 'taskList': {
                const items = (n.content ?? []).map((li) => {
                    const inner = richBlocks(ctx, li.content, st);
                    const prefix = n.type === 'taskList' ? (li.attrs?.checked ? '☑ ' : '☐ ') : '';
                    return prefix ? { stack: [{ text: prefix, ...base }, ...inner] } : { stack: inner };
                });
                const key = n.type === 'orderedList' ? 'ol' : 'ul';
                return { [key]: items, ...base, margin: [0, 0, 0, mb] };
            }
            case 'blockquote':
                return {
                    table: { widths: ['*'], body: [[{ stack: richBlocks(ctx, n.content, { ...st, color: ctx.t.muted }), margin: [8, 2, 0, 2] }]] },
                    layout: {
                        hLineWidth: () => 0,
                        vLineWidth: (j: number) => (j === 0 ? 2 : 0),
                        vLineColor: () => ctx.t.accent,
                    },
                    margin: [0, 0, 0, mb],
                };
            case 'codeBlock':
                return { text: inlineRuns(ctx, n.content), ...base, fontSize: st.size - 1, background: '#f3f4f6', margin: [0, 0, 0, mb] };
            case 'horizontalRule':
                return { ...hrule(ctx.contentW, ctx.t.border, 0.75), margin: [0, 4, 0, mb + 4] };
            case 'table': {
                const rows = (n.content ?? []).map((row) =>
                    (row.content ?? []).map((cell) => ({
                        stack: richBlocks(ctx, cell.content, { ...st, size: st.size - 0.5 }),
                        ...(cell.type === 'tableHeader' ? { fillColor: '#f9fafb', bold: true } : {}),
                    })),
                );
                const cols = Math.max(1, ...rows.map((r) => r.length));
                const body = rows.map((r) => [...r, ...Array.from({ length: cols - r.length }, () => ({ text: '' }))]);
                return {
                    table: { widths: Array.from({ length: cols }, () => '*'), body },
                    layout: thinGrid(ctx.t.border),
                    margin: [0, 0, 0, mb],
                };
            }
            default:
                return { stack: richBlocks(ctx, n.content, st), margin: [0, 0, 0, mb] };
        }
    });
}

function hrule(width: number, color: string, thickness: number): Node {
    return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: thickness, lineColor: color }] };
}

function thinGrid(color: string): Node {
    return {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => color,
        vLineColor: () => color,
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => 3,
        paddingBottom: () => 3,
    };
}

// --- Bloques ---------------------------------------------------------------

const TEXT_SIZE = { sm: -1.5, md: 0, lg: 2 } as const;

function imageNode(ctx: Ctx, img: DocImage, width: number, maxHeight: number | null, align: string): Node | null {
    const key = docImageKey(img);
    const data = key ? ctx.input.images.get(key) : undefined;
    if (!data) {
        if (!ctx.input.tagsMode && img.kind !== 'none') return null;
        if (img.kind === 'none' || img.kind === 'brand') return null;
        return placeholder(ctx, 'Imagen', width, 40);
    }
    return { image: data, ...(maxHeight ? { fit: [width, maxHeight] } : { width }), alignment: align };
}

function placeholder(ctx: Ctx, label: string, width: number, height: number): Node {
    return {
        table: { widths: [width], heights: [height], body: [[{ text: label, alignment: 'center', color: ctx.t.muted, fontSize: ctx.base - 1, margin: [0, height / 2 - 6, 0, 0] }]] },
        layout: {
            hLineWidth: () => 0.75,
            vLineWidth: () => 0.75,
            hLineColor: () => '#c4c9d2',
            vLineColor: () => '#c4c9d2',
            hLineStyle: () => ({ dash: { length: 3 } }),
            vLineStyle: () => ({ dash: { length: 3 } }),
        },
    };
}

function headerNode(ctx: Ctx, b: Extract<DocBlock, { type: 'header' }>): Node {
    const t = ctx.t;
    const lines = b.company.split(/\r?\n/).filter((l) => l.trim() !== '');
    const companyStack: Node[] = lines.map((line, i) => ({
        text: runs(ctx, line),
        fontSize: i === 0 ? ctx.base + 2 : ctx.base - 0.5,
        bold: i === 0,
        color: i === 0 ? t.text : t.muted,
        margin: [0, i === 0 ? 0 : 1, 0, 0],
    }));
    const logo = imageNode(ctx, b.logo, b.logo_width, Math.round(b.logo_width * 0.5), 'left');
    const titleNode = { text: runs(ctx, b.title), fontSize: ctx.base + 9, bold: true, color: t.accent, characterSpacing: 0.4 };
    const meta: Node[] = [];
    if (b.number.trim()) meta.push({ text: runs(ctx, b.number), fontSize: ctx.base + 1, bold: true, color: t.text, margin: [0, 3, 0, 0] });
    if (b.date.trim()) meta.push({ text: runs(ctx, b.date), fontSize: ctx.base - 0.5, color: t.muted, margin: [0, 2, 0, 0] });

    if (b.layout === 'centered') {
        return {
            stack: [
                ...(logo ? [{ ...logo, alignment: 'center', margin: [0, 0, 0, 6] }] : []),
                ...companyStack.map((c) => ({ ...c, alignment: 'center' })),
                { ...titleNode, alignment: 'center', margin: [0, 10, 0, 0] },
                ...meta.map((m) => ({ ...m, alignment: 'center' })),
            ],
        };
    }
    if (b.layout === 'band') {
        const ink = readableInk(t.accent);
        return {
            stack: [
                {
                    columns: [
                        logo ? { width: 'auto', stack: [logo], margin: [0, 0, 12, 0] } : { width: 0, text: '' },
                        { width: '*', stack: companyStack },
                    ],
                    margin: [0, 0, 0, 10],
                },
                {
                    table: {
                        widths: ['*', 'auto'],
                        body: [
                            [
                                { text: runs(ctx, b.title), fontSize: ctx.base + 8, bold: true, color: ink, margin: [10, 8, 0, 8], characterSpacing: 0.4 },
                                { stack: meta.map((m) => ({ ...m, color: ink })), alignment: 'right', margin: [0, 6, 10, 6] },
                            ],
                        ],
                    },
                    layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => t.accent },
                },
            ],
        };
    }
    // split
    return {
        columns: [
            {
                width: '*',
                stack: [...(logo ? [{ ...logo, margin: [0, 0, 0, 6] }] : []), ...companyStack],
            },
            { width: 'auto', stack: [titleNode, ...meta], alignment: 'right', margin: [16, 0, 0, 0] },
        ],
    };
}

function fieldsNode(ctx: Ctx, b: Extract<DocBlock, { type: 'fields' }>, width: number): Node {
    const t = ctx.t;
    const title: Node[] = b.title ? [{ text: runs(ctx, b.title), bold: true, fontSize: ctx.base, color: t.text, margin: [0, 0, 0, 4] }] : [];
    if (b.slugs.length === 0) {
        return { stack: [...title, { text: ctx.input.tagsMode ? 'Elegí qué campos mostrar.' : '', color: t.muted, fontSize: ctx.base - 1 }] };
    }
    const value = (slug: string): Node[] =>
        ctx.input.tagsMode ? runs(ctx, `{{${slug}}}`) : [{ text: ctx.input.fieldValue(slug) || '—' }];
    const cell = (slug: string): Node[] => [
        { text: ctx.input.fieldLabel(slug), color: t.muted, fontSize: ctx.base - 1 },
        { text: value(slug), color: t.text, fontSize: ctx.base },
    ];
    if (b.layout === 'stacked') {
        const per = b.columns;
        const rows: Node[] = [];
        for (let i = 0; i < b.slugs.length; i += per) {
            const chunk = b.slugs.slice(i, i + per);
            rows.push({
                columns: chunk.map((s) => ({ width: '*', stack: cell(s) })),
                columnGap: COLUMN_GAP,
                margin: [0, 0, 0, 6],
            });
        }
        return { stack: [...title, ...rows] };
    }
    const body: Node[][] = [];
    const per = b.columns;
    for (let i = 0; i < b.slugs.length; i += per) {
        const row: Node[] = [];
        for (let k = 0; k < per; k++) {
            const slug = b.slugs[i + k];
            if (slug) {
                row.push({ text: ctx.input.fieldLabel(slug), color: t.muted, fontSize: ctx.base - 0.5 });
                row.push({ text: value(slug), color: t.text, fontSize: ctx.base });
            } else row.push({ text: '' }, { text: '' });
        }
        body.push(row);
    }
    const labelW = Math.round((width / per) * 0.36);
    return {
        stack: [
            ...title,
            {
                table: { widths: Array.from({ length: per }, () => [labelW, '*']).flat(), body },
                layout: {
                    hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
                    vLineWidth: () => 0,
                    hLineColor: () => t.border,
                    paddingLeft: (i: number) => (i % 2 === 0 ? 0 : 6),
                    paddingRight: () => 6,
                    paddingTop: () => 4,
                    paddingBottom: () => 4,
                },
            },
        ],
    };
}

function itemsNode(ctx: Ctx, b: Extract<DocBlock, { type: 'items' }>): Node {
    const t = ctx.t;
    const data = ctx.input.items.get(b.id);
    const title: Node[] = b.title ? [{ text: runs(ctx, b.title), bold: true, fontSize: ctx.base, color: t.text, margin: [0, 0, 0, 5], characterSpacing: 0.3 }] : [];
    if (!data || data.notice) {
        return { stack: [...title, { text: data?.notice ?? 'Elegí de qué registros vinculados salen las filas.', color: t.muted, fontSize: ctx.base - 1, italics: true }] };
    }
    const ink = readableInk(t.accent);
    const cols = data.columns;
    const head: Node[] = [
        ...(b.numbered ? [{ text: '#', bold: true, color: ink, alignment: 'center', fontSize: ctx.base - 1 }] : []),
        ...cols.map((c) => ({ text: c.label, bold: true, color: ink, alignment: c.align, fontSize: ctx.base - 1 })),
    ];
    const anyFill = cols.some((c) => c.width === 'fill');
    const widths = [
        ...(b.numbered ? [18] : []),
        ...cols.map((c, i) => (c.width === 'fill' || (!anyFill && i === 0) ? '*' : 'auto')),
    ];
    const rows: Node[][] = data.rows.map((r, ri) => [
        ...(b.numbered ? [{ text: String(ri + 1), color: t.muted, alignment: 'center', fontSize: ctx.base - 1 }] : []),
        ...cols.map((c, ci) => ({ text: r[ci] ?? '', alignment: c.align, color: t.text, fontSize: ctx.base - 0.5 })),
    ]);
    if (rows.length === 0) {
        rows.push([
            { text: b.empty_text || 'Sin ítems.', colSpan: head.length, color: t.muted, italics: true, alignment: 'center', fontSize: ctx.base - 1 },
            ...Array.from({ length: head.length - 1 }, () => ({ text: '' })),
        ]);
    }
    return {
        stack: [
            ...title,
            {
                table: { headerRows: 1, dontBreakRows: true, widths, body: [head, ...rows] },
                layout: {
                    fillColor: (i: number) => (i === 0 ? t.accent : b.striped && i % 2 === 0 ? '#f8fafc' : null),
                    hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 ? 0 : i === node.table.body.length ? 0.75 : 0.4),
                    vLineWidth: () => 0,
                    hLineColor: () => t.border,
                    paddingLeft: () => 6,
                    paddingRight: () => 6,
                    paddingTop: () => 5,
                    paddingBottom: () => 5,
                },
            },
        ],
    };
}

function totalsNode(ctx: Ctx, b: Extract<DocBlock, { type: 'totals' }>): Node {
    const t = ctx.t;
    const rows = ctx.input.totals.get(b.id) ?? [];
    if (rows.length === 0) {
        return { text: ctx.input.tagsMode ? 'Agregá las filas de los totales.' : '', color: t.muted, fontSize: ctx.base - 1 };
    }
    const ink = readableInk(t.accent);
    const body = rows.map((r) =>
        r.emphasis
            ? [
                  { text: r.label, bold: true, color: ink, fontSize: ctx.base + 1, margin: [0, 2, 0, 2] },
                  { text: r.value, bold: true, color: ink, fontSize: ctx.base + 3, alignment: 'right', margin: [0, 1, 0, 1] },
              ]
            : [
                  { text: r.label, color: t.muted, fontSize: ctx.base - 0.5 },
                  { text: r.value, color: t.text, fontSize: ctx.base, alignment: 'right' },
              ],
    );
    const table = {
        table: { widths: ['*', 'auto'], body },
        layout: {
            fillColor: (i: number) => (rows[i]?.emphasis ? t.accent : null),
            hLineWidth: (i: number) => (i === 0 || i === rows.length ? 0 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => t.border,
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 5,
            paddingBottom: () => 5,
        },
    };
    if (b.width === 'full') return table;
    return { columns: [{ width: '*', text: '' }, { width: '48%', ...table }] };
}

function signatureNode(ctx: Ctx, b: Extract<DocBlock, { type: 'signature' }>): Node {
    const t = ctx.t;
    const lineW = 190;
    const one = (s: { name: string; detail: string }, i: number): Node => {
        const img = i === 0 ? imageNode(ctx, b.image, 150, 55, 'left') : null;
        return {
            width: lineW,
            stack: [
                ...(img ? [{ ...img, margin: [0, 0, 0, 2] }] : []),
                ...(b.line ? [hrule(lineW, t.text, 0.75)] : []),
                { text: runs(ctx, s.name), bold: true, fontSize: ctx.base, color: t.text, margin: [0, 4, 0, 0] },
                ...(s.detail.trim() ? [{ text: runs(ctx, s.detail), fontSize: ctx.base - 1, color: t.muted, margin: [0, 1, 0, 0] }] : []),
            ],
        };
    };
    const cols = b.signers.map(one);
    const spacer = { width: '*', text: '' };
    const columns =
        b.align === 'center'
            ? [spacer, ...cols, spacer]
            : b.align === 'right'
              ? [spacer, ...cols]
              : [...cols, spacer];
    return { columns, columnGap: 28 };
}

function innerOrBlock(ctx: Ctx, b: DocBlock | DocInnerBlock, width: number): Node {
    const t = ctx.t;
    switch (b.type) {
        case 'header':
            return headerNode(ctx, b);
        case 'heading': {
            const size = b.level === 1 ? ctx.base + 10 : b.level === 2 ? ctx.base + 5 : ctx.base + 0.5;
            const color = b.color ?? (b.level === 3 ? t.accent : t.text);
            const text = runs(ctx, b.text);
            return {
                text: text.length ? text : ctx.input.tagsMode ? 'Título' : ' ',
                fontSize: size,
                bold: true,
                color,
                alignment: b.align,
                ...(b.level === 3 ? { characterSpacing: 0.6 } : {}),
                margin: [0, 0, 0, b.level === 3 ? 4 : 2],
            };
        }
        case 'text': {
            const size = ctx.base + TEXT_SIZE[b.size];
            const color = b.color ?? t.text;
            const nodes = b.doc ? richBlocks(ctx, b.doc.content, { size, color, align: b.align }) : [];
            if (nodes.length === 0) return { text: ctx.input.tagsMode ? 'Escribí el texto…' : ' ', color: t.muted, fontSize: size };
            return { stack: nodes };
        }
        case 'fields':
            return fieldsNode(ctx, b, width);
        case 'items':
            return itemsNode(ctx, b);
        case 'totals':
            return totalsNode(ctx, b);
        case 'image': {
            const w = Math.max(10, Math.round((width * b.width) / 100));
            return imageNode(ctx, b.src, w, null, b.align) ?? { text: '' };
        }
        case 'divider':
            return { ...hrule(width, b.color ?? t.border, b.thickness), margin: [0, 4, 0, 4] };
        case 'spacer':
            // Texto vacío de 1 pt + margen: la altura exacta (con el tamaño de
            // letra normal, la línea vacía sumaba ~12 pt de más).
            return { text: '', fontSize: 1, lineHeight: 1, margin: [0, 0, 0, Math.max(0, b.height - 1)] };
        case 'page_break':
            return ctx.input.tagsMode
                ? { text: '— salto de página —', alignment: 'center', color: t.muted, fontSize: ctx.base - 2, pageBreak: 'after' }
                : { text: '', pageBreak: 'after' };
        case 'signature':
            return signatureNode(ctx, b);
        case 'columns': {
            const n = b.columns.length;
            const colW = (width - COLUMN_GAP * (n - 1)) / n;
            return {
                columns: b.columns.map((c) => ({
                    width: '*',
                    stack: c.blocks.map((ib) => wrap(ctx, ib, colW, true)),
                })),
                columnGap: COLUMN_GAP,
            };
        }
        default:
            return { text: '' };
    }
}

/** El bloque con su recuadro de color (si tiene) y el aire de abajo. */
function wrap(ctx: Ctx, b: DocBlock | DocInnerBlock, width: number, inner: boolean): Node {
    const pad = PAD[b.padding ?? (b.background ? 'md' : 'none')];
    const node = innerOrBlock(ctx, b, b.background ? width - pad * 2 : width);
    const gap = b.type === 'spacer' || b.type === 'page_break' || b.type === 'divider' ? 0 : inner ? 6 : 8;
    if (b.background) {
        return {
            id: `blk:${b.id}`,
            table: { widths: ['*'], body: [[{ ...node, margin: [pad, pad, pad, pad] }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => b.background, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
            margin: [0, 0, 0, gap],
        };
    }
    // La firma, los totales y el encabezado no se parten entre dos páginas.
    const whole = b.type === 'signature' || b.type === 'totals' || b.type === 'header';
    return { stack: [node], id: `blk:${b.id}`, margin: [0, 0, 0, gap], ...(whole ? { unbreakable: true } : {}) };
}

// --- Documento -------------------------------------------------------------

interface StartPos {
    pageNumber: number;
    left: number;
    top: number;
}

export async function renderDocument(input: DocRenderInput): Promise<DocRenderOutput> {
    const { design } = input;
    const t = design.theme;
    const [w0, h0] = PAGE_PT[t.page_size];
    const [pageWidth, pageHeight] = t.orientation === 'landscape' ? [h0, w0] : [w0, h0];
    const margin = DOC_MARGINS[t.margin];
    const footerH = 30;
    const contentW = pageWidth - margin * 2;
    const ctx: Ctx = { input, base: t.font_size, t, contentW };

    const content: Node[] = design.blocks.map((b) => wrap(ctx, b, contentW, false));
    // Marca de fin, de alto CERO: dice dónde termina el último bloque (si no,
    // su zona en la vista previa se estiraba hasta el pie de la hoja). Un
    // rectángulo de 0×0 no ocupa lugar, así que nunca abre una página de más
    // (un texto vacío sí: tiene alto de línea).
    content.push({ id: END_ID, canvas: [{ type: 'rect', x: 0, y: 0, w: 0, h: 0 }] });
    if (input.tagsMode && design.blocks.length === 0) {
        content.unshift({ text: 'Agregá bloques desde el panel de la izquierda.', color: t.muted, alignment: 'center', margin: [0, 120, 0, 0] });
    }

    const positions = new Map<string, StartPos>();
    const footer = design.footer;
    const def: Node = {
        pageSize: { width: pageWidth, height: pageHeight },
        pageMargins: [margin, margin, margin, margin + (footer.page_numbers || footer.text ? footerH - 10 : 0)],
        defaultStyle: { font: 'Roboto', fontSize: t.font_size, color: t.text, lineHeight: 1.15 },
        info: { title: input.title, author: input.author, creator: input.author, producer: input.author },
        content,
        footer:
            footer.page_numbers || footer.text
                ? (current: number, count: number) => ({
                      columns: [
                          { text: footer.text ? runs(ctx, footer.text) : '', fontSize: t.font_size - 2, color: t.muted },
                          footer.page_numbers
                              ? { text: `Página ${current} de ${count}`, fontSize: t.font_size - 2, color: t.muted, alignment: 'right', width: 'auto' }
                              : { text: '', width: 'auto' },
                      ],
                      margin: [margin, footerH / 2 - 4, margin, 0],
                  })
                : undefined,
        pageBreakBefore: (node: { id?: unknown; startPosition?: StartPos }) => {
            // La última pasada de maquetación gana (pdfmake puede maquetar más
            // de una vez cuando hay bloques que no se parten).
            if (typeof node.id === 'string' && node.id.startsWith('blk:') && node.startPosition) {
                positions.set(node.id, { ...node.startPosition });
            }
            return false;
        },
    };

    const buffer = await pdfmake().createPdf(def).getBuffer();
    // Páginas: las cuenta el propio PDF (la última pasada de maquetación manda).
    const pages = Math.max(1, (buffer.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length);
    const bottom = pageHeight - (margin + (footer.page_numbers || footer.text ? footerH - 10 : 0));
    return {
        buffer,
        pages,
        pageWidth,
        pageHeight,
        regions: computeRegions(design, positions, { margin, bottom, contentW, pages }),
    };
}

/**
 * Zonas de cada bloque en el PDF (para tocarlos en la vista previa): cada
 * bloque va desde donde arranca hasta donde arranca el siguiente (o el final
 * de su columna). Si cruza páginas, una zona por página.
 */
const END_ID = 'blk:__end';

function computeRegions(
    design: DocDesign,
    pos: Map<string, StartPos>,
    page: { margin: number; bottom: number; contentW: number; pages: number },
): DocBlockRegion[] {
    const out: DocBlockRegion[] = [];
    const span = (id: string, from: StartPos, to: StartPos | undefined, x: number, w: number): void => {
        const end = to ?? { pageNumber: from.pageNumber, left: x, top: page.bottom };
        for (let p = from.pageNumber; p <= end.pageNumber; p++) {
            const y0 = p === from.pageNumber ? from.top : page.margin;
            const y1 = p === end.pageNumber ? end.top : page.bottom;
            if (y1 - y0 < 1) continue;
            out.push({ id, page: p, x, y: y0, w, h: y1 - y0 });
        }
    };
    const top = design.blocks;
    top.forEach((b, i) => {
        const from = pos.get(`blk:${b.id}`);
        if (!from) return;
        const next = top[i + 1];
        // El último bloque llega hasta la marca de fin (o, si no estuviera,
        // hasta el final del contenido de la última hoja).
        const to = next
            ? pos.get(`blk:${next.id}`)
            : (pos.get(END_ID) ?? { pageNumber: page.pages, left: page.margin, top: page.bottom });
        span(b.id, from, to, page.margin, page.contentW);
        if (b.type === 'columns') {
            const n = b.columns.length;
            const colW = (page.contentW - COLUMN_GAP * (n - 1)) / n;
            b.columns.forEach((c) => {
                c.blocks.forEach((ib, k) => {
                    const s = pos.get(`blk:${ib.id}`);
                    if (!s) return;
                    const nb = c.blocks[k + 1];
                    // El último de la columna, hasta donde termina la fila de columnas.
                    const e = nb ? pos.get(`blk:${nb.id}`) : to;
                    span(ib.id, s, e, s.left, colW);
                });
            });
        }
    });
    return out;
}
