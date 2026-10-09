import { z } from 'zod';
import { idSchema } from './common';

/**
 * Sincronización desde SQL Server / Azure SQL (v0.1.243).
 *
 * Una conexión `sqlserver` (Integraciones) guarda servidor, base, usuario y la
 * contraseña cifrada. Cada SINCRONIZACIÓN dice qué se ejecuta —una consulta o
 * un procedimiento almacenado—, a qué lista va el resultado, qué columna es la
 * CLAVE (NIT, número de factura) y qué columna llena qué campo. El motor
 * empareja cada fila por la clave: si el registro existe se actualiza (sólo lo
 * que cambió), si no se crea. Nunca se duplica.
 *
 * Decisiones por defecto (acordadas con el usuario):
 *  - Lo que deja de aparecer en el resultado NO se toca (`on_missing:
 *    'ignore'`); como alternativa se puede marcar en una casilla.
 *  - Un NULL en SQL vacía el campo: para esas columnas la base es la fuente.
 *  - La PRIMERA carga no dispara automatizaciones (nadie quiere 3.000 correos
 *    al conectar); las siguientes sí, con el antes y el después.
 *  - Cada consulta corre dentro de una transacción que SIEMPRE se deshace:
 *    aunque el procedimiento intente escribir, en la base no queda nada.
 */

/**
 * Tipos de campo que puede llenar una columna de SQL. Quedan afuera los que
 * guardan ids de OTRAS cosas de la app (personas, archivos, vínculos) y los
 * que se calculan solos.
 */
export const SQL_SYNC_FIELD_TYPES = [
    'text',
    'long_text',
    'email',
    'url',
    'phone',
    'number',
    'currency',
    'percent',
    'rating',
    'duration',
    'checkbox',
    'date',
    'datetime',
    'select',
    'multi_select',
] as const;

/** Tipos que pueden ser la CLAVE (los mismos que «Actualizar desde un archivo»). */
export const SQL_SYNC_KEY_TYPES = ['text', 'email', 'phone', 'url', 'number'] as const;

/** Cada cuánto, en minutos. */
export const SQL_SYNC_INTERVALS = [15, 30, 60, 180, 360, 720, 1440] as const;

/** Filas máximas por corrida (además del límite de registros del plan). */
export const SQL_SYNC_MAX_ROWS = 50_000;
/** Filas que muestra la vista previa de una consulta. */
export const SQL_SYNC_PREVIEW_ROWS = 50;
/** Tiempo máximo de una consulta, en segundos (por defecto / tope). */
export const SQL_SYNC_DEFAULT_TIMEOUT = 60;
export const SQL_SYNC_MAX_TIMEOUT = 300;

/**
 * Parámetro especial: la fecha y hora (UTC) de la última sincronización que
 * terminó bien, o NULL en la primera. En una consulta se usa como
 * `@ultima_sincronizacion`; en un procedimiento, como valor de un parámetro
 * (`{{ultima_sincronizacion}}`). Sirve para traer sólo lo que cambió.
 */
export const SQL_LAST_SYNC_PARAM = 'ultima_sincronizacion';
export const SQL_LAST_SYNC_TOKEN = `{{${SQL_LAST_SYNC_PARAM}}}`;

/**
 * ¿La fuente trae sólo lo que cambió desde la última corrida? (usa
 * `@ultima_sincronizacion`, fuera de comentarios, o lo pasa a un parámetro del
 * procedimiento). Con una fuente así «marcar lo que deja de aparecer» es
 * imposible: lo que no cambió tampoco aparece y quedaría marcado como borrado.
 */
export function sqlSourceIsIncremental(source: { kind: 'query'; sql: string } | { kind: 'procedure'; params: Array<{ value: string }> }): boolean {
    if (source.kind === 'procedure') return source.params.some((p) => p.value.trim() === SQL_LAST_SYNC_TOKEN);
    const code = source.sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ')
        .replace(/'(?:[^']|'')*'/g, "''");
    return new RegExp(`@${SQL_LAST_SYNC_PARAM}\\b`, 'i').test(code);
}

export const sqlSyncScheduleSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('interval'),
        minutes: z
            .number()
            .int()
            .refine((n) => (SQL_SYNC_INTERVALS as readonly number[]).includes(n), 'Intervalo no disponible'),
    }),
    z.object({
        kind: z.literal('daily'),
        /** HH:MM en 24 h, en la zona `timezone`. */
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)'),
        timezone: z.string().trim().min(1).max(64),
    }),
]);
export type SqlSyncSchedule = z.infer<typeof sqlSyncScheduleSchema>;

/**
 * Nombre de un procedimiento: `uspFacturas`, `dbo.uspFacturas` o
 * `[dbo].[usp Facturas]`. Se manda como llamada RPC (no se concatena en SQL),
 * pero igual se valida la forma: un nombre raro es casi siempre un error.
 */
const procedureNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(/^(\[[^\]]+\]|[\p{L}_#@][\p{L}\p{N}_#@$]*)(\.(\[[^\]]+\]|[\p{L}_#@][\p{L}\p{N}_#@$]*)){0,2}$/u, 'Nombre de procedimiento inválido');

export const sqlProcedureParamSchema = z.object({
    /** Con o sin `@`. */
    name: z
        .string()
        .trim()
        .regex(/^@?[\p{L}_][\p{L}\p{N}_]*$/u, 'Nombre de parámetro inválido')
        .max(128),
    /** Texto literal, o `{{ultima_sincronizacion}}`. Vacío = NULL. */
    value: z.string().max(1000).default(''),
});
export type SqlProcedureParam = z.infer<typeof sqlProcedureParamSchema>;

export const sqlSourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('query'), sql: z.string().trim().min(1, 'Escribe la consulta').max(20_000) }),
    z.object({
        kind: z.literal('procedure'),
        name: procedureNameSchema,
        params: z.array(sqlProcedureParamSchema).max(30).default([]),
    }),
]);
export type SqlSource = z.infer<typeof sqlSourceSchema>;

export const sqlColumnMapSchema = z.object({
    /** Nombre de la columna en el resultado (sensible a mayúsculas como lo devuelve SQL). */
    column: z.string().min(1).max(128),
    field_id: idSchema,
});
export type SqlColumnMap = z.infer<typeof sqlColumnMapSchema>;

export const SQL_ON_MISSING = ['ignore', 'flag'] as const;

const sqlSyncBase = {
    name: z.string().trim().min(1).max(120),
    list_id: idSchema,
    source: sqlSourceSchema,
    /** La columna del resultado que identifica la fila (NIT, factura…). */
    key_column: z.string().min(1).max(128),
    /** El campo de la lista donde vive esa clave. */
    key_field_id: idSchema,
    /** Qué columna llena qué campo (además de la clave). */
    columns: z.array(sqlColumnMapSchema).max(150),
    /** Crear los registros cuya clave no existe en la lista. */
    create_missing: z.boolean(),
    /** Un NULL en SQL vacía el campo (si no, se deja lo que había). */
    null_clears: z.boolean(),
    /** Qué pasa con los registros cuya clave ya no aparece en el resultado. */
    on_missing: z.enum(SQL_ON_MISSING),
    /** Casilla que marca «está en SQL» (`on_missing: 'flag'`). */
    flag_field_id: idSchema.nullable(),
    /** Zona horaria de las fechas SIN zona (`datetime`/`datetime2`) de la base. */
    date_timezone: z.string().trim().min(1).max(64),
    timeout_seconds: z.number().int().min(5).max(SQL_SYNC_MAX_TIMEOUT),
    schedule: sqlSyncScheduleSchema,
    enabled: z.boolean(),
};

export const createSqlSyncSchema = z.object({
    ...sqlSyncBase,
    columns: sqlSyncBase.columns.default([]),
    create_missing: sqlSyncBase.create_missing.default(true),
    null_clears: sqlSyncBase.null_clears.default(true),
    on_missing: sqlSyncBase.on_missing.default('ignore'),
    flag_field_id: sqlSyncBase.flag_field_id.default(null),
    date_timezone: sqlSyncBase.date_timezone.default('UTC'),
    timeout_seconds: sqlSyncBase.timeout_seconds.default(SQL_SYNC_DEFAULT_TIMEOUT),
    schedule: sqlSyncBase.schedule.default({ kind: 'interval', minutes: 60 }),
    enabled: sqlSyncBase.enabled.default(true),
});
export type CreateSqlSyncInput = z.infer<typeof createSqlSyncSchema>;

export const updateSqlSyncSchema = z.object(sqlSyncBase).partial();
export type UpdateSqlSyncInput = z.infer<typeof updateSqlSyncSchema>;

/**
 * Lo guardado en `sql_syncs.settings`, leído con tolerancia: una fila vieja o
 * tocada a mano no rompe la sincronización (cae a los valores por defecto).
 */
export type SqlSyncSettings = Omit<CreateSqlSyncInput, 'name' | 'list_id' | 'enabled'>;

export function readSqlSyncSettings(raw: unknown): SqlSyncSettings {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const parsed = createSqlSyncSchema
        .omit({ name: true, list_id: true, enabled: true })
        .safeParse(obj);
    if (parsed.success) return parsed.data;
    // Lo mínimo para que el motor diga qué falta en vez de tirar.
    const source = sqlSourceSchema.safeParse(obj.source);
    return {
        source: source.success ? source.data : { kind: 'query', sql: 'SELECT 1' },
        key_column: typeof obj.key_column === 'string' ? obj.key_column : '',
        key_field_id: Number(obj.key_field_id) || 0,
        columns: [],
        create_missing: true,
        null_clears: true,
        on_missing: 'ignore',
        flag_field_id: null,
        date_timezone: 'UTC',
        timeout_seconds: SQL_SYNC_DEFAULT_TIMEOUT,
        schedule: { kind: 'interval', minutes: 60 },
    };
}

/** Probar una consulta antes de guardar (o la de una sincronización guardada). */
export const sqlPreviewSchema = z.object({
    source: sqlSourceSchema,
    timeout_seconds: z.number().int().min(5).max(SQL_SYNC_MAX_TIMEOUT).optional(),
});
export type SqlPreviewInput = z.infer<typeof sqlPreviewSchema>;

/** Tipo de campo que conviene para una columna de SQL. */
export type SqlSuggestedFieldType =
    | 'text'
    | 'long_text'
    | 'number'
    | 'currency'
    | 'checkbox'
    | 'date'
    | 'datetime';

export interface SqlPreviewColumn {
    name: string;
    /** El tipo según SQL Server (`nvarchar`, `decimal`, `datetime2`…). */
    sql_type: string;
    suggested_type: SqlSuggestedFieldType;
}

export interface SqlPreviewResult {
    columns: SqlPreviewColumn[];
    /** Las primeras filas, con cada valor ya en texto para mostrar. */
    rows: Array<Record<string, string | null>>;
    /** Hay más filas que las mostradas. */
    more: boolean;
    elapsed_ms: number;
}

export interface SqlSyncRunResult {
    read: number;
    created: number;
    updated: number;
    unchanged: number;
    /** Filas que no se pudieron guardar (clave vacía o repetida, valor inválido). */
    failed: number;
    /** Registros marcados como «no está en SQL» (`on_missing: 'flag'`). */
    flagged: number;
    /** El resultado superó el tope de filas y se cortó. */
    truncated: boolean;
    elapsed_ms: number;
}

export interface SqlSyncRowError {
    /** El valor de la clave (o `fila N` si estaba vacía). */
    key: string;
    message: string;
}

export interface SqlSyncStatus {
    running: boolean;
    /** Se pidió una corrida que todavía no arrancó. */
    queued: boolean;
    /** La primera carga ya se hizo (las siguientes disparan automatizaciones). */
    initial_done: boolean;
    last_run_at: string | null;
    last_success_at: string | null;
    next_run_at: string | null;
    last_error: string | null;
    last_result: SqlSyncRunResult | null;
    errors: SqlSyncRowError[];
}

export interface SqlSync {
    id: number;
    connection_id: number;
    connection_name: string;
    name: string;
    list_id: number;
    list_name: string | null;
    list_slug: string | null;
    source: SqlSource;
    key_column: string;
    key_field_id: number;
    columns: SqlColumnMap[];
    create_missing: boolean;
    null_clears: boolean;
    on_missing: (typeof SQL_ON_MISSING)[number];
    flag_field_id: number | null;
    date_timezone: string;
    timeout_seconds: number;
    schedule: SqlSyncSchedule;
    enabled: boolean;
    status: SqlSyncStatus;
    created_at: string;
}

/** Vista previa de la CARGA (qué haría una corrida) sin escribir nada. */
export interface SqlSyncDryRun {
    result: SqlSyncRunResult;
    errors: SqlSyncRowError[];
    sample: Array<{ key: string; action: 'create' | 'update'; changes: Array<{ label: string; before: string; after: string }> }>;
}

// --- Marca en la lista ------------------------------------------------------

/**
 * `lists.settings.sql_sync`: qué sincronizaciones escriben en la lista y qué
 * columnas llena cada una. La interfaz lo usa para marcar esas columnas («viene
 * de SQL: cada sincronización la actualiza») y mostrar el aviso arriba de la
 * lista. NO bloquea la edición: el resto de la lista es libre, y lo editado a
 * mano en una columna de SQL vuelve al valor de la base en la próxima corrida.
 */
export interface SqlListSource {
    sync_id: number;
    connection_id: number;
    name: string;
    key_field_id: number;
    field_ids: number[];
}
export interface SqlListMarker {
    syncs: SqlListSource[];
}

export function readSqlListMarker(settings: unknown): SqlListMarker | null {
    if (!settings || typeof settings !== 'object') return null;
    const raw = (settings as Record<string, unknown>).sql_sync;
    if (!raw || typeof raw !== 'object') return null;
    const syncs = (raw as { syncs?: unknown }).syncs;
    if (!Array.isArray(syncs)) return null;
    const out: SqlListSource[] = [];
    for (const s of syncs) {
        if (!s || typeof s !== 'object') continue;
        const o = s as Record<string, unknown>;
        const syncId = Number(o.sync_id);
        if (!Number.isInteger(syncId) || syncId <= 0) continue;
        out.push({
            sync_id: syncId,
            connection_id: Number(o.connection_id) || 0,
            name: typeof o.name === 'string' ? o.name : '',
            key_field_id: Number(o.key_field_id) || 0,
            field_ids: Array.isArray(o.field_ids) ? o.field_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
        });
    }
    return out.length > 0 ? { syncs: out } : null;
}

// --- Horario ----------------------------------------------------------------

/**
 * Próxima corrida programada a partir de `from`. Intervalo: `from + N min`.
 * Diaria: la próxima vez que el reloj de `timezone` marque `time` (si hoy ya
 * pasó, mañana). Una zona desconocida cae a UTC en vez de romper la
 * sincronización.
 */
export function nextSqlSyncRun(schedule: SqlSyncSchedule, from: Date): Date {
    if (schedule.kind === 'interval') return new Date(from.getTime() + schedule.minutes * 60_000);
    const [h, m] = schedule.time.split(':').map(Number) as [number, number];
    const tz = validTimeZone(schedule.timezone) ? schedule.timezone : 'UTC';
    // Fecha "de pared" de hoy en esa zona.
    const today = wallParts(from, tz);
    for (let add = 0; add <= 2; add++) {
        const candidate = zonedToUtc(today.y, today.mo, today.d + add, h, m, tz);
        if (candidate.getTime() > from.getTime()) return candidate;
    }
    return new Date(from.getTime() + 24 * 3_600_000);
}

export function validTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function wallParts(at: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/**
 * El instante UTC en que el reloj de `tz` marca esa fecha y hora. Se ajusta en
 * dos pasadas por si el desfase cambia ese día (horario de verano).
 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string, s = 0): Date {
    const naive = Date.UTC(y, mo - 1, d, h, mi, s);
    let guess = naive;
    for (let i = 0; i < 2; i++) {
        const w = wallParts(new Date(guess), tz);
        const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
        guess += naive - asUtc;
    }
    return new Date(guess);
}

/** «cada hora», «todos los días a las 07:30 (America/Bogota)». */
export function describeSqlSchedule(schedule: SqlSyncSchedule): string {
    if (schedule.kind === 'daily') return `todos los días a las ${schedule.time} (${schedule.timezone})`;
    const m = schedule.minutes;
    if (m === 60) return 'cada hora';
    if (m === 1440) return 'una vez por día';
    if (m % 60 === 0) return `cada ${m / 60} horas`;
    return `cada ${m} minutos`;
}
