import {
    CRM_GROUP_ICON_KEYS,
    crmCustomConfigSchema,
    fieldSlugSchema,
    portalTemplateSchema,
    type CrmBlock,
    type CrmCustomConfig,
    type Field,
    type PortalBlockType,
    type PortalTemplate,
    type PortalTemplateBlock,
} from '@imagina-base/shared';
import { z } from 'zod';
import { AiToolError } from './registry';

/**
 * v0.1.195 — constructores PUROS de la configuración de lista que propone
 * el asistente/MCP: la plantilla del portal del cliente y el layout CRM
 * de la ficha del registro. Reciben el vocabulario del modelo (slugs,
 * textos) y devuelven EXACTAMENTE el shape que persisten los editores
 * visuales, así lo propuesto por lenguaje natural se abre y se retoca
 * después en el editor sin migración.
 *
 * Sin dependencias de servicios: el llamador resuelve listas y campos y
 * pasa catálogos; esto valida y arma. Testeable en aislamiento.
 */

// ── Portal: vocabulario del modelo ───────────────────────────────────────

const slugs = (max: number, what: string) => z.array(fieldSlugSchema).min(1).max(max).describe(what);
const href = z.string().min(1).max(2000).describe('URL https://, mailto: o tel:');

export const portalBlockSpec = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('hero'),
        title: z.string().min(1).max(190).describe('Acepta merge tags del registro: "Hola, {{nombre}}"'),
        subtitle: z.string().max(300).optional(),
        cta_label: z.string().max(60).optional(),
        cta_href: href.optional(),
    }),
    z.object({ type: z.literal('heading'), text: z.string().min(1).max(190), eyebrow: z.string().max(80).optional(), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }),
    z.object({
        type: z.literal('notice'),
        title: z.string().max(190).optional(),
        body: z.string().min(1).max(2000),
        variant: z.enum(['info', 'success', 'warning', 'error', 'announce']).optional(),
    }),
    z.object({ type: z.literal('static_text'), title: z.string().max(190).optional(), text: z.string().min(1).max(8000).describe('Texto plano; los párrafos se separan con línea en blanco') }),
    z.object({ type: z.literal('client_data'), title: z.string().max(190).optional(), fields: slugs(40, 'Campos del registro del cliente que se muestran (slugs)') }),
    z.object({
        type: z.literal('editable_form'),
        title: z.string().max(190).optional(),
        fields: slugs(30, 'Campos que el cliente puede EDITAR (slugs). Sólo los que de verdad le corresponden corregir.'),
        submit_label: z.string().max(60).optional(),
    }),
    z.object({
        type: z.literal('related_records_table'),
        list: z.string().max(63).describe('Slug de una lista VINCULADA al cliente (relation hacia esta lista, o campo user)'),
        title: z.string().max(190).optional(),
        fields: z.array(fieldSlugSchema).max(12).optional().describe('Columnas visibles (slugs de esa lista). Default: las primeras 5.'),
        per_page: z.number().int().min(5).max(50).optional(),
    }),
    z.object({
        type: z.literal('kpi_widget'),
        title: z.string().min(1).max(190),
        list: z.string().max(63).describe('Slug de la lista del portal o de una vinculada'),
        metric: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional(),
        field: fieldSlugSchema.optional().describe('Campo numérico (obligatorio salvo count)'),
        prefix: z.string().max(8).optional(),
        suffix: z.string().max(8).optional(),
    }),
    z.object({ type: z.literal('download_files'), title: z.string().max(190).optional(), field: fieldSlugSchema.describe('Campo de tipo file') }),
    z.object({ type: z.literal('comments_thread'), title: z.string().max(190).optional(), readonly: z.boolean().optional() }),
    z.object({ type: z.literal('activity_timeline'), title: z.string().max(190).optional(), limit: z.number().int().min(1).max(50).optional() }),
    z.object({ type: z.literal('external_link'), title: z.string().min(1).max(190), href, label: z.string().max(60).optional(), description: z.string().max(300).optional() }),
    z.object({
        type: z.literal('contact_card'),
        title: z.string().max(190).optional(),
        name: z.string().min(1).max(190),
        role: z.string().max(190).optional(),
        email: z.string().max(255).optional(),
        phone: z.string().max(60).optional(),
        whatsapp: z.string().max(60).optional(),
    }),
    z.object({ type: z.literal('faq'), title: z.string().max(190).optional(), items: z.array(z.object({ question: z.string().min(1).max(300), answer: z.string().min(1).max(2000) })).min(1).max(30) }),
    z.object({ type: z.literal('quick_actions'), title: z.string().max(190).optional(), items: z.array(z.object({ label: z.string().min(1).max(60), href })).min(1).max(12) }),
    z.object({ type: z.literal('divider'), label: z.string().max(80).optional() }),
    z.object({ type: z.literal('spacer') }),
]);
export type PortalBlockSpec = z.infer<typeof portalBlockSpec>;

export const PORTAL_BLOCK_LABEL: Record<PortalBlockType, string> = {
    hero: 'Portada',
    heading: 'Título',
    divider: 'Separador',
    notice: 'Aviso',
    spacer: 'Espacio',
    nested_section: 'Sub-sección',
    client_data: 'Datos del cliente',
    related_records_table: 'Tabla de registros',
    kpi_widget: 'Indicador',
    stats_grid: 'Cifras',
    editable_form: 'Formulario editable',
    comments_thread: 'Comentarios',
    activity_timeline: 'Actividad',
    download_files: 'Descargas',
    static_text: 'Texto',
    image: 'Imagen',
    gallery: 'Galería',
    external_link: 'Enlace',
    quick_actions: 'Acciones rápidas',
    faq: 'Preguntas frecuentes',
    contact_card: 'Tarjeta de contacto',
};

/** Alto por defecto (unidades del grid de 40px) — espejo de `portalLayout.ts`. */
const PORTAL_HEIGHT: Record<PortalBlockType, number> = {
    static_text: 4, client_data: 6, related_records_table: 10, editable_form: 8, external_link: 2, kpi_widget: 3,
    activity_timeline: 8, download_files: 5, comments_thread: 8, heading: 2, hero: 6, stats_grid: 3, quick_actions: 5,
    notice: 3, divider: 2, faq: 8, contact_card: 5, image: 4, gallery: 4, spacer: 1, nested_section: 4,
};
const PORTAL_WIDTH: Partial<Record<PortalBlockType, number>> = { kpi_widget: 4, external_link: 4, contact_card: 6, image: 6 };

export interface PortalBuildContext {
    /** Campos de la lista del portal, por slug. */
    fields: Map<string, Field>;
    /** Listas vinculadas al cliente (por slug) con sus campos — lo que el portal puede mostrar. */
    related: Map<string, { id: number; name: string; fields: Map<string, Field> }>;
    /** Slug de la lista del portal (para kpi sobre la propia lista). */
    listSlug: string;
}

export interface PortalBuildResult {
    template: PortalTemplate;
    preview: Array<{ type: string; label: string; detail: string | null }>;
}

const NUMERIC = new Set(['number', 'currency', 'percent', 'duration', 'rating', 'rollup']);

function requireField(map: Map<string, Field>, slug: string, where: string, listName: string): Field {
    const f = map.get(slug);
    if (!f) throw new AiToolError(`${where}: el campo «${slug}» no existe en «${listName}». Campos: ${Array.from(map.keys()).join(', ')}.`);
    return f;
}

function checkHref(value: string, where: string): string {
    if (!/^(https?:\/\/|mailto:|tel:|\/)/i.test(value)) throw new AiToolError(`${where}: el enlace «${value}» tiene que empezar con https://, mailto: o tel:.`);
    return value;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texto plano → HTML de párrafos (el bloque `static_text` guarda HTML). */
export function textToHtml(text: string): string {
    return text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/**
 * Arma la plantilla del portal a partir del vocabulario del modelo:
 * valida slugs y listas, rellena el `config` que cada bloque espera y
 * ubica los bloques en el grid (a lo ancho; los angostos —KPIs, enlaces,
 * tarjeta de contacto— se ponen en la misma fila mientras quepan).
 */
export function buildPortalTemplate(specs: PortalBlockSpec[], ctx: PortalBuildContext, listName: string): PortalBuildResult {
    if (specs.length === 0) throw new AiToolError('La plantilla del portal necesita al menos un bloque.');
    const blocks: PortalTemplateBlock[] = [];
    const preview: PortalBuildResult['preview'] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    const place = (type: PortalBlockType): { x: number; y: number; w: number; h: number } => {
        const w = PORTAL_WIDTH[type] ?? 12;
        const h = PORTAL_HEIGHT[type];
        if (x + w > 12) {
            x = 0;
            y += rowH;
            rowH = 0;
        }
        const at = { x, y, w, h };
        x += w;
        rowH = Math.max(rowH, h);
        if (x >= 12) {
            x = 0;
            y += rowH;
            rowH = 0;
        }
        return at;
    };
    const labelsOf = (map: Map<string, Field>, list: string[]): string => list.map((s) => map.get(s)?.label ?? s).join(', ');

    specs.forEach((spec, i) => {
        const where = `Bloque ${i + 1} (${PORTAL_BLOCK_LABEL[spec.type]})`;
        let config: Record<string, unknown>;
        let label = '';
        let detail: string | null = null;
        switch (spec.type) {
            case 'hero':
                if (spec.cta_href) checkHref(spec.cta_href, where);
                config = { title: spec.title, subtitle: spec.subtitle ?? '', cta_label: spec.cta_label ?? '', cta_href: spec.cta_href ?? '', variant: 'gradient', accent_color: null, align: 'left' };
                label = spec.title;
                detail = spec.subtitle ?? null;
                break;
            case 'heading':
                config = { text: spec.text, eyebrow: spec.eyebrow ?? '', level: spec.level ?? 2, align: 'left', accent_color: null };
                label = spec.text;
                break;
            case 'notice':
                config = { title: spec.title ?? '', body: spec.body, variant: spec.variant ?? 'info', cta_label: '', cta_href: '', dismissible: false };
                label = spec.title || spec.body.slice(0, 80);
                break;
            case 'static_text':
                config = { html: textToHtml(spec.text), title: spec.title ?? '', variant: 'card' };
                label = spec.title || spec.text.slice(0, 80);
                break;
            case 'client_data': {
                for (const s of spec.fields) requireField(ctx.fields, s, where, listName);
                config = { visible_field_slugs: spec.fields, title: spec.title ?? '', variant: 'definition_list' };
                label = spec.title || 'Datos del cliente';
                detail = labelsOf(ctx.fields, spec.fields);
                break;
            }
            case 'editable_form': {
                for (const s of spec.fields) {
                    const f = requireField(ctx.fields, s, where, listName);
                    if (['computed', 'lookup', 'rollup'].includes(f.type)) throw new AiToolError(`${where}: «${s}» es ${f.type} y no se puede editar.`);
                }
                config = { editable_field_slugs: spec.fields, title: spec.title ?? 'Actualizar mis datos', submit_label: spec.submit_label ?? 'Guardar' };
                label = spec.title || 'Actualizar mis datos';
                detail = `editable: ${labelsOf(ctx.fields, spec.fields)}`;
                break;
            }
            case 'related_records_table': {
                const rel = ctx.related.get(spec.list);
                if (!rel) {
                    const opts = Array.from(ctx.related.keys());
                    throw new AiToolError(
                        `${where}: la lista «${spec.list}» no está vinculada al cliente. ${opts.length ? `Vinculadas: ${opts.join(', ')}.` : 'Ninguna lista tiene un campo relation hacia esta lista ni un campo user; primero hay que crear ese vínculo.'}`,
                    );
                }
                const cols = spec.fields ?? Array.from(rel.fields.keys()).slice(0, 5);
                for (const s of cols) requireField(rel.fields, s, where, rel.name);
                config = { list_slug: spec.list, visible_field_slugs: cols, title: spec.title ?? rel.name, per_page: spec.per_page ?? 10, variant: 'table' };
                label = spec.title || rel.name;
                detail = `${rel.name}: ${labelsOf(rel.fields, cols)}`;
                break;
            }
            case 'kpi_widget': {
                const metric = spec.metric ?? 'count';
                const isOwn = spec.list === ctx.listSlug;
                const target = isOwn ? { name: listName, fields: ctx.fields } : ctx.related.get(spec.list);
                if (!target) throw new AiToolError(`${where}: la lista «${spec.list}» no es la del portal ni una vinculada (${Array.from(ctx.related.keys()).join(', ') || 'ninguna'}).`);
                let fieldId = 0;
                if (metric !== 'count') {
                    if (!spec.field) throw new AiToolError(`${where}: la métrica ${metric} necesita field.`);
                    const f = requireField(target.fields, spec.field, where, target.name);
                    if (!NUMERIC.has(f.type)) throw new AiToolError(`${where}: ${metric} sólo aplica a campos numéricos («${spec.field}» es ${f.type}).`);
                    fieldId = f.id;
                }
                config = { title: spec.title, list_slug: spec.list, field_id: fieldId, metric, prefix: spec.prefix ?? '', suffix: spec.suffix ?? '', variant: 'card', accent_color: null };
                label = spec.title;
                detail = `${metric}${spec.field ? ` de ${target.fields.get(spec.field)?.label ?? spec.field}` : ''} · ${target.name}`;
                break;
            }
            case 'download_files': {
                const f = requireField(ctx.fields, spec.field, where, listName);
                if (f.type !== 'file') throw new AiToolError(`${where}: «${spec.field}» es ${f.type}; se esperaba un campo file.`);
                config = { title: spec.title ?? 'Archivos', field_slug: spec.field, variant: 'list' };
                label = spec.title || 'Archivos';
                detail = f.label;
                break;
            }
            case 'comments_thread':
                config = { title: spec.title ?? 'Comentarios', readonly: spec.readonly ?? false };
                label = spec.title || 'Comentarios';
                detail = spec.readonly ? 'sólo lectura' : null;
                break;
            case 'activity_timeline':
                config = { title: spec.title ?? 'Actividad reciente', limit: spec.limit ?? 10 };
                label = spec.title || 'Actividad reciente';
                break;
            case 'external_link':
                checkHref(spec.href, where);
                config = { title: spec.title, description: spec.description ?? '', href: spec.href, label: spec.label ?? 'Abrir', new_window: true, variant: 'button', accent_color: null };
                label = spec.title;
                detail = spec.href;
                break;
            case 'contact_card':
                config = { title: spec.title ?? 'Tu asesor', name: spec.name, role: spec.role ?? '', avatar_url: '', email: spec.email ?? '', phone: spec.phone ?? '', whatsapp: spec.whatsapp ?? '' };
                label = spec.name;
                detail = [spec.role, spec.email, spec.phone].filter(Boolean).join(' · ') || null;
                break;
            case 'faq':
                config = { title: spec.title ?? 'Preguntas frecuentes', items: spec.items };
                label = spec.title || 'Preguntas frecuentes';
                detail = `${spec.items.length} pregunta${spec.items.length === 1 ? '' : 's'}`;
                break;
            case 'quick_actions':
                config = {
                    title: spec.title ?? 'Acciones rápidas',
                    items: spec.items.map((it) => ({ icon: 'link', label: it.label, href: checkHref(it.href, where), new_window: true })),
                    columns: Math.min(4, Math.max(2, spec.items.length)) as 2 | 3 | 4,
                };
                label = spec.title || 'Acciones rápidas';
                detail = spec.items.map((it) => it.label).join(', ');
                break;
            case 'divider':
                config = { label: spec.label ?? '', style: 'solid' };
                label = spec.label || '—';
                break;
            case 'spacer':
                config = { height: 32 };
                label = '';
                break;
        }
        blocks.push({ id: `${spec.type}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`, type: spec.type, config, ...place(spec.type) });
        preview.push({ type: PORTAL_BLOCK_LABEL[spec.type], label, detail });
    });
    return { template: portalTemplateSchema.parse({ blocks }), preview };
}

/** Resumen legible de una plantilla guardada (para `get_list_schema`). */
export function describePortalTemplate(template: PortalTemplate | null): Array<{ type: string; summary: string }> {
    if (!template) return [];
    return template.blocks.map((b) => {
        const c = b.config as Record<string, unknown>;
        const str = (k: string): string => (typeof c[k] === 'string' ? (c[k] as string) : '');
        const arr = (k: string): string[] => (Array.isArray(c[k]) ? (c[k] as unknown[]).map(String) : []);
        let summary = str('title') || str('text') || str('name') || '';
        if (b.type === 'client_data') summary = `${summary || 'Datos'}: ${arr('visible_field_slugs').join(', ')}`;
        if (b.type === 'editable_form') summary = `${summary || 'Formulario'}: ${arr('editable_field_slugs').join(', ')}`;
        if (b.type === 'related_records_table') summary = `${str('list_slug')}: ${arr('visible_field_slugs').join(', ')}`;
        if (b.type === 'kpi_widget') summary = `${summary} (${str('metric') || 'count'} · ${str('list_slug')})`;
        if (b.type === 'download_files') summary = `${summary}: ${str('field_slug')}`;
        return { type: b.type, summary: summary.slice(0, 160) };
    });
}

// ── Layout CRM de la ficha ───────────────────────────────────────────────

export const crmLayoutSpec = z.object({
    header: z
        .object({
            variant: z.enum(['hero', 'compact', 'minimal', 'banner']).optional().describe('hero (avatar grande, default) | compact | minimal | banner'),
            subtitle_fields: z.array(fieldSlugSchema).max(3).optional().describe('Campos que salen bajo el título (p. ej. empresa, email)'),
            status_fields: z.array(fieldSlugSchema).max(4).optional().describe('Selects que se muestran como pastillas de estado'),
            quick_action_fields: z.array(fieldSlugSchema).max(4).optional().describe('email/phone/url con botón de acción rápida'),
            show_avatar: z.boolean().optional(),
        })
        .optional(),
    groups: z
        .array(
            z.object({
                label: z.string().min(1).max(80),
                icon: z.enum(CRM_GROUP_ICON_KEYS).optional().describe(`Icono del grupo: ${CRM_GROUP_ICON_KEYS.join(' | ')}`),
                fields: z.array(fieldSlugSchema).min(1).max(40),
                collapsed: z.boolean().optional(),
                density: z.enum(['compact', 'comfortable']).optional(),
            }),
        )
        .min(1)
        .max(12)
        .describe('Grupos de campos de la columna principal, en orden'),
    include_remaining_fields: z.boolean().optional().describe('Default true: los campos no asignados a ningún grupo van a un grupo "Otros datos" al final (si es false, no se muestran en la ficha).'),
    sidebar: z
        .object({
            stats: z.boolean().optional().describe('Cifras automáticas (días en el sistema, comentarios, cambios). Default true'),
            timeline: z.boolean().optional().describe('Línea de tiempo de actividad. Default true'),
            comments: z.boolean().optional().describe('Hilo de comentarios. Default true'),
            related_fields: z.array(fieldSlugSchema).max(6).optional().describe('Campos relation cuyos registros vinculados se listan'),
            file_fields: z.array(fieldSlugSchema).max(6).optional().describe('Campos file cuyos archivos se listan'),
        })
        .optional(),
    notes: z.array(z.object({ title: z.string().min(1).max(120), text: z.string().min(1).max(4000) })).max(4).optional().describe('Notas fijas (instrucciones para el equipo) bajo los grupos'),
});
export type CrmLayoutSpec = z.infer<typeof crmLayoutSpec>;

const GROUP_ICON_GUESS: Array<[RegExp, (typeof CRM_GROUP_ICON_KEYS)[number]]> = [
    [/contact|correo|email|tel|phone/i, 'mail'],
    [/empresa|compa|organiz/i, 'building'],
    [/dinero|monto|pago|cobro|factur|precio|\$|valor/i, 'dollar'],
    [/fecha|plazo|venc|calend/i, 'calendar'],
    [/nota|observ|coment/i, 'sticky_note'],
    [/asign|respons|due[ñn]o/i, 'circle_user'],
    [/soporte|ticket|inciden/i, 'lifebuoy'],
    [/m[ée]trica|kpi|objetivo|meta/i, 'target'],
    [/etiqueta|tag|categor/i, 'tag'],
    [/trabajo|proyecto|tarea/i, 'briefcase'],
    [/persona|cliente|usuario/i, 'user'],
];

export interface CrmBuildResult {
    config: CrmCustomConfig;
    preview: Array<{ type: string; label: string; detail: string | null }>;
    warnings: string[];
}

/**
 * Arma un `crm_template_custom` V2 a partir de grupos de campos: header
 * arriba (12 cols), columna principal (8 cols) con los grupos y las notas
 * apilados, columna lateral (4 cols) con cifras, vinculados, archivos,
 * comentarios y línea de tiempo — el mismo esqueleto que las plantillas
 * integradas, así se puede seguir retocando en el editor.
 */
export function buildCrmCustomConfig(spec: CrmLayoutSpec, fields: Field[], titleFieldSlug: string | null): CrmBuildResult {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const need = (slug: string, where: string, types?: string[]): Field => {
        const f = bySlug.get(slug);
        if (!f) throw new AiToolError(`${where}: el campo «${slug}» no existe. Campos: ${fields.map((x) => x.slug).join(', ')}.`);
        if (types && !types.includes(f.type)) throw new AiToolError(`${where}: «${slug}» es ${f.type}; se esperaba ${types.join('/')}.`);
        return f;
    };
    const warnings: string[] = [];
    const preview: CrmBuildResult['preview'] = [];
    const header = spec.header ?? {};
    for (const s of header.subtitle_fields ?? []) need(s, 'header.subtitle_fields');
    for (const s of header.status_fields ?? []) need(s, 'header.status_fields', ['select', 'multi_select', 'checkbox']);
    for (const s of header.quick_action_fields ?? []) need(s, 'header.quick_action_fields', ['email', 'phone', 'url']);

    const assigned = new Set<string>();
    const blocks: CrmBlock[] = [
        {
            id: 'header',
            type: 'header',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: {
                variant: header.variant ?? 'hero',
                show_avatar: header.show_avatar ?? true,
                show_id_badge: true,
                show_subtitle: true,
                show_created_at: true,
                show_status_strip: true,
                show_actions: true,
                accent_color: null,
            },
        },
    ];
    preview.push({ type: 'Cabecera', label: header.variant ?? 'hero', detail: [...(header.subtitle_fields ?? []), ...(header.status_fields ?? [])].map((s) => bySlug.get(s)?.label ?? s).join(', ') || null });

    let leftY = 4;
    const groups = [...spec.groups];
    for (const [i, g] of groups.entries()) {
        const where = `Grupo «${g.label}»`;
        const fieldSlugs: string[] = [];
        for (const s of g.fields) {
            need(s, where);
            if (assigned.has(s)) {
                warnings.push(`El campo «${s}» estaba en dos grupos; se dejó en el primero.`);
                continue;
            }
            assigned.add(s);
            fieldSlugs.push(s);
        }
        if (fieldSlugs.length === 0) continue;
        const h = Math.max(3, Math.ceil(1 + fieldSlugs.length * 1.5));
        blocks.push({
            id: `group-${i + 1}`,
            type: 'properties_group',
            x: 0,
            y: leftY,
            w: 8,
            h,
            config: {
                label: g.label,
                icon_key: g.icon ?? GROUP_ICON_GUESS.find(([re]) => re.test(g.label))?.[1] ?? 'database',
                field_slugs: fieldSlugs,
                collapsed_by_default: g.collapsed ?? false,
                ...(g.density ? { density: g.density } : {}),
            },
        });
        preview.push({ type: 'Grupo', label: g.label, detail: fieldSlugs.map((s) => bySlug.get(s)?.label ?? s).join(', ') });
        leftY += h;
    }
    // Lo que ya se ve en otro lado (cabecera, vinculados o archivos del
    // lateral) no se repite en "Otros datos".
    const side = spec.sidebar ?? {};
    const elsewhere = new Set(
        [titleFieldSlug, ...(header.subtitle_fields ?? []), ...(header.status_fields ?? []), ...(header.quick_action_fields ?? []), ...(side.related_fields ?? []), ...(side.file_fields ?? [])].filter(Boolean) as string[],
    );
    const remaining = fields.filter((f) => !assigned.has(f.slug) && !elsewhere.has(f.slug)).map((f) => f.slug);
    if (remaining.length > 0 && (spec.include_remaining_fields ?? true)) {
        const h = Math.max(3, Math.ceil(1 + remaining.length * 1.5));
        blocks.push({ id: 'group-otros', type: 'properties_group', x: 0, y: leftY, w: 8, h, config: { label: 'Otros datos', icon_key: 'database', field_slugs: remaining, collapsed_by_default: true } });
        preview.push({ type: 'Grupo', label: 'Otros datos', detail: remaining.map((s) => bySlug.get(s)?.label ?? s).join(', ') });
        leftY += h;
    } else if (remaining.length > 0) {
        warnings.push(`Quedan fuera de la ficha: ${remaining.join(', ')}.`);
    }
    for (const [i, n] of (spec.notes ?? []).entries()) {
        blocks.push({ id: `notes-${i + 1}`, type: 'notes', x: 0, y: leftY, w: 8, h: 4, config: { title: n.title, source: 'literal', content: n.text } });
        preview.push({ type: 'Nota', label: n.title, detail: null });
        leftY += 4;
    }

    let rightY = 4;
    if (side.stats ?? true) {
        blocks.push({ id: 'stats', type: 'stats', x: 8, y: rightY, w: 4, h: 4, config: {} });
        preview.push({ type: 'Cifras', label: 'automáticas', detail: null });
        rightY += 4;
    }
    for (const s of side.related_fields ?? []) {
        const f = need(s, 'sidebar.related_fields', ['relation']);
        blocks.push({ id: `related-${s}`, type: 'related', x: 8, y: rightY, w: 4, h: 4, config: { field_slug: s } });
        preview.push({ type: 'Vinculados', label: f.label, detail: null });
        rightY += 4;
    }
    if (side.file_fields?.length) {
        for (const s of side.file_fields) need(s, 'sidebar.file_fields', ['file']);
        blocks.push({ id: 'files', type: 'files', x: 8, y: rightY, w: 4, h: 4, config: { file_field_slugs: side.file_fields, title: 'Archivos' } });
        preview.push({ type: 'Archivos', label: side.file_fields.map((s) => bySlug.get(s)?.label ?? s).join(', '), detail: null });
        rightY += 4;
    }
    if (side.comments ?? true) {
        blocks.push({ id: 'comments', type: 'comments_thread', x: 8, y: rightY, w: 4, h: 6, config: { title: 'Comentarios' } });
        preview.push({ type: 'Comentarios', label: 'hilo', detail: null });
        rightY += 6;
    }
    if (side.timeline ?? true) {
        blocks.push({ id: 'timeline', type: 'timeline', x: 8, y: rightY, w: 4, h: Math.max(8, leftY - rightY), config: {} });
        preview.push({ type: 'Actividad', label: 'línea de tiempo', detail: null });
    }

    const config = crmCustomConfigSchema.parse({
        v: 2,
        header: {
            ...(titleFieldSlug ? { title_field_slug: titleFieldSlug } : {}),
            subtitle_field_slugs: header.subtitle_fields ?? [],
            status_field_slugs: header.status_fields ?? [],
            quick_action_field_slugs: header.quick_action_fields ?? [],
        },
        blocks,
    });
    return { config, preview, warnings };
}

/** Resumen legible de un layout personalizado guardado (para `get_list_schema`). */
export function describeCrmConfig(config: CrmCustomConfig | null): Array<{ type: string; summary: string }> {
    if (!config) return [];
    return config.blocks.map((b) => {
        const c = b.config as Record<string, unknown>;
        if (b.type === 'properties_group') return { type: b.type, summary: `${String(c.label ?? '')}: ${(Array.isArray(c.field_slugs) ? c.field_slugs : []).join(', ')}` };
        if (b.type === 'related') return { type: b.type, summary: String(c.field_slug ?? '') };
        if (b.type === 'notes' || b.type === 'heading' || b.type === 'markdown') return { type: b.type, summary: String(c.title ?? c.text ?? '') };
        return { type: b.type, summary: '' };
    });
}
