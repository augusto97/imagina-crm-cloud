import { z } from 'zod';
import { aggregateMetricSchema } from './aggregate';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Dashboards + widgets (CONTRACT.md §5). Los widgets se evalúan con el motor de
 * agregados. El `config` es permisivo (la UI del fork guarda varias opciones de
 * render); el backend usa las claves que necesita (metric, *_field_id, period,
 * filter_tree) y respeta el resto tal cual.
 */
export const widgetTypeSchema = z.enum([
    'kpi',
    'chart_bar',
    'chart_pie',
    'chart_line',
    'chart_area',
    'stat_delta',
    'table',
    'funnel',
    // v0.1.99 — medidor semicircular (progreso vs meta). Se evalúa igual
    // que un KPI (la meta vive en config y la aplica el front).
    'gauge',
    // v0.1.98 — bloques de CONTENIDO (no evalúan datos; el backend devuelve
    // {} y el front los renderiza desde su config): título, texto, imagen,
    // separador y espaciador. Convierten al dashboard en una página armable.
    'heading',
    'text',
    'image',
    'divider',
    'spacer',
]);
export type WidgetType = z.infer<typeof widgetTypeSchema>;

/** Tipos de widget que NO consumen datos (list_id 0, sin evaluación). */
export const CONTENT_WIDGET_TYPES: readonly WidgetType[] = [
    'heading',
    'text',
    'image',
    'divider',
    'spacer',
];

export const widgetLayoutSchema = z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
});

export const widgetSpecSchema = z.object({
    id: z.string().min(1),
    type: widgetTypeSchema,
    /** 0 = widget de contenido (sin lista). */
    list_id: z.number().int().nonnegative(),
    title: z.string().default(''),
    config: z.record(z.unknown()).default({}),
    layout: widgetLayoutSchema,
});
export type WidgetSpec = z.infer<typeof widgetSpecSchema>;

/**
 * Visibilidad por dashboard:
 *  - `workspace` (default): lo ve todo miembro interno (comportamiento previo).
 *  - `private`: sólo el creador (y el admin, que siempre ve todo).
 *  - `roles`: sólo los roles en `allowed_roles` (+ creador y admin).
 * El backend SIEMPRE filtra en list/get/widgets; la UI sólo pinta el selector.
 */
export const dashboardVisibilitySchema = z.enum(['workspace', 'private', 'roles']);
export type DashboardVisibility = z.infer<typeof dashboardVisibilitySchema>;

/**
 * Ajustes del dashboard (v0.1.98). `page` es el mismo shape declarativo que
 * los ajustes de página del portal ({bg, max_width, font}) — lo lee
 * `readPageSettings` en el front. Permisivo para claves futuras.
 */
export const dashboardSettingsSchema = z.record(z.unknown());

export const dashboardSchema = z.object({
    id: idSchema,
    user_id: idSchema.nullable(),
    name: z.string(),
    description: z.string().nullable(),
    widgets: z.array(widgetSpecSchema),
    settings: dashboardSettingsSchema.default({}),
    is_default: z.boolean(),
    position: z.number().int(),
    visibility: dashboardVisibilitySchema.default('workspace'),
    allowed_roles: z.array(z.string()).default([]),
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const createDashboardSchema = z.object({
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullable().optional(),
    widgets: z.array(widgetSpecSchema).default([]),
    settings: dashboardSettingsSchema.optional(),
    is_default: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
    visibility: dashboardVisibilitySchema.optional(),
    allowed_roles: z.array(z.string()).max(10).optional(),
});
export type CreateDashboardInput = z.infer<typeof createDashboardSchema>;

export const updateDashboardSchema = createDashboardSchema.partial();
export type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;

/** Métrica de widget = mismas del footer de agregados. */
export const widgetMetricSchema = aggregateMetricSchema;
