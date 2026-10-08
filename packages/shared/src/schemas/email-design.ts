import { z } from 'zod';

import { formatDuration } from '../field-types/duration';
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

export const EMAIL_FONTS = ['sans', 'modern', 'serif', 'humanist', 'trebuchet'] as const;
export type EmailFont = (typeof EMAIL_FONTS)[number];

/** Tipografías del sistema: las web fonts no cargan en Outlook ni en Gmail. */
export const EMAIL_FONT_STACKS: Record<EmailFont, string> = {
    sans: 'Arial, Helvetica, sans-serif',
    modern: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', Times, serif",
    humanist: 'Verdana, Geneva, Tahoma, sans-serif',
    trebuchet: "'Trebuchet MS', 'Lucida Grande', 'Lucida Sans Unicode', sans-serif",
};

export const EMAIL_FONT_LABELS: Record<EmailFont, string> = {
    sans: 'Arial',
    modern: 'Moderna (Segoe UI / Roboto)',
    serif: 'Georgia (con serifa)',
    humanist: 'Verdana',
    trebuchet: 'Trebuchet',
};

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
});

const dividerBlock = z.object({
    ...blockBase,
    type: z.literal('divider'),
    color: optionalHex,
    thickness: z.number().int().min(1).max(4).default(1),
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

const columnsBlock = z.object({
    ...blockBase,
    type: z.literal('columns'),
    columns: z
        .array(z.object({ blocks: z.array(innerBlockSchema).max(EMAIL_COLUMN_MAX_BLOCKS).default([]) }))
        .min(2)
        .max(3),
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
}

const PAD_V: Record<EmailPadding, number> = { none: 0, sm: 6, md: 12, lg: 24 };
const SIDE = 32;

interface Ctx {
    o: EmailRenderOptions;
    t: EmailTheme;
    font: string;
    /**
     * v0.1.270 — Dentro de una banda de color: los colores del tema NO llevan
     * las clases de modo oscuro (la banda conserva sus colores claros, y un
     * texto claro sobre una banda clara sería ilegible).
     */
    band?: boolean;
}

/**
 * v0.1.270 — Marca de modo oscuro: el bloque `@media` con los colores
 * oscuros empieza con esto. La vista previa del editor lo reemplaza por
 * `@media all` para MOSTRAR el modo oscuro sin depender del sistema.
 */
export const EMAIL_DARK_MEDIA = '@media (prefers-color-scheme: dark)';

/** Clase de un color del tema (texto, secundario, borde) para el modo oscuro. */
function cls(ctx: Ctx, kind: 'ib-tx' | 'ib-mu' | 'ib-bd'): string {
    return ctx.band ? '' : ` class="${kind}"`;
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
                    ? `<a href="${attr(href)}" target="_blank" style="color:${ctx.t.accent};text-decoration:underline;">${out}</a>`
                    : `<span style="color:${ctx.t.accent};text-decoration:underline;">${out}</span>`;
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

interface TextStyle {
    size: number;
    color: string;
    align: EmailAlign;
    /** ` class="…"` de modo oscuro (vacío si el color lo eligió el autor). */
    cls?: string;
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
    const base = `font-family:${ctx.font};color:${st.color};text-align:${st.align};`;
    const c = st.cls ?? '';
    return list
        .map((n, i) => {
            const last = i === list.length - 1;
            const mb = last ? 0 : Math.round(st.size * 0.8);
            switch (n.type) {
                case 'paragraph': {
                    const inner = richInline(ctx, n.content);
                    return `<p${c} style="margin:0 0 ${mb}px 0;${base}font-size:${st.size}px;line-height:1.6;">${inner || '&nbsp;'}</p>`;
                }
                case 'heading': {
                    const level = Number(n.attrs?.level) || 2;
                    const size = level <= 1 ? Math.round(st.size * 1.6) : level === 2 ? Math.round(st.size * 1.35) : Math.round(st.size * 1.15);
                    const tag = `h${Math.min(3, Math.max(1, level))}`;
                    return `<${tag}${c} style="margin:0 0 ${Math.max(mb, 8)}px 0;${base}font-size:${size}px;line-height:1.3;font-weight:bold;">${richInline(ctx, n.content)}</${tag}>`;
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
                                .map((c) =>
                                    c.type === 'paragraph'
                                        ? richInline(ctx, c.content)
                                        : richBlocks(ctx, [c], { ...st }),
                                )
                                .join('<br>');
                            return `<li${c} style="margin:0 0 4px 0;${base}font-size:${st.size}px;line-height:1.6;">${check}${inner}</li>`;
                        })
                        .join('');
                    const listStyle = n.type === 'taskList' ? 'list-style:none;padding-left:4px;' : 'padding-left:24px;';
                    return `<${tag} style="margin:0 0 ${mb}px 0;${listStyle}">${items}</${tag}>`;
                }
                case 'blockquote':
                    return `<blockquote style="margin:0 0 ${mb}px 0;padding:2px 0 2px 14px;border-left:3px solid ${ctx.t.accent};">${richBlocks(ctx, n.content, { ...st, color: ctx.t.muted, cls: st.cls ? cls(ctx, 'ib-mu') : '' })}</blockquote>`;
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
                    return (n.content ?? []).map((c) => richBlocks(ctx, c.content, st)).join('');
                default:
                    return n.content ? richBlocks(ctx, n.content, st) : '';
            }
        })
        .join('');
}

function dividerTable(color: string, thickness: number, marginBottom = 0, klass = ''): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${marginBottom}px 0;"><tr><td${klass} style="border-top:${thickness}px solid ${color};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`;
}

const TEXT_SIZES: Record<'sm' | 'md' | 'lg', number> = { sm: 13, md: 15, lg: 17 };
const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 28, 2: 22, 3: 18 };

/** El contenido de un bloque (sin la fila que lo envuelve). */
function blockContent(ctx: Ctx, b: EmailBlock | EmailInnerBlock, width: number): string {
    const t = ctx.t;
    switch (b.type) {
        case 'heading': {
            const size = HEADING_SIZES[b.level];
            const tag = `h${b.level}`;
            const text = inline(ctx, b.text) || (ctx.o.preview ? '<span style="opacity:.45;">Título</span>' : '');
            const hc = b.color ? '' : ctx.band ? '' : ' ib-tx';
            return `<${tag} class="ib-h${b.level}${hc}" style="margin:0;font-family:${ctx.font};font-size:${size}px;line-height:1.25;font-weight:bold;color:${b.color ?? t.text};text-align:${b.align};">${text}</${tag}>`;
        }
        case 'text': {
            const color = b.color ?? t.text;
            const html = b.doc
                ? richBlocks(ctx, b.doc.content, { size: TEXT_SIZES[b.size], color, align: b.align, cls: b.color ? '' : cls(ctx, 'ib-tx') })
                : '';
            if (html) return html;
            return ctx.o.preview
                ? `<p style="margin:0;font-family:${ctx.font};font-size:${TEXT_SIZES[b.size]}px;color:${t.muted};text-align:${b.align};">Escribí el texto…</p>`
                : '';
        }
        case 'button': {
            const bg = b.color ?? t.accent;
            const fg = b.text_color ?? readableInk(bg);
            const href = url(ctx, b.url, 'link');
            const label = inline(ctx, b.label) || 'Botón';
            const link = `<a href="${attr(href ?? '#')}" target="_blank" style="display:inline-block;font-family:${ctx.font};font-size:15px;line-height:20px;font-weight:bold;color:${fg};text-decoration:none;${b.full_width ? 'width:100%;' : ''}">${label}</a>`;
            // bgcolor + padding en la CELDA: en Outlook el padding de un <a> no existe.
            return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${b.align}" ${b.full_width ? 'width="100%"' : ''} style="margin:0 ${b.align === 'center' ? 'auto' : b.align === 'right' ? '0 0 auto' : '0'};"><tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:${t.radius}px;padding:12px 26px;mso-padding-alt:12px 26px;">${link}</td></tr></table>`;
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
            const img = `<img src="${attr(src)}" alt="${attr(ctx.o.preview ? b.alt : ctx.o.resolve(b.alt))}" width="${w}" style="display:block;${margin}width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;${b.bleed ? '' : `border-radius:${Math.min(t.radius, 8)}px;`}">`;
            const href = url(ctx, b.link, 'link');
            const linked = href ? `<a href="${attr(href)}" target="_blank" style="display:block;">${img}</a>` : img;
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${b.align}">${linked}</td></tr></table>`;
        }
        case 'divider':
            return dividerTable(b.color ?? '#e5e7eb', b.thickness, 0, b.color ? '' : cls(ctx, 'ib-bd'));
        case 'spacer':
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${b.height}" style="height:${b.height}px;font-size:1px;line-height:${b.height}px;">&nbsp;</td></tr></table>`;
        case 'fields': {
            const label = ctx.o.fieldLabel ?? (() => null);
            const rows = b.slugs
                .map((slug) => {
                    const name = label(slug) ?? slug;
                    const value = ctx.o.preview
                        ? inline(ctx, `{{${slug}}}`)
                        : escapeEmailHtml(ctx.o.fieldValue?.(slug) ?? '').replace(/\r?\n/g, '<br>') || '&mdash;';
                    if (b.layout === 'stacked') {
                        return `<tr><td style="padding:0 0 12px 0;font-family:${ctx.font};"><div${cls(ctx, 'ib-mu')} style="font-size:12px;line-height:1.4;color:${t.muted};">${escapeEmailHtml(name)}</div><div${cls(ctx, 'ib-tx')} style="font-size:15px;line-height:1.5;color:${t.text};">${value}</div></td></tr>`;
                    }
                    return `<tr><td width="40%" valign="top"${ctx.band ? '' : ' class="ib-mu ib-bd"'} style="padding:8px 12px 8px 0;border-bottom:1px solid #eceef2;font-family:${ctx.font};font-size:13px;line-height:1.4;color:${t.muted};">${escapeEmailHtml(name)}</td><td valign="top"${ctx.band ? '' : ' class="ib-tx ib-bd"'} style="padding:8px 0;border-bottom:1px solid #eceef2;font-family:${ctx.font};font-size:15px;line-height:1.4;color:${t.text};">${value}</td></tr>`;
                })
                .join('');
            const title = b.title
                ? `<p${cls(ctx, 'ib-tx')} style="margin:0 0 8px 0;font-family:${ctx.font};font-size:13px;font-weight:bold;letter-spacing:0.02em;color:${t.text};">${inline(ctx, b.title)}</p>`
                : '';
            if (!rows) {
                return ctx.o.preview
                    ? `${title}<p style="margin:0;font-family:${ctx.font};font-size:13px;color:${t.muted};">Elegí qué campos mostrar.</p>`
                    : '';
            }
            return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>`;
        }
        case 'signature': {
            const sig = ctx.o.signatureHtml ? emailSignatureHtml(ctx.o.signatureHtml, ctx.font, t, ctx.band ? '' : 'ib-tx') : '';
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
 * Columnas "híbridas": divs inline-block (se apilan solos cuando no entran,
 * sin media queries — Gmail de Android las ignora a veces) + una tabla
 * condicional para Outlook de Windows, que no entiende inline-block.
 */
function columnsHtml(ctx: Ctx, b: Extract<EmailBlock, { type: 'columns' }>, width: number): string {
    const n = b.columns.length;
    const gap = 8;
    const colW = Math.floor((width + gap * 2) / n);
    const innerW = colW - gap * 2;
    const cols = b.columns.map((c, ci) => {
        const inner = c.blocks
            .map((ib) => {
                const sel = selectAttrs(ctx, ib.id);
                const pv = PAD_V[ib.padding ?? 'sm'];
                const bg = ib.background ? `background-color:${ib.background};` : '';
                const child: Ctx = ib.background ? { ...ctx, band: true } : ctx;
                return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${sel} style="padding:${pv}px ${ib.background ? 12 : 0}px;${bg}">${blockContent(child, ib, ib.background ? innerW - 24 : innerW)}</td></tr></table>`;
            })
            .join('');
        return `<div class="ib-col" style="display:inline-block;width:100%;max-width:${colW}px;vertical-align:top;font-size:15px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td${ctx.o.preview ? ` data-ib-col="${attr(b.id)}:${ci}"` : ''} style="padding:0 ${gap}px;">${inner || (ctx.o.preview ? `<p style="margin:0;padding:16px 0;font-family:${ctx.font};font-size:12px;color:${ctx.t.muted};text-align:center;border:1px dashed #c4c9d2;border-radius:4px;">Columna vacía: arrastrá un bloque acá</p>` : '&nbsp;')}</td></tr></table></div>`;
    });
    const msoOpen = `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${colW}" valign="top"><![endif]-->`;
    const msoMid = `<!--[if mso]></td><td width="${colW}" valign="top"><![endif]-->`;
    const msoClose = `<!--[if mso]></td></tr></table><![endif]-->`;
    return `<div style="font-size:0;text-align:left;margin:0 -${gap}px;">${msoOpen}${cols.join(msoMid)}${msoClose}</div>`;
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
export function emailSignatureHtml(html: string, font: string, theme: Pick<EmailTheme, 'text' | 'accent'>, klass = ''): string {
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
    return `<div${klass ? ` class="${klass}"` : ''} style="font-family:${font};font-size:14px;line-height:1.5;color:${theme.text};">${h}</div>`;
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

/**
 * HTML completo del correo. Mismo resultado en el servidor (envío) y en el
 * navegador (vista previa del editor).
 */
export function renderEmailHtml(design: EmailDesign, opts: EmailRenderOptions): string {
    const t = design.theme;
    const ctx: Ctx = { o: opts, t, font: EMAIL_FONT_STACKS[t.font] ?? EMAIL_FONT_STACKS.sans };
    const contentW = t.width - SIDE * 2;
    const blocks: Array<EmailBlock> = [...design.blocks];
    if (opts.appendSignature && opts.signatureHtml && !blocks.some((b) => b.type === 'signature')) {
        blocks.push({ id: '__signature', type: 'signature' });
    }
    const rows = blocks
        .map((b, i) => {
            const pad = PAD_V[b.padding ?? (b.background ? 'lg' : 'sm')];
            const bleed = b.type === 'image' && b.bleed;
            const side = bleed ? 0 : SIDE;
            const first = i === 0;
            const last = i === blocks.length - 1;
            // La primera y la última fila respiran un poco más (la hoja no
            // arranca pegada al borde).
            const top = pad + (first && !bleed && !b.background ? 16 : 0);
            const bottom = pad + (last && !bleed && !b.background ? 16 : 0);
            const bg = b.background ? ` bgcolor="${b.background}"` : '';
            const bgStyle = b.background ? `background-color:${b.background};` : '';
            const radius =
                (first || last) && (b.background || bleed)
                    ? `${first ? `border-top-left-radius:${t.radius}px;border-top-right-radius:${t.radius}px;` : ''}${last ? `border-bottom-left-radius:${t.radius}px;border-bottom-right-radius:${t.radius}px;` : ''}overflow:hidden;`
                    : '';
            const content = blockContent(b.background ? { ...ctx, band: true } : ctx, b, bleed ? t.width : contentW);
            if (!content && !opts.preview) return '';
            return `<tr><td${selectAttrs(ctx, b.id)}${bg} class="${bleed ? '' : 'ib-pad'}" style="padding:${top}px ${side}px ${bottom}px ${side}px;${bgStyle}${radius}">${content}</td></tr>`;
        })
        .join('');
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
        `<style>body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}@media only screen and (max-width:${t.width + 20}px){.ib-container{width:100%!important;}.ib-pad{padding-left:20px!important;padding-right:20px!important;}.ib-col{max-width:100%!important;}.ib-h1{font-size:24px!important;}.ib-h2{font-size:20px!important;}}${darkCss(design.theme)}</style>`,
        '</head>',
        `<body class="ib-bg" style="margin:0;padding:0;background-color:${t.background};">`,
        preheader,
        `<table role="presentation" class="ib-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.background}" style="background-color:${t.background};"><tr><td align="center" style="padding:24px 10px;">`,
        `<!--[if mso]><table role="presentation" width="${t.width}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
        `<table role="presentation" class="ib-container ib-surface" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="width:100%;max-width:${t.width}px;margin:0 auto;background-color:${t.surface};border-radius:${t.radius}px;">`,
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
    const ctx: Ctx = { o: opts, t: design.theme, font: '' };
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
