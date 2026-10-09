import type { FieldType } from '../schemas/field';
import {
    recordLayoutV3Schema,
    type LayoutBlock,
    type LayoutBlockType,
    type LayoutDataSource,
    type LayoutSection,
    type RecordLayoutV3,
} from '../schemas/record-layout';
import { normalizeWidths, type LayoutFieldLite } from './record-layout-builders';
import { portalTemplateLayout, type PortalLinkedList } from './portal-templates';

/**
 * v0.1.233 — El portal del cliente sobre el MISMO modelo v3 de la ficha
 * (ADR-S26 fase C): pestañas, secciones con columnas, cada campo con la forma
 * que le corresponde, gráficos y tablas de lo vinculado al cliente.
 *
 * Vive en `list.settings.portal_layout_v3` y MANDA sobre la plantilla anterior
 * (`portal_template`, un grid de bloques sueltos por slug). La anterior se
 * convierte sola al leerla (`migratePortalTemplateToV3`): nadie pierde su
 * diseño.
 *
 * Diferencias con la ficha, todas por seguridad o por sentido:
 *  - El cliente sólo EDITA los campos de los bloques marcados `editable`
 *    (`portalEditableFieldIds`); el servidor usa la misma función como
 *    whitelist del `PATCH /portal/me`. Sin bloques editables, nadie edita.
 *  - Bloques que no tienen sentido para un cliente (el acceso al portal, el
 *    resumen interno del registro, la descripción) no se ofrecen ni se
 *    dibujan.
 *  - Una fuente `list` NO es "toda la lista": el servidor la acota a lo que le
 *    corresponde al cliente (scope del portal, fail-closed).
 *  - Ajustes de página (fondo, ancho, tipografía) en `page`.
 */

export const PORTAL_LAYOUT_BLOCK_TYPES: readonly LayoutBlockType[] = [
    'field',
    'fields',
    'stages',
    'files',
    'related',
    'chart',
    'comments',
    'activity',
    'heading',
    'text',
    'notice',
    'image',
    'gallery',
    'button',
    'embed',
    'divider',
    'spacer',
];

/** Tipos que el cliente puede editar en un bloque `editable` (los demás se ven). */
export const PORTAL_EDITABLE_TYPES: readonly FieldType[] = [
    'text',
    'long_text',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'email',
    'url',
    'phone',
    'date',
    'datetime',
    'checkbox',
    'select',
    'multi_select',
];

/** Ajustes de la PÁGINA del portal (fuera de las tarjetas). */
export interface PortalPageSettingsLite {
    bg?: string;
    max_width?: number;
    font?: 'sans' | 'serif' | 'rounded' | 'mono';
}

/** `settings.portal_layout_v3` si valida; si no, null. */
export function readPortalLayoutV3(settings: Record<string, unknown> | null | undefined): RecordLayoutV3 | null {
    const parsed = recordLayoutV3Schema.safeParse((settings ?? {}).portal_layout_v3);
    return parsed.success ? parsed.data : null;
}

/**
 * Campos que el cliente puede editar: los de los bloques `field`/`fields`
 * marcados `editable` y de un tipo editable. Es la whitelist del servidor.
 */
export function portalEditableFieldIds(
    layout: Pick<RecordLayoutV3, 'pages'>,
    fields: readonly Pick<LayoutFieldLite, 'id' | 'type'>[],
): Set<number> {
    const types = new Map(fields.map((f) => [f.id, f.type]));
    const out = new Set<number>();
    const add = (raw: unknown): void => {
        const id = Number(raw);
        const type = types.get(id);
        if (type !== undefined && PORTAL_EDITABLE_TYPES.includes(type)) out.add(id);
    };
    for (const page of layout.pages) {
        for (const section of page.sections) {
            for (const column of section.blocks) {
                for (const b of column) {
                    if (b.config.editable !== true) continue;
                    if (b.type === 'field') add(b.config.field_id);
                    if (b.type === 'fields' && Array.isArray(b.config.field_ids)) b.config.field_ids.forEach(add);
                }
            }
        }
    }
    return out;
}

/** Saca los bloques que el portal no dibuja (lo guardado a mano o por API). */
export function sanitizePortalLayout(layout: RecordLayoutV3): RecordLayoutV3 {
    return {
        ...layout,
        pages: layout.pages.map((p) => ({
            ...p,
            sections: p.sections.map((s) => ({
                ...s,
                blocks: s.blocks.map((col) => col.filter((b) => PORTAL_LAYOUT_BLOCK_TYPES.includes(b.type))),
            })),
        })),
    };
}

// ── Portal automático ────────────────────────────────────────────────────

/**
 * El portal cuando nadie lo diseñó. Desde v0.1.237 es la plantilla «Mi cuenta»
 * de sólo lectura (antes, una sola tarjeta con todos los campos): sus datos,
 * sus cifras y —sólo si el admin las habilitó para el cliente— las listas
 * vinculadas como tarjetas. Nada editable ni conversación: eso lo decide quien
 * diseña el portal.
 */
export function autoPortalLayout(fields: readonly LayoutFieldLite[], linked: readonly PortalLinkedList[] = []): RecordLayoutV3 {
    return portalTemplateLayout('account', { fields, linked, readOnly: true });
}

// ── Plantilla anterior → v3 ──────────────────────────────────────────────

/** Otra lista del workspace, para traducir los bloques que la leían por slug. */
export interface PortalOtherList {
    id: number;
    slug: string;
    fields: readonly LayoutFieldLite[];
}

export interface PortalMigrationContext {
    listId: number;
    fields: readonly LayoutFieldLite[];
    otherLists: readonly PortalOtherList[];
}

interface OldBlock {
    id?: unknown;
    type?: unknown;
    x?: unknown;
    y?: unknown;
    w?: unknown;
    h?: unknown;
    config?: unknown;
    secBg?: unknown;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

const OLD_HEIGHT: Record<string, number> = {
    static_text: 4, client_data: 6, related_records_table: 10, editable_form: 8, external_link: 2, kpi_widget: 3,
    activity_timeline: 8, download_files: 5, comments_thread: 8, heading: 2, hero: 6, stats_grid: 3,
    quick_actions: 5, notice: 3, divider: 2, faq: 8, contact_card: 5,
};

/**
 * Convierte `portal_template` (`{ blocks, page }` o un array plano) a v3.
 * Devuelve null si no había nada diseñado. Los bloques que leían otra lista
 * por slug pasan a una fuente `related` por la relación que la vincula al
 * cliente (en cualquiera de los dos sentidos) o, si no hay, a una fuente
 * `list` — que el servidor acota al cliente igual que antes.
 */
export function migratePortalTemplateToV3(template: unknown, ctx: PortalMigrationContext): RecordLayoutV3 | null {
    const rawBlocks: OldBlock[] = Array.isArray(template)
        ? (template as OldBlock[])
        : template && typeof template === 'object' && Array.isArray((template as { blocks?: unknown }).blocks)
          ? ((template as { blocks: OldBlock[] }).blocks)
          : [];
    if (rawBlocks.length === 0) return null;
    const page = template && typeof template === 'object' && !Array.isArray(template) ? (template as { page?: unknown }).page : undefined;

    const conv = new Converter(ctx);
    // Los bloques sin posición se apilan a lo ancho, en orden (mismo criterio
    // que el editor anterior).
    let cursor = 0;
    const placed = rawBlocks.map((b) => {
        const h = num(b.h, OLD_HEIGHT[String(b.type)] ?? 4);
        const y = typeof b.y === 'number' ? b.y : cursor;
        cursor = Math.max(cursor, y + h);
        return { b, y, x: num(b.x, 0), w: num(b.w, 12) };
    });
    const rows = new Map<number, typeof placed>();
    for (const p of placed) rows.set(p.y, [...(rows.get(p.y) ?? []), p]);

    const sections: LayoutSection[] = [];
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
        const inRow = rows.get(y)!.sort((a, b) => a.x - b.x);
        let widths = inRow.map((p) => Math.max(1, Math.min(12, p.w)));
        let stacks = inRow.map((p) => conv.block(p.b));
        if (widths.length > 4) {
            stacks = [...stacks.slice(0, 3), stacks.slice(3).flat()];
            widths = [...widths.slice(0, 3), widths.slice(3).reduce((a, b) => a + b, 0)];
        }
        if (stacks.every((s) => s.length === 0)) continue;
        // Una fila de cifras sueltas (un grid de estadísticas) se reparte en
        // columnas en vez de apilarse.
        const fromStatsGrid = inRow.length === 1 && inRow[0]!.b.type === 'stats_grid';
        if (stacks.length === 1 && stacks[0]!.length >= 2 && stacks[0]!.length <= 4 && (fromStatsGrid || stacks[0]!.every(isStat))) {
            const items = stacks[0]!;
            stacks = items.map((b) => [b]);
            widths = items.map(() => 12 / items.length).map(Math.floor);
        }
        const bg = str(inRow[0]?.b.secBg);
        sections.push({
            id: `s${sections.length + 1}`,
            columns: normalizeWidths(widths),
            blocks: stacks,
            ...(bg ? { style: { bg } } : {}),
        });
    }
    if (sections.length === 0) return null;
    const out: RecordLayoutV3 = {
        v: 3,
        theme: { preset: 'default' },
        header: {
            title_field_id: null,
            subtitle_field_ids: [],
            chip_field_ids: [],
            stages_field_id: null,
            cover: { kind: 'none' },
            avatar: { kind: 'none' },
            show_meta: false,
            // El portal anterior no tenía cabecera: se conserva así.
            hidden: true,
        },
        pages: [{ id: 'inicio', name: 'Inicio', sections }],
    };
    if (page && typeof page === 'object') (out as Record<string, unknown>).page = page;
    return out;
}

function isStat(b: LayoutBlock): boolean {
    return (b.type === 'chart' && b.config.kind === 'kpi') || (b.type === 'field' && b.config.display === 'big');
}

class Converter {
    private readonly bySlug: Map<string, LayoutFieldLite>;
    private readonly otherBySlug: Map<string, PortalOtherList>;
    private n = 0;

    constructor(private readonly ctx: PortalMigrationContext) {
        this.bySlug = new Map(ctx.fields.map((f) => [f.slug, f]));
        this.otherBySlug = new Map(ctx.otherLists.map((l) => [l.slug, l]));
    }

    private ids(slugs: unknown): number[] {
        return strArr(slugs).map((s) => this.bySlug.get(s)?.id).filter((id): id is number => id !== undefined);
    }

    private id(type: string, raw: unknown): string {
        this.n += 1;
        return str(raw) ?? `${type}-${this.n}`;
    }

    /** Fuente para leer otra lista desde el portal (por relación si la hay). */
    private source(listSlug: unknown): { source: LayoutDataSource; list: PortalOtherList } | null {
        const other = typeof listSlug === 'string' ? this.otherBySlug.get(listSlug) : undefined;
        if (!other) return null;
        const target = (f: LayoutFieldLite): number => Number((f.config as { target_list_id?: unknown } | undefined)?.target_list_id ?? 0);
        const reverse = other.fields.find((f) => f.type === 'relation' && target(f) === this.ctx.listId);
        if (reverse) return { source: { kind: 'related', field_id: reverse.id, direction: 'reverse' }, list: other };
        const forward = this.ctx.fields.find((f) => f.type === 'relation' && target(f) === other.id);
        if (forward) return { source: { kind: 'related', field_id: forward.id }, list: other };
        return { source: { kind: 'list', list_id: other.id }, list: other };
    }

    block(b: OldBlock): LayoutBlock[] {
        const t = String(b.type ?? '');
        const c = (b.config && typeof b.config === 'object' ? b.config : {}) as Record<string, unknown>;
        const style = c.style && typeof c.style === 'object' ? (c.style as Record<string, unknown>) : undefined;
        const s = (block: LayoutBlock): LayoutBlock => (style ? { ...block, style } : block);
        const id = this.id(t, b.id);
        switch (t) {
            case 'heading':
                return [s({ id, type: 'heading', config: { text: str(c.text) ?? '', level: num(c.level, 2), subtitle: str(c.eyebrow) } })];
            case 'hero': {
                const bg = str(c.background_color) ?? str(c.accent_color);
                const filled = c.variant !== 'plain';
                const heroStyle = filled
                    ? { bg: bg ?? '#1e293b', text: str(c.text_color) ?? '#ffffff', pad: 'lg', radius: 'lg', align: c.align === 'center' ? 'center' : 'left' }
                    : undefined;
                const out: LayoutBlock[] = [
                    { id, type: 'heading', config: { text: str(c.title) ?? '', level: 1, subtitle: str(c.subtitle) }, ...(heroStyle ? { style: heroStyle } : {}) },
                ];
                if (str(c.cta_href)) {
                    out.push({ id: `${id}-cta`, type: 'button', config: { label: str(c.cta_label) ?? 'Abrir', action: 'url', target: c.cta_href } });
                }
                return out;
            }
            case 'static_text':
                return [s({ id, type: 'text', title: str(c.title), config: { content: htmlToText(String(c.html ?? '')) } })];
            case 'notice': {
                const tone = c.variant === 'success' ? 'success' : c.variant === 'warning' || c.variant === 'error' ? 'warning' : c.variant === 'announce' ? 'tip' : 'info';
                const out: LayoutBlock[] = [s({ id, type: 'notice', title: str(c.title), config: { tone, text: String(c.body ?? '') } })];
                if (str(c.cta_href)) out.push({ id: `${id}-cta`, type: 'button', config: { label: str(c.cta_label) ?? 'Abrir', action: 'url', target: c.cta_href, variant: 'outline' } });
                return out;
            }
            case 'client_data':
                return [
                    s({
                        id,
                        type: 'fields',
                        title: str(c.title) ?? 'Tus datos',
                        config: { field_ids: this.ids(c.visible_field_slugs), layout: c.variant === 'cards' ? 'grid' : 'list', columns: 2, collapsible: false },
                    }),
                ];
            case 'editable_form':
                return [
                    s({
                        id,
                        type: 'fields',
                        title: str(c.title) ?? 'Actualiza tus datos',
                        config: { field_ids: this.ids(c.editable_field_slugs), layout: 'list', editable: true, collapsible: false },
                    }),
                ];
            case 'download_files': {
                const ids = this.ids([c.field_slug]);
                return [s({ id, type: 'files', title: str(c.title), config: ids.length > 0 ? { field_ids: ids } : {} })];
            }
            case 'comments_thread':
                return [s({ id, type: 'comments', title: str(c.title), config: { readonly: c.readonly === true } })];
            case 'activity_timeline':
                return [s({ id, type: 'activity', title: str(c.title), config: { limit: num(c.limit, 20) } })];
            case 'related_records_table': {
                const src = this.source(c.list_slug);
                if (!src) return [];
                const other = new Map(src.list.fields.map((f) => [f.slug, f.id]));
                const fieldIds = strArr(c.visible_field_slugs).map((sl) => other.get(sl)).filter((x): x is number => x !== undefined);
                return [
                    s({
                        id,
                        type: 'related',
                        title: str(c.title),
                        config: {
                            source: src.source,
                            view: c.variant === 'compact_list' ? 'list' : 'table',
                            ...(fieldIds.length > 0 ? { field_ids: fieldIds.slice(0, 12) } : {}),
                            limit: Math.max(1, Math.min(100, num(c.per_page, 20))),
                        },
                    }),
                ];
            }
            case 'kpi_widget':
                return this.kpi(id, c.list_slug, c.metric, c.field_id, str(c.title), str(c.prefix), str(c.suffix), style);
            case 'stats_grid': {
                const items = Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : [];
                return items.slice(0, 8).flatMap((it, i) => {
                    if (it.metric === 'static') {
                        const text = `**${String(it.value ?? '')}**${str(it.label) ? `\n${String(it.label)}` : ''}`;
                        return [{ id: `${id}-${i}`, type: 'text' as const, config: { content: text } }];
                    }
                    return this.kpi(`${id}-${i}`, it.list_slug, it.metric, it.field_id, str(it.label), str(it.prefix), str(it.suffix), undefined);
                });
            }
            case 'external_link':
                return [
                    s({
                        id,
                        type: 'button',
                        title: str(c.title),
                        config: { label: str(c.label) ?? str(c.title) ?? 'Abrir', action: 'url', target: str(c.href) ?? '' },
                    }),
                ];
            case 'quick_actions': {
                const items = Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : [];
                return items.slice(0, 8).map((it, i) => ({
                    id: `${id}-${i}`,
                    type: 'button' as const,
                    config: { label: str(it.label) ?? 'Abrir', action: 'url', target: str(it.href) ?? '', variant: 'outline' },
                }));
            }
            case 'faq': {
                const items = Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : [];
                const content = items.map((it) => `**${String(it.question ?? '')}**\n${String(it.answer ?? '')}`).join('\n\n');
                return [s({ id, type: 'text', title: str(c.title) ?? 'Preguntas frecuentes', config: { content } })];
            }
            case 'contact_card': {
                const lines = [
                    str(c.name) ? `**${String(c.name)}**` : '',
                    str(c.role) ?? '',
                    str(c.email) ? `Correo: ${String(c.email)}` : '',
                    str(c.phone) ? `Teléfono: ${String(c.phone)}` : '',
                    str(c.whatsapp) ? `WhatsApp: ${String(c.whatsapp)}` : '',
                ].filter((l) => l !== '');
                return [s({ id, type: 'text', title: str(c.title) ?? 'Tu contacto', config: { content: lines.join('\n') } })];
            }
            case 'divider':
                return [s({ id, type: 'divider', config: { label: str(c.label) } })];
            case 'spacer':
                return [{ id, type: 'spacer', config: { height: num(c.height, 24) } }];
            case 'image':
                return [
                    s({
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
            case 'gallery':
                return [s({ id, type: 'gallery', config: { images: Array.isArray(c.images) ? c.images : [], columns: num(c.columns, 3), height: num(c.height, 160) } })];
            case 'nested_section': {
                const cols = Array.isArray(c.columns) ? (c.columns as Array<{ blocks?: unknown }>) : [];
                return cols.flatMap((col) => (Array.isArray(col.blocks) ? (col.blocks as OldBlock[]) : []).flatMap((inner) => this.block(inner)));
            }
            default:
                return [];
        }
    }

    private kpi(
        id: string,
        listSlug: unknown,
        metricRaw: unknown,
        fieldIdRaw: unknown,
        title: string | undefined,
        prefix: string | undefined,
        suffix: string | undefined,
        style: Record<string, unknown> | undefined,
    ): LayoutBlock[] {
        const metric = ['count', 'sum', 'avg', 'min', 'max'].includes(String(metricRaw)) ? String(metricRaw) : 'count';
        const fieldId = Number(fieldIdRaw);
        // Una cifra de la propia lista del portal es un campo del registro.
        const own = this.ctx.fields.find((f) => f.id === fieldId);
        if (listSlug === undefined || listSlug === '' || (own && metric !== 'count')) {
            if (!own) return [];
            return [{ id, type: 'field', title, config: { field_id: own.id, display: 'big', prefix, suffix, card: true }, ...(style ? { style } : {}) }];
        }
        const src = this.source(listSlug);
        if (!src) return [];
        const metricField = src.list.fields.find((f) => f.id === fieldId);
        const config: Record<string, unknown> = { source: src.source, kind: 'kpi', metric: metric !== 'count' && metricField ? metric : 'count' };
        if (metric !== 'count' && metricField) config.metric_field_id = metricField.id;
        if (prefix) config.prefix = prefix;
        if (suffix) config.suffix = suffix;
        return [{ id, type: 'chart', title: title ?? 'Total', config, ...(style ? { style } : {}) }];
    }
}

/** El texto del bloque viejo era HTML; el nuevo, markdown simple. */
function htmlToText(html: string): string {
    return html
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<(strong|b)>(.*?)<\/(strong|b)>/gi, '**$2**')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
