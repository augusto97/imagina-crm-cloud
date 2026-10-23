import { compileUserPattern, USER_PATTERN_VALUE_MAX } from '../field-types/field-rules';
import { amountToSpanishWords, numberToSpanishWords } from '../field-types/spanish-words';
import { parseNumberText } from '../field-types/text-coercion';
import { zonedInstant } from '../schemas/timezone';
import { formulaResultTypeOf, type FormulaTypingField, type ThroughTargetOf } from './analyze';
import type { FormulaResultType } from './constants';
import {
    addBusinessDaysMs,
    addDaysMs,
    addMonthsYmd,
    completeMonthsBetween,
    daysBetweenMs,
    formatDatePattern,
    msToYmd,
    partsOfDateMs,
    ymdToMs,
    type CalendarParts,
} from './dates';
import { parseFormulaCached, type FormulaNode } from './parser';
import { storedRefId } from './refs';

/**
 * Fórmulas — evaluador. Puro, sin `eval`: recorre el árbol.
 *
 * Reglas de valores, las de una hoja de cálculo:
 *  - un campo VACÍO cuenta como 0 en una cuenta, como texto vacío al unir y
 *    como «falso» en una condición;
 *  - en una comparación, vacío sólo es igual a vacío (o a ""); `<`/`>` con un
 *    vacío dan falso (un vencimiento vacío no está «antes de hoy»);
 *  - los textos se comparan sin distinguir mayúsculas;
 *  - una selección se lee por su ETIQUETA (lo que ve la persona), una persona
 *    por su nombre, una casilla como sí/no;
 *  - fecha ± número = fecha (días); fecha − fecha = días.
 *
 * Un error (división por cero, un texto que no es número, un campo borrado)
 * no tumba nada: la celda muestra «#ERROR» con el motivo.
 *
 * Topes: largo y profundidad los pone el parser; aquí, una cantidad de pasos
 * y un tiempo máximo por evaluación, y un largo máximo de texto.
 */

export interface FormulaEnv {
    /** "Ahora" (una sola vez por lectura: todas las filas ven el mismo). */
    now: Date;
    /** Zona de la empresa (ADR-S33): el «hoy», los días y las horas. */
    timeZone: string;
    numberFormat?: 'comma_dot' | 'dot_comma' | 'space_comma';
    dateFormat?: 'ymd' | 'dmy' | 'mdy';
    timeFormat?: 'h24' | 'h12';
    /** Nombre de una persona por su id (campos persona, creado por…). */
    userName?: (id: number) => string | null | undefined;
}

export class FormulaDate {
    constructor(
        /** `date`: día del calendario (ms = su medianoche UTC). `datetime`: un instante. */
        readonly kind: 'date' | 'datetime',
        readonly ms: number,
    ) {}
}

export type FV = null | number | string | boolean | FormulaDate | FV[];

export class FormulaRuntimeError extends Error {}

export type FormulaResult = { ok: true; value: unknown } | { ok: false; error: string };

export const FORMULA_MAX_STEPS = 50_000;
export const FORMULA_MAX_MS = 50;
export const FORMULA_MAX_TEXT = 100_000;

/** Lo que el evaluador necesita saber de los campos de la lista. */
export interface FormulaEvalField extends FormulaTypingField {
    label?: string;
}

export interface FormulaEvalContext {
    env: FormulaEnv;
    fields: ReadonlyMap<number, FormulaEvalField>;
    /** Valor crudo (como se guarda) de un campo que NO es fórmula. */
    rawValue: (fieldId: number) => unknown;
    /** El campo del otro lado de un lookup/rollup, si se conoce. */
    throughTarget?: ThroughTargetOf;
    /** Valores ya calculados de otras fórmulas (memo por fila). */
    memo?: Map<number, FormulaResult>;
    /** Fórmulas en curso (para no entrar en un ciclo). */
    visiting?: Set<number>;
    /**
     * Últimos nombres conocidos de los campos que usa la fórmula en curso
     * (`config.labels`): un campo en la papelera se nombra en el error.
     */
    refLabels?: Readonly<Record<string, string>>;
}

interface Run {
    ctx: FormulaEvalContext;
    steps: number;
    started: number;
}

const err = (message: string): never => {
    throw new FormulaRuntimeError(message);
};

// ─── Conversión de valores ───────────────────────────────────────────────

function isFormulaDate(v: unknown): v is FormulaDate {
    return v instanceof FormulaDate;
}

export function isBlank(v: FV): boolean {
    return v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Lee un texto de fecha: ISO, o día/mes/año en el orden de la empresa. */
export function parseDateText(text: string, env: Pick<FormulaEnv, 'dateFormat'>): FormulaDate | null {
    const s = text.trim();
    let m = YMD_RE.exec(s);
    if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    m = ISO_DT_RE.exec(s);
    if (m) {
        const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7] ? `.${m[7]}` : ''}${m[8] ?? 'Z'}`;
        const t = Date.parse(iso);
        return Number.isFinite(t) ? new FormulaDate('datetime', t) : null;
    }
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        let y = Number(m[3]);
        if (y < 100) y += 2000;
        const [d, mo] = env.dateFormat === 'mdy' ? [b, a] : [a, b];
        return validYmd(y, mo, d);
    }
    return null;
}

function validYmd(y: number, m: number, d: number): FormulaDate | null {
    if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const ms = ymdToMs(y, m, d);
    const back = partsOfDateMs(ms);
    return back.m === m && back.d === d ? new FormulaDate('date', ms) : null;
}

function optionLabel(config: Record<string, unknown>, value: unknown): string {
    const options = Array.isArray(config.options) ? (config.options as Array<{ value?: unknown; label?: unknown }>) : [];
    const hit = options.find((o) => String(o?.value) === String(value));
    return typeof hit?.label === 'string' && hit.label !== '' ? hit.label : String(value);
}

function truthyRaw(v: unknown): boolean {
    if (typeof v === 'string') return !['', '0', 'false', 'no'].includes(v.trim().toLowerCase());
    return v === true || (typeof v === 'number' && v !== 0);
}

function numFromRaw(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return null;
}

/** Valor crudo de un campo (como se guarda) → valor de la fórmula. */
export function rawToFormulaValue(type: string, config: Record<string, unknown>, raw: unknown, env: FormulaEnv): FV {
    if (raw === null || raw === undefined) return type === 'checkbox' ? false : null;
    switch (type) {
        case 'number':
        case 'currency':
        case 'rating':
        case 'percent':
        case 'duration':
        case 'time_tracked':
            return numFromRaw(raw);
        case 'checkbox':
            return truthyRaw(raw);
        case 'select':
            return raw === '' ? null : optionLabel(config, raw);
        case 'multi_select':
            return Array.isArray(raw) ? raw.map((v) => optionLabel(config, v)) : [optionLabel(config, raw)];
        case 'date': {
            if (typeof raw !== 'string') return null;
            return parseDateText(raw.slice(0, 10), env);
        }
        case 'datetime':
        case 'created_at':
        case 'updated_at': {
            if (typeof raw !== 'string') return null;
            const d = parseDateText(raw, env);
            return d && d.kind === 'date' ? new FormulaDate('datetime', d.ms) : d;
        }
        case 'user':
        case 'created_by':
        case 'updated_by': {
            const id = Number(raw);
            if (!Number.isInteger(id)) return String(raw);
            if (id === 0) return 'Sistema';
            return env.userName?.(id) ?? `Usuario #${id}`;
        }
        case 'computed':
        case 'rollup': {
            if (typeof raw === 'number') return raw;
            if (typeof raw === 'string') {
                const d = parseDateText(raw, env);
                if (d) return d;
                const n = numFromRaw(raw);
                return n ?? raw;
            }
            return null;
        }
        default:
            if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v)));
            if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
            return String(raw);
    }
}

/** El número de una celda de un lookup: cada valor con el tipo del campo traído. */
function lookupValues(raw: unknown, target: { type: string; config?: Record<string, unknown> | null } | null | undefined, env: FormulaEnv): FV {
    const list = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
    const type = target?.type ?? 'text';
    const out: FV[] = [];
    for (const v of list) {
        const conv = rawToFormulaValue(type, (target?.config ?? {}) as Record<string, unknown>, v, env);
        if (Array.isArray(conv)) out.push(...conv);
        else if (conv !== null) out.push(conv);
    }
    return out;
}

/** Un único valor de una lista (o error si tiene varios y hace falta uno). */
function single(v: FV, what: string): Exclude<FV, FV[]> {
    if (!Array.isArray(v)) return v;
    if (v.length === 0) return null;
    if (v.length === 1) return single(v[0]!, what);
    return err(`${what} tiene varios valores: usa SUMA(), MAX(), MIN() o CONCATENAR() para combinarlos.`);
}

/** Texto de un número sin separadores de miles y sin ruido de coma flotante. */
export function numberToPlainText(n: number): string {
    if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
    const fixed = Number(n.toFixed(10));
    return String(fixed);
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function formatYmdFor(ms: number, env: FormulaEnv): string {
    const p = partsOfDateMs(ms);
    const y = String(p.y).padStart(4, '0');
    if (env.dateFormat === 'dmy') return `${pad2(p.d)}/${pad2(p.m)}/${y}`;
    if (env.dateFormat === 'mdy') return `${pad2(p.m)}/${pad2(p.d)}/${y}`;
    return `${y}-${pad2(p.m)}-${pad2(p.d)}`;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Día, mes, año y hora de un instante en la zona de la empresa. */
export function zonedPartsOf(ms: number, timeZone: string): CalendarParts {
    let f = partsFormatters.get(timeZone);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hourCycle: 'h23',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                weekday: 'short',
            });
        } catch {
            f = new Intl.DateTimeFormat('en-US', {
                timeZone: 'UTC',
                hourCycle: 'h23',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                weekday: 'short',
            });
        }
        partsFormatters.set(timeZone, f);
    }
    const parts = f.formatToParts(new Date(ms));
    const pick = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
        y: Number(pick('year')),
        m: Number(pick('month')),
        d: Number(pick('day')),
        dow: Math.max(0, days.indexOf(pick('weekday'))),
        hour: Number(pick('hour')) % 24,
        minute: Number(pick('minute')),
        second: Number(pick('second')),
    };
}

/** Las partes de calendario de una fecha o de una fecha y hora (en la zona de la empresa). */
function calendarOf(d: FormulaDate, env: FormulaEnv): CalendarParts {
    if (d.kind === 'date') {
        const p = partsOfDateMs(d.ms);
        return { y: p.y, m: p.m, d: p.d, dow: p.dow, hour: 0, minute: 0, second: 0 };
    }
    return zonedPartsOf(d.ms, env.timeZone);
}

/** El día del calendario (de la empresa) de una fecha o fecha y hora. */
function dayMsOf(d: FormulaDate, env: FormulaEnv): number {
    if (d.kind === 'date') return d.ms;
    const p = zonedPartsOf(d.ms, env.timeZone);
    return ymdToMs(p.y, p.m, p.d);
}

/** Una fecha como instante (una fecha sin hora: su medianoche en la zona de la empresa). */
function instantOf(d: FormulaDate, env: FormulaEnv): number {
    if (d.kind === 'datetime') return d.ms;
    return zonedInstant(msToYmd(d.ms), env.timeZone).getTime();
}

function formatClock(h: number, m: number, env: FormulaEnv): string {
    if (env.timeFormat === 'h12') {
        const suffix = h < 12 ? 'a. m.' : 'p. m.';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${pad2(m)} ${suffix}`;
    }
    return `${pad2(h)}:${pad2(m)}`;
}

/** Texto de un valor (para `&`, CONCATENAR y las funciones de texto). */
export function valueToText(v: FV, env: FormulaEnv): string {
    if (v === null) return '';
    if (Array.isArray(v)) return v.map((x) => valueToText(x, env)).filter((s) => s !== '').join(', ');
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return numberToPlainText(v);
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (v.kind === 'date') return formatYmdFor(v.ms, env);
    const p = zonedPartsOf(v.ms, env.timeZone);
    return `${formatYmdFor(ymdToMs(p.y, p.m, p.d), env)} ${formatClock(p.hour, p.minute, env)}`;
}

function toNumber(v: FV, what = 'El valor'): number {
    const s = single(v, what);
    if (s === null || s === '') return 0;
    if (typeof s === 'number') return s;
    if (typeof s === 'boolean') return s ? 1 : 0;
    if (isFormulaDate(s)) return err(`${what} es una fecha y aquí se esperaba un número.`);
    const t = s.trim();
    if (t !== '' && Number.isFinite(Number(t))) return Number(t);
    return err(`«${s.length > 40 ? `${s.slice(0, 40)}…` : s}» no es un número.`);
}

function toBool(v: FV): boolean {
    const s = single(v, 'La condición');
    if (s === null) return false;
    if (typeof s === 'boolean') return s;
    if (typeof s === 'number') return s !== 0;
    if (typeof s === 'string') {
        const t = s.trim().toLowerCase();
        return !(t === '' || t === 'falso' || t === 'false' || t === '0' || t === 'no');
    }
    return true;
}

function toDate(v: FV, env: FormulaEnv, what = 'El valor'): FormulaDate | null {
    const s = single(v, what);
    if (s === null || s === '') return null;
    if (isFormulaDate(s)) return s;
    if (typeof s === 'string') {
        const d = parseDateText(s, env);
        if (d) return d;
        return err(`«${s.length > 40 ? `${s.slice(0, 40)}…` : s}» no es una fecha.`);
    }
    return err(`${what} no es una fecha.`);
}

function intArg(v: FV, what: string): number {
    const n = toNumber(v, what);
    if (!Number.isFinite(n)) return err(`${what} no es un número válido.`);
    return Math.trunc(n);
}

function capText(s: string): string {
    if (s.length > FORMULA_MAX_TEXT) return err(`El texto es demasiado largo (más de ${FORMULA_MAX_TEXT.toLocaleString('es')} caracteres).`);
    return s;
}

// ─── Comparación ─────────────────────────────────────────────────────────

type Comparable = { kind: 'n'; v: number } | { kind: 't'; v: string } | { kind: 'd'; v: number };

function comparablePair(a: Exclude<FV, FV[]>, b: Exclude<FV, FV[]>, env: FormulaEnv): [Comparable, Comparable] {
    const num = (x: Exclude<FV, FV[]>): number | null => {
        if (typeof x === 'number') return x;
        if (typeof x === 'boolean') return x ? 1 : 0;
        if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
        return null;
    };
    if (isFormulaDate(a) || isFormulaDate(b)) {
        const da = isFormulaDate(a) ? a : typeof a === 'string' ? parseDateText(a, env) : null;
        const db = isFormulaDate(b) ? b : typeof b === 'string' ? parseDateText(b, env) : null;
        if (da && db) {
            if (da.kind === 'date' && db.kind === 'date') return [{ kind: 'd', v: da.ms }, { kind: 'd', v: db.ms }];
            return [{ kind: 'd', v: instantOf(da, env) }, { kind: 'd', v: instantOf(db, env) }];
        }
        return [{ kind: 't', v: valueToText(a, env).toLowerCase() }, { kind: 't', v: valueToText(b, env).toLowerCase() }];
    }
    if (typeof a === 'string' && typeof b === 'string') return [{ kind: 't', v: a.toLowerCase() }, { kind: 't', v: b.toLowerCase() }];
    const na = num(a);
    const nb = num(b);
    if (na !== null && nb !== null) return [{ kind: 'n', v: na }, { kind: 'n', v: nb }];
    return [{ kind: 't', v: valueToText(a, env).toLowerCase() }, { kind: 't', v: valueToText(b, env).toLowerCase() }];
}

/** Para comparar: una lista de un solo valor es ese valor; con varios, su texto unido. */
function comparable(v: FV, env: FormulaEnv): Exclude<FV, FV[]> {
    if (!Array.isArray(v)) return v;
    if (v.length === 0) return null;
    if (v.length === 1) return comparable(v[0]!, env);
    return valueToText(v, env);
}

function compareValues(op: string, a: FV, b: FV, env: FormulaEnv): boolean {
    const blankA = isBlank(a);
    const blankB = isBlank(b);
    if (op === '=' || op === '<>') {
        let eq: boolean;
        if (blankA || blankB) eq = blankA && blankB;
        else {
            const [x, y] = comparablePair(comparable(a, env), comparable(b, env), env);
            eq = x.v === y.v;
        }
        return op === '=' ? eq : !eq;
    }
    if (blankA || blankB) return false;
    const [x, y] = comparablePair(comparable(a, env), comparable(b, env), env);
    switch (op) {
        case '<':
            return x.v < y.v;
        case '>':
            return x.v > y.v;
        case '<=':
            return x.v <= y.v;
        case '>=':
            return x.v >= y.v;
        default:
            return false;
    }
}

// ─── Números ─────────────────────────────────────────────────────────────

function checkNumber(n: number): number {
    if (!Number.isFinite(n)) return err('El resultado es un número demasiado grande.');
    return n;
}

/** Redondea "a la mitad, lejos del cero" (como Excel y como `round(numeric)` de Postgres). */
export function roundHalfAway(n: number, decimals: number): number {
    const d = Math.max(-15, Math.min(15, Math.trunc(decimals)));
    const p = Math.pow(10, Math.abs(d));
    const scaled = d >= 0 ? n * p : n / p;
    // Limpia el ruido de coma flotante antes de decidir (1.005 * 100 = 100.49999…).
    const clean = Number(scaled.toPrecision(15));
    const r = Math.sign(clean) * Math.round(Math.abs(clean));
    return d >= 0 ? r / p : r * p;
}

function roundDir(n: number, decimals: number, up: boolean): number {
    const d = Math.max(-15, Math.min(15, Math.trunc(decimals)));
    const p = Math.pow(10, Math.abs(d));
    const scaled = Number((d >= 0 ? Math.abs(n) * p : Math.abs(n) / p).toPrecision(15));
    const r = up ? Math.ceil(scaled) : Math.floor(scaled);
    const back = d >= 0 ? r / p : r * p;
    return Math.sign(n) * back;
}

function mod(a: number, b: number): number {
    if (b === 0) return err('División por cero.');
    return checkNumber(a - b * Math.floor(a / b));
}

function power(a: number, b: number): number {
    if (a === 0 && b < 0) return err('Cero no se puede elevar a un número negativo.');
    if (a < 0 && !Number.isInteger(b)) return err('Un número negativo no se puede elevar a una potencia con decimales.');
    return checkNumber(Math.pow(a, b));
}

function flatten(values: FV[]): Array<Exclude<FV, FV[]>> {
    const out: Array<Exclude<FV, FV[]>> = [];
    for (const v of values) {
        if (Array.isArray(v)) out.push(...flatten(v));
        else out.push(v);
    }
    return out;
}

// ─── Texto con formato (TEXTO) ───────────────────────────────────────────

function groupDigits(int: string, sep: string): string {
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Número con los separadores de la empresa (`decimals` null = los que tenga, hasta 6). */
export function formatNumberRegional(n: number, decimals: number | null, fmt: FormulaEnv['numberFormat'], group = true): string {
    const fixed = decimals === null ? String(Number(n.toFixed(6))) : roundHalfAway(n, decimals).toFixed(Math.max(0, decimals));
    const negative = fixed.startsWith('-');
    const [int = '0', dec] = (negative ? fixed.slice(1) : fixed).split('.');
    const thousands = fmt === 'dot_comma' ? '.' : fmt === 'space_comma' ? ' ' : ',';
    const decimal = fmt === 'dot_comma' || fmt === 'space_comma' ? ',' : '.';
    const body = group ? groupDigits(int, thousands) : int;
    return `${negative ? '-' : ''}${body}${dec ? decimal + dec : ''}`;
}

/**
 * Formato de número tipo hoja de cálculo: `#,##0.00`, `0%`, `$#,##0`,
 * `0.0 "kg"`. En el patrón la coma agrupa y el punto es el decimal (siempre);
 * la salida usa los separadores de la empresa.
 */
function formatNumberPattern(n: number, pattern: string, env: FormulaEnv): string {
    const m = /[#0,.]*[#0][#0,.]*/.exec(pattern);
    if (!m) return pattern;
    const numeric = m[0];
    let prefix = pattern.slice(0, m.index);
    let suffix = pattern.slice(m.index + numeric.length);
    const unquote = (s: string) => s.replace(/"([^"]*)"/g, '$1');
    prefix = unquote(prefix);
    suffix = unquote(suffix);
    let value = n;
    if (suffix.includes('%')) value = n * 100;
    const [intPart = '', decPart = ''] = numeric.split('.');
    const group = intPart.includes(',');
    const required = (decPart.match(/0/g) ?? []).length;
    const optional = (decPart.match(/#/g) ?? []).length;
    const maxDec = required + optional;
    let text = formatNumberRegional(value, maxDec, env.numberFormat, group);
    if (optional > 0) {
        const decimalSep = env.numberFormat === 'dot_comma' || env.numberFormat === 'space_comma' ? ',' : '.';
        const idx = text.lastIndexOf(decimalSep);
        if (idx >= 0) {
            let dec = text.slice(idx + 1);
            while (dec.length > required && dec.endsWith('0')) dec = dec.slice(0, -1);
            text = dec === '' ? text.slice(0, idx) : `${text.slice(0, idx)}${decimalSep}${dec}`;
        }
    }
    return `${prefix}${text}${suffix}`;
}

function formatDateValue(d: FormulaDate, pattern: string | null, env: FormulaEnv): string {
    if (pattern === null || pattern.trim() === '') return valueToText(d, env);
    return formatDatePattern(calendarOf(d, env), pattern);
}

// ─── Evaluación ──────────────────────────────────────────────────────────

function tick(run: Run): void {
    run.steps++;
    if (run.steps > FORMULA_MAX_STEPS) err('La fórmula tarda demasiado en calcularse.');
    if (run.steps % 500 === 0 && Date.now() - run.started > FORMULA_MAX_MS) err('La fórmula tarda demasiado en calcularse.');
}

function refValue(run: Run, name: string): FV {
    const id = storedRefId(name);
    const { ctx } = run;
    const f = id === null ? undefined : ctx.fields.get(id);
    if (!f) {
        const known = id !== null ? ctx.refLabels?.[String(id)] : name.startsWith('#') ? undefined : name;
        return err(
            known
                ? `El campo «${known}» no existe (está en la papelera o se borró).`
                : 'Usa un campo que ya no existe (está en la papelera o se borró).',
        );
    }
    const cfg = (f.config ?? {}) as Record<string, unknown>;
    if (f.type === 'formula') {
        const res = evaluateFieldFormula(f, ctx);
        if (!res.ok) return err(`«${f.label ?? `#${f.id}`}» da error: ${res.error}`);
        return outputToValue(res.value, formulaResultTypeOf(f, ctx), ctx.env);
    }
    if (f.type === 'relation' || f.type === 'file') return err(`«${f.label ?? `#${f.id}`}» no se puede usar en una fórmula.`);
    const raw = ctx.rawValue(f.id);
    if (f.type === 'lookup') return lookupValues(raw, ctx.throughTarget?.(f.id), ctx.env);
    if (f.type === 'rollup') {
        const t = ctx.throughTarget?.(f.id);
        if (t && (t.type === 'date' || t.type === 'datetime') && typeof raw === 'string') {
            return rawToFormulaValue(t.type, {}, raw, ctx.env);
        }
    }
    return rawToFormulaValue(f.type, cfg, raw, ctx.env);
}

/** Valor ya calculado de otra fórmula (en su forma guardada) → valor de fórmula. */
function outputToValue(value: unknown, type: FormulaResultType, env: FormulaEnv): FV {
    if (value === null || value === undefined) return type === 'checkbox' ? false : null;
    switch (type) {
        case 'date':
            return typeof value === 'string' ? parseDateText(value, env) : null;
        case 'datetime': {
            if (typeof value !== 'string') return null;
            const d = parseDateText(value, env);
            return d && d.kind === 'date' ? new FormulaDate('datetime', d.ms) : d;
        }
        case 'checkbox':
            return value === true;
        default:
            return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : String(value);
    }
}

function ev(run: Run, node: FormulaNode): FV {
    tick(run);
    switch (node.k) {
        case 'num':
            return node.v;
        case 'str':
            return node.v;
        case 'bool':
            return node.v;
        case 'ref':
            return refValue(run, node.name);
        case 'neg':
            return checkNumber(-toNumber(ev(run, node.arg)));
        case 'pct':
            return checkNumber(toNumber(ev(run, node.arg)) / 100);
        case 'bin':
            return binary(run, node.op, node.l, node.r);
        case 'call':
            return call(run, node);
    }
}

function binary(run: Run, op: string, ln: FormulaNode, rn: FormulaNode): FV {
    const env = run.ctx.env;
    const l = ev(run, ln);
    const r = ev(run, rn);
    if (op === '&') return capText(valueToText(l, env) + valueToText(r, env));
    if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') return compareValues(op, l, r, env);
    const ls = single(l, 'El valor');
    const rs = single(r, 'El valor');
    // Fechas: fecha ± días; fecha − fecha = días.
    if (op === '+' || op === '-') {
        if (isFormulaDate(ls) && !isFormulaDate(rs)) {
            if (rs === null || rs === '') return ls;
            const days = toNumber(rs) * (op === '+' ? 1 : -1);
            return ls.kind === 'date' ? new FormulaDate('date', addDaysMs(ls.ms, Math.trunc(days))) : new FormulaDate('datetime', ls.ms + days * 86_400_000);
        }
        if (op === '+' && isFormulaDate(rs) && !isFormulaDate(ls)) {
            if (ls === null || ls === '') return rs;
            const days = toNumber(ls);
            return rs.kind === 'date' ? new FormulaDate('date', addDaysMs(rs.ms, Math.trunc(days))) : new FormulaDate('datetime', rs.ms + days * 86_400_000);
        }
        if (op === '-' && isFormulaDate(ls) && isFormulaDate(rs)) {
            if (ls.kind === 'date' && rs.kind === 'date') return daysBetweenMs(rs.ms, ls.ms);
            return checkNumber((instantOf(ls, env) - instantOf(rs, env)) / 86_400_000);
        }
    }
    const a = toNumber(ls);
    const b = toNumber(rs);
    switch (op) {
        case '+':
            return checkNumber(a + b);
        case '-':
            return checkNumber(a - b);
        case '*':
            return checkNumber(a * b);
        case '/':
            if (b === 0) return err('División por cero.');
            return checkNumber(a / b);
        case '^':
            return power(a, b);
        case '%':
            return mod(a, b);
        default:
            return err(`Operador desconocido «${op}».`);
    }
}

function textArg(run: Run, node: FormulaNode): string {
    return valueToText(ev(run, node), run.ctx.env);
}

function call(run: Run, node: Extract<FormulaNode, { k: 'call' }>): FV {
    const env = run.ctx.env;
    const a = node.args;
    const arg = (i: number): FV => ev(run, a[i]!);
    const num = (i: number, what?: string): number => toNumber(arg(i), what ?? `El argumento ${i + 1} de ${node.fn}`);
    const date = (i: number): FormulaDate | null => toDate(arg(i), env, `El argumento ${i + 1} de ${node.fn}`);
    switch (node.fn) {
        // ── Lógica ──
        case 'SI':
            return toBool(arg(0)) ? arg(1) : a.length > 2 ? arg(2) : null;
        case 'Y': {
            for (let i = 0; i < a.length; i++) if (!toBool(arg(i))) return false;
            return true;
        }
        case 'O': {
            for (let i = 0; i < a.length; i++) if (toBool(arg(i))) return true;
            return false;
        }
        case 'NO':
            return !toBool(arg(0));
        case 'SWITCH': {
            const value = arg(0);
            const pairs = Math.floor((a.length - 1) / 2);
            for (let i = 0; i < pairs; i++) {
                if (compareValues('=', value, arg(1 + i * 2), env)) return arg(2 + i * 2);
            }
            return (a.length - 1) % 2 === 1 ? arg(a.length - 1) : null;
        }
        case 'ESBLANCO':
            return isBlank(arg(0));
        case 'SI.ERROR': {
            try {
                return arg(0);
            } catch (e) {
                if (e instanceof FormulaRuntimeError && !/tarda demasiado/.test(e.message)) return arg(1);
                throw e;
            }
        }
        case 'BLANCO':
            return null;
        case 'VERDADERO':
            return true;
        case 'FALSO':
            return false;

        // ── Texto ──
        case 'CONCATENAR':
            return capText(a.map((_, i) => textArg(run, a[i]!)).join(''));
        case 'MAYUSC':
            return textArg(run, a[0]!).toUpperCase();
        case 'MINUSC':
            return textArg(run, a[0]!).toLowerCase();
        case 'IZQUIERDA':
        case 'DERECHA': {
            const t = textArg(run, a[0]!);
            const n = a.length > 1 ? intArg(arg(1), 'La cantidad de caracteres') : 1;
            if (n < 0) return err('La cantidad de caracteres no puede ser negativa.');
            const chars = Array.from(t);
            return node.fn === 'IZQUIERDA' ? chars.slice(0, n).join('') : n === 0 ? '' : chars.slice(-n).join('');
        }
        case 'EXTRAER': {
            const chars = Array.from(textArg(run, a[0]!));
            const start = intArg(arg(1), 'La posición de inicio');
            const n = intArg(arg(2), 'La cantidad de caracteres');
            if (start < 1) return err('La posición de inicio empieza en 1.');
            if (n < 0) return err('La cantidad de caracteres no puede ser negativa.');
            return chars.slice(start - 1, start - 1 + n).join('');
        }
        case 'LARGO':
            return Array.from(textArg(run, a[0]!)).length;
        case 'CONTIENE': {
            const where = arg(0);
            const needle = textArg(run, a[1]!).toLowerCase();
            if (needle === '') return true;
            // En una lista (selección múltiple, lookup) busca un valor IGUAL;
            // en un texto, el pedazo.
            if (Array.isArray(where)) return where.some((x) => valueToText(x, env).toLowerCase() === needle);
            return valueToText(where, env).toLowerCase().includes(needle);
        }
        case 'REEMPLAZAR': {
            const t = textArg(run, a[0]!);
            if (a.length === 4) {
                // Como Excel: (texto, inicio, cantidad, nuevo).
                const chars = Array.from(t);
                const start = intArg(arg(1), 'La posición de inicio');
                const n = intArg(arg(2), 'La cantidad de caracteres');
                if (start < 1 || n < 0) return err('La posición empieza en 1 y la cantidad no puede ser negativa.');
                const neu = textArg(run, a[3]!);
                return capText(chars.slice(0, start - 1).join('') + neu + chars.slice(start - 1 + n).join(''));
            }
            const search = textArg(run, a[1]!);
            const repl = textArg(run, a[2]!);
            if (search === '') return t;
            return capText(t.split(search).join(repl));
        }
        case 'ESPACIOS':
            return textArg(run, a[0]!).replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
        case 'REGEX_COINCIDE': {
            const t = textArg(run, a[0]!);
            const pattern = textArg(run, a[1]!);
            const ignore = a.length > 2 ? toBool(arg(2)) : false;
            const re = compileUserPattern(pattern, ignore);
            if (re === null) return err('La expresión regular no es válida o podría colgarse (sin repeticiones anidadas, referencias ni lookarounds).');
            if (t.length > USER_PATTERN_VALUE_MAX) return err(`REGEX_COINCIDE revisa textos de hasta ${USER_PATTERN_VALUE_MAX} caracteres.`);
            return re.test(t);
        }

        // ── Números ──
        case 'REDONDEAR':
            return roundHalfAway(num(0), a.length > 1 ? intArg(arg(1), 'Los decimales') : 0);
        case 'REDONDEAR.MAS':
            return roundDir(num(0), a.length > 1 ? intArg(arg(1), 'Los decimales') : 0, true);
        case 'REDONDEAR.MENOS':
            return roundDir(num(0), a.length > 1 ? intArg(arg(1), 'Los decimales') : 0, false);
        case 'ABS':
            return Math.abs(num(0));
        case 'MAX':
        case 'MIN': {
            const values = flatten(a.map((_, i) => arg(i))).filter((v) => !(v === null || v === ''));
            if (values.length === 0) return null;
            if (values.every(isFormulaDate)) {
                const dates = values as FormulaDate[];
                const allDates = dates.every((d) => d.kind === 'date');
                const scored = dates.map((d) => ({ d, t: allDates ? d.ms : instantOf(d, env) }));
                const pick = scored.reduce((best, cur) => (node.fn === 'MAX' ? (cur.t > best.t ? cur : best) : cur.t < best.t ? cur : best));
                return allDates ? pick.d : new FormulaDate('datetime', pick.t);
            }
            const nums = values.map((v) => toNumber(v, `Un valor de ${node.fn}`));
            return node.fn === 'MAX' ? Math.max(...nums) : Math.min(...nums);
        }
        case 'SUMA': {
            let total = 0;
            for (const v of flatten(a.map((_, i) => arg(i)))) total += toNumber(v, 'Un valor de SUMA');
            return checkNumber(total);
        }
        case 'PROMEDIO': {
            const values = flatten(a.map((_, i) => arg(i))).filter((v) => !(v === null || v === ''));
            if (values.length === 0) return null;
            const total = values.reduce<number>((s, v) => s + toNumber(v, 'Un valor de PROMEDIO'), 0);
            return checkNumber(total / values.length);
        }
        case 'ENTERO':
            return Math.floor(num(0));
        case 'RESIDUO':
            return mod(num(0), num(1));
        case 'POTENCIA':
            return power(num(0), num(1));

        // ── Fechas ──
        case 'HOY': {
            const p = zonedPartsOf(env.now.getTime(), env.timeZone);
            return new FormulaDate('date', ymdToMs(p.y, p.m, p.d));
        }
        case 'AHORA':
            return new FormulaDate('datetime', env.now.getTime());
        case 'DIAS_ENTRE': {
            const x = date(0);
            const y = date(1);
            if (!x || !y) return null;
            return daysBetweenMs(dayMsOf(x, env), dayMsOf(y, env));
        }
        case 'MESES_ENTRE': {
            const x = date(0);
            const y = date(1);
            if (!x || !y) return null;
            const px = partsOfDateMs(dayMsOf(x, env));
            const py = partsOfDateMs(dayMsOf(y, env));
            return completeMonthsBetween(px, py);
        }
        case 'SUMAR_DIAS': {
            const d = date(0);
            if (!d) return null;
            const n = intArg(arg(1), 'Los días');
            if (d.kind === 'date') return new FormulaDate('date', addDaysMs(d.ms, n));
            return shiftLocalDays(d, n, env);
        }
        case 'SUMAR_MESES': {
            const d = date(0);
            if (!d) return null;
            const n = intArg(arg(1), 'Los meses');
            const p = calendarOf(d, env);
            const r = addMonthsYmd(p.y, p.m, p.d, n);
            if (d.kind === 'date') return new FormulaDate('date', ymdToMs(r.y, r.m, r.d));
            return new FormulaDate('datetime', zonedInstant(msToYmd(ymdToMs(r.y, r.m, r.d)), env.timeZone, { h: p.hour, m: p.minute, s: p.second }).getTime());
        }
        case 'SUMAR_DIAS_HABILES': {
            const d = date(0);
            if (!d) return null;
            const n = intArg(arg(1), 'Los días hábiles');
            if (Math.abs(n) > 5000) return err('SUMAR_DIAS_HABILES suma hasta 5.000 días hábiles.');
            const day = addBusinessDaysMs(dayMsOf(d, env), n);
            if (d.kind === 'date') return new FormulaDate('date', day);
            const p = calendarOf(d, env);
            return new FormulaDate('datetime', zonedInstant(msToYmd(day), env.timeZone, { h: p.hour, m: p.minute, s: p.second }).getTime());
        }
        case 'DIA_SEMANA': {
            const d = date(0);
            if (!d) return null;
            const type = a.length > 1 ? intArg(arg(1), 'El tipo') : 1;
            const dow = calendarOf(d, env).dow; // 0 = domingo
            if (type === 2) return dow === 0 ? 7 : dow;
            if (type === 3) return dow === 0 ? 6 : dow - 1;
            return dow + 1;
        }
        case 'ANIO':
        case 'MES':
        case 'DIA': {
            const d = date(0);
            if (!d) return null;
            const p = calendarOf(d, env);
            return node.fn === 'ANIO' ? p.y : node.fn === 'MES' ? p.m : p.d;
        }
        case 'FORMATO_FECHA': {
            const d = date(0);
            if (!d) return null;
            return formatDateValue(d, a.length > 1 ? textArg(run, a[1]!) : null, env);
        }

        // ── Conversión ──
        case 'TEXTO': {
            const v = single(arg(0), 'El valor');
            const pattern = a.length > 1 ? textArg(run, a[1]!) : null;
            if (v === null) return '';
            if (isFormulaDate(v)) return formatDateValue(v, pattern, env);
            if (typeof v === 'number') {
                return pattern ? formatNumberPattern(v, pattern, env) : formatNumberRegional(v, null, env.numberFormat);
            }
            return valueToText(v, env);
        }
        case 'VALOR': {
            const v = single(arg(0), 'El valor');
            if (v === null || v === '') return null;
            if (typeof v === 'number') return v;
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (isFormulaDate(v)) return err('VALOR recibe un texto, no una fecha.');
            const n = parseNumberText(v, env.numberFormat);
            return n === null ? err(`«${v.length > 40 ? `${v.slice(0, 40)}…` : v}» no es un número.`) : n;
        }
        case 'FECHA': {
            if (a.length === 1) {
                const v = single(arg(0), 'El valor');
                if (v === null || v === '') return null;
                if (isFormulaDate(v)) return v.kind === 'date' ? v : new FormulaDate('date', dayMsOf(v, env));
                const d = typeof v === 'string' ? parseDateText(v, env) : null;
                if (!d) return err(`«${String(v)}» no es una fecha.`);
                return d.kind === 'date' ? d : new FormulaDate('date', dayMsOf(d, env));
            }
            const y = intArg(arg(0), 'El año');
            const m = a.length > 1 ? intArg(arg(1), 'El mes') : 1;
            const d = a.length > 2 ? intArg(arg(2), 'El día') : 1;
            if (y < 1 || y > 9999) return err('El año tiene que estar entre 1 y 9999.');
            // Como Excel: el mes 13 es enero del año siguiente; el día 0, el último del mes anterior.
            const base = addMonthsYmd(y, 1, 1, m - 1);
            const ms = addDaysMs(ymdToMs(base.y, base.m, 1), d - 1);
            const py = partsOfDateMs(ms).y;
            if (py < 1 || py > 9999) return err('La fecha queda fuera del calendario.');
            return new FormulaDate('date', ms);
        }
        case 'LETRAS':
            return numberToSpanishWords(num(0));
        case 'PESOS':
            return amountToSpanishWords(num(0));
        default:
            return err(`La función «${node.fn}» no existe.`);
    }
}

function shiftLocalDays(d: FormulaDate, days: number, env: FormulaEnv): FormulaDate {
    const p = zonedPartsOf(d.ms, env.timeZone);
    const day = addDaysMs(ymdToMs(p.y, p.m, p.d), days);
    return new FormulaDate('datetime', zonedInstant(msToYmd(day), env.timeZone, { h: p.hour, m: p.minute, s: p.second }).getTime());
}

/**
 * Valor final → cómo se GUARDA/muestra según el tipo de resultado:
 * número, texto, `YYYY-MM-DD`, instante ISO, o sí/no. Un vacío queda vacío.
 */
export function formulaOutput(v: FV, type: FormulaResultType, env: FormulaEnv): unknown {
    switch (type) {
        case 'number':
        case 'currency':
        case 'percent':
        case 'duration': {
            const s = single(v, 'El resultado');
            if (s === null || s === '') return null;
            if (isFormulaDate(s)) return err('El resultado es una fecha: elige «Fecha» como tipo de resultado.');
            let n: number;
            if (typeof s === 'number') n = s;
            else if (typeof s === 'boolean') n = s ? 1 : 0;
            else {
                const parsed = parseNumberText(s, env.numberFormat);
                if (parsed === null) return err(`El resultado («${s.length > 30 ? `${s.slice(0, 30)}…` : s}») no es un número.`);
                n = parsed;
            }
            if (!Number.isFinite(n)) return err('El resultado no es un número válido.');
            return Number(n.toPrecision(15));
        }
        case 'checkbox':
            return toBool(v);
        case 'date': {
            const d = toDate(v, env, 'El resultado');
            return d ? msToYmd(dayMsOf(d, env)) : null;
        }
        case 'datetime': {
            const d = toDate(v, env, 'El resultado');
            return d ? new Date(instantOf(d, env)).toISOString() : null;
        }
        case 'text': {
            const t = capText(valueToText(v, env));
            return t === '' ? null : t;
        }
    }
}

/** Evalúa un árbol ya leído con el tipo de resultado indicado. */
export function evaluateFormulaAst(ast: FormulaNode, type: FormulaResultType, ctx: FormulaEvalContext): FormulaResult {
    const run: Run = { ctx, steps: 0, started: Date.now() };
    try {
        return { ok: true, value: formulaOutput(ev(run, ast), type, ctx.env) };
    } catch (e) {
        if (e instanceof FormulaRuntimeError) return { ok: false, error: e.message };
        if (e instanceof RangeError) return { ok: false, error: 'La fórmula es demasiado compleja para calcularse.' };
        throw e;
    }
}

/**
 * Evalúa el campo fórmula `field` para una fila (memo + guardia de ciclos:
 * dos fórmulas que se usan entre sí dan error en vez de colgarse).
 */
export function evaluateFieldFormula(field: FormulaEvalField, ctx: FormulaEvalContext): FormulaResult {
    const memo = ctx.memo ?? new Map<number, FormulaResult>();
    const hit = memo.get(field.id);
    if (hit) return hit;
    const visiting = ctx.visiting ?? new Set<number>();
    if (visiting.has(field.id)) return { ok: false, error: 'Las fórmulas se usan entre sí en círculo.' };
    if (visiting.size > 32) return { ok: false, error: 'Demasiadas fórmulas encadenadas.' };
    const cfg = (field.config ?? {}) as Record<string, unknown>;
    const text = typeof cfg.formula === 'string' ? cfg.formula : '';
    let result: FormulaResult;
    if (text.trim() === '') {
        result = { ok: true, value: null };
    } else {
        const parsed = parseFormulaCached(text);
        if (!parsed.ok) {
            result = { ok: false, error: parsed.error.message };
        } else {
            visiting.add(field.id);
            try {
                const type = formulaResultTypeOf(field, ctx);
                const refLabels = cfg.labels && typeof cfg.labels === 'object' ? (cfg.labels as Record<string, string>) : undefined;
                result = evaluateFormulaAst(parsed.ast, type, { ...ctx, memo, visiting, refLabels });
            } finally {
                visiting.delete(field.id);
            }
        }
    }
    memo.set(field.id, result);
    return result;
}

/**
 * Evalúa TODAS las fórmulas de una fila: devuelve sus valores (por id) y los
 * errores. Las demás fórmulas que una usa se calculan una sola vez (memo).
 */
export function evaluateRowFormulas(
    fields: readonly FormulaEvalField[],
    rawValue: (fieldId: number) => unknown,
    env: FormulaEnv,
    opts: { throughTarget?: ThroughTargetOf } = {},
): { values: Map<number, unknown>; errors: Map<number, string> } {
    const formulas = fields.filter((f) => f.type === 'formula');
    const values = new Map<number, unknown>();
    const errors = new Map<number, string>();
    if (formulas.length === 0) return { values, errors };
    const ctx: FormulaEvalContext = {
        env,
        fields: new Map(fields.map((f) => [f.id, f])),
        rawValue,
        throughTarget: opts.throughTarget,
        memo: new Map(),
        visiting: new Set(),
    };
    for (const f of formulas) {
        const res = evaluateFieldFormula(f, ctx);
        if (res.ok) values.set(f.id, res.value);
        else {
            values.set(f.id, null);
            errors.set(f.id, res.error);
        }
    }
    return { values, errors };
}
