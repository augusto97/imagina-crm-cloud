/**
 * Tipos del shape `settings.portal` y `settings.portal_template`
 * (Fase 9). Espejo del PHP `PortalConfig` y `PortalTemplate`.
 */

export interface PortalSettings {
    enabled: boolean;
    owner_field_id: number | null;
    default_template_id: number | null;
}

export const PORTAL_DEFAULTS: PortalSettings = {
    enabled: false,
    owner_field_id: null,
    default_template_id: null,
};

export type PortalBlockType =
    | 'client_data'
    | 'related_records_table'
    | 'static_text'
    | 'editable_form'
    | 'external_link'
    | 'kpi_widget'
    | 'activity_timeline'
    | 'download_files'
    | 'comments_thread'
    // 0.57.0 — bloques de UX/jerarquía visual
    | 'heading'
    | 'hero'
    | 'stats_grid'
    | 'quick_actions'
    | 'notice'
    | 'divider'
    | 'faq'
    | 'contact_card'
    // 0.57.27 — anidamiento de columnas (1 nivel)
    | 'nested_section'
    // v0.1.93 — bloque de imagen (upload propio o URL externa)
    | 'image'
    // v0.1.94 — espaciador y galería de imágenes
    | 'spacer'
    | 'gallery';

export const PORTAL_BLOCK_TYPES: Array<{ value: PortalBlockType; label: string }> = [
    { value: 'heading', label: 'Título de sección' },
    { value: 'hero', label: 'Hero (saludo destacado)' },
    { value: 'static_text', label: 'Texto / HTML' },
    { value: 'notice', label: 'Aviso / Alerta' },
    { value: 'divider', label: 'Divisor' },
    { value: 'client_data', label: 'Datos del cliente' },
    { value: 'editable_form', label: 'Formulario editable' },
    { value: 'related_records_table', label: 'Tabla de registros relacionados' },
    { value: 'kpi_widget', label: 'KPI / métrica' },
    { value: 'stats_grid', label: 'Grid de estadísticas' },
    { value: 'external_link', label: 'Enlace externo (CTA)' },
    { value: 'quick_actions', label: 'Acciones rápidas' },
    { value: 'activity_timeline', label: 'Timeline de actividad' },
    { value: 'download_files', label: 'Archivos descargables' },
    { value: 'comments_thread', label: 'Hilo de comentarios' },
    { value: 'faq', label: 'Preguntas frecuentes' },
    { value: 'contact_card', label: 'Tarjeta de contacto' },
    { value: 'nested_section', label: 'Sub-sección con columnas' },
    { value: 'image', label: 'Imagen' },
    { value: 'spacer', label: 'Espaciador' },
    { value: 'gallery', label: 'Galería de imágenes' },
];

export interface PortalTemplateBlock {
    type: PortalBlockType;
    config: Record<string, unknown>;
    /**
     * Posicionamiento en grid 12-col (Fase 9 — pulido grid editor).
     * Si están ausentes, el renderer asume layout vertical en orden
     * de declaración y auto-asigna posiciones full-width (x=0, w=12).
     * Backward-compat: templates antiguos siguen funcionando idénticos.
     */
    id?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
}

export interface PortalTemplate {
    blocks: PortalTemplateBlock[];
}
