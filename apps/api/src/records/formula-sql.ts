import {
    FORMULA_RESULT_TYPES,
    formulaResultTypeOf,
    isSystemField,
    jsonbKeyForField,
    parseDateText,
    parseFormulaCached,
    storedRefId,
    systemFieldBaseType,
    zonedToday,
    type Field,
    type FieldType,
    type FormulaNode,
    type FormulaResultType,
} from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';
import { fieldTypedExpr, type FilterableField } from './query-builder';

/**
 * Fórmulas (opción A1) → SQL.
 *
 * Una fórmula se calcula en JS en cada lectura (`evaluateRowFormulas`), pero
 * para FILTRAR, ORDENAR, AGRUPAR y SUMARSE en el pie y en los tableros hace
 * falta una expresión SQL — como los computed numéricos (v0.1.229) y las
 * columnas de sistema (v0.1.300). Aquí se traduce el árbol a una expresión
 * TIPADA (numeric, text, boolean, date, timestamptz) con la MISMA semántica
 * del evaluador:
 *  - un campo vacío vale 0 en una cuenta y "" al unir textos (COALESCE sólo
 *    sobre lo que puede venir VACÍO, no sobre lo que dio error: una división
 *    por cero es NULL y propaga, como el #ERROR en JS);
 *  - los textos se comparan sin mayúsculas, el vacío sólo es igual al vacío;
 *  - la selección se lee por su ETIQUETA; las fechas y "hoy" en la zona de la
 *    empresa.
 *
 * Regla de oro nº 4: los textos y números de la fórmula viajan como
 * PARÁMETROS; las claves de campo salen del id validado (whitelist), y los
 * únicos literales SQL son los de este archivo.
 *
 * Lo que no tiene traducción fiel (días hábiles, expresiones regulares, dar
 * formato a fechas, listas de valores, personas…) NO compila: la fórmula se
 * muestra igual, pero no se ofrece para filtrar ni ordenar, con el motivo.
 */

export type SqlKind = 'number' | 'text' | 'boolean' | 'date' | 'datetime';

interface Compiled {
    sql: SQL;
    kind: SqlKind;
    /** Puede ser NULL porque viene de un campo VACÍO (cuenta como 0 / ""). */
    blank: boolean;
    /** Un literal `""` o `BLANCO()`: en un SI toma el tipo de la otra rama. */
    blankLiteral?: boolean;
    /** El texto literal (para leerlo como fecha o número al comparar). */
    literal?: string;
}

export class FormulaNotSql extends Error {}

const notSql = (reason: string): never => {
    throw new FormulaNotSql(reason);
};

export interface FormulaSqlContext {
    /** Todos los campos de la lista (por id). */
    fields: ReadonlyMap<number, Field>;
    /** Whitelist YA recortada por el ACL, con las expresiones de los derivados. */
    available: ReadonlyMap<number, FilterableField>;
    timeZone: string;
    now: Date;
}

interface Run extends FormulaSqlContext {
    visiting: Set<number>;
    cache: Map<number, Compiled | FormulaNotSql>;
}

/** Resultado de compilar el campo fórmula entero (con su tipo de resultado). */
export type FormulaSqlResult = { ok: true; expr: SQL; kind: SqlKind } | { ok: false; reason: string };

/**
 * Compila el campo fórmula `field` a una expresión SQL sobre la fila de
 * `records` (con el tipo de resultado efectivo aplicado). Nunca lanza.
 */
export function compileFormulaField(field: Field, ctx: FormulaSqlContext): FormulaSqlResult {
    const run: Run = { ...ctx, visiting: new Set(), cache: new Map() };
    try {
        const c = compileFieldRef(run, field);
        return { ok: true, expr: c.sql, kind: c.kind };
    } catch (e) {
        if (e instanceof FormulaNotSql) return { ok: false, reason: e.message };
        throw e;
    }
}

/** Una fórmula como valor de su tipo de resultado (memo por campo + ciclos). */
function compileFieldRef(run: Run, field: Field): Compiled {
    const hit = run.cache.get(field.id);
    if (hit instanceof FormulaNotSql) throw hit;
    if (hit) return hit;
    if (run.visiting.has(field.id)) notSql('las fórmulas se usan entre sí en círculo');
    if (run.visiting.size > 16) notSql('encadena demasiadas fórmulas');
    run.visiting.add(field.id);
    try {
        const cfg = (field.config ?? {}) as Record<string, unknown>;
        const text = typeof cfg.formula === 'string' ? cfg.formula : '';
        if (text.trim() === '') notSql('la fórmula está vacía');
        const parsed = parseFormulaCached(text);
        if (!parsed.ok) notSql('la fórmula tiene un error');
        const raw = parsed.ok ? compileNode(run, parsed.ast) : notSql('');
        const type = formulaResultTypeOf(field, { fields: run.fields as ReadonlyMap<number, Field> });
        const out = castToResult(run, raw, type);
        run.cache.set(field.id, out);
        return out;
    } catch (e) {
        if (e instanceof FormulaNotSql) run.cache.set(field.id, e);
        throw e;
    } finally {
        run.visiting.delete(field.id);
    }
}

// ─── Hojas ───────────────────────────────────────────────────────────────

function keyLit(fieldId: number): SQL {
    const key = jsonbKeyForField(fieldId);
    if (!/^f\d+$/.test(key)) notSql('clave inválida');
    return sql.raw(`'${key}'`);
}

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'rating', 'percent', 'duration'];
const TEXT_TYPES: readonly FieldType[] = ['text', 'long_text', 'email', 'url', 'phone', 'autonumber', 'ai'];

function compileRef(run: Run, name: string): Compiled {
    const id = storedRefId(name);
    const f = id === null ? undefined : run.fields.get(id);
    if (!f) return notSql('usa un campo que ya no existe');
    if (f.type === 'formula') {
        if (!run.available.has(f.id)) notSql(`usa «${f.label}», que no está disponible`);
        return compileFieldRef(run, f);
    }
    const ff = run.available.get(f.id);
    if (!ff) return notSql(`usa «${f.label}», que no está disponible`);
    const text = sql`(${records.data} ->> ${keyLit(f.id)})`;
    if (NUMERIC_TYPES.includes(f.type)) return { sql: fieldTypedExpr({ id: f.id, type: f.type }), kind: 'number', blank: true };
    if (TEXT_TYPES.includes(f.type)) return { sql: text, kind: 'text', blank: true };
    switch (f.type) {
        case 'select': {
            const options = Array.isArray((f.config as { options?: unknown }).options)
                ? ((f.config as { options: Array<{ value?: unknown; label?: unknown }> }).options)
                : [];
            const cases = options
                .filter((o) => typeof o?.value === 'string' && typeof o.label === 'string' && o.label !== '' && o.label !== o.value)
                .map((o) => sql`WHEN ${String(o.value)} THEN ${String(o.label)}::text`);
            if (cases.length === 0) return { sql: text, kind: 'text', blank: true };
            return { sql: sql`(CASE ${text} ${sql.join(cases, sql` `)} ELSE ${text} END)`, kind: 'text', blank: true };
        }
        case 'checkbox': {
            const raw = sql`(${records.data} -> ${keyLit(f.id)})`;
            // Misma regla que el evaluador: «0», «false», «no» y vacío son falso.
            return {
                sql: sql`(CASE WHEN ${raw} IS NULL OR jsonb_typeof(${raw}) = 'null' THEN false
                    WHEN jsonb_typeof(${raw}) = 'boolean' THEN (${text})::boolean
                    WHEN jsonb_typeof(${raw}) = 'number' THEN (${text})::numeric <> 0
                    ELSE lower(trim(${text})) NOT IN ('', '0', 'false', 'no') END)`,
                kind: 'boolean',
                blank: false,
            };
        }
        case 'date':
            return { sql: fieldTypedExpr({ id: f.id, type: 'date' }), kind: 'date', blank: true };
        case 'datetime':
            return { sql: fieldTypedExpr({ id: f.id, type: 'datetime' }), kind: 'datetime', blank: true };
        case 'time_tracked':
            if (!ff.expr) return notSql(`«${f.label}» no tiene expresión`);
            return { sql: sql`(${ff.expr})::numeric`, kind: 'number', blank: false };
        case 'computed':
            if (!ff.expr) return notSql(`usa «${f.label}», un calculado que no se puede llevar a la base`);
            return { sql: sql`(${ff.expr})::numeric`, kind: 'number', blank: true };
        case 'rollup':
            if (!ff.expr || ff.valueKind === 'text') return notSql(`usa «${f.label}», un rollup de fechas o sin configurar`);
            return { sql: sql`(${ff.expr})::numeric`, kind: 'number', blank: true };
        case 'lookup':
            return notSql(`usa «${f.label}», un lookup que puede traer varios valores`);
        case 'multi_select':
            return notSql(`usa «${f.label}», una selección múltiple`);
        case 'user':
            return notSql(`usa «${f.label}», un campo de persona`);
        case 'relation':
        case 'file':
            return notSql(`usa «${f.label}», que no se puede usar en una fórmula`);
        default:
            if (isSystemField(f.type)) {
                if (!ff.expr) return notSql(`«${f.label}» no tiene expresión`);
                if (systemFieldBaseType(f.type) === 'user') return notSql(`usa «${f.label}», un campo de persona`);
                return { sql: sql`(${ff.expr})`, kind: 'datetime', blank: false };
            }
            return notSql(`usa «${f.label}», de un tipo que no se puede llevar a la base`);
    }
}

// ─── Conversiones ────────────────────────────────────────────────────────

const NUMERIC_TEXT_RE = '^\\s*[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?\\s*$';

/** Como número en una cuenta: el vacío vale 0. */
function asNum(c: Compiled): SQL {
    switch (c.kind) {
        case 'number':
            return c.blank ? sql`COALESCE(${c.sql}, 0::numeric)` : c.sql;
        case 'boolean':
            return sql`(CASE WHEN ${c.sql} THEN 1 ELSE 0 END)::numeric`;
        case 'text': {
            if (c.literal !== undefined) {
                const t = c.literal.trim();
                if (t === '') return sql`0::numeric`;
                if (Number.isFinite(Number(t))) return sql`${Number(t)}::numeric`;
                return notSql(`«${c.literal}» no es un número`);
            }
            const t = c.blank ? sql`COALESCE(${c.sql}, '')` : c.sql;
            return sql`(CASE WHEN trim(${t}) = '' THEN 0::numeric WHEN ${t} ~ ${sql.raw(`'${NUMERIC_TEXT_RE}'`)} THEN trim(${t})::numeric END)`;
        }
        default:
            return notSql('hace cuentas con una fecha que no se pueden llevar a la base');
    }
}

/** Como texto al unir: el vacío es "". */
function asText(c: Compiled): SQL {
    switch (c.kind) {
        case 'text':
            return c.blank ? sql`COALESCE(${c.sql}, '')` : c.sql;
        case 'number':
            return sql`COALESCE(trim_scale(round((${c.sql})::numeric, 10))::text, '')`;
        case 'boolean':
            return sql`(CASE WHEN ${c.sql} THEN 'Sí' ELSE 'No' END)`;
        default:
            return notSql('convierte una fecha en texto (el formato de fecha de la empresa no se lleva a la base)');
    }
}

/** Como condición: vacío y 0 son falso. */
function asBool(c: Compiled): SQL {
    switch (c.kind) {
        case 'boolean':
            return sql`COALESCE(${c.sql}, false)`;
        case 'number':
            return sql`COALESCE((${c.sql}) <> 0, false)`;
        case 'text':
            return sql`(lower(trim(COALESCE(${c.sql}, ''))) NOT IN ('', 'falso', 'false', '0', 'no'))`;
        default:
            return sql`((${c.sql}) IS NOT NULL)`;
    }
}

/** Una fecha como instante (una fecha sin hora: su medianoche en la zona de la empresa). */
function asInstant(run: Run, c: Compiled): SQL {
    if (c.kind === 'datetime') return c.sql;
    if (c.kind === 'date') return sql`((${c.sql})::timestamp AT TIME ZONE ${run.timeZone})`;
    if (c.literal !== undefined) {
        const d = parseDateText(c.literal, {});
        if (d) return d.kind === 'date' ? sql`(${isoYmd(d.ms)}::timestamp AT TIME ZONE ${run.timeZone})` : sql`${new Date(d.ms).toISOString()}::timestamptz`;
    }
    return notSql('compara una fecha con algo que no es una fecha');
}

/** El día del calendario (de la empresa) de una fecha o fecha y hora. */
function asLocalDate(run: Run, c: Compiled): SQL {
    if (c.kind === 'date') return c.sql;
    if (c.kind === 'datetime') return sql`((${c.sql}) AT TIME ZONE ${run.timeZone})::date`;
    if (c.literal !== undefined) {
        const d = parseDateText(c.literal, {});
        if (d && d.kind === 'date') return sql`${isoYmd(d.ms)}::date`;
    }
    return notSql('usa como fecha algo que no es una fecha');
}

function isoYmd(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Un número que se usa como entero (cantidad de caracteres, días…), acotado. */
function asIntClamp(c: Compiled, lo = -1_000_000, hi = 1_000_000): SQL {
    return sql`LEAST(GREATEST(trunc(${asNum(c)}), ${lo}), ${hi})::int`;
}

// ─── Comparación ─────────────────────────────────────────────────────────

function compare(run: Run, op: string, a: Compiled, b: Compiled): SQL {
    const isDate = (c: Compiled) => c.kind === 'date' || c.kind === 'datetime';
    let x: SQL;
    let y: SQL;
    let textual = false;
    if (isDate(a) || isDate(b)) {
        if (a.kind === 'date' && b.kind === 'date') {
            x = a.sql;
            y = b.sql;
        } else {
            x = asInstant(run, a);
            y = asInstant(run, b);
        }
    } else if (a.kind === 'text' && b.kind === 'text') {
        x = sql`lower(NULLIF(${a.sql}, ''))`;
        y = sql`lower(NULLIF(${b.sql}, ''))`;
        textual = true;
    } else if ((a.kind === 'number' || a.kind === 'boolean') && (b.kind === 'number' || b.kind === 'boolean')) {
        x = a.kind === 'boolean' ? sql`(CASE WHEN ${a.sql} THEN 1 ELSE 0 END)::numeric` : a.sql;
        y = b.kind === 'boolean' ? sql`(CASE WHEN ${b.sql} THEN 1 ELSE 0 END)::numeric` : b.sql;
    } else if (a.kind === 'number' && b.kind === 'text' && b.literal !== undefined && Number.isFinite(Number(b.literal.trim())) && b.literal.trim() !== '') {
        x = a.sql;
        y = sql`${Number(b.literal.trim())}::numeric`;
    } else if (b.kind === 'number' && a.kind === 'text' && a.literal !== undefined && Number.isFinite(Number(a.literal.trim())) && a.literal.trim() !== '') {
        x = sql`${Number(a.literal.trim())}::numeric`;
        y = b.sql;
    } else {
        return notSql('compara valores de distinto tipo');
    }
    if (op === '=') return sql`(${x} IS NOT DISTINCT FROM ${y})`;
    if (op === '<>') return sql`(${x} IS DISTINCT FROM ${y})`;
    const sqlOp = sql.raw(op === '<' ? '<' : op === '>' ? '>' : op === '<=' ? '<=' : '>=');
    if (textual) return sql`COALESCE(${x} COLLATE "C" ${sqlOp} ${y} COLLATE "C", false)`;
    return sql`COALESCE(${x} ${sqlOp} ${y}, false)`;
}

// ─── Nodos ───────────────────────────────────────────────────────────────

function num(sqlExpr: SQL, blank = false): Compiled {
    return { sql: sqlExpr, kind: 'number', blank };
}

function compileNode(run: Run, node: FormulaNode): Compiled {
    switch (node.k) {
        case 'num':
            return num(sql`${node.v}::numeric`);
        case 'str':
            return { sql: sql`${node.v}::text`, kind: 'text', blank: false, literal: node.v, ...(node.v === '' ? { blankLiteral: true } : {}) };
        case 'bool':
            return { sql: node.v ? sql`true` : sql`false`, kind: 'boolean', blank: false };
        case 'ref':
            return compileRef(run, node.name);
        case 'neg':
            return num(sql`(-(${asNum(compileNode(run, node.arg))}))`);
        case 'pct':
            return num(sql`(${asNum(compileNode(run, node.arg))} / 100)`);
        case 'bin':
            return compileBinary(run, node.op, compileNode(run, node.l), compileNode(run, node.r));
        case 'call':
            return compileCall(run, node);
    }
}

function compileBinary(run: Run, op: string, l: Compiled, r: Compiled): Compiled {
    if (op === '&') return { sql: sql`(${asText(l)} || ${asText(r)})`, kind: 'text', blank: false };
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) return { sql: compare(run, op, l, r), kind: 'boolean', blank: false };
    const isDate = (c: Compiled) => c.kind === 'date' || c.kind === 'datetime';
    if (op === '+' || op === '-') {
        if (isDate(l) && !isDate(r)) return shiftDays(run, l, r, op === '-');
        if (op === '+' && isDate(r) && !isDate(l)) return shiftDays(run, r, l, false);
        if (op === '-' && isDate(l) && isDate(r)) {
            if (l.kind === 'date' && r.kind === 'date') return num(sql`((${l.sql}) - (${r.sql}))::numeric`, l.blank || r.blank);
            return num(sql`(extract(epoch from (${asInstant(run, l)} - ${asInstant(run, r)})) / 86400)::numeric`, true);
        }
    }
    const a = asNum(l);
    const b = asNum(r);
    switch (op) {
        case '+':
            return num(sql`(${a} + ${b})`);
        case '-':
            return num(sql`(${a} - ${b})`);
        case '*':
            return num(sql`(${a} * ${b})`);
        case '/':
            return num(sql`(${a} / NULLIF(${b}, 0))`);
        case '^':
            return num(power(a, b));
        case '%':
            return num(sql`(CASE WHEN ${b} = 0 THEN NULL ELSE ${a} - ${b} * floor(${a} / ${b}) END)`);
        default:
            return notSql(`operador «${op}»`);
    }
}

/**
 * Potencia sin tirar la consulta: Postgres LANZA con 0^-1, con un negativo
 * elevado a un decimal y con un resultado gigante — en esos casos NULL (en
 * JS son error).
 */
function power(a: SQL, b: SQL): SQL {
    return sql`(CASE WHEN ${a} = 0 AND ${b} < 0 THEN NULL
        WHEN ${a} < 0 AND ${b} <> trunc(${b}) THEN NULL
        WHEN abs(${b}) * log(abs(${a}) + 1) > 300 THEN NULL
        ELSE power(${a}, ${b}) END)`;
}

/** Fecha ± días (en el calendario de la empresa para una fecha y hora). */
function shiftDays(run: Run, d: Compiled, days: Compiled, minus: boolean): Compiled {
    const n = minus ? sql`(-(${asNum(days)}))` : asNum(days);
    if (d.kind === 'date') {
        return { sql: sql`((${d.sql}) + LEAST(GREATEST(trunc(${n}), -3000000), 3000000)::int)`, kind: 'date', blank: d.blank };
    }
    return {
        sql: sql`((${d.sql}) + make_interval(secs => (${n}) * 86400))`,
        kind: 'datetime',
        blank: d.blank,
    };
}

/** Las ramas de un SI / SWITCH: mismo tipo (un vacío toma el de la otra). */
function unify(branches: Compiled[]): { kind: SqlKind; sqls: SQL[]; blank: boolean } {
    const typed = branches.filter((b) => !b.blankLiteral);
    const kind = typed[0]?.kind ?? 'text';
    if (typed.some((b) => b.kind !== kind)) notSql('devuelve valores de distinto tipo según la condición');
    const cast = kind === 'number' ? 'numeric' : kind === 'text' ? 'text' : kind === 'boolean' ? 'boolean' : kind === 'date' ? 'date' : 'timestamptz';
    const sqls = branches.map((b) => (b.blankLiteral ? sql.raw(`NULL::${cast}`) : b.sql));
    return { kind, sqls, blank: branches.some((b) => b.blank || b.blankLiteral === true) };
}

function compileCall(run: Run, node: Extract<FormulaNode, { k: 'call' }>): Compiled {
    const a = node.args;
    const c = (i: number): Compiled => compileNode(run, a[i]!);
    switch (node.fn) {
        case 'SI': {
            const cond = asBool(c(0));
            if (a.length < 3) {
                const t = c(1);
                return { sql: sql`(CASE WHEN ${cond} THEN ${t.sql} END)`, kind: t.kind, blank: true };
            }
            const u = unify([c(1), c(2)]);
            return { sql: sql`(CASE WHEN ${cond} THEN ${u.sqls[0]!} ELSE ${u.sqls[1]!} END)`, kind: u.kind, blank: u.blank };
        }
        case 'Y':
            return { sql: sql`(${sql.join(a.map((_, i) => asBool(c(i))), sql` AND `)})`, kind: 'boolean', blank: false };
        case 'O':
            return { sql: sql`(${sql.join(a.map((_, i) => asBool(c(i))), sql` OR `)})`, kind: 'boolean', blank: false };
        case 'NO':
            return { sql: sql`(NOT ${asBool(c(0))})`, kind: 'boolean', blank: false };
        case 'SWITCH': {
            const value = c(0);
            const pairs = Math.floor((a.length - 1) / 2);
            const results: Compiled[] = [];
            const conds: SQL[] = [];
            for (let i = 0; i < pairs; i++) {
                conds.push(compare(run, '=', value, c(1 + i * 2)));
                results.push(c(2 + i * 2));
            }
            const hasDefault = (a.length - 1) % 2 === 1;
            if (hasDefault) results.push(c(a.length - 1));
            const u = unify(results);
            const whens = conds.map((cond, i) => sql`WHEN ${cond} THEN ${u.sqls[i]!}`);
            const otherwise = hasDefault ? sql` ELSE ${u.sqls[u.sqls.length - 1]!}` : sql``;
            return { sql: sql`(CASE ${sql.join(whens, sql` `)}${otherwise} END)`, kind: u.kind, blank: true };
        }
        case 'ESBLANCO': {
            const x = c(0);
            if (x.kind === 'boolean') return { sql: sql`false`, kind: 'boolean', blank: false };
            if (x.kind === 'text') return { sql: sql`(NULLIF(${x.sql}, '') IS NULL)`, kind: 'boolean', blank: false };
            return { sql: sql`((${x.sql}) IS NULL)`, kind: 'boolean', blank: false };
        }
        case 'BLANCO':
            return { sql: sql`NULL::text`, kind: 'text', blank: true, blankLiteral: true };
        case 'VERDADERO':
            return { sql: sql`true`, kind: 'boolean', blank: false };
        case 'FALSO':
            return { sql: sql`false`, kind: 'boolean', blank: false };

        case 'CONCATENAR':
            return { sql: sql`(${sql.join(a.map((_, i) => asText(c(i))), sql` || `)})`, kind: 'text', blank: false };
        case 'MAYUSC':
            return { sql: sql`upper(${asText(c(0))})`, kind: 'text', blank: false };
        case 'MINUSC':
            return { sql: sql`lower(${asText(c(0))})`, kind: 'text', blank: false };
        case 'IZQUIERDA':
        case 'DERECHA': {
            const t = asText(c(0));
            const n = a.length > 1 ? asIntClamp(c(1)) : sql`1`;
            const fn = node.fn === 'IZQUIERDA' ? sql`left` : sql`right`;
            return {
                sql: sql`(CASE WHEN ${n} < 0 THEN NULL WHEN ${n} = 0 THEN '' ELSE ${fn}(${t}, ${n}) END)`,
                kind: 'text',
                blank: false,
            };
        }
        case 'EXTRAER': {
            const t = asText(c(0));
            const s = asIntClamp(c(1));
            const n = asIntClamp(c(2));
            return { sql: sql`(CASE WHEN ${s} < 1 OR ${n} < 0 THEN NULL ELSE substr(${t}, ${s}, ${n}) END)`, kind: 'text', blank: false };
        }
        case 'LARGO':
            return num(sql`char_length(${asText(c(0))})::numeric`);
        case 'CONTIENE': {
            const where = c(0);
            if (where.kind !== 'text') return notSql('CONTIENE sobre algo que no es texto');
            const needle = asText(c(1));
            return {
                sql: sql`(CASE WHEN ${needle} = '' THEN true ELSE strpos(lower(${asText(where)}), lower(${needle})) > 0 END)`,
                kind: 'boolean',
                blank: false,
            };
        }
        case 'REEMPLAZAR': {
            const t = asText(c(0));
            if (a.length === 4) {
                const s = asIntClamp(c(1));
                const n = asIntClamp(c(2));
                const neu = asText(c(3));
                return {
                    sql: sql`(CASE WHEN ${s} < 1 OR ${n} < 0 THEN NULL ELSE left(${t}, ${s} - 1) || ${neu} || substr(${t}, ${s} + ${n}) END)`,
                    kind: 'text',
                    blank: false,
                };
            }
            const search = asText(c(1));
            const repl = asText(c(2));
            return { sql: sql`(CASE WHEN ${search} = '' THEN ${t} ELSE replace(${t}, ${search}, ${repl}) END)`, kind: 'text', blank: false };
        }
        case 'ESPACIOS':
            return {
                sql: sql`regexp_replace(regexp_replace(${asText(c(0))}, ' {2,}', ' ', 'g'), '^ +| +$', '', 'g')`,
                kind: 'text',
                blank: false,
            };

        case 'REDONDEAR':
            return num(sql`round(${asNum(c(0))}, ${a.length > 1 ? asIntClamp(c(1), -15, 15) : sql`0`})`);
        case 'REDONDEAR.MAS':
        case 'REDONDEAR.MENOS': {
            const n = asNum(c(0));
            const d = a.length > 1 ? asIntClamp(c(1), -15, 15) : sql`0`;
            const p = sql`power(10::numeric, ${d})`;
            const fn = node.fn === 'REDONDEAR.MAS' ? sql`ceil` : sql`floor`;
            return num(sql`(sign(${n}) * ${fn}(abs(${n}) * ${p}) / ${p})`);
        }
        case 'ABS':
            return num(sql`abs(${asNum(c(0))})`);
        case 'ENTERO':
            return num(sql`floor(${asNum(c(0))})`);
        case 'RESIDUO': {
            const x = asNum(c(0));
            const y = asNum(c(1));
            return num(sql`(CASE WHEN ${y} = 0 THEN NULL ELSE ${x} - ${y} * floor(${x} / ${y}) END)`);
        }
        case 'POTENCIA':
            return num(power(asNum(c(0)), asNum(c(1))));
        case 'MAX':
        case 'MIN': {
            const all = a.map((_, i) => c(i));
            const fn = node.fn === 'MAX' ? sql`GREATEST` : sql`LEAST`;
            if (all.every((x) => x.kind === 'date')) return { sql: sql`${fn}(${sql.join(all.map((x) => x.sql), sql`, `)})`, kind: 'date', blank: true };
            if (all.every((x) => x.kind === 'date' || x.kind === 'datetime')) {
                return { sql: sql`${fn}(${sql.join(all.map((x) => asInstant(run, x)), sql`, `)})`, kind: 'datetime', blank: true };
            }
            if (all.some((x) => x.kind !== 'number' && x.kind !== 'boolean' && x.literal === undefined)) {
                return notSql(`${node.fn} con valores que no son números`);
            }
            // Los vacíos se ignoran (GREATEST/LEAST ya lo hacen con NULL).
            return num(sql`${fn}(${sql.join(all.map((x) => (x.kind === 'number' ? x.sql : asNum(x))), sql`, `)})`, true);
        }
        case 'SUMA':
            return num(sql`(${sql.join(a.map((_, i) => asNum(c(i))), sql` + `)})`);
        case 'PROMEDIO': {
            const all = a.map((_, i) => c(i));
            if (all.some((x) => x.kind !== 'number')) return notSql('PROMEDIO con valores que no son números');
            const total = sql.join(all.map((x) => sql`COALESCE(${x.sql}, 0)`), sql` + `);
            const count = sql.join(all.map((x) => sql`(CASE WHEN ${x.sql} IS NULL THEN 0 ELSE 1 END)`), sql` + `);
            return num(sql`((${total}) / NULLIF(${count}, 0))`, true);
        }

        case 'HOY':
            return { sql: sql`${zonedToday(run.timeZone, run.now)}::date`, kind: 'date', blank: false };
        case 'AHORA':
            return { sql: sql`${run.now.toISOString()}::timestamptz`, kind: 'datetime', blank: false };
        case 'DIAS_ENTRE': {
            const x = asLocalDate(run, c(0));
            const y = asLocalDate(run, c(1));
            return num(sql`((${y}) - (${x}))::numeric`, true);
        }
        case 'MESES_ENTRE': {
            const x = asLocalDate(run, c(0));
            const y = asLocalDate(run, c(1));
            const age = sql`age(${y}, ${x})`;
            return num(sql`(extract(year from ${age}) * 12 + extract(month from ${age}))::numeric`, true);
        }
        case 'SUMAR_DIAS': {
            const d = c(0);
            if (d.kind === 'date') return { sql: sql`((${d.sql}) + ${asIntClamp(c(1), -3_000_000, 3_000_000)})`, kind: 'date', blank: d.blank };
            if (d.kind === 'datetime') {
                return {
                    sql: sql`(((${d.sql}) AT TIME ZONE ${run.timeZone}) + make_interval(days => ${asIntClamp(c(1), -3_000_000, 3_000_000)})) AT TIME ZONE ${run.timeZone}`,
                    kind: 'datetime',
                    blank: d.blank,
                };
            }
            return notSql('SUMAR_DIAS sobre algo que no es una fecha');
        }
        case 'SUMAR_MESES': {
            const d = c(0);
            const n = asIntClamp(c(1), -100_000, 100_000);
            if (d.kind === 'date') return { sql: sql`((${d.sql}) + make_interval(months => ${n}))::date`, kind: 'date', blank: d.blank };
            if (d.kind === 'datetime') {
                return {
                    sql: sql`(((${d.sql}) AT TIME ZONE ${run.timeZone}) + make_interval(months => ${n})) AT TIME ZONE ${run.timeZone}`,
                    kind: 'datetime',
                    blank: d.blank,
                };
            }
            return notSql('SUMAR_MESES sobre algo que no es una fecha');
        }
        case 'DIA_SEMANA': {
            const d = asLocalDate(run, c(0));
            let type = 1;
            if (a.length > 1) {
                const t = a[1]!;
                if (t.k !== 'num') return notSql('DIA_SEMANA con un tipo que no es un número fijo');
                type = Math.trunc(t.v);
            }
            if (type === 2) return num(sql`extract(isodow from ${d})::numeric`, true);
            if (type === 3) return num(sql`(extract(isodow from ${d}) - 1)::numeric`, true);
            return num(sql`(extract(dow from ${d}) + 1)::numeric`, true);
        }
        case 'ANIO':
        case 'MES':
        case 'DIA': {
            const d = asLocalDate(run, c(0));
            const part = sql.raw(node.fn === 'ANIO' ? 'year' : node.fn === 'MES' ? 'month' : 'day');
            return num(sql`extract(${part} from ${d})::numeric`, true);
        }
        case 'FECHA': {
            if (a.length === 1) {
                const x = c(0);
                if (x.kind === 'date') return x;
                if (x.kind === 'datetime') return { sql: asLocalDate(run, x), kind: 'date', blank: x.blank };
                return { sql: asLocalDate(run, x), kind: 'date', blank: false };
            }
            const y = sql`trunc(${asNum(c(0))})`;
            const m = a.length > 1 ? asIntClamp(c(1)) : sql`1`;
            const d = a.length > 2 ? asIntClamp(c(2), -3_000_000, 3_000_000) : sql`1`;
            // El año va ACOTADO dentro de make_date (Postgres puede evaluar
            // una constante al planificar aunque esté dentro de un CASE).
            const built = sql`((make_date(LEAST(GREATEST(${y}, 1), 9999)::int, 1, 1) + make_interval(months => ${m} - 1))::date + (${d} - 1))`;
            return {
                sql: sql`(CASE WHEN ${y} BETWEEN 1 AND 9999 THEN (CASE WHEN extract(year from ${built}) BETWEEN 1 AND 9999 THEN ${built} END) END)`,
                kind: 'date',
                blank: true,
            };
        }

        case 'SI.ERROR':
            return notSql('usa SI.ERROR');
        case 'REGEX_COINCIDE':
            return notSql('usa una expresión regular');
        case 'SUMAR_DIAS_HABILES':
            return notSql('cuenta días hábiles con los festivos de Colombia');
        case 'FORMATO_FECHA':
        case 'TEXTO':
            return notSql('da formato regional a un valor');
        case 'VALOR':
            return notSql('convierte un texto en número');
        case 'LETRAS':
        case 'PESOS':
            return notSql('escribe un número en palabras');
        default:
            return notSql(`usa ${node.fn}`);
    }
}

/** El valor final con el tipo de resultado (elegido o inferido) aplicado. */
function castToResult(run: Run, c: Compiled, type: FormulaResultType): Compiled {
    if (!(FORMULA_RESULT_TYPES as readonly string[]).includes(type)) return notSql('tipo de resultado desconocido');
    switch (type) {
        case 'number':
        case 'currency':
        case 'percent':
        case 'duration':
            if (c.kind === 'number') return c;
            if (c.kind === 'boolean') return num(sql`(CASE WHEN ${c.sql} THEN 1 ELSE 0 END)::numeric`);
            return notSql('el resultado no es un número');
        case 'text':
            if (c.kind === 'text') return { sql: sql`NULLIF(${c.sql}, '')`, kind: 'text', blank: true };
            if (c.kind === 'number') return { sql: sql`trim_scale(round((${c.sql})::numeric, 10))::text`, kind: 'text', blank: true };
            if (c.kind === 'boolean') return { sql: asText(c), kind: 'text', blank: false };
            return notSql('convierte una fecha en texto');
        case 'checkbox':
            return { sql: asBool(c), kind: 'boolean', blank: false };
        case 'date':
            if (c.kind === 'date') return c;
            if (c.kind === 'datetime') return { sql: asLocalDate(run, c), kind: 'date', blank: c.blank };
            return notSql('el resultado no es una fecha');
        case 'datetime':
            if (c.kind === 'datetime') return c;
            if (c.kind === 'date') return { sql: asInstant(run, c), kind: 'datetime', blank: c.blank };
            return notSql('el resultado no es una fecha');
    }
}

/**
 * Clave de AGRUPADO de una fórmula compilada: un número o un texto tal cual,
 * una fecha por su día (una fecha y hora, por el día en la zona de la
 * empresa), un sí/no como `true`/`false`.
 */
export function formulaGroupExpr(expr: SQL, kind: SqlKind, timeZone: string): SQL {
    switch (kind) {
        case 'date':
            return sql`to_char(${expr}, 'YYYY-MM-DD')`;
        case 'datetime':
            return sql`to_char((${expr}) AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
        case 'boolean':
            return sql`(CASE WHEN ${expr} THEN 'true' ELSE 'false' END)`;
        case 'number':
            return sql`trim_scale((${expr})::numeric)::text`;
        default:
            return sql`(${expr})::text`;
    }
}
