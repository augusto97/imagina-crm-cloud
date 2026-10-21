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
    /**
     * v0.1.286 — alto PROPIO en el celular (apilado a una columna). Sin él,
     * redimensionar en el teléfono cambiaba el `h` del escritorio.
     */
    hm: z.number().int().positive().max(100).optional(),
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

/** v0.1.286 — Reordenar los tableros del menú (posición = índice). */
export const reorderDashboardsSchema = z.object({
    ids: z.array(idSchema).min(1).max(500),
});
export type ReorderDashboardsInput = z.infer<typeof reorderDashboardsSchema>;

/**
 * v0.1.286 — Filtros a nivel TABLERO (Responsable, Estado, "Yo"…). El tablero
 * declara en `settings.filters` qué campos se pueden filtrar
 * (`dashboardFilterDefSchema`); quien mira elige un valor y viaja en el body
 * del bundle (como el período global). Cada valor se aplica a TODOS los
 * widgets cuya lista tiene ese campo — los ids de campo son únicos, así que el
 * campo ya dice a qué lista pertenece.
 */
export const dashboardFilterDefSchema = z.object({
    list_id: idSchema,
    field_id: idSchema,
});
export type DashboardFilterDef = z.infer<typeof dashboardFilterDefSchema>;

/** Valor especial de un filtro por persona: quien está mirando. */
export const DASHBOARD_FILTER_ME = 'me';

export const dashboardFilterValueSchema = z.object({
    field_id: idSchema,
    /** Valor de la opción, id de persona (o `"me"`), true/false o texto. */
    value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500)).max(50)]),
});
export type DashboardFilterValue = z.infer<typeof dashboardFilterValueSchema>;

/** Body del bundle de un tablero (POST /dashboards/:id/widgets/data). */
export const dashboardBundleRequestSchema = z.object({
    period_preset: z.string().max(64).optional(),
    filters: z.array(dashboardFilterValueSchema).max(10).optional(),
});
export type DashboardBundleRequest = z.infer<typeof dashboardBundleRequestSchema>;

/** v0.1.286 — Vista previa de un widget SIN guardar (el diálogo de edición). */
export const widgetPreviewRequestSchema = dashboardBundleRequestSchema.extend({
    widget: widgetSpecSchema,
});
export type WidgetPreviewRequest = z.infer<typeof widgetPreviewRequestSchema>;

/** Métrica de widget = mismas del footer de agregados. */
export const widgetMetricSchema = aggregateMetricSchema;
