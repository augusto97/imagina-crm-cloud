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
]);
export type WidgetType = z.infer<typeof widgetTypeSchema>;

export const widgetLayoutSchema = z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
});

export const widgetSpecSchema = z.object({
    id: z.string().min(1),
    type: widgetTypeSchema,
    list_id: idSchema,
    title: z.string().default(''),
    config: z.record(z.unknown()).default({}),
    layout: widgetLayoutSchema,
});
export type WidgetSpec = z.infer<typeof widgetSpecSchema>;

export const dashboardSchema = z.object({
    id: idSchema,
    user_id: idSchema.nullable(),
    name: z.string(),
    description: z.string().nullable(),
    widgets: z.array(widgetSpecSchema),
    is_default: z.boolean(),
    position: z.number().int(),
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const createDashboardSchema = z.object({
    name: z.string().trim().min(1).max(190),
    description: z.string().max(2000).nullable().optional(),
    widgets: z.array(widgetSpecSchema).default([]),
    is_default: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
});
export type CreateDashboardInput = z.infer<typeof createDashboardSchema>;

export const updateDashboardSchema = createDashboardSchema.partial();
export type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;

/** Métrica de widget = mismas del footer de agregados. */
export const widgetMetricSchema = aggregateMetricSchema;
