import { z } from 'zod';
import { idSchema } from './common';

/**
 * v0.1.195 — configuración de la lista que vive en `list.settings` y que
 * hasta acá NO tenía schema: el portal del cliente (habilitado, listas
 * relacionadas y la plantilla de bloques) y el layout de la ficha del
 * registro (formulario clásico o layout CRM por plantilla / personalizado).
 *
 * Los editores visuales del front (portal-template-editor y
 * template-editor) siguen escribiendo estas claves tal cual; estos schemas
 * son la versión VALIDABLE del mismo shape, para que el asistente y el MCP
 * puedan proponer la configuración por lenguaje natural sin inventar
 * claves. Son tolerantes a propósito (`passthrough` en los `config`): un
 * bloque guardado por el editor trae claves de estilo (`style`, `variant`,
 * `accent_color`) que acá no se enumeran.
 */

// ── Portal del cliente ───────────────────────────────────────────────────

/** Los 21 tipos de bloque del editor del portal (`portalRegistry`). */
export const PORTAL_BLOCK_TYPES = [
    'hero',
    'heading',
    'divider',
    'notice',
    'spacer',
    'nested_section',
    'client_data',
    'related_records_table',
    'kpi_widget',
    'stats_grid',
    'editable_form',
    'comments_thread',
    'activity_timeline',
    'download_files',
    'static_text',
    'image',
    'gallery',
    'external_link',
    'quick_actions',
    'faq',
    'contact_card',
] as const;
export const portalBlockTypeSchema = z.enum(PORTAL_BLOCK_TYPES);
export type PortalBlockType = z.infer<typeof portalBlockTypeSchema>;

/**
 * Un bloque tal como lo persiste el editor. `x/y/w/h` son coordenadas del
 * grid de 12 columnas; si faltan, el editor y el portal los completan
 * apilando a lo ancho (mismo criterio que `resolvePortalBlocks`).
 */
export const portalTemplateBlockSchema = z
    .object({
        id: z.string().min(1).max(80),
        type: portalBlockTypeSchema,
        config: z.record(z.unknown()).default({}),
        x: z.number().int().min(0).max(11).optional(),
        y: z.number().int().min(0).optional(),
        w: z.number().int().min(1).max(12).optional(),
        h: z.number().int().min(1).optional(),
    })
    .passthrough();
export type PortalTemplateBlock = z.infer<typeof portalTemplateBlockSchema>;

/** `settings.portal_template` — `{ blocks, page? }` (el array plano es legacy). */
export const portalTemplateSchema = z
    .object({
        blocks: z.array(portalTemplateBlockSchema).max(80),
        /** v0.1.94 — ajustes de página del portal (fondo, ancho, tipografía). Opaco acá. */
        page: z.record(z.unknown()).optional(),
    })
    .passthrough();
export type PortalTemplate = z.infer<typeof portalTemplateSchema>;

/** `settings.portal` — lo que escribe el panel "Portal" de la lista. */
export const portalSettingsSchema = z
    .object({
        enabled: z.boolean().default(false),
        owner_field_id: idSchema.nullable().default(null),
        default_template_id: idSchema.nullable().default(null),
        /** Ids de las listas relacionadas que el cliente ve además de su ficha (opt-in). */
        related_lists: z.array(idSchema).default([]),
    })
    .passthrough();
export type PortalSettings = z.infer<typeof portalSettingsSchema>;

// ── Layout de la ficha del registro ──────────────────────────────────────

export const RECORD_LAYOUTS = ['classic', 'crm'] as const;
export const recordLayoutSchema = z.enum(RECORD_LAYOUTS);
export type RecordLayout = z.infer<typeof recordLayoutSchema>;

/** Plantillas CRM integradas (`crmTemplates.ts`) + `custom` (la del editor). */
export const CRM_TEMPLATE_IDS = ['auto', 'contact', 'deal', 'task', 'support', 'custom'] as const;
export const crmTemplateIdSchema = z.enum(CRM_TEMPLATE_IDS);
export type CrmTemplateId = z.infer<typeof crmTemplateIdSchema>;

/** Iconos disponibles para un grupo de propiedades (`SIDEBAR_ICON_OPTIONS`). */
export const CRM_GROUP_ICON_KEYS = [
    'mail',
    'building',
    'tag',
    'briefcase',
    'dollar',
    'calendar',
    'user',
    'circle_user',
    'sticky_note',
    'target',
    'lifebuoy',
    'database',
] as const;
export const crmGroupIconKeySchema = z.enum(CRM_GROUP_ICON_KEYS);

/** Los tipos de bloque del editor de la ficha (V2, `crmRegistry`). */
export const CRM_BLOCK_TYPES = [
    'header',
    'properties_group',
    'timeline',
    'stats',
    'related',
    'notes',
    'kpi',
    'chart',
    'files',
    'embed',
    'action_button',
    'markdown',
    'divider',
    'heading',
    'comments_thread',
    'nested_section',
    'image',
    'spacer',
    'gallery',
] as const;
export const crmBlockTypeSchema = z.enum(CRM_BLOCK_TYPES);
export type CrmBlockType = z.infer<typeof crmBlockTypeSchema>;

/**
 * Bloque V2 de la ficha: grid de 12 columnas (`x` = columna de inicio,
 * `y` = fila, `w` = ancho, `h` = alto — legacy pero obligatorio en el
 * shape persistido; `pos` apila dentro de la misma columna).
 */
export const crmBlockSchema = z
    .object({
        id: z.string().min(1).max(80),
        type: crmBlockTypeSchema,
        x: z.number().int().min(0).max(11),
        y: z.number().int().min(0),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1),
        pos: z.number().int().min(0).optional(),
        config: z.record(z.unknown()).default({}),
    })
    .passthrough();
export type CrmBlock = z.infer<typeof crmBlockSchema>;

/** `settings.crm_template_custom` — la plantilla personalizada (V2). */
export const crmCustomConfigSchema = z
    .object({
        v: z.literal(2),
        header: z
            .object({
                title_field_slug: z.string().optional(),
                subtitle_field_slugs: z.array(z.string()).default([]),
                status_field_slugs: z.array(z.string()).default([]),
                quick_action_field_slugs: z.array(z.string()).default([]),
            })
            .passthrough(),
        blocks: z.array(crmBlockSchema).max(80),
    })
    .passthrough();
export type CrmCustomConfig = z.infer<typeof crmCustomConfigSchema>;

/**
 * Lectura tolerante del layout guardado en `settings`: nunca lanza —
 * devuelve `classic` con `auto` si falta o no valida.
 */
export function readRecordLayout(settings: Record<string, unknown> | null | undefined): {
    layout: RecordLayout;
    template: CrmTemplateId;
    custom: CrmCustomConfig | null;
} {
    const s = settings ?? {};
    const layout = recordLayoutSchema.safeParse(s.record_layout);
    const template = crmTemplateIdSchema.safeParse(s.crm_template_id);
    const custom = crmCustomConfigSchema.safeParse(s.crm_template_custom);
    return {
        layout: layout.success ? layout.data : 'classic',
        template: template.success ? template.data : 'auto',
        custom: custom.success ? custom.data : null,
    };
}

/** Lectura tolerante de `settings.portal` + `settings.portal_template`. */
export function readPortalConfig(settings: Record<string, unknown> | null | undefined): {
    portal: PortalSettings;
    template: PortalTemplate | null;
} {
    const s = settings ?? {};
    const portal = portalSettingsSchema.safeParse(s.portal ?? {});
    const raw = s.portal_template;
    const template = portalTemplateSchema.safeParse(Array.isArray(raw) ? { blocks: raw } : raw);
    return {
        portal: portal.success ? portal.data : portalSettingsSchema.parse({}),
        template: template.success ? template.data : null,
    };
}
