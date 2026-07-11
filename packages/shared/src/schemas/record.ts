import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { filterTreeSchema } from './filter';

/**
 * Record del API. `data` son los valores dinámicos con claves `f{field_id}`
 * (ADR-S02). El backend valida `data` contra los fields de la lista antes de
 * persistir; acá el shape es genérico.
 */
export const recordSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    data: z.record(z.unknown()),
    /**
     * Targets de los campos `relation`, keyed por `f{field_id}` (igual que
     * `data`). Viven en la tabla `relations`, no en el JSONB; el backend los
     * adjunta en cada lectura (batch por página).
     */
    relations: z.record(z.array(idSchema)).optional(),
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type RecordDto = z.infer<typeof recordSchema>;

/** El `data` de entrada: mapa clave→valor. Las claves deben ser `f{n}`. */
export const recordDataSchema = z.record(z.string().regex(/^f\d+$/), z.unknown());

export const createRecordSchema = z.object({
    data: recordDataSchema.default({}),
});
export type CreateRecordInput = z.infer<typeof createRecordSchema>;

/** Update parcial: los campos presentes en `data` se mergean sobre el record. */
export const updateRecordSchema = z.object({
    data: recordDataSchema,
});
export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;

export const DEFAULT_RECORDS_LIMIT = 50;
export const MAX_RECORDS_LIMIT = 200;

export const sortDirSchema = z.enum(['asc', 'desc']);

/**
 * Query de listado de records: cursor pagination keyset por `id` (STANDALONE
 * §3.5 — nunca OFFSET profundo) + filtro por tree. `cursor` es opaco (id del
 * último visto). `sort_dir` controla el orden por id (asc = más viejo primero).
 *
 * El orden por un campo arbitrario (keyset compuesto sobre (valor, id)) lo
 * necesitan las saved views y llega en F2; acá el orden canónico es por id.
 */
export const listRecordsQuerySchema = z.object({
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(MAX_RECORDS_LIMIT).default(DEFAULT_RECORDS_LIMIT),
    sort_dir: sortDirSchema.default('asc'),
    filter_tree: filterTreeSchema.optional(),
});
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;

/**
 * Acción masiva sobre varios records (borrar o actualizar campos). `values`
 * acepta claves por slug o por f{id}; el service las normaliza. Se aplica por
 * fila con capabilities/own-scoping; devuelve éxitos y fallos individuales.
 */
export const bulkRecordsSchema = z.object({
    action: z.enum(['delete', 'update']),
    ids: z.array(idSchema).min(1).max(500),
    values: z.record(z.unknown()).default({}),
});
export type BulkRecordsInput = z.infer<typeof bulkRecordsSchema>;
