import { addDaysYmd, jsonbKeyForField } from '@imagina-base/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';
import { fieldTypedExpr } from './query-builder';

/**
 * B4 — Calendario completo: el SQL del rango visible.
 *
 * Un evento es (fuente de fecha, registro). Para cada fuente se calcula, UNA
 * vez por fila, el día de inicio y el de fin EN EL RELOJ DE LA EMPRESA:
 *  - fecha sin hora → ese día (nunca se corre: no pasa por ninguna zona);
 *  - fecha y hora   → `(instante AT TIME ZONE zona)::date`;
 *  - el fin, si la fuente lo tiene, se toma sólo si no es anterior al inicio;
 *    un fin de fecha y hora exacto a las 00:00 no ocupa ese día.
 * Entran los eventos que se SOLAPAN con [desde, hasta]: los que empiezan antes
 * y terminan dentro, y los de varios días. Después cada evento se expande a
 * los días que ocupa dentro del rango (`generate_series`), y una ventana
 * `row_number()` por día elige los primeros N de cada día (los de todo el día
 * primero, después por hora): así un día con 500 eventos manda 3 y cuenta 500
 * («+497 más») sin que el resto del mes pierda los suyos.
 *
 * Todo valor del usuario viaja como parámetro; los campos llegan YA
 * validados contra la lista (whitelist, regla de oro nº 4) y las expresiones
 * tipadas son las del QueryBuilder (casts tolerantes: un valor basura es NULL,
 * no un 500).
 */
export interface CalendarSqlSource {
    key: string;
    start: { id: number; type: 'date' | 'datetime' };
    end: { id: number; type: 'date' | 'datetime' } | null;
    /** Sin fin y con inicio de fecha y hora: un campo Duración (minutos). */
    duration: { id: number } | null;
}

export interface CalendarSqlOpts {
    tenantId: number;
    listId: number;
    /** Filtros + búsqueda + alcance del ACL (el mismo `readWhere` del listado). */
    where: SQL | undefined;
    sources: CalendarSqlSource[];
    /** Días inclusivos (YYYY-MM-DD) en el reloj de la empresa. */
    from: string;
    to: string;
    timeZone: string;
    perDay: number;
    /** Día → cuántos traer («+N más» desplegado). */
    dayLimits: Record<string, number>;
    /** Tope de filas (día, evento) por respuesta. */
    maxRows: number;
}

export interface CalendarPick {
    src: string;
    id: number;
    day: string;
    /** Eventos que ocupan ese día (todas las fuentes). */
    n: number;
}

export function calendarPicksSql(o: CalendarSqlOpts): SQL {
    const base = and(
        eq(records.tenantId, o.tenantId),
        eq(records.listId, o.listId),
        isNull(records.deletedAt),
        // Primer nivel, como el kanban y el listado por defecto.
        isNull(records.parentId),
        o.where,
    );
    const tz = o.timeZone;
    const from = sql`${o.from}::date`;
    const to = sql`${o.to}::date`;
    const perSource = o.sources.map((s) => {
        const startTyped = fieldTypedExpr({ id: s.start.id, type: s.start.type });
        const sDay = s.start.type === 'date' ? startTyped : sql`((${startTyped}) AT TIME ZONE ${tz})::date`;
        const sTs = s.start.type === 'date' ? sql`((${startTyped})::timestamp AT TIME ZONE ${tz})` : startTyped;
        let eDay: SQL = sDay;
        if (!s.end && s.duration && s.start.type === 'datetime') {
            const minutes = fieldTypedExpr({ id: s.duration.id, type: 'duration' });
            const eTs = sql`(${sTs} + (${minutes}) * interval '1 minute')`;
            eDay = sql`GREATEST(COALESCE((CASE WHEN (${minutes}) > 0 THEN (${eTs} - interval '1 microsecond') AT TIME ZONE ${tz} END)::date, ${sDay}), ${sDay})`;
        }
        if (s.end) {
            const endTyped = fieldTypedExpr({ id: s.end.id, type: s.end.type });
            const endDay =
                s.end.type === 'date'
                    ? endTyped
                    : sql`(CASE WHEN ${endTyped} > ${sTs} THEN ((${endTyped}) - interval '1 microsecond') AT TIME ZONE ${tz} END)::date`;
            eDay = sql`GREATEST(COALESCE(${endDay}, ${sDay}), ${sDay})`;
        }
        const allDay = s.start.type === 'date' ? sql`true` : sql`false`;
        return sql`
            SELECT x.id, x.src, x.s_ts, x.all_day, x.s_day, x.e_day FROM (
                SELECT ${records.id} AS id, ${s.key}::text AS src, ${sTs} AS s_ts, ${allDay} AS all_day,
                       ${sDay} AS s_day, ${eDay} AS e_day
                FROM ${records}
                WHERE ${and(base, textPrefilter(s, o.from, o.to))}
            ) x
            WHERE x.s_day IS NOT NULL AND x.s_day <= ${to} AND x.e_day >= ${from}`;
    });
    const limitCases = Object.entries(o.dayLimits)
        .filter(([day, n]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(n) && n > 0)
        .slice(0, 100)
        .map(([day, n]) => sql`WHEN ${day}::date THEN ${n}::int`);
    const limit = limitCases.length > 0 ? sql`(CASE w.day ${sql.join(limitCases, sql` `)} ELSE ${o.perDay}::int END)` : sql`${o.perDay}::int`;
    return sql`
        WITH ev AS (${sql.join(perSource, sql` UNION ALL `)}),
        d AS (
            SELECT ev.src, ev.id, ev.s_ts, ev.all_day, (ev.e_day > ev.s_day) AS multi, g::date AS day
            FROM ev CROSS JOIN LATERAL generate_series(
                GREATEST(ev.s_day, ${from})::timestamp,
                LEAST(ev.e_day, ${to})::timestamp,
                interval '1 day'
            ) AS g
        ),
        w AS (
            SELECT d.src, d.id, d.day,
                   row_number() OVER (PARTITION BY d.day ORDER BY d.multi DESC, d.all_day DESC, d.s_ts ASC NULLS LAST, d.id ASC, d.src ASC) AS rn,
                   count(*) OVER (PARTITION BY d.day) AS n
            FROM d
        )
        SELECT w.src, w.id, to_char(w.day, 'YYYY-MM-DD') AS day, w.n,
               (SELECT count(*) FROM ev) AS total,
               (SELECT json_object_agg(c.src, c.n) FROM (SELECT ev.src, count(*) AS n FROM ev GROUP BY ev.src) c) AS per_source
        FROM w
        WHERE w.rn <= ${limit}
        ORDER BY w.day, w.rn
        LIMIT ${o.maxRows}::int`;
}

/**
 * Descarte barato ANTES de convertir: los campos fecha y fecha y hora se
 * guardan validados como ISO 8601 (`YYYY-MM-DD` y `YYYY-MM-DDTHH:MM…±HH:MM`),
 * así que sus primeros 10 caracteres ordenan como fechas. Comparar ese texto
 * deja afuera casi toda la lista sin pagar el `pg_input_is_valid` + cast de
 * cada valor (en 100k registros, de ~630 a ~160 ms). Con hora se deja un
 * margen de 2 días a cada lado: la fecha del texto está en la zona del VALOR
 * y la del calendario en la de la empresa (hasta ±28 h de diferencia). Es una
 * condición NECESARIA: el filtro exacto (tipado) se aplica igual después.
 */
function textPrefilter(s: CalendarSqlSource, from: string, to: string): SQL {
    const margin = s.start.type === 'datetime' ? 2 : 0;
    const lo = addDaysYmd(from, -margin);
    const hi = addDaysYmd(to, margin);
    // COLLATE "C": orden byte a byte (una collation de idioma podría ignorar los guiones).
    const day = (id: number): SQL => sql`(left(${records.data} ->> ${jsonbKeyForField(id)}::text, 10) COLLATE "C")`;
    const start = day(s.start.id);
    // Con duración el fin no está en el texto (una duración de días puede
    // venir de antes del rango): sólo se acota el inicio por arriba.
    if (s.duration) return sql`${start} <= ${hi}`;
    const last = s.end ? sql`GREATEST(${day(s.end.id)}, ${start})` : start;
    return sql`${start} <= ${hi} AND ${last} >= ${lo}`;
}

/** Filas crudas → picks + total de eventos del rango (y por fuente). */
export function readPicks(rows: Array<Record<string, unknown>>): { picks: CalendarPick[]; total: number; perSource: Record<string, number> } {
    let total = 0;
    let perSource: Record<string, number> = {};
    const picks = rows.map((r) => {
        total = Number(r.total ?? 0);
        if (r.per_source && typeof r.per_source === 'object') {
            perSource = Object.fromEntries(Object.entries(r.per_source as Record<string, unknown>).map(([k, v]) => [k, Number(v)]));
        }
        return { src: String(r.src), id: Number(r.id), day: String(r.day), n: Number(r.n ?? 0) };
    });
    return { picks, total, perSource };
}
