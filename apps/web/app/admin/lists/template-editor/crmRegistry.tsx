import {
    Activity,
    BarChart3,
    Columns as ColumnsIcon,
    FileText,
    Hash,
    Heading as HeadingIcon,
    Image as ImageIcon,
    Layout,
    MessageSquare,
    Minus,
    MousePointerClick,
    Network,
    Paperclip,
    PieChart,
    Play,
    StickyNote,
    Tag,
} from 'lucide-react';

import { BlockRenderer } from '@/admin/records/crm/BlockRenderer';
import { resolveV2, type V2Block, type V2BlockType } from '@/lib/crmTemplates';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import {
    ActionButtonForm,
    ChartForm,
    CommentsThreadForm,
    DividerForm,
    EmbedForm,
    FilesForm,
    HeaderForm,
    HeadingForm,
    KpiForm,
    MarkdownForm,
    NotesForm,
    PropertiesGroupForm,
    RelatedForm,
    StatsForm,
} from './forms/BlockForms';
import { ImageBlockForm } from '@/admin/template-editor-core/ImageBlockForm';
import { createBlock as createBlockHelper } from './utils/createBlock';

import type {
    BlockRegistry,
    BlockTypeDef,
    PaletteCategory,
} from '@/admin/template-editor-core';

/**
 * Registry de bloques del editor de plantilla CRM, adaptado al
 * contrato genérico `BlockRegistry<V2Block>` del `TemplateEditorShell`.
 *
 * Esta capa permite que el shell genérico (compartido con el portal
 * del cliente) maneje el grid, drag-and-drop, selección, undo/redo,
 * fullscreen, hotkeys y paneles colapsables — sin necesidad de
 * duplicar nada de eso para CRM. Solo lo que es específico del CRM
 * (qué tipos de bloque existen, cómo se inspeccionan, cómo se
 * previsualizan, cómo se crean por defecto) vive acá.
 *
 * El equivalente para el portal del cliente está en
 * `app/admin/lists/portal-template-editor/portalRegistry.tsx`.
 */

const CATEGORIES: PaletteCategory[] = [
    { id: 'structure',     label: __('Estructura') },
    { id: 'data',          label: __('Datos') },
    { id: 'visualization', label: __('Visualización') },
    { id: 'layout',        label: __('Layout') },
    { id: 'content',       label: __('Contenido') },
    { id: 'actions',       label: __('Acciones') },
];

const TYPES: BlockTypeDef[] = [
    // Estructura
    {
        type: 'header',
        label: __('Encabezado'),
        description: __('Avatar, título, status pills y acciones. 1 por panel.'),
        icon: Layout,
        category: 'structure',
        singleton: true,
    },
    // Datos
    {
        type: 'properties_group',
        label: __('Grupo de propiedades'),
        description: __('Agrupa N campos del record con un nombre e icono.'),
        icon: Tag,
        category: 'data',
    },
    {
        type: 'related',
        label: __('Records relacionados'),
        description: __('Lista de records conectados vía relation field.'),
        icon: Network,
        category: 'data',
    },
    {
        type: 'files',
        label: __('Archivos'),
        description: __('Archivos adjuntos del record (file fields).'),
        icon: Paperclip,
        category: 'data',
    },
    // Visualización
    {
        type: 'kpi',
        label: __('KPI'),
        description: __('Número grande con label y meta opcional.'),
        icon: Hash,
        category: 'visualization',
    },
    {
        type: 'chart',
        label: __('Gráfico'),
        description: __('Distribución de relacionados por field destino.'),
        icon: PieChart,
        category: 'visualization',
    },
    {
        type: 'stats',
        label: __('Resumen'),
        description: __('Días, # comentarios, # cambios. 1 solo por panel.'),
        icon: BarChart3,
        category: 'visualization',
        singleton: true,
    },
    {
        type: 'timeline',
        label: __('Timeline'),
        description: __('Feed de actividad y comentarios. 1 solo por panel.'),
        icon: Activity,
        category: 'visualization',
        singleton: true,
    },
    // Layout
    {
        type: 'heading',
        label: __('Título de sección'),
        description: __('Heading h2/h3/h4 para agrupar visualmente.'),
        icon: HeadingIcon,
        category: 'layout',
    },
    {
        type: 'divider',
        label: __('Divisor'),
        description: __('Línea horizontal con label opcional centrado.'),
        icon: Minus,
        category: 'layout',
    },
    // Contenido
    {
        type: 'notes',
        label: __('Notas'),
        description: __('Texto custom static por lista. Recordatorios al operador.'),
        icon: StickyNote,
        category: 'content',
    },
    {
        type: 'markdown',
        label: __('Markdown'),
        description: __('Texto rich con headings, listas, negrita, links.'),
        icon: FileText,
        category: 'content',
    },
    {
        type: 'embed',
        label: __('Embed externo'),
        description: __('iframe: YouTube, Vimeo, Maps, Loom, Figma, Calendly.'),
        icon: Play,
        category: 'content',
    },
    {
        type: 'comments_thread',
        label: __('Hilo de comentarios'),
        description: __('Lista los comentarios del record. Interactivo en el panel real.'),
        icon: MessageSquare,
        category: 'content',
    },
    // Acciones
    {
        type: 'action_button',
        label: __('Botón de acción'),
        description: __('URL externa, mailto, tel o copiar al clipboard.'),
        icon: MousePointerClick,
        category: 'actions',
    },
    {
        type: 'image',
        label: __('Imagen'),
        description: __('Imagen subida o por URL, con alto, ajuste y enlace opcional.'),
        icon: ImageIcon,
        category: 'content',
    },
    // Estructura
    {
        type: 'nested_section',
        label: __('Sub-sección con columnas'),
        description: __('Contenedor con N sub-columnas adentro de la columna actual. Permite armar columnas dentro de columnas.'),
        icon: ColumnsIcon,
        category: 'content',
    },
];

const LABEL_BY_TYPE: Record<V2BlockType, string> = {
    header:           __('Encabezado'),
    properties_group: __('Grupo de propiedades'),
    notes:            __('Notas'),
    related:          __('Records relacionados'),
    timeline:         __('Timeline'),
    stats:            __('Resumen'),
    kpi:              __('KPI'),
    chart:            __('Gráfico'),
    files:            __('Archivos'),
    embed:            __('Embed externo'),
    action_button:    __('Botón de acción'),
    markdown:         __('Markdown'),
    divider:          __('Divisor'),
    heading:          __('Título de sección'),
    comments_thread:  __('Hilo de comentarios'),
    nested_section:   __('Sub-sección con columnas'),
    image:            __('Imagen'),
};

const DESC_BY_TYPE: Record<V2BlockType, string> = {
    header:           __('Avatar, título, status pills y acciones del registro.'),
    properties_group: __('Nombre, icono y campos de este grupo.'),
    notes:            __('Texto custom static por lista.'),
    related:          __('Relation field a renderear.'),
    timeline:         __('Feed de actividad y comentarios.'),
    stats:            __('Resumen del record (sin opciones).'),
    kpi:              __('Número grande con label y meta.'),
    chart:            __('Distribución de relacionados.'),
    files:            __('Archivos adjuntos del record.'),
    embed:            __('iframe externo (whitelist).'),
    action_button:    __('URL, mailto, tel o copy.'),
    markdown:         __('Texto rich con markdown ligero.'),
    divider:          __('Línea horizontal con label opcional.'),
    heading:          __('Título de sección con nivel jerárquico.'),
    comments_thread:  __('Hilo de comentarios del record.'),
    nested_section:   __('Contenedor con N sub-columnas anidadas adentro de otra columna.'),
    image:            __('Imagen subida al módulo de archivos o por URL externa.'),
};

/**
 * Implementa el form del inspector para cada tipo de bloque CRM.
 * Cada form tiene una signature levemente distinta (algunas reciben
 * `fields`, otras no) — switcheamos acá para mantener type safety.
 */
function renderInspectorForBlock(
    block: V2Block,
    fields: FieldEntity[],
    onUpdate: (patch: Partial<V2Block>) => void,
): JSX.Element {
    // `as Partial<V2Block>` está justificado: cada form trabaja con
    // su subtype y devuelve un patch del subtype, que es subset de
    // `Partial<V2Block>`. TypeScript no puede inferirlo del union.
    const update = (patch: unknown): void =>
        onUpdate(patch as Partial<V2Block>);

    switch (block.type) {
        case 'header':
            return <HeaderForm block={block} onUpdate={update} />;
        case 'properties_group':
            return <PropertiesGroupForm block={block} fields={fields} onUpdate={update} />;
        case 'notes':
            return <NotesForm block={block} fields={fields} onUpdate={update} />;
        case 'related':
            return <RelatedForm block={block} fields={fields} onUpdate={update} />;
        case 'timeline':
            return (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-4 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Este bloque no tiene opciones configurables. Movelo o cambiá su tamaño con el grid.')}
                </p>
            );
        case 'stats':
            return <StatsForm block={block} fields={fields} onUpdate={update} />;
        case 'kpi':
            return <KpiForm block={block} fields={fields} onUpdate={update} />;
        case 'chart':
            return <ChartForm block={block} fields={fields} onUpdate={update} />;
        case 'files':
            return <FilesForm block={block} fields={fields} onUpdate={update} />;
        case 'embed':
            return <EmbedForm block={block} fields={fields} onUpdate={update} />;
        case 'action_button':
            return <ActionButtonForm block={block} fields={fields} onUpdate={update} />;
        case 'markdown':
            return <MarkdownForm block={block} fields={fields} onUpdate={update} />;
        case 'divider':
            return <DividerForm block={block} onUpdate={update} />;
        case 'heading':
            return <HeadingForm block={block} onUpdate={update} />;
        case 'comments_thread':
            return <CommentsThreadForm block={block} onUpdate={update} />;
        case 'image':
            return (
                <ImageBlockForm
                    config={block.config as Record<string, unknown>}
                    onConfigChange={(config) => update({ config })}
                />
            );
        case 'nested_section':
            // Las sub-columnas y sub-bloques se gestionan EN EL CANVAS
            // (drag desde paleta, ↑/↓/× en cada sub-bloque, dropdown
            // de ancho en cada sub-columna). Acá solo mostramos
            // instrucciones.
            return (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Gestioná las sub-columnas y los sub-bloques directamente en el canvas: arrastrá bloques de la paleta a las sub-columnas, click en un sub-bloque para editar sus opciones, y usá los botones ↑/↓/× del sub-bloque para reordenar o eliminar.')}
                </p>
            );
    }
}

export const crmRegistry: BlockRegistry<V2Block> = {
    types: TYPES,
    categories: CATEGORIES,

    createBlock: (type, existing, ctx, position) => {
        const known = TYPES.find((t) => t.type === type);
        if (! known) return null;
        return createBlockHelper(type as V2BlockType, ctx.fields, existing, position);
    },

    createBlockErrorMessage: (type) => {
        if (type === 'related') {
            return __('Para agregar este bloque necesitás un field tipo "relation" en la lista.');
        }
        return __('No se pudo agregar el bloque %s').replace('%s', type);
    },

    renderInspector: (block, ctx, onUpdate) => {
        return renderInspectorForBlock(block, ctx.fields, onUpdate);
    },

    renderPreview: (block, ctx) => {
        // `BlockRenderer` espera un `ResolvedV2Block` (config con keys
        // camelCase, resuelto desde el shape snake_case persistido).
        // Llamamos `resolveV2` con un wrapper mínimo y BUSCAMOS por ID
        // — NO por índice. `resolveV2` inyecta un `header` sintético al
        // tope si el config no contiene uno (backward-compat para
        // plantillas v2 viejas), así que `blocks[0]` para un bloque
        // distinto a `header` sería el header sintético, no el bloque
        // que queremos renderear.
        const resolved = resolveV2(
            {
                v: 2,
                header: {
                    subtitle_field_slugs: [],
                    status_field_slugs: [],
                    quick_action_field_slugs: [],
                },
                blocks: [block],
            },
            ctx.fields,
        );
        const resolvedBlock = resolved.blocks.find((b) => b.id === block.id);
        if (! resolvedBlock) return <></>;

        const record = ctx.record ?? {
            id: 0,
            fields: {} as Record<string, unknown>,
            relations: {} as Record<string, number[]>,
            created_at: '',
            updated_at: '',
            created_by: 0,
        };
        return (
            <BlockRenderer
                block={resolvedBlock}
                listId={ctx.listId}
                recordId={record.id}
                currentUserId={0}
                isAdmin={false}
                values={record.fields}
                onChange={() => undefined}
                record={record}
            />
        );
    },

    labelForType: (type) => LABEL_BY_TYPE[type as V2BlockType] ?? type,
    descriptionForType: (type) => DESC_BY_TYPE[type as V2BlockType] ?? '',

    // Tab "Campos" en la paleta — drag de un field crea un
    // properties_group con ese field pre-seleccionado.
    fieldAsBlock: {
        createBlock: (field, existing, position) => {
            const id = `properties_group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const fallbackY = existing.reduce((m, b) => Math.max(m, b.y + b.h), 0);
            return {
                id,
                type: 'properties_group',
                x: position?.x ?? 0,
                y: position?.y ?? fallbackY,
                w: 4,
                h: 3,
                config: {
                    label: field.label,
                    icon_key: 'database',
                    field_slugs: [field.slug],
                    collapsed_by_default: false,
                },
            };
        },
    },

    // Drop de un field sobre un properties_group existente lo agrega
    // al `field_slugs` del grupo.
    fieldDrop: {
        handle: (block, slug) => {
            if (block.type !== 'properties_group') return null;
            const slugs = (block.config.field_slugs as string[] | undefined) ?? [];
            if (slugs.includes(slug)) {
                return { block, alreadyPresent: true };
            }
            return {
                block: {
                    ...block,
                    config: {
                        ...block.config,
                        field_slugs: [...slugs, slug],
                    },
                },
                alreadyPresent: false,
            };
        },
    },
};
