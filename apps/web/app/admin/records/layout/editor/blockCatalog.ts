import {
    AlignLeft,
    BarChart3,
    CalendarClock,
    ChartArea,
    ChartLine,
    ChartPie,
    CircleGauge,
    Columns3,
    FileText,
    Filter,
    FolderOpen,
    Gauge,
    GalleryHorizontalEnd,
    Heading,
    Image,
    Info,
    KanbanSquare,
    LayoutGrid,
    Link2,
    List,
    ListTree,
    MessageSquare,
    Minus,
    MousePointerClick,
    MoveVertical,
    PlayCircle,
    Rows3,
    Sigma,
    Table2,
    TextCursorInput,
    UserRound,
    Wallet,
    Activity,
    type LucideIcon,
} from 'lucide-react';
import type { LayoutBlock, LayoutBlockType, LayoutDataSource } from '@imagina-base/shared';

import type { RelationPath } from '@/hooks/useRelationPaths';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { newId } from './layoutOps';

/**
 * v0.1.231 — Lo que se puede agregar a la ficha, en el vocabulario de quien
 * diseña ("Dona", "Tablero por estado", "Cuenta regresiva"), no en el del
 * modelo. Varias entradas crean el MISMO tipo de bloque con otra forma de
 * arranque (un gráfico de barras y una dona son un bloque `chart`), así el
 * catálogo se lee como una galería y no como una lista de tipos técnicos.
 */
export type CatalogCategory = 'record' | 'data' | 'charts' | 'conversation' | 'content';

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
    record: __('Datos del registro'),
    data: __('Registros vinculados'),
    charts: __('Gráficos'),
    conversation: __('Conversación'),
    content: __('Contenido'),
};

export interface CatalogContext {
    fields: FieldEntity[];
    paths: RelationPath[];
    listId: number;
    /** v0.1.233 — qué se diseña: la ficha del equipo o el portal del cliente. */
    target?: 'record' | 'portal';
    /** Portal: listas vinculadas al cliente por un campo persona. */
    portalLists?: Array<{ list_id: number; name: string }>;
}

export interface CatalogEntry {
    key: string;
    type: LayoutBlockType;
    category: CatalogCategory;
    label: string;
    description: string;
    icon: LucideIcon;
    create: (ctx: CatalogContext) => LayoutBlock;
}

const SHORT: ReadonlySet<string> = new Set(['long_text', 'file', 'relation']);

/** La primera relación que toca la lista (la fuente natural de un gráfico). */
export function defaultSource(ctx: CatalogContext): LayoutDataSource {
    const p = ctx.paths[0];
    if (p) return { kind: 'related', field_id: p.relation_field_id, direction: p.direction };
    // En el portal no hay "toda la lista": lo suyo por persona, si existe.
    const mine = ctx.target === 'portal' ? ctx.portalLists?.[0] : undefined;
    return mine ? { kind: 'list', list_id: mine.list_id } : { kind: 'list', list_id: ctx.listId };
}

const block = (type: LayoutBlockType, config: Record<string, unknown> = {}, title?: string): LayoutBlock => ({
    id: newId(type),
    type,
    config,
    ...(title !== undefined ? { title } : {}),
});

const chart = (key: string, kind: string, label: string, description: string, icon: LucideIcon, extra: Record<string, unknown> = {}): CatalogEntry => ({
    key,
    type: 'chart',
    category: 'charts',
    label,
    description,
    icon,
    create: (ctx) => block('chart', { source: defaultSource(ctx), kind, metric: 'count', ...extra }, label),
});

const related = (key: string, view: string, label: string, description: string, icon: LucideIcon): CatalogEntry => ({
    key,
    type: 'related',
    category: 'data',
    label,
    description,
    icon,
    create: (ctx) => block('related', { source: defaultSource(ctx), view, limit: 25 }),
});

export const BLOCK_CATALOG: CatalogEntry[] = [
    // Datos del registro
    {
        key: 'fields',
        type: 'fields',
        category: 'record',
        label: __('Propiedades'),
        description: __('Varios campos editables, en lista o en grilla.'),
        icon: Rows3,
        create: (ctx) =>
            block('fields', { field_ids: ctx.fields.filter((f) => !SHORT.has(f.type)).slice(0, 6).map((f) => f.id), layout: 'grid', columns: 2 }, __('Detalles')),
    },
    {
        key: 'field',
        type: 'field',
        category: 'record',
        label: __('Un campo destacado'),
        description: __('Un campo con la forma que mejor lo muestra: cifra, anillo, cuenta regresiva…'),
        icon: TextCursorInput,
        create: (ctx) => {
            const f = ctx.fields.find((x) => ['currency', 'number', 'percent', 'rating'].includes(x.type)) ?? ctx.fields[0];
            return block('field', { field_id: f?.id, display: f?.type === 'percent' ? 'ring' : 'big', card: true });
        },
    },
    {
        key: 'stages',
        type: 'stages',
        category: 'record',
        label: __('Etapas'),
        description: __('Un estado como pasos clickeables.'),
        icon: ListTree,
        create: (ctx) => block('stages', { field_id: ctx.fields.find((f) => f.type === 'select')?.id }),
    },
    {
        key: 'description',
        type: 'description',
        category: 'record',
        label: __('Descripción'),
        description: __('El documento del registro, con el menú «/».'),
        icon: FileText,
        create: () => block('description'),
    },
    {
        key: 'files',
        type: 'files',
        category: 'record',
        label: __('Archivos'),
        description: __('Los archivos adjuntos del registro.'),
        icon: FolderOpen,
        create: (ctx) => block('files', { field_ids: ctx.fields.filter((f) => f.type === 'file').map((f) => f.id) }),
    },
    {
        key: 'record_stats',
        type: 'record_stats',
        category: 'record',
        label: __('Resumen de actividad'),
        description: __('Días en el sistema, cambios y comentarios.'),
        icon: Sigma,
        create: () => block('record_stats', { mode: 'auto' }),
    },
    // Vinculados
    related('related_table', 'table', __('Tabla de vinculados'), __('Los registros de otra lista vinculados a éste.'), Table2),
    related('related_cards', 'cards', __('Tarjetas'), __('Los vinculados como tarjetas.'), LayoutGrid),
    related('related_board', 'board', __('Tablero por estado'), __('Los vinculados en columnas por un select.'), KanbanSquare),
    related('related_timeline', 'timeline', __('Línea de tiempo'), __('Los vinculados ordenados por fecha.'), CalendarClock),
    related('related_list', 'list', __('Lista compacta'), __('Un renglón por vinculado.'), List),
    related('related_gallery', 'gallery', __('Galería'), __('Los vinculados por su imagen.'), GalleryHorizontalEnd),
    // Gráficos
    chart('chart_kpi', 'kpi', __('Indicador'), __('Una cifra: cantidad, suma o promedio.'), Gauge),
    chart('chart_bar', 'bar', __('Barras'), __('Comparar grupos.'), BarChart3),
    chart('chart_pie', 'pie', __('Dona'), __('Partes de un total.'), ChartPie),
    chart('chart_line', 'line', __('Líneas'), __('Evolución en el tiempo.'), ChartLine, { time_bucket: 'month' }),
    chart('chart_area', 'area', __('Área'), __('Evolución acumulada.'), ChartArea, { time_bucket: 'month' }),
    chart('chart_funnel', 'funnel', __('Embudo'), __('Etapas de un proceso.'), Filter),
    chart('chart_gauge', 'gauge', __('Medidor'), __('Avance contra una meta.'), CircleGauge, { goal: 100 }),
    chart('chart_table', 'table', __('Tabla resumen'), __('Los primeros N, ordenados.'), Table2, { limit: 5 }),
    // Conversación
    {
        key: 'activity',
        type: 'activity',
        category: 'conversation',
        label: __('Actividad y comentarios'),
        description: __('Todo lo que pasó con el registro.'),
        icon: Activity,
        create: () => block('activity', { mode: 'all' }),
    },
    {
        key: 'comments',
        type: 'comments',
        category: 'conversation',
        label: __('Comentarios'),
        description: __('Sólo la conversación.'),
        icon: MessageSquare,
        create: () => block('comments'),
    },
    {
        key: 'portal_access',
        type: 'portal_access',
        category: 'conversation',
        label: __('Acceso al portal'),
        description: __('Invitar al cliente a su portal.'),
        icon: UserRound,
        create: () => block('portal_access'),
    },
    {
        key: 'payments',
        type: 'payments',
        category: 'conversation',
        label: __('Cobros'),
        description: __('Links de pago (Mercado Pago / Wompi) y si ya pagó.'),
        icon: Wallet,
        create: () => block('payments'),
    },
    // Contenido
    { key: 'heading', type: 'heading', category: 'content', label: __('Título'), description: __('Un título de sección.'), icon: Heading, create: () => block('heading', { text: __('Nuevo título'), level: 2 }) },
    { key: 'text', type: 'text', category: 'content', label: __('Texto'), description: __('Texto con formato, fijo o de un campo.'), icon: AlignLeft, create: () => block('text', { source: 'literal', content: __('Escribí acá.') }) },
    { key: 'notice', type: 'notice', category: 'content', label: __('Aviso'), description: __('Un recordatorio destacado.'), icon: Info, create: () => block('notice', { tone: 'info', text: __('Un recordatorio para el equipo.') }) },
    { key: 'image', type: 'image', category: 'content', label: __('Imagen'), description: __('Subida o por enlace.'), icon: Image, create: () => block('image', { height: 220, fit: 'cover' }) },
    { key: 'gallery', type: 'gallery', category: 'content', label: __('Galería de imágenes'), description: __('Varias imágenes en grilla.'), icon: Columns3, create: () => block('gallery', { images: [], columns: 3, height: 160 }) },
    { key: 'button', type: 'button', category: 'content', label: __('Botón'), description: __('Abrir un enlace, escribir, llamar o copiar.'), icon: MousePointerClick, create: () => block('button', { label: __('Abrir'), action: 'url', target_source: 'literal', target: '' }) },
    { key: 'embed', type: 'embed', category: 'content', label: __('Video o documento'), description: __('YouTube, Loom, Figma, Google Drive…'), icon: PlayCircle, create: () => block('embed', { source: 'literal', url: '' }) },
    { key: 'link', type: 'button', category: 'content', label: __('Enlace de un campo'), description: __('Un botón que abre la URL guardada en el registro.'), icon: Link2, create: (ctx) => block('button', { label: __('Abrir'), action: 'url', target_source: 'field', target_field_id: ctx.fields.find((f) => f.type === 'url')?.id }) },
    { key: 'divider', type: 'divider', category: 'content', label: __('Divisor'), description: __('Una línea para separar.'), icon: Minus, create: () => block('divider') },
    { key: 'spacer', type: 'spacer', category: 'content', label: __('Espacio'), description: __('Aire entre bloques.'), icon: MoveVertical, create: () => block('spacer', { height: 24 }) },
];

export function catalogEntry(key: string): CatalogEntry | undefined {
    return BLOCK_CATALOG.find((e) => e.key === key);
}

/** Nombre humano de un bloque ya puesto (para el inspector y la estructura). */
export function blockLabel(b: LayoutBlock): string {
    if (b.type === 'chart') {
        return BLOCK_CATALOG.find((e) => e.type === 'chart' && e.key === `chart_${String(b.config.kind ?? 'kpi')}`)?.label ?? __('Gráfico');
    }
    if (b.type === 'related') {
        return BLOCK_CATALOG.find((e) => e.type === 'related' && e.key === `related_${String(b.config.view ?? 'table')}`)?.label ?? __('Vinculados');
    }
    return BLOCK_CATALOG.find((e) => e.type === b.type)?.label ?? b.type;
}

export function blockIcon(b: LayoutBlock): LucideIcon {
    if (b.type === 'chart') return BLOCK_CATALOG.find((e) => e.key === `chart_${String(b.config.kind ?? 'kpi')}`)?.icon ?? BarChart3;
    if (b.type === 'related') return BLOCK_CATALOG.find((e) => e.key === `related_${String(b.config.view ?? 'table')}`)?.icon ?? Table2;
    return BLOCK_CATALOG.find((e) => e.type === b.type)?.icon ?? LayoutGrid;
}
