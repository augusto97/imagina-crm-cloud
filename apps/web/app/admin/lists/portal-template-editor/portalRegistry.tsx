import {
    Activity,
    AlertCircle,
    Columns as ColumnsIcon,
    Download,
    ExternalLink as ExternalLinkIcon,
    FileText,
    Grid3x3,
    HeadphonesIcon,
    Heading as HeadingIcon,
    HelpCircle,
    Image as ImageIcon,
    LayoutTemplate,
    MessageSquare,
    Minus,
    MousePointerClick,
    PenLine,
    Table,
    TrendingUp,
    User as UserIcon,
} from 'lucide-react';

import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { PortalBlockType } from '@/types/portal';

import type {
    BaseTemplateBlock,
    BlockRegistry,
    BlockTypeDef,
    PaletteCategory,
} from '@/admin/template-editor-core';

import { PortalBlockForm } from './PortalBlockForms';
import { PortalBlockLivePreview } from './PortalBlockLivePreview';
import { defaultConfigFor, defaultHeightFor, defaultWidthFor } from './portalLayout';

/** Bloque del portal compatible con el shape genérico del editor core. */
export interface PortalEditorBlock extends BaseTemplateBlock {
    type: PortalBlockType;
}

const CATEGORIES: PaletteCategory[] = [
    { id: 'layout', label: __('Estructura') },
    { id: 'data', label: __('Datos') },
    { id: 'input', label: __('Entrada') },
    { id: 'display', label: __('Visualización') },
    { id: 'content', label: __('Contenido') },
    { id: 'help', label: __('Soporte') },
];

const TYPES: BlockTypeDef[] = [
    // Estructura
    {
        type: 'hero',
        label: __('Hero'),
        description: __('Saludo destacado con título grande, subtítulo y CTA opcional.'),
        icon: LayoutTemplate,
        category: 'layout',
    },
    {
        type: 'heading',
        label: __('Título de sección'),
        description: __('Heading h1/h2/h3 con eyebrow y alineación configurable.'),
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
    {
        type: 'notice',
        label: __('Aviso / Alerta'),
        description: __('Banner info/success/warning/error con icono y CTA opcional.'),
        icon: AlertCircle,
        category: 'layout',
    },
    {
        type: 'nested_section',
        label: __('Sub-sección con columnas'),
        description: __('Contenedor con N columnas anidadas adentro de otra columna.'),
        icon: ColumnsIcon,
        category: 'layout',
    },
    // Datos
    {
        type: 'client_data',
        label: __('Datos del cliente'),
        description: __('Muestra los datos del record del cliente como lista o cards.'),
        icon: UserIcon,
        category: 'data',
    },
    {
        type: 'related_records_table',
        label: __('Tabla relacionada'),
        description: __('Records conectados vía relation field con tabla o lista compacta.'),
        icon: Table,
        category: 'data',
    },
    {
        type: 'kpi_widget',
        label: __('KPI / métrica'),
        description: __('Número grande con label. Útil para totales y cuentas.'),
        icon: TrendingUp,
        category: 'data',
    },
    {
        type: 'stats_grid',
        label: __('Grid de estadísticas'),
        description: __('Varias métricas (2-4) en un solo bloque compacto.'),
        icon: Grid3x3,
        category: 'data',
    },
    // Entrada
    {
        type: 'editable_form',
        label: __('Formulario editable'),
        description: __('El cliente actualiza sus propios datos vía formulario.'),
        icon: PenLine,
        category: 'input',
    },
    {
        type: 'comments_thread',
        label: __('Hilo de comentarios'),
        description: __('Conversación cliente ↔ operador.'),
        icon: MessageSquare,
        category: 'input',
    },
    // Visualización
    {
        type: 'activity_timeline',
        label: __('Timeline de actividad'),
        description: __('Cronología de cambios recientes del record.'),
        icon: Activity,
        category: 'display',
    },
    {
        type: 'download_files',
        label: __('Archivos descargables'),
        description: __('Adjuntos del record disponibles para descarga.'),
        icon: Download,
        category: 'display',
    },
    // Contenido
    {
        type: 'static_text',
        label: __('Texto / HTML'),
        description: __('Bienvenida, instrucciones, anuncios — HTML básico.'),
        icon: FileText,
        category: 'content',
    },
    {
        type: 'image',
        label: __('Imagen'),
        description: __('Imagen subida o por URL, con alto, ajuste y enlace opcional.'),
        icon: ImageIcon,
        category: 'content',
    },
    {
        type: 'external_link',
        label: __('Enlace externo'),
        description: __('CTA a URL externa (pagos, soporte, docs).'),
        icon: ExternalLinkIcon,
        category: 'content',
    },
    {
        type: 'quick_actions',
        label: __('Acciones rápidas'),
        description: __('Grid de N acciones con icono + label + URL.'),
        icon: MousePointerClick,
        category: 'content',
    },
    // Soporte
    {
        type: 'faq',
        label: __('Preguntas frecuentes'),
        description: __('Acordeón Q&A colapsable.'),
        icon: HelpCircle,
        category: 'help',
    },
    {
        type: 'contact_card',
        label: __('Tarjeta de contacto'),
        description: __('Asesor con avatar + nombre + email/teléfono/WhatsApp.'),
        icon: HeadphonesIcon,
        category: 'help',
    },
];

const LABEL_BY_TYPE: Record<PortalBlockType, string> = {
    static_text:            __('Texto / HTML'),
    client_data:            __('Datos del cliente'),
    related_records_table:  __('Tabla relacionada'),
    editable_form:          __('Formulario editable'),
    external_link:          __('Enlace externo'),
    kpi_widget:             __('KPI / métrica'),
    activity_timeline:      __('Timeline de actividad'),
    download_files:         __('Archivos descargables'),
    comments_thread:        __('Hilo de comentarios'),
    heading:                __('Título de sección'),
    hero:                   __('Hero'),
    stats_grid:             __('Grid de estadísticas'),
    quick_actions:          __('Acciones rápidas'),
    notice:                 __('Aviso / Alerta'),
    divider:                __('Divisor'),
    faq:                    __('Preguntas frecuentes'),
    contact_card:           __('Tarjeta de contacto'),
    nested_section:         __('Sub-sección con columnas'),
    image:                  __('Imagen'),
};

const DESC_BY_TYPE: Record<PortalBlockType, string> = {
    static_text:            __('Texto custom con HTML básico para bienvenidas e instrucciones.'),
    client_data:            __('Datos del cliente como lista de definiciones o cards.'),
    related_records_table:  __('Tabla de records conectados vía relation field.'),
    editable_form:          __('Formulario que el cliente puede editar para actualizar sus datos.'),
    external_link:          __('CTA a URL externa (pagos, soporte, etc.).'),
    kpi_widget:             __('Métrica destacada como número grande con label.'),
    activity_timeline:      __('Cronología de cambios recientes del record.'),
    download_files:         __('Adjuntos del record disponibles para descarga.'),
    comments_thread:        __('Conversación cliente ↔ operador.'),
    heading:                __('Heading con eyebrow opcional, alineación y color de acento.'),
    hero:                   __('Saludo destacado con título grande, subtítulo y CTA opcional.'),
    stats_grid:             __('Varias métricas (2-4) en un solo bloque compacto.'),
    quick_actions:          __('Grid de N acciones con icono, label y URL.'),
    notice:                 __('Banner alerta info/success/warning/error con icono y CTA opcional.'),
    divider:                __('Línea horizontal con label opcional centrado.'),
    faq:                    __('Acordeón Q&A — preguntas frecuentes colapsables.'),
    contact_card:           __('Tarjeta del asesor con avatar, nombre y datos de contacto.'),
    nested_section:         __('Contenedor con N columnas anidadas dentro de otra columna. Permite layouts de columnas dentro de columnas.'),
    image:                  __('Imagen subida al módulo de archivos o por URL externa, con alto, ajuste y enlace opcional.'),
};

function makeId(type: string): string {
    return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const portalRegistry: BlockRegistry<PortalEditorBlock> = {
    types: TYPES,
    categories: CATEGORIES,

    createBlock: (type, existing, _ctx, position) => {
        // Solo aceptamos types que están en nuestro union — sino sería
        // un type del CRM por error.
        const known = TYPES.find((t) => t.type === type);
        if (! known) return null;
        const blockType = type as PortalBlockType;
        const w = defaultWidthFor(blockType);
        // 0.57.23 — `y` es índice de fila. Append al final = max(y)+1.
        const maxY = existing.reduce((m, b) => Math.max(m, b.y ?? 0), -1);
        const fallbackY = maxY + 1;
        return {
            id: makeId(blockType),
            type: blockType,
            config: defaultConfigFor(blockType),
            x: position?.x ?? 0,
            y: position?.y ?? fallbackY,
            pos: position?.pos ?? 0,
            w,
            h: 0,
        };
    },

    createBlockErrorMessage: (type) => {
        return __('No se reconoce el tipo de bloque: %s').replace('%s', type);
    },

    renderInspector: (block, ctx, onUpdate) => {
        return (
            <PortalBlockForm
                block={block}
                fields={ctx.fields}
                onConfigChange={(config) => onUpdate({ config } as Partial<PortalEditorBlock>)}
            />
        );
    },

    renderPreview: (block, ctx) => {
        return <PortalBlockLivePreview block={block} fields={ctx.fields} />;
    },

    labelForType: (type) => LABEL_BY_TYPE[type as PortalBlockType] ?? type,
    descriptionForType: (type) => DESC_BY_TYPE[type as PortalBlockType] ?? '',
};

/** Helper para serializar PortalEditorBlock al shape del template guardado. */
export function blocksToPortalTemplate(
    blocks: PortalEditorBlock[],
): { blocks: Array<{ id: string; type: PortalBlockType; config: Record<string, unknown>; x: number; y: number; w: number; h: number }> } {
    return {
        blocks: blocks.map((b) => ({
            id: b.id,
            type: b.type,
            config: b.config,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
        })),
    };
}

/** Deserializa template del backend al shape del editor (rellena id/posiciones). */
export function portalTemplateToBlocks(rawBlocks: unknown): PortalEditorBlock[] {
    if (! Array.isArray(rawBlocks)) return [];
    const out: PortalEditorBlock[] = [];
    let cursorY = 0;
    rawBlocks.forEach((b, idx) => {
        if (! b || typeof b !== 'object') return;
        const obj = b as Record<string, unknown>;
        const type = obj.type;
        if (typeof type !== 'string') return;
        if (! TYPES.find((t) => t.type === type)) return;
        const blockType = type as PortalBlockType;
        const id = typeof obj.id === 'string' && obj.id !== ''
            ? obj.id
            : makeId(blockType);
        const config = typeof obj.config === 'object' && obj.config !== null
            ? (obj.config as Record<string, unknown>)
            : defaultConfigFor(blockType);
        const h = typeof obj.h === 'number' && obj.h > 0 ? obj.h : defaultHeightFor(blockType);
        const w = typeof obj.w === 'number' && obj.w > 0 ? obj.w : defaultWidthFor(blockType);
        const x = typeof obj.x === 'number' && obj.x >= 0 ? obj.x : 0;
        const yProvided = typeof obj.y === 'number' && obj.y >= 0;
        const y = yProvided ? (obj.y as number) : cursorY;
        out.push({ id, type: blockType, config, x, y, w, h });
        cursorY = yProvided ? Math.max(cursorY, y + h) : y + h;
        void idx;
    });
    return out;
}

/** Helper para que el FieldEntity sea aceptable como input al picker — útil si en futuro agregamos field-as-block al portal. */
export function isFieldPickableForPortal(field: FieldEntity): boolean {
    return field.type !== 'relation' && field.type !== 'file';
}
