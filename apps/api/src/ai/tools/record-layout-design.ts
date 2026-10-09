import {
    FIELD_DISPLAYS,
    LAYOUT_THEME_PRESETS,
    PORTAL_EDITABLE_TYPES,
    RELATED_VIEWS,
    fieldSlugSchema,
    normalizeWidths,
    recordLayoutV3Schema,
    type FieldType,
    type LayoutBlock,
    type LayoutDataSource,
    type RecordLayoutV3,
} from '@imagina-base/shared';
import { z } from 'zod';
import { AiToolError } from './registry';

/**
 * v0.1.232 — El diseño de la ficha (plantillas v3, ADR-S26) en el vocabulario
 * del modelo: pestañas → secciones → columnas → bloques, todo por SLUG y por
 * nombre de lista. `buildRecordLayoutV3` lo valida contra los campos y las
 * relaciones reales y devuelve EXACTAMENTE lo que guarda el editor visual
 * (`settings.record_layout_v3`), así lo propuesto se sigue retocando en el
 * editor sin conversión. Puro: el llamador pasa los catálogos.
 */

const slug = fieldSlugSchema;
const listRef = z.string().min(1).max(63);

/** De dónde salen los datos de un gráfico o de una tabla de vinculados. */
const sourceSpec = {
    from: listRef.describe('Slug de la lista VINCULADA cuyos registros se muestran (p. ej. "facturas"); "all" = toda la lista propia, para comparar'),
    via: slug.optional().describe('Slug del campo relation, sólo si hay más de una relación con esa lista'),
};

const chartKind = z.enum(['kpi', 'bar', 'pie', 'line', 'area', 'funnel', 'gauge', 'stat_delta', 'table']);
const metric = z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_unique']);

export const recordBlockSpec = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('field'),
        field: slug,
        display: z.string().max(20).optional().describe('Forma de mostrarlo según el tipo: big, bar, ring, gauge (números/moneda/porcentaje), countdown, relative, calendar (fechas), stages (select), stars (rating), button (email/url/phone), image (url)…'),
        card: z.boolean().optional().describe('Como tarjeta con título'),
        title: z.string().max(120).optional(),
        editable: z.boolean().optional().describe('Sólo en el PORTAL: el cliente puede corregirlo'),
        goal: z.number().optional().describe('Meta para barra/medidor'),
        prefix: z.string().max(8).optional(),
        suffix: z.string().max(8).optional(),
    }),
    z.object({
        type: z.literal('fields'),
        title: z.string().max(120).optional(),
        fields: z.array(slug).min(1).max(40),
        layout: z.enum(['list', 'grid']).optional(),
        columns: z.number().int().min(1).max(3).optional(),
        collapsed: z.boolean().optional(),
        editable: z.boolean().optional().describe('Sólo en el PORTAL: el cliente puede corregir estos campos'),
    }),
    z.object({ type: z.literal('stages'), field: slug.describe('Un campo select: cada opción es una etapa') }),
    z.object({ type: z.literal('files'), title: z.string().max(120).optional(), fields: z.array(slug).max(10).optional() }),
    z.object({ type: z.enum(['description', 'record_stats', 'activity', 'comments', 'portal_access', 'divider']), title: z.string().max(120).optional() }),
    z.object({
        type: z.literal('chart'),
        title: z.string().max(120).optional(),
        ...sourceSpec,
        kind: chartKind,
        metric: metric.optional().describe('Default count'),
        metric_field: slug.optional().describe('Campo de la lista de origen para sum/avg/min/max'),
        group_by: slug.optional().describe('Para bar/pie/funnel: campo de la lista de origen'),
        date_field: slug.optional().describe('Para line/area/stat_delta: campo fecha de la lista de origen (default: fecha de creación)'),
        time_bucket: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
        goal: z.number().optional().describe('Para kpi/gauge'),
        prefix: z.string().max(8).optional(),
        suffix: z.string().max(8).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Para table'),
        columns: z.array(slug).max(12).optional().describe('Para table: campos de la lista de origen'),
    }),
    z.object({
        type: z.literal('related'),
        title: z.string().max(120).optional(),
        from: listRef.describe('Slug de la lista vinculada'),
        via: sourceSpec.via,
        view: z.enum(RELATED_VIEWS).optional().describe('table (default) | list | cards | board | timeline | gallery'),
        columns: z.array(slug).max(12).optional().describe('Campos de la lista vinculada'),
        sort: slug.optional(),
        sort_dir: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        group_field: slug.optional().describe('Para board: el select de las columnas'),
        date_field: slug.optional().describe('Para timeline'),
        image_field: slug.optional().describe('Para gallery'),
    }),
    z.object({ type: z.literal('heading'), text: z.string().min(1).max(200), level: z.number().int().min(1).max(3).optional(), subtitle: z.string().max(300).optional() }),
    z.object({ type: z.literal('text'), content: z.string().min(1).max(4000).describe('Markdown simple'), title: z.string().max(120).optional() }),
    z.object({ type: z.literal('notice'), text: z.string().min(1).max(1000), title: z.string().max(120).optional(), tone: z.enum(['info', 'success', 'warning', 'tip']).optional() }),
    z.object({
        type: z.literal('button'),
        label: z.string().min(1).max(60),
        url: z.string().max(2000).optional().describe('Destino fijo (https://, mailto:, tel:)'),
        field: slug.optional().describe('O el campo url/email/phone del registro'),
    }),
]);
export type RecordBlockSpec = z.infer<typeof recordBlockSpec>;

export const recordDesignSpec = z.object({
    theme: z
        .object({
            preset: z.enum(LAYOUT_THEME_PRESETS).optional().describe('default | minimal | corporate | fresh | warm'),
            accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        })
        .optional(),
    header: z
        .object({
            title_field: slug.optional(),
            subtitle_fields: z.array(slug).max(4).optional(),
            chip_fields: z.array(slug).max(8).optional().describe('Propiedades clave como chips editables'),
            stages_field: slug.optional().describe('Un select mostrado como etapas bajo la cabecera'),
            cover: z.enum(['gradient', 'color', 'none']).optional(),
            avatar: z.enum(['initials', 'none']).optional(),
            hidden: z.boolean().optional().describe('Sin cabecera (sólo el contenido)'),
        })
        .optional(),
    page: z
        .object({
            bg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            max_width: z.number().int().min(480).max(1600).optional(),
            font: z.enum(['sans', 'serif', 'rounded', 'mono']).optional(),
        })
        .optional()
        .describe('Sólo en el PORTAL: fondo de la página, ancho máximo y tipografía'),
    pages: z
        .array(
            z.object({
                name: z.string().min(1).max(60).describe('Nombre de la pestaña'),
                sections: z
                    .array(
                        z.object({
                            title: z.string().max(120).optional(),
                            columns: z
                                .array(z.object({ width: z.number().int().min(1).max(12).optional(), blocks: z.array(recordBlockSpec).max(20) }))
                                .min(1)
                                .max(4)
                                .describe('Las columnas suman 12; sin `width` se reparten en partes iguales (para principal + lateral usa 8 y 4). En el celular se apilan'),
                        }),
                    )
                    .min(1)
                    .max(20),
            }),
        )
        .min(1)
        .max(8),
});
export type RecordDesignSpec = z.infer<typeof recordDesignSpec>;

export interface DesignField {
    id: number;
    slug: string;
    label: string;
    type: string;
}

export interface DesignRelation {
    relation_field_id: number;
    relation_slug: string;
    direction: 'forward' | 'reverse';
    other_list_id: number;
    other_list_slug: string;
    other_list_name: string;
}

export interface DesignContext {
    listId: number;
    fields: DesignField[];
    relations: DesignRelation[];
    /** Campos de cada lista del otro lado (por id de lista). */
    otherFields: Map<number, DesignField[]>;
    /**
     * v0.1.233 — diseño del PORTAL del cliente: además de las relaciones,
     * las listas vinculadas al cliente por un campo persona (fuente `list`,
     * que el servidor acota a lo suyo). Habilita `editable`.
     */
    portal?: { userLists: Array<{ list_id: number; slug: string; name: string; fields: DesignField[] }> };
}

const NOT_IN_PORTAL = new Set(['description', 'record_stats', 'portal_access']);

export interface DesignBuildResult {
    layout: RecordLayoutV3;
    preview: Array<{ type: string; label: string; detail: string | null }>;
    warnings: string[];
}

const DEFAULT_WIDTHS: Record<number, number[]> = { 1: [12], 2: [6, 6], 3: [4, 4, 4], 4: [3, 3, 3, 3] };
const NUMERIC = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'rollup', 'computed']);

export function buildRecordLayoutV3(spec: RecordDesignSpec, ctx: DesignContext): DesignBuildResult {
    const own = new Map(ctx.fields.map((f) => [f.slug, f]));
    const warnings: string[] = [];
    const preview: DesignBuildResult['preview'] = [];
    let seq = 0;
    const id = (p: string): string => `${p}-${(++seq).toString(36)}`;

    const ownField = (s: string, where: string, types?: string[]): DesignField => {
        const f = own.get(s);
        if (!f) throw new AiToolError(`${where}: el campo «${s}» no existe. Campos: ${ctx.fields.map((x) => x.slug).join(', ')}.`);
        if (types && !types.includes(f.type)) throw new AiToolError(`${where}: «${s}» es ${f.type}; se esperaba ${types.join('/')}.`);
        return f;
    };

    /** Resuelve `from`/`via` a una fuente + los campos de la lista de origen. */
    const source = (from: string, via: string | undefined, where: string): { src: LayoutDataSource; fields: DesignField[]; name: string } => {
        if (from === 'all') {
            if (ctx.portal) throw new AiToolError(`${where}: en el portal no existe "toda la lista" — el cliente sólo ve lo suyo. Usa una lista vinculada.`);
            return { src: { kind: 'list', list_id: ctx.listId }, fields: ctx.fields, name: 'toda la lista' };
        }
        const candidates = ctx.relations.filter((r) => r.other_list_slug === from);
        const byUser = ctx.portal?.userLists.find((l) => l.slug === from);
        if (candidates.length === 0 && byUser) {
            return { src: { kind: 'list', list_id: byUser.list_id }, fields: byUser.fields, name: byUser.name };
        }
        const linkable = [...new Set([...ctx.relations.map((r) => r.other_list_slug), ...(ctx.portal?.userLists.map((l) => l.slug) ?? [])])];
        if (candidates.length === 0) {
            throw new AiToolError(`${where}: la lista «${from}» no está vinculada con ésta. Vinculables: ${linkable.join(', ') || 'ninguna (hace falta un campo relation)'}.`);
        }
        let pick = candidates[0]!;
        if (via) {
            const v = candidates.find((r) => r.relation_slug === via);
            if (!v) throw new AiToolError(`${where}: no hay una relación «${via}» con «${from}». Relaciones: ${candidates.map((r) => r.relation_slug).join(', ')}.`);
            pick = v;
        } else if (candidates.length > 1) {
            throw new AiToolError(`${where}: hay varias relaciones con «${from}» (${candidates.map((r) => r.relation_slug).join(', ')}); indica \`via\`.`);
        }
        return {
            src: { kind: 'related', field_id: pick.relation_field_id, direction: pick.direction },
            fields: ctx.otherFields.get(pick.other_list_id) ?? [],
            name: pick.other_list_name,
        };
    };
    const otherField = (fields: DesignField[], s: string | undefined, where: string, test?: (f: DesignField) => boolean, what?: string): number | undefined => {
        if (s === undefined) return undefined;
        const f = fields.find((x) => x.slug === s);
        if (!f) throw new AiToolError(`${where}: el campo «${s}» no existe en la lista de origen. Campos: ${fields.map((x) => x.slug).join(', ')}.`);
        if (test && !test(f)) throw new AiToolError(`${where}: «${s}» es ${f.type}; se esperaba ${what}.`);
        return f.id;
    };

    const editableFlag = (on: boolean | undefined, fieldsOfBlock: DesignField[]): { editable?: true } => {
        if (!on) return {};
        if (!ctx.portal) {
            warnings.push('`editable` sólo aplica al portal del cliente; en la ficha la edición la dan los permisos.');
            return {};
        }
        const no = fieldsOfBlock.filter((f) => !PORTAL_EDITABLE_TYPES.includes(f.type as FieldType));
        if (no.length) warnings.push(`El cliente no puede editar ${no.map((f) => `«${f.label}» (${f.type})`).join(', ')}: se muestran de sólo lectura.`);
        return { editable: true };
    };

    const block = (b: RecordBlockSpec, where: string): LayoutBlock => {
        const t = (title?: string) => (title ? { title } : {});
        if (ctx.portal && NOT_IN_PORTAL.has(b.type)) {
            throw new AiToolError(`${where}: el bloque «${b.type}» no existe en el portal del cliente.`);
        }
        switch (b.type) {
            case 'field': {
                const f = ownField(b.field, where);
                const displays = FIELD_DISPLAYS[f.type as FieldType] ?? [];
                if (b.display && !displays.some((d) => d.key === b.display)) {
                    warnings.push(`«${f.label}» no admite la forma «${b.display}» (opciones: ${displays.map((d) => d.key).join(', ')}); se usa la de siempre.`);
                }
                preview.push({ type: 'field', label: f.label, detail: b.display ?? null });
                return {
                    id: id('f'),
                    type: 'field',
                    ...t(b.title),
                    config: clean({ field_id: f.id, display: b.display, card: b.card, goal: b.goal, prefix: b.prefix, suffix: b.suffix, ...editableFlag(b.editable, [f]) }),
                };
            }
            case 'fields': {
                const fs = b.fields.map((s) => ownField(s, where));
                preview.push({ type: 'fields', label: b.title ?? 'Propiedades', detail: `${b.fields.join(', ')}${b.editable && ctx.portal ? ' (editables)' : ''}` });
                return {
                    id: id('fs'),
                    type: 'fields',
                    ...t(b.title),
                    config: clean({ field_ids: fs.map((f) => f.id), layout: b.layout ?? 'list', columns: b.columns, collapsed: b.collapsed, ...editableFlag(b.editable, fs) }),
                };
            }
            case 'stages': {
                const f = ownField(b.field, where, ['select']);
                preview.push({ type: 'stages', label: `Etapas: ${f.label}`, detail: null });
                return { id: id('st'), type: 'stages', config: { field_id: f.id } };
            }
            case 'files': {
                const ids = (b.fields ?? []).map((s) => ownField(s, where, ['file']).id);
                preview.push({ type: 'files', label: b.title ?? 'Archivos', detail: null });
                return { id: id('fl'), type: 'files', ...t(b.title), config: ids.length ? { field_ids: ids } : {} };
            }
            case 'chart': {
                const s = source(b.from, b.via, where);
                const m = b.metric ?? 'count';
                const metricField = otherField(s.fields, b.metric_field, `${where} (metric_field)`, m === 'sum' || m === 'avg' ? (f) => NUMERIC.has(f.type) : undefined, 'un campo numérico');
                if (m !== 'count' && metricField === undefined && b.kind !== 'table') throw new AiToolError(`${where}: la métrica ${m} necesita \`metric_field\`.`);
                const groupBy = otherField(s.fields, b.group_by, `${where} (group_by)`);
                if (['bar', 'pie', 'funnel'].includes(b.kind) && groupBy === undefined) throw new AiToolError(`${where}: un gráfico ${b.kind} necesita \`group_by\`.`);
                const dateField = otherField(s.fields, b.date_field, `${where} (date_field)`, (f) => f.type === 'date' || f.type === 'datetime', 'una fecha');
                const cols = (b.columns ?? []).map((c) => otherField(s.fields, c, `${where} (columns)`)!).filter((x) => x !== undefined);
                preview.push({ type: 'chart', label: b.title ?? `Gráfico ${b.kind}`, detail: `${s.name} · ${m}` });
                return {
                    id: id('ch'),
                    type: 'chart',
                    ...t(b.title),
                    config: clean({
                        source: s.src,
                        kind: b.kind,
                        metric: m,
                        metric_field_id: metricField,
                        group_by_field_id: groupBy,
                        date_field_id: dateField,
                        time_bucket: b.time_bucket ?? (b.kind === 'line' || b.kind === 'area' ? 'month' : undefined),
                        goal: b.goal,
                        prefix: b.prefix,
                        suffix: b.suffix,
                        limit: b.limit,
                        visible_field_ids: cols.length ? cols : undefined,
                    }),
                };
            }
            case 'related': {
                const s = source(b.from, b.via, where);
                if (b.from === 'all') throw new AiToolError(`${where}: una tabla de vinculados necesita una lista vinculada, no "all".`);
                const cols = (b.columns ?? []).map((c) => otherField(s.fields, c, `${where} (columns)`)!).filter((x) => x !== undefined);
                preview.push({ type: 'related', label: b.title ?? s.name, detail: b.view ?? 'table' });
                return {
                    id: id('rl'),
                    type: 'related',
                    ...t(b.title),
                    config: clean({
                        source: s.src,
                        view: b.view ?? 'table',
                        field_ids: cols.length ? cols : undefined,
                        sort_field_id: otherField(s.fields, b.sort, `${where} (sort)`),
                        sort_dir: b.sort_dir,
                        limit: b.limit ?? 25,
                        group_field_id: otherField(s.fields, b.group_field, `${where} (group_field)`, (f) => f.type === 'select', 'un select'),
                        date_field_id: otherField(s.fields, b.date_field, `${where} (date_field)`, (f) => f.type === 'date' || f.type === 'datetime', 'una fecha'),
                        image_field_id: otherField(s.fields, b.image_field, `${where} (image_field)`, (f) => f.type === 'url' || f.type === 'file', 'un url o archivo'),
                    }),
                };
            }
            case 'heading':
                preview.push({ type: 'heading', label: b.text, detail: null });
                return { id: id('h'), type: 'heading', config: clean({ text: b.text, level: b.level ?? 2, subtitle: b.subtitle }) };
            case 'text':
                preview.push({ type: 'text', label: b.title ?? 'Texto', detail: b.content.slice(0, 80) });
                return { id: id('tx'), type: 'text', ...t(b.title), config: { source: 'literal', content: b.content } };
            case 'notice':
                preview.push({ type: 'notice', label: b.title ?? 'Aviso', detail: b.text.slice(0, 80) });
                return { id: id('n'), type: 'notice', ...t(b.title), config: { tone: b.tone ?? 'info', text: b.text } };
            case 'button': {
                if (!b.url && !b.field) throw new AiToolError(`${where}: un botón necesita \`url\` o \`field\`.`);
                if (b.url && !/^(https:\/\/|mailto:|tel:)/i.test(b.url)) throw new AiToolError(`${where}: el destino tiene que empezar con https://, mailto: o tel:.`);
                const f = b.field ? ownField(b.field, where, ['url', 'email', 'phone', 'text']) : undefined;
                const action = f?.type === 'email' ? 'mailto' : f?.type === 'phone' ? 'tel' : b.url?.startsWith('mailto:') ? 'mailto' : b.url?.startsWith('tel:') ? 'tel' : 'url';
                preview.push({ type: 'button', label: b.label, detail: f ? f.label : b.url ?? null });
                return {
                    id: id('b'),
                    type: 'button',
                    config: f
                        ? { label: b.label, action, target_source: 'field', target_field_id: f.id }
                        : { label: b.label, action, target_source: 'literal', target: (b.url ?? '').replace(/^(mailto:|tel:)/i, '') },
                };
            }
            default:
                preview.push({ type: b.type, label: b.title ?? b.type, detail: null });
                return { id: id(b.type.slice(0, 3)), type: b.type, ...t(b.title), config: b.type === 'activity' ? { mode: 'all' } : {} };
        }
    };

    const h = spec.header ?? {};
    const header: RecordLayoutV3['header'] = {
        title_field_id: h.title_field ? ownField(h.title_field, 'header.title_field', ['text', 'long_text']).id : null,
        subtitle_field_ids: (h.subtitle_fields ?? []).map((s) => ownField(s, 'header.subtitle_fields').id),
        chip_field_ids: (h.chip_fields ?? []).map((s) => ownField(s, 'header.chip_fields').id),
        stages_field_id: h.stages_field ? ownField(h.stages_field, 'header.stages_field', ['select']).id : null,
        cover: { kind: h.cover ?? 'gradient' },
        avatar: { kind: h.avatar ?? 'initials' },
        // Al cliente no le sirve "creado por / actualizado".
        show_meta: !ctx.portal,
        ...(h.hidden ? { hidden: true } : {}),
    };

    const pages = spec.pages.map((p, pi) => ({
        id: id('p'),
        name: p.name,
        sections: p.sections.map((s, si) => {
            const given = s.columns.map((c) => c.width);
            const widths = given.every((w) => w !== undefined) ? normalizeWidths(given as number[]) : DEFAULT_WIDTHS[s.columns.length]!;
            return {
                id: id('s'),
                ...(s.title ? { title: s.title } : {}),
                columns: widths,
                blocks: s.columns.map((c, ci) => c.blocks.map((b, bi) => block(b, `pages[${pi}].sections[${si}].columns[${ci}].blocks[${bi}]`))),
            };
        }),
    }));

    if (spec.page && !ctx.portal) warnings.push('`page` (fondo/ancho/tipografía) sólo aplica al portal del cliente.');
    const parsed = recordLayoutV3Schema.safeParse({
        v: 3,
        theme: clean({ preset: spec.theme?.preset ?? 'default', accent: spec.theme?.accent }),
        header,
        pages,
        ...(spec.page && ctx.portal ? { page: clean(spec.page) } : {}),
    });
    if (!parsed.success) {
        throw new AiToolError(`El diseño no es válido: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    return { layout: parsed.data, preview, warnings };
}

/** Resumen legible de un diseño v3 guardado (para `get_list_schema`). */
export function describeRecordLayoutV3(layout: RecordLayoutV3, fields: DesignField[]): Array<{ page: string; blocks: string[] }> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const label = (b: LayoutBlock): string => {
        const c = b.config as Record<string, unknown>;
        const f = byId.get(Number(c.field_id));
        if (b.type === 'field') return `campo ${f?.slug ?? '?'}${c.display ? ` (${String(c.display)})` : ''}`;
        if (b.type === 'fields') return `propiedades${b.title ? ` «${b.title}»` : ''}${c.editable === true ? ' (editables por el cliente)' : ''}`;
        if (b.type === 'chart') return `gráfico ${String(c.kind ?? 'kpi')}${b.title ? ` «${b.title}»` : ''}`;
        if (b.type === 'related') return `vinculados ${String(c.view ?? 'table')}${b.title ? ` «${b.title}»` : ''}`;
        if (b.type === 'stages') return `etapas ${f?.slug ?? '?'}`;
        if (b.type === 'heading') return `título «${String(c.text ?? '')}»`;
        return b.title ? `${b.type} «${b.title}»` : b.type;
    };
    return layout.pages.map((p) => ({ page: p.name, blocks: p.sections.flatMap((s) => s.blocks.flat().map(label)) }));
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
    return out;
}
