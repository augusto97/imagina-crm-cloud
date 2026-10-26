import { addDaysYmd, jsonbKeyForField, type DoneRule } from '@imagina-base/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { records, timeEntries } from '../db/schema';
import { fieldTypedExpr, type FilterableField } from '../records/query-builder';

/**
 * B2 — Carga de trabajo: el SQL del bundle. Tres consultas, ninguna por fila
 * ni por persona (regla de oro nº 8):
 *  - `workloadItemsSql`: cada registro con fecha que se SOLAPA con el rango,
 *    con su persona, su tramo de días EN EL RELOJ DE LA EMPRESA, su estimación
 *    y si está terminado. El reparto en días hábiles lo hace después la misma
 *    función pura de shared que usa el front (`workloadItemLoad`).
 *  - `workloadUnscheduledSql`: cuántos registros SIN fecha tiene cada persona.
 *  - `workloadTimeSql`: el tiempo registrado (`time_entries`) por persona, día
 *    y registro dentro del rango.
 *
 * Todo valor del usuario viaja como parámetro; los campos llegan YA validados
 * contra la lista (whitelist, regla de oro nº 4) y las expresiones tipadas son
 * las del QueryBuilder (casts tolerantes: un valor basura es NULL, no un 500).
 * El `where` (filtros + búsqueda + alcance del ACL) es el mismo del listado.
 * Las subtareas cuentan: una subtarea asignada es trabajo de esa persona.
 */
export interface WorkloadDateField {
    id: number;
    type: 'date' | 'datetime';
}

export interface WorkloadSqlBase {
    tenantId: number;
    listId: number;
    /** Filtros + búsqueda + alcance de lectura (`readWhere`). */
    where: SQL | undefined;
    personFieldId: number;
    titleFieldId: number | null;
    /** El campo de asignación del ACL (para saber si quien mira puede editar la fila). */
    assignmentFieldId: number | null;
    /** «Terminado» (criterio de «Mi trabajo») y si se ocultan. */
    done: DoneRule | null;
    hideDone: boolean;
}

export interface WorkloadItemsSqlOpts extends WorkloadSqlBase {
    start: WorkloadDateField | null;
    end: WorkloadDateField | null;
    estimate: FilterableField | null;
    from: string;
    to: string;
    timeZone: string;
    limit: number;
}

const text = (fieldId: number): SQL => sql`(${records.data} ->> ${jsonbKeyForField(fieldId)})`;

function doneExpr(done: DoneRule | null): SQL {
    if (!done || done.values.length === 0) return sql`false`;
    return sql`COALESCE(${text(done.fieldId)} IN (${sql.join(
        done.values.map((v) => sql`${v}`),
        sql`, `,
    )}), false)`;
}

function baseWhere(o: WorkloadSqlBase): SQL | undefined {
    return and(
        eq(records.tenantId, o.tenantId),
        eq(records.listId, o.listId),
        isNull(records.deletedAt),
        o.where,
        o.hideDone && o.done ? sql`NOT ${doneExpr(o.done)}` : undefined,
    );
}

/** Columnas comunes de la fila: persona, título, quién la creó, asignación y terminado. */
function rowColumns(o: WorkloadSqlBase): SQL {
    const title = o.titleFieldId !== null ? sql`left(${text(o.titleFieldId)}, 200)` : sql`NULL::text`;
    const assigned = o.assignmentFieldId !== null ? text(o.assignmentFieldId) : sql`NULL::text`;
    return sql`${text(o.personFieldId)} AS person, ${title} AS title, ${records.createdBy} AS created_by,
               ${assigned} AS assigned, ${doneExpr(o.done)} AS done`;
}

/** Día (date) de un campo de fecha en el reloj de la empresa, y su instante de inicio. */
function dayOf(f: WorkloadDateField, tz: string): { day: SQL; ts: SQL } {
    const typed = fieldTypedExpr({ id: f.id, type: f.type });
    if (f.type === 'date') return { day: typed, ts: sql`((${typed})::timestamp AT TIME ZONE ${tz})` };
    return { day: sql`((${typed}) AT TIME ZONE ${tz})::date`, ts: typed };
}

export function workloadItemsSql(o: WorkloadItemsSqlOpts): SQL {
    const tz = o.timeZone;
    const s = o.start ? dayOf(o.start, tz) : null;
    // Un fin de fecha y hora EXACTO a las 00:00 no ocupa ese día (la misma regla del calendario).
    let endDay: SQL | null = null;
    if (o.end) {
        const e = dayOf(o.end, tz);
        endDay =
            o.end.type === 'date'
                ? e.day
                : s
                  ? sql`(CASE WHEN ${e.ts} > ${s.ts} THEN ((${e.ts}) - interval '1 microsecond') AT TIME ZONE ${tz} ELSE (${e.ts}) AT TIME ZONE ${tz} END)::date`
                  : e.day;
    }
    // «Inicio y fin, o una sola fecha»: sin inicio, el fin es la única fecha.
    const sDay = s && endDay ? sql`COALESCE(${s.day}, ${endDay})` : (s?.day ?? endDay ?? sql`NULL::date`);
    const eDay = endDay ? sql`GREATEST(COALESCE(${endDay}, ${sDay}), ${sDay})` : sDay;
    const est = o.estimate ? sql`(${fieldTypedExpr(o.estimate)})::float8` : sql`NULL::float8`;
    return sql`
        SELECT x.id, x.person, x.title, x.created_by, x.assigned, x.done, x.est,
               to_char(x.s_day, 'YYYY-MM-DD') AS s, to_char(x.e_day, 'YYYY-MM-DD') AS e
        FROM (
            SELECT ${records.id} AS id, ${rowColumns(o)}, ${est} AS est, ${sDay} AS s_day, ${eDay} AS e_day
            FROM ${records}
            WHERE ${and(baseWhere(o), textPrefilter(o))}
        ) x
        WHERE x.s_day IS NOT NULL AND x.s_day <= ${o.to}::date AND x.e_day >= ${o.from}::date
        ORDER BY x.id
        LIMIT ${o.limit}::int`;
}

/**
 * Descarte barato ANTES de convertir (como el calendario): las fechas se
 * guardan como ISO 8601 y sus primeros 10 caracteres ordenan como fechas. Con
 * hora se deja un margen de 2 días a cada lado (la fecha del texto está en la
 * zona del valor). Es una condición NECESARIA: el filtro exacto se aplica igual.
 */
function textPrefilter(o: WorkloadItemsSqlOpts): SQL {
    const day = (id: number): SQL => sql`(left(${records.data} ->> ${jsonbKeyForField(id)}::text, 10) COLLATE "C")`;
    const fields = [o.start, o.end].filter((f): f is WorkloadDateField => f !== null);
    if (fields.length === 0) return sql`false`;
    const margin = fields.some((f) => f.type === 'datetime') ? 2 : 0;
    const lo = addDaysYmd(o.from, -margin);
    const hi = addDaysYmd(o.to, margin);
    const parts = fields.map((f) => day(f.id));
    const first = parts.length === 1 ? parts[0]! : sql`LEAST(${sql.join(parts, sql`, `)})`;
    const last = parts.length === 1 ? parts[0]! : sql`GREATEST(${sql.join(parts, sql`, `)})`;
    return sql`${first} <= ${hi} AND ${last} >= ${lo}`;
}

/** Registros SIN ninguna fecha por persona (no caen en ninguna columna). */
export function workloadUnscheduledSql(o: WorkloadSqlBase & { start: WorkloadDateField | null; end: WorkloadDateField | null }): SQL {
    const empty = [o.start, o.end]
        .filter((f): f is WorkloadDateField => f !== null)
        .map((f) => sql`${fieldTypedExpr({ id: f.id, type: f.type })} IS NULL`);
    return sql`
        SELECT ${text(o.personFieldId)} AS person, count(*)::int AS n
        FROM ${records}
        WHERE ${and(baseWhere(o), ...empty)}
        GROUP BY 1`;
}

/**
 * El tiempo registrado (`time_entries`, entradas cerradas: un cronómetro en
 * curso todavía no suma, igual que el campo «Tiempo registrado») por quien lo
 * cargó, el día de trabajo y el registro, sobre los registros que coinciden
 * con la vista. La fila es la de quien REGISTRÓ el tiempo.
 */
export function workloadTimeSql(o: WorkloadSqlBase & { from: string; to: string; limit: number }): SQL {
    return sql`
        SELECT ${timeEntries.userId} AS uid, to_char(${timeEntries.workDate}::date, 'YYYY-MM-DD') AS day, ${records.id} AS id,
               sum(${timeEntries.seconds})::bigint AS secs, ${rowColumns(o)}
        FROM ${timeEntries}
        JOIN ${records} ON ${records.id} = ${timeEntries.recordId}
        WHERE ${and(
            eq(timeEntries.tenantId, o.tenantId),
            eq(timeEntries.listId, o.listId),
            sql`${timeEntries.workDate} BETWEEN ${o.from}::date AND ${o.to}::date`,
            sql`${timeEntries.seconds} > 0`,
            baseWhere(o),
        )}
        GROUP BY ${timeEntries.userId}, ${timeEntries.workDate}, ${records.id}
        ORDER BY ${records.id}, ${timeEntries.workDate}
        LIMIT ${o.limit}::int`;
}
