import { z } from 'zod';

import { formatDuration } from '../field-types/duration';
import {
    BORDER_STYLES,
    DESIGN_FONT_DEFS,
    DESIGN_FONTS,
    SHADOWS,
    SHADOW_CSS,
    blockStyleSchema,
    elementStyleSchema,
    fontStack,
    googleFontsHref,
    hasBoxStyle,
    type BlockStyle,
    type DesignFont,
    type ElementStyle,
} from './design-style';
import { formatPhone } from '../field-types/phone';
import type { RichDoc, RichMark, RichNode } from './rich-text';
import { richDocSchema, sanitizeRichDoc } from './rich-text';
import type { TenantFormat } from './tenant';

/**
 * v0.1.265 — Correos DISEÑADOS (ADR-S34).
 *
 * La acción «Enviar email» de las automatizaciones deja de ser sólo un cuadro
 * de texto: el cuerpo puede ser un DISEÑO por bloques (título, texto con
 * formato, botón, imagen, datos del registro, columnas, firma…) con un tema
 * (colores, tipografía, ancho). Se guarda el MODELO, nunca el HTML: el HTML lo
 * arma `renderEmailHtml` en el momento del envío, y es la MISMA función que
 * dibuja la vista previa del editor — lo que se ve es lo que sale.
 *
 * Compatibilidad (el requisito duro): Gmail (web, Android, iOS) y Outlook
 * (Windows con el motor de Word, Mac, web) tienen soportes de CSS muy
 * distintos. El renderizador usa sólo lo que funciona en TODOS:
 *  - maquetación con TABLAS (`role="presentation"`), nunca flex/grid;
 *  - estilos INLINE en cada elemento (Gmail descarta `<style>` en varios
 *    casos; el `<style>` del head es sólo mejora progresiva para celulares);
 *  - ancho fijo con condicional `<!--[if mso]>` para Outlook (que ignora
 *    `max-width`) y columnas "híbridas" (inline-block + tabla MSO) que se
 *    apilan solas en el teléfono sin depender de media queries;
 *  - botones con `bgcolor` + padding en la CELDA (en Outlook el padding de un
 *    `<a>` no existe), tipografías del sistema (las web fonts no cargan en
 *    Outlook ni en Gmail) e imágenes con `width` en atributo;
 *  - texto plano alternativo (`renderEmailText`): multipart/alternative.
 *
 * Seguridad: TODO lo que sale del diseño se escapa — el texto literal que
 * tipeó el autor y los valores que entran por las variables (SEC-08/SEC-33).
 * Las URLs (botones, imágenes, enlaces) pasan por `safeEmailUrl` después de
 * resolver las variables. El único HTML que viaja tal cual es el del bloque
 * «HTML propio» (lo escribe el autor, como el modo HTML de siempre) y la
 * firma, a la que se le quitan scripts/handlers (`emailSignatureHtml`).
 */

export const EMAIL_DESIGN_VERSION = 1;
export const EMAIL_DESIGN_MAX_BLOCKS = 60;
export const EMAIL_COLUMN_MAX_BLOCKS = 10;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = z.string().regex(HEX);
const optionalHex = hex.nullable().optional();

/**
 * v0.1.272 — El catálogo de tipografías es el compartido con los PDF
 * (`DESIGN_FONTS`): las del sistema de siempre (mismas claves: `sans`,
 * `modern`, `serif`, `humanist`, `trebuchet`) más Tahoma, Times, Courier y
 * fuentes web de Google con su respaldo del sistema.
 */
export const EMAIL_FONTS = DESIGN_FONTS;
export type EmailFont = DesignFont;

/** Pila CSS de cada tipografía (la web primero y su respaldo detrás). */
export const EMAIL_FONT_STACKS = Object.fromEntries(DESIGN_FONTS.map((f) => [f, fontStack(f)])) as Record<EmailFont, string>;

export const EMAIL_FONT_LABELS = Object.fromEntries(DESIGN_FONTS.map((f) => [f, DESIGN_FONT_DEFS[f].label])) as Record<EmailFont, string>;

const align = z.enum(['left', 'center', 'right']);
export type EmailAlign = z.infer<typeof align>;
const padding = z.enum(['none', 'sm', 'md', 'lg']);
export type EmailPadding = z.infer<typeof padding>;

export const emailThemeSchema = z.object({
    /** Fondo de afuera (lo que rodea al correo). */
    background: hex.default('#f4f5f7'),
    /** Fondo de la "hoja" del correo. */
    surface: hex.default('#ffffff'),
    text: hex.default('#1f2937'),
    muted: hex.default('#6b7280'),
    /** Botones, enlaces y detalles. */
    accent: hex.default('#0e7490'),
    font: z.enum(EMAIL_FONTS).default('modern'),
    /** Ancho de la hoja en px (600 es el estándar de facto). */
    width: z.number().int().min(480).max(720).default(600),
    /** Esquinas de la hoja y de los botones (Outlook de Windows las ignora). */
    radius: z.number().int().min(0).max(16).default(8),
    /** v0.1.272 — Tipografía de los títulos (vacío = la del texto). */
    heading_font: z.enum(DESIGN_FONTS).nullable().optional(),
    /** Color de los títulos (vacío = el del texto). */
    heading_color: optionalHex,
    /** Tamaño base del texto en px (el «Normal» de los bloques de texto). */
    font_size: z.number().int().min(11).max(22).nullable().optional(),
    /** Interlineado del texto (multiplicador). */
    line_height: z.number().min(1).max(2.4).nullable().optional(),
    /** Color de los enlaces dentro del texto (vacío = el de acento). */
    link_color: optionalHex,
    /** Margen lateral de la hoja en px (32 = lo de siempre). */
    content_pad: z.number().int().min(8).max(64).nullable().optional(),
    /** Aire alrededor de la hoja en px. */
    outer_pad: z.number().int().min(0).max(80).nullable().optional(),
    sheet_border_width: z.number().int().min(0).max(8).nullable().optional(),
    sheet_border_color: optionalHex,
    sheet_shadow: z.enum(SHADOWS).optional(),
    /**
     * v0.1.270 — Colores para cuando el programa de correo está en modo
     * oscuro. Apagado (lo de siempre): el correo se declara sólo-claro y cada
     * programa decide (Gmail y Outlook lo oscurecen a su manera). Encendido:
     * se declara `light dark` y Apple Mail, Outlook (Mac, iOS, web) y los que
     * respetan `prefers-color-scheme` usan ESTOS colores. Las bandas de color
     * de un bloque conservan sus colores (las eligió el autor).
     */
    dark: z
        .object({
            enabled: z.boolean().default(false),
            background: hex.default('#0f1115'),
            surface: hex.default('#1b1d22'),
            text: hex.default('#e8eaed'),
            muted: hex.default('#a1a7b3'),
        })
        .default({}),
});
export type EmailTheme = z.infer<typeof emailThemeSchema>;

const blockBase = {
    id: z.string().min(1).max(40),
    /** Banda de color detrás del bloque (de borde a borde de la hoja). */
    background: optionalHex,
    padding: padding.optional(),
    /** v0.1.272 — Tipografía, espaciado, borde, esquinas y sombra (ADR-S37). */
    style: blockStyleSchema.optional(),
};

const headingBlock = z.object({
    ...blockBase,
    type: z.literal('heading'),
    text: z.string().max(400).default(''),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    align: align.default('left'),
    color: optionalHex,
});

const textBlock = z.object({
    ...blockBase,
    type: z.literal('text'),
    /** Árbol ProseMirror (el mismo formato que la descripción del registro). */
    doc: richDocSchema.nullable().default(null),
    align: align.default('left'),
    size: z.enum(['sm', 'md', 'lg']).default('md'),
    color: optionalHex,
    /** Espacio entre párrafos en px (vacío = proporcional al tamaño). */
    paragraph_spacing: z.number().min(0).max(48).nullable().optional(),
});

const buttonBlock = z.object({
    ...blockBase,
    type: z.literal('button'),
    label: z.string().max(120).default(''),
    url: z.string().max(2048).default(''),
    align: align.default('center'),
    color: optionalHex,
    text_color: optionalHex,
    full_width: z.boolean().default(false),
    /** Esquinas, borde, sombra, relleno y ancho del botón. */
    btn: elementStyleSchema.optional(),
});

const imageBlock = z.object({
    ...blockBase,
    type: z.literal('image'),
    /** URL https (o una variable que resuelva a una). */
    src: z.string().max(2048).default(''),
    alt: z.string().max(200).default(''),
    /** Ancho en % del área de contenido. */
    width: z.number().int().min(10).max(100).default(100),
    align: align.default('center'),
    link: z.string().max(2048).default(''),
    /** Sin márgenes laterales: de borde a borde (cabeceras). */
    bleed: z.boolean().default(false),
    /** Marco de la imagen: esquinas, borde, sombra. */
    frame: elementStyleSchema.optional(),
});

const dividerBlock = z.object({
    ...blockBase,
    type: z.literal('divider'),
    color: optionalHex,
    thickness: z.number().int().min(1).max(4).default(1),
    line_style: z.enum(BORDER_STYLES).optional(),
    /** Largo de la línea en % del ancho. */
    length: z.number().int().min(5).max(100).optional(),
    align: align.optional(),
});

const spacerBlock = z.object({
    ...blockBase,
    type: z.literal('spacer'),
    height: z.number().int().min(4).max(120).default(24),
});

const fieldsBlock = z.object({
    ...blockBase,
    type: z.literal('fields'),
    title: z.string().max(160).default(''),
    /** Slugs de los campos del registro (etiqueta + valor legible). */
    slugs: z.array(z.string().min(1).max(80)).max(30).default([]),
    layout: z.enum(['table', 'stacked']).default('table'),
    label_color: optionalHex,
    value_color: optionalHex,
    /** Ancho de la columna de etiquetas en % (forma tabla). */
    label_width: z.number().int().min(15).max(70).optional(),
    /** Línea entre filas (forma tabla). */
    lines: z.boolean().optional(),
});

const signatureBlock = z.object({
    ...blockBase,
    type: z.literal('signature'),
});

const htmlBlock = z.object({
    ...blockBase,
    type: z.literal('html'),
    html: z.string().max(50_000).default(''),
});

/** Lo que puede ir dentro de una columna (sin columnas anidadas). */
const innerBlockSchema = z.discriminatedUnion('type', [
    headingBlock,
    textBlock,
    buttonBlock,
    imageBlock,
    dividerBlock,
    spacerBlock,
]);
export type EmailInnerBlock = z.infer<typeof innerBlockSchema>;

/** v0.1.272 — Proporciones de las columnas: «1-2» = la segunda el doble. */
export const COLUMN_RATIOS = { 2: ['1-1', '1-2', '2-1', '1-3', '3-1'], 3: ['1-1-1', '2-1-1', '1-2-1', '1-1-2'] } as const;
const ratio = z.string().regex(/^[1-4](-[1-4]){1,2}$/);

/** Una columna: sus bloques y, opcionalmente, su propio recuadro. */
const columnSchema = z.object({
    blocks: z.array(innerBlockSchema).max(EMAIL_COLUMN_MAX_BLOCKS).default([]),
    background: optionalHex,
    style: blockStyleSchema.optional(),
});

const columnsBlock = z.object({
    ...blockBase,
    type: z.literal('columns'),
    columns: z.array(columnSchema).min(2).max(3),
    ratio: ratio.optional(),
    /** Separación entre columnas en px. */
    gap: z.number().int().min(0).max(64).optional(),
    valign: z.enum(['top', 'middle', 'bottom']).optional(),
    /** En el celular, una debajo de la otra (lo de siempre) o siempre lado a lado. */
    stack: z.boolean().optional(),
});

export const emailBlockSchema = z.discriminatedUnion('type', [
    headingBlock,
    textBlock,
    buttonBlock,
    imageBlock,
    dividerBlock,
    spacerBlock,
    fieldsBlock,
    signatureBlock,
    htmlBlock,
    columnsBlock,
]);
export type EmailBlock = z.infer<typeof emailBlockSchema>;
export type EmailBlockType = EmailBlock['type'];
export type EmailInnerBlockType = EmailInnerBlock['type'];

export const emailDesignSchema = z.object({
    version: z.literal(EMAIL_DESIGN_VERSION).default(EMAIL_DESIGN_VERSION),
    theme: emailThemeSchema.default({}),
    blocks: z.array(emailBlockSchema).max(EMAIL_DESIGN_MAX_BLOCKS).default([]),
});
export type EmailDesign = z.infer<typeof emailDesignSchema>;
export type EmailDesignInput = z.input<typeof emailDesignSchema>;

/**
 * Lee un diseño guardado (tolerante): si no valida devuelve `null` — el motor
 * lo informa como error de la acción en vez de mandar un correo roto. Los
 * documentos de texto pasan por `sanitizeRichDoc` (whitelist de nodos).
 */
export function parseEmailDesign(raw: unknown): EmailDesign | null {
    const parsed = emailDesignSchema.safeParse(raw);
    if (!parsed.success) return null;
    const clean = (b: EmailInnerBlock | EmailBlock): void => {
        if (b.type === 'text') b.doc = sanitizeRichDoc(b.doc);
        if (b.type === 'columns') for (const c of b.columns) c.blocks.forEach(clean);
    };
    parsed.data.blocks.forEach(clean);
    return parsed.data;
}

// ---------------------------------------------------------------------------
// Modo del cuerpo de la acción `send_email`
// ---------------------------------------------------------------------------

export const EMAIL_BODY_MODES = ['design', 'text', 'html'] as const;
export type EmailBodyMode = (typeof EMAIL_BODY_MODES)[number];

/**
 * El modo del cuerpo de una acción guardada. Las anteriores a v0.1.265 no
 * tienen `body_mode`: `is_html` decide entre HTML y texto (siguen saliendo
 * idénticas).
 */
export function emailBodyMode(cfg: Record<string, unknown> | null | undefined): EmailBodyMode {
    const m = cfg?.body_mode;
    if (m === 'design' || m === 'text' || m === 'html') return m;
    return cfg?.is_html ? 'html' : 'text';
}

/** ¿La acción pide firma? (`include_signature` con la persona elegida). */
export function emailSignatureUserId(cfg: Record<string, unknown> | null | undefined): number | null {
    if (!cfg?.include_signature) return null;
    const id = Number(cfg.signature_user_id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/** Los slugs que usa un diseño en el bloque «Datos del registro». */
export function emailDesignFieldSlugs(design: EmailDesign): string[] {
    const out = new Set<string>();
    for (const b of design.blocks) if (b.type === 'fields') b.slugs.forEach((s) => out.add(s));
    return [...out];
}

export function emailDesignHasSignatureBlock(design: EmailDesign): boolean {
    return design.blocks.some((b) => b.type === 'signature');
}

// ---------------------------------------------------------------------------
// Utilidades de escape / URLs
// ---------------------------------------------------------------------------

export function escapeEmailHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
}

/**
 * URL apta para un correo: absoluta y de un esquema que los clientes abren.
 * `http(s)` para enlaces e imágenes; `mailto:`/`tel:` sólo para enlaces.
 */
export function safeEmailUrl(raw: string, kind: 'link' | 'image' = 'link'): string | null {
    const url = raw.trim();
    if (url === '' || url.length > 2048) return null;
    // eslint-disable-next-line no-control-regex -- buscar control chars ES el punto
    if (/[\u0000-\u001f\u007f\s]/.test(url) && !/^mailto:/i.test(url)) return null;
    if (/^https?:\/\/[^/?#]+/i.test(url)) return url;
    if (kind === 'link' && /^(mailto|tel):[^\s]+$/i.test(url)) return url;
    return null;
}

const TAG_RE = /\{\{\s*([a-zA-Z0-9_.]+)((?:\|(?:[+-]\d+[dmy]|label|value|letras|pesos|mayusculas|larga))*)\s*\}\}/g;

/** ¿El texto tiene alguna variable `{{…}}`? */
export function hasMergeTag(s: string): boolean {
    TAG_RE.lastIndex = 0;
    const has = TAG_RE.test(s);
    TAG_RE.lastIndex = 0;
    return has;
}

// ---------------------------------------------------------------------------
// Renderizado
// ---------------------------------------------------------------------------

export interface EmailRenderOptions {
    /** Resuelve las variables de un template (valores CRUDOS, sin escapar). */
    resolve: (template: string) => string;
    /** Etiqueta legible de un campo (bloque «Datos del registro»). */
    fieldLabel?: (slug: string) => string | null;
    /** Valor legible (formateado) de un campo. */
    fieldValue?: (slug: string) => string;
    /** HTML de la firma (lo escribió la persona; se limpia acá). */
    signatureHtml?: string | null;
    /** Sin bloque «Firma» en el diseño: se agrega al final. */
    appendSignature?: boolean;
    /** Texto de vista previa (template). */
    preheader?: string;
    /** Asunto (template) → `<title>`. */
    subject?: string;
    /**
     * Vista previa del EDITOR: las variables se muestran como «pastillas» en
     * vez de resolverse, y cada bloque lleva `data-ib-block` para poder
     * seleccionarlo con un click.
     */
    preview?: boolean;
    /** Bloque seleccionado en el editor (se resalta). */
    selectedId?: string | null;
    /**
     * v0.1.272 — `@font-face` de las fuentes web usadas, servidas por la app
     * (vista previa: la CSP del editor no deja cargar Google Fonts). Sin esto,
     * el correo pide las fuentes a Google Fonts (lo que sale de verdad).
     */
    webFontCss?: (fonts: DesignFont[]) => string;
}

const PAD_V: Record<EmailPadding, number> = { none: 0, sm: 6, md: 12, lg: 24 };
const DEFAULT_SIDE = 32;

interface Ctx {
    o: EmailRenderOptions;
    t: EmailTheme;
    /** Pila CSS del texto del cuerpo. */
    font: string;
    /** v0.1.272 — Tipografías del tema (texto y títulos). */
    fontKey: DesignFont;
    headingFont: DesignFont;
    /** Tamaño base del texto y su interlineado. */
    base: number;
    lh: number;
    /** Margen lateral de la hoja. */
    side: number;
    /**
     * v0.1.270 — Dentro de una banda de color: los colores del tema NO llevan
     * las clases de modo oscuro (la banda conserva sus colores claros, y un
     * texto claro sobre una banda clara sería ilegible).
     */
    band?: boolean;
    /** Tipografías usadas (para pedir las fuentes web en el `<head>`). */
    used: Set<DesignFont>;
    /** Clases de tamaño en el celular: `ib-mNN` → px. */
    mobile: Map<string, number>;
}

function makeCtx(design: EmailDesign, opts: EmailRenderOptions): Ctx {
    const t = design.theme;
    const fontKey = (DESIGN_FONTS as readonly string[]).includes(t.font) ? t.font : 'sans';
    const ctx: Ctx = {
        o: opts,
        t,
        font: fontStack(fontKey),
        fontKey,
        headingFont: t.heading_font ?? fontKey,
        base: t.font_size ?? 15,
        lh: t.line_height ?? 1.6,
        side: t.content_pad ?? DEFAULT_SIDE,
        used: new Set([fontKey]),
        mobile: new Map(),
    };
    return ctx;
}

/**
 * v0.1.270 — Marca de modo oscuro: el bloque `@media` con los colores
 * oscuros empieza con esto. La vista previa del editor lo reemplaza por
 * `@media all` para MOSTRAR el modo oscuro sin depender del sistema.
 */
export const EMAIL_DARK_MEDIA = '@media (prefers-color-scheme: dark)';

/** ` class="a b"` (o nada) con las clases que no estén vacías. */
function klass(...names: Array<string | false | null | undefined>): string {
    const list = names.filter((n): n is string => typeof n === 'string' && n !== '');
    return list.length ? ` class="${list.join(' ')}"` : '';
}

/** Clase de un color del tema (texto, secundario, borde) para el modo oscuro. */
function themeCls(ctx: Ctx, kind: 'ib-tx' | 'ib-mu' | 'ib-bd'): string | null {
    return ctx.band ? null : kind;
}

function cls(ctx: Ctx, kind: 'ib-tx' | 'ib-mu' | 'ib-bd'): string {
    return klass(themeCls(ctx, kind));
}

/** Texto "inline": template → HTML seguro (o pastillas en la vista previa). */
function inline(ctx: Ctx, template: string): string {
    if (!template) return '';
    if (ctx.o.preview) {
        let out = '';
        let last = 0;
        TAG_RE.lastIndex = 0;
        for (let m = TAG_RE.exec(template); m; m = TAG_RE.exec(template)) {
            out += escapeEmailHtml(template.slice(last, m.index));
            out += `<span style="background-color:#e0f2fe;color:#075985;border-radius:4px;padding:0 4px;font-family:Menlo,Consolas,monospace;font-size:0.85em;">${escapeEmailHtml(m[0])}</span>`;
            last = m.index + m[0].length;
        }
        TAG_RE.lastIndex = 0;
        out += escapeEmailHtml(template.slice(last));
        return out.replace(/\n/g, '<br>');
    }
    return escapeEmailHtml(ctx.o.resolve(template)).replace(/\r?\n/g, '<br>');
}

/** Template de URL → URL final (o null si no es segura). */
function url(ctx: Ctx, template: string, kind: 'link' | 'image'): string | null {
    if (!template.trim()) return null;
    if (ctx.o.preview && hasMergeTag(template)) return null;
    return safeEmailUrl(ctx.o.preview ? template : ctx.o.resolve(template), kind);
}

const attr = (s: string): string => escapeEmailHtml(s);

function marked(ctx: Ctx, html: string, marks: RichMark[] | undefined): string {
    let out = html;
    const link = ctx.t.link_color ?? ctx.t.accent;
    for (const m of marks ?? []) {
        const a = m.attrs ?? {};
        switch (m.type) {
            case 'bold':
                out = `<strong style="font-weight:bold;">${out}</strong>`;
                break;
            case 'italic':
                out = `<em style="font-style:italic;">${out}</em>`;
                break;
            case 'underline':
                out = `<u>${out}</u>`;
                break;
            case 'strike':
                out = `<s>${out}</s>`;
                break;
            case 'code':
                out = `<code style="font-family:Menlo,Consolas,monospace;font-size:0.9em;background-color:#f3f4f6;padding:0 3px;">${out}</code>`;
                break;
            case 'link': {
                const href = typeof a.href === 'string' ? url(ctx, a.href, 'link') : null;
                out = href
                    ? `<a href="${attr(href)}" target="_blank" style="color:${link};text-decoration:underline;">${out}</a>`
                    : `<span style="color:${link};text-decoration:underline;">${out}</span>`;
                break;
            }
            case 'textStyle': {
                const color = typeof a.color === 'string' && HEX.test(a.color) ? a.color : null;
                const bg =
                    typeof a.backgroundColor === 'string' && HEX.test(a.backgroundColor) ? a.backgroundColor : null;
                if (color || bg) {
                    out = `<span style="${color ? `color:${color};` : ''}${bg ? `background-color:${bg};` : ''}">${out}</span>`;
                }
                break;
            }
            case 'highlight': {
                const bg = typeof a.color === 'string' && HEX.test(a.color) ? a.color : '#fef08a';
                out = `<span style="background-color:${bg};">${out}</span>`;
                break;
            }
            default:
                break;
        }
    }
    return out;
}

// --- Tipografía (v0.1.272) ---------------------------------------------------

interface Typo {
    /** Familia, peso, itálica, letras y mayúsculas (sin tamaño ni interlineado). */
    face: string;
    size: number;
    lh: number;
    /** Clase para que Outlook de Windows use la de respaldo de una fuente web. */
    wf: string | null;
}

interface TypoDefaults {
    font: DesignFont;
    size: number;
    lh: number;
    weight?: 'bold' | 'normal' | null;
}

function weightCss(w: number): string {
    return w === 400 ? 'normal' : w === 700 ? 'bold' : String(w);
}

function typo(ctx: Ctx, st: BlockStyle | null | undefined, d: TypoDefaults): Typo {
    const font = st?.font ?? d.font;
    ctx.used.add(font);
    const def = DESIGN_FONT_DEFS[font];
    let face = `font-family:${fontStack(font)};`;
    if (st?.font_weight != null) face += `font-weight:${weightCss(st.font_weight)};`;
    else if (d.weight) face += `font-weight:${d.weight};`;
    if (st?.italic) face += 'font-style:italic;';
    if (st?.letter_spacing != null) face += `letter-spacing:${st.letter_spacing}px;`;
    if (st?.text_transform && st.text_transform !== 'none') face += `text-transform:${st.text_transform};`;
    return {
        face,
        size: st?.font_size ?? d.size,
        lh: st?.line_height ?? d.lh,
        wf: def?.kind === 'web' ? `ib-wf-${def.category}` : null,
    };
}

/** Tamaño + interlineado en px (Outlook interpreta mal el interlineado sin unidad). */
function sizeCss(size: number, lh: number): string {
    return `font-size:${size}px;mso-line-height-rule:exactly;line-height:${Math.round(size * lh)}px;`;
}

/** Un título grande con tamaño propio: en el celular se achica (`ib-mNN`). */
function mobileClass(ctx: Ctx, size: number): string | null {
    if (size < 26) return null;
    const name = `ib-m${Math.round(size)}`;
    ctx.mobile.set(name, Math.round(size * 0.82));
    return name;
}

interface TextStyle {
    size: number;
    color: string;
    align: EmailAlign;
    /** Clases de modo oscuro (vacío si el color lo eligió el autor). */
    cls: string[];
    face: string;
    lh: number;
    wf: string | null;
    /** Espacio entre párrafos (px). */
    gap: number | null;
}

function richInline(ctx: Ctx, nodes: RichNode[] | undefined): string {
    let out = '';
    for (const n of nodes ?? []) {
        if (n.type === 'text' && typeof n.text === 'string') out += marked(ctx, inline(ctx, n.text), n.marks);
        else if (n.type === 'hardBreak') out += '<br>';
        else if (n.type === 'mentionUser' || n.type === 'mentionRecord') {
            const label = typeof n.attrs?.label === 'string' ? n.attrs.label : '';
            out += escapeEmailHtml(label);
        } else out += richInline(ctx, n.content);
    }
    return out;
}

function richBlocks(ctx: Ctx, nodes: RichNode[] | undefined, st: TextStyle): string {
    const list = nodes ?? [];
    const base = `${st.face}color:${st.color};text-align:${st.align};`;
    const c = klass(...st.cls, st.wf);
    return list
        .map((n, i) => {
            const last = i === list.length - 1;
            const mb = last ? 0 : (st.gap ?? Math.round(st.size * 0.8));
            switch (n.type) {
                case 'paragraph': {
                    const inner = richInline(ctx, n.content);
                    return `<p${c} style="margin:0 0 ${mb}px 0;${base}${sizeCss(st.size, st.lh)}">${inner || '&nbsp;'}</p>`;
                }
                case 'heading': {
                    const level = Number(n.attrs?.level) || 2;
                    const size = level <= 1 ? Math.round(st.size * 1.6) : level === 2 ? Math.round(st.size * 1.35) : Math.round(st.size * 1.15);
                    const tag = `h${Math.min(3, Math.max(1, level))}`;
                    return `<${tag}${c} style="margin:0 0 ${Math.max(mb, 8)}px 0;${base}${sizeCss(size, 1.3)}font-weight:bold;">${richInline(ctx, n.content)}</${tag}>`;
                }
                case 'bulletList':
                case 'orderedList':
                case 'taskList': {
                    const tag = n.type === 'orderedList' ? 'ol' : 'ul';
                    const items = (n.content ?? [])
                        .map((li) => {
                            const check =
                                n.type === 'taskList' ? (li.attrs?.checked ? '&#9745;&nbsp;' : '&#9744;&nbsp;') : '';
                            const inner = (li.content ?? [])
                                .map((x) =>
                                    x.type === 'paragraph'
                                        ? richInline(ctx, x.content)
                                        : richBlocks(ctx, [x], { ...st }),
                                )
                                .join('<br>');
                            return `<li${c} style="margin:0 0 4px 0;${base}${sizeCss(st.size, st.lh)}">${check}${inner}</li>`;
                        })
                        .join('');
                    const listStyle = n.type === 'taskList' ? 'list-style:none;padding-left:4px;' : 'padding-left:24px;';
                    return `<${tag} style="margin:0 0 ${mb}px 0;${listStyle}">${items}</${tag}>`;
                }
                case 'blockquote':
                    return `<blockquote style="margin:0 0 ${mb}px 0;padding:2px 0 2px 14px;border-left:3px solid ${ctx.t.accent};">${richBlocks(ctx, n.content, { ...st, color: ctx.t.muted, cls: st.cls.length ? [themeCls(ctx, 'ib-mu') ?? ''] : [] })}</blockquote>`;
                case 'codeBlock':
                    return `<pre style="margin:0 0 ${mb}px 0;padding:12px;background-color:#f3f4f6;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.5;color:${st.color};white-space:pre-wrap;word-break:break-word;">${richInline(ctx, n.content)}</pre>`;
                case 'horizontalRule':
                    return dividerTable(ctx.t.muted + '', 1, mb);
                case 'table': {
                    const rows = (n.content ?? [])
                        .map(
                            (row) =>
                                `<tr>${(row.content ?? [])
                                    .map((cell) => {
                                        const head = cell.type === 'tableHeader';
                                        return `<td${cls(ctx, 'ib-bd')} style="border:1px solid #e5e7eb;padding:6px 8px;vertical-align:top;${head ? 'font-weight:bold;background-color:#f9fafb;' : ''}">${richBlocks(ctx, cell.content, { ...st, size: st.size - 1 })}</td>`;
                                    })
                                    .join('')}</tr>`,
                        )
                        .join('');
                    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 ${mb}px 0;">${rows}</table>`;
                }
                case 'columnsBlock':
                    return (n.content ?? []).map((x) => richBlocks(ctx, x.content, st)).join('');
                default:
                    return n.content ? richBlocks(ctx, n.content, st) : '';
            }
        })
        .join('');
}

function dividerTable(color: string, thickness: number, marginBottom = 0, klassAttr = '', lineStyle = 'solid'): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${marginBottom}px 0;"><tr><td${klassAttr} style="border-top:${thickness}px ${lineStyle} ${color};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`;
}

const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 28, 2: 22, 3: 18 };

/** Bordes por lado: `border-top:…;border-left:…` (Outlook entiende los cuatro). */
function borderCss(width: number | null | undefined, style: string | undefined, color: string, sides?: readonly string[]): string {
    const w = width ?? 0;
    if (w <= 0) return '';
    const list = sides && sides.length > 0 ? sides : ['top', 'right', 'bottom', 'left'];
    return list.map((s) => `border-${s}:${w}px ${style ?? 'solid'} ${color};`).join('');
}

function shadowCss(sh: string | undefined): string {
    return sh && sh !== 'none' ? `box-shadow:${SHADOW_CSS[sh as keyof typeof SHADOW_CSS]};` : '';
}

/** Lado con borde → cuánto le resta al ancho del contenido. */
function borderInset(st: { border_width?: number | null; border_sides?: readonly string[] } | null | undefined, side: 'left' | 'right'): number {
    const w = st?.border_width ?? 0;
    if (w <= 0) return 0;
    const sides = st?.border_sides && st.border_sides.length > 0 ? st.border_sides : ['top', 'right', 'bottom', 'left'];
    return sides.includes(side) ? w : 0;
}

/** El contenido de un bloque (sin la fila que lo envuelve). */
function blockContent(ctx: Ctx, b: EmailBlock | EmailInnerBlock, width: number): string {
    const t = ctx.t;
    const st = b.style;
    switch (b.type) {
        case 'heading': {
            const ty = typo(ctx, st, { font: ctx.headingFont, size: HEADING_SIZES[b.level], lh: 1.25, weight: 'bold' });
            const tag = `h${b.level}`;
            const text = inline(ctx, b.text) || (ctx.o.preview ? '<span style="opacity:.45;">Título</span>' : '');
            const own = b.color ?? t.heading_color;
            // Con tamaño propio, la clase del nivel (que achica en el celular)
            // se reemplaza por una proporcional a ESE tamaño.
            const sizeClass = st?.font_size != null ? mobileClass(ctx, ty.size) : `ib-h${b.level}`;
            return `<${tag}${klass(sizeClass, own || ctx.band ? null : 'ib-tx', ty.wf)} style="margin:0;${ty.face}${sizeCss(ty.size, ty.lh)}color:${own ?? t.text};text-align:${b.align};">${text}</${tag}>`;
        }
        case 'text': {
            const size = { sm: ctx.base - 2, md: ctx.base, lg: ctx.base + 2 }[b.size];
            const ty = typo(ctx, st, { font: ctx.fontKey, size, lh: ctx.lh });
            const color = b.color ?? t.text;
            const html = b.doc
                ? richBlocks(ctx, b.doc.content, {
                      size: ty.size,
                      color,
                      align: b.align,
                      cls: b.color ? [] : [themeCls(ctx, 'ib-tx') ?? ''],
                      face: ty.face,
                      lh: ty.lh,
                      wf: ty.wf,
                      gap: b.paragraph_spacing ?? null,
                  })
                : '';
            if (html) return html;
            return ctx.o.preview
                ? `<p style="margin:0;${ty.face}font-size:${ty.size}px;color:${t.muted};text-align:${b.align};">Escribí el texto…</p>`
                : '';
        }
        case 'button': {
            const e: ElementStyle = b.btn ?? {};
            const bg = b.color ?? t.accent;
            const fg = b.text_color ?? readableInk(bg);
            const href = url(ctx, b.url, 'link');
            const label = inline(ctx, b.label) || 'Botón';
            const ty = typo(ctx, st, { font: ctx.fontKey, size: 15, lh: 20 / 15, weight: 'bold' });
            const py = e.pad_y ?? 12;
            const px = e.pad_x ?? 26;
            const fixed = !b.full_width && e.width ? e.width : null;
            const link = `<a href="${attr(href ?? '#')}" target="_blank"${klass(ty.wf)} style="display:inline-block;${ty.face}${sizeCss(ty.size, ty.lh)}color:${fg};text-decoration:none;${b.full_width || fixed ? 'width:100%;' : ''}">${label}</a>`;
            const border = borderCss(e.border_width, e.border_style, e.border_color ?? fg);
            const width = b.full_width ? ' width="100%"' : fixed ? ` width="${fixed}"` : '';
            // bgcolor + padding en la CELDA: en Outlook el padding de un <a> no existe.
            return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${b.align}"${width} style="margin:0 ${b.align === 'center' ? 'auto' : b.align === 'right' ? '0 0 auto' : '0'};${fixed ? `width:${fixed}px;` : ''}border-collapse:separate;"><tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:${e.radius ?? t.radius}px;padding:${py}px ${px}px;mso-padding-alt:${py}px ${px}px;${border}${shadowCss(e.shadow)}">${link}</td></tr></table>`;
        }
        case 'image': {
            const src = url(ctx, b.src, 'image');
            const w = Math.max(20, Math.round((width * b.width) / 100));
            // v0.1.270 — FLUIDA: la tabla ocupa el 100% y la imagen se achica
            // con `width:100%;max-width:Wpx`. Antes la tabla llevaba `width=W`
            // fijo y en el teléfono el correo quedaba más ancho que la
            // pantalla (scroll lateral). Outlook de Windows toma el `width`
            // del atributo de la imagen, que sigue estando.
            const margin = b.align === 'center' ? 'margin:0 auto;' : b.align === 'right' ? 'margin:0 0 0 auto;' : 'margin:0;';
            if (!src) {
                return ctx.o.preview
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${b.align}"><div style="${margin}width:100%;max-width:${w}px;height:120px;line-height:120px;background-color:#eef0f3;border:1px dashed #c4c9d2;box-sizing:border-box;text-align:center;font-family:${ctx.font};font-size:13px;color:#6b7280;overflow:hidden;">${b.src ? inline(ctx, b.src) : 'Imagen'}</div></td></tr></table>`
                    : '';
            }
            const f: ElementStyle = b.frame ?? {};
            const radius = f.radius != null ? f.radius : b.bleed ? null : Math.min(t.radius, 8);
            const border = (f.border_width ?? 0) > 0 ? borderCss(f.border_width, f.border_style, f.border_color ?? '#e5e7eb') : 'border:0;';
            const img = `<img src="${attr(src)}" alt="${attr(ctx.o.preview ? b.alt : ctx.o.resolve(b.alt))}" width="${w}" style="display:block;${margin}width:100%;max-width:${w}px;height:auto;${border}outline:none;text-decoration:none;${radius != null ? `border-radius:${radius}px;` : ''}${shadowCss(f.shadow)}">`;
            const href = url(ctx, b.link, 'link');
            const linked = href ? `<a href="${attr(href)}" target="_blank" style="display:block;">${img}</a>` : img;
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${b.align}">${linked}</td></tr></table>`;
        }
        case 'divider': {
            const color = b.color ?? '#e5e7eb';
            const k = b.color ? '' : cls(ctx, 'ib-bd');
            const len = b.length ?? 100;
            if (len >= 100) return dividerTable(color, b.thickness, 0, k, b.line_style);
            const al = b.align ?? 'center';
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${al}"><table role="presentation" width="${len}%" align="${al}" cellpadding="0" cellspacing="0" border="0" style="width:${len}%;margin:0 ${al === 'center' ? 'auto' : al === 'right' ? '0 0 auto' : '0'};"><tr><td${k} style="border-top:${b.thickness}px ${b.line_style ?? 'solid'} ${color};font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td></tr></table>`;
        }
        case 'spacer':
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${b.height}" style="height:${b.height}px;font-size:1px;line-height:${b.height}px;">&nbsp;</td></tr></table>`;
        case 'fields': {
            const label = ctx.o.fieldLabel ?? (() => null);
            const ty = typo(ctx, st, { font: ctx.fontKey, size: 15, lh: 1.4 });
            const lsize = Math.max(9, Math.round(ty.size * 0.87));
            const lc = b.label_color ?? t.muted;
            const vc = b.value_color ?? t.text;
            const lcls = b.label_color ? null : themeCls(ctx, 'ib-mu');
            const vcls = b.value_color ? null : themeCls(ctx, 'ib-tx');
            const lines = b.lines !== false;
            const lw = b.label_width ?? 40;
            const rowBorder = lines ? 'border-bottom:1px solid #eceef2;' : '';
            const bd = lines ? themeCls(ctx, 'ib-bd') : null;
            const rows = b.slugs
                .map((slug) => {
                    const name = label(slug) ?? slug;
                    const value = ctx.o.preview
                        ? inline(ctx, `{{${slug}}}`)
                        : escapeEmailHtml(ctx.o.fieldValue?.(slug) ?? '').replace(/\r?\n/g, '<br>') || '&mdash;';
                    if (b.layout === 'stacked') {
                        return `<tr><td${klass(ty.wf)} style="padding:0 0 12px 0;${ty.face}"><div${klass(lcls)} style="font-size:${Math.max(9, Math.round(ty.size * 0.8))}px;line-height:1.4;color:${lc};">${escapeEmailHtml(name)}</div><div${klass(vcls)} style="${sizeCss(ty.size, 1.5)}color:${vc};">${value}</div></td></tr>`;
                    }
                    return `<tr><td width="${lw}%" valign="top"${klass(lcls, bd, ty.wf)} style="padding:8px 12px 8px 0;${rowBorder}${ty.face}${sizeCss(lsize, ty.lh)}color:${lc};">${escapeEmailHtml(name)}</td><td valign="top"${klass(vcls, bd, ty.wf)} style="padding:8px 0;${rowBorder}${ty.face}${sizeCss(ty.size, ty.lh)}color:${vc};">${value}</td></tr>`;
                })
                .join('');
            const title = b.title
                ? `<p${klass(themeCls(ctx, 'ib-tx'), ty.wf)} style="margin:0 0 8px 0;${ty.face}font-size:${lsize}px;font-weight:bold;letter-spacing:0.02em;color:${t.text};">${inline(ctx, b.title)}</p>`
                : '';
            if (!rows) {
                return ctx.o.preview
                    ? `${title}<p style="margin:0;font-family:${ctx.font};font-size:13px;color:${t.muted};">Elegí qué campos mostrar.</p>`
                    : '';
            }
            return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>`;
        }
        case 'signature': {
            const ty = typo(ctx, st, { font: ctx.fontKey, size: 14, lh: 1.5 });
            const wrap = `${ty.face}${sizeCss(ty.size, ty.lh)}color:${t.text};`;
            const sig = ctx.o.signatureHtml
                ? emailSignatureHtml(ctx.o.signatureHtml, ctx.font, t, [ctx.band ? '' : 'ib-tx', ty.wf ?? ''].filter(Boolean).join(' '), st ? wrap : undefined)
                : '';
            if (sig) return sig;
            return ctx.o.preview
                ? `<p style="margin:0;font-family:${ctx.font};font-size:13px;color:${t.muted};font-style:italic;">Acá va la firma (todavía no hay una cargada).</p>`
                : '';
        }
        case 'html': {
            if (!b.html.trim()) {
                return ctx.o.preview
                    ? `<p style="margin:0;font-family:${ctx.font};font-size:13px;color:${t.muted};">HTML propio (vacío)</p>`
                    : '';
            }
            // HTML del AUTOR (como el modo HTML de siempre): los VALORES de las
            // variables se escapan; el template no.
            if (ctx.o.preview) return b.html;
            return resolveHtmlTemplate(b.html, ctx.o.resolve);
        }
        case 'columns':
            return columnsHtml(ctx, b, width);
        default:
            return '';
    }
}

/** Variables dentro de HTML propio: se escapa SÓLO el valor. */
function resolveHtmlTemplate(html: string, resolve: (t: string) => string): string {
    return html.replace(TAG_RE, (m) => escapeEmailHtml(resolve(m)));
}

/**
 * v0.1.272 — Un bloque con CAJA (margen, relleno, borde, esquinas, sombra):
 * una tabla por fuera con el margen y otra por dentro con la caja. El borde,
 * el fondo y las esquinas van en la CELDA: Outlook dibuja bordes y fondos de
 * `<td>` (no siempre los de `<table>`), y `border-collapse:separate` hace
 * falta para que las esquinas redondeadas se vean con borde.
 */
function boxInner(
    ctx: Ctx,
    b: { style?: BlockStyle; background?: string | null },
    content: (inner: Ctx, innerW: number) => string,
    avail: number,
    d: { pad: [number, number, number, number]; padClass?: string | null; extraTd?: string },
): string {
    const st = b.style ?? {};
    const bg = b.background ?? null;
    const [pt, pr, pb, pl] = [
        st.padding_top ?? d.pad[0],
        st.padding_right ?? d.pad[1],
        st.padding_bottom ?? d.pad[2],
        st.padding_left ?? d.pad[3],
    ];
    const bw = (st.border_width ?? 0) > 0;
    const innerW = Math.max(40, avail - pl - pr - borderInset(st, 'left') - borderInset(st, 'right'));
    const child: Ctx = bg ? { ...ctx, band: true } : ctx;
    const html = content(child, innerW);
    const borderColor = st.border_color ?? '#e5e7eb';
    const bdClass = bw && !st.border_color && !bg && !ctx.band ? 'ib-bd' : null;
    const radius = st.radius ?? null;
    const padClass = st.padding_left == null && st.padding_right == null ? d.padClass : null;
    const tdStyle = `padding:${pt}px ${pr}px ${pb}px ${pl}px;${bg ? `background-color:${bg};` : ''}${borderCss(st.border_width, st.border_style, borderColor, st.border_sides)}${radius ? `border-radius:${radius}px;` : ''}${shadowCss(st.shadow)}${d.extraTd ?? ''}`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td${bg ? ` bgcolor="${bg}"` : ''}${klass(padClass, bdClass)} style="${tdStyle}">${html}</td></tr></table>`;
}

/**
 * Columnas "híbridas": divs inline-block (se apilan solos cuando no entran,
 * sin media queries — Gmail de Android las ignora a veces) + una tabla
 * condicional para Outlook de Windows, que no entiende inline-block.
 * v0.1.272: proporciones, separación, alineación vertical, recuadro por
 * columna y la opción de NO apilarlas en el celular (tabla común).
 */
function columnsHtml(ctx: Ctx, b: Extract<EmailBlock, { type: 'columns' }>, width: number): string {
    const n = b.columns.length;
    const parts = parseRatio(b.ratio, n);
    const total = parts.reduce((a, x) => a + x, 0);
    const gap = b.gap ?? 16;
    const half = gap / 2;
    const valign = b.valign ?? 'top';
    const widths = parts.map((p) => Math.floor(((width + gap) * p) / total));
    const cols = b.columns.map((c, ci) => {
        const colW = widths[ci] ?? Math.floor((width + gap) / n);
        const innerW = colW - gap;
        const blocks = (cctx: Ctx, w: number): string =>
            c.blocks
                .map((ib) => {
                    const sel = selectAttrs(ctx, ib.id);
                    if (hasBoxStyle(ib.style)) {
                        const st = ib.style ?? {};
                        const pv = PAD_V[ib.padding ?? 'sm'];
                        const inner = boxInner(cctx, ib, (x, iw) => blockContent(x, ib, iw), w, {
                            pad: ib.background ? [pv, 12, pv, 12] : [0, 0, 0, 0],
                        });
                        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${sel} style="padding:${st.margin_top ?? pv}px 0 ${st.margin_bottom ?? pv}px 0;">${inner}</td></tr></table>`;
                    }
                    const pv = PAD_V[ib.padding ?? 'sm'];
                    const bg = ib.background ? `background-color:${ib.background};` : '';
                    const child: Ctx = ib.background ? { ...cctx, band: true } : cctx;
                    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${sel} style="padding:${pv}px ${ib.background ? 12 : 0}px;${bg}">${blockContent(child, ib, ib.background ? w - 24 : w)}</td></tr></table>`;
                })
                .join('');
        const empty = ctx.o.preview
            ? `<p style="margin:0;padding:16px 0;font-family:${ctx.font};font-size:12px;color:${ctx.t.muted};text-align:center;border:1px dashed #c4c9d2;border-radius:4px;">Columna vacía: arrastrá un bloque acá</p>`
            : '&nbsp;';
        const boxed = c.background || hasBoxStyle(c.style);
        const body = boxed
            ? boxInner(ctx, c, (x, iw) => blocks(x, iw) || empty, innerW, { pad: c.background || (c.style?.border_width ?? 0) > 0 ? [12, 12, 12, 12] : [0, 0, 0, 0] })
            : blocks(ctx, innerW) || empty;
        const colAttr = ctx.o.preview ? ` data-ib-col="${attr(b.id)}:${ci}"` : '';
        return { colW, html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${colAttr} style="padding:0 ${half}px;">${body}</td></tr></table>` };
    });
    if (b.stack === false) {
        // Siempre lado a lado (también en el celular): una tabla común.
        const cells = cols
            .map((c, ci) => `<td width="${Math.round(((parts[ci] ?? 1) / total) * 100)}%" valign="${valign}" style="vertical-align:${valign};">${c.html}</td>`)
            .join('');
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -${half}px;width:calc(100% + ${gap}px);"><tr>${cells}</tr></table>`;
    }
    const divs = cols.map((c) => `<div class="ib-col" style="display:inline-block;width:100%;max-width:${c.colW}px;vertical-align:${valign};font-size:15px;">${c.html}</div>`);
    const msoOpen = `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${cols[0]?.colW ?? 0}" valign="${valign}"><![endif]-->`;
    const msoMids = cols.slice(1).map((c) => `<!--[if mso]></td><td width="${c.colW}" valign="${valign}"><![endif]-->`);
    const msoClose = `<!--[if mso]></td></tr></table><![endif]-->`;
    let joined = divs[0] ?? '';
    for (let i = 1; i < divs.length; i++) joined += (msoMids[i - 1] ?? '') + divs[i];
    return `<div style="font-size:0;text-align:left;margin:0 -${half}px;">${msoOpen}${joined}${msoClose}</div>`;
}

/** «1-2» → [1, 2] (si no corresponde a la cantidad de columnas, partes iguales). */
function parseRatio(ratio: string | undefined, n: number): number[] {
    const parts = (ratio ?? '').split('-').map(Number);
    if (parts.length !== n || parts.some((p) => !Number.isFinite(p) || p <= 0)) return Array.from({ length: n }, () => 1);
    return parts;
}

function selectAttrs(ctx: Ctx, id: string): string {
    if (!ctx.o.preview) return '';
    const selected = ctx.o.selectedId === id;
    return ` data-ib-block="${attr(id)}"${selected ? ' data-ib-selected="1"' : ''}`;
}

/** Tinta legible (blanco o casi negro) sobre un fondo, por luminancia WCAG. */
export function readableInk(bg: string): string {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg);
    if (!m) return '#ffffff';
    let h = m[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const ch = [0, 2, 4].map((i) => {
        const v = parseInt(h.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const lum = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
    // Contraste contra blanco vs contra #111827.
    const vsWhite = 1.05 / (lum + 0.05);
    const vsInk = (lum + 0.05) / (0.0137 + 0.05);
    return vsWhite >= vsInk ? '#ffffff' : '#111827';
}

/**
 * Firma (HTML escrito por la persona en Ajustes) → HTML apto para correo:
 * sin scripts, estilos, iframes, formularios ni handlers `on*`, sin
 * `javascript:`, y con estilos por defecto inline en párrafos y enlaces
 * (Outlook le pone márgenes grandes a un `<p>` sin estilo).
 */
export function emailSignatureHtml(
    html: string,
    font: string,
    theme: Pick<EmailTheme, 'text' | 'accent'>,
    klassName = '',
    wrapCss?: string,
): string {
    let h = html.slice(0, 20_000);
    h = h.replace(/<(script|style|iframe|object|embed|form|textarea|select|button|svg|math|template|noscript|head|title|meta|link|base)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
    h = h.replace(/<(script|style|iframe|object|embed|form|input|meta|link|base)\b[^>]*>/gi, '');
    h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    h = h.replace(/\s(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '');
    h = h.replace(/\s(href|src)\s*=\s*(javascript|vbscript|data):[^\s>]*/gi, '');
    h = h.replace(/<p(\s(?![^>]*\bstyle=)[^>]*)?>/gi, (_m, rest: string | undefined) => `<p${rest ?? ''} style="margin:0 0 4px 0;">`);
    h = h.replace(/<a(\s(?![^>]*\bstyle=)[^>]*)?>/gi, (_m, rest: string | undefined) => `<a${rest ?? ''} style="color:${theme.accent};">`);
    h = h.replace(/<img(\s[^>]*)?>/gi, (m) => (/\bstyle=/.test(m) ? m : m.replace(/^<img/i, '<img style="border:0;outline:none;"')));
    if (!h.trim()) return '';
    return `<div${klassName ? ` class="${klassName}"` : ''} style="${wrapCss ?? `font-family:${font};font-size:14px;line-height:1.5;color:${theme.text};`}">${h}</div>`;
}

/**
 * v0.1.270 — Colores de modo oscuro (si el tema los activa). Las clases
 * `ib-*` marcan sólo los elementos pintados con los colores DEL TEMA; lo que
 * el autor coloreó a mano y las bandas quedan como están. `[data-ogsc]` /
 * `[data-ogsb]` son los selectores que Outlook.com agrega en modo oscuro.
 */
function darkCss(t: EmailTheme): string {
    const d = t.dark;
    if (!d?.enabled) return '';
    const rules = (p: string, q: string): string =>
        `${q}.ib-bg{background-color:${d.background}!important;}${q}.ib-surface{background-color:${d.surface}!important;}${p}.ib-tx{color:${d.text}!important;}${p}.ib-mu{color:${d.muted}!important;}${p}.ib-bd{border-color:${mix(d.surface, d.text, 0.18)}!important;}`;
    return `${EMAIL_DARK_MEDIA}{:root{color-scheme:light dark;}${rules('', '')}}${rules('[data-ogsc] ', '[data-ogsb] ')}`;
}

/** Mezcla dos hex (para un borde que se vea sobre la superficie oscura). */
function mix(a: string, b: string, k: number): string {
    const parse = (h: string): number[] => {
        let x = h.replace('#', '');
        if (x.length === 3) x = x.split('').map((c) => c + c).join('');
        return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
    };
    const [ra, ga, ba] = parse(a);
    const [rb, gb, bb] = parse(b);
    const ch = (x: number, y: number): string => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
    return `#${ch(ra!, rb!)}${ch(ga!, gb!)}${ch(ba!, bb!)}`;
}

/** Una fila de la hoja (un bloque de primer nivel). */
function rowHtml(ctx: Ctx, b: EmailBlock, i: number, count: number): string {
    const t = ctx.t;
    const opts = ctx.o;
    const contentW = t.width - ctx.side * 2;
    const pad = PAD_V[b.padding ?? (b.background ? 'lg' : 'sm')];
    const bleed = b.type === 'image' && b.bleed;
    const side = bleed ? 0 : ctx.side;
    const first = i === 0;
    const last = i === count - 1;
    // La primera y la última fila respiran un poco más (la hoja no arranca
    // pegada al borde).
    const top = pad + (first && !bleed && !b.background ? 16 : 0);
    const bottom = pad + (last && !bleed && !b.background ? 16 : 0);
    const sheetCorners = (first || last)
        ? `${first ? `border-top-left-radius:${t.radius}px;border-top-right-radius:${t.radius}px;` : ''}${last ? `border-bottom-left-radius:${t.radius}px;border-bottom-right-radius:${t.radius}px;` : ''}overflow:hidden;`
        : '';
    const st = b.style;

    if (!hasBoxStyle(st)) {
        const bg = b.background ? ` bgcolor="${b.background}"` : '';
        const bgStyle = b.background ? `background-color:${b.background};` : '';
        const radius = b.background || bleed ? sheetCorners : '';
        const content = blockContent(b.background ? { ...ctx, band: true } : ctx, b, bleed ? t.width : contentW);
        if (!content && !opts.preview) return '';
        return `<tr><td${selectAttrs(ctx, b.id)}${bg} class="${bleed ? '' : 'ib-pad'}" style="padding:${top}px ${side}px ${bottom}px ${side}px;${bgStyle}${radius}">${content}</td></tr>`;
    }

    const s = st ?? {};
    const box =
        s.bg_mode === 'box' ||
        (s.bg_mode !== 'band' && ((s.border_width ?? 0) > 0 || (s.radius ?? 0) > 0 || (s.shadow != null && s.shadow !== 'none')));
    if (box) {
        // Recuadro (tarjeta) dentro de los márgenes de la hoja.
        const filled = !!b.background || (s.border_width ?? 0) > 0;
        const inner = boxInner(ctx, b, (x, iw) => blockContent(x, b, iw), bleed ? t.width : contentW, {
            pad: filled ? [16, 16, 16, 16] : [0, 0, 0, 0],
        });
        const mt = s.margin_top ?? PAD_V[b.padding ?? 'sm'] + (first ? 16 : 0);
        const mb = s.margin_bottom ?? PAD_V[b.padding ?? 'sm'] + (last ? 16 : 0);
        return `<tr><td${selectAttrs(ctx, b.id)} class="${bleed ? '' : 'ib-pad'}" style="padding:${mt}px ${side}px ${mb}px ${side}px;">${inner}</td></tr>`;
    }
    // Banda de borde a borde (lo de siempre) con su espacio y borde propios.
    // Las esquinas de la hoja, si la banda es la primera o la última y no
    // tiene margen propio que la separe del borde.
    const corners =
        b.background && s.radius == null && ((first && !s.margin_top) || (last && !s.margin_bottom)) ? sheetCorners : '';
    const inner = boxInner(ctx, b, (x, iw) => blockContent(x, b, iw), t.width, {
        pad: [top, side, bottom, side],
        padClass: bleed ? null : 'ib-pad',
        extraTd: corners,
    });
    return `<tr><td${selectAttrs(ctx, b.id)} style="padding:${s.margin_top ?? 0}px 0 ${s.margin_bottom ?? 0}px 0;">${inner}</td></tr>`;
}

/**
 * HTML completo del correo. Mismo resultado en el servidor (envío) y en el
 * navegador (vista previa del editor).
 */
export function renderEmailHtml(design: EmailDesign, opts: EmailRenderOptions): string {
    const t = design.theme;
    const ctx = makeCtx(design, opts);
    const blocks: Array<EmailBlock> = [...design.blocks];
    if (opts.appendSignature && opts.signatureHtml && !blocks.some((b) => b.type === 'signature')) {
        blocks.push({ id: '__signature', type: 'signature' });
    }
    const rows = blocks.map((b, i) => rowHtml(ctx, b, i, blocks.length)).join('');
    const preheaderText = opts.preheader ? (opts.preview ? opts.preheader : opts.resolve(opts.preheader)) : '';
    const preheader = preheaderText
        ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheaderText)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
        : '';
    const title = opts.subject ? escapeEmailHtml(opts.preview ? opts.subject : opts.resolve(opts.subject)) : '';
    const scheme = t.dark?.enabled ? 'light dark' : 'light';
    const empty =
        opts.preview && rows === ''
            ? `<tr><td style="padding:48px 32px;text-align:center;font-family:${ctx.font};font-size:14px;color:${t.muted};">Arrastrá bloques desde el panel de la izquierda (o tocalos para agregarlos).</td></tr>`
            : '';
    // v0.1.272 — Fuentes web: en el correo, Google Fonts escondido de
    // Outlook de Windows (si lo ve, ignora la pila y cae a Times New Roman) +
    // una regla sólo para Outlook que fuerza la de respaldo; en la vista
    // previa, las mismas fuentes servidas por la app.
    const used = [...ctx.used];
    const webUsed = used.filter((f) => DESIGN_FONT_DEFS[f]?.kind === 'web');
    let fontHead = '';
    let fontCss = '';
    if (webUsed.length > 0) {
        if (opts.webFontCss) fontCss = opts.webFontCss(webUsed);
        else {
            const href = googleFontsHref(webUsed);
            if (href) fontHead = `<!--[if !mso]><!--><link href="${attr(href)}" rel="stylesheet" type="text/css"><!--<![endif]-->`;
        }
        fontHead += `<!--[if mso]><style>.ib-wf-sans{font-family:Arial,Helvetica,sans-serif!important;}.ib-wf-serif{font-family:Georgia,'Times New Roman',serif!important;}.ib-wf-mono{font-family:'Courier New',Courier,monospace!important;}</style><![endif]-->`;
    }
    const mobileCss = [...ctx.mobile].map(([k, px]) => `.${k}{font-size:${px}px!important;line-height:${Math.round(px * 1.25)}px!important;}`).join('');
    const outer = t.outer_pad ?? 24;
    const sheetBorder = (t.sheet_border_width ?? 0) > 0 ? `border:${t.sheet_border_width}px solid ${t.sheet_border_color ?? '#e5e7eb'};` : '';
    return [
        '<!DOCTYPE html>',
        '<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
        '<meta name="x-apple-disable-message-reformatting">',
        '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">',
        `<meta name="color-scheme" content="${scheme}">`,
        `<meta name="supported-color-schemes" content="${scheme}">`,
        `<title>${title}</title>`,
        '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->',
        fontHead,
        `<style>${fontCss}body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}@media only screen and (max-width:${t.width + 20}px){.ib-container{width:100%!important;}.ib-pad{padding-left:20px!important;padding-right:20px!important;}.ib-col{max-width:100%!important;}.ib-h1{font-size:24px!important;}.ib-h2{font-size:20px!important;}${mobileCss}}${darkCss(design.theme)}</style>`,
        '</head>',
        `<body class="ib-bg" style="margin:0;padding:0;background-color:${t.background};">`,
        preheader,
        `<table role="presentation" class="ib-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.background}" style="background-color:${t.background};"><tr><td align="center" style="padding:${outer}px 10px;">`,
        `<!--[if mso]><table role="presentation" width="${t.width}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
        `<table role="presentation" class="ib-container ib-surface" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="width:100%;max-width:${t.width}px;margin:0 auto;background-color:${t.surface};border-radius:${t.radius}px;${sheetBorder}${shadowCss(t.sheet_shadow)}${sheetBorder || t.sheet_shadow ? 'border-collapse:separate;' : ''}">`,
        rows || empty,
        '</table>',
        '<!--[if mso]></td></tr></table><![endif]-->',
        '</td></tr></table>',
        '</body>',
        '</html>',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Texto plano alternativo
// ---------------------------------------------------------------------------

/** HTML → texto legible (firma, bloque HTML, modo HTML sin alternativa). */
export function htmlToPlainText(html: string): string {
    let s = html;
    s = s.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, d, s2, text: string) => {
        const href = (d ?? s2 ?? '').trim();
        const label = text.replace(/<[^>]+>/g, '').trim();
        if (!href || href === '#' || href === label || /^mailto:/i.test(href) && href.slice(7) === label) return label;
        return label ? `${label} (${href})` : href;
    });
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<li\b[^>]*>/gi, '\n- ');
    s = s.replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|pre)>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = s
        .replace(/&nbsp;/g, ' ')
        .replace(/&#847;|&zwnj;/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
    return s
        .split('\n')
        .map((l) => l.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function richText(ctx: Ctx, nodes: RichNode[] | undefined): string {
    const inlineText = (ns: RichNode[] | undefined): string =>
        (ns ?? [])
            .map((n) => {
                if (n.type === 'text' && typeof n.text === 'string') {
                    const v = ctx.o.resolve(n.text);
                    const link = n.marks?.find((m) => m.type === 'link');
                    const href = typeof link?.attrs?.href === 'string' ? safeEmailUrl(ctx.o.resolve(link.attrs.href)) : null;
                    return href && href !== v ? `${v} (${href})` : v;
                }
                if (n.type === 'hardBreak') return '\n';
                if (n.type === 'mentionUser' || n.type === 'mentionRecord') return String(n.attrs?.label ?? '');
                return inlineText(n.content);
            })
            .join('');
    return (nodes ?? [])
        .map((n) => {
            switch (n.type) {
                case 'paragraph':
                case 'heading':
                case 'codeBlock':
                    return inlineText(n.content);
                case 'bulletList':
                case 'taskList':
                case 'orderedList':
                    return (n.content ?? [])
                        .map((li, i) => `${n.type === 'orderedList' ? `${i + 1}.` : n.type === 'taskList' ? (li.attrs?.checked ? '[x]' : '[ ]') : '-'} ${richText(ctx, li.content).replace(/\n+/g, ' ')}`)
                        .join('\n');
                case 'blockquote':
                    return richText(ctx, n.content)
                        .split('\n')
                        .map((l) => `> ${l}`)
                        .join('\n');
                case 'horizontalRule':
                    return '----------';
                case 'table':
                    return (n.content ?? [])
                        .map((r) => (r.content ?? []).map((c) => richText(ctx, c.content).replace(/\n+/g, ' ')).join(' | '))
                        .join('\n');
                default:
                    return richText(ctx, n.content);
            }
        })
        .filter((s) => s !== '')
        .join('\n\n');
}

function blockText(ctx: Ctx, b: EmailBlock | EmailInnerBlock): string {
    switch (b.type) {
        case 'heading':
            return ctx.o.resolve(b.text).trim();
        case 'text':
            return b.doc ? richText(ctx, b.doc.content) : '';
        case 'button': {
            const href = safeEmailUrl(ctx.o.resolve(b.url));
            const label = ctx.o.resolve(b.label).trim();
            return href ? `${label || 'Abrir'}: ${href}` : label;
        }
        case 'image': {
            const href = safeEmailUrl(ctx.o.resolve(b.link));
            const alt = ctx.o.resolve(b.alt).trim();
            return href ? `${alt || 'Ver'}: ${href}` : '';
        }
        case 'divider':
            return '----------';
        case 'spacer':
            return '';
        case 'fields': {
            const lines = b.slugs.map((s) => `${ctx.o.fieldLabel?.(s) ?? s}: ${ctx.o.fieldValue?.(s) || '—'}`);
            const title = b.title ? ctx.o.resolve(b.title).trim() : '';
            return [title, ...lines].filter(Boolean).join('\n');
        }
        case 'signature':
            return ctx.o.signatureHtml ? `-- \n${htmlToPlainText(ctx.o.signatureHtml)}` : '';
        case 'html':
            return htmlToPlainText(resolveHtmlTemplate(b.html, ctx.o.resolve));
        case 'columns':
            return b.columns
                .map((c) => c.blocks.map((ib) => blockText(ctx, ib)).filter(Boolean).join('\n\n'))
                .filter(Boolean)
                .join('\n\n');
        default:
            return '';
    }
}

/** Texto plano del diseño (la parte `text/plain` del multipart/alternative). */
export function renderEmailText(design: EmailDesign, opts: EmailRenderOptions): string {
    const ctx = makeCtx(design, opts);
    const parts = design.blocks.map((b) => blockText(ctx, b));
    if (opts.appendSignature && opts.signatureHtml && !design.blocks.some((b) => b.type === 'signature')) {
        parts.push(`-- \n${htmlToPlainText(opts.signatureHtml)}`);
    }
    return parts
        .map((p) => p.trim())
        .filter(Boolean)
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// Valores legibles para el bloque «Datos del registro»
// ---------------------------------------------------------------------------

export interface EmailFieldLike {
    type: string;
    label?: string;
    config?: unknown;
}

/** Número con los separadores de la empresa (v0.1.266: también lo usan los PDF). */
export function groupNumber(n: number, decimals: number | null, format: TenantFormat['number_format']): string {
    const fixed = decimals === null ? String(Math.round(n * 1e6) / 1e6) : n.toFixed(decimals);
    const negative = fixed.startsWith('-');
    const [int, dec] = (negative ? fixed.slice(1) : fixed).split('.');
    const thousands = format === 'dot_comma' ? '.' : format === 'space_comma' ? ' ' : ',';
    const decimal = format === 'comma_dot' ? '.' : ',';
    const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return `${negative ? '-' : ''}${grouped}${dec ? decimal + dec : ''}`;
}

export function formatYmd(ymd: string, format: TenantFormat['date_format']): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return ymd;
    if (format === 'dmy') return `${m[3]}/${m[2]}/${m[1]}`;
    if (format === 'mdy') return `${m[2]}/${m[3]}/${m[1]}`;
    return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * El valor de un campo como lo LEE la persona en la ficha: etiqueta de la
 * opción, Sí/No, números con los separadores y decimales de la empresa,
 * fechas en su formato (las fecha-hora, en su zona horaria), duración,
 * teléfono formateado. Los nombres de personas los resuelve el llamador
 * (`userName`).
 */
export function formatEmailFieldValue(
    field: EmailFieldLike | undefined,
    value: unknown,
    format: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'> & { timezone?: string | null },
    userName?: (id: number) => string | null,
): string {
    if (value === null || value === undefined || value === '') return '';
    const cfg = (field?.config ?? {}) as Record<string, unknown>;
    const precision = typeof cfg.precision === 'number' ? cfg.precision : null;
    const options = Array.isArray(cfg.options) ? (cfg.options as Array<{ value?: unknown; label?: unknown }>) : [];
    const optLabel = (v: unknown): string => {
        const o = options.find((x) => x.value === v);
        return typeof o?.label === 'string' && o.label ? o.label : String(v);
    };
    switch (field?.type) {
        case 'checkbox':
            return value === true || value === 'true' || value === 1 ? 'Sí' : 'No';
        case 'select':
            return optLabel(value);
        case 'multi_select':
            return (Array.isArray(value) ? value : [value]).map(optLabel).join(', ');
        case 'number':
        case 'currency':
        case 'percent':
        case 'rating': {
            const n = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(n)) return String(value);
            if (field.type === 'rating') return `${n} de ${typeof cfg.max === 'number' ? cfg.max : 5}`;
            const dec = field.type === 'currency' ? (precision ?? 2) : precision;
            const num = groupNumber(n, dec, format.number_format);
            if (field.type === 'percent') return `${num} %`;
            if (field.type === 'currency') {
                const cur = typeof cfg.currency === 'string' ? cfg.currency : '';
                return cur ? `${cur} ${num}` : num;
            }
            return num;
        }
        case 'duration':
            return formatDuration(value);
        case 'phone':
            return formatPhone(value);
        case 'date':
            return typeof value === 'string' ? formatYmd(value, format.date_format) : String(value);
        case 'datetime': {
            if (typeof value !== 'string') return String(value);
            const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
            if (Number.isNaN(d.getTime())) return value;
            const tz = format.timezone || 'UTC';
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            }).formatToParts(d);
            const get = (k: string): string => parts.find((p) => p.type === k)?.value ?? '';
            const date = formatYmd(`${get('year')}-${get('month')}-${get('day')}`, format.date_format);
            const h = Number(get('hour'));
            const min = get('minute');
            const time =
                format.time_format === 'h12' ? `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? 'a. m.' : 'p. m.'}` : `${String(h).padStart(2, '0')}:${min}`;
            return `${date} ${time}`;
        }
        case 'user': {
            const id = Number(value);
            return (Number.isInteger(id) && userName?.(id)) || '';
        }
        default:
            if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
            if (typeof value === 'object') return '';
            return String(value);
    }
}

/** Tipos que el bloque «Datos del registro» puede mostrar (valores propios del registro). */
export const EMAIL_FIELDS_BLOCK_TYPES: readonly string[] = [
    'text',
    'long_text',
    'email',
    'url',
    'phone',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'select',
    'multi_select',
    'checkbox',
    'date',
    'datetime',
    'user',
];

export type { RichDoc as EmailRichDoc };
