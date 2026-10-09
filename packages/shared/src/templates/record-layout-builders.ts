import type { FieldType } from '../schemas/field';
import type {
    LayoutBlock,
    LayoutPage,
    LayoutSection,
    RecordLayoutV3,
} from '../schemas/record-layout';

/**
 * v0.1.230 — Constructores PUROS de plantillas v3 de la ficha:
 *
 *  - `migrateCrmV2ToV3`: convierte una plantilla v2 (la del editor anterior y
 *    las integradas contacto/negocio/tarea/soporte) sin perder nada — cada
 *    bloque tiene su equivalente y el grid de filas/columnas se vuelve
 *    secciones. Los slugs se traducen a IDs (regla de oro nº 1).
 *  - `autoRecordLayout`: la ficha por defecto, armada a partir de los campos
 *    y de las relaciones que tocan la lista: cabecera con etapas y chips,
 *    cifras destacadas, detalles, y una pestaña por cada relación con sus
 *    indicadores, gráficos y la tabla de vinculados.
 *
 * Viven en shared porque los usa el front (al leer) y el asistente (al
 * proponer): la ficha que ve la persona y la que propone la IA salen de la
 * misma función.
 */

export interface LayoutFieldLite {
    id: number;
    slug: string;
    label: string;
    type: FieldType;
    config?: Record<string, unknown>;
    is_primary?: boolean;
}

// ── v2 → v3 ──────────────────────────────────────────────────────────────

interface V2BlockLike {
    id?: unknown;
    type?: unknown;
    x?: unknown;
    y?: unknown;
    w?: unknown;
    pos?: unknown;
    config?: unknown;
    secBg?: unknown;
    secPadding?: unknown;
    secMargin?: unknown;
}

export interface V2ConfigLike {
    header?: {
        title_field_slug?: unknown;
        subtitle_field_slugs?: unknown;
        status_field_slugs?: unknown;
        quick_action_field_slugs?: unknown;
    } | null;
    blocks?: unknown;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

export function migrateCrmV2ToV3(v2: V2ConfigLike, fields: readonly LayoutFieldLite[]): RecordLayoutV3 {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const idOf = (slug: unknown): number | undefined => (typeof slug === 'string' ? bySlug.get(slug)?.id : undefined);
    const idsOf = (slugs: unknown): number[] =>
        strArr(slugs).map((s) => bySlug.get(s)?.id).filter((id): id is number => id !== undefined);

    const h = v2.header ?? {};
    const header: RecordLayoutV3['header'] = {
        title_field_id: idOf(h.title_field_slug) ?? null,
        subtitle_field_ids: idsOf(h.subtitle_field_slugs).slice(0, 4),
        chip_field_ids: [...idsOf(h.status_field_slugs), ...idsOf(h.quick_action_field_slugs)].slice(0, 8),
        stages_field_id: null,
        cover: { kind: 'gradient' },
        avatar: { kind: 'initials' },
        show_meta: true,
    };

    const raw = (Array.isArray(v2.blocks) ? v2.blocks : []) as V2BlockLike[];
    // Filas por `y`, columnas por `x`, pila por `pos` (mismo criterio que el
    // renderer v2: `groupBlocksByRowsAndColumns`).
    const rows = new Map<number, V2BlockLike[]>();
    for (const b of raw) {
        if (b.type === 'header') continue; // la cabecera es de la plantilla, no un bloque
        const y = num(b.y, 0);
        rows.set(y, [...(rows.get(y) ?? []), b]);
    }
    const sections: LayoutSection[] = [];
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
        const inRow = rows.get(y)!;
        const cols = new Map<number, V2BlockLike[]>();
        for (const b of inRow) {
            const x = num(b.x, 0);
            cols.set(x, [...(cols.get(x) ?? []), b]);
        }
        const xs = [...cols.keys()].sort((a, b) => a - b);
        let widths = xs.map((x) => Math.max(1, Math.min(12, ...cols.get(x)!.map((b) => num(b.w, 12)))));
        let stacks = xs.map((x) =>
            cols
                .get(x)!
                .sort((a, b) => num(a.pos, 0) - num(b.pos, 0))
                .flatMap((b) => convertV2Block(b, idOf, idsOf)),
        );
        // Más de 4 columnas: las que sobran se apilan en la última.
        if (widths.length > 4) {
            stacks = [...stacks.slice(0, 3), stacks.slice(3).flat()];
            widths = [...widths.slice(0, 3), widths.slice(3).reduce((a, b) => a + b, 0)];
        }
        widths = normalizeWidths(widths);
        if (stacks.every((s) => s.length === 0)) continue;
        const first = inRow[0];
        const style: Record<string, unknown> = {};
        if (str(first?.secBg)) style.bg = first!.secBg;
        if (str(first?.secPadding)) style.padding = first!.secPadding;
        if (str(first?.secMargin)) style.margin = first!.secMargin;
        sections.push({
            id: `s${sections.length + 1}`,
            columns: widths,
            blocks: stacks,
            ...(Object.keys(style).length > 0 ? { style } : {}),
        });
    }
    return {
        v: 3,
        theme: { preset: 'default' },
        header,
        pages: [{ id: 'general', name: 'General', sections }],
    };
}

/** Lleva los anchos a sumar exactamente 12, respetando la proporción. */
export function normalizeWidths(widths: number[]): number[] {
    if (widths.length === 0) return [12];
    const total = widths.reduce((a, b) => a + b, 0);
    if (total === 12) return widths;
    const scaled = widths.map((w) => Math.max(1, Math.round((w / total) * 12)));
    let diff = 12 - scaled.reduce((a, b) => a + b, 0);
    // Corrige el redondeo sobre la columna más ancha (la que menos lo nota).
    while (diff !== 0) {
        const i = scaled.indexOf(Math.max(...scaled));
        if (diff > 0) {
            scaled[i]! += 1;
            diff -= 1;
        } else if (scaled[i]! > 1) {
            scaled[i]! -= 1;
            diff += 1;
        } else break;
    }
    return scaled;
}

function convertV2Block(
    b: V2BlockLike,
    idOf: (slug: unknown) => number | undefined,
    idsOf: (slugs: unknown) => number[],
): LayoutBlock[] {
    const id = str(b.id) ?? `b-${String(b.type)}-${num(b.y, 0)}-${num(b.x, 0)}-${num(b.pos, 0)}`;
    const c = (b.config && typeof b.config === 'object' ? b.config : {}) as Record<string, unknown>;
    const style = c.style && typeof c.style === 'object' ? (c.style as Record<string, unknown>) : undefined;
    const withStyle = (block: LayoutBlock): LayoutBlock => (style ? { ...block, style } : block);
    switch (b.type) {
        case 'properties_group':
            return [
                withStyle({
                    id,
                    type: 'fields',
                    title: str(c.label),
                    config: {
                        field_ids: idsOf(c.field_slugs),
                        layout: c.density === 'comfortable' ? 'stacked' : 'list',
                        icon: str(c.icon_key),
                        collapsed: c.collapsed_by_default === true,
                    },
                }),
            ];
        case 'timeline':
            return [withStyle({ id, type: 'activity', config: { mode: 'all' } })];
        case 'comments_thread':
            return [withStyle({ id, type: 'comments', title: str(c.title), config: {} })];
        case 'stats':
            return [withStyle({ id, type: 'record_stats', config: { mode: c.mode ?? 'auto', items: c.items ?? [] } })];
        case 'related': {
            const fieldId = idOf(c.field_slug);
            if (fieldId === undefined) return [];
            return [
                withStyle({
                    id,
                    type: 'related',
                    config: { source: { kind: 'related', field_id: fieldId }, view: 'list', limit: 20 },
                }),
            ];
        }
        case 'notes':
        case 'markdown':
            return [
                withStyle({
                    id,
                    type: 'text',
                    title: str(c.title),
                    config: {
                        source: c.source === 'field' ? 'field' : 'literal',
                        content: typeof c.content === 'string' ? c.content : '',
                        field_id: idOf(c.field_slug),
                        markdown: b.type === 'markdown',
                    },
                }),
            ];
        case 'kpi': {
            const fieldId = idOf(c.field_slug);
            if (fieldId === undefined) return [];
            const goal = typeof c.goal_value === 'number' ? c.goal_value : undefined;
            return [
                withStyle({
                    id,
                    type: 'field',
                    title: str(c.label),
                    config: {
                        field_id: fieldId,
                        display: goal !== undefined ? 'bar' : 'big',
                        prefix: str(c.prefix),
                        suffix: str(c.suffix),
                        goal,
                        card: true,
                    },
                }),
            ];
        }
        case 'chart': {
            const fieldId = idOf(c.relation_field_slug);
            if (fieldId === undefined) return [];
            return [
                withStyle({
                    id,
                    type: 'chart',
                    title: str(c.title),
                    config: {
                        source: { kind: 'related', field_id: fieldId },
                        kind: 'pie',
                        metric: 'count',
                        // El campo de agrupación es de la OTRA lista: la v2 lo
                        // guardaba por slug y aquí no conocemos sus ids — el
                        // servidor lo resuelve contra esa lista.
                        group_by_field_slug: str(c.group_by_field_slug),
                    },
                }),
            ];
        }
        case 'files':
            return [withStyle({ id, type: 'files', title: str(c.title), config: { field_ids: idsOf(c.file_field_slugs) } })];
        case 'embed':
            return [
                withStyle({
                    id,
                    type: 'embed',
                    title: str(c.title),
                    config: { source: c.source === 'field' ? 'field' : 'literal', url: str(c.url), field_id: idOf(c.field_slug) },
                }),
            ];
        case 'action_button':
            return [
                withStyle({
                    id,
                    type: 'button',
                    config: {
                        label: str(c.label) ?? 'Abrir',
                        action: str(c.action_type) ?? 'url',
                        target_source: c.target_source === 'field' ? 'field' : 'literal',
                        target: typeof c.target === 'string' ? c.target : '',
                        target_field_id: idOf(c.target_field_slug),
                        variant: str(c.variant) ?? 'default',
                    },
                }),
            ];
        case 'divider':
            return [withStyle({ id, type: 'divider', config: { label: str(c.label) } })];
        case 'heading':
            return [withStyle({ id, type: 'heading', config: { text: str(c.text) ?? '', level: num(c.level, 3) } })];
        case 'image':
            return [
                withStyle({
                    id,
                    type: 'image',
                    config: {
                        url: str(c.url),
                        file_id: typeof c.image_file_id === 'number' ? c.image_file_id : undefined,
                        alt: str(c.alt),
                        height: num(c.height, 220),
                        fit: c.fit === 'contain' ? 'contain' : 'cover',
                        link_url: str(c.link_url),
                    },
                }),
            ];
        case 'spacer':
            return [withStyle({ id, type: 'spacer', config: { height: num(c.height, 24) } })];
        case 'gallery':
            return [withStyle({ id, type: 'gallery', config: { images: c.images ?? [], columns: num(c.columns, 3), height: num(c.height, 160) } })];
        case 'nested_section': {
            // v3 no anida secciones: los bloques de la sub-sección se apilan
            // en la columna que la contenía, en orden.
            const cols = Array.isArray(c.columns) ? (c.columns as Array<{ blocks?: unknown }>) : [];
            return cols.flatMap((col) =>
                (Array.isArray(col.blocks) ? (col.blocks as V2BlockLike[]) : []).flatMap((inner) =>
                    convertV2Block(inner, idOf, idsOf),
                ),
            );
        }
        default:
            return [];
    }
}

// ── Ficha automática ─────────────────────────────────────────────────────

/** Una relación que toca la lista, con los campos de la lista del otro lado. */
export interface AutoLayoutRelation {
    relation_field_id: number;
    direction: 'forward' | 'reverse';
    relation_label: string;
    other_list_name: string;
    other_fields: readonly LayoutFieldLite[];
}

const STAGE_RE = /estado|status|etapa|stage|fase|pipeline|progreso/i;
const DUE_RE = /venc|entrega|due|l[ií]mite|cierre|pr[oó]xim|deadline|fin\b|fecha/i;
const CONTACT_RE = /contact|whats|tel[eé]f|celular|m[oó]vil|phone|direcci|address/i;
const NUMERIC: readonly FieldType[] = ['currency', 'number', 'percent', 'rating', 'duration', 'rollup'];
const CONTACT: readonly FieldType[] = ['email', 'phone', 'url'];
/** Qué número "define" mejor al registro: el dinero primero, los contadores al final. */
const KPI_RANK: Partial<Record<FieldType, number>> = { currency: 0, rollup: 1, computed: 2, percent: 3, rating: 4, number: 5, duration: 6 };

function optionCount(f: LayoutFieldLite): number {
    const opts = (f.config as { options?: unknown } | undefined)?.options;
    return Array.isArray(opts) ? opts.length : 0;
}

function titleOf(fields: readonly LayoutFieldLite[]): LayoutFieldLite | undefined {
    return fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
}

function evenColumns(n: number): number[] {
    if (n <= 1) return [12];
    if (n === 2) return [6, 6];
    if (n === 3) return [4, 4, 4];
    return [3, 3, 3, 3];
}

function isNumericComputed(f: LayoutFieldLite): boolean {
    const op = (f.config as { operation?: unknown } | undefined)?.operation;
    return f.type === 'computed' && ['sum', 'product', 'subtract', 'divide', 'abs'].includes(String(op));
}

/**
 * Las plantillas integradas. v0.1.234 las pasó a este generador (antes se
 * convertían de una grilla vieja que escondía valores); v0.1.235 les dio un
 * estilo propio; v0.1.236 — cada una es una FICHA DISTINTA pensada para su
 * caso, no la misma pila de tarjetas con otro color:
 *
 *  - auto «Resumen»: una banda de indicadores con la forma que luce cada
 *    número (anillo, estrellas, cifra grande, cuenta regresiva), los
 *    detalles y un adelanto de lo vinculado (dona por estado + los últimos).
 *  - contact «Perfil»: la persona primero. Columna de perfil a la izquierda
 *    con BOTONES de contacto (escribir, llamar, abrir), sus datos y fechas;
 *    a la derecha lo que tiene con la empresa (sus registros vinculados como
 *    tarjetas), las notas como cita y la conversación.
 *  - deal «Oportunidad»: banda con el valor del negocio en grande, la
 *    probabilidad como medidor y la fecha de cierre en cuenta regresiva;
 *    seguimiento en dos columnas y el historial del negocio a lo ancho.
 *  - task «Tarea»: plana, sin portada (como Linear): el trabajo y la
 *    conversación en la columna principal, un panel de propiedades al
 *    costado con la entrega, el avance como barra y las fechas.
 *  - support «Ticket»: una franja de SLA (prioridad, vencimiento, estado),
 *    la conversación como protagonista y, al costado, el cliente con sus
 *    botones, el detalle del caso y su historial con la empresa.
 */
export type AutoLayoutFlavor = 'auto' | 'contact' | 'deal' | 'task' | 'support';

const FLAVOR_THEME: Record<AutoLayoutFlavor, RecordLayoutV3['theme']['preset']> = {
    auto: 'default',
    contact: 'fresh',
    deal: 'corporate',
    task: 'minimal',
    support: 'warm',
};

const FLAVOR_COVER: Record<AutoLayoutFlavor, 'none' | 'color' | 'gradient'> = {
    auto: 'gradient',
    contact: 'gradient',
    deal: 'color',
    task: 'none',
    support: 'gradient',
};

const PRIORITY_RE = /prioridad|priority|urgenc|severidad|severity|impacto/i;
const PROBABILITY_RE = /probab|avance|progreso|progress|complet|porcentaje|%/i;

export function autoRecordLayout(input: {
    fields: readonly LayoutFieldLite[];
    relations?: readonly AutoLayoutRelation[];
    flavor?: AutoLayoutFlavor;
}): RecordLayoutV3 {
    const fields = input.fields;
    const flavor: AutoLayoutFlavor = input.flavor && input.flavor in FLAVOR_THEME ? input.flavor : 'auto';
    const relations = (input.relations ?? []).slice(0, 4);
    const firstRel = relations[0];
    const title = titleOf(fields);
    const used = new Set<number>(title ? [title.id] : []);
    const free = (f: LayoutFieldLite): boolean => !used.has(f.id);
    const take = <T extends LayoutFieldLite | undefined>(f: T): T => {
        if (f) used.add(f.id);
        return f;
    };
    const takeAll = (list: LayoutFieldLite[]): LayoutFieldLite[] => {
        for (const f of list) used.add(f.id);
        return list;
    };
    const hay = (f: LayoutFieldLite): string => `${f.slug} ${f.label}`;

    // ── Piezas con nombre propio ──
    const stages = take(fields.find((f) => f.type === 'select' && optionCount(f) >= 3 && STAGE_RE.test(hay(f))));
    const due = fields.find((f) => (f.type === 'date' || f.type === 'datetime') && DUE_RE.test(hay(f)));
    const priority = fields.find((f) => f.type === 'select' && PRIORITY_RE.test(hay(f)) && f.id !== stages?.id);
    const numeric = fields
        .filter((f) => f.id !== title?.id && (NUMERIC.includes(f.type) || isNumericComputed(f)))
        .map((f, i) => ({ f, i }))
        .sort((a, b) => (KPI_RANK[a.f.type] ?? 9) - (KPI_RANK[b.f.type] ?? 9) || a.i - b.i)
        .map((x) => x.f);
    const money = numeric.find((f) => f.type === 'currency') ?? numeric.find((f) => f.type === 'rollup' || isNumericComputed(f));
    const progress = numeric.find((f) => f.type === 'percent' && PROBABILITY_RE.test(hay(f))) ?? numeric.find((f) => f.type === 'percent');
    const rating = numeric.find((f) => f.type === 'rating');
    const actionable = fields.filter((f) => f.type === 'email' || f.type === 'phone' || f.type === 'url');

    // ── Bloques ──
    const group = (id: string, gTitle: string, icon: string, list: LayoutFieldLite[], layout: 'grid' | 'list' | 'stacked', columns = 2): LayoutBlock => ({
        id,
        type: 'fields',
        title: gTitle,
        config: { field_ids: list.map((f) => f.id), layout, ...(layout === 'grid' ? { columns } : {}), icon },
    });
    const card = (f: LayoutFieldLite, display: string, blockTitle?: string, extra: Record<string, unknown> = {}): LayoutBlock => ({
        id: `card-${display}-${f.id}`,
        type: 'field',
        ...(blockTitle ? { title: blockTitle } : {}),
        config: { field_id: f.id, display, card: true, ...extra },
    });
    /** La forma que mejor luce cada número. */
    const kpi = (f: LayoutFieldLite): LayoutBlock =>
        card(f, f.type === 'percent' ? 'ring' : f.type === 'rating' ? 'stars' : 'big');
    const actionButton = (f: LayoutFieldLite): LayoutBlock => ({
        id: `btn-${f.id}`,
        type: 'field',
        config: { field_id: f.id, display: 'button', label: 'hidden' },
    });
    const description: LayoutBlock = { id: 'description', type: 'description', config: {} };
    const activity = (blockTitle = 'Actividad'): LayoutBlock => ({ id: 'activity', type: 'activity', title: blockTitle, config: { mode: 'all' } });
    const compact = <T,>(xs: (T | null | undefined | false)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined && x !== false);
    const band = (id: string, blocks: LayoutBlock[], widths?: number[], tone: 'accent' | 'muted' = 'accent'): LayoutSection | null =>
        blocks.length === 0
            ? null
            : { id, columns: widths ?? evenColumns(blocks.length), blocks: blocks.map((b) => [b]), style: { tone } };

    // Lo que queda, ordenado por lo que es.
    const rest = (): {
        contact: LayoutFieldLite[];
        selects: LayoutFieldLite[];
        dates: LayoutFieldLite[];
        longText: LayoutFieldLite[];
        files: LayoutFieldLite[];
        links: LayoutFieldLite[];
        other: LayoutFieldLite[];
    } => {
        const contact = takeAll(fields.filter((f) => free(f) && (CONTACT.includes(f.type) || (f.type === 'text' && CONTACT_RE.test(hay(f))))));
        const selects = takeAll(fields.filter((f) => free(f) && ['select', 'multi_select', 'user', 'checkbox'].includes(f.type)));
        const dates = takeAll(fields.filter((f) => free(f) && (f.type === 'date' || f.type === 'datetime')));
        const longText = takeAll(fields.filter((f) => free(f) && f.type === 'long_text'));
        const files = takeAll(fields.filter((f) => free(f) && f.type === 'file'));
        const links = takeAll(fields.filter((f) => free(f) && f.type === 'relation'));
        const other = takeAll(fields.filter((f) => free(f)));
        return { contact, selects, dates, longText, files, links, other };
    };
    const filesBlock = (files: LayoutFieldLite[]): LayoutBlock | null =>
        files.length > 0 ? { id: 'files', type: 'files', title: 'Archivos', config: { field_ids: files.map((f) => f.id) } } : null;
    /**
     * Textos largos: en Resumen y Tarea, editables ahí mismo (son lo que se
     * escribe a diario); en perfil, oportunidad y ticket el primero va como
     * CITA (lo que dijo el cliente, el próximo paso) y se edita con el lápiz.
     */
    const notesBlocks = (longText: LayoutFieldLite[], quoteTitle?: string): LayoutBlock[] => {
        if (longText.length === 0) return [];
        if (quoteTitle === undefined) return [group('notes', 'Notas', 'sticky_note', longText, 'stacked')];
        const [first, ...others] = longText as [LayoutFieldLite, ...LayoutFieldLite[]];
        return [card(first, 'quote', quoteTitle), ...(others.length > 0 ? [group('notes', 'Más notas', 'sticky_note', others, 'stacked')] : [])];
    };

    // Chips de la cabecera (una línea de propiedades clave editables).
    const chipsFrom = (pool: LayoutFieldLite[], max = 4): number[] => {
        const out: number[] = [];
        for (const f of pool) {
            if (out.length >= max || !free(f)) continue;
            out.push(f.id);
            used.add(f.id);
        }
        return out;
    };
    const ofType = (...types: FieldType[]): LayoutFieldLite[] => fields.filter((f) => types.includes(f.type));

    const sections: LayoutSection[] = [];
    let chips: number[] = [];
    let subtitle: LayoutFieldLite[] = [];
    const subtitleFrom = (pool: LayoutFieldLite[]): LayoutFieldLite[] => takeAll(pool.filter(free).slice(0, 2));

    switch (flavor) {
        case 'contact': {
            subtitle = subtitleFrom([...ofType('email', 'phone'), ...ofType('text')]);
            chips = chipsFrom([...ofType('multi_select'), ...ofType('select'), ...ofType('user')], 4);
            const r = rest();
            const about = [...r.selects, ...r.other];
            const left = compact<LayoutBlock>([
                ...actionable.map(actionButton),
                r.contact.length > 0 ? group('contact', 'Datos de contacto', 'mail', r.contact, 'list') : null,
                about.length > 0 ? group('about', 'Sobre la persona', 'user', about, 'list') : null,
                r.dates.length > 0 ? group('dates', 'Fechas', 'calendar', r.dates, 'list') : null,
                r.links.length > 0 ? group('links', 'Vínculos', 'link', r.links, 'list') : null,
                filesBlock(r.files),
            ]);
            const right = compact<LayoutBlock>([
                firstRel ? relatedPreview(firstRel, 'cards', 'Lo que tiene con nosotros', 6) : null,
                ...notesBlocks(r.longText, 'Notas'),
                description,
                activity('Conversación'),
            ]);
            sections.push({ id: 'profile', columns: [4, 8], blocks: [left, right] });
            break;
        }
        case 'deal': {
            subtitle = subtitleFrom(ofType('text', 'email'));
            chips = chipsFrom([...ofType('user'), ...ofType('select'), ...ofType('multi_select')], 3);
            const heroMoney = take(money);
            const heroProgress = take(progress);
            const heroDue = take(due);
            const hero = compact<LayoutBlock>([
                heroMoney ? card(heroMoney, 'big', 'Valor del negocio') : null,
                heroProgress ? card(heroProgress, 'gauge', heroProgress.label) : null,
                heroDue ? card(heroDue, 'countdown', heroDue.label) : null,
            ]);
            const heroBand = band('hero', hero, hero.length === 3 ? [6, 3, 3] : hero.length === 2 ? [7, 5] : [12]);
            if (heroBand) sections.push(heroBand);
            const moreNumbers = takeAll(numeric.filter(free).slice(0, 3));
            if (moreNumbers.length > 0) sections.push({ id: 'numbers', columns: evenColumns(moreNumbers.length), blocks: moreNumbers.map((f) => [kpi(f)]) });
            const r = rest();
            sections.push({
                id: 'follow',
                title: 'Seguimiento',
                columns: [8, 4],
                blocks: [
                    compact<LayoutBlock>([
                        description,
                        [...r.selects, ...r.other].length > 0 ? group('details', 'Detalles del negocio', 'briefcase', [...r.selects, ...r.other], 'grid') : null,
                        ...notesBlocks(r.longText, 'Próximos pasos'),
                    ]),
                    compact<LayoutBlock>([
                        ...actionable.map(actionButton),
                        r.contact.length > 0 ? group('contact', 'Cliente', 'circle_user', r.contact, 'list') : null,
                        ...r.dates.slice(0, 2).map((f) => card(f, 'calendar', f.label)),
                        r.dates.length > 2 ? group('dates', 'Otras fechas', 'calendar', r.dates.slice(2), 'list') : null,
                        r.links.length > 0 ? group('links', 'Vínculos', 'link', r.links, 'list') : null,
                        filesBlock(r.files),
                    ]),
                ],
            });
            if (firstRel) sections.push({ id: 'deal-related', columns: [12], blocks: [[relatedPreview(firstRel, 'board', firstRel.direction === 'reverse' ? firstRel.other_list_name : firstRel.relation_label, 20)]] });
            sections.push({ id: 'history', title: 'Historial del negocio', columns: [12], blocks: [[activity('Actividad')]] });
            break;
        }
        case 'task': {
            subtitle = [];
            chips = chipsFrom([...ofType('user'), ...(priority ? [priority] : []), ...ofType('select'), ...ofType('multi_select')], 4);
            const taskDue = take(due);
            const taskProgress = take(progress);
            const r = rest();
            sections.push({
                id: 'work',
                columns: [8, 4],
                blocks: [
                    compact<LayoutBlock>([
                        description,
                        ...notesBlocks(r.longText),
                        { id: 'conv-divider', type: 'divider', config: { label: 'Conversación' } },
                        activity('Comentarios y cambios'),
                    ]),
                    compact<LayoutBlock>([
                        taskDue ? card(taskDue, 'countdown', 'Entrega') : null,
                        taskProgress ? card(taskProgress, 'bar', taskProgress.label) : null,
                        [...r.selects, ...r.other, ...numeric.filter(free)].length > 0
                            ? group('props', 'Propiedades', 'tag', takeAll([...r.selects, ...r.other, ...numeric.filter(free)]), 'list')
                            : null,
                        ...r.dates.slice(0, 2).map((f) => card(f, 'calendar', f.label)),
                        r.dates.length > 2 ? group('dates', 'Más fechas', 'calendar', r.dates.slice(2), 'list') : null,
                        r.contact.length > 0 ? group('contact', 'Contacto', 'mail', r.contact, 'list') : null,
                        r.links.length > 0 ? group('links', 'Relacionado', 'link', r.links, 'list') : null,
                        filesBlock(r.files),
                    ]),
                ],
            });
            break;
        }
        case 'support': {
            subtitle = subtitleFrom([...ofType('email', 'phone'), ...ofType('text')]);
            chips = chipsFrom([...ofType('user'), ...ofType('multi_select')], 3);
            const slaPriority = take(priority);
            const slaDue = take(due);
            const slaScore = take(rating);
            const otherSelect = slaPriority ? undefined : take(fields.find((f) => free(f) && f.type === 'select'));
            const sla = compact<LayoutBlock>([
                slaPriority ? card(slaPriority, 'big', slaPriority.label) : null,
                otherSelect ? card(otherSelect, 'big', otherSelect.label) : null,
                slaDue ? card(slaDue, 'countdown', 'Vencimiento') : null,
                slaScore ? card(slaScore, 'stars', slaScore.label) : null,
                ...takeAll(numeric.filter(free).slice(0, sla_room(slaPriority, otherSelect, slaDue, slaScore))).map(kpi),
            ]);
            const slaBand = band('sla', sla.slice(0, 4), undefined, 'muted');
            if (slaBand) sections.push(slaBand);
            const r = rest();
            sections.push({
                id: 'case',
                columns: [7, 5],
                blocks: [
                    compact<LayoutBlock>([...notesBlocks(r.longText, 'Lo que reportó'), activity('Conversación'), description]),
                    compact<LayoutBlock>([
                        ...actionable.map(actionButton),
                        r.contact.length > 0 ? group('contact', 'Cliente', 'circle_user', r.contact, 'list') : null,
                        [...r.selects, ...r.other, ...numeric.filter(free)].length > 0
                            ? group('details', 'Detalle del caso', 'lifebuoy', takeAll([...r.selects, ...r.other, ...numeric.filter(free)]), 'list')
                            : null,
                        r.dates.length > 0 ? group('dates', 'Fechas', 'calendar', r.dates, 'list') : null,
                        firstRel ? relatedPreview(firstRel, 'list', 'Historial del cliente', 6) : null,
                        r.links.length > 0 ? group('links', 'Vínculos', 'link', r.links, 'list') : null,
                        filesBlock(r.files),
                    ]),
                ],
            });
            break;
        }
        default: {
            subtitle = subtitleFrom(ofType('text', 'email', 'phone'));
            chips = chipsFrom([...ofType('select'), ...ofType('user'), ...ofType('multi_select')], 4);
            const autoDue = take(due);
            const heroNumbers = takeAll(numeric.filter(free).slice(0, autoDue ? 3 : 4));
            const hero = [...heroNumbers.map(kpi), ...(autoDue ? [card(autoDue, 'countdown', autoDue.label)] : [])];
            const heroBand = band('kpis', hero);
            if (heroBand) sections.push(heroBand);
            const r = rest();
            sections.push({
                id: 'main',
                columns: [8, 4],
                blocks: [
                    compact<LayoutBlock>([
                        description,
                        [...r.selects, ...r.other].length > 0 ? group('details', 'Detalles', 'tag', [...r.selects, ...r.other], 'grid') : null,
                        r.dates.length > 0 ? group('dates', 'Fechas', 'calendar', r.dates, 'grid') : null,
                        ...notesBlocks(r.longText),
                    ]),
                    compact<LayoutBlock>([
                        ...actionable.map(actionButton),
                        r.contact.length > 0 ? group('contact', 'Contacto', 'mail', r.contact, 'list') : null,
                        r.links.length > 0 ? group('links', 'Vínculos', 'link', r.links, 'list') : null,
                        filesBlock(r.files),
                        activity(),
                    ]),
                ],
            });
            if (firstRel) {
                const preview = relationOverview(firstRel);
                if (preview) sections.push(preview);
            }
        }
    }

    // En tarea y ticket el estado no va como etapas en la cabecera (un ticket
    // no "avanza" por un embudo): va como su primera propiedad.
    if (stages && (flavor === 'task' || flavor === 'support') && !chips.includes(stages.id)) chips = [stages.id, ...chips].slice(0, 5);
    const pages: LayoutPage[] = [{ id: 'summary', name: SUMMARY_NAME[flavor], icon: 'layout', sections }];
    for (const rel of relations) pages.push(relationPage(rel));
    const cover = FLAVOR_COVER[flavor];
    return {
        v: 3,
        theme: { preset: FLAVOR_THEME[flavor] },
        header: {
            title_field_id: title?.id ?? null,
            subtitle_field_ids: subtitle.map((f) => f.id),
            chip_field_ids: chips,
            stages_field_id: flavor === 'task' || flavor === 'support' ? null : stages?.id ?? null,
            cover: { kind: cover },
            avatar: { kind: flavor === 'task' ? 'none' : 'initials' },
            show_meta: flavor !== 'contact',
        },
        pages,
    };
}

const SUMMARY_NAME: Record<AutoLayoutFlavor, string> = {
    auto: 'Resumen',
    contact: 'Perfil',
    deal: 'Oportunidad',
    task: 'Tarea',
    support: 'Ticket',
};

/** Lugar que queda en la franja de SLA para otros números (máximo 4 piezas). */
function sla_room(...pieces: Array<LayoutFieldLite | undefined>): number {
    return Math.max(0, 4 - pieces.filter(Boolean).length);
}

/** Los registros vinculados dentro del resumen (no sólo en su pestaña). */
function relatedPreview(rel: AutoLayoutRelation, view: 'cards' | 'list' | 'board' | 'table', blockTitle: string, limit: number): LayoutBlock {
    const other = rel.other_fields;
    const source = { kind: 'related' as const, field_id: rel.relation_field_id, direction: rel.direction };
    const otherTitle = titleOf(other);
    const status = other.find((f) => f.type === 'select' && STAGE_RE.test(`${f.slug} ${f.label}`)) ?? other.find((f) => f.type === 'select');
    const money = other.find((f) => f.type === 'currency') ?? other.find((f) => f.type === 'number');
    const date = other.find((f) => f.type === 'date' || f.type === 'datetime');
    const cols = [otherTitle, status, money, date].filter((f): f is LayoutFieldLite => f !== undefined);
    return {
        id: `preview-${rel.relation_field_id}${rel.direction === 'reverse' ? 'r' : ''}`,
        type: 'related',
        title: blockTitle,
        config: {
            source,
            view,
            field_ids: cols.map((f) => f.id),
            limit,
            ...(view === 'board' && status ? { group_field_id: status.id } : {}),
            ...(date ? { sort_field_id: date.id, sort_dir: 'desc' } : {}),
        },
    };
}

/** Adelanto de lo vinculado en el resumen automático: dona por estado + los últimos. */
function relationOverview(rel: AutoLayoutRelation): LayoutSection | null {
    const other = rel.other_fields;
    const source = { kind: 'related' as const, field_id: rel.relation_field_id, direction: rel.direction };
    const name = rel.direction === 'reverse' ? rel.other_list_name : rel.relation_label;
    const status = other.find((f) => f.type === 'select' && STAGE_RE.test(`${f.slug} ${f.label}`)) ?? other.find((f) => f.type === 'select');
    const money = other.find((f) => f.type === 'currency') ?? other.find((f) => f.type === 'number' || isNumericComputed(f));
    const list = relatedPreview(rel, 'list', `Últimos: ${name.toLowerCase()}`, 5);
    if (!status) return { id: 'overview', title: name, columns: [12], blocks: [[list]] };
    return {
        id: 'overview',
        title: name,
        columns: [5, 7],
        blocks: [
            [
                {
                    id: `overview-pie-${rel.relation_field_id}`,
                    type: 'chart',
                    title: `Por ${status.label.toLowerCase()}`,
                    config: { source, kind: 'pie', metric: money ? 'sum' : 'count', metric_field_id: money?.id, group_by_field_id: status.id },
                },
            ],
            [list],
        ],
    };
}

/** Una pestaña por relación: indicadores, gráficos y la tabla de vinculados. */
function relationPage(rel: AutoLayoutRelation): LayoutPage {
    const other = rel.other_fields;
    const source = { kind: 'related' as const, field_id: rel.relation_field_id, direction: rel.direction };
    const key = `rel${rel.relation_field_id}${rel.direction === 'reverse' ? 'r' : ''}`;
    const name = rel.direction === 'reverse' ? rel.other_list_name : rel.relation_label;
    const money = other.find((f) => f.type === 'currency') ?? other.find((f) => f.type === 'number' || isNumericComputed(f));
    const score = other.find((f) => f.type === 'rating' || f.type === 'percent');
    const status = other.find((f) => f.type === 'select' && STAGE_RE.test(`${f.slug} ${f.label}`)) ?? other.find((f) => f.type === 'select');
    const date = other.find((f) => (f.type === 'date' || f.type === 'datetime'));

    const kpis: LayoutBlock[] = [
        { id: `${key}-count`, type: 'chart', title: `Total de ${name.toLowerCase()}`, config: { source, kind: 'kpi', metric: 'count', icon: 'briefcase' } },
    ];
    if (money) {
        kpis.push({
            id: `${key}-sum`,
            type: 'chart',
            title: money.label,
            config: { source, kind: 'kpi', metric: 'sum', metric_field_id: money.id, icon: 'dollar' },
        });
    }
    if (score) {
        kpis.push({
            id: `${key}-avg`,
            type: 'chart',
            title: score.label,
            config: { source, kind: 'kpi', metric: 'avg', metric_field_id: score.id, icon: 'star' },
        });
    }
    const sections: LayoutSection[] = [
        { id: `${key}-kpis`, columns: evenColumns(kpis.length), blocks: kpis.map((b) => [b]) },
    ];
    const charts: LayoutBlock[] = [];
    if (status) {
        charts.push({
            id: `${key}-by-status`,
            type: 'chart',
            title: `Por ${status.label.toLowerCase()}`,
            config: {
                source,
                kind: 'pie',
                metric: money ? 'sum' : 'count',
                metric_field_id: money?.id,
                group_by_field_id: status.id,
            },
        });
    }
    if (date) {
        charts.push({
            id: `${key}-over-time`,
            type: 'chart',
            title: money ? `${money.label} por mes` : `${name} por mes`,
            config: {
                source,
                kind: 'area',
                metric: money ? 'sum' : 'count',
                metric_field_id: money?.id,
                group_by_field_id: date.id,
                time_bucket: 'month',
            },
        });
    }
    if (charts.length > 0) {
        sections.push({
            id: `${key}-charts`,
            columns: charts.length === 2 ? [5, 7] : [12],
            blocks: charts.map((b) => [b]),
        });
    }
    const otherTitle = titleOf(other);
    const cols = [
        ...(otherTitle ? [otherTitle] : []),
        ...other.filter((f) => f.id !== otherTitle?.id && !['long_text', 'relation', 'file'].includes(f.type)).slice(0, 5),
    ];
    sections.push({
        id: `${key}-table`,
        columns: [12],
        blocks: [[
            {
                id: `${key}-list`,
                type: 'related',
                title: name,
                config: {
                    source,
                    view: 'table',
                    field_ids: cols.map((f) => f.id),
                    limit: 25,
                    ...(date ? { sort_field_id: date.id, sort_dir: 'desc' } : {}),
                },
            },
        ]],
    });
    return { id: key, name, sections };
}
