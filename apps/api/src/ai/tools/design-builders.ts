import {
    DESIGN_FONTS,
    docAllBlocks,
    docDesignSchema,
    docItemExprRefs,
    docItemExprSchema,
    emailDesignSchema,
    markdownToRichDoc,
    richDocToMarkdown,
    sanitizeRichDoc,
    type DocDesign,
    type EmailDesign,
    type FieldType,
    type RichNode,
} from '@imagina-base/shared';
import { z } from 'zod';
import { AiToolError } from './registry';

/**
 * v0.1.281 — Correos y documentos PDF DISEÑADOS desde el asistente y el MCP.
 *
 * El modelo habla el MISMO modelo de bloques que guardan los editores
 * visuales (ADR-S34 correos, ADR-S35 documentos, ADR-S37 estilos), con tres
 * comodidades que lo hacen escribible sin errores:
 *  - los textos con formato van como `text` en notación sencilla
 *    (`**negrita**`, `- viñeta`, `[enlace](https://…)`) y acá se convierten
 *    al árbol del editor (`markdownToRichDoc`);
 *  - los `id` de bloque son opcionales (se generan);
 *  - la tabla de ítems de un PDF dice `from` = slug de la lista vinculada en
 *    vez de ids de relación.
 * El resultado se valida con los schemas COMPARTIDOS — es exactamente lo que
 * guarda el editor, así que después se sigue retocando ahí.
 *
 * Al leer (get_list_schema / get_document_template) se hace el camino
 * inverso (`*ForModel`): árbol → texto sencillo, ids de relación → slugs.
 */

// ── Vocabulario documentado para el modelo ─────────────────────────────

const STYLE_DOC =
    `\`style\` (opcional, en cualquier bloque): font (${DESIGN_FONTS.join('|')}; las web —inter en adelante— se ven en Apple Mail/iPhone y siempre en el PDF, en Gmail/Outlook cae a su respaldo), ` +
    'font_size, font_weight 400|600|700|800, italic, line_height, letter_spacing, text_transform (none|uppercase|lowercase|capitalize), ' +
    'margin_top, margin_bottom, padding_top/right/bottom/left, bg_mode band|box (correo: banda de borde a borde o recuadro), border_width, border_style solid|dashed|dotted, border_color, border_sides [top,right,bottom,left], radius, shadow none|sm|md|lg. ' +
    'Colores siempre en hex #rrggbb. Merge tags {{slug}}, {{slug|label}}, {{record.id}}, {{date.today|larga}}, {{monto|pesos}} en cualquier texto.';

export const EMAIL_DESIGN_DOC =
    'Diseño por BLOQUES del correo (el mismo del editor visual; se ve igual en Gmail y Outlook, y se adapta al celular). ' +
    '{theme?, blocks}. theme: {background (fondo de afuera), surface (hoja), text, muted, accent (botones/enlaces; si falta se usa el color de la marca), font, heading_font, heading_color, font_size 11-22, line_height, link_color, width 480-720 (600), radius 0-16, content_pad, outer_pad, sheet_border_width, sheet_border_color, sheet_shadow, dark {enabled, background, surface, text, muted}}. ' +
    'Bloques (type): heading {text, level 1|2|3, align left|center|right, color} | ' +
    'text {text (formato sencillo: **negrita**, *cursiva*, ~~tachado~~, [enlace](https://…), líneas con "- " viñetas, "1. " numeradas, "> " cita; párrafos separados por una línea en blanco), align, size sm|md|lg, color, paragraph_spacing} | ' +
    'button {label, url (https://… o {{campo}}), align, color, text_color, full_width, btn {radius, border_width, border_color, shadow, pad_y, pad_x, width}} | ' +
    'image {src https, alt, width 10-100 (%), align, link, bleed (de borde a borde), frame {radius, border_width, border_color, shadow}} | ' +
    'fields {title, slugs [campos del registro: etiqueta + valor legible], layout table|stacked, label_color, value_color, label_width, lines} | ' +
    'divider {color, thickness 1-4, line_style, length %, align} | spacer {height 4-120} | signature (la firma de signature_user_id) | html {html} | ' +
    'columns {columns: [{blocks: [heading|text|button|image|divider|spacer], background, style}] (2 o 3), ratio "1-1"|"1-2"|"2-1"|"1-3"|"3-1"|"1-1-1"…, gap, valign top|middle|bottom, stack (false = no apilar en celular)}. ' +
    'Todos los bloques aceptan background (banda de color), padding none|sm|md|lg y ' +
    STYLE_DOC;

export const EMAIL_DESIGN_GUIDE =
    'Para un BUEN correo: una banda de cabecera con el color de la marca (heading level 1 centrado, color #ffffff, background = accent, padding lg); ' +
    'un saludo personal con {{campo}} en text size md; los datos clave en un bloque fields (tabla, lines: true) en vez de párrafos con muchas variables; ' +
    'UN solo botón principal (o dos en columns si son igual de importantes); divider y un pie corto en text size sm color = muted; la firma al final si corresponde. ' +
    'Frases cortas, nada de mayúsculas sostenidas, máximo 600 px. Agrega `preheader` (el resumen que muestra la bandeja).';

export const DOC_DESIGN_DOC =
    'Diseño por BLOQUES del PDF (el mismo del editor visual). {theme?, footer?, numbering?, blocks}. ' +
    'theme: {page_size letter|a4|legal, orientation portrait|landscape, margin narrow|normal|wide, font_size 8-13 (pt), text, muted, accent (títulos, encabezado de la tabla, total; si falta, el color de la marca), border, font, heading_font, line_height}. ' +
    'footer: {text (con variables), page_numbers}. numbering: {enabled, prefix "CC-", padding 4, start 1, save_field (slug de un campo de texto donde guardarlo), freeze (true = CONGELAR el documento al emitirlo: la primera vez que sale con su número se guarda el PDF y desde ahí se entrega siempre ése aunque cambie el registro; sólo con enabled; para facturas y documentos que no deben cambiar)} → {{documento.numero}}. ' +
    'Bloques (type): header {layout split|centered|band, logo {kind none|brand|url, url}, logo_width 30-240, company (renglones de quien emite; el primero en negrita), title "CUENTA DE COBRO", number "N.º {{documento.numero}}", date "Bogotá, {{date.today|larga}}"} | ' +
    'heading {text, level, align, color} | text {text (formato sencillo, igual que en correos), align left|center|right|justify, size sm|md|lg, color} | ' +
    'fields {title, slugs, layout table|stacked, columns 1|2, label_color, value_color, label_width, lines} | ' +
    'items {title, from (slug de la lista VINCULADA cuyos registros son las filas), via (slug del campo relación, sólo si hay dos relaciones con esa lista), columns [{slug (de la lista vinculada), label, align, width auto|fill} | columna CALCULADA {kind "computed", slug (clave propia que no sea un campo, p. ej. "calc_total"), label, align right, expr, format currency|number|percent, decimals (se redondea a esto: 0 en pesos), prefix "$ ", hidden (se calcula y suma pero no se dibuja)}], numbered, sort {slug, dir}, limit, striped, empty_text}. ' +
    'expr (fórmula SIN código, sobre la MISMA fila): {op col, slug (campo de la lista vinculada o columna calculada ANTERIOR)} | {op const, value} | {op add|sub|mul|div, args [2-6 expr]} | {op pct, of expr, pct expr} (of × pct / 100) | {op minus_pct, of expr, pct expr} (of × (1 − pct/100): aplicar un descuento %). Ej. total de la línea con descuento: {op minus_pct, of {op mul, args [{op col, slug cantidad}, {op col, slug precio}]}, pct {op col, slug descuento}}. Vacíos: en sumas cuentan 0, en productos dejan la celda vacía, un % vacío es 0. | ' +
    'totals {rows [{id, label (admite variables), source: {kind items_sum, block_id (id del bloque items), slug (campo o columna calculada)} | {kind field, slug} | {kind percent, of (id de otra fila), pct, pct_field (slug de un campo numérico del registro con el %; vacío = pct), negate (true = se resta: un descuento)} | {kind sum, rows [ids], minus [ids]} | {kind text, value}, emphasis, hidden (se calcula pero no se dibuja), hide_zero (no se dibuja si da 0)}], width half|full, prefix "$ ", decimals (cada fila se redondea a esto antes de usarse en otra)} → cada fila también queda como {{totales.<id>}}. ' +
    'Cotización/factura: Subtotal = items_sum de la columna bruto (cantidad × precio, hidden); Descuentos = items_sum de una calculada (total − bruto, hidden, en negativo, hide_zero); Descuento global = percent of neto con negate; Base gravable = sum; IVA = percent 19 of base; TOTAL = sum(base, iva) con emphasis; y un text "Son: {{totales.total|pesos|mayusculas}} M/CTE.". | ' +
    'image {src {kind brand|url, url}, width %, align, frame} | qr {value (con variables), size 40-240, align, caption} | signature {signers [{name, detail}] (1-3), align, line, image {kind url, url}} | ' +
    'divider | spacer {height} | page_break | columns {columns: [{blocks: [heading|text|image|fields|qr|divider|spacer], background, style}] (2-3), ratio, gap}. ' +
    'Todos aceptan background, padding y ' +
    STYLE_DOC +
    ' Modificadores útiles en PDF: {{valor|pesos}} (en letras con "pesos"), {{valor|letras}}, {{fecha|larga}}, {{texto|mayusculas}}.';

export const DOC_DESIGN_GUIDE =
    'Para un BUEN documento: header split con logo de la marca (kind brand), los datos de quien emite y título + número + fecha; ' +
    'un bloque fields de 2 columnas con los datos del cliente; la tabla items con la descripción en width fill y los montos alineados a la derecha; ' +
    'totals a la mitad derecha con el total en emphasis; un text con el valor en letras ({{valor|pesos}}) y la forma de pago; signature al final; ' +
    'footer con los datos de contacto y page_numbers. Carta y margen normal salvo que se pida otra cosa; un solo color de acento.';

export const emailDesignInput = z
    .object({
        theme: z.record(z.unknown()).optional(),
        blocks: z.array(z.record(z.unknown())).min(1).max(60),
    })
    .describe(EMAIL_DESIGN_DOC);

export const docDesignInput = z
    .object({
        theme: z.record(z.unknown()).optional(),
        footer: z.record(z.unknown()).optional(),
        numbering: z.record(z.unknown()).optional(),
        blocks: z.array(z.record(z.unknown())).min(1).max(80),
    })
    .describe(DOC_DESIGN_DOC);

// ── Contexto ────────────────────────────────────────────────────────────

export interface DesignFieldRef {
    id: number;
    slug: string;
    label: string;
    type: FieldType;
}

export interface DocRelationRef {
    relation_field_id: number;
    relation_slug: string;
    direction: 'forward' | 'reverse';
    other_list_id: number;
    other_list_slug: string;
}

export interface EmailDesignContext {
    fields: DesignFieldRef[];
    /** Color de la marca (si la persona no eligió un acento). */
    brandColor?: string | null;
}

export interface DocDesignContext extends EmailDesignContext {
    relations: DocRelationRef[];
    /** Campos de cada lista vinculada (por id de lista). */
    otherFields: Map<number, DesignFieldRef[]>;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function issues(err: z.ZodError): string {
    return err.issues
        .slice(0, 6)
        .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
        .join('; ');
}

/** Merge tags `{{slug}}` que no existen (los de sistema llevan punto). */
function checkTags(value: unknown, slugs: Set<string>, bad: Set<string>): void {
    if (typeof value === 'string') {
        for (const m of value.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) {
            const tag = m[1]!.trim();
            if (tag.includes('.')) continue;
            if (!slugs.has(tag) && !/^f\d+$/.test(tag)) bad.add(tag);
        }
        return;
    }
    if (Array.isArray(value)) for (const v of value) checkTags(v, slugs, bad);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) checkTags(v, slugs, bad);
}

/**
 * Bloques del modelo → bloques del editor: id generado si falta y el texto
 * sencillo convertido al árbol. Recorre también las columnas.
 */
function normalizeBlocks(raw: Array<Record<string, unknown>>, prefix: string, seq: { n: number }, used: Set<string>): Array<Record<string, unknown>> {
    return raw.map((b) => {
        const out: Record<string, unknown> = { ...b };
        let id = typeof out.id === 'string' && out.id.trim() ? out.id.trim().slice(0, 40) : '';
        if (!id || used.has(id)) {
            do id = `${prefix}${++seq.n}`;
            while (used.has(id));
        }
        used.add(id);
        out.id = id;
        if (out.type === 'text') {
            if (typeof out.text === 'string') out.doc = markdownToRichDoc(out.text);
            else if (out.doc) out.doc = sanitizeRichDoc(out.doc as RichNode);
            delete out.text;
        }
        if (out.type === 'columns' && Array.isArray(out.columns)) {
            out.columns = (out.columns as unknown[]).map((c) => {
                const col = Array.isArray(c) ? { blocks: c } : { ...(c as Record<string, unknown>) };
                col.blocks = normalizeBlocks((Array.isArray(col.blocks) ? col.blocks : []) as Array<Record<string, unknown>>, prefix, seq, used);
                return col;
            });
        }
        return out;
    });
}

function withBrandAccent(theme: Record<string, unknown> | undefined, brand: string | null | undefined): Record<string, unknown> {
    const t = { ...(theme ?? {}) };
    if (t.accent === undefined && brand && HEX6.test(brand)) t.accent = brand;
    return t;
}

// ── Correo ──────────────────────────────────────────────────────────────

export function buildEmailDesign(input: z.infer<typeof emailDesignInput>, ctx: EmailDesignContext): EmailDesign {
    const blocks = normalizeBlocks(input.blocks, 'b', { n: 0 }, new Set());
    const parsed = emailDesignSchema.safeParse({ theme: withBrandAccent(input.theme, ctx.brandColor), blocks });
    if (!parsed.success) throw new AiToolError(`El diseño del correo no es válido: ${issues(parsed.error)}.`);
    const design = parsed.data;
    const slugs = new Set(ctx.fields.map((f) => f.slug));
    const badSlugs = new Set<string>();
    for (const b of design.blocks) if (b.type === 'fields') for (const s of b.slugs) if (!slugs.has(s)) badSlugs.add(s);
    if (badSlugs.size > 0) {
        throw new AiToolError(`El bloque fields usa campos que no existen: ${[...badSlugs].join(', ')}. Campos: ${[...slugs].join(', ')}.`);
    }
    if (design.blocks.some((b) => b.type === 'fields' && b.slugs.length === 0)) {
        throw new AiToolError('Un bloque fields necesita al menos un slug en `slugs`.');
    }
    const badTags = new Set<string>();
    checkTags(design.blocks, slugs, badTags);
    if (badTags.size > 0) throw new AiToolError(`El correo usa variables que no son campos de la lista: ${[...badTags].map((t) => `{{${t}}}`).join(', ')}. Campos: ${[...slugs].join(', ')}.`);
    return design;
}

/**
 * Las acciones `send_email` que traen `design` en el vocabulario del modelo
 * pasan a `body_mode: 'design'` con el diseño del editor. Recorre las ramas
 * de un si/sino. Muta IN PLACE (igual que `translateBulkEditActions`).
 */
export function translateEmailDesignActions(actions: unknown[], ctx: EmailDesignContext, depth = 0): void {
    if (depth > 4) return;
    for (const raw of actions) {
        const a = raw as { type?: unknown; config?: Record<string, unknown> };
        const cfg = a?.config;
        if (!cfg || typeof cfg !== 'object') continue;
        if (a.type === 'if_else') {
            translateEmailDesignActions((cfg.then_actions as unknown[]) ?? [], ctx, depth + 1);
            translateEmailDesignActions((cfg.else_actions as unknown[]) ?? [], ctx, depth + 1);
            continue;
        }
        if (a.type !== 'send_email' || cfg.design === undefined || cfg.design === null) continue;
        const spec = emailDesignInput.safeParse(cfg.design);
        if (!spec.success) throw new AiToolError(`send_email.design: ${issues(spec.error)}.`);
        cfg.design = buildEmailDesign(spec.data, ctx);
        cfg.body_mode = 'design';
        delete cfg.is_html;
        if (cfg.body === undefined) cfg.body = '';
    }
}

/** Para leer: los bloques de texto vuelven a texto sencillo (y sin ids). */
export function emailDesignForModel(design: unknown): unknown {
    const parsed = emailDesignSchema.safeParse(design);
    if (!parsed.success) return design;
    const blocks = (list: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
        list.map((b) => {
            const out: Record<string, unknown> = { ...b };
            if (out.type === 'text') {
                out.text = richDocToMarkdown(out.doc as RichNode | null);
                delete out.doc;
            }
            if (out.type === 'columns') {
                out.columns = (out.columns as Array<Record<string, unknown>>).map((c) => ({ ...c, blocks: blocks(c.blocks as Array<Record<string, unknown>>) }));
            }
            return out;
        });
    return { theme: parsed.data.theme, blocks: blocks(parsed.data.blocks as unknown as Array<Record<string, unknown>>) };
}

/** Recorre las acciones (y ramas) reemplazando los diseños de correo para leer. */
export function emailActionsForModel(actions: unknown): unknown {
    if (!Array.isArray(actions)) return actions;
    return actions.map((raw) => {
        const a = raw as { type?: unknown; config?: Record<string, unknown> };
        if (!a || typeof a !== 'object' || !a.config) return raw;
        if (a.type === 'if_else') {
            return {
                ...a,
                config: { ...a.config, then_actions: emailActionsForModel(a.config.then_actions), else_actions: emailActionsForModel(a.config.else_actions) },
            };
        }
        if (a.type === 'send_email' && a.config.body_mode === 'design' && a.config.design) {
            return { ...a, config: { ...a.config, design: emailDesignForModel(a.config.design) } };
        }
        return raw;
    });
}

// ── Documento PDF ───────────────────────────────────────────────────────

export function buildDocDesign(input: z.infer<typeof docDesignInput>, ctx: DocDesignContext): DocDesign {
    const blocks = normalizeBlocks(input.blocks, 'd', { n: 0 }, new Set());
    const slugs = new Set(ctx.fields.map((f) => f.slug));
    const byId = new Map(ctx.fields.map((f) => [f.slug, f]));

    // Tabla de ítems: `from` (+ `via`) → la relación y la lista del otro lado.
    const itemsFields = new Map<string, Set<string>>();
    for (const b of blocks) {
        if (b.type !== 'items') continue;
        if (b.source === undefined || b.source === null || b.from !== undefined) {
            const from = typeof b.from === 'string' ? b.from : '';
            if (!from) throw new AiToolError(`El bloque items «${String(b.id)}» necesita \`from\`: el slug de la lista vinculada cuyos registros son las filas.`);
            const candidates = ctx.relations.filter((r) => r.other_list_slug === from);
            const via = typeof b.via === 'string' ? b.via : null;
            const hit = via ? candidates.find((r) => r.relation_slug === via) : candidates.length === 1 ? candidates[0] : undefined;
            if (!hit) {
                const linked = [...new Set(ctx.relations.map((r) => r.other_list_slug))];
                throw new AiToolError(
                    candidates.length > 1 && !via
                        ? `Hay ${candidates.length} relaciones con «${from}»: indica \`via\` (${candidates.map((r) => r.relation_slug).join(', ')}).`
                        : `La lista «${from}» no está vinculada a esta${via ? ` por «${via}»` : ''}. Listas vinculadas: ${linked.join(', ') || 'ninguna (crea antes un campo relación)'}.`,
                );
            }
            b.source = { relation_field_id: hit.relation_field_id, direction: hit.direction, list_id: hit.other_list_id };
            const other = ctx.otherFields.get(hit.other_list_id) ?? [];
            itemsFields.set(String(b.id), new Set(other.map((f) => f.slug)));
        } else {
            const src = b.source as { list_id?: number };
            const other = ctx.otherFields.get(Number(src.list_id)) ?? [];
            itemsFields.set(String(b.id), new Set(other.map((f) => f.slug)));
        }
        delete b.from;
        delete b.via;
        const cols = Array.isArray(b.columns) ? (b.columns as Array<Record<string, unknown>>) : [];
        const pool = itemsFields.get(String(b.id))!;
        const fieldSlugs = new Set(pool);
        if (cols.length === 0) throw new AiToolError(`El bloque items «${String(b.id)}» necesita columns (slugs de la lista vinculada).`);
        // v0.1.292 — Una columna calculada (`kind: computed`) tiene su clave
        // propia y su fórmula lee campos de la lista vinculada o calculadas
        // ANTERIORES; su clave queda disponible para los totales (items_sum).
        const bad: string[] = [];
        for (const c of cols) {
            const slug = String(c.slug ?? '');
            if (c.kind === 'computed') {
                if (!slug || fieldSlugs.has(slug)) {
                    throw new AiToolError(`items «${String(b.id)}»: la columna calculada necesita un \`slug\` propio que no sea un campo (p. ej. "calc_total").`);
                }
                const expr = docItemExprSchema.safeParse(c.expr);
                if (!expr.success) {
                    throw new AiToolError(`items «${String(b.id)}», columna «${slug}»: la fórmula (expr) no es válida. Usa {op: col|const|add|sub|mul|div|pct|minus_pct, …}.`);
                }
                const missing = [...docItemExprRefs(expr.data)].filter((r) => !pool.has(r));
                if (missing.length > 0) {
                    throw new AiToolError(
                        `items «${String(b.id)}», columna «${slug}»: la fórmula lee ${missing.join(', ')}, que no son campos de la lista vinculada ni columnas calculadas anteriores. Campos: ${[...fieldSlugs].join(', ')}.`,
                    );
                }
                pool.add(slug);
                continue;
            }
            if (!fieldSlugs.has(slug)) bad.push(slug);
        }
        if (bad.length > 0) throw new AiToolError(`El bloque items «${String(b.id)}» usa columnas que no existen en la lista vinculada: ${bad.join(', ')}. Campos: ${[...fieldSlugs].join(', ')}.`);
        const sort = b.sort as { slug?: string } | null | undefined;
        if (sort?.slug && !fieldSlugs.has(sort.slug)) throw new AiToolError(`items «${String(b.id)}»: no se puede ordenar por «${sort.slug}».`);
    }

    // Logo/imágenes: el modelo no sube archivos; `file` sólo si ya venía (ida y vuelta).
    const parsed = docDesignSchema.safeParse({
        theme: withBrandAccent(input.theme, ctx.brandColor),
        footer: input.footer,
        numbering: input.numbering,
        blocks,
    });
    if (!parsed.success) throw new AiToolError(`El diseño del documento no es válido: ${issues(parsed.error)}.`);
    const design = parsed.data;

    const bad = new Set<string>();
    for (const b of docAllBlocks(design)) {
        if (b.type === 'fields') {
            if (b.slugs.length === 0) throw new AiToolError('Un bloque fields necesita al menos un slug en `slugs`.');
            for (const s of b.slugs) if (!slugs.has(s)) bad.add(s);
        }
        if (b.type === 'totals') {
            const rowIds = new Set(b.rows.map((r) => r.id));
            for (const r of b.rows) {
                const s = r.source;
                if (s.kind === 'field' && !slugs.has(s.slug)) bad.add(s.slug);
                if (s.kind === 'field') {
                    const f = byId.get(s.slug);
                    if (f && !['number', 'currency', 'percent', 'computed', 'rollup', 'lookup', 'duration'].includes(f.type)) {
                        throw new AiToolError(`El total «${r.label || r.id}» usa «${s.slug}», que no es numérico (${f.type}).`);
                    }
                }
                if (s.kind === 'items_sum') {
                    const pool = itemsFields.get(s.block_id);
                    if (!pool) throw new AiToolError(`El total «${r.label || r.id}» suma el bloque items «${s.block_id}», que no existe. Pon un \`id\` al bloque items y úsalo aquí.`);
                    if (!pool.has(s.slug)) throw new AiToolError(`El total «${r.label || r.id}» suma «${s.slug}», que no es una columna de la lista vinculada.`);
                }
                if (s.kind === 'percent' && !rowIds.has(s.of)) throw new AiToolError(`El total «${r.label || r.id}» es un porcentaje de «${s.of}», que no es otra fila de este bloque.`);
                if (s.kind === 'percent' && s.pct_field) {
                    const f = byId.get(s.pct_field);
                    if (!f) bad.add(s.pct_field);
                    else if (!['number', 'percent', 'currency', 'computed', 'rollup', 'lookup'].includes(f.type)) {
                        throw new AiToolError(`El total «${r.label || r.id}» toma el porcentaje de «${s.pct_field}», que no es numérico (${f.type}).`);
                    }
                }
                if (s.kind === 'sum') {
                    const missing = [...s.rows, ...s.minus].filter((x) => !rowIds.has(x));
                    if (missing.length > 0) throw new AiToolError(`El total «${r.label || r.id}» suma filas que no existen: ${missing.join(', ')}.`);
                }
            }
        }
    }
    if (bad.size > 0) throw new AiToolError(`El documento usa campos que no existen en la lista: ${[...bad].join(', ')}. Campos: ${[...slugs].join(', ')}.`);
    if (design.numbering.freeze && !design.numbering.enabled) {
        throw new AiToolError('numbering.freeze (congelar al emitir) necesita numbering.enabled: el PDF se congela al emitir su número.');
    }
    const saveField = design.numbering.save_field;
    if (saveField) {
        const f = byId.get(saveField);
        if (!f) throw new AiToolError(`numbering.save_field «${saveField}» no es un campo de la lista.`);
        if (f.type !== 'text') throw new AiToolError(`numbering.save_field tiene que ser un campo de texto («${saveField}» es ${f.type}).`);
    }
    // Variables: las de la lista (lo de la tabla de ítems usa columnas, no tags).
    const badTags = new Set<string>();
    checkTags(design.blocks.map((b) => (b.type === 'items' ? { ...b, columns: [] } : b)), slugs, badTags);
    checkTags(design.footer, slugs, badTags);
    if (badTags.size > 0) throw new AiToolError(`El documento usa variables que no son campos de la lista: ${[...badTags].map((t) => `{{${t}}}`).join(', ')}. Campos: ${[...slugs].join(', ')}.`);
    return design;
}

/** Para leer: texto sencillo y la tabla de ítems con `from`/`via` por slug. */
export function docDesignForModel(design: unknown, relations: DocRelationRef[]): unknown {
    const parsed = docDesignSchema.safeParse(design);
    if (!parsed.success) return design;
    const blocks = (list: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
        list.map((b) => {
            const out: Record<string, unknown> = { ...b };
            if (out.type === 'text') {
                out.text = richDocToMarkdown(out.doc as RichNode | null);
                delete out.doc;
            }
            if (out.type === 'items' && out.source) {
                const src = out.source as { relation_field_id: number; direction: string };
                const rel = relations.find((r) => r.relation_field_id === src.relation_field_id && r.direction === src.direction);
                if (rel) {
                    out.from = rel.other_list_slug;
                    out.via = rel.relation_slug;
                    delete out.source;
                }
            }
            if (out.type === 'columns') {
                out.columns = (out.columns as Array<Record<string, unknown>>).map((c) => ({ ...c, blocks: blocks(c.blocks as Array<Record<string, unknown>>) }));
            }
            return out;
        });
    const d = parsed.data;
    return { theme: d.theme, footer: d.footer, numbering: d.numbering, blocks: blocks(d.blocks as unknown as Array<Record<string, unknown>>) };
}

/** Bloques en lenguaje humano para la tarjeta de la propuesta. */
const EMAIL_LABELS: Record<string, string> = {
    heading: 'Título',
    text: 'Texto',
    button: 'Botón',
    image: 'Imagen',
    fields: 'Datos del registro',
    divider: 'Separador',
    spacer: 'Espacio',
    signature: 'Firma',
    html: 'HTML propio',
    columns: 'Columnas',
    header: 'Encabezado',
    items: 'Tabla de ítems',
    totals: 'Totales',
    qr: 'Código QR',
    page_break: 'Salto de página',
};

export function describeDesignBlocks(blocks: Array<Record<string, unknown>>): Array<{ type: string; label: string; detail: string | null }> {
    return blocks.map((b) => {
        const type = String(b.type);
        let detail: string | null = null;
        switch (type) {
            case 'heading':
                detail = String(b.text ?? '') || null;
                break;
            case 'text':
                detail = richDocToMarkdown(b.doc as RichNode | null).slice(0, 120) || null;
                break;
            case 'button':
                detail = String(b.label ?? '') || null;
                break;
            case 'fields':
                detail = ((b.slugs as string[]) ?? []).join(', ') || null;
                break;
            case 'header':
                detail = [b.title, b.number].filter(Boolean).join(' · ') || null;
                break;
            case 'items':
                detail =
                    ((b.columns as Array<{ slug: string; label?: string; kind?: string; hidden?: boolean }>) ?? [])
                        .filter((c) => !c.hidden)
                        .map((c) => `${c.label || c.slug}${c.kind === 'computed' ? ' (calculada)' : ''}`)
                        .join(', ') || null;
                break;
            case 'totals':
                detail = ((b.rows as Array<{ label: string }>) ?? []).map((r) => r.label).join(', ') || null;
                break;
            case 'columns':
                detail = `${((b.columns as unknown[]) ?? []).length} columnas`;
                break;
            case 'qr':
                detail = String(b.value ?? '') || null;
                break;
        }
        return { type, label: EMAIL_LABELS[type] ?? type, detail };
    });
}
