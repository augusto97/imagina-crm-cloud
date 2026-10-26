import { BadRequestException } from '@nestjs/common';
import {
    dayRangeInstants,
    datetimeFilterRange as sharedDatetimeFilterRange,
    FALLBACK_TIME_ZONE,
    isDataField,
    isSystemField,
    isThroughField,
    jsonbKeyForField,
    systemFieldBaseType,
    parseCustomDateRange,
    parseDateRangePreset,
    presetDateRange,
    relativeRangeFor as sharedRelativeRangeFor,
    type DateRangePreset,
    type FieldType,
    type FilterCondition,
    type FilterNode,
    type FilterOperator,
} from '@imagina-base/shared';
import { and, or, sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';

export interface FilterableField {
    id: number;
    type: FieldType;
    /**
     * v0.1.170 — expresión SQL YA tipada que reemplaza a la del JSONB. La
     * usan los campos `rollup`: su valor no vive en `data`, es una
     * subconsulta correlacionada sobre `relations` (ver through-fields.ts).
     * Sin `expr`, un rollup no es filtrable ni ordenable y se descarta.
     */
    expr?: SQL;
    /** Cómo comparar `expr`: numérico (count/sum/…) o texto (min/max de fecha). */
    valueKind?: 'numeric' | 'text';
    /**
     * v0.1.300 — clave de AGRUPADO propia (columnas de sistema: una fecha se agrupa
     * por día en el reloj de la empresa). Sin ella, `(expr)::text`.
     */
    groupExpr?: SQL;
    /**
     * Fórmulas (A1) — el tipo SQL de `expr` (cómo se filtra: número, texto,
     * sí/no, fecha o fecha y hora) o, si no compila, por qué (`formulaReason`).
     */
    formulaKind?: 'number' | 'text' | 'boolean' | 'date' | 'datetime';
    formulaReason?: string;
}

/**
 * Referencia a la columna JSONB. Por defecto `records.data` (la tabla del
 * listado); los rollups compilan su filtro contra los registros del OTRO
 * lado, aliasados como `rr` en la subconsulta (v0.1.170).
 */
export type DataRef = SQL | typeof records.data;

/** Tipos que no admiten WHERE (viven fuera de `data`) — CONTRACT.md §4. */
const NON_FILTERABLE: readonly FieldType[] = ['relation', 'computed', 'lookup'];

/**
 * La clave JSONB (`f{id}`, id numérico validado) se inyecta como LITERAL, no
 * como bind param: así la misma expresión matchea entre SELECT y GROUP BY
 * (Postgres compara por árbol de parseo, y `$1` vs `$2` no matchean).
 */
function keyLit(key: string): SQL {
    if (!/^f\d+$/.test(key)) throw new BadRequestException('Clave de campo inválida');
    return sql.raw(`'${key}'`);
}

/**
 * Compila un filter tree a una condición SQL sobre `records.data` (JSONB).
 *
 * Whitelist estricta (regla de oro nº 4): cada condición referencia un
 * `field_id`; se resuelve al field de la lista y a una expresión JSONB tipada
 * (`(data->>'fN')::numeric`, `::date`, …, con cast tolerante). El valor JAMÁS se interpola —
 * siempre viaja como parámetro. Condiciones sobre campos inexistentes o no
 * filtrables se descartan (igual que el plugin).
 */
export function compileFilterTree(
    fieldsById: Map<number, FilterableField>,
    tree: FilterNode | undefined,
    clock: Date | QueryClock,
    dataRef: DataRef = records.data,
): SQL | undefined {
    if (!tree) return undefined;
    const c: QueryClock = clock instanceof Date ? { now: clock, timeZone: FALLBACK_TIME_ZONE } : clock;
    return compileNode(fieldsById, tree, c, dataRef);
}

/**
 * v0.1.263 — "Ahora" y la zona de la EMPRESA: "hoy", "esta semana" y los
 * rangos de fechas se cuentan en su reloj. Con un `Date` suelto se usa UTC.
 */
export interface QueryClock {
    now: Date;
    timeZone: string;
    /**
     * C1 — los equipos de quien pide: resuelven el valor `$my_teams` de un
     * filtro sobre un campo «Equipo» («es uno de mis equipos»). Sin ellos no
     * coincide nada (falla cerrado).
     */
    myTeamIds?: readonly number[];
}

function compileNode(
    fieldsById: Map<number, FilterableField>,
    node: FilterNode,
    now: QueryClock,
    dataRef: DataRef,
): SQL | undefined {
    if (node.type === 'group') {
        const parts = node.children
            .map((c) => compileNode(fieldsById, c, now, dataRef))
            .filter((c): c is SQL => c !== undefined);
        if (parts.length === 0) return undefined;
        return node.logic === 'or' ? or(...parts) : and(...parts);
    }
    return compileCondition(fieldsById, node, now, dataRef);
}

function compileCondition(
    fieldsById: Map<number, FilterableField>,
    cond: FilterCondition,
    now: QueryClock,
    dataRef: DataRef,
): SQL | undefined {
    const field = fieldsById.get(cond.field_id);
    if (!field) return undefined; // whitelist: campo desconocido → se descarta
    // v0.1.188 — la DESCRIPCIÓN del registro (texto plano generado) entra en
    // la búsqueda como pseudo-campo; sólo lo inyecta el servidor.
    if (field.id === DESCRIPTION_SEARCH_FIELD_ID) {
        return compileDescriptionText(cond);
    }
    // v0.1.170 / v0.1.200 — un campo DERIVADO filtra por la subconsulta
    // correlacionada que le armó el motor (rollup, y desde v0.1.200 también
    // lookup). Si no la tiene —config a medias, relación borrada, lookup
    // hacia un `computed`— no es filtrable y la condición se descarta.
    // v0.1.229 — también un `computed` numérico (su expresión la arma
    // `withComputedExprs`); sin expresión se descarta como antes.
    // v0.1.291 — y el tiempo registrado (suma de `time_entries`).
    // A9 — y el progreso del checklist (% de ítems hechos).
    if (isThroughField(field.type) || field.type === 'computed' || field.type === 'time_tracked' || field.type === 'checklist_progress') {
        return field.expr ? compileOverride(field.expr, field.valueKind ?? 'numeric', cond) : undefined;
    }
    // C5 — «Aprobación»: el estado de la última solicitud (subconsulta sobre la
    // fila de `records`, por eso sólo en la consulta principal).
    if (field.type === 'approval') {
        return field.expr && dataRef === records.data ? compileApprovalCondition(field.expr, cond) : undefined;
    }
    // Fórmulas (A1): por su expresión SQL y según el tipo de su resultado. Sin
    // expresión (no compila a SQL) no es filtrable y la condición se descarta.
    // Sólo en la consulta principal: la expresión apunta a la fila de `records`.
    if (field.type === 'formula') {
        return field.expr && field.formulaKind && dataRef === records.data
            ? compileFormulaCondition(field.expr, field.formulaKind, cond, now)
            : undefined;
    }
    // v0.1.300 — columnas de sistema: la columna de `records` como fecha y hora o
    // como persona. Sólo en la consulta principal (en la subconsulta de un
    // rollup el registro tiene otro alias).
    if (isSystemField(field.type)) {
        return field.expr && dataRef === records.data ? compileSystem(field.expr, systemFieldBaseType(field.type), cond, now) : undefined;
    }
    // v0.1.252 — una relación vive en la tabla `relations`, no en `data`:
    // antes se descartaba y «sin vínculos» devolvía TODO (por API, por el MCP
    // o en la condición de una automatización). Sólo en la consulta principal
    // (dentro de la subconsulta de un rollup el registro tiene otro alias).
    if (field.type === 'relation') {
        return dataRef === records.data ? compileRelation(field.id, cond) : undefined;
    }
    if (!isDataField(field.type) || NON_FILTERABLE.includes(field.type)) {
        return undefined; // no filtrable → se descarta
    }

    const key = jsonbKeyForField(field.id);
    const op = cond.op;

    if (field.type === 'multi_select') {
        return compileMultiSelect(key, op, cond.value, dataRef);
    }
    // C1 — un campo «Equipo» guarda un ARRAY de ids de equipo.
    if (field.type === 'team') {
        return compileTeam(key, op, cond.value, dataRef, now.myTeamIds ?? []);
    }
    // v0.1.191 — `file` guarda una LISTA de ids de adjuntos: lo único que se
    // filtra es "tiene archivos / no tiene". `(data->>'fN') IS NULL` daba
    // falso con `[]` (la clave existe, su texto es "[]"), así que "sin
    // archivos" no encontraba a los que se los quitaron; y `eq`/`in` contra
    // el texto del array nunca matcheaban → se descartan.
    if (field.type === 'file') {
        return compileJsonArrayPresence(key, op, dataRef);
    }

    // v0.1.286 — fecha y hora: "es" abarca el minuto (o el día, si el valor
    // es sólo una fecha) y un valor sin zona se lee en la zona de la empresa.
    if (field.type === 'datetime') {
        const ranged = compileDatetimeComparison(typedExpr(key, field.type, dataRef), op, cond.value, now.timeZone);
        if (ranged !== null) return ranged;
    }

    // Expresión de texto base y expresión tipada según el tipo del campo.
    const asText = sql`(${dataRef} ->> ${keyLit(key)})`;

    switch (op) {
        case 'is_null':
            return sql`${asText} IS NULL`;
        case 'is_not_null':
            return sql`${asText} IS NOT NULL`;
        case 'contains':
            return sql`${asText} ILIKE ${'%' + escapeLike(str(cond.value)) + '%'}`;
        case 'not_contains':
            return sql`(${asText} IS NULL OR ${asText} NOT ILIKE ${'%' + escapeLike(str(cond.value)) + '%'})`;
        case 'starts_with':
            return sql`${asText} ILIKE ${escapeLike(str(cond.value)) + '%'}`;
        case 'ends_with':
            return sql`${asText} ILIKE ${'%' + escapeLike(str(cond.value))}`;
        case 'in':
        case 'nin': {
            const values = toArray(cond.value).map(str);
            if (values.length === 0) return op === 'in' ? sql`false` : undefined;
            // `IN (…)` con un parámetro por valor, no `= ANY($n)`: drizzle
            // expande un array JS del template como lista de placeholders, y
            // ANY exige un array de Postgres del otro lado — rompía al
            // compilar esta condición dentro de la subconsulta de un rollup
            // (v0.1.171). `IN` es correcto en los dos contextos.
            const membership = sql`${asText} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
            return op === 'in' ? membership : sql`(${asText} IS NULL OR NOT (${membership}))`;
        }
        case 'between_relative': {
            const expr = typedExpr(key, field.type, dataRef);
            // v0.1.105 — además del preset relativo, el value acepta un rango
            // FIJO `{from, to}` (YYYY-MM-DD) para el período personalizado de
            // dashboards. Para datetime el día "to" incluye hasta las
            // 23:59:59 (mismo criterio que computePresetRange).
            const custom = asCustomRange(cond.value);
            if (custom !== null) {
                // v0.1.263 — para un datetime, el día empieza y termina en el
                // reloj de la empresa (antes, a la medianoche UTC).
                const range = field.type === 'datetime' ? dayRangeInstants(custom.from, custom.to, now.timeZone) : custom;
                return sql`(${expr} >= ${range.from} AND ${expr} <= ${range.to})`;
            }
            const range = computePresetRange(asPreset(cond.value), field.type, now);
            return sql`(${expr} >= ${range.from} AND ${expr} <= ${range.to})`;
        }
        case 'eq':
        case 'neq':
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            return compileComparison(typedExpr(key, field.type, dataRef), field.type, op, cond.value);
        default: {
            const _exhaustive: never = op;
            throw new BadRequestException(`Operador no soportado: ${String(_exhaustive)}`);
        }
    }
}

/**
 * v0.1.188 — id RESERVADO (negativo: jamás choca con un campo real) con el
 * que la búsqueda server-side incluye el texto plano de la descripción del
 * registro (`records.description_text`, columna generada). Los filter trees
 * que llegan del cliente pasan por Zod (`field_id` positivo), así que sólo
 * el servidor puede componer una condición sobre él.
 */
export const DESCRIPTION_SEARCH_FIELD_ID = -1;

/** Entrada del whitelist para el pseudo-campo de la descripción. */
export function descriptionSearchFilterable(): [number, FilterableField] {
    return [
        DESCRIPTION_SEARCH_FIELD_ID,
        { id: DESCRIPTION_SEARCH_FIELD_ID, type: 'long_text', expr: sql`${records.descriptionText}` },
    ];
}

/** Sólo operadores de TEXTO: la descripción se busca, no se compara. */
function compileDescriptionText(cond: FilterCondition): SQL | undefined {
    const col = sql`${records.descriptionText}`;
    switch (cond.op) {
        case 'is_null':
            return sql`${col} IS NULL`;
        case 'is_not_null':
            return sql`${col} IS NOT NULL`;
        case 'contains':
            return sql`${col} ILIKE ${'%' + escapeLike(str(cond.value)) + '%'}`;
        case 'not_contains':
            return sql`(${col} IS NULL OR ${col} NOT ILIKE ${'%' + escapeLike(str(cond.value)) + '%'})`;
        default:
            return undefined;
    }
}

/**
 * Condición sobre una expresión inyectada (rollup, lookup). Los operadores
 * escalares —comparar, nulo / no nulo— y, cuando la expresión es de TEXTO
 * (v0.1.200: el valor de un lookup), también los de subcadena: "la ciudad
 * del cliente contiene…" es justo lo que se filtra en un CRM. El resto no
 * aplica y se descarta.
 */
function compileOverride(
    expr: SQL,
    kind: 'numeric' | 'text',
    cond: FilterCondition,
): SQL | undefined {
    const type: FieldType = kind === 'numeric' ? 'number' : 'text';
    switch (cond.op) {
        case 'is_null':
            return sql`${expr} IS NULL`;
        case 'is_not_null':
            return sql`${expr} IS NOT NULL`;
        case 'eq':
        case 'neq':
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            return compileComparison(expr, type, cond.op, cond.value);
        case 'contains':
        case 'not_contains':
        case 'starts_with':
        case 'ends_with': {
            if (kind !== 'text') return undefined;
            const needle = escapeLike(str(cond.value));
            const pattern =
                cond.op === 'starts_with'
                    ? `${needle}%`
                    : cond.op === 'ends_with'
                      ? `%${needle}`
                      : `%${needle}%`;
            // `not_contains` incluye los nulos a propósito: un registro sin
            // vinculados tampoco contiene el texto buscado.
            return cond.op === 'not_contains'
                ? sql`(${expr} IS NULL OR ${expr} NOT ILIKE ${pattern})`
                : sql`${expr} ILIKE ${pattern}`;
        }
        default:
            return undefined;
    }
}

/**
 * C5 — Condición sobre el campo «Aprobación» (estado de la última solicitud).
 * Se compara como una selección: «es» / «no es» / «alguno de» / «ninguno de» y
 * vacío = «sin pedir». Los valores son los estados del catálogo; cualquier
 * otro texto simplemente no coincide (va bindeado, nunca interpolado).
 */
function compileApprovalCondition(expr: SQL, cond: FilterCondition): SQL | undefined {
    switch (cond.op) {
        case 'is_null':
            return sql`${expr} IS NULL`;
        case 'is_not_null':
            return sql`${expr} IS NOT NULL`;
        case 'eq':
            return sql`${expr} = ${str(cond.value)}`;
        case 'neq':
            return sql`${expr} IS DISTINCT FROM ${str(cond.value)}`;
        case 'in':
        case 'nin': {
            const values = toArray(cond.value).map(str).filter((v) => v !== '');
            if (values.length === 0) return cond.op === 'in' ? sql`false` : undefined;
            const membership = sql`${expr} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
            return cond.op === 'in' ? membership : sql`(${expr} IS NULL OR NOT (${membership}))`;
        }
        default:
            return undefined;
    }
}

/**
 * v0.1.300 — Condición sobre una columna de sistema (`created_at`, `updated_by`…).
 * Una fecha compara igual que un campo «fecha y hora» (el día en el reloj de
 * la empresa, «hoy», «este mes»); una persona, por su id como el campo
 * persona.
 */
function compileSystem(expr: SQL, base: 'datetime' | 'user', cond: FilterCondition, now: QueryClock): SQL | undefined {
    const op = cond.op;
    if (op === 'is_null') return sql`(${expr}) IS NULL`;
    if (op === 'is_not_null') return sql`(${expr}) IS NOT NULL`;
    if (base === 'datetime') {
        const ranged = compileDatetimeComparison(expr, op, cond.value, now.timeZone);
        if (ranged !== null) return ranged;
        if (op === 'between_relative') {
            const custom = asCustomRange(cond.value);
            if (custom !== null) {
                const range = dayRangeInstants(custom.from, custom.to, now.timeZone);
                return sql`(${expr} >= ${range.from} AND ${expr} <= ${range.to})`;
            }
            const range = computePresetRange(asPreset(cond.value), 'datetime', now);
            return sql`(${expr} >= ${range.from} AND ${expr} <= ${range.to})`;
        }
        return undefined;
    }
    const asText = sql`(${expr})::text`;
    switch (op) {
        case 'eq':
            return sql`${asText} = ${str(cond.value)}`;
        case 'neq':
            return sql`${asText} IS DISTINCT FROM ${str(cond.value)}`;
        case 'in':
        case 'nin': {
            const values = toArray(cond.value).map(str);
            if (values.length === 0) return op === 'in' ? sql`false` : undefined;
            const membership = sql`${asText} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
            return op === 'in' ? membership : sql`(${asText} IS NULL OR NOT (${membership}))`;
        }
        default:
            return undefined;
    }
}

/**
 * Fórmulas (A1) — condición sobre la expresión de una fórmula según el tipo
 * de su resultado: un número o un texto como un derivado, un sí/no como una
 * casilla, una fecha como un campo fecha («hoy», «este mes») y una fecha y
 * hora como las columnas de sistema.
 */
function compileFormulaCondition(
    expr: SQL,
    kind: NonNullable<FilterableField['formulaKind']>,
    cond: FilterCondition,
    now: QueryClock,
): SQL | undefined {
    const op = cond.op;
    switch (kind) {
        case 'number':
            return compileOverride(expr, 'numeric', cond);
        case 'text': {
            if (op === 'in' || op === 'nin') {
                const values = toArray(cond.value).map(str);
                if (values.length === 0) return op === 'in' ? sql`false` : undefined;
                const membership = sql`(${expr}) IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
                return op === 'in' ? membership : sql`((${expr}) IS NULL OR NOT (${membership}))`;
            }
            return compileOverride(expr, 'text', cond);
        }
        case 'boolean': {
            const on = cond.value === true || cond.value === 1 || cond.value === 'true' || cond.value === '1';
            if (op === 'eq') return on ? sql`(${expr}) IS TRUE` : sql`(${expr}) IS NOT TRUE`;
            if (op === 'neq') return on ? sql`(${expr}) IS NOT TRUE` : sql`(${expr}) IS TRUE`;
            if (op === 'is_null') return sql`(${expr}) IS NOT TRUE`;
            if (op === 'is_not_null') return sql`(${expr}) IS TRUE`;
            return undefined;
        }
        case 'datetime':
            return compileSystem(expr, 'datetime', cond, now);
        case 'date': {
            if (op === 'is_null') return sql`(${expr}) IS NULL`;
            if (op === 'is_not_null') return sql`(${expr}) IS NOT NULL`;
            if (op === 'between_relative') {
                const custom = asCustomRange(cond.value);
                const range = custom ?? computePresetRange(asPreset(cond.value), 'date', now);
                return sql`((${expr}) >= ${range.from}::date AND (${expr}) <= ${range.to}::date)`;
            }
            if (op === 'eq' || op === 'neq' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
                return compileComparison(sql`(${expr})`, 'date', op, cond.value);
            }
            return undefined;
        }
    }
}

function compileComparison(
    expr: SQL,
    type: FieldType,
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
    rawValue: unknown,
): SQL {
    const value = castValue(type, rawValue);
    switch (op) {
        case 'eq':
            return sql`${expr} = ${value}`;
        case 'neq':
            // IS DISTINCT FROM trata NULL como valor (neq de X incluye los null).
            return sql`${expr} IS DISTINCT FROM ${value}`;
        case 'gt':
            return sql`${expr} > ${value}`;
        case 'gte':
            return sql`${expr} >= ${value}`;
        case 'lt':
            return sql`${expr} < ${value}`;
        case 'lte':
            return sql`${expr} <= ${value}`;
    }
}

/**
 * v0.1.286 — comparación sobre un campo FECHA Y HORA. El valor del filtro se
 * lee como un intervalo:
 *  - sólo fecha (`2026-10-21`): el día entero en el reloj de la empresa;
 *  - fecha y hora SIN zona (`2026-10-21T14:30`, lo que mandaba el selector):
 *    ese minuto en el reloj de la empresa — antes `::timestamptz` lo leía en
 *    UTC y en Colombia el filtro quedaba corrido 5 horas;
 *  - con zona (`…Z`, `…-05:00`): el minuto de ese instante.
 * "es" = dentro del intervalo; "no es" = fuera; ">" = después; "≥" = desde
 * el inicio; "<" = antes del inicio; "≤" = hasta el final. Un valor que no se
 * puede leer devuelve null y cae a la comparación de siempre.
 */
function compileDatetimeComparison(expr: SQL, op: FilterOperator, value: unknown, timeZone: string): SQL | null {
    if (op !== 'eq' && op !== 'neq' && op !== 'gt' && op !== 'gte' && op !== 'lt' && op !== 'lte') return null;
    const range = datetimeFilterRange(value, timeZone);
    if (range === null) return null;
    const { from, to } = range;
    switch (op) {
        case 'eq':
            return sql`(${expr} >= ${from} AND ${expr} < ${to})`;
        case 'neq':
            return sql`(${expr} IS NULL OR ${expr} < ${from} OR ${expr} >= ${to})`;
        case 'gt':
            return sql`${expr} >= ${to}`;
        case 'gte':
            return sql`${expr} >= ${from}`;
        case 'lt':
            return sql`${expr} < ${from}`;
        case 'lte':
            return sql`${expr} < ${to}`;
    }
}

/**
 * Intervalo `[from, to)` (instantes ISO) de un valor de filtro de fecha y hora.
 * v0.1.287 — la implementación vive en `packages/shared` (la usan también los
 * colores condicionales de la tabla, que evalúan en el navegador).
 */
export function datetimeFilterRange(value: unknown, timeZone: string): { from: string; to: string } | null {
    return sharedDatetimeFilterRange(value, timeZone);
}

/** Expresión de texto JSONB de un campo: `(data->>'fN')`. */
export function fieldTextExpr(fieldId: number): SQL {
    return sql`(${records.data} ->> ${keyLit(jsonbKeyForField(fieldId))})`;
}

/**
 * Expresión JSONB tipada de un campo (numeric/date/timestamptz/text). Un
 * campo con `expr` inyectada (rollup) devuelve esa expresión tal cual.
 */
export function fieldTypedExpr(field: FilterableField, dataRef: DataRef = records.data): SQL {
    if (field.expr) return field.expr;
    return typedExpr(jsonbKeyForField(field.id), field.type, dataRef);
}

/**
 * Expresión JSONB tipada por tipo de campo (STANDALONE.md §3.3).
 *
 * El cast es TOLERANTE: un valor que no se puede convertir (una fecha
 * «mañana» que escribió una automatización vieja, un número «150.000,5»
 * importado a mano) da NULL en vez de tirar la consulta entera. Antes un
 * solo valor basura en una fila hacía que ordenar, filtrar por fecha, los
 * agregados y el escaneo de vencimientos de TODA la lista respondieran 500.
 * `pg_input_is_valid` (Postgres 16) valida sin lanzar.
 */
function typedExpr(key: string, type: FieldType, dataRef: DataRef): SQL {
    const asText = sql`(${dataRef} ->> ${keyLit(key)})`;
    switch (type) {
        case 'number':
        case 'currency':
        case 'rating':
        case 'percent':
        case 'duration':
            // v0.1.158 — rating/percent/duration guardan un número (estrellas,
            // 0-100 y minutos): comparan y ordenan con el motor numérico, no
            // como texto (donde '9' > '10').
            return safeCast(asText, 'numeric');
        case 'date':
            return safeCast(asText, 'date');
        case 'datetime':
            return safeCast(asText, 'timestamptz');
        default:
            return asText;
    }
}

/** `CASE WHEN pg_input_is_valid(x, 'tipo') THEN x::tipo END` — NULL si no convierte. */
function safeCast(asText: SQL, type: 'numeric' | 'date' | 'timestamptz'): SQL {
    // El tipo es un literal fijo de esta función (nunca input del usuario).
    return sql`(CASE WHEN pg_input_is_valid(${asText}, ${sql.raw(`'${type}'`)}) THEN ${asText}::${sql.raw(type)} END)`;
}

const NUMERIC_FILTER_TYPES: readonly FieldType[] = [
    'number', 'currency', 'rating', 'percent', 'duration',
];

function castValue(type: FieldType, value: unknown): number | string {
    if (NUMERIC_FILTER_TYPES.includes(type)) {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
            throw new BadRequestException('Valor numérico inválido en el filtro');
        }
        return n;
    }
    return str(value);
}

function compileMultiSelect(
    key: string,
    op: FilterOperator,
    value: unknown,
    dataRef: DataRef,
): SQL | undefined {
    const arr = sql`(${dataRef} -> ${keyLit(key)})`;
    switch (op) {
        // v0.1.224 — vacío = sin clave, `[]` o `null` JSON (lo que queda al
        // vaciar el campo). Antes el `null` JSON no contaba: el grupo
        // "(Sin valor)" de la vista agrupada contaba el registro pero no lo
        // mostraba, y el filtro "está vacío" no lo encontraba.
        case 'is_null':
            return emptyArray(arr);
        case 'is_not_null':
            return sql`NOT ${emptyArray(arr)}`;
        // v0.1.190 — `eq`/`neq` con un ARRAY comparan el CONJUNTO exacto
        // (sin importar el orden ni duplicados): es lo que necesita la vista
        // agrupada, cuyo grupo es la combinación de opciones, como en
        // ClickUp. Con un valor escalar siguen siendo "contiene".
        case 'eq':
            if (Array.isArray(value)) return exactSet(arr, toArray(value).map(str));
            return sql`${arr} @> to_jsonb(${str(value)}::text)`;
        case 'contains':
            return sql`${arr} @> to_jsonb(${str(value)}::text)`;
        case 'neq':
            if (Array.isArray(value)) return sql`(${arr} IS NULL OR NOT ${exactSet(arr, toArray(value).map(str))})`;
            return sql`(${arr} IS NULL OR NOT (${arr} @> to_jsonb(${str(value)}::text)))`;
        case 'not_contains':
            return sql`(${arr} IS NULL OR NOT (${arr} @> to_jsonb(${str(value)}::text)))`;
        case 'in': {
            const values = toArray(value).map(str);
            return values.length === 0 ? sql`false` : sql`${arr} ?| ${textArray(values)}`;
        }
        case 'nin': {
            const values = toArray(value).map(str);
            return values.length === 0
                ? undefined
                : sql`(${arr} IS NULL OR NOT (${arr} ?| ${textArray(values)}))`;
        }
        default:
            // starts_with/ends_with/gt/… no aplican a multi_select → se descartan.
            return undefined;
    }
}

/**
 * C1 — Condición sobre un campo «Equipo» (array de ids numéricos):
 *  - `eq`/`contains` con un id = «incluye ese equipo»; `eq` con un ARRAY =
 *    el conjunto exacto (lo usa la vista agrupada: el grupo es la combinación).
 *  - `in` = incluye ALGUNO; `$my_teams` dentro del valor = los equipos de
 *    quien pide (sin equipos no coincide nada).
 *  - `neq`/`not_contains`/`nin` = las negaciones (los vacíos cuentan).
 * Los ids viajan como parámetros (`jsonb_build_array($n::bigint)`).
 */
function compileTeam(
    key: string,
    op: FilterOperator,
    value: unknown,
    dataRef: DataRef,
    myTeamIds: readonly number[],
): SQL | undefined {
    const arr = sql`(${dataRef} -> ${keyLit(key)})`;
    const raw = toArray(value);
    const mine = raw.includes(MY_TEAMS_VALUE);
    const ids = [...new Set([...raw.filter((v) => v !== MY_TEAMS_VALUE), ...(mine ? myTeamIds : [])].map(Number))]
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 200);
    const anyOf = (list: number[]): SQL =>
        list.length === 0 ? sql`false` : sql`(${sql.join(list.map((id) => sql`${arr} @> jsonb_build_array(${id}::bigint)`), sql` OR `)})`;
    switch (op) {
        case 'is_null':
            return emptyArray(arr);
        case 'is_not_null':
            return sql`NOT ${emptyArray(arr)}`;
        case 'eq':
            if (Array.isArray(value) && !mine) {
                if (ids.length === 0) return emptyArray(arr);
                const set = sql`to_jsonb(ARRAY[${sql.join(ids.map((id) => sql`${id}::bigint`), sql`, `)}])`;
                return sql`(${arr} @> ${set} AND ${arr} <@ ${set})`;
            }
            return ids.length === 0 && !mine ? undefined : anyOf(ids);
        case 'contains':
        case 'in':
            return ids.length === 0 && !mine && op === 'contains' ? undefined : anyOf(ids);
        case 'neq':
            if (Array.isArray(value) && !mine) {
                if (ids.length === 0) return sql`NOT ${emptyArray(arr)}`;
                const set = sql`to_jsonb(ARRAY[${sql.join(ids.map((id) => sql`${id}::bigint`), sql`, `)}])`;
                return sql`(${arr} IS NULL OR NOT (${arr} @> ${set} AND ${arr} <@ ${set}))`;
            }
            if (ids.length === 0) return mine ? undefined : undefined;
            return sql`(${arr} IS NULL OR NOT ${anyOf(ids)})`;
        case 'not_contains':
        case 'nin':
            if (ids.length === 0) return undefined;
            return sql`(${arr} IS NULL OR NOT ${anyOf(ids)})`;
        default:
            return undefined;
    }
}

/** Valor especial «es uno de mis equipos» (`MY_TEAMS_TOKEN` de shared). */
const MY_TEAMS_VALUE = '$my_teams';

/**
 * Presencia de un array JSONB: vacío = ausente, `null` JSON o `[]`.
 * (`->` sobre `{"fN": null}` devuelve JSON null, que NO es SQL NULL.)
 */
function compileJsonArrayPresence(key: string, op: FilterOperator, dataRef: DataRef): SQL | undefined {
    const arr = sql`(${dataRef} -> ${keyLit(key)})`;
    switch (op) {
        case 'is_null':
            return sql`(${arr} IS NULL OR jsonb_typeof(${arr}) <> 'array' OR ${arr} = '[]'::jsonb)`;
        case 'is_not_null':
            return sql`(jsonb_typeof(${arr}) = 'array' AND ${arr} <> '[]'::jsonb)`;
        default:
            return undefined;
    }
}

/** Un multi_select sin opciones: sin clave, `null` JSON o `[]`. */
function emptyArray(arr: SQL): SQL {
    return sql`(${arr} IS NULL OR jsonb_typeof(${arr}) <> 'array' OR ${arr} = '[]'::jsonb)`;
}

/** Igualdad de conjuntos: `arr ⊇ set AND arr ⊆ set`; el set vacío = sin opciones. */
function exactSet(arr: SQL, values: string[]): SQL {
    if (values.length === 0) return emptyArray(arr);
    const set = sql`to_jsonb(${textArray(values)})`;
    return sql`(${arr} @> ${set} AND ${arr} <@ ${set})`;
}

/**
 * `ARRAY[$1, $2, …]::text[]` — un array de Postgres CONSTRUIDO con un
 * parámetro por valor. Interpolar el array JS directo funciona en el
 * builder de drizzle pero no dentro de una subconsulta cruda (rollup).
 */
function textArray(values: string[]): SQL {
    return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

// --- Presets de rango relativo (se resuelven contra `now` en cada query) ---

export interface Range {
    from: string;
    to: string;
}

/** v0.1.287 — el cálculo del rango vive en `packages/shared` (`presetDateRange`). */
function computePresetRange(preset: DateRangePreset, type: FieldType, clock: QueryClock): Range {
    return presetDateRange(preset, type, clock);
}

/**
 * v0.1.286 — El rango de CALENDARIO (YYYY-MM-DD, inclusive) que representa el
 * valor de un `between_relative` (preset o `{from, to}`), en el reloj de la
 * empresa. Lo usa el widget de delta: su ventana actual ES el período. `null`
 * si el valor no es un período válido.
 */
export function relativeDateRange(value: unknown, clock: QueryClock): { from: string; to: string } | null {
    return relativeRangeFor(value, 'date', clock);
}

/**
 * El rango de un `between_relative` (preset «este mes» o rango fijo
 * `{from, to}`) en el reloj de la empresa: fechas YYYY-MM-DD para un campo
 * fecha, instantes ISO para un fecha-hora. `null` si el valor no es válido.
 * Lo comparten el SQL de los filtros y el evaluador de condiciones (que
 * evalúa en memoria): así «este mes» es el mismo mes.
 */
export function relativeRangeFor(value: unknown, type: 'date' | 'datetime', clock: QueryClock): Range | null {
    return sharedRelativeRangeFor(value, type, clock);
}

// --- helpers ---

function str(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new BadRequestException('Valor de filtro inválido (se esperaba escalar)');
}

function toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

/** Rango fijo `{from, to}` (YYYY-MM-DD) del período personalizado, o null. */
function asCustomRange(value: unknown): { from: string; to: string } | null {
    const custom = parseCustomDateRange(value);
    if (custom === 'invalid') {
        throw new BadRequestException('Rango personalizado inválido (se espera YYYY-MM-DD)');
    }
    return custom;
}

function asPreset(value: unknown): DateRangePreset {
    // SEC-19: validar contra el enum. Un preset desconocido dejaba from/to en
    // undefined → TypeError → 500. Ahora es un 400 explícito.
    const preset = parseDateRangePreset(value);
    if (preset !== null) return preset;
    const raw =
        typeof value === 'string'
            ? value
            : value && typeof value === 'object' && 'preset' in value
              ? (value as { preset?: unknown }).preset
              : undefined;
    if (typeof raw !== 'string') {
        throw new BadRequestException('between_relative requiere el slug de un preset');
    }
    throw new BadRequestException(`Preset de fecha inválido: ${raw}`);
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Condición sobre un campo `relation`: «tiene vínculos» / «no tiene» y
 * «vinculado a» uno o varios registros (por id). Los vínculos a registros
 * borrados no cuentan, igual que al leer. El id del campo y los ids vienen
 * validados como enteros: viajan como parámetros.
 */
function compileRelation(fieldId: number, cond: { op: string; value?: unknown }): SQL | undefined {
    const linked = (extra: SQL | undefined) => sql`EXISTS (
        SELECT 1 FROM relations rel
        JOIN records tgt ON tgt.id = rel.target_record_id AND tgt.deleted_at IS NULL
        WHERE rel.source_record_id = ${records.id}
          AND rel.tenant_id = ${records.tenantId}
          AND rel.field_id = ${fieldId}${extra ? sql` AND ${extra}` : sql``}
    )`;
    switch (cond.op) {
        case 'is_not_null':
            return linked(undefined);
        case 'is_null':
            return sql`NOT ${linked(undefined)}`;
        case 'eq':
        case 'in':
        case 'contains': {
            const raw = Array.isArray(cond.value) ? cond.value : [cond.value];
            const ids = raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
            if (ids.length === 0) return undefined;
            return linked(sql`rel.target_record_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
        }
        case 'neq':
        case 'nin':
        case 'not_contains': {
            const raw = Array.isArray(cond.value) ? cond.value : [cond.value];
            const ids = raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
            if (ids.length === 0) return undefined;
            return sql`NOT ${linked(sql`rel.target_record_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)}`;
        }
        default:
            return undefined;
    }
}
