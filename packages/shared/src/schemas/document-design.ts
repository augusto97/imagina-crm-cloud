import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';
import { BORDER_STYLES, DESIGN_FONTS, blockStyleSchema, elementStyleSchema } from './design-style';
import { richDocSchema, sanitizeRichDoc } from './rich-text';

/**
 * v0.1.266 — Documentos PDF (ADR-S35): cuentas de cobro, recibos, proformas.
 *
 * Una plantilla de documento vive en una LISTA (sus variables son los campos
 * de esa lista) y se diseña por bloques, igual que los correos (ADR-S34): un
 * encabezado con logo, número y fecha; textos con variables; los datos del
 * registro; una TABLA DE ÍTEMS con los registros vinculados por una relación
 * (las líneas de una cuenta de cobro); los TOTALES (subtotal, IVA, total); la
 * firma. Se guarda el MODELO, nunca el PDF: el PDF lo arma el servidor en el
 * momento (una acción de automatización, el botón de la ficha o la vista
 * previa del editor) con la MISMA función — lo que se ve es lo que sale.
 *
 * El renderizado vive en el servidor (pdfmake, JS puro: decenas de
 * milisegundos por documento, sin un navegador sin pantalla). Este archivo es
 * el contrato: el editor del front y el servidor validan con estos schemas.
 */

export const DOC_DESIGN_VERSION = 1;
export const DOC_MAX_BLOCKS = 80;
export const DOC_COLUMN_MAX_BLOCKS = 12;
/** Filas de una tabla de ítems (una cuenta de cobro no tiene 10.000 líneas). */
export const DOC_MAX_ITEM_ROWS = 500;
/** Tope del PDF generado (adjuntos de correo, almacenamiento). */
export const DOC_MAX_PDF_BYTES = 8 * 1024 * 1024;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = z.string().regex(HEX);
const optionalHex = hex.nullable().optional();

export const DOC_PAGE_SIZES = ['letter', 'a4', 'legal'] as const;
export type DocPageSize = (typeof DOC_PAGE_SIZES)[number];
export const DOC_PAGE_SIZE_LABELS: Record<DocPageSize, string> = {
    letter: 'Carta',
    a4: 'A4',
    legal: 'Oficio',
};
/** Márgenes de la hoja en puntos (72 pt = 1 pulgada). */
export const DOC_MARGINS = { narrow: 36, normal: 50, wide: 72 } as const;
export type DocMargin = keyof typeof DOC_MARGINS;

const align = z.enum(['left', 'center', 'right']);
export type DocAlign = z.infer<typeof align>;
const padding = z.enum(['none', 'sm', 'md', 'lg']);
export type DocPadding = z.infer<typeof padding>;

export const docThemeSchema = z.object({
    page_size: z.enum(DOC_PAGE_SIZES).default('letter'),
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
    margin: z.enum(['narrow', 'normal', 'wide']).default('normal'),
    /** Tamaño base del texto en puntos. */
    font_size: z.number().int().min(8).max(13).default(10),
    text: hex.default('#1f2937'),
    muted: hex.default('#6b7280'),
    /** Títulos, encabezado de la tabla, total. */
    accent: hex.default('#0e7490'),
    /** Líneas de tablas y recuadros. */
    border: hex.default('#e5e7eb'),
    /**
     * v0.1.272 — Tipografía del documento (embebida en el PDF) y la de los
     * títulos (vacío = la misma). `modern` es Roboto: lo de siempre.
     */
    font: z.enum(DESIGN_FONTS).default('modern'),
    heading_font: z.enum(DESIGN_FONTS).nullable().optional(),
    /** Interlineado del texto (vacío = 1,25). */
    line_height: z.number().min(1).max(2.4).nullable().optional(),
});
export type DocTheme = z.infer<typeof docThemeSchema>;

export const docFooterSchema = z.object({
    /** Texto del pie (con variables), en todas las páginas. */
    text: z.string().max(400).default(''),
    /** "Página 1 de 2". */
    page_numbers: z.boolean().default(true),
});
export type DocFooter = z.infer<typeof docFooterSchema>;

/**
 * Una imagen del documento: el logo de la marca de la empresa, un archivo
 * subido (módulo de archivos) o una URL https. PNG o JPG (lo que acepta un
 * PDF sin conversiones).
 */
export const docImageSchema = z.object({
    kind: z.enum(['none', 'brand', 'file', 'url']).default('none'),
    file_id: z.number().int().positive().nullable().default(null),
    url: z.string().max(2048).default(''),
});
export type DocImage = z.infer<typeof docImageSchema>;

const blockBase = {
    id: z.string().min(1).max(40),
    /** Recuadro de color detrás del bloque. */
    background: optionalHex,
    padding: padding.optional(),
    /** v0.1.272 — Tipografía, espaciado y borde (ADR-S37). */
    style: blockStyleSchema.optional(),
};

const headerBlock = z.object({
    ...blockBase,
    type: z.literal('header'),
    /** split: logo y empresa a la izquierda, título a la derecha. */
    layout: z.enum(['split', 'centered', 'band']).default('split'),
    logo: docImageSchema.default({}),
    logo_width: z.number().int().min(30).max(240).default(110),
    /** Quien emite: una línea por renglón (la primera va en negrita). */
    company: z.string().max(1000).default(''),
    title: z.string().max(160).default('DOCUMENTO'),
    /** "N.º {{record.id}}". */
    number: z.string().max(200).default(''),
    /** "Bogotá, {{date.today|larga}}". */
    date: z.string().max(200).default(''),
});

const headingBlock = z.object({
    ...blockBase,
    type: z.literal('heading'),
    text: z.string().max(400).default(''),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    align: align.default('left'),
    color: optionalHex,
});

const textBlock = z.object({
    ...blockBase,
    type: z.literal('text'),
    doc: richDocSchema.nullable().default(null),
    align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
    color: optionalHex,
    paragraph_spacing: z.number().min(0).max(48).nullable().optional(),
});

const fieldsBlock = z.object({
    ...blockBase,
    type: z.literal('fields'),
    title: z.string().max(160).default(''),
    slugs: z.array(z.string().min(1).max(80)).max(40).default([]),
    /** table: etiqueta | valor; stacked: etiqueta arriba del valor. */
    layout: z.enum(['table', 'stacked']).default('table'),
    columns: z.union([z.literal(1), z.literal(2)]).default(1),
    label_color: optionalHex,
    value_color: optionalHex,
    /** Ancho de la columna de etiquetas en % (forma tabla). */
    label_width: z.number().int().min(15).max(70).optional(),
    lines: z.boolean().optional(),
});

/**
 * v0.1.292 — Una columna CALCULADA de la tabla de ítems (el total de cada
 * línea de una cotización): un mini-árbol declarativo de operaciones sobre
 * las columnas de la MISMA fila y constantes. Nunca se evalúa texto: sólo
 * estas operaciones, así no hay forma de colar código (sin `eval`).
 *
 *  - `col`: el valor numérico de un campo de la lista de ítems (por slug) o
 *    de una columna calculada ANTERIOR de la tabla (por su clave).
 *  - `add`/`sub`/`mul`/`div`: 2 a 6 operandos, en orden.
 *  - `pct`: `of × pct / 100` (el IVA de la línea).
 *  - `minus_pct`: `of × (1 − pct / 100)` (aplicar el descuento de la línea).
 *
 * Vacíos: una columna vacía vale `null`; en sumas y restas cuenta como 0 (si
 * TODO está vacío, el resultado es vacío); en productos y divisiones deja la
 * celda vacía; un porcentaje vacío es 0 % (sin descuento).
 */
export type DocItemExpr =
    | { op: 'col'; slug: string }
    | { op: 'const'; value: number }
    | { op: 'add' | 'sub' | 'mul' | 'div'; args: DocItemExpr[] }
    | { op: 'pct' | 'minus_pct'; of: DocItemExpr; pct: DocItemExpr };

export const DOC_ITEM_EXPR_MAX_DEPTH = 5;
export const DOC_ITEM_EXPR_MAX_NODES = 24;

export const docItemExprSchema: z.ZodType<DocItemExpr> = z.lazy(() =>
    z.discriminatedUnion('op', [
        z.object({ op: z.literal('col'), slug: z.string().min(1).max(80) }),
        z.object({ op: z.literal('const'), value: z.number().finite().min(-1e12).max(1e12) }),
        z.object({ op: z.enum(['add', 'sub', 'mul', 'div']), args: z.array(docItemExprSchema).min(2).max(6) }),
        z.object({ op: z.enum(['pct', 'minus_pct']), of: docItemExprSchema, pct: docItemExprSchema }),
    ]) as z.ZodType<DocItemExpr>,
);

/** Profundidad y cantidad de nodos de una expresión (para acotarla). */
export function docItemExprSize(expr: DocItemExpr, depth = 1): { depth: number; nodes: number } {
    if (expr.op === 'col' || expr.op === 'const') return { depth, nodes: 1 };
    const kids = 'args' in expr ? expr.args : [expr.of, expr.pct];
    let d = depth;
    let n = 1;
    for (const k of kids) {
        const s = docItemExprSize(k, depth + 1);
        d = Math.max(d, s.depth);
        n += s.nodes;
    }
    return { depth: d, nodes: n };
}

/** Las columnas que lee una expresión (slugs de campos o claves de columnas calculadas). */
export function docItemExprRefs(expr: DocItemExpr, into: Set<string> = new Set()): Set<string> {
    if (expr.op === 'col') into.add(expr.slug);
    else if ('args' in expr) for (const a of expr.args) docItemExprRefs(a, into);
    else if ('of' in expr) {
        docItemExprRefs(expr.of, into);
        docItemExprRefs(expr.pct, into);
    }
    return into;
}

export const DOC_ITEM_COLUMN_FORMATS = ['currency', 'number', 'percent'] as const;
export type DocItemColumnFormat = (typeof DOC_ITEM_COLUMN_FORMATS)[number];

export const docItemsColumnSchema = z
    .object({
        /**
         * El slug del campo de la lista de ítems. En una columna CALCULADA es
         * su clave propia ("total_linea"): la usan los totales
         * (`items_sum`) y otras columnas calculadas posteriores.
         */
        slug: z.string().min(1).max(80),
        /** Vacío = el nombre del campo. */
        label: z.string().max(80).default(''),
        align: align.default('left'),
        /** fill: toma el ancho que sobra (la descripción). */
        width: z.enum(['auto', 'fill']).default('auto'),
        /** v0.1.292 — `computed`: el valor sale de `expr` (sin campo detrás). */
        kind: z.enum(['field', 'computed']).optional(),
        expr: docItemExprSchema.optional(),
        /**
         * Cómo se muestra una columna calculada (moneda con `prefix`, número, %).
         * En una columna de CAMPO numérico, si está, pisa el formato del campo:
         * así el precio unitario y el total de la línea se ven igual.
         */
        format: z.enum(DOC_ITEM_COLUMN_FORMATS).optional(),
        /** Decimales de una columna calculada (se REDONDEA a esto) o con `format`. */
        decimals: z.number().int().min(0).max(4).optional(),
        prefix: z.string().max(8).optional(),
        /** Se calcula (y suma) pero no se dibuja: el bruto de cada línea. */
        hidden: z.boolean().optional(),
    })
    .superRefine((c, ctx) => {
        if (c.kind !== 'computed') return;
        if (!c.expr) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expr'], message: 'Una columna calculada necesita su fórmula' });
            return;
        }
        const size = docItemExprSize(c.expr);
        if (size.depth > DOC_ITEM_EXPR_MAX_DEPTH || size.nodes > DOC_ITEM_EXPR_MAX_NODES) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expr'], message: 'La fórmula de la columna es demasiado larga' });
        }
    });
export type DocItemsColumn = z.infer<typeof docItemsColumnSchema>;

/** ¿La columna es calculada (sin campo detrás)? */
export function isComputedItemColumn(c: Pick<DocItemsColumn, 'kind' | 'expr'>): c is DocItemsColumn & { kind: 'computed'; expr: DocItemExpr } {
    return c.kind === 'computed' && c.expr !== undefined;
}

/** De dónde salen las filas: los registros vinculados por una relación. */
export const docItemsSourceSchema = z.object({
    relation_field_id: idSchema,
    direction: z.enum(['forward', 'reverse']),
    /** La lista de los ítems (la del otro lado de la relación). */
    list_id: idSchema,
});
export type DocItemsSource = z.infer<typeof docItemsSourceSchema>;

const itemsBlock = z.object({
    ...blockBase,
    type: z.literal('items'),
    title: z.string().max(160).default(''),
    source: docItemsSourceSchema.nullable().default(null),
    columns: z.array(docItemsColumnSchema).max(10).default([]),
    /** Columna "#" con el número de fila. */
    numbered: z.boolean().default(true),
    sort: z.object({ slug: z.string().min(1).max(80), dir: z.enum(['asc', 'desc']).default('asc') }).nullable().default(null),
    limit: z.number().int().min(1).max(DOC_MAX_ITEM_ROWS).default(200),
    striped: z.boolean().default(true),
    empty_text: z.string().max(200).default('Sin ítems.'),
});

const totalSource = z.discriminatedUnion('kind', [
    /** Suma de una columna de una tabla de ítems. */
    z.object({ kind: z.literal('items_sum'), block_id: z.string().min(1).max(40), slug: z.string().min(1).max(80) }),
    /** Un campo numérico del registro. */
    z.object({ kind: z.literal('field'), slug: z.string().min(1).max(80) }),
    /**
     * Un porcentaje de otra fila (IVA 19 % del subtotal; retención −4 %).
     * v0.1.292 — `pct_field`: el porcentaje sale de un campo del registro (el
     * descuento global de ESA cotización; vacío = `pct`); `negate`: el
     * resultado se resta (un descuento se muestra negativo).
     */
    z.object({
        kind: z.literal('percent'),
        of: z.string().min(1).max(40),
        pct: z.number().min(-100).max(100),
        pct_field: z.string().min(1).max(80).nullable().optional(),
        negate: z.boolean().optional(),
    }),
    /** Suma de otras filas (menos las de `minus`). */
    z.object({
        kind: z.literal('sum'),
        rows: z.array(z.string().min(1).max(40)).max(12).default([]),
        minus: z.array(z.string().min(1).max(40)).max(12).default([]),
    }),
    /** Un valor escrito (con variables). */
    z.object({ kind: z.literal('text'), value: z.string().max(200).default('') }),
]);
export type DocTotalSource = z.infer<typeof totalSource>;

export const docTotalRowSchema = z.object({
    id: z.string().min(1).max(40),
    label: z.string().max(120).default(''),
    source: totalSource,
    /** La fila del total: más grande y con el color de acento. */
    emphasis: z.boolean().default(false),
    /** v0.1.292 — Se calcula (sirve para otras filas y `{{totales.id}}`) pero no se dibuja. */
    hidden: z.boolean().optional(),
    /** v0.1.292 — No se dibuja si da 0 (el descuento de una cotización sin descuento). */
    hide_zero: z.boolean().optional(),
});
export type DocTotalRow = z.infer<typeof docTotalRowSchema>;

const totalsBlock = z.object({
    ...blockBase,
    type: z.literal('totals'),
    rows: z.array(docTotalRowSchema).max(12).default([]),
    /** half: a la derecha, como en una factura. */
    width: z.enum(['half', 'full']).default('half'),
    prefix: z.string().max(8).default('$ '),
    decimals: z.number().int().min(0).max(4).default(0),
});

const imageBlock = z.object({
    ...blockBase,
    type: z.literal('image'),
    src: docImageSchema.default({}),
    /** Ancho en % del área de contenido. */
    width: z.number().int().min(5).max(100).default(40),
    align: align.default('center'),
    /** Borde de la imagen (en el PDF no hay esquinas redondeadas ni sombra). */
    frame: elementStyleSchema.optional(),
});

const dividerBlock = z.object({
    ...blockBase,
    type: z.literal('divider'),
    color: optionalHex,
    thickness: z.number().min(0.5).max(4).default(1),
    line_style: z.enum(BORDER_STYLES).optional(),
    length: z.number().int().min(5).max(100).optional(),
    align: align.optional(),
});

const spacerBlock = z.object({
    ...blockBase,
    type: z.literal('spacer'),
    height: z.number().int().min(2).max(200).default(16),
});

/**
 * v0.1.267 — Un código QR: el enlace de pago (`{{pago.link}}`), la
 * dirección de la factura, un texto. Lo dibuja el propio pdfmake (sin
 * imágenes ni servicios externos).
 */
const qrBlock = z.object({
    ...blockBase,
    type: z.literal('qr'),
    /** Lo que codifica, con variables. Vacío = no se dibuja. */
    value: z.string().max(1000).default(''),
    /** Lado del cuadrado en puntos (72 pt = 2,54 cm). */
    size: z.number().int().min(40).max(240).default(96),
    align: align.default('left'),
    /** Una línea debajo: "Escanea para pagar". */
    caption: z.string().max(200).default(''),
});

const pageBreakBlock = z.object({
    ...blockBase,
    type: z.literal('page_break'),
});

export const docSignerSchema = z.object({
    name: z.string().max(200).default(''),
    /** Debajo del nombre: "C.C. 1.234.567", "Representante legal". */
    detail: z.string().max(300).default(''),
});

const signatureBlock = z.object({
    ...blockBase,
    type: z.literal('signature'),
    signers: z.array(docSignerSchema).min(1).max(3).default([{ name: '', detail: '' }]),
    align: align.default('left'),
    /** Firma escaneada (encima de la línea del primer firmante). */
    image: docImageSchema.default({}),
    line: z.boolean().default(true),
});

const innerBlockSchema = z.discriminatedUnion('type', [
    headingBlock,
    textBlock,
    imageBlock,
    fieldsBlock,
    dividerBlock,
    spacerBlock,
    qrBlock,
]);
export type DocInnerBlock = z.infer<typeof innerBlockSchema>;
export type DocInnerBlockType = DocInnerBlock['type'];
export const DOC_INNER_BLOCK_TYPES: readonly DocInnerBlockType[] = ['heading', 'text', 'image', 'fields', 'qr', 'divider', 'spacer'];

const columnsBlock = z.object({
    ...blockBase,
    type: z.literal('columns'),
    columns: z
        .array(
            z.object({
                blocks: z.array(innerBlockSchema).max(DOC_COLUMN_MAX_BLOCKS).default([]),
                background: optionalHex,
                style: blockStyleSchema.optional(),
            }),
        )
        .min(2)
        .max(3),
    /** v0.1.272 — Proporciones («1-2»), separación en pt. */
    ratio: z.string().regex(/^[1-4](-[1-4]){1,2}$/).optional(),
    gap: z.number().int().min(0).max(48).optional(),
});

export const docBlockSchema = z.discriminatedUnion('type', [
    headerBlock,
    headingBlock,
    textBlock,
    fieldsBlock,
    itemsBlock,
    totalsBlock,
    imageBlock,
    dividerBlock,
    spacerBlock,
    pageBreakBlock,
    signatureBlock,
    columnsBlock,
    qrBlock,
]);
export type DocBlock = z.infer<typeof docBlockSchema>;
export type DocBlockType = DocBlock['type'];

/**
 * v0.1.267 — Numeración consecutiva de la plantilla: cada registro recibe UN
 * número la primera vez que se genera su documento de verdad (la vista
 * previa no consume números) y lo conserva para siempre: volver a generarlo
 * da el mismo número. `{{documento.numero}}` lo muestra con su formato.
 */
export const docNumberingSchema = z.object({
    enabled: z.boolean().default(false),
    /** Lo que va adelante: "CC-", "2026-". */
    prefix: z.string().max(20).default(''),
    /** Ceros a la izquierda: 4 → 0042. */
    padding: z.number().int().min(0).max(8).default(4),
    /** Primer número (para seguir una numeración que ya venía de antes). */
    start: z.number().int().min(1).max(999_999_999).default(1),
    /** Además, guardarlo en un campo de texto del registro (slug). */
    save_field: z.string().min(1).max(80).nullable().default(null),
    /**
     * v0.1.292 — Congelar el documento al emitirlo: la primera vez que se
     * emite el número, el PDF generado se GUARDA como archivo y desde ahí se
     * entrega SIEMPRE ese (aunque cambien los datos del registro). Sólo con la
     * numeración encendida. Para rehacerlo: «Anular y emitir de nuevo».
     */
    freeze: z.boolean().optional(),
});
export type DocNumbering = z.infer<typeof docNumberingSchema>;

/** ¿La plantilla congela lo que emite? (necesita la numeración encendida). */
export function docFreezes(numbering: Pick<DocNumbering, 'enabled' | 'freeze'>): boolean {
    return numbering.enabled && numbering.freeze === true;
}

/** "CC-0042". */
export function formatDocNumber(n: number, numbering: Pick<DocNumbering, 'prefix' | 'padding'>): string {
    return `${numbering.prefix}${String(Math.trunc(n)).padStart(numbering.padding, '0')}`;
}

export const docDesignSchema = z.object({
    version: z.literal(DOC_DESIGN_VERSION).default(DOC_DESIGN_VERSION),
    theme: docThemeSchema.default({}),
    footer: docFooterSchema.default({}),
    numbering: docNumberingSchema.default({}),
    blocks: z.array(docBlockSchema).max(DOC_MAX_BLOCKS).default([]),
});
export type DocDesign = z.infer<typeof docDesignSchema>;
export type DocDesignInput = z.input<typeof docDesignSchema>;

/**
 * Lee un diseño guardado (tolerante): `null` si no valida. Los textos con
 * formato pasan por `sanitizeRichDoc` (whitelist de nodos y marcas).
 */
export function parseDocDesign(raw: unknown): DocDesign | null {
    const parsed = docDesignSchema.safeParse(raw);
    if (!parsed.success) return null;
    const clean = (b: DocBlock | DocInnerBlock): void => {
        if (b.type === 'text') b.doc = sanitizeRichDoc(b.doc);
        if (b.type === 'columns') for (const c of b.columns) c.blocks.forEach(clean);
    };
    parsed.data.blocks.forEach(clean);
    return parsed.data;
}

/** Todos los bloques, incluidos los que están dentro de columnas. */
export function docAllBlocks(design: DocDesign): Array<DocBlock | DocInnerBlock> {
    const out: Array<DocBlock | DocInnerBlock> = [];
    for (const b of design.blocks) {
        out.push(b);
        if (b.type === 'columns') for (const c of b.columns) out.push(...c.blocks);
    }
    return out;
}

/** Ids de archivo que usa el diseño (logo, imágenes, firma escaneada). */
export function docDesignFileIds(design: DocDesign): number[] {
    const ids = new Set<number>();
    const add = (img: DocImage | undefined): void => {
        if (img?.kind === 'file' && img.file_id) ids.add(img.file_id);
    };
    for (const b of docAllBlocks(design)) {
        if (b.type === 'header') add(b.logo);
        if (b.type === 'image') add(b.src);
        if (b.type === 'signature') add(b.image);
    }
    return [...ids];
}

// ---------------------------------------------------------------------------
// Plantillas guardadas (entidad) + endpoints
// ---------------------------------------------------------------------------

export const documentTemplateSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    name: z.string(),
    /** Nombre del archivo (con variables), sin ".pdf". */
    filename: z.string(),
    design: docDesignSchema,
    /** v0.1.267 — El cliente lo puede descargar desde su portal. */
    portal_visible: z.boolean(),
    /** El próximo número a asignar (si la numeración está encendida). */
    next_number: z.number().int(),
    created_by: z.number().int().nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;

export const documentTemplateSummarySchema = documentTemplateSchema
    .pick({ id: true, list_id: true, name: true, filename: true, updated_at: true, portal_visible: true, next_number: true })
    .extend({
        page_size: z.enum(DOC_PAGE_SIZES),
        blocks: z.number().int(),
        /** "CC-0042" si numera; null si no. */
        next_label: z.string().nullable(),
        /** v0.1.292 — Congela el PDF al emitir el número. */
        freezes: z.boolean(),
        /** v0.1.292 — Documentos emitidos con su PDF congelado (se borran con la plantilla). */
        frozen_count: z.number().int(),
    });
export type DocumentTemplateSummary = z.infer<typeof documentTemplateSummarySchema>;

export const createDocumentTemplateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    filename: z.string().trim().max(200).default(''),
    design: docDesignSchema,
    portal_visible: z.boolean().default(false),
});
export type CreateDocumentTemplateInput = z.input<typeof createDocumentTemplateSchema>;

export const updateDocumentTemplateSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    filename: z.string().trim().max(200).optional(),
    design: docDesignSchema.optional(),
    portal_visible: z.boolean().optional(),
});
export type UpdateDocumentTemplateInput = z.input<typeof updateDocumentTemplateSchema>;

/** Vista previa del editor: el diseño EN EDICIÓN (sin guardar). */
export const documentPreviewInputSchema = z.object({
    design: docDesignSchema,
    /** Registro de ejemplo; sin él, el último de la lista. */
    record_id: z.number().int().positive().nullable().optional(),
    /** tags: las variables a la vista ({{campo}}) en vez de los datos. */
    mode: z.enum(['real', 'tags']).default('real'),
    /** v0.1.267 — La plantilla que se edita: muestra su número real (sin consumirlo). */
    template_id: z.number().int().positive().nullable().optional(),
});
export type DocumentPreviewInput = z.input<typeof documentPreviewInputSchema>;

/** Zona de un bloque en el PDF (para tocarlo en la vista previa). */
export interface DocBlockRegion {
    id: string;
    page: number;
    /** En puntos, desde la esquina superior izquierda de la página. */
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface DocumentPreviewResult {
    /** El PDF en base64. */
    pdf: string;
    bytes: number;
    pages: number;
    page_width: number;
    page_height: number;
    regions: DocBlockRegion[];
    /** Registro con el que se armó (null = la lista está vacía o modo variables). */
    record_id: number | null;
    /** Lo que no se pudo resolver: "la imagen no es PNG ni JPG", etc. */
    warnings: string[];
}

/** Generar el PDF de un registro desde la ficha. */
export const generateDocumentInputSchema = z.object({
    record_id: idSchema,
    /** Guardarlo en un campo Archivo del registro (slug); sin esto, sólo se descarga. */
    save_field: z.string().min(1).max(80).nullable().optional(),
    /** append: se suma a los archivos del campo; replace: lo reemplaza. */
    save_mode: z.enum(['append', 'replace']).default('append'),
});
export type GenerateDocumentInput = z.input<typeof generateDocumentInputSchema>;

export interface GenerateDocumentResult {
    filename: string;
    bytes: number;
    /** El número del documento ("CC-0042"), si la plantilla numera. */
    number: string | null;
    /** Si se guardó en el registro: el archivo y su enlace firmado. */
    file_id: number | null;
    url: string | null;
}

/**
 * v0.1.268 — «Copiar enlace»: un enlace firmado (30 días) que ARMA el PDF al
 * abrirlo. No guarda ningún archivo; muestra los datos del momento.
 */
export const documentLinkInputSchema = z.object({ record_id: idSchema });
export type DocumentLinkInput = z.infer<typeof documentLinkInputSchema>;

export interface DocumentLinkResult {
    url: string;
    expires_at: string;
}

/**
 * v0.1.292 — «Ver» desde la ficha: el PDF con los datos de ahora (o el
 * congelado, si ya se emitió) SIN emitir número. Para revisar antes de
 * generar el de verdad.
 */
export const viewDocumentInputSchema = z.object({ record_id: idSchema });
export type ViewDocumentInput = z.infer<typeof viewDocumentInputSchema>;

export interface ViewDocumentResult {
    filename: string;
    pdf: string;
    /** El número ya emitido, o el que le tocaría ("próximo"), o null. */
    number: string | null;
    /** El número ya está emitido (si no, es el próximo y ver no lo gasta). */
    issued: boolean;
    /** true = es el PDF CONGELADO al emitirlo (no refleja cambios posteriores). */
    frozen: boolean;
}

// ---------------------------------------------------------------------------
// v0.1.292 — Documentos emitidos (numerados) de un registro
// ---------------------------------------------------------------------------

export const issuedDocumentSchema = z.object({
    id: idSchema,
    template_id: idSchema,
    template_name: z.string(),
    record_id: idSchema,
    number: z.number().int(),
    /** "CC-0042" con el formato del momento de emitirlo. */
    label: z.string(),
    issued_at: isoDateTimeSchema,
    /** El PDF quedó guardado (congelado) al emitirlo. */
    frozen: z.boolean(),
    frozen_at: isoDateTimeSchema.nullable(),
    /** Quién lo emitió (null = una automatización o el portal). */
    frozen_by: z.number().int().nullable(),
    frozen_by_name: z.string().nullable(),
    /** Tamaño del PDF congelado (bytes). */
    bytes: z.number().int().nullable(),
    status: z.enum(['active', 'voided']),
    voided_at: isoDateTimeSchema.nullable(),
    voided_by_name: z.string().nullable(),
    void_reason: z.string().nullable(),
});
export type IssuedDocument = z.infer<typeof issuedDocumentSchema>;

/** «Anular y emitir de nuevo» (sólo admin). */
export const reissueDocumentInputSchema = z.object({
    reason: z.string().trim().max(300).optional(),
});
export type ReissueDocumentInput = z.infer<typeof reissueDocumentInputSchema>;

export interface ReissueDocumentResult {
    voided: IssuedDocument;
    issued: IssuedDocument;
    filename: string;
    pdf: string;
}

export interface IssuedDocumentPdf {
    filename: string;
    pdf: string;
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const DOC_BLOCK_LABELS: Record<DocBlockType, string> = {
    header: 'Encabezado',
    heading: 'Título',
    text: 'Texto',
    fields: 'Datos del registro',
    items: 'Tabla de ítems',
    totals: 'Totales',
    image: 'Imagen',
    divider: 'Separador',
    spacer: 'Espacio',
    page_break: 'Salto de página',
    signature: 'Firma',
    columns: 'Columnas',
    qr: 'Código QR',
};

export const DOC_BLOCK_HINTS: Record<DocBlockType, string> = {
    header: 'Logo, tus datos, el título del documento, el número y la fecha.',
    heading: 'Un título o un subtítulo de sección.',
    text: 'Párrafos con negrita, listas y variables del registro.',
    fields: 'Campos del registro en una tabla prolija.',
    items: 'Las líneas del documento: registros vinculados (productos, servicios, cuotas).',
    totals: 'Subtotal, impuestos y total, calculados solos.',
    image: 'Un logo, un sello o una foto.',
    divider: 'Una línea para separar secciones.',
    spacer: 'Aire entre bloques.',
    page_break: 'Lo que sigue arranca en una página nueva.',
    signature: 'Línea de firma con nombre y documento.',
    columns: 'Dos o tres columnas lado a lado.',
    qr: 'Un código para escanear: el link de pago, una dirección o un texto.',
};

/** v0.1.267 — Un documento que el cliente puede bajar desde su portal. */
export interface PortalDocument {
    id: number;
    name: string;
}
