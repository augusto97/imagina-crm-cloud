import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';
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
});

const fieldsBlock = z.object({
    ...blockBase,
    type: z.literal('fields'),
    title: z.string().max(160).default(''),
    slugs: z.array(z.string().min(1).max(80)).max(40).default([]),
    /** table: etiqueta | valor; stacked: etiqueta arriba del valor. */
    layout: z.enum(['table', 'stacked']).default('table'),
    columns: z.union([z.literal(1), z.literal(2)]).default(1),
});

export const docItemsColumnSchema = z.object({
    slug: z.string().min(1).max(80),
    /** Vacío = el nombre del campo. */
    label: z.string().max(80).default(''),
    align: align.default('left'),
    /** fill: toma el ancho que sobra (la descripción). */
    width: z.enum(['auto', 'fill']).default('auto'),
});
export type DocItemsColumn = z.infer<typeof docItemsColumnSchema>;

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
    /** Un porcentaje de otra fila (IVA 19 % del subtotal; retención −4 %). */
    z.object({ kind: z.literal('percent'), of: z.string().min(1).max(40), pct: z.number().min(-100).max(100) }),
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
});

const dividerBlock = z.object({
    ...blockBase,
    type: z.literal('divider'),
    color: optionalHex,
    thickness: z.number().min(0.5).max(4).default(1),
});

const spacerBlock = z.object({
    ...blockBase,
    type: z.literal('spacer'),
    height: z.number().int().min(2).max(200).default(16),
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
]);
export type DocInnerBlock = z.infer<typeof innerBlockSchema>;
export type DocInnerBlockType = DocInnerBlock['type'];
export const DOC_INNER_BLOCK_TYPES: readonly DocInnerBlockType[] = ['heading', 'text', 'image', 'fields', 'divider', 'spacer'];

const columnsBlock = z.object({
    ...blockBase,
    type: z.literal('columns'),
    columns: z
        .array(z.object({ blocks: z.array(innerBlockSchema).max(DOC_COLUMN_MAX_BLOCKS).default([]) }))
        .min(2)
        .max(3),
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
]);
export type DocBlock = z.infer<typeof docBlockSchema>;
export type DocBlockType = DocBlock['type'];

export const docDesignSchema = z.object({
    version: z.literal(DOC_DESIGN_VERSION).default(DOC_DESIGN_VERSION),
    theme: docThemeSchema.default({}),
    footer: docFooterSchema.default({}),
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
    created_by: z.number().int().nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;

export const documentTemplateSummarySchema = documentTemplateSchema
    .pick({ id: true, list_id: true, name: true, filename: true, updated_at: true })
    .extend({ page_size: z.enum(DOC_PAGE_SIZES), blocks: z.number().int() });
export type DocumentTemplateSummary = z.infer<typeof documentTemplateSummarySchema>;

export const createDocumentTemplateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    filename: z.string().trim().max(200).default(''),
    design: docDesignSchema,
});
export type CreateDocumentTemplateInput = z.input<typeof createDocumentTemplateSchema>;

export const updateDocumentTemplateSchema = createDocumentTemplateSchema.partial();
export type UpdateDocumentTemplateInput = z.input<typeof updateDocumentTemplateSchema>;

/** Vista previa del editor: el diseño EN EDICIÓN (sin guardar). */
export const documentPreviewInputSchema = z.object({
    design: docDesignSchema,
    /** Registro de ejemplo; sin él, el último de la lista. */
    record_id: z.number().int().positive().nullable().optional(),
    /** tags: las variables a la vista ({{campo}}) en vez de los datos. */
    mode: z.enum(['real', 'tags']).default('real'),
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
    /** Si se guardó en el registro: el archivo y su enlace firmado. */
    file_id: number | null;
    url: string | null;
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
};
