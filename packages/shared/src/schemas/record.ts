import { z } from 'zod';
import { allSafeIds, idSchema, isoDateTimeSchema, queryIdSchema } from './common';
import { filterTreeSchema } from './filter';

/**
 * Record del API. `data` son los valores dinámicos con claves `f{field_id}`
 * (ADR-S02). El backend valida `data` contra los fields de la lista antes de
 * persistir; aquí el shape es genérico.
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
    /**
     * Registro padre dentro de la MISMA lista (subtareas, v0.1.132). `null`
     * = registro de primer nivel. Un solo nivel de anidado: una subtarea no
     * puede tener subtareas.
     */
    parent_id: idSchema.nullable().default(null),
    /** Cuántas subtareas vivas cuelgan de este registro (sólo lectura). */
    subtask_count: z.number().int().nonnegative().default(0),
    /**
     * ¿El registro tiene descripción (v0.1.133)? El CONTENIDO no viaja en el
     * listado a propósito — una página de 50 filas con documentos completos
     * pesaría de más y la tabla no lo muestra. La descripción se pide aparte
     * (`GET .../records/:id/description`) al abrir la ficha; aquí sólo va el
     * indicador que necesita el icono de la fila.
     */
    has_description: z.boolean().default(false),
    /**
     * A8 — Cuántos registros que lo BLOQUEAN siguen abiertos (no terminados
     * ni en la papelera). Viaja en el listado (una consulta por página) para
     * el icono de «bloqueado» de la fila y la tarjeta; 0 = nada lo bloquea.
     */
    blocked_by_open: z.number().int().nonnegative().optional(),
    /**
     * C5 — Cuántas solicitudes de aprobación PENDIENTES tiene el registro (de
     * cualquier flujo). Viaja en el listado (una consulta por página) para el
     * indicador de la fila; 0 = ninguna.
     */
    approval_pending: z.number().int().nonnegative().optional(),
    /**
     * A8 — Sólo en la respuesta de una edición: los registros que se
     * corrieron por la reprogramación en cadena (ids).
     */
    rescheduled: z.array(idSchema).optional(),
    created_by: idSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    /**
     * v0.1.300 — quién lo modificó por última vez (0 = el sistema; null = no se
     * sabe, registros modificados antes de que existiera el dato).
     */
    updated_by: z.number().int().nonnegative().nullable().optional(),
    /**
     * Fórmulas que dieron error en ESTA fila (por `f{field_id}`), con el
     * motivo: la celda muestra «#ERROR» y el motivo al pasar el mouse. El
     * valor de esas claves en `data` es null.
     */
    formula_errors: z.record(z.string()).optional(),
});
export type RecordDto = z.infer<typeof recordSchema>;

/** El `data` de entrada: mapa clave→valor. Las claves deben ser `f{n}`. */
export const recordDataSchema = z.record(z.string().regex(/^f\d+$/), z.unknown());

export const createRecordSchema = z.object({
    data: recordDataSchema.default({}),
    /** Crea el registro como subtarea de otro de la misma lista. */
    parent_id: idSchema.nullable().optional(),
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
 * necesitan las saved views y llega en F2; aquí el orden canónico es por id.
 */
export const listRecordsQuerySchema = z.object({
    cursor: queryIdSchema.optional(),
    limit: z.coerce.number().int().positive().max(MAX_RECORDS_LIMIT).default(DEFAULT_RECORDS_LIMIT),
    sort_dir: sortDirSchema.default('asc'),
    /**
     * Orden por CAMPO (`field_{id}:{asc|desc}`, multi separado por coma) —
     * lo manda la tabla al clickear un header. Con sort por campo la
     * paginación pasa a offset (el cursor se reinterpreta como offset;
     * opaco para el cliente, que solo lo devuelve tal cual).
     */
    sort: z
        .string()
        .regex(/^field_\d+:(asc|desc)(,field_\d+:(asc|desc))*$/)
        .optional(),
    filter_tree: filterTreeSchema.optional(),
    /**
     * Búsqueda de texto server-side sobre los campos "searchables" (text,
     * long_text, email, url) — ILIKE por substring, AND con el filter_tree.
     * La UI la usa cuando la lista supera una página (si no, filtra client-side).
     */
    search: z.string().trim().max(200).optional(),
    /**
     * Subtareas (v0.1.132). Por defecto el listado devuelve SÓLO los
     * registros de primer nivel — si no, las subtareas aparecerían sueltas
     * y los totales contarían dos veces lo mismo.
     *  - `parent=<id>`: devuelve las subtareas de ese registro.
     *  - `include_subtasks=1`: devuelve todo plano (lo usa el export).
     */
    parent: queryIdSchema.optional(),
    include_subtasks: z.coerce.boolean().optional(),
    /**
     * Paginación por PÁGINA (v0.1.187): `page` (desde 1) reinterpreta el
     * listado como OFFSET `(page-1)*limit` y la respuesta trae `meta.total`
     * (+ `page`/`per_page`/`total_pages`) contado con el MISMO where. Es lo
     * que necesita una tabla con "Página 3 de 11"; los clientes de API que
     * recorren todo siguen usando el cursor keyset (más barato). `with_total`
     * pide sólo el total sin cambiar la paginación.
     */
    page: z.coerce.number().int().positive().max(100_000).optional(),
    with_total: z.coerce.boolean().optional(),
    /**
     * v0.1.209 — Sólo estos registros (ids separados por coma, hasta 200):
     * lo que necesita una acción sobre una SELECCIÓN de filas con sus
     * valores calculados, en una request y no una por fila.
     */
    ids: z
        .string()
        .regex(/^\d+(,\d+){0,199}$/)
        .refine((v) => allSafeIds(v), 'Id fuera de rango')
        .optional(),
    /**
     * v0.1.209 — Registros VINCULADOS a otro: `<id del campo relation>:<id
     * del registro destino>` ("las líneas de esta orden de compra"). El
     * campo tiene que ser un relation de ESTA lista (whitelist, como los
     * filtros); las relaciones no son filtrables por el filter tree.
     */
    related_to: z
        .string()
        .regex(/^\d+:\d+$/)
        .refine((v) => allSafeIds(v, ':'), 'Id fuera de rango')
        .optional(),
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

/**
 * v0.1.287 — Edición de VARIAS filas con valores DISTINTOS por fila en una
 * sola llamada: pegar un bloque copiado de Excel, rellenar hacia abajo,
 * deshacer y rehacer desde la tabla. Cada ítem es un update parcial (`data`
 * con claves `f{id}`) que pasa por el mismo camino que una edición de celda
 * (ACL, validación, actividad, automatizaciones, reglas de la tienda), y el
 * realtime avisa UNA vez al final.
 *
 * `expect` (deshacer/rehacer): los valores que el cliente cree vigentes. Si
 * alguno cambió desde entonces (otra persona lo editó), esa fila NO se toca y
 * vuelve como conflicto — deshacer nunca pisa el cambio de otro.
 */
export const MAX_BATCH_UPDATE_ITEMS = 500;
export const batchUpdateRecordsSchema = z.object({
    items: z
        .array(
            z.object({
                id: idSchema,
                data: recordDataSchema,
                expect: recordDataSchema.optional(),
            }),
        )
        .min(1)
        .max(MAX_BATCH_UPDATE_ITEMS),
});
export type BatchUpdateRecordsInput = z.infer<typeof batchUpdateRecordsSchema>;

/** Una celda que no se pudo escribir (el resto de la fila sí se escribió). */
export interface BatchUpdateCellError {
    id: number;
    /** Clave `f{id}` del campo. */
    key: string;
    message: string;
}

/** Una fila que no se tocó (sin permiso, borrada, conflicto…). */
export interface BatchUpdateRowError {
    id: number;
    code: string;
    message: string;
    /** Conflicto: las claves `f{id}` que cambiaron desde que el cliente las leyó. */
    changed?: string[];
}

export interface BatchUpdateRecordsResult {
    /** Las filas ya escritas (como las devuelve el update: `data` por `f{id}`). */
    updated: RecordDto[];
    failed: BatchUpdateRowError[];
    cell_errors: BatchUpdateCellError[];
}

/**
 * v0.1.294 — Alta de VARIAS filas en una llamada: pegar desde Excel un bloque
 * con más filas de las que hay debajo crea las que faltan (como Airtable), y
 * rehacer ese pegado las vuelve a crear. Cada ítem pasa por el mismo camino
 * que un alta (ACL, validación, actividad, automatizaciones); el límite del
 * plan se verifica UNA vez para el lote entero (entra todo o nada) y el
 * realtime avisa una sola vez.
 */
export const MAX_BATCH_CREATE_ITEMS = 500;
export const batchCreateRecordsSchema = z.object({
    items: z
        .array(z.object({ data: recordDataSchema }))
        .min(1)
        .max(MAX_BATCH_CREATE_ITEMS),
});
export type BatchCreateRecordsInput = z.infer<typeof batchCreateRecordsSchema>;

/** Una fila del lote que no se creó (por su posición en `items`). */
export interface BatchCreateRowError {
    index: number;
    code: string;
    message: string;
    /** Errores de validación por clave `f{id}` o slug. */
    errors?: Record<string, string>;
}

export interface BatchCreateRecordsResult {
    created: Array<{ index: number; record: RecordDto }>;
    failed: BatchCreateRowError[];
}

/**
 * v0.1.294 — Borrado de varias filas con `expect` por fila: deshacer un
 * pegado que creó registros los borra, pero NUNCA uno que alguien editó
 * después (vuelve como conflicto `record_changed`, igual que el batch de
 * edición).
 */
export const batchDeleteRecordsSchema = z.object({
    items: z
        .array(z.object({ id: idSchema, expect: recordDataSchema.optional() }))
        .min(1)
        .max(MAX_BATCH_UPDATE_ITEMS),
});
export type BatchDeleteRecordsInput = z.infer<typeof batchDeleteRecordsSchema>;

export interface BatchDeleteRecordsResult {
    deleted: number[];
    failed: BatchUpdateRowError[];
}
