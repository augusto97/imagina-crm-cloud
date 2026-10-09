import { useMemo, useState } from 'react';
import {
    Activity,
    AlignLeft,
    BarChart3,
    Briefcase,
    Building2,
    Calendar,
    ChevronDown,
    CircleCheck,
    CircleUser,
    Database,
    DollarSign,
    ExternalLink,
    Info,
    LifeBuoy,
    Lightbulb,
    Link2,
    Mail,
    MessageSquare,
    Paperclip,
    Pencil,
    StickyNote,
    Tag,
    Target,
    TriangleAlert,
    User,
    type LucideIcon,
} from 'lucide-react';
import {
    CHART_KIND_WIDGET,
    layoutChartKindSchema,
    resolveEmbed,
    type LayoutBlock,
    type LayoutDataSource,
} from '@imagina-base/shared';

import { WidgetRenderer } from '@/admin/dashboards/widgets/WidgetRenderer';
import { CompactFieldRow } from '@/admin/records/crm/CompactFieldRow';
import { PortalAccessButton } from '@/admin/records/crm/PortalAccessButton';
import { RecordPaymentsPanel } from '@/cloud/components/payments/RecordPaymentsPanel';
import { renderMarkdown } from '@/admin/records/crm/blocks/SimpleBlockViews';
import { RecordDescription } from '@/admin/records/description/RecordDescription';
import { ActivityTimelineBlock } from '@/portal/blocks/ActivityTimelineBlock';
import { CommentsThreadBlock } from '@/portal/blocks/CommentsThreadBlock';
import { PortalPreviewContext } from '@/portal/PreviewContext';
import { adminGallerySrc, adminImageSrc, GalleryBlockView, ImageBlockView } from '@/admin/template-editor-core/ImageBlockForm';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { blockStyleClass, blockStyleCss, readBlockStyle } from '@/lib/blockStyle';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';
import type { FieldEntity } from '@/types/field';

import { ActivityFeed } from './ActivityFeed';
import { FieldDisplay, optionsOf } from './FieldDisplay';
import { fieldEditable, useLayoutCtx } from './LayoutContext';
import { surfaceClass, tint } from './layoutTheme';
import { RecordStatsView } from './RecordStatsView';
import { RelatedBlockView } from './RelatedBlockView';

/** Bloques que se dibujan SIN tarjeta (son parte del flujo de la página). */
const BARE: ReadonlySet<string> = new Set(['heading', 'divider', 'spacer', 'button', 'notice', 'stages', 'portal_access', 'payments']);
/** En el portal, comentarios y actividad traen su propia tarjeta. */
const BARE_IN_PORTAL: ReadonlySet<string> = new Set(['activity', 'comments']);

/** Icono del título de un bloque: el elegido (`config.icon`) o el de su tipo. */
const ICONS: Record<string, LucideIcon> = {
    mail: Mail,
    building: Building2,
    tag: Tag,
    briefcase: Briefcase,
    dollar: DollarSign,
    calendar: Calendar,
    user: User,
    circle_user: CircleUser,
    sticky_note: StickyNote,
    target: Target,
    lifebuoy: LifeBuoy,
    database: Database,
    link: Link2,
};
const TYPE_ICONS: Partial<Record<string, LucideIcon>> = {
    activity: Activity,
    comments: MessageSquare,
    record_stats: BarChart3,
    files: Paperclip,
    description: AlignLeft,
};

function blockIcon(block: LayoutBlock): LucideIcon | null {
    const key = typeof block.config.icon === 'string' ? block.config.icon : '';
    return ICONS[key] ?? TYPE_ICONS[block.type] ?? null;
}

/**
 * v0.1.230 — Un bloque de la ficha dentro de su marco (tarjeta del tema,
 * título, capa de estilo compartida con los tableros).
 */
export function LayoutBlockView({ block }: { block: LayoutBlock }): JSX.Element | null {
    const ctx = useLayoutCtx();
    const dark = useTheme().resolved === 'dark';
    const style = readBlockStyle({ style: block.style });
    const styled = block.style !== undefined && Object.keys(block.style).length > 0;
    const card =
        block.type === 'field'
            ? block.config.card === true
            : !BARE.has(block.type) && !(ctx.mode === 'portal' && BARE_IN_PORTAL.has(block.type));
    const title = blockTitle(block, ctx.fieldsById);
    const collapsible = block.type === 'fields' && block.config.collapsible !== false && title !== null;
    const [open, setOpen] = useState(block.config.collapsed !== true);
    const Icon = blockIcon(block);

    if (isEmptyActionButton(block, ctx)) return null;
    const body = <BlockBody block={block} />;
    if (!card) {
        return (
            <div className={blockStyleClass(style)} style={styled ? blockStyleCss(style, { dark }) : undefined} data-block={block.type}>
                {body}
            </div>
        );
    }
    return (
        <section
            data-block={block.type}
            className={cn(
                'imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-overflow-hidden',
                !styled && surfaceClass(ctx.theme.surface),
                blockStyleClass(style),
            )}
            style={{ borderRadius: ctx.theme.radius, ...(styled ? blockStyleCss(style, { dark }) : {}) }}
        >
            {title !== null && (
                <header
                    className={cn(
                        'imcrm-group/head imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-px-4 imcrm-pt-3.5',
                        open ? 'imcrm-pb-1.5' : 'imcrm-pb-3.5',
                    )}
                >
                    {collapsible ? (
                        <button
                            type="button"
                            onClick={() => setOpen((o) => !o)}
                            className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-left"
                            aria-expanded={open}
                        >
                            <BlockTitle text={title} icon={Icon} />
                            <ChevronDown
                                className={cn(
                                    'imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-opacity-0 imcrm-transition group-hover/head:imcrm-opacity-100',
                                    !open && 'imcrm--rotate-90 imcrm-opacity-100',
                                )}
                            />
                        </button>
                    ) : (
                        <BlockTitle text={title} icon={Icon} />
                    )}
                </header>
            )}
            {open && <div className={cn('imcrm-min-w-0 imcrm-flex-1', padFor(block))}>{body}</div>}
        </section>
    );
}

/**
 * Un botón de acción (escribir, llamar, abrir) sin dato no tiene nada que
 * hacer: en la ficha no se dibuja ni deja su hueco (en el editor sí, para
 * poder elegirlo).
 */
function isEmptyActionButton(block: LayoutBlock, ctx: ReturnType<typeof useLayoutCtx>): boolean {
    const c = block.config;
    if (block.type !== 'field' || c.display !== 'button' || c.label !== 'hidden' || c.card === true || ctx.preview) return false;
    const field = ctx.fieldsById.get(Number(c.field_id));
    const value = field ? ctx.values[field.slug] : undefined;
    return value === null || value === undefined || value === '';
}

function BlockTitle({ text, icon: Icon }: { text: string; icon?: LucideIcon | null }): JSX.Element {
    return (
        <h3 className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-text-[13px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
            {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />}
            <span className="imcrm-truncate">{text}</span>
        </h3>
    );
}

/** Relleno interno según el tipo (las filas de campos llevan el suyo). */
function padFor(block: LayoutBlock): string {
    if (block.type === 'fields' || block.type === 'files') return 'imcrm-px-2 imcrm-pb-2';
    if (block.type === 'related') return 'imcrm-pt-1';
    if (block.type === 'description') return 'imcrm-px-4 imcrm-pb-4 imcrm-pt-3.5';
    if (block.type === 'field') return 'imcrm-p-4';
    return 'imcrm-px-4 imcrm-pb-4 imcrm-pt-2';
}

function blockTitle(block: LayoutBlock, fieldsById: Map<number, FieldEntity>): string | null {
    // Los gráficos dibujan su propio encabezado (el de los tableros); el campo
    // destacado lleva su etiqueta adentro, chica, para que mande la cifra; la
    // descripción trae su título con el estado del guardado.
    if (block.type === 'chart' || block.type === 'field' || block.type === 'description') return null;
    if (block.title !== undefined && block.title !== '') return block.title;
    void fieldsById;
    switch (block.type) {
        case 'files':
            return __('Archivos');
        case 'activity':
            return __('Actividad');
        case 'comments':
            return __('Comentarios');
        case 'record_stats':
            return __('Resumen');
        default:
            return null;
    }
}

function BlockBody({ block }: { block: LayoutBlock }): JSX.Element | null {
    const ctx = useLayoutCtx();
    const c = block.config;
    switch (block.type) {
        case 'field':
            return <FieldBlock block={block} />;
        case 'fields':
            return <FieldsBlock ids={idList(c.field_ids)} layout={String(c.layout ?? 'list')} columns={Number(c.columns ?? 2)} />;
        case 'files': {
            const ids = idList(c.field_ids);
            const fileIds = ids.length > 0 ? ids : ctx.fields.filter((f) => f.type === 'file').map((f) => f.id);
            return <FieldsBlock ids={fileIds} layout="list" columns={1} />;
        }
        case 'stages':
            return <StagesBlock fieldId={Number(c.field_id)} />;
        case 'description':
            if (ctx.mode === 'portal') return null;
            return (
                <RecordDescription
                    listKey={ctx.list.slug}
                    listSlug={ctx.list.slug}
                    recordId={ctx.record.id}
                    editable={ctx.canEdit && !ctx.preview}
                    heading="block"
                />
            );
        case 'record_stats':
            if (ctx.mode === 'portal') return null;
            return (
                <RecordStatsView
                    listId={ctx.list.id}
                    record={ctx.record}
                    items={c.mode === 'custom' && Array.isArray(c.items) ? (c.items as never) : []}
                    fieldsById={ctx.fieldsById}
                    values={ctx.values}
                />
            );
        case 'activity':
        case 'comments':
            if (ctx.mode === 'portal') return <PortalConversation block={block} />;
            return (
                <ActivityFeed
                    listId={ctx.list.id}
                    recordId={ctx.record.id}
                    currentUserId={ctx.currentUserId}
                    isAdmin={ctx.isAdmin}
                    initialFilter={block.type === 'comments' ? 'comments' : 'all'}
                />
            );
        case 'chart':
            return <ChartBlock block={block} />;
        case 'related':
            return <RelatedBlockView block={block} />;
        case 'heading':
            return <HeadingBlock text={String(c.text ?? block.title ?? '')} level={Number(c.level ?? 2)} subtitle={typeof c.subtitle === 'string' ? c.subtitle : undefined} />;
        case 'text':
            return <TextBlock block={block} />;
        case 'notice':
            return <NoticeBlock tone={String(c.tone ?? 'info')} text={String(c.text ?? '')} title={block.title} />;
        case 'divider':
            return <DividerBlock label={typeof c.label === 'string' ? c.label : undefined} />;
        case 'spacer':
            return <div style={{ height: Math.max(4, Math.min(240, Number(c.height ?? 24))) }} aria-hidden />;
        case 'button':
            return <ButtonBlock block={block} />;
        case 'image': {
            const cfg = { ...c, image_file_id: c.file_id ?? c.image_file_id };
            return <ImageBlockView config={cfg} src={adminImageSrc(cfg)} />;
        }
        case 'gallery':
            return <GalleryBlockView config={c} resolveSrc={adminGallerySrc} />;
        case 'embed':
            return <EmbedBlock block={block} />;
        case 'portal_access':
            if (ctx.mode === 'portal') return null;
            return <PortalAccessButton list={ctx.list} record={ctx.record} />;
        case 'payments':
            if (ctx.mode === 'portal') return null;
            return <RecordPaymentsPanel listId={ctx.list.id} recordId={ctx.record.id} showEmptyHint />;
        default:
            return null;
    }
}

function idList(raw: unknown): number[] {
    return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

// ── Campos ───────────────────────────────────────────────────────────────

/** Un campo con la forma elegida; lápiz para editarlo sin salir de la tarjeta. */
function FieldBlock({ block }: { block: LayoutBlock }): JSX.Element | null {
    const ctx = useLayoutCtx();
    const field = ctx.fieldsById.get(Number(block.config.field_id));
    if (!field) return <MissingField />;
    const c = block.config;
    const value = ctx.values[field.slug];
    const locked = ctx.lockedReasons[field.slug] ?? null;
    void locked;
    const editable = fieldEditable(ctx, field);
    const Icon = fieldTypeIcon(field.type);
    const showLabel = c.label !== 'hidden';
    // Un botón de acción (escribir, llamar, abrir) sin dato no tiene nada que
    // hacer: en la ficha no se dibuja (en el editor sí, para poder elegirlo).
    const actionButton = c.display === 'button' && !showLabel && c.card !== true;
    return (
        <div className="imcrm-group imcrm-relative imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2">
            {showLabel && (
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-pr-6 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                    <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    <span className="imcrm-truncate">{block.title || field.label}</span>
                </span>
            )}
            <div className="imcrm-min-w-0">
                <FieldDisplay
                    field={field}
                    value={value}
                    display={typeof c.display === 'string' ? c.display : undefined}
                    goal={typeof c.goal === 'number' ? c.goal : undefined}
                    prefix={typeof c.prefix === 'string' ? c.prefix : undefined}
                    suffix={typeof c.suffix === 'string' ? c.suffix : undefined}
                    accent={ctx.theme.accent}
                    fullWidth={actionButton}
                />
            </div>
            {editable && (
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="imcrm-absolute imcrm-right-0 imcrm-top-0 imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground imcrm-opacity-0 imcrm-transition-opacity hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-opacity-100 group-hover:imcrm-opacity-100"
                            aria-label={`${__('Editar')} ${field.label}`}
                        >
                            <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="imcrm-w-[360px] imcrm-p-1">
                        <CompactFieldRow
                            field={field}
                            listId={ctx.list.id}
                            recordId={ctx.mode === 'portal' ? undefined : ctx.record.id}
                            value={value}
                            onChange={(v) => ctx.setValue(field.slug, v)}
                            error={ctx.errors[field.slug]}
                            allowCreateOptions={ctx.mode !== 'portal'}
                        />
                    </PopoverContent>
                </Popover>
            )}
            {ctx.errors[field.slug] && <span className="imcrm-text-xs imcrm-text-destructive">{ctx.errors[field.slug]}</span>}
        </div>
    );
}

/**
 * Propiedades editables en lista, grilla o apiladas (se guardan solas). La
 * grilla y la posición de la etiqueta se deciden por el ancho de la TARJETA
 * (ver `.imcrm-props` en globals.css), no de la ventana.
 */
export function FieldsBlock({ ids, layout, columns }: { ids: number[]; layout: string; columns: number }): JSX.Element {
    const ctx = useLayoutCtx();
    const list = ids.map((id) => ctx.fieldsById.get(id)).filter((f): f is FieldEntity => f !== undefined);
    if (list.length === 0) return <p className="imcrm-px-2 imcrm-py-2 imcrm-text-sm imcrm-text-muted-foreground">{__('Sin campos en este bloque.')}</p>;
    const cols = layout === 'grid' ? Math.max(1, Math.min(3, columns)) : 1;
    return (
        <div className={cn('imcrm-props', layout === 'stacked' && 'imcrm-props-stacked')}>
            <div className="imcrm-props-grid" data-cols={String(cols)}>
                {list.map((f) =>
                    // En el portal, lo que el cliente no puede editar se ve como dato,
                    // sin candados ni controles.
                    ctx.mode === 'portal' && !fieldEditable(ctx, f) ? (
                        <ReadOnlyRow key={f.id} field={f} />
                    ) : (
                        <CompactFieldRow
                            key={f.id}
                            variant="property"
                            field={f}
                            listId={ctx.list.id}
                            recordId={ctx.mode === 'portal' ? undefined : ctx.record.id}
                            value={ctx.values[f.slug]}
                            onChange={(v) => ctx.setValue(f.slug, v)}
                            error={ctx.errors[f.slug]}
                            allowCreateOptions={ctx.mode !== 'portal'}
                            lockedReason={
                                ctx.mode === 'portal'
                                    ? null
                                    : !ctx.canEdit || ctx.preview
                                      ? ctx.preview
                                          ? null
                                          : __('No tienes permiso para editar este registro')
                                      : ctx.lockedReasons[f.slug] ?? null
                            }
                        />
                    ),
                )}
            </div>
        </div>
    );
}

/** Un dato del registro, de sólo lectura (el portal muestra así lo no editable). */
function ReadOnlyRow({ field }: { field: FieldEntity }): JSX.Element {
    const ctx = useLayoutCtx();
    const Icon = fieldTypeIcon(field.type);
    return (
        <div className="imcrm-prop" data-readonly-field={field.slug}>
            <div className="imcrm-prop-row imcrm-px-2 imcrm-py-1.5">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-pt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    <span className="imcrm-truncate">{field.label}</span>
                </span>
                <span className="imcrm-min-w-0 imcrm-text-sm imcrm-text-foreground">
                    <FieldDisplay field={field} value={ctx.values[field.slug]} accent={ctx.theme.accent} />
                </span>
            </div>
        </div>
    );
}

/**
 * Comentarios y actividad del PORTAL: hablan con /portal/me/* (el cliente no
 * tiene la API del equipo). En el editor muestran datos de ejemplo.
 */
function PortalConversation({ block }: { block: LayoutBlock }): JSX.Element | null {
    const ctx = useLayoutCtx();
    const boot = ctx.portalBoot ?? { rest_root: '/api/v1', list_slug: ctx.list.slug, user_id: 0, record_id: ctx.record.id };
    const inner =
        block.type === 'comments' ? (
            <CommentsThreadBlock config={{ title: block.title, readonly: block.config.readonly === true }} boot={boot} />
        ) : (
            <ActivityTimelineBlock config={{ title: block.title, limit: Number(block.config.limit ?? 20) }} boot={boot} />
        );
    return <PortalPreviewContext.Provider value={ctx.preview === true}>{inner}</PortalPreviewContext.Provider>;
}

function MissingField(): JSX.Element {
    return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('El campo de este bloque ya no existe.')}</p>;
}

/** Etapas de un select, clickeables: la forma más clara de mostrar un proceso. */
export function StagesBlock({ fieldId, compact = false }: { fieldId: number; compact?: boolean }): JSX.Element | null {
    const ctx = useLayoutCtx();
    const field = ctx.fieldsById.get(fieldId);
    if (!field || field.type !== 'select') return null;
    const opts = optionsOf(field);
    const current = ctx.values[field.slug];
    const idx = opts.findIndex((o) => o.value === current);
    const editable = fieldEditable(ctx, field);
    return (
        <nav aria-label={field.label} className="imcrm-flex imcrm-w-full imcrm-min-w-0 imcrm-overflow-x-auto imcrm-rounded-lg">
            <ol className="imcrm-flex imcrm-w-full imcrm-min-w-max imcrm-gap-1">
                {opts.map((o, i) => {
                    const done = idx >= 0 && i < idx;
                    const active = i === idx;
                    return (
                        <li key={o.value} className="imcrm-min-w-[92px] imcrm-flex-1">
                            <button
                                type="button"
                                disabled={!editable}
                                onClick={() => ctx.setValue(field.slug, active ? null : o.value)}
                                className={cn(
                                    'imcrm-group/stage imcrm-flex imcrm-w-full imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-md imcrm-px-2.5 imcrm-text-left imcrm-transition-colors',
                                    compact ? 'imcrm-py-1.5' : 'imcrm-py-2',
                                    editable && 'hover:imcrm-bg-accent',
                                    active && 'imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border',
                                )}
                                aria-current={active ? 'step' : undefined}
                                title={editable ? `${__('Pasar a')} ${o.label}` : o.label}
                            >
                                <span
                                    className="imcrm-h-1.5 imcrm-w-full imcrm-rounded-full imcrm-transition-colors"
                                    style={{ background: done || active ? ctx.theme.accent : 'hsl(var(--imcrm-muted))', opacity: done ? 0.55 : 1 }}
                                />
                                <span
                                    className={cn(
                                        'imcrm-truncate imcrm-text-xs',
                                        active ? 'imcrm-font-semibold imcrm-text-foreground' : 'imcrm-text-muted-foreground',
                                    )}
                                >
                                    {o.label}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

// ── Gráficos ─────────────────────────────────────────────────────────────

/** Lista de la que leen los datos de una fuente (la necesitan los gráficos para colores y etiquetas). */
export function useSourceListId(source: LayoutDataSource | undefined, blockId?: string): number {
    const ctx = useLayoutCtx();
    // El portal no puede consultar el admin: el servidor ya dijo de qué lista lee cada bloque.
    const known = blockId !== undefined ? ctx.blockLists?.[blockId] : undefined;
    // (el editor del portal sí puede: corre con la sesión del equipo).
    const paths = useRelationPaths(source?.kind === 'related' && (ctx.mode !== 'portal' || ctx.preview) ? ctx.list.id : undefined);
    return useMemo(() => {
        if (known !== undefined) return known;
        if (!source) return 0;
        if (source.kind === 'list') return source.list_id;
        if (source.kind === 'record') return ctx.list.id;
        const own = ctx.fieldsById.get(source.field_id);
        if (own && source.direction !== 'reverse') return Number((own.config as { target_list_id?: unknown }).target_list_id ?? 0);
        if (own) return ctx.list.id;
        const p = (paths.data ?? []).find((x) => x.relation_field_id === source.field_id);
        return p ? p.list_id : 0;
    }, [known, source, ctx.fieldsById, ctx.list.id, paths.data]);
}

const CHART_HEIGHT: Record<string, number> = { kpi: 118, gauge: 190, stat_delta: 118, table: 300, bar: 280, pie: 280, line: 260, area: 260, funnel: 260 };

function ChartBlock({ block }: { block: LayoutBlock }): JSX.Element {
    const source = block.config.source as LayoutDataSource | undefined;
    const listId = useSourceListId(source, block.id);
    const kind = layoutChartKindSchema.catch('kpi').parse(block.config.kind);
    const spec: WidgetSpec = {
        id: block.id,
        type: CHART_KIND_WIDGET[kind] as WidgetSpec['type'],
        list_id: listId,
        title: block.title ?? '',
        config: block.config,
        layout: { x: 0, y: 0, w: 12, h: 4 },
    };
    return (
        <div className="imcrm-flex imcrm-flex-col" style={{ height: CHART_HEIGHT[kind] ?? 260 }}>
            <WidgetRenderer dashboardId={0} widget={spec} />
        </div>
    );
}

// ── Contenido ────────────────────────────────────────────────────────────

function HeadingBlock({ text, level, subtitle }: { text: string; level: number; subtitle?: string }): JSX.Element {
    const cls = level <= 1 ? 'imcrm-text-2xl' : level === 2 ? 'imcrm-text-lg' : 'imcrm-text-base';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-pt-2">
            <h2 className={cn(cls, 'imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground')}>{text}</h2>
            {subtitle && <p className="imcrm-text-sm imcrm-text-muted-foreground">{subtitle}</p>}
        </div>
    );
}

function TextBlock({ block }: { block: LayoutBlock }): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    let raw = typeof c.content === 'string' ? c.content : '';
    if (c.source === 'field') {
        const f = ctx.fieldsById.get(Number(c.field_id));
        const v = f ? ctx.values[f.slug] : undefined;
        raw = typeof v === 'string' ? v : '';
    }
    if (raw === '') return <p className="imcrm-text-sm imcrm-italic imcrm-text-muted-foreground">{__('Sin contenido.')}</p>;
    return (
        <div
            className="imcrm-prose-sm imcrm-text-sm imcrm-leading-relaxed imcrm-text-foreground"
            // renderMarkdown escapa el HTML antes de aplicar el formato.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(raw) }}
        />
    );
}

const NOTICE_TONES: Record<string, { icon: typeof Info; cls: string }> = {
    info: { icon: Info, cls: 'imcrm-border-sky-500/25 imcrm-bg-sky-500/10 imcrm-text-sky-900 dark:imcrm-text-sky-200' },
    success: { icon: CircleCheck, cls: 'imcrm-border-emerald-500/25 imcrm-bg-emerald-500/10 imcrm-text-emerald-900 dark:imcrm-text-emerald-200' },
    warning: { icon: TriangleAlert, cls: 'imcrm-border-amber-500/30 imcrm-bg-amber-500/10 imcrm-text-amber-900 dark:imcrm-text-amber-200' },
    tip: { icon: Lightbulb, cls: 'imcrm-border-violet-500/25 imcrm-bg-violet-500/10 imcrm-text-violet-900 dark:imcrm-text-violet-200' },
};

function NoticeBlock({ tone, text, title }: { tone: string; text: string; title?: string }): JSX.Element {
    const t = NOTICE_TONES[tone] ?? NOTICE_TONES.info!;
    const Icon = t.icon;
    return (
        <div className={cn('imcrm-flex imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-px-4 imcrm-py-3', t.cls)} role="note">
            <Icon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5 imcrm-text-sm">
                {title && <strong className="imcrm-font-semibold">{title}</strong>}
                <span className="imcrm-whitespace-pre-wrap">{text}</span>
            </div>
        </div>
    );
}

function DividerBlock({ label }: { label?: string }): JSX.Element {
    if (!label) return <hr className="imcrm-my-1 imcrm-border-border" />;
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-py-1">
            <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">{label}</span>
            <span className="imcrm-h-px imcrm-flex-1 imcrm-bg-border" />
        </div>
    );
}

function ButtonBlock({ block }: { block: LayoutBlock }): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    let target = typeof c.target === 'string' ? c.target : '';
    if (c.target_source === 'field') {
        const f = ctx.fieldsById.get(Number(c.target_field_id));
        const v = f ? ctx.values[f.slug] : undefined;
        target = typeof v === 'string' ? v : '';
    }
    const action = String(c.action ?? 'url');
    const href = action === 'mailto' ? `mailto:${target}` : action === 'tel' ? `tel:${target}` : target;
    const label = String(c.label ?? __('Abrir'));
    const variant = String(c.variant ?? 'default');
    const cls = cn(
        'imcrm-inline-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-rounded-md imcrm-px-4 imcrm-py-2 imcrm-text-sm imcrm-font-semibold imcrm-transition-colors',
        variant === 'outline' ? 'imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-foreground hover:imcrm-bg-accent' : 'imcrm-text-white hover:imcrm-opacity-90',
        target === '' && 'imcrm-pointer-events-none imcrm-opacity-50',
    );
    const style = variant === 'outline' ? undefined : { background: ctx.theme.accent };
    if (action === 'copy') {
        return (
            <button type="button" className={cls} style={style} onClick={() => void navigator.clipboard?.writeText(target)}>
                {label}
            </button>
        );
    }
    return (
        <a href={href || undefined} target={action === 'url' ? '_blank' : undefined} rel="noreferrer" className={cls} style={style}>
            {label}
            {action === 'url' && <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5 imcrm-opacity-80" />}
        </a>
    );
}

function EmbedBlock({ block }: { block: LayoutBlock }): JSX.Element {
    const ctx = useLayoutCtx();
    const c = block.config;
    let url = typeof c.url === 'string' ? c.url : '';
    if (c.source === 'field') {
        const f = ctx.fieldsById.get(Number(c.field_id));
        const v = f ? ctx.values[f.slug] : undefined;
        url = typeof v === 'string' ? v : '';
    }
    const embed = resolveEmbed(url);
    if (!embed) {
        return (
            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                {url ? __('Ese enlace no se puede insertar (YouTube, Vimeo, Loom, Figma o Google Drive).') : __('Sin enlace para insertar.')}
            </p>
        );
    }
    return (
        <div className="imcrm-relative imcrm-w-full imcrm-overflow-hidden imcrm-rounded-lg" style={{ aspectRatio: '16 / 9', background: tint(ctx.theme.accent, 8) }}>
            <iframe
                src={embed.src}
                title={block.title ?? embed.provider}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                allow="fullscreen; picture-in-picture"
                loading="lazy"
                className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-border-0"
            />
        </div>
    );
}
