import { z } from 'zod';
import { idSchema } from './common';
import { filterTreeSchema } from './filter';

/**
 * Agregaciones de footer + widgets (CONTRACT.md §5). Restricciones por tipo:
 * sum/avg sólo number/currency; count_true/false sólo checkbox; min/max
 * también date/datetime (devuelven string ISO — los charts toleran string).
 */
export const AGGREGATE_METRICS = [
    'count',
    'count_unique',
    'count_empty',
    'sum',
    'avg',
    'min',
    'max',
    'count_true',
    'count_false',
] as const;
export const aggregateMetricSchema = z.enum(AGGREGATE_METRICS);
export type AggregateMetric = z.infer<typeof aggregateMetricSchema>;

/** Métricas que requieren un `field_id` sobre el que operar. */
export const FIELD_METRICS: readonly AggregateMetric[] = [
    'count_unique',
    'count_empty',
    'sum',
    'avg',
    'min',
    'max',
    'count_true',
    'count_false',
];

/**
 * Granularidad temporal para agrupar por un campo date/datetime (widgets
 * de tendencia — v0.1.97). Cada bucket se etiqueta con un formato estable
 * y ordenable cronológicamente como string: `2026-07-21` (day),
 * `2026-W30` (week ISO), `2026-07` (month), `2026-Q3` (quarter), `2026`
 * (year).
 */
export const TIME_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export const timeBucketSchema = z.enum(TIME_BUCKETS);
export type TimeBucket = z.infer<typeof timeBucketSchema>;

export const aggregateRequestSchema = z
    .object({
        metric: aggregateMetricSchema,
        field_id: idSchema.optional(),
        group_by_field_id: idSchema.optional(),
        filter_tree: filterTreeSchema.optional(),
        /**
         * Sólo aplica cuando `group_by_field_id` es un campo date/datetime:
         * agrupa por bucket temporal en vez de por valor crudo. Se ignora
         * para cualquier otro tipo de campo.
         */
        time_bucket: timeBucketSchema.optional(),
    })
    .refine((r) => !FIELD_METRICS.includes(r.metric) || r.field_id !== undefined, {
        message: 'Esta métrica requiere field_id',
        path: ['field_id'],
    });
export type AggregateRequest = z.infer<typeof aggregateRequestSchema>;

/** Un valor puede ser numérico (sum/avg/count) o string ISO (min/max de fecha). */
export const aggregateValueSchema = z.union([z.number(), z.string(), z.null()]);

/** Resultado: valor total y, si hubo group_by, el desglose por grupo. */
export const aggregateResultSchema = z.object({
    metric: aggregateMetricSchema,
    value: aggregateValueSchema,
    groups: z
        .array(z.object({ group: z.string().nullable(), value: aggregateValueSchema }))
        .optional(),
});
export type AggregateResult = z.infer<typeof aggregateResultSchema>;
