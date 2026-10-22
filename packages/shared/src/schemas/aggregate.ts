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
        /**
         * v0.1.287 — SEGUNDO nivel de agrupado: dentro de cada grupo, un
         * desglose por este otro campo (subgrupos de la vista agrupada,
         * barras apiladas, tabla dinámica). Mismas reglas que el primero:
         * multi_select por combinación, sin valor → `null`, relación y
         * archivo no agrupan. Requiere `group_by_field_id` y otro campo.
         */
        sub_group_by_field_id: idSchema.optional(),
        /** Bucket temporal del segundo nivel (si es un campo de fecha). */
        sub_time_bucket: timeBucketSchema.optional(),
    })
    .refine((r) => !FIELD_METRICS.includes(r.metric) || r.field_id !== undefined, {
        message: 'Esta métrica requiere field_id',
        path: ['field_id'],
    })
    .refine((r) => r.sub_group_by_field_id === undefined || r.group_by_field_id !== undefined, {
        message: 'sub_group_by_field_id requiere group_by_field_id',
        path: ['sub_group_by_field_id'],
    })
    .refine((r) => r.sub_group_by_field_id === undefined || r.sub_group_by_field_id !== r.group_by_field_id, {
        message: 'El segundo agrupado tiene que ser otro campo',
        path: ['sub_group_by_field_id'],
    });
export type AggregateRequest = z.infer<typeof aggregateRequestSchema>;

/** Un valor puede ser numérico (sum/avg/count) o string ISO (min/max de fecha). */
export const aggregateValueSchema = z.union([z.number(), z.string(), z.null()]);

/**
 * v0.1.286 — Clave del grupo "Otros": cuando un agrupado tiene más grupos que
 * el tope (los gráficos piden 50; el endpoint, 1000) el resto se resume en UN
 * grupo con esta clave y `others` = cuántos grupos junta. No es un valor real
 * del campo: no se navega ni se filtra por él.
 */
export const AGGREGATE_OTHERS_KEY = '__others__';

/** v0.1.287 — Una celda del segundo nivel: (grupo, subgrupo) → valor. */
export const aggregateSubGroupSchema = z.object({
    group: z.string().nullable(),
    value: aggregateValueSchema,
});
export type AggregateSubGroup = z.infer<typeof aggregateSubGroupSchema>;

/** Resultado: valor total y, si hubo group_by, el desglose por grupo. */
export const aggregateResultSchema = z.object({
    metric: aggregateMetricSchema,
    value: aggregateValueSchema,
    groups: z
        .array(
            z.object({
                group: z.string().nullable(),
                /** El valor del GRUPO entero (bien calculado también para promedio, mín/máx o únicos). */
                value: aggregateValueSchema,
                /** Sólo en el grupo "Otros": cuántos grupos resume. */
                others: z.number().int().nonnegative().optional(),
                /**
                 * v0.1.287 — con `sub_group_by_field_id`: el desglose por el
                 * segundo campo DENTRO de este grupo, en el orden de las claves.
                 */
                sub_groups: z.array(aggregateSubGroupSchema).optional(),
            }),
        )
        .optional(),
    /** v0.1.287 — con segundo nivel: pares (grupo, subgrupo) que existen pero no viajan (tope). */
    hidden_sub_groups: z.number().int().nonnegative().optional(),
    /**
     * v0.1.292 — con segundo nivel y totales (tabla dinámica, barras
     * apiladas): la métrica de cada SUBGRUPO sobre todos los registros, en el
     * orden del tope (las mayores primero o por clave) con "Otros" al final.
     * Con totales, `value` es el total general.
     */
    sub_totals: z.array(aggregateSubGroupSchema.extend({ others: z.number().int().nonnegative().optional() })).optional(),
    /** v0.1.292 — cuántos subgrupos junta el subgrupo "Otros" (tope del segundo nivel). */
    sub_others: z.number().int().nonnegative().optional(),
});
export type AggregateResult = z.infer<typeof aggregateResultSchema>;
