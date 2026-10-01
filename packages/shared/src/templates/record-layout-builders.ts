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
                        // guardaba por slug y acá no conocemos sus ids — el
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
 * v0.1.234 — Las plantillas integradas (contacto, negocio, tarea, soporte)
 * ya no se convierten desde su grilla vieja (3 · 6 · 3 con la actividad al
 * medio, columnas angostas que escondían los valores): se arman con este
 * mismo generador y cada una sólo cambia el nombre y el orden de los grupos.
 */
export type AutoLayoutFlavor = 'auto' | 'contact' | 'deal' | 'task' | 'support';

// El nombre del grupo principal es siempre neutro ("Detalles"): la misma
// plantilla se elige para listas muy distintas (una lista de clientes con la
// plantilla Soporte no tiene "tickets"). Lo que cambia es el ORDEN.
const FLAVOR: Record<AutoLayoutFlavor, { datesFirst: boolean; contactInMain: boolean }> = {
    auto: { datesFirst: false, contactInMain: false },
    contact: { datesFirst: false, contactInMain: true },
    deal: { datesFirst: false, contactInMain: false },
    task: { datesFirst: true, contactInMain: false },
    support: { datesFirst: false, contactInMain: false },
};

export function autoRecordLayout(input: {
    fields: readonly LayoutFieldLite[];
    relations?: readonly AutoLayoutRelation[];
    flavor?: AutoLayoutFlavor;
}): RecordLayoutV3 {
    const fields = input.fields;
    const flavor = FLAVOR[input.flavor ?? 'auto'] ?? FLAVOR.auto;
    const title = titleOf(fields);
    const used = new Set<number>(title ? [title.id] : []);
    const free = (f: LayoutFieldLite): boolean => !used.has(f.id);
    const take = (list: LayoutFieldLite[]): LayoutFieldLite[] => {
        for (const f of list) used.add(f.id);
        return list;
    };

    // Cabecera: etapas (el select de estado), propiedades clave (los select,
    // la persona, después las etiquetas y la fecha que manda) y una línea de
    // contacto bajo el título.
    const stages = fields.find((f) => f.type === 'select' && optionCount(f) >= 3 && STAGE_RE.test(`${f.slug} ${f.label}`));
    if (stages) used.add(stages.id);
    const chips: number[] = [];
    for (const pass of [['select', 'user'], ['multi_select']] as const) {
        for (const f of fields) {
            if (chips.length >= 4 || !free(f) || !(pass as readonly string[]).includes(f.type)) continue;
            chips.push(f.id);
            used.add(f.id);
        }
    }
    const due = fields.find((f) => free(f) && (f.type === 'date' || f.type === 'datetime') && DUE_RE.test(`${f.slug} ${f.label}`));
    if (due) {
        chips.push(due.id);
        used.add(due.id);
    }
    const subtitle = take(fields.filter((f) => free(f) && (f.type === 'email' || f.type === 'phone' || f.type === 'text')).slice(0, 2));

    // Cifras destacadas: los números que definen al registro (el dinero primero).
    const kpis = take(
        fields
            .filter((f) => free(f) && (NUMERIC.includes(f.type) || isNumericComputed(f)))
            .map((f, i) => ({ f, i }))
            .sort((a, b) => (KPI_RANK[a.f.type] ?? 9) - (KPI_RANK[b.f.type] ?? 9) || a.i - b.i)
            .slice(0, 4)
            .map((x) => x.f),
    );

    const longText = take(fields.filter((f) => free(f) && f.type === 'long_text'));
    const files = take(fields.filter((f) => free(f) && f.type === 'file'));
    const contact = take(fields.filter((f) => free(f) && (CONTACT.includes(f.type) || (f.type === 'text' && CONTACT_RE.test(`${f.slug} ${f.label}`)))));
    const relationFields = take(fields.filter((f) => free(f) && f.type === 'relation'));
    let dates = fields.filter((f) => free(f) && (f.type === 'date' || f.type === 'datetime'));
    // Con pocas fechas, una tarjeta propia es una tarjeta de más (varias
    // tarjetas de 1-2 campos fragmentan la ficha): van con el resto.
    if (dates.length < 3) dates = [];
    take(dates);
    const details = take(fields.filter((f) => free(f)));

    const group = (id: string, title: string, icon: string, list: LayoutFieldLite[], layout: 'grid' | 'list' | 'stacked'): LayoutBlock => ({
        id,
        type: 'fields',
        title,
        config: { field_ids: list.map((f) => f.id), layout, ...(layout === 'grid' ? { columns: 2 } : {}), icon },
    });

    const sections: LayoutSection[] = [];
    if (kpis.length > 0) {
        sections.push({
            id: 'kpis',
            columns: evenColumns(kpis.length),
            blocks: kpis.map((f) => [
                {
                    id: `kpi-${f.id}`,
                    type: 'field',
                    config: {
                        field_id: f.id,
                        display: f.type === 'percent' ? 'ring' : f.type === 'rating' ? 'stars' : 'big',
                        card: true,
                    },
                },
            ]),
        });
    }
    const main: LayoutBlock[] = [{ id: 'description', type: 'description', config: {} }];
    const side: LayoutBlock[] = [];
    const contactBlock = contact.length > 0 ? group('contact', 'Contacto', 'mail', contact, flavor.contactInMain ? 'grid' : 'list') : null;
    const detailsBlock = details.length > 0 ? group('details', 'Detalles', 'tag', details, 'grid') : null;
    const datesBlock = dates.length > 0 ? group('dates', flavor.datesFirst ? 'Programación' : 'Fechas', 'calendar', dates, 'grid') : null;
    if (contactBlock && flavor.contactInMain) main.push(contactBlock);
    for (const b of flavor.datesFirst ? [datesBlock, detailsBlock] : [detailsBlock, datesBlock]) if (b) main.push(b);
    if (longText.length > 0) main.push(group('notes', 'Notas', 'sticky_note', longText, 'stacked'));
    if (contactBlock && !flavor.contactInMain) side.push(contactBlock);
    if (relationFields.length > 0) side.push(group('links', 'Vínculos', 'link', relationFields, 'list'));
    if (files.length > 0) side.push({ id: 'files', type: 'files', title: 'Archivos', config: { field_ids: files.map((f) => f.id) } });
    side.push({ id: 'activity', type: 'activity', title: 'Actividad', config: { mode: 'all' } });
    sections.push({ id: 'main', columns: [8, 4], blocks: [main, side] });

    const pages: LayoutPage[] = [{ id: 'summary', name: 'Resumen', icon: 'layout', sections }];
    for (const rel of (input.relations ?? []).slice(0, 4)) {
        pages.push(relationPage(rel));
    }
    return {
        v: 3,
        theme: { preset: 'default' },
        header: {
            title_field_id: title?.id ?? null,
            subtitle_field_ids: subtitle.map((f) => f.id),
            chip_field_ids: chips,
            stages_field_id: stages?.id ?? null,
            cover: { kind: 'gradient' },
            avatar: { kind: 'initials' },
            show_meta: true,
        },
        pages,
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
