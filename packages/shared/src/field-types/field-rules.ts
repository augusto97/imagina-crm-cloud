import { isUserWritableType, jsonbKeyForField, type FieldType } from '../schemas/field';
import type { FieldDefault, FieldValidation, FieldFormatPreset, RequiredIfOp } from '../schemas/field-rules';
import { zonedToday } from '../schemas/timezone';

/**
 * v0.1.300 — Valores por defecto y validaciones de un campo (las reglas viven en
 * `config.default_value` / `config.validation`, ver schemas/field-rules.ts).
 *
 * Estas funciones son las ÚNICAS que aplican las reglas: las usa el
 * validador compartido (`validateFieldValue`) y, para las que miran el
 * registro entero (obligatorio-si), quien guarda el registro — tanto en el
 * navegador como en el servidor. Así una regla no se valida distinto en la
 * celda, el alta, el import o una automatización.
 */

interface RuleField {
    id: number;
    slug?: string;
    label?: string;
    type: FieldType;
    config: Record<string, unknown>;
}

const isEmpty = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** La regla de validación del campo (o null si no tiene). */
export function fieldValidationOf(config: Record<string, unknown> | null | undefined): FieldValidation | null {
    const v = (config ?? {}).validation;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as FieldValidation) : null;
}

/** El valor por defecto del campo (o null si no tiene). */
export function fieldDefaultOf(config: Record<string, unknown> | null | undefined): FieldDefault | null {
    const d = (config ?? {}).default_value;
    return d && typeof d === 'object' && !Array.isArray(d) && typeof (d as { kind?: unknown }).kind === 'string'
        ? (d as FieldDefault)
        : null;
}

// ─── Valores por defecto ─────────────────────────────────────────────────

export interface DefaultContext {
    now: Date;
    /** Zona de la EMPRESA ("hoy" se cuenta en su reloj). */
    timeZone: string;
    /** Quien crea el registro (0 / null = el sistema: sin "quien lo crea"). */
    userId?: number | null;
}

/** Qué tipos de valor por defecto admite cada tipo de campo (para la UI y el servidor). */
export function defaultKindsFor(type: FieldType): Array<FieldDefault['kind']> {
    if (!isUserWritableType(type) || type === 'file') return [];
    if (type === 'date') return ['value', 'today'];
    if (type === 'datetime') return ['value', 'now'];
    // Una persona fija no viaja bien entre empresas (plantillas, migración):
    // sólo "quien lo crea".
    if (type === 'user') return ['creator'];
    return ['value'];
}

/** El valor por defecto RESUELTO para un alta, o `undefined` si no hay. */
export function resolveFieldDefault(field: Pick<RuleField, 'type' | 'config'>, ctx: DefaultContext): unknown {
    const d = fieldDefaultOf(field.config);
    if (!d || !defaultKindsFor(field.type).includes(d.kind)) return undefined;
    switch (d.kind) {
        case 'value':
            return isEmpty(d.value) ? undefined : d.value;
        case 'today':
            return zonedToday(ctx.timeZone, ctx.now);
        case 'now':
            return ctx.now.toISOString();
        case 'creator':
            return ctx.userId !== null && ctx.userId !== undefined && ctx.userId > 0 ? ctx.userId : undefined;
    }
}

/**
 * Completa con su valor por defecto los campos que NO vienen en `data`
 * (clave ausente; un `null` explícito es "lo dejé vacío" y se respeta).
 * Devuelve un objeto nuevo.
 */
export function applyFieldDefaults(
    fields: ReadonlyArray<Pick<RuleField, 'id' | 'type' | 'config'>>,
    data: Record<string, unknown>,
    ctx: DefaultContext,
): Record<string, unknown> {
    const out = { ...data };
    for (const f of fields) {
        const key = jsonbKeyForField(f.id);
        if (key in out) continue;
        const v = resolveFieldDefault(f, ctx);
        if (v !== undefined) out[key] = v;
    }
    return out;
}

// ─── Reglas sobre el valor ───────────────────────────────────────────────

const RANGE_NUMERIC: readonly FieldType[] = ['number', 'currency', 'percent', 'rating', 'duration'];
const RANGE_DATE: readonly FieldType[] = ['date', 'datetime'];
const LENGTH_TYPES: readonly FieldType[] = ['text', 'long_text'];
const FORMAT_TYPES: readonly FieldType[] = ['text'];

/** Qué reglas aplican a un tipo (para la UI: no ofrecer lo que no aplica). */
export function validationKindsFor(type: FieldType): { range: 'number' | 'date' | null; length: boolean; format: boolean; requiredIf: boolean } {
    return {
        range: RANGE_NUMERIC.includes(type) ? 'number' : RANGE_DATE.includes(type) ? 'date' : null,
        length: LENGTH_TYPES.includes(type),
        format: FORMAT_TYPES.includes(type),
        requiredIf: isUserWritableType(type) && type !== 'checkbox',
    };
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** `2026-01-05` → «5 de enero de 2026» (los mensajes no dependen del formato regional). */
function longDate(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return ymd;
    return `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
}

function numberText(n: number): string {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

function custom(message: string | undefined, fallback: string): string {
    const m = typeof message === 'string' ? message.trim() : '';
    return m !== '' ? m : fallback;
}

/**
 * Chequea las reglas de un valor YA normalizado por el validador del tipo
 * (un número es number, una fecha `YYYY-MM-DD`, …). Devuelve el mensaje de
 * error (el propio de la regla, si lo hay) o null. Un valor vacío no se
 * chequea: lo obligatorio es otra regla.
 */
export function checkValueRules(field: Pick<RuleField, 'type' | 'config'>, value: unknown): string | null {
    const v = fieldValidationOf(field.config);
    if (!v || isEmpty(value)) return null;
    const kinds = validationKindsFor(field.type);

    if (kinds.range === 'number') {
        const n = typeof value === 'number' ? value : Number(value);
        const min = typeof v.min === 'number' ? v.min : null;
        const max = typeof v.max === 'number' ? v.max : null;
        if (Number.isFinite(n)) {
            if (min !== null && n < min) {
                return custom(v.range_message, max !== null ? `Debe estar entre ${numberText(min)} y ${numberText(max)}.` : `El valor mínimo es ${numberText(min)}.`);
            }
            if (max !== null && n > max) {
                return custom(v.range_message, min !== null ? `Debe estar entre ${numberText(min)} y ${numberText(max)}.` : `El valor máximo es ${numberText(max)}.`);
            }
        }
    } else if (kinds.range === 'date' && typeof value === 'string') {
        // Fecha y hora: se compara el DÍA (en UTC) del instante.
        const day = value.slice(0, 10);
        const min = typeof v.min === 'string' ? v.min : null;
        const max = typeof v.max === 'string' ? v.max : null;
        if (min !== null && day < min) {
            return custom(v.range_message, max !== null ? `La fecha debe estar entre el ${longDate(min)} y el ${longDate(max)}.` : `La fecha no puede ser anterior al ${longDate(min)}.`);
        }
        if (max !== null && day > max) {
            return custom(v.range_message, min !== null ? `La fecha debe estar entre el ${longDate(min)} y el ${longDate(max)}.` : `La fecha no puede ser posterior al ${longDate(max)}.`);
        }
    }

    if (kinds.length && typeof value === 'string') {
        const len = Array.from(value).length;
        const minL = typeof v.min_length === 'number' ? v.min_length : null;
        const maxL = typeof v.max_length === 'number' ? v.max_length : null;
        if (minL !== null && len < minL) return custom(v.length_message, `Mínimo ${minL} caracteres.`);
        if (maxL !== null && len > maxL) return custom(v.length_message, `Máximo ${maxL} caracteres.`);
    }

    if (kinds.format && typeof value === 'string' && v.format) {
        if (v.format === 'regex' && v.pattern && value.length > USER_PATTERN_VALUE_MAX) {
            return `Para revisar el formato el valor no puede pasar de ${USER_PATTERN_VALUE_MAX} caracteres.`;
        }
        const err = checkFormat(v.format, value, v.pattern, v.pattern_ignore_case === true);
        if (err !== null) return custom(v.format_message, err);
    }
    return null;
}

// ─── Formatos ────────────────────────────────────────────────────────────

/** Pesos del dígito de verificación del NIT (DIAN), de derecha a izquierda. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Dígito de verificación de un NIT (sólo dígitos, sin el DV). */
export function nitCheckDigit(base: string): number {
    const digits = base.replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        const d = Number(digits[digits.length - 1 - i]);
        sum += d * (NIT_WEIGHTS[i] ?? 0);
    }
    const r = sum % 11;
    return r > 1 ? 11 - r : r;
}

const FORMAT_MESSAGES: Record<Exclude<FieldFormatPreset, 'regex'>, string> = {
    nit: 'No es un NIT válido: de 6 a 10 dígitos y, si lo incluyes, el dígito de verificación correcto (900.123.456-8).',
    nit_dv: 'No es un NIT válido: escribe el número con su dígito de verificación correcto (900.123.456-8).',
    cedula: 'No es una cédula válida: de 6 a 10 dígitos.',
    placa: 'No es una placa válida: tres letras y tres números (ABC123) o, en motos, ABC12D.',
    digits: 'Sólo se admiten números.',
    letters: 'Sólo se admiten letras.',
};

/** Etiquetas de los formatos, para la UI. */
export const FIELD_FORMAT_LABELS: Record<FieldFormatPreset, string> = {
    nit: 'NIT (con o sin dígito de verificación)',
    nit_dv: 'NIT con dígito de verificación',
    cedula: 'Cédula de ciudadanía',
    placa: 'Placa de vehículo (Colombia)',
    digits: 'Sólo números',
    letters: 'Sólo letras',
    regex: 'Expresión regular propia',
};

/** Valor máximo (caracteres) sobre el que se evalúa una expresión regular propia. */
export const USER_PATTERN_VALUE_MAX = 200;

function checkFormat(format: FieldFormatPreset, raw: string, pattern: string | undefined, ignoreCase: boolean): string | null {
    const value = raw.trim();
    switch (format) {
        case 'nit':
        case 'nit_dv': {
            const m = /^(\d{6,10})(?:\s*-\s*(\d))?$/.exec(value.replace(/[.\s]/g, ''));
            if (!m) return FORMAT_MESSAGES[format];
            const dv = m[2];
            if (dv === undefined) return format === 'nit_dv' ? FORMAT_MESSAGES.nit_dv : null;
            return nitCheckDigit(m[1]!) === Number(dv) ? null : FORMAT_MESSAGES[format];
        }
        case 'cedula':
            return /^\d{6,10}$/.test(value.replace(/[.\s]/g, '')) ? null : FORMAT_MESSAGES.cedula;
        case 'placa':
            return /^[A-Z]{3}[-\s]?(\d{3}|\d{2}[A-Z])$/.test(value.toUpperCase()) ? null : FORMAT_MESSAGES.placa;
        case 'digits':
            return /^\d+$/.test(value) ? null : FORMAT_MESSAGES.digits;
        case 'letters':
            return /^[\p{L}\p{M}\s]+$/u.test(value) ? null : FORMAT_MESSAGES.letters;
        case 'regex': {
            if (!pattern) return null;
            const re = compileUserPattern(pattern, ignoreCase);
            // Un patrón que no pasa el análisis (llegó por una vía que no lo
            // validó al guardar) no se ejecuta: mejor no validar que colgar.
            if (re === null || raw.length > USER_PATTERN_VALUE_MAX) return null;
            return re.test(raw) ? null : 'El valor no tiene el formato esperado.';
        }
    }
}

// ─── Expresión regular propia: protección contra ReDoS ───────────────────

/**
 * Presupuesto de "pasos" de la expresión en el peor caso, con un valor de
 * `USER_PATTERN_VALUE_MAX` caracteres. Ver `analyzeUserPattern`.
 */
const PATTERN_STEP_BUDGET = 10_000_000;
const MAX_BOUNDED_REPEAT = 1000;

export type PatternAnalysis = { ok: true } | { ok: false; reason: string };

interface Cx {
    /** Cuantificadores sin tope (`*`, `+`, `{n,}`) que se suman en serie. */
    u: number;
    /** Factor de ramificación (alternativas × rangos de los cuantificadores con tope). */
    b: number;
}

class PatternError extends Error {}

/**
 * ¿Es seguro ejecutar esta expresión en el servidor? Las expresiones
 * regulares de JavaScript retroceden (backtracking): un patrón como
 * `(a+)+$` tarda un tiempo EXPONENCIAL en fallar y bloquea el proceso
 * (ReDoS). Node no tiene timeout para una regex, así que se rechaza al
 * GUARDAR todo lo que pueda explotar:
 *
 *  1. Largo del patrón ≤ 200 y debe compilar.
 *  2. Nada de referencias hacia atrás (`\1`, `\k<x>`) ni lookarounds.
 *  3. Nada de cuantificador SIN TOPE sobre un grupo que ya repite o tiene
 *     alternativas (`(a+)+`, `(a|ab)*`): el caso exponencial clásico.
 *  4. Estimación del peor caso: el patrón se ejecuta ANCLADO (`^…$`) sobre
 *     valores de hasta 200 caracteres, así que cuesta ≈ 200^U × B pasos,
 *     con U = cuantificadores sin tope en serie y B = producto de las
 *     alternativas y de los rangos de los cuantificadores con tope. Se
 *     exige ≤ 10.000.000 (medido: ~10 ms en el peor caso): en la práctica,
 *     hasta tres `*`/`+` y rangos chicos — lo que necesita un código, una
 *     placa, un correo o un número de radicado.
 *
 * Al ejecutar, además, el valor se recorta a 200 caracteres (más largo →
 * error de formato) y un patrón que no pasa este análisis no se ejecuta.
 */
export function analyzeUserPattern(pattern: string): PatternAnalysis {
    if (pattern.length === 0) return { ok: false, reason: 'Escribe la expresión regular.' };
    if (pattern.length > 200) return { ok: false, reason: 'La expresión no puede pasar de 200 caracteres.' };
    if (buildRegex(pattern, false) === null) return { ok: false, reason: 'La expresión regular no es válida.' };
    try {
        const cx = parseAlternatives(pattern, { i: 0 }, false);
        const steps = Math.pow(USER_PATTERN_VALUE_MAX, cx.u) * cx.b;
        if (!Number.isFinite(steps) || steps > PATTERN_STEP_BUDGET) {
            return {
                ok: false,
                reason: 'La expresión es demasiado costosa de evaluar: usa como máximo tres repeticiones abiertas (* o +) y rangos {n,m} chicos.',
            };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e instanceof PatternError ? e.message : 'La expresión regular no es válida.' };
    }
}

function parseAlternatives(src: string, pos: { i: number }, inGroup: boolean): Cx {
    const branches: Cx[] = [parseSequence(src, pos)];
    while (pos.i < src.length && src[pos.i] === '|') {
        pos.i++;
        branches.push(parseSequence(src, pos));
    }
    if (inGroup) {
        if (src[pos.i] !== ')') throw new PatternError('Falta cerrar un paréntesis.');
        pos.i++;
    }
    return {
        u: Math.max(...branches.map((b) => b.u)),
        b: branches.reduce((acc, b) => acc + b.b, 0),
    };
}

function parseSequence(src: string, pos: { i: number }): Cx {
    let u = 0;
    let b = 1;
    while (pos.i < src.length && src[pos.i] !== '|' && src[pos.i] !== ')') {
        let atom: Cx;
        let quantifiable = true;
        const c = src[pos.i]!;
        if (c === '\\') {
            const next = src[pos.i + 1] ?? '';
            if (/[1-9]/.test(next)) throw new PatternError('No se admiten referencias hacia atrás (\\1).');
            if (next === 'k' && src[pos.i + 2] === '<') throw new PatternError('No se admiten referencias hacia atrás (\\k<…>).');
            pos.i += 2;
            if (next === 'u' && src[pos.i] === '{') {
                while (pos.i < src.length && src[pos.i] !== '}') pos.i++;
                pos.i++;
            } else if (next === 'u') pos.i += 4;
            else if (next === 'x') pos.i += 2;
            else if (next === 'c') pos.i += 1;
            else if ((next === 'p' || next === 'P') && src[pos.i] === '{') {
                while (pos.i < src.length && src[pos.i] !== '}') pos.i++;
                pos.i++;
            }
            if (next === 'b' || next === 'B') quantifiable = false;
            atom = { u: 0, b: 1 };
        } else if (c === '[') {
            pos.i++;
            if (src[pos.i] === '^') pos.i++;
            if (src[pos.i] === ']') pos.i++;
            while (pos.i < src.length && src[pos.i] !== ']') {
                pos.i += src[pos.i] === '\\' ? 2 : 1;
            }
            if (src[pos.i] !== ']') throw new PatternError('Falta cerrar un corchete.');
            pos.i++;
            atom = { u: 0, b: 1 };
        } else if (c === '(') {
            pos.i++;
            if (src[pos.i] === '?') {
                const ahead = src.slice(pos.i, pos.i + 3);
                if (ahead.startsWith('?=') || ahead.startsWith('?!') || ahead === '?<=' || ahead === '?<!') {
                    throw new PatternError('No se admiten lookahead ni lookbehind.');
                }
                if (ahead.startsWith('?:')) pos.i += 2;
                else if (ahead.startsWith('?<')) {
                    while (pos.i < src.length && src[pos.i] !== '>') pos.i++;
                    pos.i++;
                } else throw new PatternError('Grupo no admitido.');
            }
            atom = parseAlternatives(src, pos, true);
        } else if (c === '^' || c === '$') {
            pos.i++;
            quantifiable = false;
            atom = { u: 0, b: 1 };
        } else {
            pos.i++;
            atom = { u: 0, b: 1 };
        }

        const q = quantifiable ? readQuantifier(src, pos) : null;
        if (q) {
            const unbounded = q.max === Infinity;
            if (unbounded) {
                if (atom.u > 0 || atom.b > 1) {
                    throw new PatternError('No se admiten repeticiones anidadas como (a+)+ o (a|b)*: pueden colgar la validación.');
                }
                atom = { u: 1, b: 1 };
            } else {
                if (q.max > MAX_BOUNDED_REPEAT) throw new PatternError(`Una repetición {n,m} no puede pasar de ${MAX_BOUNDED_REPEAT}.`);
                const range = q.max - q.min + 1;
                atom = { u: atom.u * q.max, b: Math.pow(atom.b, Math.max(q.max, 1)) * range };
            }
        }
        u += atom.u;
        b *= atom.b;
        if (!Number.isFinite(b) || b > 1e15) b = Infinity;
    }
    return { u, b };
}

function readQuantifier(src: string, pos: { i: number }): { min: number; max: number } | null {
    const c = src[pos.i];
    let q: { min: number; max: number } | null = null;
    if (c === '*') q = { min: 0, max: Infinity };
    else if (c === '+') q = { min: 1, max: Infinity };
    else if (c === '?') q = { min: 0, max: 1 };
    if (q) {
        pos.i++;
    } else if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(pos.i));
        if (!m) return null; // `{` literal
        const min = Number(m[1]);
        const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
        q = { min, max };
        pos.i += m[0].length;
    }
    if (q && src[pos.i] === '?') pos.i++; // perezoso
    return q;
}

function buildRegex(pattern: string, ignoreCase: boolean): RegExp | null {
    const flags = ignoreCase ? 'i' : '';
    try {
        return new RegExp(`^(?:${pattern})$`, `${flags}u`);
    } catch {
        try {
            return new RegExp(`^(?:${pattern})$`, flags);
        } catch {
            return null;
        }
    }
}

const patternCache = new Map<string, RegExp | null>();

/** La expresión propia lista para usar (anclada), o null si no es segura/válida. */
export function compileUserPattern(pattern: string, ignoreCase = false): RegExp | null {
    const key = `${ignoreCase ? 'i' : '-'}:${pattern}`;
    if (patternCache.has(key)) return patternCache.get(key)!;
    const re = analyzeUserPattern(pattern).ok ? buildRegex(pattern, ignoreCase) : null;
    if (patternCache.size > 500) patternCache.clear();
    patternCache.set(key, re);
    return re;
}

// ─── Obligatorio si… ─────────────────────────────────────────────────────

/** ¿Se cumple la condición sobre el valor del otro campo? */
export function requiredIfMatches(other: Pick<RuleField, 'type'>, otherValue: unknown, op: RequiredIfOp, expected: unknown): boolean {
    const present = other.type === 'checkbox' ? otherValue === true : !isEmpty(otherValue);
    if (op === 'not_empty') return present;
    const eq = valueEquals(other.type, otherValue, expected);
    return op === 'eq' ? eq : !eq;
}

function valueEquals(type: FieldType, actual: unknown, expected: unknown): boolean {
    if (type === 'checkbox') {
        const want = expected === true || expected === 'true' || expected === 1 || expected === '1';
        return (actual === true) === want;
    }
    if (isEmpty(actual)) return isEmpty(expected);
    if (type === 'multi_select') {
        const set = Array.isArray(actual) ? actual.map(String) : [String(actual)];
        const wants = Array.isArray(expected) ? expected.map(String) : [String(expected)];
        return wants.length > 0 && wants.every((w) => set.includes(w));
    }
    if (typeof actual === 'number' || ['number', 'currency', 'percent', 'rating', 'duration', 'user'].includes(type)) {
        const a = Number(actual);
        const b = Number(expected);
        return Number.isFinite(a) && Number.isFinite(b) && a === b;
    }
    return String(actual).trim().toLowerCase() === String(expected ?? '').trim().toLowerCase();
}

export interface RequiredIfError {
    field: RuleField;
    message: string;
}

/**
 * "Obligatorio si otro campo vale X": recorre los campos con la regla y
 * devuelve los que quedaron vacíos cumpliéndose la condición.
 *
 * `touched` (claves `f{id}`): en una EDICIÓN sólo se reportan las reglas que
 * involucran algo que cambió (el campo o su condición) — un registro viejo
 * que no cumplía una regla nueva no bloquea la edición de otro campo.
 */
export function checkRequiredIf(
    fields: ReadonlyArray<RuleField>,
    data: Record<string, unknown>,
    opts: { touched?: ReadonlySet<string> } = {},
): RequiredIfError[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: RequiredIfError[] = [];
    for (const f of fields) {
        if (!validationKindsFor(f.type).requiredIf) continue;
        const rule = fieldValidationOf(f.config)?.required_if;
        if (!rule || rule.field_id === null || rule.field_id === undefined) continue;
        const other = byId.get(rule.field_id);
        if (!other || other.id === f.id) continue;
        const key = jsonbKeyForField(f.id);
        const otherKey = jsonbKeyForField(other.id);
        if (opts.touched && !opts.touched.has(key) && !opts.touched.has(otherKey)) continue;
        if (!requiredIfMatches(other, data[otherKey], rule.op, rule.value)) continue;
        if (!isEmpty(data[key])) continue;
        out.push({ field: f, message: custom(rule.message, requiredIfDefaultMessage(other, rule.op, rule.value, f.label)) });
    }
    return out;
}

/** «NIT» es obligatorio cuando «Tipo» es «Empresa». (El mensaje se lee igual junto al campo o en otra celda.) */
export function requiredIfDefaultMessage(
    other: Pick<RuleField, 'type' | 'config' | 'label'>,
    op: RequiredIfOp,
    expected: unknown,
    selfLabel?: string,
): string {
    const label = other.label ? `«${other.label}»` : 'el otro campo';
    const who = selfLabel ? `«${selfLabel}» es obligatorio` : 'Este campo es obligatorio';
    if (op === 'not_empty') return `${who} cuando ${label} tiene un valor.`;
    const shown = describeExpected(other, expected);
    return op === 'eq' ? `${who} cuando ${label} es ${shown}.` : `${who} cuando ${label} no es ${shown}.`;
}

function describeExpected(other: Pick<RuleField, 'type' | 'config'>, expected: unknown): string {
    if (other.type === 'checkbox') {
        return expected === true || expected === 'true' || expected === 1 ? '«Sí»' : '«No»';
    }
    const options = Array.isArray(other.config.options) ? (other.config.options as Array<{ value?: unknown; label?: unknown }>) : [];
    const label = (v: unknown): string => {
        const o = options.find((x) => x.value === v);
        return typeof o?.label === 'string' && o.label !== '' ? o.label : String(v ?? '');
    };
    const items = Array.isArray(expected) ? expected : [expected];
    return items.map((v) => `«${label(v)}»`).join(' y ');
}
